/**
 * 天翼云盘 (Tianyi Cloud / cloud.189.cn) HTTP client — the brand-4 analogue of
 * QuarkCookieClient. Like 夸克, 天翼 is a pure "transfer-share" (转存分享) brand
 * (no offline/magnet API); like 光鸭, it is token-auth (session self-heal +
 * onCredentialRefresh persistence) rather than cookie-auth.
 *
 * v1 uses ONLY the WEB face `cloud.189.cn/api/open/*` (auth = `?sessionKey=<sk>`
 * query, NO signature). The api.cloud.189.cn HMAC face is intentionally NOT
 * implemented. Session self-heal (renewSession) does touch the api.cloud.189.cn /
 * open.e.189.cn OPEN face for `getSessionForPC` / `refreshToken.do`.
 *
 * 🔴 THE root cause this brand exists to solve: 天翼's fileId/shareId/taskId/
 * targetFolderId are 18-digit int64 (e.g. 924511245739356595) which exceed JS
 * Number.MAX_SAFE_INTEGER. Plain JSON.parse silently ROUNDS them → a corrupted,
 * non-existent fileId → SHARE_SAVE is accepted (returns taskId) but the task hangs
 * forever at taskStatus=1. The fix: stringify these id fields BEFORE JSON.parse.
 * `parseTianyiJson` is the SINGLE json-parse entry point for every response — no
 * response is ever handed to raw JSON.parse.
 */

const WEB_BASE = "https://cloud.189.cn";
const API_BASE = "https://api.cloud.189.cn"; // OPEN face — getSessionForPC (token exchange)
const AUTH_BASE = "https://open.e.189.cn"; // OPEN face — refreshToken.do
const ROOT_FOLDER_ID = "-11"; // 个人云根目录 (spec §3)

const APP_ID = "8025431004";
const CLIENT_TYPE_PC = "TELEPC";
const CLIENT_VERSION = "6.2";
const CHANNEL_ID = "web_cloud.189.cn";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36";

const DEFAULT_POLL_ATTEMPTS = 60;
const DEFAULT_SAVE_POLL_INTERVAL_MS = 2000;
const DEFAULT_TASK_POLL_INTERVAL_MS = 1500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** id 字段名:天翼这些字段是 18 位 int64,JSON.parse 前必须先转字符串防精度丢失。
 *  ⚠️ 全 client 唯一的解析入口,任何响应都走它。字段清单以真跑通的探针脚本为准。
 *  ⚠️ INVARIANT: every name here is ALWAYS an integer id — NEVER a quantity/float
 *  (size/sizeBytes/capacity/…). Adding a numeric-but-non-id field would quote a
 *  16+-digit float (or an id that legitimately needs to stay a number) with the
 *  same regex, producing invalid JSON → parseTianyiJson returns null → the call
 *  fails loud. Only add fields that are pure opaque int64 identifiers. */
// `\s*` around the colon makes the guard FORMATTING-INDEPENDENT: JSON permits
// whitespace/newlines after (and before) `:`, so `"fileId": 924…` must be caught
// too — otherwise JSON.parse would silently round the int64, the exact root cause
// this client exists to prevent.
const BIGINT_ID_FIELDS =
  /"(id|fileId|shareId|taskId|targetFolderId|parentId|pId|shareDirFileId)"\s*:\s*(\d{16,})/g;

/** 唯一 JSON 解析入口:先把大整数 id 字段加引号转字符串,再 parse。见文件头「root cause」。 */
export function parseTianyiJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(BIGINT_ID_FIELDS, '"$1":"$2"'));
  } catch {
    return null;
  }
}

/**
 * The session/token is dead and could not be re-minted — distinct from a generic
 * API error so the worker can FREEZE the drive on this specifically. Mirrors
 * QuarkAuthError / GuangYaAuthError / Pan115AuthError.
 */
export class TianyiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TianyiAuthError";
  }
}

export function isTianyiAuthError(error: unknown): error is TianyiAuthError {
  return error instanceof TianyiAuthError;
}

