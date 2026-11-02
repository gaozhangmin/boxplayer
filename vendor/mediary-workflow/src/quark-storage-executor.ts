/**
 * Quark StorageExecutor — the brand-2 analogue of Storage115Executor, over
 * QuarkCookieClient. Implements the 12 StorageExecutor port methods.
 *
 * Differences from 115:
 *  - 转存 is a share-link chain (token→detail→save→poll). There is NO magnet/
 *    offline web API on quark, so a magnet candidate fails LOUD (QUARK_NO_MAGNET)
 *    instead of being attempted.
 *  - Quark has no one-shot breadcrumb, so the write-scope guard walks pdir_fid up
 *    (getFileInfo per hop, ≤ maxWriteScopeDepth) until it reaches a scope root.
 *  - A quark item is a directory when `dir === true`; files and dirs both key on `fid`.
 */
import type { PackageTreeFile, ResourceCandidate, TransferAttempt, TransferStatus, VerifiedFile } from "./domain.js";
import { episodeCodeFromFileName } from "./episode-code.js";
import type { StorageExecutor, UnparsedVideoFile } from "./ports.js";
import { isQuarkAuthError, type QuarkCookieClient, type QuarkItem } from "./quark-cookie-client.js";

const MAX_RECURSIVE_COLLECT_DEPTH = 6;
const DEFAULT_MAX_WRITE_SCOPE_DEPTH = 8;
const DEFAULT_MIN_VIDEO_SIZE_BYTES = 10 * 1024 * 1024;

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

export interface QuarkStorageExecutorOptions {
  client: QuarkCookieClient;
  /** Directory fids inside which writes/deletes are allowed (the drive's scope
   *  roots: rootCid + Movies/TV/Anime). Empty = allow all (dev only). */
  writeScopeDirectoryIds?: string[];
  /** Directories that may never be removed or recursively listed (root + scope roots). */
  protectedDirectoryIds?: string[];
  minVideoSizeBytes?: number;
  videoExtensions?: string[];
  maxWriteScopeDepth?: number;
}

interface VideoFact {
  file: VerifiedFile;
  sourceDirectoryId: string;
  sizeBytes: number;
}

export class QuarkStorageExecutor implements StorageExecutor {
  private readonly client: QuarkCookieClient;
  private readonly writeScopeDirectoryIds: Set<string>;
  private readonly protectedDirectoryIds: Set<string>;
  private readonly minVideoSizeBytes: number;
  private readonly videoExtensions: Set<string>;
  private readonly maxWriteScopeDepth: number;
  private nextTransferNumber = 1;

  constructor(options: QuarkStorageExecutorOptions) {
    this.client = options.client;
    this.writeScopeDirectoryIds = new Set(options.writeScopeDirectoryIds ?? []);
    this.protectedDirectoryIds = new Set([
      "0",
      ...(options.protectedDirectoryIds ?? []),
      ...(options.writeScopeDirectoryIds ?? []),
    ]);
    this.minVideoSizeBytes = options.minVideoSizeBytes ?? DEFAULT_MIN_VIDEO_SIZE_BYTES;
    this.videoExtensions = new Set(
      (options.videoExtensions ?? DEFAULT_VIDEO_EXTENSIONS).map((ext) => ext.toLowerCase()),
    );
    this.maxWriteScopeDepth = options.maxWriteScopeDepth ?? DEFAULT_MAX_WRITE_SCOPE_DEPTH;
  }

  async createDirectory(input: { name: string; parentId: string }): Promise<string> {
    const safeParentId = await this.assertWithinWriteScope(input.parentId, "create directory");
    // Find-or-create: seasons of one title initialize at different times and must
    // land under the SAME show directory (quark happily makes duplicate folders).
    const items = await this.client.listItems({ directoryId: safeParentId });
    for (const item of items) {
      if (isDirectory(item) && nameOf(item) === input.name) {
        const existingId = idOf(item);
        if (existingId) {
          return existingId;
        }
      }
    }
    return this.client.createFolder({ name: input.name, parentId: safeParentId });
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
    await this.assertWithinWriteScope(input.directoryId, "rename file");
    await this.client.renameFile({ fid: input.fileId, name: input.newName });
  }

