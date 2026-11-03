import type {
  PackageTreeFile,
  ResourceCandidate,
  TransferAttempt,
  TransferStatus,
  VerifiedFile,
} from "./domain.js";
import { episodeCodeFromFileName } from "./episode-code.js";
import type { StorageExecutor, UnparsedVideoFile } from "./ports.js";

/**
 * Depth bound for the recursive video collectors, matching listTree's default.
 * Real media trees are shallow (Title/Season/files); a runaway-deep tree
 * (corrupt/adversarial) must not fan out into uncounted listItems calls and
 * trip 115 风控 — the walk stops here, same as listTree.
 */
const MAX_RECURSIVE_COLLECT_DEPTH = 6;

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

const DEFAULT_PAN115_RISK_PATTERNS = [
  /请求.*频繁/,
  /访问.*阻断/,
  /安全威胁/,
  /风控/,
  /频控/,
  /rate\s*limit/i,
  /too\s*many\s*requests/i,
  /throttl/i,
];

type Pan115Operation = keyof Pan115StorageApi;

export interface Pan115Item {
  id?: string | number;
  fid?: string | number;
  file_id?: string | number;
  cid?: string | number;
  name?: string;
  n?: string;
  size?: string | number;
  s?: string | number;
  fc?: string | number;
  isDirectory?: boolean;
}

export interface Pan115DirectoryInfo {
  state: boolean;
  path: Array<{
    cid?: string | number;
    name?: string;
  }>;
}

export interface Pan115ActionResult {
  ok: boolean;
  message: string;
  alreadyTransferred?: boolean;
  code?: number;
}

export interface Pan115OfflineTask {
  infoHash: string;
  name: string;
  /** 0–100; 0 with status "waiting"/"downloading" is a non-秒传 in-flight task. */
  percentDone: number;
  /** 115 status code (1=waiting, 2=downloading, 5/-1=failed, ...). */
  status: number;
  statusText: string;
  url: string;
}

export interface Pan115StorageApi {
  createFolder(input: { name: string; parentId: string }): Promise<string>;
  listItems(input: { directoryId: string }): Promise<Pan115Item[]>;
  getDirectoryInfo(input: { directoryId: string }): Promise<Pan115DirectoryInfo | null>;
  receiveShare(input: {
    shareCode: string;
    receiveCode: string;
    directoryId: string;
  }): Promise<Pan115ActionResult>;
  addOfflineTask(input: { url: string; directoryId: string }): Promise<Pan115ActionResult>;
  removeOfflineTask(input: { infoHashes: string[] }): Promise<Pan115ActionResult>;
  /** The account's current offline (cloud-download) tasks — `ac=task_lists`, a
   *  single plain-cookie GET. Used to read whether a queued task is a completed
   *  秒传 (don't cancel) or an in-flight real download (cancel). */
  listOfflineTasks(input?: { page?: number }): Promise<Pan115OfflineTask[]>;
  moveItems(input: { fileIds: string[]; targetDirectoryId: string }): Promise<Pan115ActionResult>;
  deleteItems(input: { fileIds: string[] }): Promise<Pan115ActionResult>;
  renameFile(input: { fileId: string; newName: string }): Promise<Pan115ActionResult>;
}

export interface Storage115ExecutorOptions {
  api: Pan115StorageApi;
  apiGuard?: Pan115ApiGuard;
  apiGuardOptions?: Pan115ApiGuardOptions;
  protectedDirectoryIds?: string[];
  writeScopeDirectoryIds?: string[];
  moviesDirectoryId?: string;
  minVideoSizeBytes?: number;
  videoExtensions?: string[];
  /** How many times to re-check the staging dir for an offline task's video. */
  offlineMaterializeAttempts?: number;
  /** Delay between offline-task materialization checks (ms). */
  offlineMaterializePollMs?: number;
  /** Subtitle-landing window (transferSubtitleUrl). Separate from the video
   *  window: that one only confirms a 秒传 cache hit (~8s), while a subtitle is
   *  a REAL server-side HTTP fetch whose queue latency varies — live e2e
   *  (2026-07-02, The Matrix) measured landings at ~20s and ~60s.
   *  Timing semantics: the first poll is immediate; sleeps happen only BETWEEN
   *  polls, so the effective wait ≈ (attempts - 1) × pollMs plus listTree time
   *  (defaults 8 & 6000ms → ~42s of sleeps). Worst-case listTree count is
   *  1 + attempts (the before/after-diff snapshot + each poll), so attempts
   *  bounds the 115 API spend per file. */
  subtitleMaterializeAttempts?: number;
  subtitleMaterializePollMs?: number;
  /** Injectable sleep (tests pass a fast/no-op). */
  sleep?: (ms: number) => Promise<void>;
}

export interface ProtectedStorage115ExecutorOptions {
  api: Pan115StorageApi;
  env?: Record<string, string | undefined>;
  apiGuard?: Pan115ApiGuard;
  apiGuardOptions?: Pan115ApiGuardOptions;
  minVideoSizeBytes?: number;
  videoExtensions?: string[];
  offlineMaterializeAttempts?: number;
  offlineMaterializePollMs?: number;
  subtitleMaterializeAttempts?: number;
  subtitleMaterializePollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type Pan115ApiGuardEventKind =
  | "delay"
  | "budget_exhausted"
  | "risk_detected"
  | "large_list"
  | "circuit_open";

export interface Pan115ApiGuardEvent {
  kind: Pan115ApiGuardEventKind;
  operation: Pan115Operation;
  message: string;
  delayMs?: number;
  callCount?: number;
}

export interface Pan115ApiGuardOptions {
  minDelayMs?: number;
  maxCallsPerOperation?: number;
  maxListItemsPerResponse?: number;
  riskMessagePatterns?: RegExp[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onEvent?: (event: Pan115ApiGuardEvent) => void;
}

export class Pan115RiskControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Pan115RiskControlError";
  }
}

export class Pan115ApiGuard {
  private readonly minDelayMs: number;
  private readonly maxCallsPerOperation: number;
  private readonly maxListItemsPerResponse: number;
  private readonly riskMessagePatterns: RegExp[];
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onEvent: (event: Pan115ApiGuardEvent) => void;
  private lastCallAt: number | null = null;
  private callCount = 0;
  private circuitOpenReason: string | null = null;

