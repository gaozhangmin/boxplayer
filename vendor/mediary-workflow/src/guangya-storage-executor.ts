/**
 * 光鸭云盘 (GuangYaPan) StorageExecutor — the brand-3 analogue of
 * QuarkStorageExecutor / Storage115Executor, over GuangYaClient. Implements the
 * 12 StorageExecutor port methods. Mirrors the quark executor's structure;
 * only the brand-specific bits differ.
 *
 * Differences from quark:
 *  - 转存 is OFFLINE/磁力 (resolve_res → create_task → poll). This is the OPPOSITE
 *    of quark: a MAGNET works, a share link fails LOUD (GUANGYA_ONLY_MAGNET).
 *    Share-link 转存 is a phase-2 feature.
 *  - 光鸭 has NO parent-walk / breadcrumb API, so the write-scope guard CANNOT walk
 *    a target's parents the way quark does (quark hops up via getFileInfo). Instead
 *    the guard is DERIVED-SCOPE: the workflow always provisions the directory chain
 *    TOP-DOWN from a connect-time scope root (rootDir + Movies/TV/Anime) via
 *    createDirectory on THIS executor instance before any write. Real write targets
 *    are NESTED (transfer→TV/<Show>/staging-<runId>, moveFiles→Season NN), never a
 *    scope root. So each nested dir is authorized by being find-or-created under an
 *    already-in-scope parent during the same run, and its id is then tracked in
 *    `derivedScopeIds`. A write is allowed iff its target id is a scope root OR a
 *    derived id (empty scope = dev, allow all). See assertWithinWriteScope below.
 *  - A 光鸭 item is a directory when `resType === 2`; ids key on `fileId`, names on
 *    `fileName`, sizes on `fileSize`. Directory listing uses `listFiles(dirId)`.
 */
import type { PackageTreeFile, ResourceCandidate, TransferAttempt, TransferStatus, VerifiedFile } from "./domain.js";
import { episodeCodeFromFileName } from "./episode-code.js";
import { isGuangYaAuthError } from "./guangya-client.js";
import type { GuangYaResolvedRes, GuangYaTaskStatus } from "./guangya-client.js";
import type { StorageExecutor, UnparsedVideoFile } from "./ports.js";

const MAX_RECURSIVE_COLLECT_DEPTH = 6;
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

/** A directory-listing entry as the executor consumes it (mirrors GuangYaItem). */
export interface GuangYaStorageItem {
  fileId: string;
  parentId: string;
  fileName: string;
  fileSize: number;
  resType: number;
}

/**
 * The structural slice of GuangYaClient the executor depends on. resolveRes/listTask
 * reuse the SAME typed shapes the real GuangYaClient now returns (GuangYaResolvedRes /
 * GuangYaTaskStatus, imported from ./guangya-client.js), so `new GuangYaClient(...)`
 * is structurally assignable here with no runtime adapter. Tests inject a typed fake.
 */
export interface GuangYaStorageClient {
  listFiles(parentId: string): Promise<GuangYaStorageItem[]>;
  createDir(parentId: string, dirName: string): Promise<string>;
  renameFile(fileId: string, newName: string): Promise<void>;
  deleteFiles(fileIds: string[]): Promise<void>;
  moveFiles(fileIds: string[], parentId: string): Promise<void>;
  resolveRes(url: string): Promise<GuangYaResolvedRes>;
  createTask(input: {
    url: string;
    parentId: string;
    newName: string;
    fileIndexes?: number[];
  }): Promise<string>;
  listTask(taskIds: string[]): Promise<GuangYaTaskStatus[]>;
}

export interface GuangYaStorageExecutorOptions {
  client: GuangYaStorageClient;
  /** Directory fileIds inside which writes/deletes are allowed (the drive's scope
   *  roots: rootDir + Movies/TV/Anime). Empty = allow all (dev only). */
  writeScopeDirectoryIds?: string[];
  /** Directories that may never be removed (root + scope roots). NOTE: unlike
   *  quark these are NOT auto-blocked from recursive listing, because 光鸭's write
   *  target IS a scope dir and transfer must read it before/after. */
  protectedDirectoryIds?: string[];
  minVideoSizeBytes?: number;
  videoExtensions?: string[];
  /** Poll caps for an offline task (overridable so tests don't sleep). */
  taskPollMaxPolls?: number;
  taskPollIntervalMs?: number;
  /** Subtitle-landing poll caps (transferSubtitleUrl), SEPARATE from the video
   *  task caps above — the #85 lesson, relearned live on 光鸭 2026-07-02: a
   *  subtitle is ~100KB and lands in seconds or effectively never, so polling it
   *  on the video window (60×3s=180s) lets a few stuck assrt fetches silently
   *  burn ~9 minutes inside one transferSubtitle call (搏击俱乐部). Default
   *  16×3s≈48s, mirroring the 115 subtitle window budget. */
  subtitleTaskPollMaxPolls?: number;
  subtitleTaskPollIntervalMs?: number;
}