/** 账号标识(keys UNIQUE(provider, provider_uid))。来源 = 登录 session 的 loginName
 *  (getSessionForPC 返回),连接时存进 payload.meta.loginName;这里从 blob 取。 */
export function parseTianyiUid(loginNameOrBlob: string): string | null {
  const v = (loginNameOrBlob ?? "").trim();
  return v || null;
}

/** The credential blob persisted in connected_storages.payload (light 光鸭 先例). */
export interface TianyiCredential {
  sessionKey: string;
  accessToken: string;
  refreshToken: string;
  familySessionKey?: string;
  loginName?: string;
}

export interface TianyiHttpInit {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export type TianyiFetch = (url: string, init: TianyiHttpInit) => Promise<{ status: number; text: string }>;

/** 统一 item:folderList/fileList 两数组合并后的形状。 */
export interface TianyiItem {
  id: string;
  name: string;
  size: number;
  md5: string;
  isFolder: boolean;
}

/** A DELETE/MOVE batch-task entry: id + folderness (+ name when the caller has
 *  one at hand). See batchTaskInfos for why isFolder is load-bearing. */
export interface TianyiBatchEntry {
  id: string;
  name?: string;
  isFolder: boolean;
}

/** SHARE_SAVE 的结果:ok=真正落盘且无文件被拦;failed=被和谐/失败文件数。 */
export interface TianyiSaveResult {
  ok: boolean;
  failed: number;
  message: string;
}

export interface TianyiClientOptions {
  sessionKey: string;
  accessToken: string;
  refreshToken: string;
  familySessionKey?: string;
  fetchImpl?: TianyiFetch;
  /** Injectable sleep between poll attempts (tests pass a no-op). */
  sleepImpl?: (ms: number) => Promise<void>;
  /** 会话/token 自愈后回写 DB(credential blob),复用光鸭 onCredentialRefresh 模式。 */
  onCredentialRefresh?: (creds: TianyiCredential) => void | Promise<void>;
}

export class TianyiClient {
  private sessionKey: string;
  private accessToken: string;
  private refreshToken: string;
  private familySessionKey: string | undefined;
  private readonly fetchImpl: TianyiFetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly onCredentialRefresh: ((creds: TianyiCredential) => void | Promise<void>) | undefined;
  private noCachSeq = 0;

  constructor(opts: TianyiClientOptions) {
    this.sessionKey = opts.sessionKey?.trim() ?? "";
    this.accessToken = opts.accessToken?.trim() ?? "";
    this.refreshToken = opts.refreshToken?.trim() ?? "";
    this.familySessionKey = opts.familySessionKey?.trim() || undefined;
    this.fetchImpl = opts.fetchImpl ?? defaultTianyiFetch;
    this.sleepFn = opts.sleepImpl ?? sleep;
    this.onCredentialRefresh = opts.onCredentialRefresh;
  }

  // ── WEB 面传输(sessionKey query + 会话自愈) ───────────────────────────────

  private async webGet(
    path: string,
    params: Array<[string, string]>,
    retried = false,
  ): Promise<Record<string, unknown>> {
    const q = new URLSearchParams(params);
    q.set("noCach", this.nextNoCach());
    q.set("sessionKey", this.sessionKey);
    const res = await this.fetchImpl(`${WEB_BASE}${path}?${q.toString()}`, {
      method: "GET",
      headers: this.webHeaders(),
    });
    return this.unwrap(res, path, () => this.webGet(path, params, true), retried);
  }