  constructor(options: Pan115ApiGuardOptions = {}) {
    this.minDelayMs = options.minDelayMs ?? 0;
    this.maxCallsPerOperation = options.maxCallsPerOperation ?? 80;
    // Matches the client's paginated stitch cap (DEFAULT_MAX_LIST_TOTAL=1000): the
    // client refuses dirs bigger than that, so a result above it is a real anomaly.
    this.maxListItemsPerResponse = options.maxListItemsPerResponse ?? 1000;
    this.riskMessagePatterns = options.riskMessagePatterns ?? DEFAULT_PAN115_RISK_PATTERNS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.onEvent = options.onEvent ?? (() => undefined);
  }

  /** Lifetime 115 API calls this guard has made — for per-step观测, not control. */
  callsSpent(): number {
    return this.callCount;
  }

  /** The HARD call budget: checked BEFORE each call, the guard refuses (throws
   *  Pan115RiskControlError) the next call once callCount has reached this value.
   *  Surfaced so the agent loop can derive its SOFT-warning threshold from the
   *  actually-configured limit instead of hardcoding a number. */
  callBudget(): number {
    return this.maxCallsPerOperation;
  }

  async run<T>(operation: Pan115Operation, call: () => Promise<T>): Promise<T> {
    this.assertCircuitClosed(operation);
    await this.applyDelay(operation);
    this.assertBudget(operation);
    this.callCount += 1;
    this.lastCallAt = this.now();

    try {
      const result = await call();
      this.inspectResult(operation, result);
      return result;
    } catch (error) {
      if (error instanceof Pan115RiskControlError) {
        throw error;
      }
      const message = errorMessage(error);
      if (isPan115RiskControlSignal(message, this.riskMessagePatterns)) {
        this.openCircuit(operation, message);
      }
      throw error;
    }
  }

  private assertCircuitClosed(operation: Pan115Operation): void {
    if (!this.circuitOpenReason) {
      return;
    }
    throw new Pan115RiskControlError(
      `PAN115_RATE_LIMIT: circuit breaker open before ${operation}: ${this.circuitOpenReason}`,
    );
  }

  private async applyDelay(operation: Pan115Operation): Promise<void> {
    if (this.minDelayMs <= 0 || this.lastCallAt === null) {
      return;
    }
    const elapsedMs = this.now() - this.lastCallAt;
    const delayMs = Math.max(0, this.minDelayMs - elapsedMs);
    if (delayMs <= 0) {
      return;
    }
    this.onEvent({
      kind: "delay",
      operation,
      delayMs,
      message: `waiting ${delayMs}ms before ${operation}`,
    });
    await this.sleep(delayMs);
  }

  private assertBudget(operation: Pan115Operation): void {
    if (this.callCount < this.maxCallsPerOperation) {
      return;
    }
    const message = `PAN115_RATE_LIMIT: API call budget exhausted before ${operation}; ` +
      `maxCallsPerOperation=${this.maxCallsPerOperation}`;
    this.onEvent({
      kind: "budget_exhausted",
      operation,
      callCount: this.callCount,
      message,
    });
    throw new Pan115RiskControlError(message);
  }

  private inspectResult(operation: Pan115Operation, result: unknown): void {
    if (operation === "listItems" && Array.isArray(result) && result.length > this.maxListItemsPerResponse) {
      this.openCircuit(
        operation,
        `listItems returned ${result.length} items, above maxListItemsPerResponse=${this.maxListItemsPerResponse}`,
        "large_list",
      );
    }

    const actionResult = pan115ActionResultLike(result);
    if (!actionResult) {
      return;
    }
    if (
      actionResult.code === 429 ||
      isPan115RiskControlSignal(actionResult.message, this.riskMessagePatterns)
    ) {
      this.openCircuit(operation, actionResult.message || `115 returned code ${actionResult.code}`);
    }
  }

  private openCircuit(
    operation: Pan115Operation,
    reason: string,
    kind: Pan115ApiGuardEventKind = "risk_detected",
  ): never {
    this.circuitOpenReason = reason;
    this.onEvent({
      kind,
      operation,
      message: reason,
      callCount: this.callCount,
    });
    this.onEvent({
      kind: "circuit_open",
      operation,
      message: reason,
      callCount: this.callCount,
    });
    throw new Pan115RiskControlError(`PAN115_RATE_LIMIT: ${reason}`);
  }
}

interface VideoFact {
  file: VerifiedFile;
  sourceDirectoryId: string;
  sizeBytes: number;
}

export class Storage115Executor implements StorageExecutor {
  private readonly api: Pan115StorageApi;
  private readonly protectedDirectoryIds: Set<string>;
  private readonly writeScopeDirectoryIds: Set<string>;
  private readonly moviesDirectoryId: string | null;
  private readonly minVideoSizeBytes: number;
  private readonly videoExtensions: Set<string>;
  private readonly apiGuard: Pan115ApiGuard;
  private readonly offlineMaterializeAttempts: number;
  private readonly offlineMaterializePollMs: number;
  private readonly subtitleMaterializeAttempts: number;
  private readonly subtitleMaterializePollMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private nextTransferNumber = 1;

