/**
 * 天翼云盘 (Tianyi Cloud / cloud.189.cn) StorageExecutor — the brand-4 analogue
 * of QuarkStorageExecutor / GuangYaStorageExecutor, over TianyiClient.
 * Implements the 12 StorageExecutor port methods. Mirrors the quark executor's
 * METHOD STRUCTURE; only the brand-specific bits differ.
 *
 * Differences from quark/光鸭:
 *  - 转存 is SHARE_SAVE (client.saveShare runs the whole chain internally:
 *    getShareInfo → listShareDir → createBatchTask → poll, incl. conflict
 *    resolution). Like quark — and OPPOSITE of 光鸭 — there is NO offline/magnet
 *    API, so a magnet/ed2k candidate fails LOUD (TIANYI_NO_MAGNET) instead of
 *    being attempted.
 *  - 天翼 has NO confirmed parent-walk / breadcrumb endpoint, so the write-scope
 *    guard CANNOT walk a target's parents the way quark does (getFileInfo hops).
 *    It uses 光鸭's DERIVED-SCOPE model instead: the workflow provisions the
 *    directory chain TOP-DOWN from a connect-time scope root via createDirectory
 *    on THIS executor instance before any write; each nested dir is authorized by
 *    being find-or-created (or discovered, PR#58) under an already-in-scope
 *    parent and tracked in `derivedScopeIds`. assertWithinWriteScope is
 *    SYNCHRONOUS (no network) — callers do NOT await it.
 *  - 天翼's account root folder id is `-11` — a normal, NON-empty id — so the
 *    guard does NOT need 光鸭's empty-string-root special case. `-11` is
 *    protected by default: it must never be recursively listed or removed.
 *  - A 天翼 item is a directory when `isFolder === true`; ids key on `id`, names
 *    on `name`, sizes on `size`. Directory listing uses `listFiles(dirId)`.
 */
import type { PackageTreeFile, ResourceCandidate, TransferAttempt, TransferStatus, VerifiedFile } from "./domain.js";
import { episodeCodeFromFileName } from "./episode-code.js";
import type { StorageExecutor, UnparsedVideoFile } from "./ports.js";
import { isTianyiAuthError } from "./tianyi-client.js";
import type { TianyiBatchEntry, TianyiClient, TianyiItem } from "./tianyi-client.js";

const MAX_RECURSIVE_COLLECT_DEPTH = 6;
const DEFAULT_MIN_VIDEO_SIZE_BYTES = 10 * 1024 * 1024;
/** 个人云根目录 id — a plain non-empty id (unlike 光鸭's "" root). */
const TIANYI_ROOT_FOLDER_ID = "-11";

const DEFAULT_VIDEO_EXTENSIONS = [
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".ts",
  ".m2ts",
];

export interface TianyiStorageExecutorOptions {
  client: TianyiClient;
  /** Directory ids inside which writes/deletes are allowed (the drive's scope
   *  roots: rootDir + Movies/TV/Anime). Empty = allow all (dev only). */
  writeScopeDirectoryIds?: string[];
  /** Directories that may never be removed or recursively listed (account root
   *  -11 is always included). NOTE: unlike quark, write-scope dirs are NOT
   *  auto-folded in here — 光鸭's model applies: the write target IS a scope dir
   *  and transfer must read it before/after. */
  protectedDirectoryIds?: string[];
  minVideoSizeBytes?: number;
  videoExtensions?: string[];
}

interface VideoFact {
  file: VerifiedFile;
  sourceDirectoryId: string;
  sizeBytes: number;
}

export class TianyiStorageExecutor implements StorageExecutor {
  private readonly client: TianyiClient;
  private readonly writeScopeDirectoryIds: Set<string>;
  /** Ids of nested dirs find-or-created (createDirectory) or discovered under an
   *  already-in-scope parent (listSubdirectories, PR#58) during this run. They
   *  become authorized write targets — 天翼 has no parent-walk API to verify them
   *  otherwise. Consulted by assertWithinWriteScope / isWithinWriteScope. */
  private readonly derivedScopeIds = new Set<string>();
  private readonly protectedDirectoryIds: Set<string>;
  private readonly minVideoSizeBytes: number;
  private readonly videoExtensions: Set<string>;
  private nextTransferNumber = 1;

