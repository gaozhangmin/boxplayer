/**
 * 天翼云盘 (Tianyi Cloud / cloud.189.cn) QR-code login — the brand-4 analogue of
 * Pan115QrLoginClient / QuarkQrLoginClient. Unlike 夸克 (CAS getToken flow), 天翼
 * rides the 189 "logbox" oauth2 flow and — like 115 — has a real
 * "scanned-awaiting-confirm" state:
 *
 *   getQrSession()   unifyLoginForPC (follow ≤6 redirects, harvest cookies each hop;
 *                    regex out lt/reqId/paramId) → getUUID.do → the QR encodes the
 *                    getUUID.do `uuid` FIELD verbatim. That field is NOT a bare id:
 *                    live capture proved it carries the FULL qrClinentLogin login URL
 *                    (open.e.189.cn/api/account/qrClinentLogin.do?paras=new_uuid=<x>|<appId>),
 *                    which is exactly what the 天翼 App scanner expects.
 *   pollStatus()     qrcodeLoginState.do, mapping 4 status codes
 *                    (-106 waiting / -11002 scanned / 0 confirmed / -11001 expired).
 *   exchangeSession()  after "confirmed", redeem the poll's redirectUrl at
 *                    getSessionForPC.action for the FULL session (personal + family
 *                    credentials in one shot).
 *   loginBySson()    SSON-cookie fallback (unifyLoginForPC → loginBySsoCooike with
 *                    Cookie: SSON=… → getSessionForPC).
 *
 * 🔴 THE make-or-break detail: the login cookie jar is STATEFUL. Cookies are
 * harvested (Set-Cookie) from unifyLoginForPC's redirect chain and MUST be sent on
 * BOTH qrcodeLoginState.do AND getSessionForPC.action — without them the poll /
 * exchange fail on the real network. The jar rides inside TianyiQrSession.cookies
 * so it round-trips through the browser between the qrcode/status/confirm routes
 * (ephemeral login cookies, like 115's {uid,time,sign}).
 *
 * ── Provenance (honesty matters; the brand's viability rode on byte-accuracy).
 *    Reconciled against the REAL probe scripts that ran against a live member
 *    account and succeeded via a real phone scan (scratchpad/tianyi-qr-init.mjs,
 *    tianyi-qr-poll.mjs, tianyi-probe-login.mjs) — those override any reference SDK.
 * • getQrSession — PROBE-VERIFIED (tianyi-qr-init.mjs): unifyLoginForPC URL/params,
 *   the ≤6-hop cookie-harvesting redirect follow, the `lt = "…"`/`paramId = "…"`/
 *   `reqId = "…"` regexes, getUUID.do form, and — critically — the QR content is
 *   `u.uuid` forwarded VERBATIM (probe: `QRCode.toFile(png, u.uuid)`). That is NOT
 *   a bare id: getUUID.do returns the FULL qrClinentLogin login URL in that field
 *   (open.e.189.cn/api/account/qrClinentLogin.do?paras=new_uuid=<x>|<appId>), so
 *   forwarding it verbatim — no construction, no bare-id substitution — is correct
 *   (live-verified; the App scanner needs the whole URL). A bare id is only the
 *   image route's defensive fallback, never what we encode here.
 * • pollStatus — PROBE-VERIFIED (tianyi-qr-poll.mjs): form (appId/clientType/
 *   returnUrl/paramId/uuid/encryuuid/date `YYYY-MM-DDHH:mm:ss.SSS`/timeStamp),
 *   Referer `https://open.e.189.cn` (no trailing slash)/Reqid/lt headers + jar, and
 *   the -106/-11002/0/-11001 codes. THE v1-critical piece; its test is load-bearing.
 * • exchangeSession — PROBE-VERIFIED (tianyi-qr-poll.mjs getSessionForPC): host +
 *   suffix {clientType:TELEPC, version:6.2, channelId:web_cloud.189.cn, rand} +
 *   `redirectURL` (from the poll's redirectUrl) + jar. NOTE: the probe's
 *   clientSuffix carries NO appId (differs from TianyiClient Task 1's accessToken
 *   variant — that one is a distinct call and out of scope here).
 * • loginBySson — REFERENCE-DERIVED, NOT probe-verified (spec §登录: SSON was not
 *   separately tested; 扫码 sufficed). The unifyLoginForPC + getSessionForPC(
 *   redirectURL) bytes ARE probe-verified (tianyi-probe-login.mjs); only the
 *   loginBySsoCooike middle hop is reference-derived (wes-lin/cloud189-sdk). The
 *   later live-e2e task must exercise this path. Tested at shape level.
 */