  constructor(options: Storage115ExecutorOptions) {
    this.api = options.api;
    this.apiGuard = options.apiGuard ?? new Pan115ApiGuard(options.apiGuardOptions);
    this.protectedDirectoryIds = new Set(["0", ...(options.protectedDirectoryIds ?? [])]);
    this.writeScopeDirectoryIds = new Set(options.writeScopeDirectoryIds ?? []);
    this.moviesDirectoryId = options.moviesDirectoryId ?? null;
    this.minVideoSizeBytes = options.minVideoSizeBytes ?? 10 * 1024 * 1024;
    this.videoExtensions = new Set(
      (options.videoExtensions ?? DEFAULT_VIDEO_EXTENSIONS).map((extension) => extension.toLowerCase()),
    );
    // A 秒传 hit (115 already has the resource cached) reflects in the target dir
    // within a few seconds. This window only confirms that — it is NOT a wait for
    // an actual offline download. A magnet survey on the real test root measured
    // live 秒传s landing at up to ~4.3s, so the base window must reach ~8s (4×2s)
    // or ~20% of good magnets would be mis-judged dead. If nothing lands in this
    // span, 115 has no cached copy and the caller switches candidates.
    this.offlineMaterializeAttempts = options.offlineMaterializeAttempts ?? 4;
    this.offlineMaterializePollMs = options.offlineMaterializePollMs ?? 2000;
    // Subtitles are NOT 秒传 confirmations — they are real server-side HTTP
    // fetches with queue latency. Live e2e (The Matrix, 2026-07-02) measured
    // one landing at ~20s and one at ~60s (the 8s video window mis-judged it
    // no_target_change and the file dropped in late). 8 attempts sleep only
    // BETWEEN polls (7 gaps × 6s ≈ 42s + listing time) — covers the common
    // case while bounding poll cost (each poll = one depth-2 listTree).
    this.subtitleMaterializeAttempts = options.subtitleMaterializeAttempts ?? 8;
    this.subtitleMaterializePollMs = options.subtitleMaterializePollMs ?? 6000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Cumulative 115 API calls so far — surfaced into the agent trace AND used to
   *  drive the agent loop's budget soft-warning. */
  apiCallCount(): number {
    return this.apiGuard.callsSpent();
  }

  /** The configured HARD call budget — the agent loop derives its SOFT-warning
   *  threshold from this so the two stay consistent when the limit is overridden. */
  apiCallBudget(): number {
    return this.apiGuard.callBudget();
  }

  async createDirectory(input: { name: string; parentId: string }): Promise<string> {
    const safeParentId = await this.assertWithinWriteScope(input.parentId, "create directory");
    // Find-or-create: seasons of one title initialize at different times and
    // must land under the SAME show directory; 115 happily creates duplicate
    // same-name folders otherwise.
    const items = await this.callApi("listItems", () => this.api.listItems({ directoryId: safeParentId }));
    for (const item of items) {
      if (isDirectory(item) && itemName(item) === input.name) {
        const existingId = directoryIdFromItem(item);
        if (existingId) {
          return existingId;
        }
      }
    }
    return this.callApi("createFolder", () => this.api.createFolder({ ...input, parentId: safeParentId }));
  }

  async listVideoFiles(directoryId: string): Promise<VerifiedFile[]> {
    const safe = this.assertSafeRecursiveListTarget(directoryId, "list videos in");
    const videos = await this.collectVideos(safe, safe);
    return videos.map((video) => video.file);
  }

  async listUnparsedVideoFiles(directoryId: string): Promise<UnparsedVideoFile[]> {
    const safe = this.assertSafeRecursiveListTarget(directoryId, "list unparsed videos in");
    return this.collectUnparsedVideos(safe);
  }

  async renameFile(input: { directoryId: string; fileId: string; newName: string }): Promise<void> {
    await this.assertWithinWriteScope(input.directoryId, "rename file");
    const result = await this.callApi("renameFile", () =>
      this.api.renameFile({ fileId: input.fileId, newName: input.newName }),
    );
    if (!result.ok) {
      throw new Error(`PAN115_RENAME_FAILED: ${result.message}`);
    }
  }

  async transfer(input: {
    workflowRunId: string;
    directoryId: string;
    candidate: ResourceCandidate;
  }): Promise<TransferAttempt> {
    const safeDirectoryId = await this.assertWithinWriteScope(input.directoryId, "transfer");
    const before = new Set((await this.listVideoFiles(safeDirectoryId)).map((file) => file.id));
    const action = await this.executeCandidateTransfer(input.candidate, safeDirectoryId);

    // Offline tasks (magnets/ed2k): a 秒传 hit means 115 ALREADY has the
    // resource cached, so it reflects in the staging dir within a second or two
    // of acceptance. Briefly confirm that — probing the tree by video EXTENSION
    // (movies have no SxxExx). If nothing lands in this short window, 115 has no
    // cached copy and would have to truly download it; we do NOT wait for that —
    // transferStatus stays no_target_change and the workflow switches to the
    // next candidate, hunting for one that can 秒传. (115 share receives are
    // synchronous, so this only applies to offline tasks.)
    const offlineInfoHash = isOfflineTaskCandidate(input.candidate)
      ? infoHashFromMagnet(stringValue(input.candidate.providerPayload["url"]))
      : null;
    // Did 115 report the task as a COMPLETED 秒传? Then a not-yet-listed file is
    // just a lagging directory index, NOT a failure — so we extend the grace and
    // must not cancel it (the bug the wall-clock-only window had).
    let offlineTaskComplete = false;
    // 115 showing the raw infohash as the task NAME means it could not resolve any
    // metadata (no peers) — a fake or thoroughly-dead torrent. Captured so the
    // dead-link recorder can give it a much longer (still non-permanent) TTL.
    let nameIsInfohash = false;
    if (action.ok && isOfflineTaskCandidate(input.candidate)) {
      let remaining = this.offlineMaterializeAttempts;
      let extendedForCompletion = false;
      while (remaining > 0) {
        if (await this.stagingTreeHasVideo(safeDirectoryId)) {
          break; // file landed → 秒传 confirmed by the dir
        }
        if (offlineInfoHash) {
          const task = await this.findOfflineTask(offlineInfoHash);
          if (task) {
            if (!offlineTaskComplete && (/成功|完成/.test(task.statusText) || task.percentDone >= 100)) offlineTaskComplete = true;
            if (task.name.trim().toLowerCase() === offlineInfoHash) nameIsInfohash = true;
          }
        }
        if (offlineTaskComplete && !extendedForCompletion) {
          // One-time grace extension for a confirmed 秒传 whose listing is slow;
          // a real (still-downloading) task never reaches here, so it isn't
          // extended — keeps the 115 call budget bounded (≤ 2× attempts).
          remaining += this.offlineMaterializeAttempts;
          extendedForCompletion = true;
        }
        await this.sleep(this.offlineMaterializePollMs);
        remaining -= 1;
      }
    }

    const after = await this.listVideoFiles(safeDirectoryId);
    const materializedFileIds = after
      .filter((file) => !before.has(file.id))
      .map((file) => file.id);
    const status = transferStatus(action, materializedFileIds);

    // Non-秒传 offline task: 115 had no cached copy, so it queued a real
    // download we never wait for. Cancel it (`task_del`) to free the offline
    // quota and not leave junk tasks behind. Best-effort — never fail the
    // transfer over cleanup. NEVER cancel: an `alreadyTransferred` result
    // ("任务已存在", 115 refusing a duplicate of a PRIOR task), nor a task 115
    // reports as a COMPLETED 秒传 (its file is merely slow to list).
    if (
      status !== "succeeded" &&
      !action.alreadyTransferred &&
      !offlineTaskComplete &&
      isOfflineTaskCandidate(input.candidate)
    ) {
      if (offlineInfoHash) {
        try {
          await this.callApi("removeOfflineTask", () =>
            this.api.removeOfflineTask({ infoHashes: [offlineInfoHash] }),
          );
        } catch {
          // Cleanup is best-effort; the transfer outcome stands regardless.
        }
      }
    }
    const providerMessage = transferMessage(input.candidate, action, status, offlineTaskComplete, nameIsInfohash);

    const attempt: TransferAttempt = {
      // Scope the id to the run: the per-executor counter resets when the worker
      // process restarts, so a bare `transfer_N` collides across runs on the
      // global transfer_attempts.id primary key. The run id makes it unique.
      id: `${input.workflowRunId}_transfer_${this.nextTransferNumber}`,
      workflowRunId: input.workflowRunId,
      candidateId: input.candidate.id,
      status,
      providerMessage,
      materializedFileIds,
    };
    this.nextTransferNumber += 1;
    return attempt;
  }

  /** Subtitle direct-link landing: submit the http url as a 115 offline task
   *  (115's lixianssp add_task_url accepts http/https/ftp/magnet/ed2k), then
   *  confirm the named file landed by reading listTree (NOT listVideoFiles —
   *  subtitle extensions are invisible to that path). Mirrors transfer()'s
   *  offline-task materialization window, but matches by FILE NAME instead of
   *  by video extension diff. */
  async transferSubtitleUrl(input: {
    url: string;
    filename: string;
    directoryId: string;
    workflowRunId: string;
  }): Promise<TransferAttempt> {
    // Boundary validation: the filename comes from an EXTERNAL provider (assrt).
    // A path-y name like "subdir/file.ass" would pollute the synthetic
    // candidateId and make the listTree endsWith-match ambiguous — reject it
    // before spending any API call. Soft failure (attempt, not throw): the
    // sandbox counts it like any other landing failure.
    if (/[\\/]/.test(input.filename)) {
      // Consume a number even for guard-rejected calls (same "one number per
      // call" invariant as every other attempt) so ids stay unique; keep the
      // raw filename OUT of the candidateId — it's exactly what pollutes ids.
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
    const safeDirectoryId = await this.assertWithinWriteScope(input.directoryId, "transfer subtitle");
    // Mirror transfer(): one number consumed per call from the SHARED transfer
    // counter (video transfers advance it too, so the suffix reflects the run's
    // overall attempt order, not a subtitle-only sequence), unconditionally — a
    // failed subtitle attempt burns a slot just like a failed transfer does, so
    // subsequent ids never collide.
    const attemptNumber = this.nextTransferNumber;
    this.nextTransferNumber += 1;
    const candidateId = `subtitle:${input.filename}`;

    // Landing detection is a BEFORE/AFTER diff (mirroring transfer()'s
    // materialization diff): only a same-named file that APPEARS after the task
    // was submitted counts. Matching a pre-existing file (an earlier attempt's
    // leftover with the same name) would report success for a transfer that
    // landed nothing. Match by exact basename — endsWith("/name") could be
    // satisfied by a same-named file in any wrapper dir, which is intended, but
    // exact basename keeps it unambiguous.
    const basenameMatches = (path: string): boolean => path.split("/").pop() === input.filename;
    const beforeIds = new Set(
      (await this.listTree({ directoryId: safeDirectoryId, maxDepth: 2 }))
        .filter((file) => basenameMatches(file.path))
        .map((file) => file.providerFileId),
    );

    const action = await this.callApi("addOfflineTask", () =>
      this.api.addOfflineTask({ url: input.url, directoryId: safeDirectoryId }),
    );
    if (!action.ok) {
      return {
        id: `${input.workflowRunId}_subtitle_${attemptNumber}`,
        workflowRunId: input.workflowRunId,
        candidateId,
        status: "failed",
        providerMessage: action.message,
        materializedFileIds: [],
      };
    }

    let remaining = this.subtitleMaterializeAttempts;
    let materializedFileIds: string[] = [];
    while (remaining > 0) {
      // maxDepth: 2 bounds the per-poll API fan-out (listTree recurses + lists each
      // subdir; the default depth-6 could explode calls on a big staging tree). A 115
      // offline task lands the file directly under the target dir OR one wrapper level
      // down, so depth 2 catches both while staying cheap.
      const tree = await this.listTree({ directoryId: safeDirectoryId, maxDepth: 2 });
      const hit = tree.find(
        (file) => basenameMatches(file.path) && !beforeIds.has(file.providerFileId),
      );
      if (hit) {
        materializedFileIds = [hit.providerFileId];
        break;
      }
      remaining -= 1;
      if (remaining > 0) await this.sleep(this.subtitleMaterializePollMs);
    }

    // Nothing materialized in the window: 115 queued a real background download we
    // will not wait for. Best-effort cancel it (task_del) so it can't drop the file
    // into staging AFTER the workflow moves on, and so it doesn't tie up offline-task
    // quota — mirroring transfer()'s non-秒传 cleanup. The HTTP subtitle url has no
    // infoHash up front, so resolve the queued task by matching its url in the task
    // list, then remove it by the infoHash 115 assigned. Only cancel on an UNAMBIGUOUS
    // single match — if the account-wide list has zero or multiple tasks for this url
    // (e.g. a stale task from a prior run), skip rather than risk cancelling the wrong
    // task. Never fail the attempt over cleanup.
    if (materializedFileIds.length === 0) {
      try {
        const tasks = await this.callApi("listOfflineTasks", () => this.api.listOfflineTasks());
        const matches = tasks.filter((task) => task.url === input.url && task.infoHash);
        if (matches.length === 1) {
          await this.callApi("removeOfflineTask", () =>
            this.api.removeOfflineTask({ infoHashes: [matches[0]!.infoHash] }),
          );
        }
      } catch {
        // best-effort cleanup — a failed cancel must never fail the subtitle attempt
      }
    }

    const status: TransferStatus =
      materializedFileIds.length > 0 ? "succeeded" : "no_target_change";
    return {
      id: `${input.workflowRunId}_subtitle_${attemptNumber}`,
      workflowRunId: input.workflowRunId,
      candidateId,
      status,
      providerMessage:
        status === "succeeded"
          ? ""
          : "subtitle offline task accepted but file did not materialize in window",
      materializedFileIds,
    };
  }

  async flattenDirectory(directoryId: string): Promise<{ moved: string[]; removed: string[] }> {
    const safeDirectoryId = await this.assertSafeFlattenTarget(directoryId);
    await this.assertWithinWriteScope(safeDirectoryId, "flatten directory");
    const videos = await this.collectVideos(safeDirectoryId, safeDirectoryId);
    const moveCandidates = videos.filter(
      (video) => video.sourceDirectoryId !== safeDirectoryId && video.sizeBytes >= this.minVideoSizeBytes,
    );
    const moved = moveCandidates.map((video) => video.file.providerFileId);
    if (moved.length > 0) {
      const result = await this.callApi("moveItems", () =>
        this.api.moveItems({
          fileIds: moved,
          targetDirectoryId: safeDirectoryId,
        }),
      );
      if (!result.ok) {
        return { moved: [], removed: [] };
      }
    }

    const rootItems = await this.callApi("listItems", () => this.api.listItems({ directoryId: safeDirectoryId }));
    const removableDirectoryIds: string[] = [];
    for (const item of rootItems) {
      if (!isDirectory(item)) {
        continue;
      }
      const childDirectoryId = directoryIdFromItem(item);
      if (!childDirectoryId) {
        continue;
      }
      if (!(await this.directoryContainsLargeVideo(childDirectoryId))) {
        removableDirectoryIds.push(childDirectoryId);
      }
    }
    if (removableDirectoryIds.length > 0) {
      const result = await this.callApi("deleteItems", () =>
        this.api.deleteItems({ fileIds: removableDirectoryIds }),
      );
      if (!result.ok) {
        return { moved, removed: [] };
      }
    }

    return { moved, removed: removableDirectoryIds };
  }

  async removeDirectory(directoryId: string): Promise<{ removed: boolean }> {
    const safe = await this.assertWithinWriteScope(directoryId, "remove directory");
    // Only ephemeral sub-directories may be removed. Refuse the write-scope
    // roots, any protected directory, and the movies parent — deleting one of
    // those would wipe a whole library tree.
    if (
      this.protectedDirectoryIds.has(safe) ||
      this.writeScopeDirectoryIds.has(safe) ||
      (this.moviesDirectoryId !== null && safe === this.moviesDirectoryId)
    ) {
      throw new Error(`SAFETY_VIOLATION: refusing to remove protected/root directory cid=${safe}`);
    }
    const result = await this.callApi("deleteItems", () => this.api.deleteItems({ fileIds: [safe] }));
    return { removed: result.ok };
  }

  async listTree(input: { directoryId: string; maxDepth?: number }): Promise<PackageTreeFile[]> {
    const safeRoot = this.assertSafeRecursiveListTarget(input.directoryId, "walk the tree of");
    const maxDepth = input.maxDepth ?? 6;
    const results: PackageTreeFile[] = [];
    const walk = async (directoryId: string, prefix: string, depth: number): Promise<void> => {
      if (depth > maxDepth) {
        return;
      }
      const items = await this.callApi("listItems", () => this.api.listItems({ directoryId }));
      for (const item of items) {
        const name = itemName(item);
        if (isDirectory(item)) {
          const childId = directoryIdFromItem(item);
          if (childId) {
            await walk(childId, `${prefix}${name}/`, depth + 1);
          }
          continue;
        }
        const providerFileId = fileIdFromItem(item);
        if (!providerFileId) {
          continue;
        }
        results.push({
          path: `${prefix}${name}`,
          providerFileId,
          sizeBytes: numberValue(item.size ?? item.s),
        });
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
    const walk = async (directoryId: string, prefix: string, depth: number): Promise<void> => {
      if (depth > maxDepth) {
        return;
      }
      const items = await this.callApi("listItems", () => this.api.listItems({ directoryId }));
      for (const item of items) {
        if (!isDirectory(item)) {
          continue;
        }
        const childId = directoryIdFromItem(item);
        if (!childId) {
          continue;
        }
        const path = `${prefix}${itemName(item)}`;
        results.push({ id: childId, path });
        await walk(childId, `${path}/`, depth + 1);
      }
    };
    await walk(safeRoot, "", 1);
    return results;
  }

  async listChildDirectories(directoryId: string): Promise<Array<{ id: string; name: string }>> {
    // ONE non-recursive /files listing of the immediate children — safe on the
    // account root/parent dirs (no recursive fan-out, so not subject to the
    // assertSafeRecursiveListTarget guard). Used by find-or-create provisioning.
    const items = await this.callApi("listItems", () => this.api.listItems({ directoryId }));
    const dirs: Array<{ id: string; name: string }> = [];
    for (const item of items) {
      if (!isDirectory(item)) {
        continue;
      }
      const id = directoryIdFromItem(item);
      if (id) {
        dirs.push({ id, name: itemName(item) });
      }
    }
    return dirs;
  }

  async moveFiles(input: { fileIds: string[]; targetDirectoryId: string }): Promise<{ moved: string[] }> {
    if (input.fileIds.length === 0) {
      return { moved: [] };
    }
    const safeTargetId = await this.assertWithinWriteScope(input.targetDirectoryId, "move files into");
    const result = await this.callApi("moveItems", () =>
      this.api.moveItems({ fileIds: input.fileIds, targetDirectoryId: safeTargetId }),
    );
    return { moved: result.ok ? input.fileIds : [] };
  }

  async deleteFiles(input: { directoryId: string; fileIds: string[] }): Promise<{ deleted: string[] }> {
    if (input.fileIds.length === 0) {
      return { deleted: [] };
    }
    const safeDirectoryId = await this.assertWithinWriteScope(input.directoryId, "delete files");
    await this.assertFilesBelongToDirectory(safeDirectoryId, input.fileIds);
    const result = await this.callApi("deleteItems", () => this.api.deleteItems({ fileIds: input.fileIds }));
    return { deleted: result.ok ? input.fileIds : [] };
  }

  /** Has any video-extension file landed in the staging tree yet? Used to wait
   *  out an offline task's asynchronous materialization (episode-agnostic, so it
   *  works for movies too). */
  private async stagingTreeHasVideo(directoryId: string): Promise<boolean> {
    const tree = await this.listTree({ directoryId });
    return tree.some((file) => isVideoName(file.path, this.videoExtensions));
  }

  /**
   * Whether 115 reports this offline task as a completed 秒传. The reliable signal
   * is the statusText — measured on the real test root, a 秒传 reports
   * statusText "下载成功" (success) while percentDone STAYS 0 the whole time, and a
   * dead/no-cache task sits at "等待中" (waiting) / a real download at "下载中".
   * So percentDone is useless here; we key on the success text (keeping
   * percentDone>=100 only as a belt-and-suspenders for any "完成" reporting). A
   * still-waiting/downloading/failed task is NOT complete → false, so the caller
   * stops waiting and cancels it. Best-effort: a failed probe returns false.
   */
  private async findOfflineTask(infoHash: string): Promise<Pan115OfflineTask | null> {
    let tasks;
    try {
      tasks = await this.callApi("listOfflineTasks", () => this.api.listOfflineTasks());
    } catch {
      return null;
    }
    const wanted = infoHash.toLowerCase();
    return tasks.find((entry) => entry.infoHash.toLowerCase() === wanted) ?? null;
  }

  private async executeCandidateTransfer(
    candidate: ResourceCandidate,
    directoryId: string,
  ): Promise<Pan115ActionResult> {
    const url = stringValue(candidate.providerPayload["url"]);
    if (!url) {
      return { ok: false, message: "candidate providerPayload.url is required" };
    }

    if (isOfflineTaskUrl(url)) {
      return this.callApi("addOfflineTask", () => this.api.addOfflineTask({ url, directoryId }));
    }

    if (url.startsWith("https://115.com/s/") || url.startsWith("https://115cdn.com/s/")) {
      const parsed = parseShareUrl(url);
      if (!parsed) {
        return { ok: false, message: "invalid 115 share link" };
      }
      const payloadPassword = stringValue(candidate.providerPayload["password"]);
      return this.callApi("receiveShare", () =>
        this.api.receiveShare({
          shareCode: parsed.shareCode,
          receiveCode: payloadPassword || parsed.receiveCode,
          directoryId,
        }),
      );
    }

    return { ok: false, message: `unsupported 115 transfer url: ${url.slice(0, 50)}` };
  }

  /**
   * Code fence for recursive directory reads. `listVideoFiles`/`listTree` walk
   * a directory tree and were written to dig media out of nested package
   * folders — pointing them at a root/parent/category directory would scan a
   * huge subtree and risk a 115 rate-limit lockout. They are ONLY ever valid on
   * a leaf (a season or movie directory). Refuse anything protected, and refuse
   * the empty/root cid (normalizeDirectoryId throws on empty).
   */
  private assertSafeRecursiveListTarget(directoryId: string, action: string): string {
    const normalized = normalizeDirectoryId(directoryId);
    if (this.protectedDirectoryIds.has(normalized)) {
      throw new Error(
        `SAFETY_VIOLATION: refusing to recursively ${action} protected directory cid=${normalized}; ` +
          "root/parent/category directories are never valid targets for recursive listing (115 rate-limit risk)",
      );
    }
    return normalized;
  }

  private async assertSafeFlattenTarget(directoryId: string): Promise<string> {
    const normalized = normalizeDirectoryId(directoryId);
    if (this.protectedDirectoryIds.has(normalized)) {
      throw new Error(`SAFETY_VIOLATION: refusing to flatten protected directory cid=${normalized}`);
    }

    const info = await this.callApi("getDirectoryInfo", () => this.api.getDirectoryInfo({ directoryId: normalized }));
    if (!info?.state) {
      throw new Error(`SAFETY_VIOLATION: unable to verify flatten target cid=${normalized}`);
    }

    const pathNames = info.path.map((part) => stringValue(part.name)).filter((name) => name.length > 0);
    const pathIds = info.path.map((part) => stringValue(part.cid)).filter((cid) => cid.length > 0);
    const joinedPath = pathNames.length > 0 ? pathNames.join("/") : "(unknown)";
    if (pathNames.length < 3) {
      throw new Error(
        "SAFETY_VIOLATION: flatten target must be a movie leaf or season leaf directory; " +
          `path=${joinedPath}`,
      );
    }

    const leafName = pathNames[pathNames.length - 1] ?? "";
    if (/^Season\s+\d+$/i.test(leafName)) {
      return normalized;
    }

    const parentId = pathIds[pathIds.length - 2] ?? "";
    const parentName = pathNames[pathNames.length - 2] ?? "";
    const isMovieLeaf = Boolean(this.moviesDirectoryId && parentId === this.moviesDirectoryId);
    const isMovieNameFallback = parentName === "Movies" && pathNames.length >= 4;
    if (!isMovieLeaf && !isMovieNameFallback) {
      throw new Error(
        "SAFETY_VIOLATION: flatten target must be a movie leaf under MOVIES_CID " +
          "or end with 'Season <number>'; " +
          `path=${joinedPath}`,
      );
    }

    return normalized;
  }

  /** Verify against the FULL tree (listTree), not listVideoFiles: the agent's
   *  eyes (inspectStaging/inspectTargetDir) see every file, and cleanup targets
   *  are mostly NON-video (extra subtitles, ads, nfo). Verifying videos-only made
   *  deleting a subtitle impossible on every drive — caught live 2026-07-02 on
   *  光鸭, and explains the `._*.ass` AppleDouble leftover from the 黑客帝国2@115
   *  stress test. */
  private async assertFilesBelongToDirectory(directoryId: string, fileIds: string[]): Promise<void> {
    const verifiedFileIds = new Set((await this.listTree({ directoryId })).map((file) => file.providerFileId));
    const unverifiedFileIds = fileIds.filter((fileId) => !verifiedFileIds.has(fileId));
    if (unverifiedFileIds.length === 0) {
      return;
    }
    throw new Error(
      "SAFETY_VIOLATION: refusing to delete unverified file ids from target directory; " +
        `cid=${directoryId}; fileIds=${unverifiedFileIds.join(",")}`,
    );
  }

  private async assertWithinWriteScope(directoryId: string, action: string): Promise<string> {
    const normalized = normalizeDirectoryId(directoryId);
    if (this.writeScopeDirectoryIds.size === 0) {
      return normalized;
    }
    if (this.writeScopeDirectoryIds.has(normalized)) {
      return normalized;
    }

    const info = await this.callApi("getDirectoryInfo", () => this.api.getDirectoryInfo({ directoryId: normalized }));
    if (!info?.state) {
      throw new Error(
        `WRITE_SCOPE_VIOLATION: unable to verify ${action} target cid=${normalized}`,
      );
    }
    const pathIds = info.path.map((part) => stringValue(part.cid)).filter((cid) => cid.length > 0);
    const pathNames = info.path.map((part) => stringValue(part.name)).filter((name) => name.length > 0);
    const joinedPath = pathNames.length > 0 ? pathNames.join("/") : "(unknown)";
    if (!pathIds.some((cid) => this.writeScopeDirectoryIds.has(cid))) {
      throw new Error(
        `WRITE_SCOPE_VIOLATION: refusing to ${action} outside configured write scope; ` +
          `cid=${normalized}; path=${joinedPath}`,
      );
    }

    return normalized;
  }

  private async directoryContainsLargeVideo(directoryId: string): Promise<boolean> {
    const videos = await this.collectVideos(directoryId, directoryId);
    return videos.some((video) => video.sizeBytes >= this.minVideoSizeBytes);
  }

  private async collectVideos(
    rootDirectoryId: string,
    currentDirectoryId: string,
    depth = 1,
  ): Promise<VideoFact[]> {
    if (depth > MAX_RECURSIVE_COLLECT_DEPTH) {
      return [];
    }
    const items = await this.callApi("listItems", () => this.api.listItems({ directoryId: currentDirectoryId }));
    const videos: VideoFact[] = [];
    for (const item of items) {
      if (isDirectory(item)) {
        const childDirectoryId = directoryIdFromItem(item);
        if (childDirectoryId) {
          videos.push(...(await this.collectVideos(rootDirectoryId, childDirectoryId, depth + 1)));
        }
        continue;
      }

      const file = verifiedFileFromItem(item, rootDirectoryId, this.videoExtensions);
      if (file) {
        videos.push({
          file,
          sourceDirectoryId: currentDirectoryId,
          sizeBytes: file.sizeBytes,
        });
      }
    }
    return videos;
  }

  private async collectUnparsedVideos(directoryId: string, depth = 1): Promise<UnparsedVideoFile[]> {
    if (depth > MAX_RECURSIVE_COLLECT_DEPTH) {
      return [];
    }
    const items = await this.callApi("listItems", () => this.api.listItems({ directoryId }));
    const unparsed: UnparsedVideoFile[] = [];
    for (const item of items) {
      if (isDirectory(item)) {
        const childDirectoryId = directoryIdFromItem(item);
        if (childDirectoryId) {
          unparsed.push(...(await this.collectUnparsedVideos(childDirectoryId, depth + 1)));
        }
        continue;
      }
      const name = itemName(item);
      if (!isVideoName(name, this.videoExtensions) || episodeCodeFromFileName(name) !== null) {
        continue;
      }
      const providerFileId = fileIdFromItem(item);
      if (!providerFileId) {
        continue;
      }
      unparsed.push({ providerFileId, name, sizeBytes: numberValue(item.size ?? item.s) });
    }
    return unparsed;
  }

  private async callApi<T>(operation: Pan115Operation, call: () => Promise<T>): Promise<T> {
    return this.apiGuard.run(operation, call);
  }
}

export function createProtectedStorage115Executor(
  options: ProtectedStorage115ExecutorOptions,
): Storage115Executor {
  const env = options.env ?? process.env;
  const testRootDirectoryId = optionalDirectoryId(env["MEDIA_TRACK_115_TEST_ROOT_CID"]);
  const explicitWriteScopeDirectoryIds = directoryIdList(env["MEDIA_TRACK_115_WRITE_SCOPE_CIDS"]);
  const writeScopeDirectoryIds =
    explicitWriteScopeDirectoryIds.length > 0
      ? explicitWriteScopeDirectoryIds
      : testRootDirectoryId
        ? [testRootDirectoryId]
        : [];

  if (writeScopeDirectoryIds.length === 0) {
    throw new Error(
      "MEDIA_TRACK_115_WRITE_SCOPE_REQUIRED: set MEDIA_TRACK_115_TEST_ROOT_CID " +
        "for development or MEDIA_TRACK_115_WRITE_SCOPE_CIDS for explicit live writes",
    );
  }

  const protectedDirectoryIds = uniqueDirectoryIds([
    testRootDirectoryId,
    env["CLAWD_MEDIA_ROOT_CID"],
    env["MOVIES_CID"],
    env["TV_SHOWS_CID"],
    env["ANIME_CID"],
    ...directoryIdList(env["MEDIA_TRACK_115_PROTECTED_CIDS"]),
  ]);

  const executorOptions: Storage115ExecutorOptions = {
    api: options.api,
    writeScopeDirectoryIds,
    protectedDirectoryIds,
    ...optionalExecutorOptions(options, env),
  };
  if (options.apiGuard) {
    executorOptions.apiGuard = options.apiGuard;
  } else {
    // The call budget is a lifetime backstop against runaway loops, not a
    // per-second rate limit; pacing comes from minDelayMs. The default must
    // accommodate a legitimate full-season batch: ~24 share receives plus
    // recursive post-transfer verification listings.
    executorOptions.apiGuardOptions = {
      minDelayMs: positiveIntFromEnv(env["MEDIA_TRACK_115_MIN_DELAY_MS"]) ?? 1_200,
      // HARD limit (throws Pan115RiskControlError) — default 300, configurable here.
      // The agent gets a SOFT wrap-up warning earlier, at
      // budgetSoftThreshold(maxCallsPerOperation) (= that value minus a fixed
      // headroom) via the agent loop, so its own markObtained/
      // discardStaging cleanup still fits before the hard stop. Override-safe: the
      // soft threshold is derived from this value, never hardcoded.
      maxCallsPerOperation: positiveIntFromEnv(env["MEDIA_TRACK_115_MAX_API_CALLS"]) ?? 300,
      maxListItemsPerResponse: 1000,
      ...options.apiGuardOptions,
    };
  }

  return new Storage115Executor(executorOptions);
}

export function isPan115RiskControlSignal(message: string, patterns = DEFAULT_PAN115_RISK_PATTERNS): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

function optionalExecutorOptions(
  options: ProtectedStorage115ExecutorOptions,
  env: Record<string, string | undefined>,
): Partial<Storage115ExecutorOptions> {
  const executorOptions: Partial<Storage115ExecutorOptions> = {};
  const moviesDirectoryId = optionalDirectoryId(env["MOVIES_CID"]);
  if (moviesDirectoryId) {
    executorOptions.moviesDirectoryId = moviesDirectoryId;
  }
  if (options.minVideoSizeBytes !== undefined) {
    executorOptions.minVideoSizeBytes = options.minVideoSizeBytes;
  }
  if (options.videoExtensions !== undefined) {
    executorOptions.videoExtensions = options.videoExtensions;
  }
  if (options.offlineMaterializeAttempts !== undefined) {
    executorOptions.offlineMaterializeAttempts = options.offlineMaterializeAttempts;
  }
  if (options.offlineMaterializePollMs !== undefined) {
    executorOptions.offlineMaterializePollMs = options.offlineMaterializePollMs;
  }
  if (options.subtitleMaterializeAttempts !== undefined) {
    executorOptions.subtitleMaterializeAttempts = options.subtitleMaterializeAttempts;
  }
  if (options.subtitleMaterializePollMs !== undefined) {
    executorOptions.subtitleMaterializePollMs = options.subtitleMaterializePollMs;
  }
  if (options.sleep !== undefined) {
    executorOptions.sleep = options.sleep;
  }
  return executorOptions;
}

function positiveIntFromEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`MEDIA_TRACK_115_GUARD_OPTION_INVALID: expected a positive integer, got "${value}"`);
  }
  return parsed;
}

function directoryIdList(value: string | undefined): string[] {
  return uniqueDirectoryIds((value ?? "").split(","));
}

function uniqueDirectoryIds(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = optionalDirectoryId(value);
    if (normalized) {
      seen.add(normalized);
    }
  }
  return [...seen];
}