  constructor(options: TianyiStorageExecutorOptions) {
    this.client = options.client;
    this.writeScopeDirectoryIds = new Set(options.writeScopeDirectoryIds ?? []);
    this.protectedDirectoryIds = new Set([
      TIANYI_ROOT_FOLDER_ID,
      ...(options.protectedDirectoryIds ?? []),
    ]);
    this.minVideoSizeBytes = options.minVideoSizeBytes ?? DEFAULT_MIN_VIDEO_SIZE_BYTES;
    this.videoExtensions = new Set(
      (options.videoExtensions ?? DEFAULT_VIDEO_EXTENSIONS).map((ext) => ext.toLowerCase()),
    );
  }

  async createDirectory(input: { name: string; parentId: string }): Promise<string> {
    const safeParentId = this.assertWithinWriteScope(input.parentId, "create directory");
    // Find-or-create: seasons of one title initialize at different times and must
    // land under the SAME show directory (天翼 happily makes duplicate folders).
    const items = await this.client.listFiles(safeParentId);
    for (const item of items) {
      if (isDirectory(item) && nameOf(item) === input.name) {
        const existingId = idOf(item);
        if (existingId) {
          // Authorize this nested dir as a future write target (it lives under an
          // already-in-scope parent). Covers both the find-existing and create branches.
          this.derivedScopeIds.add(existingId);
          return existingId;
        }
      }
    }
    const createdId = await this.client.createFolder({ name: input.name, parentId: safeParentId });
    this.derivedScopeIds.add(createdId);
    return createdId;
  }

  async listVideoFiles(directoryId: string): Promise<VerifiedFile[]> {
    const safe = this.assertSafeRecursiveListTarget(directoryId, "list videos in");
    const videos = await this.collectVideos(safe, safe);
    return videos.map((v) => v.file);
  }

  async listUnparsedVideoFiles(directoryId: string): Promise<UnparsedVideoFile[]> {
    const safe = this.assertSafeRecursiveListTarget(directoryId, "list unparsed videos in");
    return this.collectUnparsedVideos(safe);
  }

  async renameFile(input: { directoryId: string; fileId: string; newName: string }): Promise<void> {
    this.assertWithinWriteScope(input.directoryId, "rename file");
    await this.client.renameFile({ fileId: input.fileId, name: input.newName });
  }

  async transfer(input: {
    workflowRunId: string;
    directoryId: string;
    candidate: ResourceCandidate;
  }): Promise<TransferAttempt> {
    const url = stringValue(input.candidate.providerPayload["url"]);
    // Magnet/ed2k has no offline API on 天翼 — fail LOUD so the caller never
    // thinks a magnet "could have" worked; it must pick a 天翼 share-link candidate.
    if (input.candidate.type === "magnet" || url.startsWith("magnet:") || url.startsWith("ed2k:")) {
      throw new Error("TIANYI_NO_MAGNET: 天翼云盘不支持磁力链接(无离线下载 API);请改用天翼分享链候选");
    }

    const safe = this.assertWithinWriteScope(input.directoryId, "transfer"); // 同步(derived-scope)
    const before = new Set((await this.listVideoFiles(safe)).map((f) => f.id));

    let providerMessage = "";
    try {
      const parsed = parseTianyiShareUrl(url);
      if (!parsed) {
        throw new Error(`TIANYI_TRANSFER_FAILED: unparseable 天翼 share url: ${url.slice(0, 60)}`);
      }
      const accessCode = stringValue(input.candidate.providerPayload["password"]) || parsed.accessCode;
      const result = await this.client.saveShare({
        shareCode: parsed.shareCode,
        accessCode,
        targetFolderId: safe,
      });
      if (!result.ok) {
        // ok:false with an EMPTY message must never be reclassified as
        // success/no_target_change — fall back to a loud generic reason.
        providerMessage = result.message || "SHARE_SAVE failed(provider 未给原因)"; // failedCount>0 (和谐) / dead share / poll timeout
      }
    } catch (error) {
      // Auth failures must surface so the worker freezes the drive — never absorbed.
      if (isTianyiAuthError(error)) {
        throw error;
      }
      // Any other failure (dead/expired share, bad params) is a FAILED attempt
      // with a loud message; the agent moves to the next candidate.
      providerMessage = error instanceof Error ? error.message : String(error);
    }

    const after = await this.listVideoFiles(safe);
    const materializedFileIds = after.filter((f) => !before.has(f.id)).map((f) => f.id);
    const status: TransferStatus = providerMessage
      ? "failed"
      : materializedFileIds.length > 0
        ? "succeeded"
        : "no_target_change";

    const attempt: TransferAttempt = {
      id: `${input.workflowRunId}_transfer_${this.nextTransferNumber}`,
      workflowRunId: input.workflowRunId,
      candidateId: input.candidate.id,
      status,
      providerMessage:
        providerMessage ||
        (status === "no_target_change" ? "转存完成但目标目录未出现新视频" : ""),
      materializedFileIds,
    };
    this.nextTransferNumber += 1;
    return attempt;
  }