  async transfer(input: {
    workflowRunId: string;
    directoryId: string;
    candidate: ResourceCandidate;
  }): Promise<TransferAttempt> {
    const url = stringValue(input.candidate.providerPayload["url"]);
    // Magnet has no web API on quark — fail LOUD so the caller never thinks a
    // magnet "could have" worked; it must pick a quark share-link candidate.
    if (input.candidate.type === "magnet" || url.startsWith("magnet:")) {
      throw new Error("QUARK_NO_MAGNET: 夸克网盘不支持磁力链接转存(无 web 离线 API);请改用夸克分享链候选");
    }

    const safeDirectoryId = await this.assertWithinWriteScope(input.directoryId, "transfer");
    const before = new Set((await this.listVideoFiles(safeDirectoryId)).map((f) => f.id));

    let providerMessage = "";
    try {
      const parsed = parseQuarkShareUrl(url);
      if (!parsed) {
        throw new Error(`QUARK_TRANSFER_FAILED: unparseable quark share url: ${url.slice(0, 60)}`);
      }
      const passcode = stringValue(input.candidate.providerPayload["password"]) || parsed.passcode;
      const stoken = await this.client.getShareToken({ pwd_id: parsed.pwdId, passcode });
      const shareItems = await this.client.listShareDetail({ pwd_id: parsed.pwdId, stoken, pdirFid: "0" });
      const fidList = shareItems.map((i) => stringValue(i.fid)).filter(Boolean);
      const fidTokenList = shareItems.map((i) => stringValue(i.share_fid_token)).filter(Boolean);
      if (fidList.length === 0) {
        throw new Error("QUARK_TRANSFER_FAILED: share has no transferable files");
      }
      const taskId = await this.client.saveShare({
        fid_list: fidList,
        fid_token_list: fidTokenList,
        to_pdir_fid: safeDirectoryId,
        pwd_id: parsed.pwdId,
        stoken,
      });
      await this.client.pollTask(taskId);
    } catch (error) {
      // Auth failures must surface so the worker freezes the drive — never absorbed.
      if (isQuarkAuthError(error)) {
        throw error;
      }
      // Any other failure (dead/expired share, bad params) is a FAILED attempt
      // with a loud message; the agent moves to the next candidate.
      providerMessage = error instanceof Error ? error.message : String(error);
    }

    const after = await this.listVideoFiles(safeDirectoryId);
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
    const safeDirectoryId = await this.assertWithinWriteScope(directoryId, "flatten directory");
    const videos = await this.collectVideos(safeDirectoryId, safeDirectoryId);
    const moveCandidates = videos.filter(
      (v) => v.sourceDirectoryId !== safeDirectoryId && v.sizeBytes >= this.minVideoSizeBytes,
    );
    const moved = moveCandidates.map((v) => v.file.providerFileId);
    if (moved.length > 0) {
      await this.client.moveFiles({ fids: moved, to: safeDirectoryId });
    }

    const rootItems = await this.client.listItems({ directoryId: safeDirectoryId });
    const removableDirectoryIds: string[] = [];
    for (const item of rootItems) {
      if (!isDirectory(item)) {
        continue;
      }
      const childId = idOf(item);
      if (!childId) {
        continue;
      }
      if (!(await this.directoryContainsLargeVideo(childId))) {
        removableDirectoryIds.push(childId);
      }
    }
    if (removableDirectoryIds.length > 0) {
      await this.client.deleteFiles(removableDirectoryIds);
    }
    return { moved, removed: removableDirectoryIds };
  }

