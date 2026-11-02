/**
 * 123网盘 (123pan / yun.123pan.com) HTTP client — the brand-5 analogue of
 * QuarkCookieClient / TianyiClient. Like 夸克/天翼, 123 is a pure "transfer-share"
 * (转存分享) brand; like 光鸭/天翼 it is token-auth (Bearer <token>).
 *
 * v1 uses ONLY the WEB face `yun.123pan.com/b/api/*`. Every request carries a
 * crc32-based signPath signature (the {k,v} pair is injected into the query) plus
 * a fixed header set. There is NO token-refresh endpoint on the web face (all
 * refresh_token flows live on open-api.123pan.com, unrelated to 转存), so a dead
 * token cannot self-heal here: `code===401` throws Pan123AuthError and the upstream
 * registry freezes the connection for the user to re-scan. (This is why v1 has no
 * onCredentialRefresh / login_another / retry logic — nothing to refresh with.)
 *
 * 🔴 THE root cause this brand needs care for: 123's FileId/ShareId (int64, 18
 * digits) exceed Number.MAX_SAFE_INTEGER. Plain JSON.parse silently ROUNDS them →
 * a corrupted, non-existent id → a transfer that hangs / lands nothing. The fix:
 * stringify these id fields BEFORE JSON.parse. `parsePan123Json` is the SINGLE
 * json-parse entry point — no response is ever handed to raw JSON.parse.
 */

const API_BASE = "https://yun.123pan.com/b/api";
const DEFAULT_TIMEOUT_MS = 20_000;

/** Standard IEEE CRC32. Buffer in, unsigned 32-bit out. Used by signPath. */
export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    let c = (crc ^ (buf[i] as number)) & 0xff;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 123 web-face request signature (ported verbatim from the real-run probe /
 * OpenList drivers/123 signPath). Returns {k, v} where the query KEY is the
 * timeSign value itself and the VALUE is `<timestamp>-<random>-<dataSign>`.
 * ⚠️ Date.now()/Math.random() are intentional — this is a real client, not the
 * Workflow sandbox.
 */
export function signPath(path: string): { k: string; v: string } {
  const table = "adefghlmyijnopkqrstubcvwsz";
  const random = String(Math.round(1e7 * Math.random()));
  const nowMs = Date.now();
  const timestamp = String(Math.floor(nowMs / 1000));
  const cst = new Date(nowMs + 8 * 3600 * 1000);
  const p2 = (n: number): string => String(n).padStart(2, "0");
  const nowStr = `${cst.getUTCFullYear()}${p2(cst.getUTCMonth() + 1)}${p2(cst.getUTCDate())}${p2(cst.getUTCHours())}${p2(cst.getUTCMinutes())}`;
  const mapped = Buffer.from([...nowStr].map((ch) => table.charCodeAt(ch.charCodeAt(0) - 48)));
  const timeSign = String(crc32(mapped));
  const data = [timestamp, random, path, "web", "3", timeSign].join("|");
  const dataSign = String(crc32(Buffer.from(data)));
  return { k: timeSign, v: [timestamp, random, dataSign].join("-") };
}

/** id 字段名:123 的这些字段是 18 位 int64,JSON.parse 前必须先转字符串防精度丢失。
 *  ⚠️ 全 client 唯一的解析入口,任何响应都走它。字段清单以真跑通的探针 BIGINT 常量为准,
 *  额外加 `\s*` 容错(JSON 允许冒号前后空白)。不要加裸 `Id` 字段——太宽会误伤非 id 数字。 */
const BIGINT_ID_FIELDS = /"(FileId|fileId|ShareId|shareId|file_id|parent_file_id)"\s*:\s*(\d{16,})/g;

/** 唯一 JSON 解析入口:先把大整数 id 字段加引号转字符串,再 parse。见文件头「root cause」。 */
export function parsePan123Json(text: string): unknown {
  try {
    return JSON.parse(text.replace(BIGINT_ID_FIELDS, '"$1":"$2"'));
  } catch {
    return null;
  }
}