  async flattenDirectory(directoryId: string): Promise<{ moved: string[]; removed: string[] }> {
    const safeDirectoryId = this.assertWithinWriteScope(directoryId, "flatten directory");
    const videos = await this.collectVideos(safeDirectoryId, safeDirectoryId);
    const moveCandidates = videos.filter(
      (v) => v.sourceDirectoryId !== safeDirectoryId && v.sizeBytes >= this.minVideoSizeBytes,
    );
    // This call site KNOWS each item's folderness+name from its own listing —
    // pass both (batch taskInfos want isFolder, probe-verified; see TianyiBatchEntry).
    const moveEntries: TianyiBatchEntry[] = moveCandidates.map((v) => ({
      id: v.file.providerFileId,
      name: v.file.name,
      isFolder: false,
    }));
    const moved = moveEntries.map((e) => e.id);
    if (moveEntries.length > 0) {
      await this.client.moveFiles({ entries: moveEntries, targetFolderId: safeDirectoryId });
    }

    const rootItems = await this.client.listFiles(safeDirectoryId);
    const removableDirectories: TianyiBatchEntry[] = [];
    for (const item of rootItems) {
      if (!isDirectory(item)) {
        continue;
      }
      const childId = idOf(item);
      if (!childId) {
        continue;
      }
      if (!(await this.directoryContainsLargeVideo(childId))) {
        removableDirectories.push({ id: childId, name: nameOf(item), isFolder: true });
      }
    }
    if (removableDirectories.length > 0) {
      await this.client.batchDelete(removableDirectories);
    }
    return { moved, removed: removableDirectories.map((e) => e.id) };
  }

  async removeDirectory(directoryId: string): Promise<{ removed: boolean }> {
    const safe = this.assertWithinWriteScope(directoryId, "remove directory");
    if (this.protectedDirectoryIds.has(safe) || this.writeScopeDirectoryIds.has(safe)) {
      throw new Error(`SAFETY_VIOLATION: refusing to remove protected/root directory fileId=${safe}`);
    }
    // isFolder:true is probe-verified (isFolder:0 on a dir deletes nothing). This
    // call site only has the id, so the entry goes WITHOUT fileName — LIVE-VERIFIED
    // 2026-07-17 (T10 write smoke): a name-less {fileId, isFolder:1} DELETE against
    // real cloud.189.cn reached status=4/failedCount=0 and the folder was gone.
    await this.client.batchDelete([{ id: safe, isFolder: true }]);
    return { removed: true };
  }

  async listTree(input: { directoryId: string; maxDepth?: number }): Promise<PackageTreeFile[]> {
    const safeRoot = this.assertSafeRecursiveListTarget(input.directoryId, "walk the tree of");
    const maxDepth = input.maxDepth ?? 6;
    const results: PackageTreeFile[] = [];
    const walk = async (dirId: string, prefix: string, depth: number): Promise<void> => {
      if (depth > maxDepth) {
        return;
      }
      const items = await this.client.listFiles(dirId);
      for (const item of items) {
        const name = nameOf(item);
        if (isDirectory(item)) {
          const childId = idOf(item);
          if (childId) {
            await walk(childId, `${prefix}${name}/`, depth + 1);
          }
          continue;
        }
        const providerFileId = idOf(item);
        if (!providerFileId) {
          continue;
        }
        results.push({ path: `${prefix}${name}`, providerFileId, sizeBytes: sizeOf(item) });
      }
    };
    await walk(safeRoot, "", 1);
    return results;
  }