  /** POST 也把 sessionKey + noCach 放 QUERY(探针 web() 对 GET/POST 一视同仁),body 仅带
   *  caller 的 form 字段。sessionKey 放 body 会被真网络拒绝(探针证 query 才对)。 */
  private async webPost(
    path: string,
    form: Record<string, string>,
    retried = false,
  ): Promise<Record<string, unknown>> {
    const q = new URLSearchParams();
    q.set("noCach", this.nextNoCach());
    q.set("sessionKey", this.sessionKey);
    const body = new URLSearchParams(form).toString();
    const res = await this.fetchImpl(`${WEB_BASE}${path}?${q.toString()}`, {
      method: "POST",
      headers: { ...this.webHeaders(), "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return this.unwrap(res, path, () => this.webPost(path, form, true), retried);
  }

  /** 缓存穿透 token(探针用 Math.random());WEB GET 会缓存,不带则 SHARE_SAVE 后
   *  listFiles 回读可能拿到陈旧空列表→执行器 before/after diff 误判 no_target_change。
   *  Date.now()+单调计数器保证同毫秒内也唯一。 */
  private nextNoCach(): string {
    this.noCachSeq += 1;
    return `${Date.now()}-${this.noCachSeq}`;
  }

  private webHeaders(): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      Accept: "application/json;charset=UTF-8",
      Referer: `${WEB_BASE}/web/main/`,
    };
  }

  /** envelope 判定 + 会话自愈(重试一次)。res_code===0/缺省=成功;失效信号→重新拿 session。 */
  private async unwrap(
    res: { status: number; text: string },
    path: string,
    retry: () => Promise<Record<string, unknown>>,
    retried: boolean,
  ): Promise<Record<string, unknown>> {
    const parsed = parseTianyiJson(res.text);
    // Fail LOUD on a non-JSON body (transient 502/429, WAF/gateway HTML page).
    // Never collapse null → {} → "res_code undefined = success", or an upstream
    // outage would masquerade as an empty directory / "分享为空" (the TMDB-outage
    // -as-empty bug this codebase was burned by). A valid JSON object with no
    // res_code is still treated as success below (some endpoints omit it).
    if (parsed === null) {
      throw new Error(`TIANYI_HTTP_FAILED: status=${res.status} non-JSON body`);
    }
    const data = parsed as Record<string, unknown>;
    // 天翼 SUCCESS 走 res_code(0/缺省);AUTH/错误走 errorCode/errorMsg(+HTTP 4xx),
    // 例如真号实测:HTTP 400 `{"errorCode":"InvalidSessionKey","errorMsg":"check ip error…"}`。
    // 只读 res_code 会让 code=undefined → 错误对象被当空目录返回(fail-quiet)。两套 envelope 都读。
    const code = data["res_code"] ?? data["errorCode"];
    const message = String(data["res_message"] ?? data["errorMsg"] ?? "");
    if (isSessionDead(code, message)) {
      if (retried) {
        throw new TianyiAuthError(`TIANYI_AUTH_FAILED: ${message || "session invalid"}`);
      }
      await this.renewSession(); // 失败会抛 TianyiAuthError;getSessionForPC 重签当前 IP
      return retry();
    }
    // 非 2xx 且无可识别成功 envelope(code 仍 undefined/null)→ 失败 loud,
    // 绝不把 4xx 错误体当成空目录 [] 返回。放在 isSessionDead 之后,故 400 InvalidSessionKey 仍走自愈。
    if (res.status >= 400 && (code === undefined || code === null)) {
      throw new Error(
        `TIANYI_${path.replace(/[^a-z]/gi, "_")}_FAILED: status=${res.status} ${message || res.text.slice(0, 120)}`,
      );
    }
    if (code !== 0 && code !== undefined && code !== "0") {
      throw new Error(`TIANYI_${path.replace(/[^a-z]/gi, "_")}_FAILED: res_code=${String(code)} ${message}`);
    }
    return data;
  }

  /**
   * 会话自愈:accessToken → getSessionForPC 换 sessionKey;若失败 → refreshToken.do
   * 换新 accessToken → 再 getSessionForPC。成功 → 更新全套凭证 + await onCredentialRefresh;
   * 两步都失败 → throw TianyiAuthError。序列 lift 自真跑通的探针
   * (tianyi-qr-poll.mjs / tianyi-probe-login.mjs)与 wes-lin/cloud189-sdk。
   */
  private async renewSession(): Promise<void> {
    // 1) 尝试 getSessionForPC(accessToken)
    let session = await this.exchangeAccessTokenForSession(this.accessToken);
    // 2) 失败(accessToken 过期)→ refreshToken.do 换新 accessToken → 再 getSessionForPC
    if (!session && this.refreshToken) {
      const refreshed = await this.refreshAccessToken(this.refreshToken);
      if (refreshed) {
        this.accessToken = refreshed.accessToken;
        if (refreshed.refreshToken) {
          this.refreshToken = refreshed.refreshToken;
        }
        session = await this.exchangeAccessTokenForSession(this.accessToken);
      }
    }
    if (!session) {
      throw new TianyiAuthError("TIANYI_SESSION_RENEW_FAILED: 会话续期失败,需重新登录天翼");
    }
    // 3) 更新全套凭证并回写
    this.sessionKey = session.sessionKey;
    if (session.accessToken) {
      this.accessToken = session.accessToken;
    }
    if (session.refreshToken) {
      this.refreshToken = session.refreshToken;
    }
    if (session.familySessionKey) {
      this.familySessionKey = session.familySessionKey;
    }
    if (this.onCredentialRefresh) {
      const creds: TianyiCredential = {
        sessionKey: this.sessionKey,
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
      };
      if (this.familySessionKey) {
        creds.familySessionKey = this.familySessionKey;
      }
      if (session.loginName) {
        creds.loginName = session.loginName;
      }
      await this.onCredentialRefresh(creds);
    }
  }

  /** POST api.cloud.189.cn/getSessionForPC.action?...&accessToken=<at> → 全套 session。
   *  参数 lift 自 wes-lin/cloud189-sdk getSessionForPC + 探针 clientSuffix。返回 null=失败。
   *  ⚠️ 此处带了 appId,而 QR redirectURL 变体不带 appId;两条探针都没跑过 accessToken 变体
   *  (只跑过 redirectURL 变体)。若 T10 live-e2e 会话续期失败,第一件事就是去掉这里的 appId 再试。 */
  private async exchangeAccessTokenForSession(accessToken: string): Promise<{
    sessionKey: string;
    accessToken: string;
    refreshToken: string;
    familySessionKey: string;
    loginName: string;
  } | null> {
    if (!accessToken) {
      return null;
    }
    const q = new URLSearchParams({
      appId: APP_ID,
      clientType: CLIENT_TYPE_PC,
      version: CLIENT_VERSION,
      channelId: CHANNEL_ID,
      rand: String(Date.now()),
      accessToken,
    });
    const res = await this.fetchImpl(`${API_BASE}/getSessionForPC.action?${q.toString()}`, {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, Accept: "application/json;charset=UTF-8" },
    });
    const data = parseTianyiJson(res.text) as Record<string, unknown> | null;
    if (!data) {
      return null;
    }
    const sessionKey = strId(data["sessionKey"]);
    if (!sessionKey) {
      return null; // res_code != 0 / missing sessionKey → 视为失败
    }
    return {
      sessionKey,
      accessToken: strId(data["accessToken"]),
      refreshToken: strId(data["refreshToken"]),
      familySessionKey: strId(data["familySessionKey"]),
      loginName: strId(data["loginName"]),
    };
  }