interface VideoFact {
  file: VerifiedFile;
  sourceDirectoryId: string;
  sizeBytes: number;
}

export class GuangYaStorageExecutor implements StorageExecutor {
  private readonly client: GuangYaStorageClient;
  private readonly writeScopeDirectoryIds: Set<string>;
  /** Ids of nested dirs find-or-created under an already-in-scope parent during this
   *  run. They become authorized write targets (光鸭 has no parent-walk API to verify
   *  them otherwise). Populated by createDirectory; consulted by assertWithinWriteScope. */
  private readonly derivedScopeIds = new Set<string>();
  private readonly protectedDirectoryIds: Set<string>;
  private readonly minVideoSizeBytes: number;
  private readonly videoExtensions: Set<string>;
  private readonly taskPollMaxPolls: number;
  private readonly taskPollIntervalMs: number;
  private readonly subtitleTaskPollMaxPolls: number;
  private readonly subtitleTaskPollIntervalMs: number;
  private nextTransferNumber = 1;

  constructor(options: GuangYaStorageExecutorOptions) {
    this.client = options.client;
    this.writeScopeDirectoryIds = new Set(options.writeScopeDirectoryIds ?? []);
    this.protectedDirectoryIds = new Set(["0", ...(options.protectedDirectoryIds ?? [])]);
    this.minVideoSizeBytes = options.minVideoSizeBytes ?? DEFAULT_MIN_VIDEO_SIZE_BYTES;
    this.videoExtensions = new Set(
      (options.videoExtensions ?? DEFAULT_VIDEO_EXTENSIONS).map((ext) => ext.toLowerCase()),
    );
    this.taskPollMaxPolls = options.taskPollMaxPolls ?? 60;
    this.taskPollIntervalMs = options.taskPollIntervalMs ?? 3000;
    this.subtitleTaskPollMaxPolls = options.subtitleTaskPollMaxPolls ?? 16;
    this.subtitleTaskPollIntervalMs = options.subtitleTaskPollIntervalMs ?? 3000;
  }

  async createDirectory(input: { name: string; parentId: string }): Promise<string> {
    const safeParentId = this.assertWithinWriteScope(input.parentId, "create directory");
    // Find-or-create: seasons of one title initialize at different times and must
    // land under the SAME show directory (光鸭 happily makes duplicate folders).
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
    const createdId = await this.client.createDir(safeParentId, input.name);
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
    await this.client.renameFile(input.fileId, input.newName);
  }

  async transfer(input: {
    workflowRunId: string;
    directoryId: string;
    candidate: ResourceCandidate;
  }): Promise<TransferAttempt> {
    const url = stringValue(input.candidate.providerPayload["url"]);
    const isMagnet =
      input.candidate.type === "magnet" || url.startsWith("magnet:") || url.startsWith("ed2k:");
    if (!isMagnet) {
      throw new Error(
        "GUANGYA_ONLY_MAGNET: 光鸭 v1 仅支持磁力/离线候选(分享链转存留 phase 2);请改用磁力候选",
      );
    }

    const safe = this.assertWithinWriteScope(input.directoryId, "transfer");
    const before = new Set((await this.listVideoFiles(safe)).map((f) => f.id));

    let providerMessage = "";
    try {
      const resolved = await this.client.resolveRes(url);
      const subs = resolved.btResInfo?.subfiles ?? [];
      const videoIndexes = subs
        .map((s, i) => ({ idx: s.fileIndex ?? i, name: s.fileName }))
        .filter((s) => isVideoName(s.name, this.videoExtensions))
        .map((s) => s.idx);
      const taskInput: Parameters<GuangYaStorageClient["createTask"]>[0] = {
        url: resolved.url || url,
        parentId: safe,
        newName: resolved.btResInfo?.fileName || "offline",
      };
      if (videoIndexes.length) {
        taskInput.fileIndexes = videoIndexes;
      }
      const taskId = await this.client.createTask(taskInput);
      await this.pollTask(taskId);
    } catch (error) {
      // Auth failures must surface so the worker freezes the drive — never absorbed.
      if (isGuangYaAuthError(error)) {
        throw error;
      }
      // Any other failure (dead/expired magnet, bad params) is a FAILED attempt
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
        (status === "no_target_change" ? "离线任务完成但目标目录未出现新视频" : ""),
      materializedFileIds,
    };
    this.nextTransferNumber += 1;
    return attempt;
  }

