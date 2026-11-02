import { createHash } from "node:crypto";
import type {
  ResourceCandidate,
  ResourceSnapshot,
  ResourceType,
} from "./domain.js";
import type { ResourceProvider } from "./ports.js";

export interface PanSouFetchInit {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  /** Per-request abort deadline — a stalled PanSou upstream must degrade to
   *  "fewer candidates this poll", never hang the run (2026-07-06 incident:
   *  4.5 min pre-agent stall; same failure class as the TMDB hang #68).
   *  Optional so existing PanSouFetchJson call sites stay source-compatible;
   *  defaultFetchJson falls back to DEFAULT_REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export type PanSouFetchJson = (url: string, init: PanSouFetchInit) => Promise<unknown>;

export interface PanSouResourceProviderOptions {
  baseURL: string;
  fetchJson?: PanSouFetchJson;
  now?: () => string;
  /** How many times to re-query before treating the result set as complete. */
  maxSearchAttempts?: number;
  /** Delay between completeness polls (ms). */
  searchPollMs?: number;
  /** Injectable sleep (tests pass a no-op). */
  wait?: (ms: number) => Promise<void>;
  /** Abort a single search request after this many ms (default 20s). */
  requestTimeoutMs?: number;
  /** Restrict returned candidates to these link types (per-brand: a quark drive
   *  gets ["quark"], a 115 drive ["115","magnet"]). Undefined = no filter. */
  allowedTypes?: ResourceType[];
}

interface PanSouLinkFact {
  title: string;
  source: string;
  type: ResourceType;
  rawType: string;
  url: string;
  password: string;
  datetime: string;
}

export class PanSouResourceProvider implements ResourceProvider {
  private readonly baseURL: string;
  private readonly fetchJson: PanSouFetchJson;
  private readonly now: () => string;
  private readonly maxSearchAttempts: number;
  private readonly searchPollMs: number;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly allowedTypes: Set<ResourceType> | null;
  private readonly requestTimeoutMs: number;