  /** POST open.e.189.cn/api/oauth2/refreshToken.do → 新 accessToken/refreshToken。
   *  参数 lift 自 wes-lin/cloud189-sdk refreshToken。返回 null=失败(refreshToken 死)。 */
  private async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
    const body = new URLSearchParams({
      clientId: APP_ID,
      refreshToken,
      grantType: "refresh_token",
      format: "json",
    }).toString();
    const res = await this.fetchImpl(`${AUTH_BASE}/api/oauth2/refreshToken.do`, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json;charset=UTF-8",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const data = parseTianyiJson(res.text) as Record<string, unknown> | null;
    if (!data) {
      return null;
    }
    const accessToken = strId(data["accessToken"]);
    if (!accessToken) {
      return null;
    }
    return { accessToken, refreshToken: strId(data["refreshToken"]) };
  }

  // ── 目录读 ───────────────────────────────────────────────────────────────

  async listFiles(folderId: string = ROOT_FOLDER_ID): Promise<TianyiItem[]> {
    const data = await this.webGet("/api/open/file/listFiles.action", [
      ["folderId", folderId],
      ["mediaType", "0"],
      ["orderBy", "lastOpTime"],
      ["descending", "true"],
      ["pageNum", "1"],
      ["pageSize", "1000"],
      ["iconOption", "0"],
    ]);
    return mergeTianyiListing(data["fileListAO"]);
  }