  /** Subtitle direct-link landing — the capability gate: this method existing is
   *  what lights the whole subtitle flow up for 光鸭 (orchestrator probes
   *  `typeof executor.transferSubtitleUrl === "function"`, zero other wiring).
   *  Probe-verified live 2026-07-02 (assrt srt → real drive): create_task accepts
   *  a plain http url directly (no resolve_res needed), RESPECTS newName for url
   *  tasks (the file lands under exactly that name), and the status-2 task row
   *  carries the landed fileId. So unlike 115 there is no before/after tree diff
   *  or basename matching — the task's own fileId IS the materialized file. We
   *  still confirm that fileId is really present in the target directory before
   *  reporting success (never trust a task row over the directory itself).
   *  光鸭 has no task-cancel endpoint in our client, so a timed-out task is
   *  reported as a soft no_target_change (failed is reserved for hard provider
   *  errors) and may still land late — the same soft late-landing semantics 115
   *  accepts when its unambiguous-cancel guard skips. */
  async transferSubtitleUrl(input: {
    url: string;
    filename: string;
    directoryId: string;
    workflowRunId: string;
  }): Promise<TransferAttempt> {
    // Boundary validation mirrors the 115 executor: the filename comes from an
    // EXTERNAL provider (assrt) and doubles as 光鸭's newName — a path-y name
    // would pollute the candidateId AND the landing name. Soft failure (attempt,
    // not throw); consume a counter slot so ids stay unique.
    if (/[\\/]/.test(input.filename)) {
      const invalidAttemptNumber = this.nextTransferNumber;
      this.nextTransferNumber += 1;
      return {
        id: `${input.workflowRunId}_subtitle_${invalidAttemptNumber}`,
        workflowRunId: input.workflowRunId,
        candidateId: `subtitle:invalid_name_${invalidAttemptNumber}`,
        status: "failed",
        providerMessage:
          "SUBTITLE_INVALID_FILENAME: filename must be a bare name without path separators (路径分隔符)",
        materializedFileIds: [],
      };
    }
    const safe = this.assertWithinWriteScope(input.directoryId, "transfer subtitle");
    const attemptNumber = this.nextTransferNumber;
    this.nextTransferNumber += 1;
    const candidateId = `subtitle:${input.filename}`;

    // Status semantics mirror the 115 subtitle path: `failed` is reserved for a
    // HARD provider error (create_task rejected, API error); a task that was
    // accepted but produced nothing in the target within the window is the soft
    // `no_target_change` — the same distinction transfer() draws.
    let hardErrorMessage = "";
    let softMissMessage = "";
    let materializedFileIds: string[] = [];
    try {
      const taskId = await this.client.createTask({
        url: input.url,
        parentId: safe,
        newName: input.filename,
      });
      const landedFileId = await this.pollTaskForFileId(
        taskId,
        this.subtitleTaskPollMaxPolls,
        this.subtitleTaskPollIntervalMs,
      );
      if (!landedFileId) {
        softMissMessage = "SUBTITLE_NOT_LANDED: 离线任务在轮询窗口内未落盘(任务可能迟到,不等)";
      } else if ((await this.client.listFiles(safe)).some((item) => idOf(item) === landedFileId)) {
        materializedFileIds = [landedFileId];
      } else {
        softMissMessage = "SUBTITLE_NOT_LANDED: 任务报告完成但 fileId 不在目标目录";
      }
    } catch (error) {
      // Auth failures must surface so the worker freezes the drive — never absorbed.
      if (isGuangYaAuthError(error)) {
        throw error;
      }
      hardErrorMessage = error instanceof Error ? error.message : String(error);
    }

    const status: TransferStatus = hardErrorMessage
      ? "failed"
      : materializedFileIds.length > 0
        ? "succeeded"
        : "no_target_change";
    return {
      id: `${input.workflowRunId}_subtitle_${attemptNumber}`,
      workflowRunId: input.workflowRunId,
      candidateId,
      status,
      providerMessage: hardErrorMessage || softMissMessage,
      materializedFileIds,
    };
  }