const APP_ID = "8025431004";
/** logbox/oauth2 QR face clientType (distinct from getSessionForPC's TELEPC). */
const QR_CLIENT_TYPE = "10020";
const PC_CLIENT_TYPE = "TELEPC";
const PC_VERSION = "6.2";
const PC_CHANNEL_ID = "web_cloud.189.cn";
const RETURN_URL = "https://m.cloud.189.cn/zhuanti/2020/loginErrorPc/index.html";

const WEB_HOST = "https://cloud.189.cn"; // portal entry (unifyLoginForPC)
const AUTH_HOST = "https://open.e.189.cn"; // logbox oauth2 (getUUID / qrcodeLoginState / SSON)
const API_HOST = "https://api.cloud.189.cn"; // OPEN face (getSessionForPC)

const UNIFY_LOGIN_PATH = "/api/portal/unifyLoginForPC.action";
const GET_UUID_PATH = "/api/logbox/oauth2/getUUID.do";
const QR_STATE_PATH = "/api/logbox/oauth2/qrcodeLoginState.do";
const SSO_LOGIN_PATH = "/api/logbox/oauth2/loginBySsoCooike.do"; // reference-derived
const GET_SESSION_PATH = "/getSessionForPC.action";

/** Probe's req() default Accept — used for every request (server returns HTML for
 *  unifyLoginForPC regardless). getSessionForPC overrides it to the short form. */
const DEFAULT_ACCEPT = "application/json;charset=UTF-8, text/plain, */*";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36";

const MAX_REDIRECT_HOPS = 6;

// Exact probe regexes (tianyi-qr-init.mjs / tianyi-probe-login.mjs).
const LT_RE = /lt = "(.+?)"/;
const PARAMID_RE = /paramId = "(.+?)"/;
const REQID_RE = /reqId = "(.+?)"/;

// ── phase-machine types ───────────────────────────────────────────────────────

export type TianyiQrStatus = "waiting" | "scanned" | "confirmed" | "expired";

/** Ephemeral login cookie jar as serializable entries (round-trips via the browser). */
export type TianyiQrCookieJar = Array<[string, string]>;

export interface TianyiQrRequestInit {
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface TianyiQrRawResponse {
  status: number;
  text: string;
  headers: {
    get: (name: string) => string | null;
    /** All Set-Cookie header values (Node fetch Headers.getSetCookie()). */
    getSetCookie: () => string[];
  };
}

/** Single injected transport seam (mirrors the probe's `req`): one hop,
 *  redirect: "manual", exposing status/text/Location/Set-Cookie. The client owns
 *  the cookie jar + redirect-follow loop. */
export type TianyiQrRawFetch = (url: string, init: TianyiQrRequestInit) => Promise<TianyiQrRawResponse>;

/** Everything the phase machine carries across getQrSession → pollStatus → exchange. */
export interface TianyiQrSession {
  uuid: string;
  encryuuid: string;
  paramId: string;
  reqId: string;
  lt: string;
  appId: string;
  clientType: string;
  returnUrl: string;
  /** Login cookies harvested in getQrSession; MUST be threaded through pollStatus
   *  + exchangeSession (see file header). */
  cookies: TianyiQrCookieJar;
  /** QR content: the getUUID.do `uuid` field forwarded verbatim (probe: genQRCode
   *  encodes u.uuid). NOT a bare id — that field carries the full qrClinentLogin
   *  login URL the 天翼 App scanner expects. */
  qrcodeContent?: string;
}

export interface TianyiQrPollResult {
  status: TianyiQrStatus;
  redirectUrl?: string;
  /** The jar after this poll (session.cookies + anything newly Set-Cookie'd) —
   *  the caller re-stores it so the confirm→exchange hop keeps a warm jar. */
  cookies: TianyiQrCookieJar;
}

/** getSessionForPC's full payload — ONE login yields BOTH personal + family
 *  credentials (spec §session 字段). */
export interface TianyiSession {
  sessionKey: string;
  sessionSecret: string;
  accessToken: string;
  refreshToken: string;
  familySessionKey: string;
  familySessionSecret: string;
  loginName: string;
}

export interface TianyiQrLoginClientOptions {
  rawFetch?: TianyiQrRawFetch;
  userAgent?: string;
}

export class TianyiQrLoginClient {
  private readonly rawFetch: TianyiQrRawFetch;
  private readonly userAgent: string;