function optionalDirectoryId(value: string | undefined | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function pan115ActionResultLike(value: unknown): Pan115ActionResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const maybeResult = value as Partial<Pan115ActionResult>;
  if (typeof maybeResult.ok !== "boolean") {
    return null;
  }
  const result: Pan115ActionResult = {
    ok: maybeResult.ok,
    message: typeof maybeResult.message === "string" ? maybeResult.message : "",
  };
  if (maybeResult.alreadyTransferred !== undefined) {
    result.alreadyTransferred = maybeResult.alreadyTransferred;
  }
  if (maybeResult.code !== undefined) {
    result.code = maybeResult.code;
  }
  return result;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "";
}

function transferStatus(action: Pan115ActionResult, materializedFileIds: string[]): TransferStatus {
  if (!action.ok) {
    return action.alreadyTransferred ? "no_target_change" : "failed";
  }
  return materializedFileIds.length > 0 ? "succeeded" : "no_target_change";
}

/** Offline-task (cloud-download) urls — magnets land asynchronously, unlike a
 *  synchronous 115 share receive, so they get a materialization grace window. */
function isOfflineTaskUrl(url: string): boolean {
  return url.startsWith("magnet:?xt=urn:btih:");
}

function isOfflineTaskCandidate(candidate: ResourceCandidate): boolean {
  return isOfflineTaskUrl(stringValue(candidate.providerPayload["url"]));
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decode a 32-char RFC4648 base32 btih into its 40-char lowercase hex form
 *  (160 bits → 20 bytes). Null if any char is outside the alphabet. */
function base32InfoHashToHex(base32: string): string | null {
  let bits = "";
  for (const char of base32.toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      return null;
    }
    bits += index.toString(2).padStart(5, "0");
  }
  let hex = "";
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    hex += parseInt(bits.slice(offset, offset + 8), 2).toString(16).padStart(2, "0");
  }
  return hex;
}

