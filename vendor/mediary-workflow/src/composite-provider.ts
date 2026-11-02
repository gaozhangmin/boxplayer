import { createHash } from "node:crypto";
import type { ResourceCandidate, ResourceSnapshot } from "./domain.js";
import type { ResourceProvider } from "./ports.js";

export interface CompositeResourceProviderOptions {
  providers: Array<{ name: string; provider: ResourceProvider }>;
  now?: () => string;
}

const BTIH_RE = /urn:btih:([0-9a-z]+)/i;

export class CompositeResourceProvider implements ResourceProvider {
  private readonly providers: Array<{ name: string; provider: ResourceProvider }>;
  private readonly now: () => string;

  constructor(options: CompositeResourceProviderOptions) {
    this.providers = options.providers;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async search(input: { keyword: string; workflowRunId?: string }): Promise<ResourceSnapshot> {
    const settled = await Promise.allSettled(
      this.providers.map((entry) => entry.provider.search(input)),
    );

    const merged: ResourceCandidate[] = [];
    const seen = new Set<string>();
    const sourceSnapshotIds: string[] = [];
    for (const result of settled) {
      if (result.status !== "fulfilled") continue; // a down source contributes nothing
      sourceSnapshotIds.push(result.value.id);
      for (const candidate of result.value.candidates) {
        const key = dedupeKey(candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(candidate);
      }
    }

    const snapshotId = createSnapshotId(input.keyword, sourceSnapshotIds, input.workflowRunId);
    const candidates: ResourceCandidate[] = merged.map((candidate, index) => ({
      ...candidate,
      id: `${snapshotId}_candidate_${index + 1}`,
      snapshotId,
      index,
    }));

    return { id: snapshotId, provider: "composite", keyword: input.keyword, candidates, createdAt: this.now() };
  }
}

function dedupeKey(candidate: ResourceCandidate): string {
  const payloadHash = candidate.providerPayload["infoHash"];
  if (typeof payloadHash === "string" && payloadHash) {
    return `btih:${payloadHash.toLowerCase()}`;
  }
  const url = candidate.providerPayload["url"];
  if (typeof url === "string" && url) {
    const m = BTIH_RE.exec(url);
    if (m) return `btih:${m[1]!.toLowerCase()}`;
    return `url:${url}`;
  }
  return `id:${candidate.id}`;
}

function createSnapshotId(keyword: string, sourceSnapshotIds: string[], workflowRunId?: string): string {
  const material = JSON.stringify({ workflowRunId: workflowRunId ?? null, keyword, sourceSnapshotIds });
  const hash = createHash("sha1").update(material).digest("hex").slice(0, 12);
  return workflowRunId ? `composite_${workflowRunId}_${hash}` : `composite_${hash}`;
}