  constructor(options: TianyiQrLoginClientOptions = {}) {
    this.rawFetch = options.rawFetch ?? defaultRawFetch;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  /**
   * unifyLoginForPC (follow redirects, harvest cookies; regex lt/reqId/paramId) →
   * getUUID.do → assemble the session. QR content = the getUUID.do `uuid` field
   * forwarded verbatim — LIVE-VERIFIED that field carries the full
   * `open.e.189.cn/api/account/qrClinentLogin.do?paras=new_uuid=<x>|<appId>` login
   * URL (NOT a bare id), which the 天翼 App scans.
   */
  async getQrSession(): Promise<TianyiQrSession> {
    const jar = new Map<string, string>();
    const { lt, reqId, paramId } = await this.initLoginParams(jar);
    const uuidRes = await this.request(
      `${AUTH_HOST}${GET_UUID_PATH}`,
      { method: "POST", body: formBody({ appId: APP_ID }), headers: FORM_CONTENT_TYPE },
      jar,
    );
    const u = parseJsonOrThrow(uuidRes, "getUUID.do");
    const uuid = stringValue(u["uuid"]);
    if (!uuid) {
      throw new Error("TIANYI_QR_UUID_FAILED: getUUID.do returned no uuid");
    }
    return {
      uuid,
      encryuuid: stringValue(u["encryuuid"]),
      paramId,
      reqId,
      lt,
      appId: APP_ID,
      clientType: QR_CLIENT_TYPE,
      returnUrl: RETURN_URL,
      cookies: [...jar],
      // getUUID.do's `uuid` field, forwarded verbatim — it IS the full qrClinentLogin
      // login URL (live-verified), NOT a bare id; the App scanner needs the whole URL.
      qrcodeContent: uuid,
    };
  }

  /**
   * One qrcodeLoginState.do round. THE v1-critical 4-state mapping (probe-verified).
   * Unknown / non-JSON responses fall through to "waiting" — never a false-confirm.
   * Threads the cookie jar in + the (possibly updated) jar back out.
   */
  async pollStatus(session: TianyiQrSession): Promise<TianyiQrPollResult> {
    const jar = new Map(session.cookies);
    const res = await this.request(
      `${AUTH_HOST}${QR_STATE_PATH}`,
      {
        method: "POST",
        headers: { ...FORM_CONTENT_TYPE, Referer: AUTH_HOST, Reqid: session.reqId, lt: session.lt },
        body: formBody({
          appId: session.appId,
          clientType: session.clientType,
          returnUrl: session.returnUrl,
          paramId: session.paramId,
          uuid: session.uuid,
          encryuuid: session.encryuuid,
          date: formatTianyiDate(new Date()),
          timeStamp: String(Date.now()),
        }),
      },
      jar,
    );
    const cookies: TianyiQrCookieJar = [...jar];
    const parsed = parseJson(res.text);
    if (parsed === null) {
      return { status: "waiting", cookies };
    }
    const state = asRecord(parsed);
    const status = numberValue(state["status"]);
    if (status === 0) {
      // numberValue coerces null/""/[] → 0, so a status:0 alone is NOT enough to
      // trust: a real confirm ALWAYS carries a redirectUrl (it's what we exchange).
      // Gate on it — no redirectUrl → not a real confirm, fall through to waiting.
      const redirectUrl = stringValue(state["redirectUrl"]);
      if (redirectUrl) {
        return { status: "confirmed", redirectUrl, cookies };
      }
    }
    if (status === -11002) {
      return { status: "scanned", cookies };
    }
    if (status === -11001) {
      return { status: "expired", cookies };
    }
    return { status: "waiting", cookies };
  }

  /**
   * Only call after pollStatus returned "confirmed". Redeems the poll's redirectUrl
   * at getSessionForPC.action (with the session's cookie jar) for the full session.
   * PROBE-VERIFIED (tianyi-qr-poll.mjs).
   */
  async exchangeSession(session: TianyiQrSession, redirectUrl: string): Promise<TianyiSession> {
    return this.getSessionForPC(redirectUrl, new Map(session.cookies));
  }

  /**
   * SSON-cookie fallback: unifyLoginForPC → loginBySsoCooike (Cookie: SSON=… + login
   * jar) → getSessionForPC. ⚠️ REFERENCE-DERIVED (wes-lin/cloud189-sdk), NOT
   * probe-verified — spec §登录 says SSON was not separately tested; the later
   * live-e2e task must exercise this path.
   */
  async loginBySson(sson: string): Promise<TianyiSession> {
    const trimmed = sson.trim();
    if (!trimmed) {
      throw new Error("TIANYI_SSON_LOGIN_FAILED: empty SSON cookie");
    }
    const jar = new Map<string, string>();
    const { lt, reqId, paramId } = await this.initLoginParams(jar);
    jar.set("SSON", trimmed); // the user's SSON rides the jar alongside login cookies
    const query = new URLSearchParams({
      appId: APP_ID,
      clientType: QR_CLIENT_TYPE,
      paramId,
      returnUrl: RETURN_URL,
      timeStamp: String(Date.now()),
    }).toString();
    const res = await this.request(
      `${AUTH_HOST}${SSO_LOGIN_PATH}?${query}`,
      { method: "GET", headers: { Referer: AUTH_HOST, Reqid: reqId, lt } },
      jar,
    );
    const redirectUrl = extractSsoRedirect(res);
    if (!redirectUrl) {
      throw new Error(
        "TIANYI_SSON_LOGIN_FAILED: loginBySsoCooike returned no redirect (SSON invalid/expired or endpoint changed)",
      );
    }
    return this.getSessionForPC(redirectUrl, jar);
  }

  // ── internal ───────────────────────────────────────────────────────────────

  /** unifyLoginForPC → the open.e.189.cn login page; regex out lt/reqId/paramId
   *  while harvesting cookies through the redirect chain into `jar`. */
  private async initLoginParams(
    jar: Map<string, string>,
  ): Promise<{ lt: string; reqId: string; paramId: string }> {
    const query = new URLSearchParams({
      appId: APP_ID,
      clientType: QR_CLIENT_TYPE,
      returnURL: RETURN_URL,
      timeStamp: String(Date.now()),
    }).toString();
    const page = await this.getFollow(`${WEB_HOST}${UNIFY_LOGIN_PATH}?${query}`, jar);
    const lt = grab(page.text, LT_RE);
    const paramId = grab(page.text, PARAMID_RE);
    const reqId = grab(page.text, REQID_RE);
    // reqId is validated alongside lt/paramId: pollStatus/loginBySson always send it
    // as the Reqid header, so an empty one would defer the failure to a later request
    // with a much less actionable error. The real unifyLoginForPC page always carries
    // all three (probe-confirmed) — fail fast here if any is missing.
    if (!lt || !paramId || !reqId) {
      throw new Error("TIANYI_QR_INIT_FAILED: could not parse lt/reqId/paramId from unifyLoginForPC page");
    }
    return { lt, reqId, paramId };
  }

  /** GET, following ≤MAX_REDIRECT_HOPS (6) redirects manually and harvesting
   *  cookies at every hop. The loop runs MAX_REDIRECT_HOPS+1 times: each redirect
   *  consumes a hop, and the +1 is the fetch of the final (non-redirect) page — so
   *  a full 6-redirect chain still reaches its destination instead of falsely
   *  throwing "too many redirects" on the last one. */
  private async getFollow(url: string, jar: Map<string, string>): Promise<TianyiQrRawResponse> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const res = await this.request(current, { method: "GET" }, jar);
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location") ?? res.headers.get("Location");
        if (!location) {
          return res;
        }
        current = absolutize(location, current);
        continue;
      }
      return res;
    }
    throw new Error("TIANYI_QR_INIT_FAILED: too many redirects from unifyLoginForPC");
  }

  /** getSessionForPC.action — TELEPC suffix + redirectURL (NO appId, per probe). */
  private async getSessionForPC(redirectUrl: string, jar: Map<string, string>): Promise<TianyiSession> {
    const query = new URLSearchParams({
      clientType: PC_CLIENT_TYPE,
      version: PC_VERSION,
      channelId: PC_CHANNEL_ID,
      rand: String(Date.now()),
      redirectURL: redirectUrl,
    }).toString();
    const res = await this.request(
      `${API_HOST}${GET_SESSION_PATH}?${query}`,
      { method: "POST", headers: { Accept: "application/json;charset=UTF-8" } },
      jar,
    );
    const data = parseJsonOrThrow(res, "getSessionForPC.action");
    const sessionKey = stringValue(data["sessionKey"]);
    if (!sessionKey) {
      throw new Error(
        `TIANYI_SESSION_EXCHANGE_FAILED: getSessionForPC returned no sessionKey ` +
          `(res_code=${stringValue(data["res_code"])} ${stringValue(data["res_message"])})`,
      );
    }
    return {
      sessionKey,
      sessionSecret: stringValue(data["sessionSecret"]),
      accessToken: stringValue(data["accessToken"]),
      refreshToken: stringValue(data["refreshToken"]),
      familySessionKey: stringValue(data["familySessionKey"]),
      familySessionSecret: stringValue(data["familySessionSecret"]),
      loginName: stringValue(data["loginName"]),
    };
  }

  /** One request: injects Cookie from the jar, then harvests Set-Cookie back into
   *  it (mirrors the probe's req() + applySetCookie). */
  private async request(
    url: string,
    init: TianyiQrRequestInit,
    jar: Map<string, string>,
  ): Promise<TianyiQrRawResponse> {
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Accept: DEFAULT_ACCEPT,
      ...(init.headers ?? {}),
    };
    if (jar.size > 0) {
      headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    const res = await this.rawFetch(url, {
      method: init.method,
      headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    harvestCookies(res, jar);
    return res;
  }
}

// ── module helpers ────────────────────────────────────────────────────────────

const FORM_CONTENT_TYPE: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };

