/**
 * assrt.net(伪射手)字幕 API 客户端。免费官方 API,零反爬。两段式:
 *   search(keyword) → sub/search → 候选降维成 {id, title, lang}(agent 只看这些)
 *   detail(id)      → sub/detail → 该字幕包的 filelist(文件名 + 单集直链)
 * 容错哲学(对齐 PanSou):任何非命中——空结果 / 配额超限(30900)/ invalid token
 * (20001)/ HTTP 错误 / 网络异常——一律返回空,绝不抛错,让上层软评判。
 */
const ASSRT_BASE_URL = "https://api.assrt.net/v1";
const ASSRT_FETCH_TIMEOUT_MS = 15000;

export type AssrtFetchJson = (url: string) => Promise<unknown>;

export interface AssrtCandidate {
  id: number;
  /** native_name(中文名)· videoname(发布名),给 agent 语义判断用。 */
  title: string;
  /** 语言标签,如 "英 简 双语"。空串表示未知。 */
  lang: string;
  /** 社区评分(vote_score)。API 无排序参数,这是给 agent 的"大家选择"证据。 */
  voteScore?: number;
  /** 字幕组/来源站(release_site),质量语义判断的证据。 */
  releaseSite?: string;
  /** 上传时间(upload_time),新旧判断证据。 */
  uploadTime?: string;
}

export interface AssrtSubtitleFile {
  filename: string;
  url: string;
}

/** The subtitle-provider surface the orchestrator/sandbox depend on (search +
 *  detail). AssrtSubtitleProvider implements it; tests inject a spy of the same
 *  shape. Named so the shape isn't hand-duplicated across call sites. */
export interface AssrtProviderPort {
  search(keyword: string): Promise<AssrtCandidate[]>;
  detail(id: number): Promise<AssrtSubtitleFile[]>;
}

export interface AssrtSubtitleProviderOptions {
  token: string;
  fetchJson?: AssrtFetchJson;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export class AssrtSubtitleProvider {
  private readonly token: string;
  private readonly fetchJson: AssrtFetchJson;

  constructor(options: AssrtSubtitleProviderOptions) {
    this.token = options.token;
    this.fetchJson = options.fetchJson ?? defaultAssrtFetchJson;
  }

  /** Search assrt for a keyword. Returns [] on ANY miss/error (never throws). */
  async search(keyword: string): Promise<AssrtCandidate[]> {
    const url = `${ASSRT_BASE_URL}/sub/search?token=${encodeURIComponent(this.token)}&q=${encodeURIComponent(keyword)}&cnt=15`;
    let body: unknown;
    try {
      body = await this.fetchJson(url);
    } catch {
      return [];
    }
    if (!isRecord(body) || body["status"] !== 0) return [];
    const sub = body["sub"];
    if (!isRecord(sub)) return [];
    const subs = sub["subs"];
    // No-result sends an empty OBJECT {}, a hit sends an ARRAY — so guard on Array.
    if (!Array.isArray(subs)) return [];
    const out: AssrtCandidate[] = [];
    for (const entry of subs) {
      if (!isRecord(entry)) continue;
      const id = entry["id"];
      if (typeof id !== "number") continue;
      const nativeName = str(entry["native_name"]).trim();
      const videoName = str(entry["videoname"]).trim();
      const title = [nativeName, videoName].filter(Boolean).join(" · ") || `assrt #${id}`;
      const lang = isRecord(entry["lang"]) ? str(entry["lang"]["desc"]).trim() : "";
      // Community-pick evidence: the API can't sort by votes/downloads, so we
      // surface what search already returns (vote_score/release_site/upload_time)
      // and let the agent weigh it semantically. Keys omitted when absent.
      const voteScoreRaw = entry["vote_score"];
      const voteScore = typeof voteScoreRaw === "number" ? voteScoreRaw : undefined;
      const releaseSite = str(entry["release_site"]).trim();
      const uploadTime = str(entry["upload_time"]).trim();
      out.push({
        id,
        title,
        lang,
        ...(voteScore === undefined ? {} : { voteScore }),
        ...(releaseSite ? { releaseSite } : {}),
        ...(uploadTime ? { uploadTime } : {}),
      });
    }
    return out;
  }

  /** Fetch one subtitle package's downloadable files. Prefers the per-episode
   *  filelist; falls back to the whole-package zip. [] on any miss/error. */
  async detail(id: number): Promise<AssrtSubtitleFile[]> {
    const url = `${ASSRT_BASE_URL}/sub/detail?token=${encodeURIComponent(this.token)}&id=${id}`;
    let body: unknown;
    try {
      body = await this.fetchJson(url);
    } catch {
      return [];
    }
    if (!isRecord(body) || body["status"] !== 0) return [];
    const sub = body["sub"];
    if (!isRecord(sub) || !Array.isArray(sub["subs"]) || sub["subs"].length === 0) return [];
    const record = sub["subs"][0];
    if (!isRecord(record)) return [];
    const filelist = record["filelist"];
    if (Array.isArray(filelist) && filelist.length > 0) {
      const files: AssrtSubtitleFile[] = [];
      for (const item of filelist) {
        if (!isRecord(item)) continue;
        const filename = str(item["f"]).trim();
        const fileUrl = str(item["url"]).trim();
        if (filename && fileUrl) files.push({ filename, url: fileUrl });
      }
      if (files.length > 0) return files;
    }
    // Fallback: the whole-package zip.
    const zipName = str(record["filename"]).trim();
    const zipUrl = str(record["url"]).trim();
    return zipName && zipUrl ? [{ filename: zipName, url: zipUrl }] : [];
  }
}

async function defaultAssrtFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(ASSRT_FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`assrt request failed with HTTP ${response.status}`);
  }
  return response.json();
}
