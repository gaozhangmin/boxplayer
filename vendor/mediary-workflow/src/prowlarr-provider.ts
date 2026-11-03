import { createHash } from "node:crypto";
import type { ResourceCandidate, ResourceSnapshot } from "./domain.js";
import type { ResourceProvider } from "./ports.js";

export interface ProwlarrFetchInit {
  method: "GET";
  headers: Record<string, string>;
}

export type ProwlarrFetchJson = (url: string, init: ProwlarrFetchInit) => Promise<unknown>;

export interface ProwlarrResourceProviderOptions {
  baseURL: string;
  apiKey: string;
  fetchJson?: ProwlarrFetchJson;
  now?: () => string;
}

interface ProwlarrFact {
  title: string;
  indexer: string;
  magnet: string;
  infoHash: string;
  seeders: number | null;
  sizeBytes: number | null;
  downloadUrl: string;
}

const BTIH_RE = /urn:btih:([0-9a-z]+)/i;

export class ProwlarrResourceProvider implements ResourceProvider {
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly fetchJson: ProwlarrFetchJson;
  private readonly now: () => string;

  constructor(options: ProwlarrResourceProviderOptions) {
    this.baseURL = options.baseURL.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async search(input: { keyword: string; workflowRunId?: string }): Promise<ResourceSnapshot> {
    const url = `${this.baseURL}/api/v1/search?query=${encodeURIComponent(input.keyword)}&type=search`;
    let releases: unknown[] = [];
    try {
      const response = await this.fetchJson(url, {
        method: "GET",
        headers: { "X-Api-Key": this.apiKey, Accept: "application/json" },
      });
      releases = Array.isArray(response) ? response : [];
    } catch {
      releases = []; // network/parse error → empty evidence from this source
    }

    const facts = collectFacts(releases);
    const snapshotId = createSnapshotId(input.keyword, facts, input.workflowRunId);
    const candidates: ResourceCandidate[] = facts.map((fact, index) => ({
      id: `${snapshotId}_candidate_${index + 1}`,
      snapshotId,
      index,
      title: fact.title,
      type: "magnet",
      source: fact.indexer,
      providerPayload: {
        url: fact.magnet,
        infoHash: fact.infoHash,
        seeders: fact.seeders,
        sizeBytes: fact.sizeBytes,
        indexer: fact.indexer,
        downloadUrl: fact.downloadUrl,
      },
    }));

    return { id: snapshotId, provider: "prowlarr", keyword: input.keyword, candidates, createdAt: this.now() };
  }
}

function collectFacts(releases: unknown[]): ProwlarrFact[] {
  const facts: ProwlarrFact[] = [];
  const seen = new Set<string>();
  for (const release of releases) {
    if (!isRecord(release)) continue;
    if (stringValue(release["protocol"]) !== "torrent") continue; // usenet can't 秒传

    const downloadUrl = stringValue(release["downloadUrl"]);
    let infoHash = stringValue(release["infoHash"]).toLowerCase();
    let magnet: string;
    if (infoHash) {
      magnet = `magnet:?xt=urn:btih:${infoHash}`;
    } else if (downloadUrl.startsWith("magnet:")) {
      magnet = downloadUrl;
      const m = BTIH_RE.exec(downloadUrl);
      infoHash = m ? m[1]!.toLowerCase() : "";
    } else {
      continue; // only a .torrent http link, no hash → 115 秒传 can't match
    }

    const dedupeKey = infoHash || magnet;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    facts.push({
      title: stringValue(release["title"]),
      indexer: stringValue(release["indexer"]),
      magnet,
      infoHash,
      seeders: numberOrNull(release["seeders"]),
      sizeBytes: numberOrNull(release["size"]),
      downloadUrl,
    });
  }
  return facts;
}

export function createProwlarrResourceProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProwlarrResourceProvider {
  const baseURL = env.PROWLARR_BASE_URL;
  const apiKey = env.PROWLARR_API_KEY;
  if (!baseURL || !apiKey) {
    throw new Error("PROWLARR_BASE_URL and PROWLARR_API_KEY are required to create ProwlarrResourceProvider");
  }
  return new ProwlarrResourceProvider({ baseURL, apiKey });
}

async function defaultFetchJson(url: string, init: ProwlarrFetchInit): Promise<unknown> {
  const response = await fetch(url, { method: init.method, headers: init.headers });
  if (!response.ok) {
    throw new Error(`Prowlarr search failed with HTTP ${response.status}`);
  }
  return response.json();
}

function createSnapshotId(keyword: string, facts: ProwlarrFact[], workflowRunId?: string): string {
  const material = JSON.stringify({
    workflowRunId: workflowRunId ?? null,
    keyword,
    facts: facts.map((f) => ({ title: f.title, infoHash: f.infoHash, magnet: f.magnet, indexer: f.indexer })),
  });
  const hash = createHash("sha1").update(material).digest("hex").slice(0, 12);
  return workflowRunId ? `prowlarr_${workflowRunId}_${hash}` : `prowlarr_${hash}`;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
