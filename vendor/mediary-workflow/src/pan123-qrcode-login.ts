/**
 * 123网盘 (123pan / login.123pan.com) QR-code login — the brand-5 analogue of
 * Pan115QrLoginClient / TianyiQrLoginClient. Yields a ~90-day Bearer token that
 * the 123 web face (see pan123-client.ts) authenticates with.
 *
 * 🟢 THE simplifying fact: unlike 天翼 (stateful login cookie jar + a ≤6-hop
 * oauth2 redirect chain + a separate getSessionForPC exchange step), 123's flow
 * is just TWO STATELESS GETs:
 *
 *   getQrSession()   GET qr-code/generate → { uniID, url }. The QR content is the
 *                    `url` with a fixed `?env=production&uniID=<x>&source=123pan&
 *                    type=login` suffix (what the 123 App scanner expects).
 *   pollStatus()     GET qr-code/result?uniID=<x> → { loginStatus, token? }. The
 *                    token comes straight out of the poll — NO cookie jar, NO
 *                    exchange hop, NO redirect chain.
 *
 * ── Provenance (byte-accuracy matters; the brand's viability rides on it).
 *    Reconciled against the REAL probe scripts that ran against a live account and
 *    succeeded via a real phone scan (scratchpad/pan123-qr-init.mjs,
 *    pan123-qr-poll.mjs) — those override any reference.
 * • getQrSession — endpoint/headers/qrcodeContent suffix are PROBE-VERIFIED
 *   (pan123-qr-init.mjs line 7 + line 12).
 * • pollStatus — endpoint/headers/fields are PROBE-VERIFIED (pan123-qr-poll.mjs
 *   line 9/11). The loginStatus mapping, however, follows the p123client
 *   authoritative SDK (0 waiting / 1 scanned / 2 canceled→expired / 3 confirmed /
 *   4 invalid→expired), NOT the probe's abbreviated "0 待扫/1 已确认" comment
 *   (which is incomplete). A non-empty `token` is the PRIMARY confirm signal
 *   (takes precedence over loginStatus, defending against a status the map missed).
 *
 * 🔴 fail-LOUD: a non-JSON response (a WAF/challenge HTML page is often served as
 * 200) throws PAN123_QR_HTTP_FAILED instead of being swallowed as "empty/waiting"
 * — this repo has repeatedly been bitten by outage-as-empty (fail-quiet).
 */

const GENERATE_URL = "https://login.123pan.com/api/user/qr-code/generate";
const RESULT_URL = "https://login.123pan.com/api/user/qr-code/result";
const QR_TIMEOUT_MS = 15_000;

/** Exact header set from the probe (pan123-qr-init.mjs line 6), sent on both GETs. */
const PAN123_QR_HEADERS: Record<string, string> = {
  "content-type": "application/json;charset=UTF-8",
  platform: "web",
  "app-version": "3",
  origin: "https://login.123pan.com",
  referer: "https://login.123pan.com/",
  "user-agent": "Mozilla/5.0",
};

export type Pan123QrStatus = "waiting" | "scanned" | "confirmed" | "expired";

export interface Pan123QrSession {
  uniID: string;
  /** String content to render as a QR code client-side. */
  qrcodeContent: string;
}

export interface Pan123QrPollResult {
  status: Pan123QrStatus;
  /** Present ONLY when status === "confirmed" (the ~90-day Bearer token). */
  token?: string;
}

export interface Pan123QrRawResponse {
  status: number;
  text: string;
}

/** Single injected transport seam: one stateless GET, exposing status + raw text. */
export type Pan123QrRawFetch = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<Pan123QrRawResponse>;

export class Pan123QrLoginClient {
  private readonly fetchImpl: Pan123QrRawFetch;

  constructor(opts: { fetchImpl?: Pan123QrRawFetch } = {}) {
    this.fetchImpl = opts.fetchImpl ?? defaultPan123QrFetch;
  }

  /**
   * GET qr-code/generate → { uniID, url }. Builds the QR content by appending the
   * fixed `?env=production&uniID=<x>&source=123pan&type=login` suffix to `url`
   * (probe pan123-qr-init.mjs line 12). Fails LOUD on code!==0 / missing uniID/url.
   */
  async getQrSession(): Promise<Pan123QrSession> {
    const envelope = await this.getJson(GENERATE_URL);
    const data = asRecord(envelope["data"]);
    const uniID = stringValue(data["uniID"]);
    const url = stringValue(data["url"]);
    if (envelope["code"] !== 0 || !uniID || !url) {
      throw new Error(
        `PAN123_QR_GENERATE_FAILED: code=${stringValue(envelope["code"])} uniID=${Boolean(uniID)} url=${Boolean(url)}`,
      );
    }
    const qrcodeContent = `${url}?env=production&uniID=${uniID}&source=123pan&type=login`;
    return { uniID, qrcodeContent };
  }

  /**
   * GET qr-code/result?uniID=<x> → one poll round. A non-empty `token` is the
   * PRIMARY confirm signal (takes precedence over loginStatus). Otherwise the
   * p123client authoritative loginStatus map applies; a missing loginStatus with
   * code!==0 means the uniID is dead (→ expired), else still waiting.
   */
  async pollStatus(session: { uniID: string }): Promise<Pan123QrPollResult> {
    const envelope = await this.getJson(
      `${RESULT_URL}?uniID=${encodeURIComponent(session.uniID)}`,
    );
    const data = asRecord(envelope["data"]);
    const token = stringValue(data["token"]);
    if (token) {
      return { status: "confirmed", token };
    }
    const rawStatus = data["loginStatus"];
    if (rawStatus === undefined || rawStatus === null) {
      // No loginStatus at all: a non-zero code means the uniID has died/expired;
      // otherwise the QR simply hasn't advanced yet.
      return { status: envelope["code"] !== 0 ? "expired" : "waiting" };
    }
    switch (Number(rawStatus)) {
      case 0:
        return { status: "waiting" };
      case 1:
        return { status: "scanned" };
      case 3:
        return { status: "confirmed" };
      case 2: // canceled
      case 4: // invalidated
        return { status: "expired" };
      default:
        return { status: "waiting" };
    }
  }

  /** One GET → parsed JSON object, failing LOUD (not fail-quiet) on a non-JSON body. */
  private async getJson(url: string): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(url, { method: "GET", headers: PAN123_QR_HEADERS });
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      throw new Error(`PAN123_QR_HTTP_FAILED: status=${res.status} non-JSON body`);
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(`PAN123_QR_HTTP_FAILED: status=${res.status} non-JSON body`);
    }
    return parsed as Record<string, unknown>;
  }
}

async function defaultPan123QrFetch(
  url: string,
  init: { method: string; headers: Record<string, string> },
): Promise<Pan123QrRawResponse> {
  // HARD project rule: every new external HTTP call carries a timeout (a bare
  // fetch hung the whole app in the PanSou incident).
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers,
    signal: AbortSignal.timeout(QR_TIMEOUT_MS),
  });
  return { status: res.status, text: await res.text() };
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
