/**
 * 夸克 (Quark) QR-code login — the brand-2 analogue of Pan115QrLoginClient.
 * CAS scan flow (client_id 532): getToken → user scans the su.quark.cn URL in
 * the 夸克 App → poll for the service_ticket → redeem it at pan.quark.cn for the
 * drive cookie. Endpoints reverse-engineered from community clients (QuarkPan /
 * quark-auto-save); the service_ticket→cookie redemption is the fragile hop and
 * is finally confirmed only by a real phone scan — cookie paste stays as fallback.
 */
import { parseQuarkUid } from "./quark-cookie-client.js";

export type QuarkQrFetchJson = (
  url: string,
  init: { method: string; headers?: Record<string, string> },
) => Promise<unknown>;

export interface QuarkQrRawResponse {
  status: number;
  headers: { getSetCookie: () => string[]; get: (name: string) => string | null };
}
export type QuarkQrRawFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; redirect?: "manual" },
) => Promise<QuarkQrRawResponse>;

export interface QuarkQrSession {
  token: string;
  /** String content to render as a QR (su.quark.cn URL); user scans in 夸克 App. */
  qrcodeContent: string;
}
export type QuarkQrStatus = "waiting" | "scanned" | "confirmed" | "expired";
export interface QuarkQrPollResult {
  status: QuarkQrStatus;
  serviceTicket?: string;
}
export interface QuarkQrCookie {
  cookie: string;
  providerUid: string;
}

const QUARK_QR_CLIENT_ID = "532";
const CAS = "https://uop.quark.cn/cas/ajax";
const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
/** Drive cookie keys the session rides on (assembled from Set-Cookie). */
const DRIVE_COOKIE_KEYS = ["__pus", "__uid", "__kps", "__ktd", "__puus", "_UP_A4A_11_", "_UP_D_"];

export class QuarkQrLoginClient {
  private readonly fetchJson: QuarkQrFetchJson;
  private readonly rawFetch: QuarkQrRawFetch;
  private readonly userAgent: string;

  constructor(options: { fetchJson?: QuarkQrFetchJson; rawFetch?: QuarkQrRawFetch; userAgent?: string } = {}) {
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.rawFetch = options.rawFetch ?? defaultRawFetch;
    this.userAgent = options.userAgent ?? DEFAULT_UA;
  }

  async getToken(): Promise<QuarkQrSession> {
    const q = `client_id=${QUARK_QR_CLIENT_ID}&v=1.2&request_id=${randomId()}&uc_param_str=`;
    const res = asRecord(
      await this.fetchJson(`${CAS}/getTokenForQrcodeLogin?${q}`, { method: "GET", headers: this.headers() }),
    );
    const token = stringValue(asRecord(asRecord(res["data"])["members"])["token"]);
    if (!token) {
      throw new Error("QUARK_QR_TOKEN_FAILED: no token in response");
    }
    const qrcodeContent = `https://su.quark.cn/4_eMHBJ?token=${encodeURIComponent(token)}&client_id=${QUARK_QR_CLIENT_ID}&v=1.2&uc_param_str=`;
    return { token, qrcodeContent };
  }

  async pollStatus(session: QuarkQrSession): Promise<QuarkQrPollResult> {
    const q = `client_id=${QUARK_QR_CLIENT_ID}&v=1.2&request_id=${randomId()}&token=${encodeURIComponent(session.token)}&uc_param_str=`;
    const res = asRecord(
      await this.fetchJson(`${CAS}/getServiceTicketByQrcodeToken?${q}`, { method: "GET", headers: this.headers() }),
    );
    const status = numberValue(res["status"]);
    const ticket = stringValue(asRecord(asRecord(res["data"])["members"])["service_ticket"]);
    if (status === 2000000 && ticket) {
      return { status: "confirmed", serviceTicket: ticket };
    }
    if (/expire|invalid|过期|失效/i.test(stringValue(res["message"]))) {
      return { status: "expired" };
    }
    return { status: "waiting" };
  }

  async exchangeCookie(serviceTicket: string): Promise<QuarkQrCookie> {
    // The CAS service_ticket is redeemed at pan.quark.cn; the drive cookies are
    // Set-Cookie'd across the redirect chain. Follow manually, accumulate.
    const jar = new Map<string, string>();
    let url: string | null = `https://pan.quark.cn/account/info?st=${encodeURIComponent(serviceTicket)}&fr=pc&platform=pc`;
    for (let hop = 0; hop < 6 && url; hop++) {
      const res: QuarkQrRawResponse = await this.rawFetch(url, {
        method: "GET",
        headers: this.headers(),
        redirect: "manual",
      });
      for (const raw of res.headers.getSetCookie()) {
        const pair = raw.split(";")[0] ?? "";
        const eq = pair.indexOf("=");
        if (eq > 0) {
          jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
        }
      }
      const loc = res.headers.get("location");
      url = res.status >= 300 && res.status < 400 && loc ? absolutize(loc, url) : null;
    }
    const cookie = DRIVE_COOKIE_KEYS.filter((k) => jar.has(k))
      .map((k) => `${k}=${jar.get(k)}`)
      .join("; ");
    const providerUid = parseQuarkUid(cookie);
    if (!jar.has("__pus") || !providerUid) {
      throw new Error(
        "QUARK_QR_EXCHANGE_FAILED: no drive cookie (missing __pus/__uid) — the service_ticket may be stale or the exchange endpoint changed",
      );
    }
    return { cookie, providerUid };
  }

  private headers(): Record<string, string> {
    return {
      "User-Agent": this.userAgent,
      Referer: "https://pan.quark.cn/",
      Accept: "application/json, text/plain, */*",
    };
  }
}

function absolutize(loc: string, base: string): string {
  try {
    return new URL(loc, base).toString();
  } catch {
    return loc;
  }
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

async function defaultFetchJson(
  url: string,
  init: { method: string; headers?: Record<string, string> },
): Promise<unknown> {
  const res = await fetch(url, { method: init.method, ...(init.headers ? { headers: init.headers } : {}) });
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`QUARK_QR_HTTP_FAILED: ${res.status}`);
  }
}

async function defaultRawFetch(
  url: string,
  init: { method: string; headers?: Record<string, string>; redirect?: "manual" },
): Promise<QuarkQrRawResponse> {
  const res = await fetch(url, {
    method: init.method,
    redirect: init.redirect ?? "manual",
    ...(init.headers ? { headers: init.headers } : {}),
  });
  return {
    status: res.status,
    headers: { getSetCookie: () => res.headers.getSetCookie(), get: (n) => res.headers.get(n) },
  };
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}
function stringValue(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}
function numberValue(v: unknown): number {
  return typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
}
