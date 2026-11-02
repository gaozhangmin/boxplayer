import type { TransferAttempt } from "../domain.js";
import { parsePan123ShareUrl } from "../pan123-storage-executor.js";
import type { StorageExecutor } from "../ports.js";
import { parseQuarkShareUrl } from "../quark-storage-executor.js";
import { parseTianyiShareUrl } from "../tianyi-storage-executor.js";
import type { CandidateRegistry } from "./candidate-registry.js";
import { deadLinkKey, deadLinkReason, UNRESOLVED_MAGNET_DEAD_LINK_TTL_MS, type DeadLinkStore } from "./dead-links.js";
import type { SimTreeFile, StorageV2, TransferAttemptResult } from "./storage-115-simulator.js";

/**
 * Phase 6 — the real 115 executor as a StorageV2. It maps the V2 sandbox's tool
 * surface onto the fail-loud Storage115Executor: transfers resolve the candidate
 * from the shared registry (the agent only ever passes ids), and the executor's
 * own write-scope / protected-dir / risk-control guards stay in force underneath.
 */
const VIDEO_EXTENSIONS = /\.(mkv|mp4|avi|ts|m2ts|mov|flv|wmv)$/i;
const SUBTITLE_EXTENSIONS = /\.(srt|ass|ssa|sub|idx|vtt|sup|smi)$/i;
const PAN115_SHARE_URL = /^https?:\/\/(115\.com|115cdn\.com|anxia\.com)\/s\//i;

export interface RealStorageV2Options {
  executor: StorageExecutor;
  registry: CandidateRegistry;
  workflowRunId: string;
  /** When set, a transfer PROVEN dead (115 fail-loud / magnet-no-秒传) records the
   *  link so future PanSou searches filter it out before the agent sees it (#15). */
  deadLinkStore?: DeadLinkStore;
}

export class RealStorageV2 implements StorageV2 {
  private readonly executor: StorageExecutor;
  private readonly registry: CandidateRegistry;
  private readonly workflowRunId: string;
  private readonly deadLinkStore: DeadLinkStore | undefined;
  private readonly recordedAttempts: TransferAttempt[] = [];

  constructor(options: RealStorageV2Options) {
    this.executor = options.executor;
    this.registry = options.registry;
    this.workflowRunId = options.workflowRunId;
    this.deadLinkStore = options.deadLinkStore;
  }

  /** Every transfer attempt this run, for the workflow to persist. */
  attempts(): TransferAttempt[] {
    return [...this.recordedAttempts];
  }

  /** Classify a candidate's link from its recorded payload url: a fail-loud
   *  转存分享 (115/夸克/天翼/123 — a dead share errors back immediately) vs a
   *  magnet (silent — success only via the landing point) vs unknown.
   *  transferUntilLanded iterates ONLY "share" candidates (its loop is sound only
   *  when death is loud). Brand share shapes are delegated to each brand's OWN
   *  parser — the same one its executor transfers with — so this classifier can
   *  never drift from what actually transfers (no second domain list). */
  candidateLinkKind(candidateId: string): "share" | "magnet" | "unknown" {
    const url = String(this.registry.get(candidateId)?.providerPayload?.["url"] ?? "");
    if (
      PAN115_SHARE_URL.test(url) ||
      parseQuarkShareUrl(url) !== null ||
      parseTianyiShareUrl(url) !== null ||
      parsePan123ShareUrl(url) !== null
    ) {
      return "share";
    }
    if (/^magnet:/i.test(url)) return "magnet";
    return "unknown";
  }

  /** Record a link as dead when the attempt PROVES it (conservative — see
   *  deadLinkReason). No store, unkeyable url, or non-death outcome → no-op. */
  private async maybeRecordDeadLink(url: unknown, attempt: TransferAttempt): Promise<void> {
    if (!this.deadLinkStore) {
      return;
    }
    const identity = deadLinkKey(String(url ?? ""));
    if (!identity) {
      return;
    }
    const reason = deadLinkReason(attempt, identity.kind);
    if (reason === null) {
      return;
    }
    // A 115 share that fails loud is gone for good (permanent). A magnet is keyed
    // by infohash, whose deadness is time-variable (115 may cache it later, a clean
    // magnet for the same hash may appear) — so it is SOFT (TTL), never permanent.
    // An unresolvable magnet (115 showed the infohash as the name → no metadata, a
    // fake/dead torrent) gets a much longer soft TTL so we don't re-transfer junk.
    const permanent = identity.kind === "pan115";
    const ttlMs = !permanent && /name == infohash/.test(reason) ? UNRESOLVED_MAGNET_DEAD_LINK_TTL_MS : undefined;
    await this.deadLinkStore.recordDeadLink({
      key: identity.key,
      kind: identity.kind,
      reason,
      permanent,
      ...(ttlMs === undefined ? {} : { ttlMs }),
    });
  }