  // ── 转存链(SHARE_SAVE) ───────────────────────────────────────────────────

  /** getShareInfoByCodeV2 → 解析 shareId/fileId/shareMode/needAccessCode
   *  (int64 已被 parseTianyiJson 转字符串)。 */
  async getShareInfo(shareCode: string): Promise<{
    shareId: string;
    fileId: string;
    shareMode: string;
    needAccessCode: boolean;
  }> {
    const d = await this.webGet("/api/open/share/getShareInfoByCodeV2.action", [["shareCode", shareCode]]);
    return {
      shareId: strId(d["shareId"]),
      fileId: strId(d["fileId"]),
      shareMode: String(d["shareMode"] ?? "1"),
      needAccessCode: numOf(d["needAccessCode"]) === 1,
    };
  }

  /** 列分享目录(登录态空码穿透)。 */
  async listShareDir(input: {
    shareId: string;
    fileId: string;
    shareMode: string;
    accessCode: string;
  }): Promise<TianyiItem[]> {
    const d = await this.webGet("/api/open/share/listShareDir.action", [
      ["shareId", input.shareId],
      ["fileId", input.fileId],
      ["isFolder", "true"],
      ["shareMode", input.shareMode],
      ["accessCode", input.accessCode],
      ["orderBy", "lastOpTime"],
      ["descending", "true"],
      ["pageNum", "1"],
      ["pageSize", "1000"],
      ["iconOption", "0"],
    ]);
    return mergeTianyiListing(d["fileListAO"]);
  }

  /** SHARE_SAVE:登录态空码穿透;taskInfos.fileId 必须是字符串(bigint 铁律);md5 取到就带。
   *  轮询 taskStatus:1/3=继续、2=冲突(getConflictTaskInfo→manageBatchTask dealWay=1)、
   *  4=完成(必查 failedCount>0 = 文件被和谐)。 */
  async saveShare(input: {
    shareCode: string;
    accessCode: string;
    targetFolderId: string;
  }): Promise<TianyiSaveResult> {
    const info = await this.getShareInfo(input.shareCode);
    const items = await this.listShareDir({
      shareId: info.shareId,
      fileId: info.fileId,
      shareMode: info.shareMode,
      accessCode: input.accessCode,
    });
    const taskInfos = items.map((i) => ({
      fileId: i.id,
      fileName: i.name,
      isFolder: i.isFolder ? 1 : 0,
      ...(i.md5 ? { md5: i.md5 } : {}),
    }));
    if (taskInfos.length === 0) {
      return { ok: false, failed: 0, message: "分享为空 / 已失效(share empty / dead)" };
    }
    const created = await this.webPost("/api/open/batch/createBatchTask.action", {
      type: "SHARE_SAVE",
      taskInfos: JSON.stringify(taskInfos),
      targetFolderId: input.targetFolderId,
      shareId: info.shareId,
    });
    const taskId = strId(created["taskId"]);
    if (!taskId) {
      return { ok: false, failed: 0, message: "SHARE_SAVE 未返回 taskId(账号唯一转存槽可能占用)" };
    }
    return this.pollBatchTask(taskId, input.targetFolderId);
  }