  constructor(options: PanSouResourceProviderOptions) {
    this.baseURL = options.baseURL.replace(/\/+$/, "");
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxSearchAttempts = options.maxSearchAttempts ?? 4;
    this.searchPollMs = options.searchPollMs ?? 2500;
    this.wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.allowedTypes = options.allowedTypes ? new Set(options.allowedTypes) : null;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private async fetchFacts(keyword: string): Promise<PanSouLinkFact[]> {
    const response = await this.fetchJson(`${this.baseURL}/api/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "clawd-media-track/1.0",
      },
      body: JSON.stringify({ kw: keyword, res: "all" }),
      timeoutMs: this.requestTimeoutMs,
    });
    const facts = isPanSouSuccessResponse(response) ? collectLinkFacts(response.data.results) : [];
    // Per-brand filter: a quark drive only sees quark links; a 115 drive only
    // sees 115/magnet. Keeps a candidate set that its executor can actually transfer.
    return this.allowedTypes ? facts.filter((fact) => this.allowedTypes!.has(fact.type)) : facts;
  }

  async search(input: { keyword: string; workflowRunId?: string }): Promise<ResourceSnapshot> {
    // PanSou is async/streaming: the first call returns quick cached results and
    // async-plugin results land on LATER calls (5 → 35 115-links, 0 → 419
    // magnets). Poll until the link count stops growing so the agent always
    // judges the COMPLETE evidence — never a partial slice (no 抢跑). Speed comes
    // from the agent issuing FEWER searches, not from cutting this short.
    let facts: PanSouLinkFact[] = [];
    for (let attempt = 0; attempt < this.maxSearchAttempts; attempt += 1) {
      let next: PanSouLinkFact[];
      try {
        next = await this.fetchFacts(input.keyword);
      } catch {
        break; // network/parse error mid-poll — keep the most complete set so far
      }
      if (next.length > facts.length) {
        facts = next;
      } else if (attempt > 0) {
        break; // stabilized: no new links since the previous poll
      }
      if (attempt < this.maxSearchAttempts - 1) {
        await this.wait(this.searchPollMs);
      }
    }
    const snapshotId = createSnapshotId(input.keyword, facts, input.workflowRunId);
    const candidates: ResourceCandidate[] = facts.map((fact, index) => ({
      id: `${snapshotId}_candidate_${index + 1}`,
      snapshotId,
      index,
      title: fact.title,
      type: fact.type,
      source: fact.source,
      providerPayload: {
        url: fact.url,
        password: fact.password,
        datetime: fact.datetime,
        rawType: fact.rawType,
      },
    }));

    return {
      id: snapshotId,
      provider: "pansou",
      keyword: input.keyword,
      candidates,
      createdAt: this.now(),
    };
  }
}

export function createPanSouResourceProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PanSouResourceProvider {
  const baseURL = env.PANSOU_BASE_URL;
  if (!baseURL) {
    throw new Error("PANSOU_BASE_URL is required to create PanSouResourceProvider");
  }
  return new PanSouResourceProvider({ baseURL });
}

async function defaultFetchJson(url: string, init: PanSouFetchInit): Promise<unknown> {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`PanSou search failed with HTTP ${response.status}`);
  }
  return response.json();
}

function isPanSouSuccessResponse(value: unknown): value is {
  code: 0;
  data: {
    results: unknown[];
  };
} {
  if (!isRecord(value) || value["code"] !== 0 || !isRecord(value["data"])) {
    return false;
  }
  return Array.isArray(value["data"]["results"]);
}

function collectLinkFacts(results: unknown[]): PanSouLinkFact[] {
  const facts: PanSouLinkFact[] = [];
  const seenUrls = new Set<string>();

  for (const result of results) {
    if (!isRecord(result)) {
      continue;
    }
    const title = stringValue(result["title"]);
    const source = stringValue(result["channel"]);
    const links = Array.isArray(result["links"]) ? result["links"] : [];
    for (const link of links) {
      if (!isRecord(link)) {
        continue;
      }
      const rawType = stringValue(link["type"]);
      const url = stringValue(link["url"]);
      const type = normalizeResourceType(rawType, url);
      if (!type || !url || seenUrls.has(url)) {
        continue;
      }
      seenUrls.add(url);
      facts.push({
        title,
        source,
        type,
        rawType,
        url,
        password: stringValue(link["password"]),
        datetime: stringValue(link["datetime"]),
      });
    }
  }

  return facts;
}

function normalizeResourceType(rawType: string, url: string): ResourceType | null {
  if (rawType === "115") {
    return "115";
  }
  if (rawType === "quark" || url.includes("pan.quark.cn/s/")) {
    return "quark";
  }
  // 123 share shapes mirror parsePan123ShareUrl (pan123-storage-executor):
  // multi-mirror domains 123pan/123684/123865/123912 · com/cn, path /s/<key>.
  if (rawType === "123" || /123(?:684|865|912|pan)\.(?:com|cn)\/s\//.test(url)) {
    return "123";
  }
  // 天翼 share shapes mirror parseTianyiShareUrl (tianyi-storage-executor):
  // cloud.189.cn/t/<code> (the probe-confirmed PanSou link shape) and
  // cloud.189.cn/web/share?…code=<code> (the ?code= is required — the executor
  // can't parse a code-less share URL). Deliberately NOT bare "cloud.189.cn/",
  // which would misclassify non-share 189 URLs (e.g. the web portal).
  if (
    rawType === "tianyi" ||
    url.includes("cloud.189.cn/t/") ||
    /cloud\.189\.cn\/web\/share\?[^#]*\bcode=/.test(url)
  ) {
    return "tianyi";
  }
  if (url.startsWith("magnet:")) {
    return "magnet";
  }
  return null;
}

function createSnapshotId(keyword: string, facts: PanSouLinkFact[], workflowRunId?: string): string {
  // The keyword is part of the top-level material (not only embedded per-fact),
  // so an EMPTY result set still yields a keyword-specific id. Otherwise every
  // empty search hashes the same `[]` → one shared id that collides across
  // keywords AND across runs (resource_snapshots.id is a global primary key).
  const material = JSON.stringify({
    workflowRunId: workflowRunId ?? null,
    keyword,
    facts: facts.map((fact) => ({
      title: fact.title,
      type: fact.type,
      rawType: fact.rawType,
      url: fact.url,
      password: fact.password,
      datetime: fact.datetime,
      source: fact.source,
    })),
  });
  const hash = createHash("sha1").update(material).digest("hex").slice(0, 12);
  // Run-scope the id so a re-acquisition with identical results gets its OWN
  // snapshot row instead of colliding with the first run's on the global PK.
  return workflowRunId ? `pansou_${workflowRunId}_${hash}` : `pansou_${hash}`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