  async createDirectory(input: { name: string; parentId: string }): Promise<string> {
    return this.executor.createDirectory(input);
  }

  async transferCandidate(input: {
    candidateId: string;
    intoDirectoryId: string;
  }): Promise<TransferAttemptResult> {
    const candidate = this.registry.get(input.candidateId);
    if (!candidate) {
      throw new Error(
        `REAL_STORAGE_CANDIDATE_NOT_REGISTERED: ${input.candidateId} was never observed in a search this run`,
      );
    }
    const attempt = await this.executor.transfer({
      workflowRunId: this.workflowRunId,
      directoryId: input.intoDirectoryId,
      candidate,
    });
    this.recordedAttempts.push(attempt);
    await this.maybeRecordDeadLink(candidate.providerPayload?.["url"], attempt);
    // Only a real materialization counts as success; no_target_change (115 has no
    // cached copy) is a miss the agent must recover from, surfaced as failed +
    // an empty reread. Layer-1: surface providerMessage so the agent sees WHY.
    // The noTargetChange flag rides along so brand-agnostic callers can tell a
    // silent-late async copy (123 — possible FALSE miss) from a loud dead link.
    return {
      status: attempt.status === "succeeded" ? "succeeded" : "failed",
      materializedFileIds: attempt.materializedFileIds,
      ...(attempt.status === "no_target_change" ? { noTargetChange: true as const } : {}),
      ...(attempt.providerMessage ? { providerMessage: attempt.providerMessage } : {}),
    };
  }

  async transferSubtitleUrl(input: {
    url: string;
    filename: string;
    intoDirectoryId: string;
  }): Promise<TransferAttemptResult> {
    if (!this.executor.transferSubtitleUrl) {
      throw new Error("REAL_STORAGE_NO_SUBTITLE_SUPPORT: this storage brand has no transferSubtitleUrl");
    }
    const attempt = await this.executor.transferSubtitleUrl({
      url: input.url,
      filename: input.filename,
      directoryId: input.intoDirectoryId,
      // Run identity comes from THIS adapter instance — StorageV2 callers can't
      // (and shouldn't) override it, so the input carries no workflowRunId.
      workflowRunId: this.workflowRunId,
    });
    // Deliberately NOT recorded into recordedAttempts: those are the video-candidate
    // transfer trace, and validateWorkflowRunSnapshot requires every persisted
    // transferAttempt.candidateId to belong to a resource snapshot. A subtitle
    // attempt's synthetic `subtitle:<filename>` candidateId has no snapshot, so
    // persisting it would abort the whole run's snapshot save AFTER the video already
    // landed. Subtitles are a soft side-channel — kept out of the video trace.
    return {
      status: attempt.status === "succeeded" ? "succeeded" : "failed",
      materializedFileIds: attempt.materializedFileIds,
      ...(attempt.providerMessage ? { providerMessage: attempt.providerMessage } : {}),
    };
  }

  async listTree(input: { directoryId: string }): Promise<SimTreeFile[]> {
    const tree = await this.executor.listTree({ directoryId: input.directoryId });
    return tree.map((file) => ({
      id: file.providerFileId,
      path: file.path,
      sizeBytes: file.sizeBytes,
      isVideo: VIDEO_EXTENSIONS.test(file.path),
      isSubtitle: SUBTITLE_EXTENSIONS.test(file.path),
    }));
  }

  async listSubdirectories(input: { directoryId: string }): Promise<Array<{ id: string; path: string }>> {
    return this.executor.listSubdirectories({ directoryId: input.directoryId });
  }

  async moveFiles(input: { fileIds: string[]; targetDirectoryId: string }): Promise<{ moved: string[] }> {
    return this.executor.moveFiles(input);
  }

  async renameFile(input: { directoryId: string; fileId: string; newName: string }): Promise<void> {
    return this.executor.renameFile(input);
  }

  async deleteFiles(input: { directoryId: string; fileIds: string[] }): Promise<{ deleted: string[] }> {
    return this.executor.deleteFiles(input);
  }

  async removeDirectory(input: { directoryId: string }): Promise<{ removed: string[] }> {
    const result = await this.executor.removeDirectory(input.directoryId);
    return { removed: result.removed ? [input.directoryId] : [] };
  }
}