  async listSubdirectories(input: {
    directoryId: string;
    maxDepth?: number;
  }): Promise<Array<{ id: string; path: string }>> {
    const safeRoot = this.assertSafeRecursiveListTarget(input.directoryId, "list subdirectories of");
    const maxDepth = input.maxDepth ?? 6;
    const results: Array<{ id: string; path: string }> = [];
    const walk = async (dirId: string, prefix: string, depth: number): Promise<void> => {
      if (depth > maxDepth) {
        return;
      }
      // A subdir DISCOVERED under an in-scope parent is itself within scope (the same
      // top-down derivation createDirectory relies on) — register it so a later
      // removeDirectory can clear it. 天翼's SHARE_SAVE materializes wrapper subdirs
      // SERVER-SIDE (not via createDirectory), so without this the movie flatten's
      // removeDirectory(wrapper) hits WRITE_SCOPE_VIOLATION and leaves empty wrapper
      // dirs + non-video junk behind (the PR#58 光鸭 lesson). Listing an OUT-of-scope
      // dir does NOT widen scope (read ≠ write); registration is gated on the parent
      // already being in scope, computed BEFORE listing.
      const parentInScope = this.isWithinWriteScope(dirId);
      const items = await this.client.listFiles(dirId);
      for (const item of items) {
        if (!isDirectory(item)) {
          continue;
        }
        const childId = idOf(item);
        if (!childId) {
          continue;
        }
        if (parentInScope) {
          this.derivedScopeIds.add(normalizeId(childId));
        }
        const path = `${prefix}${nameOf(item)}`;
        results.push({ id: childId, path });
        await walk(childId, `${path}/`, depth + 1);
      }
    };
    await walk(safeRoot, "", 1);
    return results;
  }

  async listChildDirectories(directoryId: string): Promise<Array<{ id: string; name: string }>> {
    const items = await this.client.listFiles(directoryId);
    const dirs: Array<{ id: string; name: string }> = [];
    for (const item of items) {
      if (!isDirectory(item)) {
        continue;
      }
      const id = idOf(item);
      if (id) {
        dirs.push({ id, name: nameOf(item) });
      }
    }
    return dirs;
  }

  async moveFiles(input: { fileIds: string[]; targetDirectoryId: string }): Promise<{ moved: string[] }> {
    if (input.fileIds.length === 0) {
      return { moved: [] };
    }
    const safeTargetId = this.assertWithinWriteScope(input.targetDirectoryId, "move files into");
    // The port only hands ids; moved things are always FILES (videos into season
    // dirs), so entries go name-less with isFolder:false.
    await this.client.moveFiles({
      entries: input.fileIds.map((id) => ({ id, isFolder: false })),
      targetFolderId: safeTargetId,
    });
    return { moved: input.fileIds };
  }

  async deleteFiles(input: { directoryId: string; fileIds: string[] }): Promise<{ deleted: string[] }> {
    if (input.fileIds.length === 0) {
      return { deleted: [] };
    }
    const safeDirectoryId = this.assertWithinWriteScope(input.directoryId, "delete files");
    const treeFiles = await this.assertFilesBelongToDirectory(safeDirectoryId, input.fileIds);
    // Names are free from the just-walked tree (basename of the path); every id
    // passed the verification above, i.e. it IS one of these tree FILES.
    const nameById = new Map(treeFiles.map((f) => [f.providerFileId, basenameOf(f.path)]));
    await this.client.batchDelete(
      input.fileIds.map((id) => {
        const name = nameById.get(id);
        return { id, ...(name ? { name } : {}), isFolder: false };
      }),
    );
    return { deleted: input.fileIds };
  }

