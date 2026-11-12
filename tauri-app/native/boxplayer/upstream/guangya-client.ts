/**
 * 光鸭云盘 (GuangYaPan) HTTP client — the brand-3 analogue of Pan115CookieClient
 * and QuarkCookieClient. Unlike those two (cookie auth), 光鸭 uses OAuth Bearer
 * tokens (access_token + refresh_token) issued by `account.guangyapan.com`.
 *
 * Two hosts:
 *  - account.guangyapan.com — auth (validate user, refresh token). Bearer only.
 *  - api.guangyapan.com     — files + offline. Bearer + `Did:<deviceId>` + `Dt:4`.
 *
 * SUCCESS SIGNAL: `msg === ""` OR `msg.toLowerCase() === "success"`. The `code`
 * field is null on every response and MUST NOT be used as the signal.
 *
 * On a 401 the access_token is stale; we refresh once (POST /v1/auth/token with
 * the refresh_token) and retry the call. A fresh access/refresh pair is surfaced
 * via `onTokensRefreshed` so the executor can persist it. The executor that uses
 * this client (StorageExecutor) is a later task — this file is the API layer only.
 */

export const GUANGYA_CLIENT_ID = "aMe-8VSlkrbQXpUR";

const AUTH_HOST = "https://account.guangyapan.com";
const API_HOST = "https://api.guangyapan.com";

const DEFAULT_LIST_PAGE_SIZE = 100;

/** A directory listing entry from get_file_list. */
export interface GuangYaItem {
  fileId: string;
  parentId: string;
  fileName: string;
  fileSize: number;
  resType: number;
}

/** One subfile inside a bt/磁力 resource (fileIndex is null when the API omits it). */
export interface GuangYaSubfile {
  fileName: string;
  fileIndex: number | null;
  fileSize: number;
}

/** resolve_res result, parsed into the typed shape the executor relies on. */
export interface GuangYaResolvedRes {
  resType: number;
  url?: string;
  btResInfo?: {
    infoHash: string;
    fileName: string;
    subfiles: GuangYaSubfile[];
  };
}

/** One offline-task status row from list_task. */
export interface GuangYaTaskStatus {
  taskId: string;
  status: number;
  progress: number;
  fileId: string;
}

/** The token pair (+ the device id they were bound to) handed to the persist hook. */
export interface GuangYaTokens {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
}

export type GuangYaFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface GuangYaClientOptions {
  accessToken: string;
  refreshToken: string;
  /** Stable per-install device id sent as the `Did` header. Auto-generated (32 hex) if empty. */
  deviceId?: string;
  /** Called after a successful refresh so the caller can persist the new tokens. */
  onTokensRefreshed?: (tokens: GuangYaTokens) => void | Promise<void>;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: GuangYaFetch;
}

/**
 * The token pair is dead / refresh failed — distinct from a generic API error so
 * the worker can FREEZE the drive on this specifically. Mirrors QuarkAuthError /
 * Pan115AuthError.
 */
export class GuangYaAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuangYaAuthError";
  }
}

export function isGuangYaAuthError(error: unknown): error is GuangYaAuthError {
  return error instanceof GuangYaAuthError;
}

/**
 * Decode the `sub` (user id) from a 光鸭 access_token (a JWT). Returns the sub
 * string, or null when the token is malformed / missing a sub. Keys the
 * instance-wide UNIQUE(provider, provider_uid).
 */
