import type {
  PackageTreeFile,
  ResourceCandidate,
  ResourceSnapshot,
  TransferAttempt,
  VerifiedFile,
} from "./domain.js";

export interface ResourceProvider {
  /**
   * `workflowRunId`, when given, namespaces the returned snapshot/candidate ids
   * to that run. Content-hashing providers (PanSou) otherwise yield the SAME id
   * for identical results across runs, so a re-acquisition collides on the
   * global resource_snapshots primary key and the second run's snapshot is lost
   * — the same reason transfer-attempt ids are run-scoped.
   */
  search(input: { keyword: string; workflowRunId?: string }): Promise<ResourceSnapshot>;
}

/** A video file whose name exposes no episode identity — invisible to verification until rescued. */
export interface UnparsedVideoFile {
  providerFileId: string;
  name: string;
  sizeBytes: number;
}

export interface StorageExecutor {
  createDirectory(input: { name: string; parentId: string }): Promise<string>;
  listVideoFiles(directoryId: string): Promise<VerifiedFile[]>;
  /** Video files in the directory whose names expose no parseable episode code. */
  listUnparsedVideoFiles(directoryId: string): Promise<UnparsedVideoFile[]>;
  /** Rename a single file in place (same directory). */
  renameFile(input: { directoryId: string; fileId: string; newName: string }): Promise<void>;
  transfer(input: {
    workflowRunId: string;
    directoryId: string;
    candidate: ResourceCandidate;
  }): Promise<TransferAttempt>;
  flattenDirectory(directoryId: string): Promise<{ moved: string[]; removed: string[] }>;
  deleteFiles(input: { directoryId: string; fileIds: string[] }): Promise<{ deleted: string[] }>;
  /** Remove an ephemeral directory (e.g. a staging dir) and everything under it.
   *  Refuses protected/root/parent directories — only sub-directories inside the
   *  write scope may be removed. */
  removeDirectory(directoryId: string): Promise<{ removed: boolean }>;
  /** Path-preserving recursive snapshot of a staging directory (all files, not just videos). */
  listTree(input: { directoryId: string; maxDepth?: number }): Promise<PackageTreeFile[]>;
  /** Recursive subdirectories under a directory (path relative to it) — the source
   *  of the wrapper-dir handle the flatten step removes. */
  listSubdirectories(input: { directoryId: string; maxDepth?: number }): Promise<Array<{ id: string; path: string }>>;
  /** Immediate child directories (one level, NOT recursive) — safe on root/parent
   *  dirs (single listing, no rate-limit fan-out). Used by find-or-create dir
   *  provisioning, which must read the children of an account root. */
  listChildDirectories(directoryId: string): Promise<Array<{ id: string; name: string }>>;
  /** Move files (by provider file id) into a target directory inside the write scope. */
  moveFiles(input: { fileIds: string[]; targetDirectoryId: string }): Promise<{ moved: string[] }>;
  /** Cumulative 115 API calls made so far — feeds the per-step trace AND the agent
   *  loop's budget soft-warning. Optional: only the real 115 executor implements it;
   *  fakes/sims omit it. */
  apiCallCount?(): number;
  /** The configured HARD 115 call budget — lets the agent loop derive its SOFT
   *  warning threshold from the real limit. Optional (real 115 executor only). */
  apiCallBudget?(): number;
  /** Subtitle direct-link landing. Submits the http url as a drive offline task
   *  and confirms the named file landed via listTree (NOT listVideoFiles —
   *  subtitle extensions are invisible to that path). Optional AND the
   *  capability gate: the orchestrator enables the whole subtitle flow iff this
   *  method exists on the executor (today only 115 implements it; implementing
   *  it on 光鸭/夸克 lights subtitles up there with zero other wiring). */
  transferSubtitleUrl?(input: {
    url: string;
    filename: string;
    directoryId: string;
    workflowRunId: string;
  }): Promise<TransferAttempt>;
}