  private async directoryContainsLargeVideo(directoryId: string): Promise<boolean> {
    const videos = await this.collectVideos(directoryId, directoryId);
    return videos.some((v) => v.sizeBytes >= this.minVideoSizeBytes);
  }

  private async collectVideos(rootId: string, currentId: string, depth = 1): Promise<VideoFact[]> {
    if (depth > MAX_RECURSIVE_COLLECT_DEPTH) {
      return [];
    }
    const items = await this.client.listFiles(currentId);
    const videos: VideoFact[] = [];
    for (const item of items) {
      if (isDirectory(item)) {
        const childId = idOf(item);
        if (childId) {
          videos.push(...(await this.collectVideos(rootId, childId, depth + 1)));
        }
        continue;
      }
      const file = verifiedFileFromItem(item, rootId, this.videoExtensions);
      if (file) {
        videos.push({ file, sourceDirectoryId: currentId, sizeBytes: file.sizeBytes });
      }
    }
    return videos;
  }

  private async collectUnparsedVideos(directoryId: string, depth = 1): Promise<UnparsedVideoFile[]> {
    if (depth > MAX_RECURSIVE_COLLECT_DEPTH) {
      return [];
    }
    const items = await this.client.listFiles(directoryId);
    const unparsed: UnparsedVideoFile[] = [];
    for (const item of items) {
      if (isDirectory(item)) {
        const childId = idOf(item);
        if (childId) {
          unparsed.push(...(await this.collectUnparsedVideos(childId, depth + 1)));
        }
        continue;
      }
      const name = nameOf(item);
      if (!isVideoName(name, this.videoExtensions) || episodeCodeFromFileName(name) !== null) {
        continue;
      }
      const providerFileId = idOf(item);
      if (!providerFileId) {
        continue;
      }
      unparsed.push({ providerFileId, name, sizeBytes: sizeOf(item) });
    }
    return unparsed;
  }

  /** Verify against the FULL tree (listTree), not listVideoFiles: the agent's
   *  eyes (inspectStaging/inspectTargetDir) see every file, and cleanup targets
   *  are mostly NON-video (extra subtitles, ads, nfo). Verifying videos-only made
   *  deleting a subtitle impossible on every drive — caught live 2026-07-02 on
   *  光鸭 (黑客帝国3 cleanup refused twice). Returns the walked tree so the
   *  caller can reuse it (e.g. deleteFiles harvests fileName for taskInfos)
   *  instead of walking twice. */
  private async assertFilesBelongToDirectory(
    directoryId: string,
    fileIds: string[],
  ): Promise<PackageTreeFile[]> {
    const treeFiles = await this.listTree({ directoryId });
    const verified = new Set(treeFiles.map((f) => f.providerFileId));
    const unverified = fileIds.filter((id) => !verified.has(id));
    if (unverified.length === 0) {
      return treeFiles;
    }
    throw new Error(
      "SAFETY_VIOLATION: refusing to delete unverified file ids from target directory; " +
        `fileId=${directoryId}; fileIds=${unverified.join(",")}`,
    );
  }

  /** Refuse recursive listing of root/protected dirs (huge scan / 风控 risk).
   *  Unlike quark, write-scope dirs are NOT auto-protected here (光鸭's model:
   *  the write target IS a scope dir, and transfer must read it). */
  private assertSafeRecursiveListTarget(directoryId: string, action: string): string {
    const normalized = normalizeId(directoryId);
    if (this.protectedDirectoryIds.has(normalized)) {
      throw new Error(
        `SAFETY_VIOLATION: refusing to recursively ${action} protected directory fileId=${normalized}`,
      );
    }
    return normalized;
  }

  /** Non-throwing scope membership check (mirrors assertWithinWriteScope). Empty
   *  scope (dev) treats everything as in-scope. Used to gate derived-scope
   *  registration during listing. */
  private isWithinWriteScope(directoryId: string): boolean {
    if (this.writeScopeDirectoryIds.size === 0) {
      return true;
    }
    const normalized = directoryId.trim();
    if (!normalized) {
      return false;
    }
    return this.writeScopeDirectoryIds.has(normalized) || this.derivedScopeIds.has(normalized);
  }