  async removeDirectory(directoryId: string): Promise<{ removed: boolean }> {
    const safe = await this.assertWithinWriteScope(directoryId, "remove directory");
    if (this.protectedDirectoryIds.has(safe)) {
      throw new Error(`SAFETY_VIOLATION: refusing to remove protected/root directory fid=${safe}`);
    }
    await this.client.deleteFiles([safe]);
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
      const items = await this.client.listItems({ directoryId: dirId });
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
      const items = await this.client.listItems({ directoryId: dirId });
      for (const item of items) {
        if (!isDirectory(item)) {
          continue;
        }
        const childId = idOf(item);
        if (!childId) {
          continue;
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
    const items = await this.client.listItems({ directoryId });
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
    const safeTargetId = await this.assertWithinWriteScope(input.targetDirectoryId, "move files into");
    await this.client.moveFiles({ fids: input.fileIds, to: safeTargetId });
    return { moved: input.fileIds };
  }

  async deleteFiles(input: { directoryId: string; fileIds: string[] }): Promise<{ deleted: string[] }> {
    if (input.fileIds.length === 0) {
      return { deleted: [] };
    }
    const safeDirectoryId = await this.assertWithinWriteScope(input.directoryId, "delete files");
    await this.assertFilesBelongToDirectory(safeDirectoryId, input.fileIds);
    await this.client.deleteFiles(input.fileIds);
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
    const items = await this.client.listItems({ directoryId: currentId });
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
    const items = await this.client.listItems({ directoryId });
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
   *  光鸭 (黑客帝国3 cleanup refused twice). */
  private async assertFilesBelongToDirectory(directoryId: string, fileIds: string[]): Promise<void> {
    const verified = new Set((await this.listTree({ directoryId })).map((f) => f.providerFileId));
    const unverified = fileIds.filter((id) => !verified.has(id));
    if (unverified.length === 0) {
      return;
    }
    throw new Error(
      "SAFETY_VIOLATION: refusing to delete unverified file ids from target directory; " +
        `fid=${directoryId}; fileIds=${unverified.join(",")}`,
    );
  }

  /** Refuse recursive listing of root/scope-root dirs (huge scan / 风控 risk). */
  private assertSafeRecursiveListTarget(directoryId: string, action: string): string {
    const normalized = normalizeId(directoryId);
    if (this.protectedDirectoryIds.has(normalized)) {
      throw new Error(
        `SAFETY_VIOLATION: refusing to recursively ${action} protected directory fid=${normalized}`,
      );
    }
    return normalized;
  }

  /**
   * Walk pdir_fid up from the target until a write-scope root is reached. The
   * target itself being a scope root counts. Quark has no breadcrumb endpoint, so
   * this is N getFileInfo calls (N = tree depth, ≤ maxWriteScopeDepth). Empty
   * scope (dev) allows everything.
   */
  private async assertWithinWriteScope(directoryId: string, action: string): Promise<string> {
    const normalized = normalizeId(directoryId);
    if (this.writeScopeDirectoryIds.size === 0) {
      return normalized;
    }
    if (this.writeScopeDirectoryIds.has(normalized)) {
      return normalized;
    }
    let cursor = normalized;
    for (let depth = 0; depth < this.maxWriteScopeDepth; depth++) {
      let info;
      try {
        info = await this.client.getFileInfo(cursor);
      } catch (error) {
        if (isQuarkAuthError(error)) {
          throw error;
        }
        throw new Error(`WRITE_SCOPE_VIOLATION: unable to verify ${action} target fid=${normalized}`);
      }
      const parent = info.pdir_fid;
      if (!parent || parent === "0") {
        break;
      }
      if (this.writeScopeDirectoryIds.has(parent)) {
        return normalized;
      }
      cursor = parent;
    }
    throw new Error(
      `WRITE_SCOPE_VIOLATION: refusing to ${action} outside configured write scope; fid=${normalized}`,
    );
  }
}

interface ParsedQuarkShare {
  pwdId: string;
  passcode: string;
}

/** `https://pan.quark.cn/s/<pwd_id>[?passcode=xxx]` → its pwd_id + passcode. */
export function parseQuarkShareUrl(url: string): ParsedQuarkShare | null {
  const match = /pan\.quark\.cn\/s\/([0-9a-zA-Z]+)(?:[?#]([^#]*))?/.exec(url);
  if (!match?.[1]) {
    return null;
  }
  const params = new URLSearchParams(match[2] ?? "");
  return { pwdId: match[1], passcode: params.get("passcode") ?? params.get("pwd") ?? "" };
}

function verifiedFileFromItem(
  item: QuarkItem,
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

function isDirectory(item: QuarkItem): boolean {
  return item.dir === true;
}

function idOf(item: QuarkItem): string {
  return stringValue(item.fid);
}

function nameOf(item: QuarkItem): string {
  return stringValue(item.file_name);
}

function sizeOf(item: QuarkItem): number {
  return numberValue(item.size);
}

function isVideoName(name: string, videoExtensions: Set<string>): boolean {
  const lower = name.toLowerCase();
  return [...videoExtensions].some((ext) => lower.endsWith(ext));
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

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
