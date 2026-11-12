import { lixianRsaEncrypt } from "./pan115-lixian-cipher.js";
import type {
  Pan115ActionResult,
  Pan115DirectoryInfo,
  Pan115Item,
  Pan115OfflineTask,
  Pan115StorageApi,
} from "./storage-115-executor.js";

export type { Pan115OfflineTask };

const PAN115_WEBAPI_BASE_URL = "https://webapi.115.com";
const PAN115_CDN_WEBAPI_BASE_URL = "https://115cdn.com/webapi";
const PAN115_LIXIAN_SSP_URL = "https://lixian.115.com/lixianssp/";
const PAN115_LIXIAN_WEB_URL = "https://lixian.115.com/lixian/";
// 115 requires its android client UA for the lixianssp offline endpoint.
const PAN115_ANDROID_USER_AGENT =
  "Mozilla/5.0 115disk/99.99.99.99 115Browser/99.99.99.99 115wangpan_android/99.99.99.99";
const DEFAULT_LIST_LIMIT = 200; // 115's per-page cap for /files
const DEFAULT_MAX_LIST_TOTAL = 1000; // stitch up to this across pages; beyond it, fail loud
const DEFAULT_LIST_PAGE_DELAY_MS = 1_200; // 逆鳞 spacing between page fetches (matches the guard)
const DEFAULT_USER_AGENT = "media-track/0.1";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface Pan115HttpInit {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export type Pan115FetchJson = (url: string, init: Pan115HttpInit) => Promise<unknown>;

export interface Pan115CookieClientOptions {
  cookie: string;
  fetchJson?: Pan115FetchJson;
  listLimit?: number;
  /** Stitch pages up to this total; beyond it, fail loud (default 1000). */
  maxListTotal?: number;
  /** Delay between page fetches (逆鳞 spacing); 0 in tests (default 1200ms). */
  listPageDelayMs?: number;
  userAgent?: string;
}

export class Pan115CookieClient implements Pan115StorageApi {
  private readonly cookie: string;
  private readonly fetchJson: Pan115FetchJson;
  private readonly listLimit: number;
  private readonly maxListTotal: number;
  private readonly listPageDelayMs: number;
  private readonly userAgent: string;

  constructor(options: Pan115CookieClientOptions) {
    const cookie = normalizeCookie(options.cookie);
    if (!cookie) {
      throw new Error("PAN115_COOKIE is required to create Pan115CookieClient");
    }
    this.cookie = cookie;
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.listLimit = options.listLimit ?? DEFAULT_LIST_LIMIT;
    this.maxListTotal = options.maxListTotal ?? DEFAULT_MAX_LIST_TOTAL;
    this.listPageDelayMs = options.listPageDelayMs ?? DEFAULT_LIST_PAGE_DELAY_MS;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  async createFolder(input: { name: string; parentId: string }): Promise<string> {
    const response = await this.postForm(`${PAN115_WEBAPI_BASE_URL}/files/add`, [
      ["pid", input.parentId],
      ["cname", input.name],
    ]);
    if (!responseState(response)) {
      throwResponseFailure(response, `PAN115_CREATE_FOLDER_FAILED: ${responseMessage(response)}`);
    }
    const directoryId = stringValue(
      recordValue(response, "cid") ??
        recordValue(recordValue(response, "data"), "cid") ??
        recordValue(response, "file_id"),
    );
    if (!directoryId) {
      throw new Error("PAN115_CREATE_FOLDER_FAILED: response missing cid");
    }
    return directoryId;
  }

  private async listPage(directoryId: string, offset: number): Promise<unknown> {
    const response = await this.getJson(`${PAN115_WEBAPI_BASE_URL}/files`, [
      ["aid", "1"],
      ["cid", directoryId],
      ["o", "user_ptime"],
      ["asc", "1"],
      ["offset", String(offset)],
      ["show_dir", "1"],
      ["limit", String(this.listLimit)],
      ["snap", "0"],
      ["natsort", "0"],
      ["record_open_time", "1"],
      ["format", "json"],
      ["fc_mix", "0"],
    ]);
    if (!responseState(response)) {
      throwResponseFailure(response, `PAN115_LIST_ITEMS_FAILED: ${responseMessage(response)}`);
    }
    return response;
  }

  async listItems(input: { directoryId: string }): Promise<Pan115Item[]> {
    const first = await this.listPage(input.directoryId, 0);
    // 115 silently treats a deleted/invalid cid as the account ROOT and returns
    // root's children. The /files response echoes the cid it actually resolved;
    // a mismatch means the directory is gone — refuse, never hand back root's
    // contents (enumerating then deleting them would wipe the user's library).
    if (!this.listResolvedToRequested(first, input.directoryId)) {
      throw new Error(
        `PAN115_DIRECTORY_NOT_FOUND: requested cid=${input.directoryId} but 115 resolved to ` +
          `${stringValue(recordValue(first, "cid"))}. The directory was likely deleted; ` +
          `refusing to operate on the fallback (root) directory.`,
      );
    }
    const totalCount = numberValue(recordValue(first, "count"));
    // Hard cap: a directory bigger than this is a real outlier — fail loud rather
    // than paginate forever (and re-fetch it every step). 335-file donghua packs
    // sit comfortably under 1000; this only stops pathological dirs.
    if (totalCount > this.maxListTotal) {
      throw new Error(
        `PAN115_LIST_TOO_LARGE: cid=${input.directoryId}; count=${totalCount}; limit=${this.maxListTotal}`,
      );
    }
    const items = arrayValue(recordValue(first, "data")).filter(isRecord) as Pan115Item[];
    // Stitch the remaining pages (each is one /files call, 逆鳞-spaced).
    while (items.length < totalCount) {
      if (this.listPageDelayMs > 0) {
        await sleep(this.listPageDelayMs);
      }
      const page = await this.listPage(input.directoryId, items.length);
      const pageItems = arrayValue(recordValue(page, "data")).filter(isRecord) as Pan115Item[];
      if (pageItems.length === 0) {
        break; // safety: a lying count must not loop forever
      }
      items.push(...pageItems);
    }
    return items;
  }

  async getDirectoryInfo(input: { directoryId: string }): Promise<Pan115DirectoryInfo | null> {
    // ONE /files call gives everything getDirectoryInfo needs: it echoes the cid
    // 115 actually resolved (a deleted cid silently resolves to the account root,
    // so a mismatch means the directory is gone) AND carries the full ancestor
    // breadcrumb in `path`, INCLUDING this directory itself as the leaf with its
    // real cid. So no category/get, no leaf synthesis, no separate existence
    // probe — it shares the same endpoint and resolution guard as listItems.
    const response = await this.getJson(`${PAN115_WEBAPI_BASE_URL}/files`, [
      ["aid", "1"],
      ["cid", input.directoryId],
      ["limit", "1"],
      ["offset", "0"],
      ["show_dir", "1"],
      ["format", "json"],
    ]);
    // A dead cookie is an auth failure, NOT "this directory is gone" — surface it
    // distinctly so callers (e.g. testConnection / the worker) can freeze the drive.
    if (isAuthFailure(response)) {
      throwResponseFailure(response, `PAN115_DIR_INFO_FAILED: ${responseMessage(response)}`);
    }
    if (!responseState(response) || !this.listResolvedToRequested(response, input.directoryId)) {
      return { state: false, path: [] };
    }
    return { state: true, path: breadcrumbFromFilesResponse(response) };
  }

  /**
   * 115 silently resolves a deleted/invalid cid to the account root and echoes
   * the cid it actually listed in the /files response. So the resolved cid
   * equalling the requested cid is the one reliable proof the directory is real
   * and is itself — used both to fail `listItems` loud and to confirm existence
   * in `getDirectoryInfo`. Root ("0") trivially resolves to itself.
   */
  private listResolvedToRequested(response: unknown, directoryId: string): boolean {
    if (directoryId === "0") {
      return true;
    }
    return stringValue(recordValue(response, "cid")) === directoryId;
  }

  async receiveShare(input: {
    shareCode: string;
    receiveCode: string;
    directoryId: string;
  }): Promise<Pan115ActionResult> {
    const response = await this.postForm(
      `${PAN115_CDN_WEBAPI_BASE_URL}/share/receive`,
      [
        ["share_code", input.shareCode],
        ["receive_code", input.receiveCode],
        ["cid", input.directoryId],
      ],
      {
        Referer: buildShareReferer(input.shareCode, input.receiveCode),
        Origin: "https://115.com",
      },
    );
    return actionResultFromResponse(response);
  }

  async addOfflineTask(input: { url: string; directoryId: string }): Promise<Pan115ActionResult> {
    // 115's selling point: magnet (and http/ed2k) links land via cloud download
    // just like a 115 share receive — immediate for healthy resources. The
    // lixianssp endpoint takes an RSA-encrypted JSON body; auth is the cookie.
    const payload = JSON.stringify({
      url: input.url,
      wp_path_id: input.directoryId,
      ac: "add_task_url",
      app_ver: "99.99.99.99",
    });
    const encrypted = lixianRsaEncrypt(new TextEncoder().encode(payload));
    const response = await this.postForm(
      PAN115_LIXIAN_SSP_URL,
      [["data", encrypted]],
      { "User-Agent": PAN115_ANDROID_USER_AGENT },
    );
    // errcode 10008 ("任务已存在") is 115 REFUSING a duplicate: this infohash was
    // already submitted on a prior transfer. It is NOT a junk/dead resource — it
    // may well be in our cloud already from that earlier task. Flag it as
    // alreadyTransferred so the caller does NOT cancel it (canceling would kill
    // the prior good task) and instead just moves to the next candidate.
    if (isOfflineTaskAlreadyExists(response)) {
      return {
        ok: true,
        alreadyTransferred: true,
        message: responseMessage(response) || "任务已存在",
      };
    }
    return actionResultFromResponse(response);
  }

  async removeOfflineTask(input: { infoHashes: string[] }): Promise<Pan115ActionResult> {
    // Cancel queued cloud-download tasks (`ac=task_del`) by info_hash. Same
    // RSA-encrypted lixianssp channel as addOfflineTask. Used to drop a magnet
    // that did NOT 秒传: 115 had no cached copy and queued a real download we
    // don't want — removing it frees the offline quota and avoids junk tasks.
    const payload: Record<string, string> = { ac: "task_del", app_ver: "99.99.99.99" };
    input.infoHashes.forEach((hash, index) => {
      payload[`hash[${index}]`] = hash;
    });
    const encrypted = lixianRsaEncrypt(new TextEncoder().encode(JSON.stringify(payload)));
    const response = await this.postForm(
      PAN115_LIXIAN_SSP_URL,
      [["data", encrypted]],
      { "User-Agent": PAN115_ANDROID_USER_AGENT },
    );
    return actionResultFromResponse(response);
  }

  /** List the account's cloud-download (offline) tasks. Plain cookie-authed web
   *  GET — no sign, plaintext JSON. Used to find junk/stuck tasks to cancel. */
  async listOfflineTasks(input?: { page?: number }): Promise<Pan115OfflineTask[]> {
    const response = await this.getJson(PAN115_LIXIAN_WEB_URL, [
      ["ac", "task_lists"],
      ["page", String(input?.page ?? 1)],
    ]);
    return arrayValue(recordValue(response, "tasks"))
      .filter(isRecord)
      .map((task) => ({
        infoHash: stringValue(recordValue(task, "info_hash")),
        name: stringValue(recordValue(task, "name")),
        percentDone: numberValue(recordValue(task, "percentDone")),
        status: numberValue(recordValue(task, "status")),
        statusText: stringValue(recordValue(task, "status_text")),
        url: stringValue(recordValue(task, "url")),
      }));
  }

  async moveItems(input: { fileIds: string[]; targetDirectoryId: string }): Promise<Pan115ActionResult> {
    const fields: Array<[string, string]> = [["pid", input.targetDirectoryId]];
    input.fileIds.forEach((fileId, index) => fields.push([`fid[${index}]`, fileId]));
    const response = await this.postForm(`${PAN115_WEBAPI_BASE_URL}/files/move`, fields);
    return actionResultFromResponse(response);
  }

  async deleteItems(input: { fileIds: string[] }): Promise<Pan115ActionResult> {
    const fields = input.fileIds.map((fileId, index) => [`fid[${index}]`, fileId] as [string, string]);
    const response = await this.postForm(`${PAN115_WEBAPI_BASE_URL}/rb/delete`, fields);
    return actionResultFromResponse(response);
  }

  async renameFile(input: { fileId: string; newName: string }): Promise<Pan115ActionResult> {
    const response = await this.postForm(`${PAN115_WEBAPI_BASE_URL}/files/batch_rename`, [
      [`files_new_name[${input.fileId}]`, input.newName],
    ]);
    return actionResultFromResponse(response);
  }

  private async getJson(url: string, params: Array<[string, string]>): Promise<unknown> {
    const query = new URLSearchParams(params);
    return this.fetchJson(`${url}?${query.toString()}`, {
      method: "GET",
      headers: this.headers(),
    });
  }

  private async postForm(
    url: string,
    fields: Array<[string, string]>,
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    const body = new URLSearchParams(fields).toString();
    return this.fetchJson(url, {
      method: "POST",
      headers: {
        ...this.headers(),
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body,
    });
  }

  private headers(): Record<string, string> {
    return {
      Cookie: this.cookie,
      "User-Agent": this.userAgent,
      Accept: "application/json, text/plain, */*",
    };
  }
}

export function createPan115CookieClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): Pan115CookieClient {
  const cookie = normalizeCookie(env["PAN115_COOKIE"]);
  if (!cookie) {
    throw new Error("PAN115_COOKIE is required to create Pan115CookieClient");
  }
  return new Pan115CookieClient({ cookie });
}

async function defaultFetchJson(url: string, init: Pan115HttpInit): Promise<unknown> {
  const requestInit: RequestInit = {
    method: init.method,
    headers: init.headers,
  };
  if (init.body !== undefined) {
    requestInit.body = init.body;
  }
  const response = await fetch(url, requestInit);
  if (!response.ok) {
    throw new Error(`PAN115_HTTP_FAILED: ${response.status}`);
  }
  return response.json();
}

function actionResultFromResponse(response: unknown): Pan115ActionResult {
  return {
    ok: responseState(response),
    message: responseMessage(response),
  };
}

/** lixianssp returns errcode 10008 / error_msg "任务已存在" when the infohash is
 *  already queued. 115 recognized the resource, so we count it as accepted. */
function isOfflineTaskAlreadyExists(response: unknown): boolean {
  if (!isRecord(response)) {
    return false;
  }
  const errcode = response["errcode"] ?? response["errno"] ?? response["code"];
  if (errcode === 10008 || errcode === "10008") {
    return true;
  }
  return responseMessage(response).includes("已存在");
}

function responseState(response: unknown): boolean {
  if (!isRecord(response)) {
    return false;
  }
  const state = response["state"];
  if (typeof state === "boolean") {
    return state;
  }
  if (typeof state === "number") {
    return state === 1;
  }
  if (typeof state === "string") {
    return state === "1" || state.toLowerCase() === "true";
  }
  return false;
}

function responseMessage(response: unknown): string {
  // Prefer the human-readable fields. lixianssp failures carry the real reason
  // in `error_msg` ("任务已存在") while `errtype` is only a coarse class ("war").
  return stringValue(
    recordValue(response, "msg") ??
      recordValue(response, "message") ??
      recordValue(response, "error_msg") ??
      recordValue(response, "error") ??
      recordValue(response, "errtype"),
  );
}

/**
 * The cookie is dead (e.g. the user logged in elsewhere, changed password, or it
 * expired). 115 signals this as HTTP 200 + `{state:false, errno:990001,
 * error:"登录超时，请重新登录。"}` (captured live). Distinct from a transient
 * `state:false` jitter or a bad-param error — so the worker can FREEZE the drive
 * on this specifically, not on every failure. Detect, don't predict.
 */
export class Pan115AuthError extends Error {
  readonly errno: number | null;
  constructor(message: string, errno: number | null = null) {
    super(message);
    this.name = "Pan115AuthError";
    this.errno = errno;
  }
}

export function isPan115AuthError(error: unknown): error is Pan115AuthError {
  return error instanceof Pan115AuthError;
}

/** The 115 auth-failure errno, captured live. */
const PAN115_AUTH_ERRNO = 990001;

/** True only for a CONFIRMED authentication failure (cookie dead) — keyed on the
 *  real errno 990001, with a message fallback for robustness against API drift.
 *  NOT true for transient jitter or non-auth errors. */
function isAuthFailure(response: unknown): boolean {
  if (responseState(response)) {
    return false;
  }
  const errno = isRecord(response) ? (response["errno"] ?? response["errNo"] ?? response["errcode"]) : undefined;
  if (errno === PAN115_AUTH_ERRNO || errno === String(PAN115_AUTH_ERRNO)) {
    return true;
  }
  return /登录|登陆|未登录|重新登录|relogin|not.?login/i.test(responseMessage(response));
}

/** Throw a Pan115AuthError when the failure is a dead cookie, else the generic
 *  Error the caller specifies. Centralizes the auth-vs-other decision. */
function throwResponseFailure(response: unknown, genericMessage: string): never {
  if (isAuthFailure(response)) {
    const errnoRaw = isRecord(response) ? (response["errno"] ?? response["errNo"]) : null;
    const errno = typeof errnoRaw === "number" ? errnoRaw : null;
    throw new Pan115AuthError(`PAN115_AUTH_FAILED: ${responseMessage(response)}`, errno);
  }
  throw new Error(genericMessage);
}

// The 115 /files response carries the full ancestor breadcrumb in `path`,
// from the account root down to and INCLUDING the queried directory itself,
// each entry with its real cid. No synthesis needed (unlike category/get, which
// omits the queried dir's own id).
function breadcrumbFromFilesResponse(response: unknown): Pan115DirectoryInfo["path"] {
  return arrayValue(recordValue(response, "path"))
    .filter(isRecord)
    .map((item) => ({
      cid: stringValue(recordValue(item, "cid")),
      name: stringValue(recordValue(item, "name")),
    }))
    .filter((item) => item.cid || item.name);
}

function buildShareReferer(shareCode: string, receiveCode: string): string {
  return `https://115cdn.com/s/${shareCode}?password=${receiveCode}&`;
}

function normalizeCookie(cookie: string | undefined): string {
  const trimmed = cookie?.trim() ?? "";
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