  /**
   * 天翼 has NO confirmed parent-walk / breadcrumb endpoint, so we cannot verify a
   * write target by walking up to a scope root (quark's model). Instead we use
   * DERIVED SCOPE (光鸭's model): a write is allowed iff its target id is a
   * connect-time scope root (writeScopeDirectoryIds) OR a nested dir
   * find-or-created/discovered under an already-in-scope parent during this run
   * (derivedScopeIds). Empty scope (dev) allows everything. SYNCHRONOUS — no
   * network; callers do NOT await.
   *
   * Unlike 光鸭 (whose root directory id is the empty string "" and needs a
   * pre-normalize special case), 天翼's root id is "-11" — a normal non-empty
   * id — so every legitimate target survives normalizeId's throw-on-empty.
   */
  private assertWithinWriteScope(directoryId: string, action: string): string {
    const normalized = normalizeId(directoryId);
    if (this.writeScopeDirectoryIds.size === 0) {
      return normalized;
    }
    if (this.writeScopeDirectoryIds.has(normalized) || this.derivedScopeIds.has(normalized)) {
      return normalized;
    }
    throw new Error(
      `WRITE_SCOPE_VIOLATION: refusing to ${action} outside configured write scope; fileId=${normalized}`,
    );
  }
}

interface ParsedTianyiShare {
  shareCode: string;
  accessCode: string;
}

/** 天翼分享链两种形态:`cloud.189.cn/t/<code>[?accessCode=xx]` 与
 *  `cloud.189.cn/web/share?code=<code>[&accessCode=xx]`(pwd 亦作访问码参数)。
 *  Fragment is stripped BEFORE query parsing — `?accessCode=x8fd#frag` must
 *  yield "x8fd", not "x8fd#frag" (quark's parser gets this via its `[?#]`
 *  capture; here the split does it). */
export function parseTianyiShareUrl(url: string): ParsedTianyiShare | null {
  const noFragment = url.split("#")[0] ?? url;
  const t = /cloud\.189\.cn\/t\/([0-9a-zA-Z]+)/.exec(noFragment);
  if (t?.[1]) {
    const params = new URLSearchParams(noFragment.split("?")[1] ?? "");
    return { shareCode: t[1], accessCode: params.get("accessCode") ?? params.get("pwd") ?? "" };
  }
  const w = /cloud\.189\.cn\/web\/share\?[^#]*\bcode=([0-9a-zA-Z]+)/.exec(noFragment);
  if (w?.[1]) {
    const params = new URLSearchParams(noFragment.split("?")[1] ?? "");
    return { shareCode: w[1], accessCode: params.get("accessCode") ?? params.get("pwd") ?? "" };
  }
  return null;
}

function verifiedFileFromItem(
  item: TianyiItem,
  storageDirectoryId: string,
  videoExtensions: Set<string>,
): VerifiedFile | null {
  const name = nameOf(item);
  if (!isVideoName(name, videoExtensions)) {
    return null;
  }
  const providerFileId = idOf(item);
  if (!providerFileId) {
    return null;
  }
  return {
    id: providerFileId,
    storageDirectoryId,
    name,
    sizeBytes: sizeOf(item),
    episodeCode: episodeCodeFromFileName(name),
    providerFileId,
  };
}

function isDirectory(item: TianyiItem): boolean {
  return item.isFolder === true;
}

function idOf(item: TianyiItem): string {
  return item.id;
}

function nameOf(item: TianyiItem): string {
  return item.name;
}

function sizeOf(item: TianyiItem): number {
  return item.size;
}

function isVideoName(name: string, videoExtensions: Set<string>): boolean {
  const lower = name.toLowerCase();
  return [...videoExtensions].some((ext) => lower.endsWith(ext));
}

/** Basename of a listTree path ("Sub/dir/多余字幕.srt" → "多余字幕.srt"). */
function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function normalizeId(directoryId: string): string {
  const normalized = directoryId.trim();
  if (!normalized) {
    throw new Error("directoryId must not be empty");
  }
  return normalized;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}