  async flattenDirectory(directoryId: string): Promise<{ moved: string[]; removed: string[] }> {
    const safeDirectoryId = this.assertWithinWriteScope(directoryId, "flatten directory");
    const videos = await this.collectVideos(safeDirectoryId, safeDirectoryId);
    const moveCandidates = videos.filter(
      (v) => v.sourceDirectoryId !== safeDirectoryId && v.sizeBytes >= this.minVideoSizeBytes,
    );
    const moved = moveCandidates.map((v) => v.file.providerFileId);
    if (moved.length > 0) {
      await this.client.moveFiles(moved, safeDirectoryId);
    }

    const rootItems = await this.client.listFiles(safeDirectoryId);
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
    const safe = this.assertWithinWriteScope(directoryId, "remove directory");
    if (this.protectedDirectoryIds.has(safe) || this.writeScopeDirectoryIds.has(safe)) {
      throw new Error(`SAFETY_VIOLATION: refusing to remove protected/root directory fileId=${safe}`);
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
      // removeDirectory can clear it. 光鸭's offline download creates wrapper subdirs
      // SERVER-SIDE (not via createDirectory), so without this the movie flatten's
      // removeDirectory(wrapper) hits WRITE_SCOPE_VIOLATION and leaves empty wrapper dirs
      // + non-video junk behind (TV is clean: discardStaging removes the createDirectory'd
      // staging dir wholesale). Listing an OUT-of-scope dir does NOT widen scope (read ≠
      // write); registration is gated on the parent already being in scope.
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
    await this.client.moveFiles(input.fileIds, safeTargetId);
    return { moved: input.fileIds };
  }

  async deleteFiles(input: { directoryId: string; fileIds: string[] }): Promise<{ deleted: string[] }> {
    if (input.fileIds.length === 0) {
      return { deleted: [] };
    }
    const safeDirectoryId = this.assertWithinWriteScope(input.directoryId, "delete files");
    await this.assertFilesBelongToDirectory(safeDirectoryId, input.fileIds);
    await this.client.deleteFiles(input.fileIds);
    return { deleted: input.fileIds };
  }

  /** Poll list_task until the task leaves the in-progress state or a cap is hit;
   *  returns the landed fileId ("" = did not land in the window).
   *  光鸭 list_task status (observed live 2026-06-27, Big Buck Bunny magnet → real
   *  account): 1 = in-progress/queued (fileId is ""), 2 = done (fileId is populated
   *  with the materialized dir/file id). The sequence seen was 1 → 2, with the file
   *  landing the same instant status flipped to 2. We treat status >= 2 as terminal
   *  AND break the moment a non-empty fileId materializes (the strongest "file landed"
   *  signal — it appears exactly at completion). 3 = FAILED ("云添加失败" in the
   *  光鸭 client; observed live 2026-07-02 — three stuck subtitle fetches sat at
   *  status 1 for 9+ minutes before the provider gave up and flipped them 1 → 3,
   *  so a task can be terminally dead while still reading as in-progress; codes up
   *  to 5 exist per statusCounts). status >= 2 breaks on all of them, so the
   *  caller's own landing check judges:
   *  transfer() diffs listVideoFiles before/after, transferSubtitleUrl verifies the
   *  returned fileId is present in the target directory. */
  private async pollTaskForFileId(taskId: string, maxPolls: number, intervalMs: number): Promise<string> {
    for (let i = 0; i < maxPolls; i++) {
      const tasks = await this.client.listTask([taskId]);
      const t = tasks.find((x) => x.taskId === taskId);
      if (!t) {
        return "";
      }
      if (t.fileId !== "" && t.fileId !== "0") {
        return t.fileId;
      }
      if (t.status >= 2) {
        return "";
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return "";
  }

  private async pollTask(taskId: string): Promise<void> {
    await this.pollTaskForFileId(taskId, this.taskPollMaxPolls, this.taskPollIntervalMs);
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
   *  deleting a subtitle impossible on every drive — caught live 2026-07-02 when
   *  the 黑客帝国3@光鸭 run's cleanup was refused twice (SAFETY_VIOLATION). */
  private async assertFilesBelongToDirectory(directoryId: string, fileIds: string[]): Promise<void> {
    const verified = new Set((await this.listTree({ directoryId })).map((f) => f.providerFileId));
    const unverified = fileIds.filter((id) => !verified.has(id));
    if (unverified.length === 0) {
      return;
    }
    throw new Error(
      "SAFETY_VIOLATION: refusing to delete unverified file ids from target directory; " +
        `fileId=${directoryId}; fileIds=${unverified.join(",")}`,
    );
  }

  /** Refuse recursive listing of root/protected dirs (huge scan / 风控 risk).
   *  Unlike quark, write-scope dirs are NOT auto-protected here (光鸭's write target
   *  IS a scope dir, and transfer must read it). */
  private assertSafeRecursiveListTarget(directoryId: string, action: string): string {
    const normalized = normalizeId(directoryId);
    if (this.protectedDirectoryIds.has(normalized)) {
      throw new Error(
        `SAFETY_VIOLATION: refusing to recursively ${action} protected directory fileId=${normalized}`,
      );
    }
    return normalized;
  }

  /**
   * 光鸭 has NO parent-walk / breadcrumb API, so we cannot verify a write target by
   * walking up to a scope root (the premise that "the target is always a scope-root
   * id" is FALSE — real targets are nested staging/Season dirs). Instead we use
   * DERIVED SCOPE: a write is allowed iff its target id is a connect-time scope root
   * (writeScopeDirectoryIds) OR a nested dir find-or-created under an already-in-scope
   * parent during this run (derivedScopeIds, populated by createDirectory). Empty
   * scope (dev) allows everything.
   */
  /** Non-throwing scope membership check (mirrors assertWithinWriteScope). Empty scope
   *  (dev) treats everything as in-scope; root "" is never a write target under a real
   *  scope. Used to gate derived-scope registration during listing. */
  private isWithinWriteScope(directoryId: string): boolean {
    if (this.writeScopeDirectoryIds.size === 0) {
      return true;
    }
    const trimmed = directoryId.trim();
    if (trimmed === "") {
      return false;
    }
    const normalized = normalizeId(directoryId);
    return this.writeScopeDirectoryIds.has(normalized) || this.derivedScopeIds.has(normalized);
  }

  private assertWithinWriteScope(directoryId: string, action: string): string {
    // 光鸭's ROOT directory id is the empty string "": create_dir / get_file_list with
    // parentId:"" operate on root (confirmed live). connect-time provisioning
    // (provisionCategoryDirs, empty write scope) creates the root category folder under
    // "" — so "" is a VALID parent for directory creation there and must NOT be pushed
    // through normalizeId's throw-on-empty. Handle the empty-scope (dev/connect) "allow
    // all" branch BEFORE normalizing, so root "" passes. With a non-empty (worker
    // runtime) scope, "" is never a legitimate write target (production writes go into
    // provisioned NESTED dirs); it falls through to a clean WRITE_SCOPE_VIOLATION below.
    const trimmed = directoryId.trim();
    if (this.writeScopeDirectoryIds.size === 0) {
      return trimmed;
    }
    const normalized = normalizeId(directoryId);
    if (this.writeScopeDirectoryIds.has(normalized) || this.derivedScopeIds.has(normalized)) {
      return normalized;
    }
    throw new Error(
      `WRITE_SCOPE_VIOLATION: refusing to ${action} outside configured write scope; fileId=${normalized}`,
    );
  }
}

function verifiedFileFromItem(
  item: GuangYaStorageItem,
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

function isDirectory(item: GuangYaStorageItem): boolean {
  return item.resType === 2;
}

function idOf(item: GuangYaStorageItem): string {
  return stringValue(item.fileId);
}

function nameOf(item: GuangYaStorageItem): string {
  return stringValue(item.fileName);
}

function sizeOf(item: GuangYaStorageItem): number {
  return numberValue(item.fileSize);
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