  private async pollBatchTask(
    taskId: string,
    targetFolderId: string,
    maxPolls = DEFAULT_POLL_ATTEMPTS,
    intervalMs = DEFAULT_SAVE_POLL_INTERVAL_MS,
  ): Promise<TianyiSaveResult> {
    for (let i = 0; i < maxPolls; i++) {
      const d = await this.webPost("/api/open/batch/checkBatchTask.action", { type: "SHARE_SAVE", taskId });
      const status = numOf(d["taskStatus"]);
      if (status === 4) {
        const failed = numOf(d["failedCount"]);
        return {
          ok: failed === 0,
          failed,
          message: failed > 0 ? `${failed} 个文件被拦(可能被和谐)` : "",
        };
      }
      if (status === 2) {
        await this.resolveConflict(taskId, targetFolderId);
      }
      await this.sleepFn(intervalMs);
    }
    return { ok: false, failed: 0, message: "SHARE_SAVE 轮询超时(任务未完成)" };
  }

  /** 冲突裁决:getConflictTaskInfo → manageBatchTask{dealWay:1(忽略)}。序列 lift 自
   *  tianyi-save-bigint.mjs 真跑通的冲突分支 + cloud189-auto-save task.js。 */
  private async resolveConflict(taskId: string, targetFolderId: string): Promise<void> {
    const conflict = await this.webPost("/api/open/batch/getConflictTaskInfo.action", {
      taskId,
      type: "SHARE_SAVE",
    });
    const rawInfos = Array.isArray(conflict["taskInfos"]) ? (conflict["taskInfos"] as unknown[]) : [];
    const taskInfos = rawInfos
      .filter(isRecord)
      .map((t) => ({ ...t, dealWay: 1, isConflict: 1 }));
    await this.webPost("/api/open/batch/manageBatchTask.action", {
      taskId,
      type: "SHARE_SAVE",
      targetFolderId: strId(conflict["targetFolderId"]) || targetFolderId,
      taskInfos: JSON.stringify(taskInfos),
    });
  }

  // ── 目录写 ───────────────────────────────────────────────────────────────

  async createFolder(input: { name: string; parentId: string }): Promise<string> {
    const d = await this.webPost("/api/open/file/createFolder.action", {
      parentFolderId: input.parentId,
      folderName: input.name,
    });
    const id = strId(d["id"]) || strId(d["fileId"]);
    if (!id) {
      throw new Error("TIANYI_CREATE_FOLDER_FAILED: response missing id");
    }
    return id;
  }

  async renameFile(input: { fileId: string; name: string }): Promise<void> {
    await this.webPost("/api/open/file/renameFile.action", {
      fileId: input.fileId,
      destFileName: input.name,
    });
  }

  /** DELETE/MOVE taskInfos entry. ⚠️ isFolder is LOAD-BEARING (probe
   *  tianyi-save-bigint.mjs cleanup, line ~81): a FOLDER was really deleted with
   *  {fileId, fileName, isFolder: 1} — hardcoding isFolder: 0 silently deletes
   *  nothing for a dir. fileName rides along when the caller knows it; a name-less
   *  folder DELETE is LIVE-VERIFIED (2026-07-17 T10 write smoke: {fileId, isFolder:1}
   *  without fileName → status=4/failedCount=0, folder really gone). MOVE taskInfos
   *  share this shape but a real MOVE hasn't run live yet (agent flatten will). */
  private static batchTaskInfos(entries: TianyiBatchEntry[]): string {
    return JSON.stringify(
      entries.map((e) => ({
        fileId: e.id,
        ...(e.name ? { fileName: e.name } : {}),
        isFolder: e.isFolder ? 1 : 0,
      })),
    );
  }

  async batchDelete(entries: TianyiBatchEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    const taskInfos = TianyiClient.batchTaskInfos(entries);
    const d = await this.webPost("/api/open/batch/createBatchTask.action", { type: "DELETE", taskInfos });
    await this.pollGenericTask(strId(d["taskId"]), "DELETE");
  }

  async moveFiles(input: { entries: TianyiBatchEntry[]; targetFolderId: string }): Promise<void> {
    if (input.entries.length === 0) {
      return;
    }
    const taskInfos = TianyiClient.batchTaskInfos(input.entries);
    const d = await this.webPost("/api/open/batch/createBatchTask.action", {
      type: "MOVE",
      taskInfos,
      targetFolderId: input.targetFolderId,
    });
    await this.pollGenericTask(strId(d["taskId"]), "MOVE");
  }