/** The btih info_hash (lowercase hex) from a magnet uri — 115 keys offline tasks
 *  by it, so it is what `task_del` needs to cancel one and `task_lists` to look
 *  one up. Accepts both the 40-char hex and the 32-char base32 btih encodings.
 *  Null only for non-magnet / malformed links. */
export function infoHashFromMagnet(url: string): string | null {
  const match = /xt=urn:btih:([A-Za-z0-9]+)/.exec(url);
  const raw = match?.[1];
  if (!raw) {
    return null;
  }
  if (/^[A-Fa-f0-9]{40}$/.test(raw)) {
    return raw.toLowerCase();
  }
  if (/^[A-Za-z2-7]{32}$/.test(raw)) {
    return base32InfoHashToHex(raw)?.toLowerCase() ?? null;
  }
  return null;
}

function transferMessage(
  candidate: ResourceCandidate,
  action: Pan115ActionResult,
  status: TransferStatus,
  offlineTaskComplete: boolean,
  nameIsInfohash: boolean,
): string {
  // A CONFIRMED 秒传 (115 reported 下载成功) whose file merely lagged the listing
  // window is ALIVE, not dead — say so explicitly so the dead-link recorder never
  // poisons it (deadLinkReason whitelists 下载成功).
  if (candidate.type === "magnet" && status === "no_target_change" && offlineTaskComplete) {
    return "115 秒传 confirmed (下载成功); file listing lagging";
  }
  // 115 showed the infohash as the task name → it resolved NO metadata (no peers):
  // a fake or thoroughly-dead torrent. Signal it so the recorder gives it a long
  // (still non-permanent) dead-link TTL.
  if (candidate.type === "magnet" && status === "no_target_change" && nameIsInfohash) {
    return "offline task unresolved (name == infohash); likely fake/dead, no target materialized";
  }
  if (action.message) {
    if (candidate.type === "magnet" && status === "no_target_change") {
      return `${action.message}; no target video materialized yet`;
    }
    return action.message;
  }
  if (candidate.type === "magnet" && status === "no_target_change") {
    return "offline task accepted; no target video materialized yet";
  }
  if (status === "no_target_change") {
    return "transfer accepted; no target video materialized yet";
  }
  return "";
}