/** providerUid = JWT payload 的 `id`(稳定数字用户 id)。非 JWT/空 → null。
 *  keys UNIQUE(provider, provider_uid)。 */
export function parsePan123Uid(token: string): string | null {
  const parts = (token ?? "").trim().split(".");
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    const id = payload?.id;
    return id != null && String(id).trim() ? String(id) : null;
  } catch {
    return null;
  }
}

/**
 * The token is dead — distinct from a generic API error so the worker can FREEZE
 * the drive on this specifically. Mirrors TianyiAuthError / QuarkAuthError.
 * v1 does NOT self-heal (no web-face refresh endpoint); the user re-scans.
 */
export class Pan123AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Pan123AuthError";
  }
}

export function isPan123AuthError(error: unknown): error is Pan123AuthError {
  return error instanceof Pan123AuthError;
}

/** The credential blob persisted in connected_storages.payload. v1 是纯 token 模型
 *  (web 面无刷新端点),故不含 tokenExp/meta——没有代码写读,YAGNI。 */
export interface Pan123Credential {
  token: string;
}

export type Pan123Fetch = (
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text: string }>;

/** 统一 item:file/list/new 与 share/get 的 InfoList 条目共用此形状。 */
export interface Pan123Item {
  id: string;
  name: string;
  size: number;
  etag: string;
  isFolder: boolean;
}

export interface Pan123ClientOptions {
  token: string;
  fetchImpl?: Pan123Fetch;
}

export class Pan123Client {
  private readonly token: string;
  private readonly fetchImpl: Pan123Fetch;

  constructor(opts: Pan123ClientOptions) {
    // Defensive coercion at the single choke point: callers cast `credential`
    // from unknown, so a malformed DB blob can deliver a non-string token. Treat
    // it as "" so the failure surfaces as a clean 401 → Pan123AuthError (freeze),
    // never a TypeError inside .trim().
    this.token = typeof opts.token === "string" ? opts.token.trim() : "";
    this.fetchImpl = opts.fetchImpl ?? defaultPan123Fetch;
  }

  // ── 传输(signPath 签名 + envelope 判定) ──────────────────────────────────