function formBody(form: Record<string, string>): string {
  return new URLSearchParams(form).toString();
}

/** date format `YYYY-MM-DDHH:mm:ss.SSS` — day and time concatenated, NO separator,
 *  ms padded to 3 digits (copies the probe's formatDate). */
function formatTianyiDate(d: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, "0");
  const p3 = (n: number): string => String(n).padStart(3, "0");
  return (
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` +
    `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}`
  );
}

function grab(text: string, re: RegExp): string {
  return re.exec(text)?.[1] ?? "";
}

/** Merge a response's Set-Cookie values into the jar (name=value, first pair only). */
function harvestCookies(res: TianyiQrRawResponse, jar: Map<string, string>): void {
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) {
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
}

/** Pull the post-SSON redirect (toUrl) from a Location header or JSON/HTML body. */
function extractSsoRedirect(res: TianyiQrRawResponse): string {
  const location = res.headers.get("location") ?? res.headers.get("Location");
  if (location) {
    return location;
  }
  const parsed = parseJson(res.text);
  if (parsed !== null) {
    const record = asRecord(parsed);
    const fromJson =
      stringValue(record["toUrl"]) || stringValue(record["redirectUrl"]) || stringValue(record["redirect"]);
    if (fromJson) {
      return fromJson;
    }
  }
  return grab(res.text, /toUrl['"]?\s*[:=]\s*['"]([^'"]+)['"]/);
}

function absolutize(location: string, base: string): string {
  try {
    return new URL(location, base).toString();
  } catch {
    return location;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Parse a JSON body or fail LOUD carrying the HTTP status — never let a 502/WAF
 *  HTML page masquerade as a missing field (misattribution). NOTE: pollStatus
 *  deliberately does NOT use this — polling must tolerate gateway hiccups → waiting. */
function parseJsonOrThrow(res: TianyiQrRawResponse, label: string): Record<string, unknown> {
  const parsed = parseJson(res.text);
  if (parsed === null) {
    throw new Error(`TIANYI_QR_HTTP_FAILED: status=${res.status} non-JSON body from ${label}`);
  }
  return asRecord(parsed);
}

async function defaultRawFetch(url: string, init: TianyiQrRequestInit): Promise<TianyiQrRawResponse> {
  // HARD project rule: new external HTTP ALWAYS carries a timeout (a bare fetch hung
  // the whole app in the PanSou incident). 20s matches the probes' 15–20s budget.
  const res = await fetch(url, {
    method: init.method,
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    ...(init.headers ? { headers: init.headers } : {}),
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
  return {
    status: res.status,
    text: await res.text(),
    headers: {
      get: (name) => res.headers.get(name),
      getSetCookie: () => res.headers.getSetCookie(),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}