export function parseGuangYaUid(accessToken: string): string | null {
  const segments = accessToken.split(".");
  const payloadSegment = segments[1];
  if (!payloadSegment) {
    return null;
  }
  try {
    const payloadJson = Buffer.from(payloadSegment, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as unknown;
    const sub = recordValue(payload, "sub");
    return typeof sub === "string" && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

export class GuangYaClient {
  private accessToken: string;
  private refreshToken: string;
  private readonly deviceId: string;
  private readonly onTokensRefreshed: ((tokens: GuangYaTokens) => void | Promise<void>) | undefined;
  private readonly fetchImpl: GuangYaFetch;

  constructor(options: GuangYaClientOptions) {
    // Trim tokens defensively (mirrors TianyiClient): the credential extraction now
    // hands over the raw stored blob, so the client is the single place that
    // sanitizes — a stray-whitespace token (e.g. from a refresh response) never
    // reaches the `Bearer` header.
    this.accessToken = options.accessToken.trim();
    this.refreshToken = options.refreshToken.trim();
    this.deviceId = options.deviceId?.trim() || generateGuangYaDeviceId();
    this.onTokensRefreshed = options.onTokensRefreshed;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  /** GET account/v1/user/me (Bearer); refresh+retry once on 401. Returns `sub`. */
  async validateToken(): Promise<string> {
    const sub = await this.getMeSub(false);
    if (!sub) {
      throw new GuangYaAuthError("GUANGYA_VALIDATE_FAILED: response missing sub");
    }
    return sub;
  }

  private async getMeSub(retried: boolean): Promise<string> {
    const response = await this.fetchImpl(`${AUTH_HOST}/v1/user/me`, {
      method: "GET",
      headers: this.authHeaders(),
    });
    if (response.status === 401) {
      if (retried) {
        throw new GuangYaAuthError("GUANGYA_VALIDATE_FAILED: 401 after refresh");
      }
      await this.refreshTokens();
      return this.getMeSub(true);
    }
    const body = (await response.json()) as unknown;
    const sub = recordValue(body, "sub");
    return typeof sub === "string" ? sub : "";
  }

  /** Paginate get_file_list into a flat GuangYaItem[]. */
  async listFiles(parentId: string, page = 0, pageSize = DEFAULT_LIST_PAGE_SIZE): Promise<GuangYaItem[]> {
    const items: GuangYaItem[] = [];
    let currentPage = page;
    for (;;) {
      const data = await this.postAPI("/userres/v1/file/get_file_list", {
        parentId,
        page: currentPage,
        pageSize,
        orderBy: 3,
        sortType: 1,
        fileTypes: [],
      });
      const list = arrayValue(recordValue(data, "list")).filter(isRecord);
      for (const raw of list) {
        items.push(toItem(raw));
      }
      if (list.length < pageSize) {
        break;
      }
      currentPage += 1;
    }
    return items;
  }

  /** Create a directory under `parentId`; returns the new fileId. */
  async createDir(parentId: string, dirName: string): Promise<string> {
    const data = await this.postAPI("/nd.bizuserres.s/v1/file/create_dir", { parentId, dirName });
    const fileId = stringValue(recordValue(data, "fileId"));
    if (!fileId) {
      throw new Error("GUANGYA_CREATE_DIR_FAILED: response missing data.fileId");
    }
    return fileId;
  }

  async renameFile(fileId: string, newName: string): Promise<void> {
    await this.postAPI("/nd.bizuserres.s/v1/file/rename", { fileId, newName });
  }

  async deleteFiles(fileIds: string[]): Promise<void> {
    await this.postAPI("/nd.bizuserres.s/v1/file/delete_file", { fileIds });
  }

  async moveFiles(fileIds: string[], parentId: string): Promise<void> {
    await this.postAPI("/nd.bizuserres.s/v1/file/move_file", { fileIds, parentId });
  }

  /** Resolve a share/magnet URL to its resType + (for bt) subfile listing. */
  async resolveRes(url: string): Promise<GuangYaResolvedRes> {
    const data = await this.postAPI("/cloudcollection/v1/resolve_res", { url });
    return toResolvedRes(data);
  }

  /** Create an offline-download task; returns the taskId. */
  async createTask(input: {
    url: string;
    parentId: string;
    newName: string;
    fileIndexes?: number[];
  }): Promise<string> {
    const body: Record<string, unknown> = {
      url: input.url,
      parentId: input.parentId,
      newName: input.newName,
    };
    if (input.fileIndexes !== undefined) {
      body.fileIndexes = input.fileIndexes;
    }
    const data = await this.postAPI("/cloudcollection/v1/create_task", body);
    const taskId = stringValue(recordValue(data, "taskId"));
    if (!taskId) {
      throw new Error("GUANGYA_CREATE_TASK_FAILED: response missing data.taskId");
    }
    return taskId;
  }

  /** Poll the status/progress of offline tasks. */
  async listTask(taskIds: string[]): Promise<GuangYaTaskStatus[]> {
    const data = await this.postAPI("/cloudcollection/v1/list_task", { taskIds });
    return arrayValue(recordValue(data, "list")).filter(isRecord).map(toTaskStatus);
  }

  /**
   * POST to the api host with Bearer + Did + Dt:4. On 401 (once) refresh and
   * retry. Success = `msg===""||msg==="success"`; otherwise throw (GuangYaAuthError
   * on 401, plain Error otherwise) carrying the server msg.
   */
  private async postAPI(path: string, body: unknown, retried = false): Promise<unknown> {
    const response = await this.fetchImpl(`${API_HOST}${path}`, {
      method: "POST",
      headers: this.apiHeaders(),
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      if (retried) {
        throw new GuangYaAuthError(`GUANGYA_AUTH_FAILED: 401 after refresh (${path})`);
      }
      await this.refreshTokens();
      return this.postAPI(path, body, true);
    }
    const json = (await response.json().catch(() => ({}))) as unknown;
    const msg = stringValue(recordValue(json, "msg"));
    if (response.ok && (msg === "" || msg.toLowerCase() === "success")) {
      return recordValue(json, "data");
    }
    throw new Error(`GUANGYA_API_FAILED: ${path} status=${response.status} msg=${msg}`);
  }

  /**
   * Exchange the refresh_token for a fresh access (and possibly refresh) token.
   * Updates in-memory tokens and notifies onTokensRefreshed. Throws
   * GuangYaAuthError on failure (refresh token dead).
   */
  private async refreshTokens(): Promise<void> {
    const response = await this.fetchImpl(`${AUTH_HOST}/v1/auth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: GUANGYA_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
      }),
    });
    const json = (await response.json()) as unknown;
    const accessToken = stringValue(recordValue(json, "access_token"));
    if (!response.ok || !accessToken) {
      const error = stringValue(recordValue(json, "error"));
      const description = stringValue(recordValue(json, "error_description"));
      throw new GuangYaAuthError(
        `GUANGYA_REFRESH_FAILED: ${error || response.status} ${description}`.trim(),
      );
    }
    this.accessToken = accessToken.trim();
    const refreshToken = stringValue(recordValue(json, "refresh_token"));
    if (refreshToken) {
      this.refreshToken = refreshToken.trim();
    }
    if (this.onTokensRefreshed) {
      await this.onTokensRefreshed({
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        deviceId: this.deviceId,
      });
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.accessToken}`,
    };
  }

  private apiHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.accessToken}`,
      Did: this.deviceId,
      Dt: "4",
    };
  }
}

/**
 * Generate a stable 光鸭 device id (32 hex chars) for the `Did` header. Call this
 * ONCE at connect time and persist the result so every worker run reuses the same
 * id — a fresh id each run looks like many devices to 光鸭's risk control. The
 * client's internal default (when no deviceId is supplied) calls this same helper.
 */
export function generateGuangYaDeviceId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

function toItem(raw: Record<string, unknown>): GuangYaItem {
  return {
    fileId: stringValue(raw.fileId),
    parentId: stringValue(raw.parentId),
    fileName: stringValue(raw.fileName),
    fileSize: numberValue(raw.fileSize),
    resType: numberValue(raw.resType),
  };
}

function toResolvedRes(data: unknown): GuangYaResolvedRes {
  const resolved: GuangYaResolvedRes = { resType: numberValue(recordValue(data, "resType")) };
  const url = recordValue(data, "url");
  if (typeof url === "string" && url.length > 0) {
    resolved.url = url;
  }
  const btRaw = recordValue(data, "btResInfo");
  if (isRecord(btRaw)) {
    resolved.btResInfo = {
      infoHash: stringValue(recordValue(btRaw, "infoHash")),
      fileName: stringValue(recordValue(btRaw, "fileName")),
      subfiles: arrayValue(recordValue(btRaw, "subfiles")).filter(isRecord).map(toSubfile),
    };
  }
  return resolved;
}

function toSubfile(raw: Record<string, unknown>): GuangYaSubfile {
  const idx = raw.fileIndex;
  return {
    fileName: stringValue(raw.fileName),
    fileIndex: typeof idx === "number" && Number.isFinite(idx) ? idx : null,
    fileSize: numberValue(raw.fileSize),
  };
}

function toTaskStatus(raw: Record<string, unknown>): GuangYaTaskStatus {
  return {
    taskId: stringValue(raw.taskId),
    status: numberValue(raw.status),
    progress: numberValue(raw.progress),
    fileId: stringValue(raw.fileId),
  };
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
