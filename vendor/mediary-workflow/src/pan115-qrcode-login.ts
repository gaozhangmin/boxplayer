/**
 * 115 QR-code login: the 3-step unauthenticated flow used by the open-source
 * ecosystem (AList/115driver, p115client). No app keys — the `sign` comes
 * from step 1. The chosen `app` (client type) decides which existing 115
 * session gets kicked; mini-program types are effectively long-lived and
 * never collide with the user's browser session, so `alipaymini` is the
 * default.
 */

export type Pan115QrFetchJson = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<unknown>;

export interface Pan115QrSession {
  uid: string;
  time: number;
  sign: string;
  /** String content to render as a QR code client-side. */
  qrcodeContent: string;
}

export type Pan115QrStatus = "waiting" | "scanned" | "confirmed" | "expired" | "canceled";

export interface Pan115QrCookie {
  cookie: string;
  userId: number;
  userName: string;
  app: string;
}

export const PAN115_QR_LOGIN_APPS = [
  "alipaymini",
  "wechatmini",
  "tv",
  "android",
  "ios",
  "web",
] as const;

export type Pan115QrLoginApp = (typeof PAN115_QR_LOGIN_APPS)[number];

const QRCODE_API = "https://qrcodeapi.115.com";
const PASSPORT_API = "https://passportapi.115.com";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export class Pan115QrLoginClient {
  private readonly fetchJson: Pan115QrFetchJson;
  private readonly userAgent: string;

  constructor(options: { fetchJson?: Pan115QrFetchJson; userAgent?: string } = {}) {
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  async getToken(): Promise<Pan115QrSession> {
    const response = asRecord(
      await this.fetchJson(`${QRCODE_API}/api/1.0/web/1.0/token/`, {
        method: "GET",
        headers: this.headers(),
      }),
    );
    const data = asRecord(response["data"]);
    const uid = stringValue(data["uid"]);
    if (!uid) {
      throw new Error("PAN115_QR_TOKEN_FAILED: no uid in token response");
    }
    return {
      uid,
      time: numberValue(data["time"]),
      sign: stringValue(data["sign"]),
      qrcodeContent: stringValue(data["qrcode"]) || `https://115.com/scan/dg-${uid}`,
    };
  }

  /**
   * One long-poll round (the endpoint holds the connection ~30s). A timeout
   * response can omit `data.status` entirely — that means "still waiting",
   * not an error.
   */
  async pollStatus(session: Pan115QrSession): Promise<Pan115QrStatus> {
    const query = new URLSearchParams({
      uid: session.uid,
      time: String(session.time),
      sign: session.sign,
      _: String(Date.now()),
    });
    const response = asRecord(
      await this.fetchJson(`${QRCODE_API}/get/status/?${query.toString()}`, {
        method: "GET",
        headers: this.headers(),
      }),
    );
    const data = isRecord(response["data"]) ? response["data"] : {};
    const status = data["status"];
    switch (status) {
      case 1:
        return "scanned";
      case 2:
        return "confirmed";
      case -1:
        return "expired";
      case -2:
        return "canceled";
      default:
        return "waiting";
    }
  }

  /** Only call after pollStatus returned "confirmed". */
  async exchangeCookie(
    session: Pan115QrSession,
    app: Pan115QrLoginApp = "alipaymini",
  ): Promise<Pan115QrCookie> {
    const body = new URLSearchParams({ account: session.uid, app });
    const response = asRecord(
      await this.fetchJson(`${PASSPORT_API}/app/1.0/${app}/1.0/login/qrcode/`, {
        method: "POST",
        headers: {
          ...this.headers(),
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: body.toString(),
      }),
    );
    const data = asRecord(response["data"]);
    const cookieRecord = asRecord(data["cookie"]);
    const pairs = (["UID", "CID", "SEID", "KID"] as const)
      .map((key) => [key, stringValue(cookieRecord[key])] as const)
      .filter(([, value]) => value !== "");
    if (!pairs.some(([key]) => key === "UID")) {
      throw new Error(
        `PAN115_QR_EXCHANGE_FAILED: ${stringValue(response["message"]) || "no cookie in response"}`,
      );
    }
    return {
      cookie: pairs.map(([key, value]) => `${key}=${value}`).join("; "),
      userId: numberValue(data["user_id"]),
      userName: stringValue(data["user_name"]),
      app,
    };
  }

  private headers(): Record<string, string> {
    return {
      "User-Agent": this.userAgent,
      Referer: "https://115.com/",
      Accept: "application/json, text/plain, */*",
    };
  }
}

async function defaultFetchJson(
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
): Promise<unknown> {
  const controller = new AbortController();
  // Long-poll rounds hold ~30s; cap a bit above that.
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`115 QR endpoint failed with HTTP ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
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
  return Number.isFinite(parsed) ? parsed : 0;
}