  /** 组装签名请求 + envelope 判定。返回响应顶层对象(含 code/data)。
   *  code===0 成功;code===401 → Pan123AuthError(死 token,不重试/不刷新);其它非 0 → 普通 Error。 */
  private async signed(
    path: string,
    init: { method: "GET" | "POST"; query?: Record<string, string>; body?: unknown },
  ): Promise<Record<string, unknown>> {
    const u = new URL(API_BASE + path);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v != null) {
        u.searchParams.set(k, v);
      }
    }
    const s = signPath(u.pathname);
    u.searchParams.set(s.k, s.v);
    const res = await this.fetchImpl(u.toString(), {
      method: init.method,
      headers: {
        authorization: `Bearer ${this.token}`,
        platform: "web",
        "app-version": "3",
        "content-type": "application/json;charset=UTF-8",
        origin: "https://yun.123pan.com",
        referer: "https://yun.123pan.com/",
        "user-agent": "Mozilla/5.0",
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const parsed = parsePan123Json(res.text);
    // Fail LOUD on a non-JSON body (WAF/gateway/challenge HTML, transient 5xx) —
    // never null→{}→code=0=空成功, or an upstream outage / GFW block masquerades as
    // an empty directory / 「分享已失效」 (the TMDB-outage-as-empty 病, 天翼血泪).
    // ⚠️ Not gated on HTTP status: challenge pages ship HTTP 200 + HTML.
    if (parsed === null || typeof parsed !== "object") {
      throw new Error(`PAN123_HTTP_FAILED: status=${res.status} non-JSON body`);
    }
    const data = parsed as Record<string, unknown>;
    // 123 每个 web 响应都带 code;缺 code = 非正常响应(不是 code:0 空成功)→ fail loud。
    if (data["code"] === undefined) {
      throw new Error(`PAN123_HTTP_FAILED: status=${res.status} missing code`);
    }
    const code = numOf(data["code"]);
    if (code === 401) {
      throw new Pan123AuthError(`PAN123_AUTH_FAILED: ${strOf(data["message"])}`);
    }
    if (code !== 0) {
      throw new Error(`PAN123_FAILED(${path}): code=${code} ${strOf(data["message"])}`);
    }
    return data;
  }

  // ── 目录读 ───────────────────────────────────────────────────────────────

  /** file/list/new:分页游标 `next`(起始 "0"),读 data.InfoList + data.Next。
   *  Next 为 -1/""/0 之一即停止(照探针分页停止条件)。
   *  `opts.maxPages` 封顶翻页数(默认不限=全量翻页,现行为):probe 这类 cheap read
   *  只需第一页验活,存量大账号不必付至多 100 个串行签名往返。 */
  async listFiles(parentFileId: string, opts?: { maxPages?: number }): Promise<Pan123Item[]> {
    const out: Pan123Item[] = [];
    let next = "0";
    // Safety cap: a misbehaving cursor must not spin forever (100 pages × 100 = 10k items).
    for (let guard = 0; guard < 100; guard++) {
      const resp = await this.signed("/file/list/new", {
        method: "GET",
        query: {
          driveId: "0",
          limit: "100",
          next,
          orderBy: "file_id",
          orderDirection: "desc",
          parentFileId,
          trashed: "false",
          Page: "1",
        },
      });
      const d = (resp["data"] ?? {}) as Record<string, unknown>;
      const infoList = Array.isArray(d["InfoList"]) ? (d["InfoList"] as unknown[]) : [];
      for (const it of infoList) {
        out.push(mapPan123Item(it));
      }
      const nextCursor = d["Next"];
      if (isStopCursor(nextCursor)) {
        break;
      }
      if (guard + 1 >= (opts?.maxPages ?? Infinity)) {
        break; // cheap-read cap reached — caller only needed the first page(s)
      }
      next = String(nextCursor);
    }
    return out;
  }

  /** 列分享目录(share/get,登录态空码穿透)。分页游标 `next`(起始 "0"),读 data.InfoList
   *  + data.Next,停止哨兵同 listFiles。合并所有页——分享顶层 >100 文件时不静默截断
   *  (no-silent-caps,转存完整性)。 */
  async listShareDir(input: { shareKey: string; sharePwd: string; parentFileId?: string }): Promise<Pan123Item[]> {
    const out: Pan123Item[] = [];
    let next = "0";
    for (let guard = 0; guard < 100; guard++) {
      const resp = await this.signed("/share/get", {
        method: "GET",
        query: {
          ShareKey: input.shareKey,
          SharePwd: input.sharePwd,
          parentFileId: input.parentFileId ?? "0",
          Page: "1",
          limit: "100",
          next,
          orderBy: "file_name",
          orderDirection: "asc",
          event: "homeListFile",
        },
      });
      const d = (resp["data"] ?? {}) as Record<string, unknown>;
      const infoList = Array.isArray(d["InfoList"]) ? (d["InfoList"] as unknown[]) : [];
      for (const it of infoList) {
        out.push(mapPan123Item(it));
      }
      const nextCursor = d["Next"];
      if (isStopCursor(nextCursor)) {
        break;
      }
      next = String(nextCursor);
    }
    return out;
  }

  // ── 转存链(share/get → file/copy/async) ─────────────────────────────────

  /** 转存:先 listShareDir 拿顶层 items(空 → ok:false,不抛);再 file/copy/async。
   *  ⚠️ file_list 每项必须四件套 file_id+file_name+etag+size(缺 size→code:5050),
   *  外加 parent_file_id+drive_id+type。无异步 task 轮询,由 executor 重列目录验证。 */
  async saveShare(input: {
    shareKey: string;
    sharePwd: string;
    targetParentId: string;
  }): Promise<{ ok: boolean; message: string }> {
    const items = await this.listShareDir({ shareKey: input.shareKey, sharePwd: input.sharePwd });
    if (items.length === 0) {
      return { ok: false, message: "分享为空 / 已失效(share empty / dead)" };
    }
    await this.signed("/file/copy/async", {
      method: "POST",
      body: {
        share_key: input.shareKey,
        share_pwd: input.sharePwd,
        current_level: 1,
        event: "transfer",
        file_list: items.map((i) => ({
          file_id: i.id,
          file_name: i.name,
          etag: i.etag,
          size: i.size,
          parent_file_id: input.targetParentId,
          drive_id: 0,
          type: i.isFolder ? 1 : 0,
        })),
      },
    });
    return { ok: true, message: "" };
  }

  // ── 目录写 ───────────────────────────────────────────────────────────────

  async createFolder(input: { name: string; parentId: string }): Promise<string> {
    const resp = await this.signed("/file/upload_request", {
      method: "POST",
      body: { driveId: 0, etag: "", fileName: input.name, parentFileId: input.parentId, size: 0, type: 1 },
    });
    const d = (resp["data"] ?? {}) as Record<string, unknown>;
    const info = (d["Info"] ?? {}) as Record<string, unknown>;
    const id = strId(info["FileId"]) || strId(d["FileId"]);
    if (!id) {
      throw new Error("PAN123_CREATE_FOLDER_FAILED: response missing FileId");
    }
    return id;
  }

  async trash(entries: { id: string; name?: string; isFolder: boolean }[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await this.signed("/file/trash", {
      method: "POST",
      body: {
        driveId: 0,
        event: "intoRecycle",
        operation: true,
        // file/trash 权威接口只需 FileId(FileName 可选)。removeDirectory 只有 id,
        // 故 name 缺省时省略 FileName 键(别发空串/undefined)。
        fileTrashInfoList: entries.map((e) => ({
          FileId: e.id,
          ...(e.name ? { FileName: e.name } : {}),
          Type: e.isFolder ? 1 : 0,
        })),
      },
    });
  }

  async moveFiles(input: { fileIds: string[]; targetParentId: string }): Promise<void> {
    if (input.fileIds.length === 0) {
      return;
    }
    await this.signed("/file/mod_pid", {
      method: "POST",
      body: {
        fileIdList: input.fileIds.map((id) => ({ FileId: id })),
        parentFileId: input.targetParentId,
        event: "fileMove",
      },
    });
  }

  async renameFile(input: { fileId: string; name: string }): Promise<void> {
    await this.signed("/file/rename", {
      method: "POST",
      body: { FileId: input.fileId, fileName: input.name, driveId: 0, duplicate: 0, event: "fileRename" },
    });
  }
}

// ── module helpers ──────────────────────────────────────────────────────────

/** InfoList 条目(file/list/new 与 share/get 共用)→ 统一 Pan123Item。
 *  id 已被 parsePan123Json 转 string(大整数);小 id 走 strId 的 number→string 兜底。 */
function mapPan123Item(raw: unknown): Pan123Item {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: strId(r["FileId"]),
    name: String(r["FileName"] ?? ""),
    size: numOf(r["Size"]),
    etag: String(r["Etag"] ?? ""),
    isFolder: numOf(r["Type"]) === 1,
  };
}

/** 分页停止哨兵:Next 为 null/undefined/""/"-1"/"0"(或对应数字)即到底。 */
function isStopCursor(v: unknown): boolean {
  if (v == null) {
    return true;
  }
  const s = String(v).trim();
  return s === "" || s === "-1" || s === "0";
}

/** id 已被 parsePan123Json 转成 string;这里兜底 number→string(小 id 不触发 replace)。 */
function strId(v: unknown): string {
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  return "";
}

function numOf(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function strOf(v: unknown): string {
  return v == null ? "" : String(v);
}

async function defaultPan123Fetch(
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
): Promise<{ status: number; text: string }> {
  // HARD project rule "新外部HTTP一律带超时": a bare fetch with no AbortController
  // hung the whole app in the PanSou incident.
  const requestInit: RequestInit = {
    method: init.method,
    headers: init.headers,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  };
  if (init.body !== undefined) {
    requestInit.body = init.body;
  }
  const res = await fetch(url, requestInit);
  return { status: res.status, text: await res.text() };
}
