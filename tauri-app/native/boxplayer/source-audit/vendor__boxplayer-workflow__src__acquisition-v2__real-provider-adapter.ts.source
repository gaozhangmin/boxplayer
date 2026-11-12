import type { ResourceSnapshot } from "../domain.js";
import type { ResourceProvider } from "../ports.js";
import type { CandidateRegistry } from "./candidate-registry.js";
import { deadLinkKey, type DeadLinkStore } from "./dead-links.js";
import type { ResourceProviderV2, ResourceSnapshotV2 } from "./fake-provider.js";

/**
 * Phase 6 — the real PanSou provider as a ResourceProviderV2. It runs the real
 * search, records each candidate's full payload in the shared registry (so the
 * storage adapter can transfer by id), and hands the agent only the V2 view:
 * id/title — never the raw url or provider index.
 */
export interface RealResourceProviderV2Options {
  provider: ResourceProvider;
  registry: CandidateRegistry;
  /** Run-scopes content-addressed snapshot ids so re-acquisitions don't collide. */
  workflowRunId: string;
  /** When set, candidates whose link is known-dead are dropped BEFORE the agent
   *  sees them (and never recorded/persisted), so it never re-transfers a dead
   *  resource (#15). */
  deadLinkStore?: DeadLinkStore;
}

export class RealResourceProviderV2 implements ResourceProviderV2 {
  private readonly provider: ResourceProvider;
  private readonly registry: CandidateRegistry;
  private readonly workflowRunId: string;
  private readonly deadLinkStore: DeadLinkStore | undefined;
  private readonly observedSnapshots = new Map<string, ResourceSnapshot>();

  constructor(options: RealResourceProviderV2Options) {
    this.provider = options.provider;
    this.registry = options.registry;
    this.workflowRunId = options.workflowRunId;
    this.deadLinkStore = options.deadLinkStore;
  }

  /** The domain snapshots observed this run (deduped by id — content-addressed
   *  providers repeat ids across keywords), for the workflow to persist. */
  snapshots(): ResourceSnapshot[] {
    return [...this.observedSnapshots.values()];
  }

  async search(keyword: string): Promise<ResourceSnapshotV2> {
    const snapshot = await this.provider.search({ keyword, workflowRunId: this.workflowRunId });
    const deadKeys = this.deadLinkStore ? new Set(await this.deadLinkStore.listDeadLinkKeys()) : null;
    const kept = deadKeys
      ? snapshot.candidates.filter((candidate) => {
          const identity = deadLinkKey(String(candidate.providerPayload?.["url"] ?? ""));
          return !(identity && deadKeys.has(identity.key));
        })
      : snapshot.candidates;
    const dropped = snapshot.candidates.length - kept.length;
    if (dropped > 0) {
      console.log(`[dead-link] filtered ${dropped} known-dead candidate(s) from search ${JSON.stringify(keyword)}`);
    }
    // Persist + record only the filtered view — the agent never sees, transfers,
    // or has persisted the dead candidates.
    const filteredSnapshot: ResourceSnapshot = { ...snapshot, candidates: kept };
    if (!this.observedSnapshots.has(snapshot.id)) {
      this.observedSnapshots.set(snapshot.id, filteredSnapshot);
    }
    for (const candidate of kept) {
      this.registry.record(candidate);
    }
    return {
      id: snapshot.id,
      keyword: snapshot.keyword,
      candidates: kept.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
      })),
    };
  }
}