  /** Fail LOUD, mirroring pollBatchTask: a DELETE/MOVE that never started
   *  (no taskId), completed with failedCount>0, or never reached status 4 within
   *  the poll window must NOT look like success — silent-success here left the
   *  executor reporting {removed:true} over a zombie wrapper dir. */
  private async pollGenericTask(
    taskId: string,
    type: string,
    maxPolls = DEFAULT_POLL_ATTEMPTS,
    intervalMs = DEFAULT_TASK_POLL_INTERVAL_MS,
  ): Promise<void> {
    if (!taskId) {
      throw new Error(`TIANYI_${type}_FAILED: createBatchTask 未返回 taskId`);
    }
    for (let i = 0; i < maxPolls; i++) {
      const d = await this.webPost("/api/open/batch/checkBatchTask.action", { type, taskId });
      if (numOf(d["taskStatus"]) === 4) {
        const failed = numOf(d["failedCount"]);
        if (failed > 0) {
          throw new Error(`TIANYI_${type}_FAILED: ${failed} 项失败(failedCount>0)`);
        }
        return;
      }
      await this.sleepFn(intervalMs);
    }
    throw new Error(`TIANYI_${type}_FAILED: 轮询超时(任务未完成)`);
  }
}

// ── module helpers ──────────────────────────────────────────────────────────

/** 会话失效信号:code(res_code 或 errorCode)为 InvalidSessionKey,或 message 含
 *  userSessionBO is null / 会话失效 / check ip error(IP 变更导致 session 绑定失效)。 */
function isSessionDead(code: unknown, message: string): boolean {
  if (code === "InvalidSessionKey") {
    return true;
  }
  // ⚠️ "sessionKey invalid" must stay ADJACENT (no `.*`): the dead-share envelope
  // (live 2026-07-17, res_code "ShareNotFound") reads "shareUserRightcheck() -
  // sessionKey=null, shareId=…, share not found or invalid." — a greedy
  // /sessionKey.*invalid/ spanned that whole clause and misread a DEAD SHARE as a
  // dead session (pointless renew + TIANYI_AUTH_FAILED, which the systemic-block
  // vocabulary then treats as an account-level block).
  return /userSessionBO is null|InvalidSessionKey|会话失效|sessionKey invalid|check ip error/i.test(message);
}

function mergeTianyiListing(fileListAO: unknown): TianyiItem[] {
  const ao = (fileListAO ?? {}) as { folderList?: unknown[]; fileList?: unknown[] };
  const out: TianyiItem[] = [];
  for (const f of ao.folderList ?? []) {
    const r = f as Record<string, unknown>;
    out.push({ id: strId(r["id"]), name: String(r["name"] ?? ""), size: 0, md5: "", isFolder: true });
  }
  for (const f of ao.fileList ?? []) {
    const r = f as Record<string, unknown>;
    out.push({
      id: strId(r["id"]),
      name: String(r["name"] ?? ""),
      size: numOf(r["size"]),
      md5: String(r["md5"] ?? ""),
      isFolder: false,
    });
  }
  return out;
}

/** id 已被 parseTianyiJson 转成 string;这里兜底 number→string(小 id 不触发 replace)。 */
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function defaultTianyiFetch(url: string, init: TianyiHttpInit): Promise<{ status: number; text: string }> {
  // HARD project rule "新外部HTTP一律带超时": a bare fetch with no AbortController hung
  // the whole app in the PanSou incident. 20s matches the WEB-face probes' budget.
  const requestInit: RequestInit = {
    method: init.method,
    headers: init.headers,
    signal: AbortSignal.timeout(20_000),
  };
  if (init.body !== undefined) {
    requestInit.body = init.body;
  }
  const res = await fetch(url, requestInit);
  return { status: res.status, text: await res.text() };
}