function parseShareUrl(url: string): { shareCode: string; receiveCode: string } | null {
  const match = /\/s\/([A-Za-z0-9]+)(?:\?([^#]+))?/.exec(url);
  if (!match?.[1]) {
    return null;
  }
  const params = new URLSearchParams(match[2] ?? "");
  return {
    shareCode: match[1],
    receiveCode: params.get("password") ?? "",
  };
}

function verifiedFileFromItem(
  item: Pan115Item,
  storageDirectoryId: string,
  videoExtensions: Set<string>,
): VerifiedFile | null {
  const name = itemName(item);
  // A file is a video by its media EXTENSION alone — not by exposing an episode
  // code. Movies carry no SxxExx; they are still videos. The episode code is
  // optional metadata (null when the name reveals none).
  if (!isVideoName(name, videoExtensions)) {
    return null;
  }
  const providerFileId = fileIdFromItem(item);
  if (!providerFileId) {
    return null;
  }
  return {
    id: providerFileId,
    storageDirectoryId,
    name,
    sizeBytes: numberValue(item.size ?? item.s),
    episodeCode: episodeCodeFromFileName(name),
    providerFileId,
  };
}

function isDirectory(item: Pan115Item): boolean {
  if (item.isDirectory !== undefined) {
    return item.isDirectory;
  }
  if (item.fc === "0" || item.fc === 0) {
    return true;
  }
  return item.cid !== undefined && item.fid === undefined && item.file_id === undefined;
}

function directoryIdFromItem(item: Pan115Item): string {
  return stringValue(item.cid ?? item.id);
}

function fileIdFromItem(item: Pan115Item): string {
  return stringValue(item.fid ?? item.file_id ?? item.id);
}

function itemName(item: Pan115Item): string {
  return stringValue(item.name ?? item.n);
}

function isVideoName(name: string, videoExtensions: Set<string>): boolean {
  const lower = name.toLowerCase();
  return Array.from(videoExtensions).some((extension) => lower.endsWith(extension));
}

function normalizeDirectoryId(directoryId: string): string {
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
