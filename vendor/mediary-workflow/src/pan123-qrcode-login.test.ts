import { describe, it, expect, vi } from "vitest";
import type {
  Pan123QrRawFetch,
  Pan123QrRawResponse,
} from "./pan123-qrcode-login.js";
import { Pan123QrLoginClient } from "./pan123-qrcode-login.js";

interface StubResponse {
  status?: number;
  text?: string;
}

function makeRaw(r: StubResponse): Pan123QrRawResponse {
  return { status: r.status ?? 200, text: r.text ?? "" };
}

/** A rawFetch that always returns the given JSON envelope (status 200). */
function jsonFetch(body: unknown): Pan123QrRawFetch {
  return vi.fn<Pan123QrRawFetch>(async () => makeRaw({ text: JSON.stringify(body) }));
}

// ── pollStatus: the v1-critical loginStatus mapping (p123client authoritative) ──
describe("Pan123QrLoginClient.pollStatus (loginStatus 0/1/2/3/4 mapping)", () => {
  const cases: Array<[number, "waiting" | "scanned" | "confirmed" | "expired"]> = [
    [0, "waiting"],
    [1, "scanned"],
    [2, "expired"],
    [3, "confirmed"],
    [4, "expired"],
  ];
  for (const [loginStatus, phase] of cases) {
    it(`maps loginStatus ${loginStatus} → ${phase}`, async () => {
      const c = new Pan123QrLoginClient({ fetchImpl: jsonFetch({ code: 0, data: { loginStatus } }) });
      const r = await c.pollStatus({ uniID: "U1" });
      expect(r.status).toBe(phase);
    });
  }

  it("returns the token verbatim on loginStatus 3 (confirmed)", async () => {
    const c = new Pan123QrLoginClient({
      fetchImpl: jsonFetch({ code: 0, data: { loginStatus: 3, token: "TK90" } }),
    });
    const r = await c.pollStatus({ uniID: "U1" });
    expect(r.status).toBe("confirmed");
    expect(r.token).toBe("TK90");
  });

  it("treats token presence as confirmed even if loginStatus is absent (token is the primary signal)", async () => {
    const c = new Pan123QrLoginClient({ fetchImpl: jsonFetch({ code: 0, data: { token: "TK90" } }) });
    const r = await c.pollStatus({ uniID: "U1" });
    expect(r.status).toBe("confirmed");
    expect(r.token).toBe("TK90");
  });

  it("token OVERRIDES a conflicting non-confirm loginStatus (token check precedes the switch)", async () => {
    // loginStatus 4 alone maps to expired, but a non-empty token is the primary
    // confirm signal and must win — this pins token-first ahead of the map.
    const c = new Pan123QrLoginClient({
      fetchImpl: jsonFetch({ code: 0, data: { loginStatus: 4, token: "TK90" } }),
    });
    const r = await c.pollStatus({ uniID: "U1" });
    expect(r).toEqual({ status: "confirmed", token: "TK90" });
  });

  it("does NOT attach a token key when not confirmed (exactOptionalPropertyTypes)", async () => {
    const c = new Pan123QrLoginClient({ fetchImpl: jsonFetch({ code: 0, data: { loginStatus: 1 } }) });
    const r = await c.pollStatus({ uniID: "U1" });
    expect(r.status).toBe("scanned");
    expect("token" in r).toBe(false);
  });

  it("maps a missing loginStatus with code!==0 (dead uniID) → expired", async () => {
    const c = new Pan123QrLoginClient({ fetchImpl: jsonFetch({ code: 1, data: {} }) });
    expect((await c.pollStatus({ uniID: "U1" })).status).toBe("expired");
  });

  it("maps a missing loginStatus with code===0 → waiting (not yet)", async () => {
    const c = new Pan123QrLoginClient({ fetchImpl: jsonFetch({ code: 0, data: {} }) });
    expect((await c.pollStatus({ uniID: "U1" })).status).toBe("waiting");
  });

  it("GETs qr-code/result with the encoded uniID + exact headers", async () => {
    let seen: { url: string; init: { method: string; headers: Record<string, string> } } | undefined;
    const fetchImpl = vi.fn<Pan123QrRawFetch>(async (url, init) => {
      seen = { url, init };
      return makeRaw({ text: JSON.stringify({ code: 0, data: { loginStatus: 0 } }) });
    });
    const c = new Pan123QrLoginClient({ fetchImpl });
    await c.pollStatus({ uniID: "U 1/x" });
    expect(seen?.url).toBe("https://login.123pan.com/api/user/qr-code/result?uniID=U%201%2Fx");
    expect(seen?.init.method).toBe("GET");
    expect(seen?.init.headers["platform"]).toBe("web");
    expect(seen?.init.headers["app-version"]).toBe("3");
    expect(seen?.init.headers["origin"]).toBe("https://login.123pan.com");
    expect(seen?.init.headers["referer"]).toBe("https://login.123pan.com/");
    expect(seen?.init.headers["content-type"]).toBe("application/json;charset=UTF-8");
  });

  it("fails LOUD on a non-JSON poll body (never fail-quiet as waiting)", async () => {
    const c = new Pan123QrLoginClient({ fetchImpl: vi.fn<Pan123QrRawFetch>(async () => makeRaw({ status: 200, text: "<html>challenge</html>" })) });
    await expect(c.pollStatus({ uniID: "U1" })).rejects.toThrow(/PAN123_QR_HTTP_FAILED: status=200 non-JSON body/);
  });
});

// ── getQrSession: generate → uniID + qrcodeContent construction ────────────────
describe("Pan123QrLoginClient.getQrSession (generate)", () => {
  it("returns uniID + the verbatim qrcodeContent (env/uniID/source/type suffix)", async () => {
    const c = new Pan123QrLoginClient({
      fetchImpl: jsonFetch({ code: 0, data: { uniID: "U1", url: "https://login.123pan.com/qrcode/xxx" } }),
    });
    const s = await c.getQrSession();
    expect(s.uniID).toBe("U1");
    expect(s.qrcodeContent).toBe(
      "https://login.123pan.com/qrcode/xxx?env=production&uniID=U1&source=123pan&type=login",
    );
  });

  it("GETs qr-code/generate with the exact headers", async () => {
    let seen: { url: string; init: { method: string; headers: Record<string, string> } } | undefined;
    const fetchImpl = vi.fn<Pan123QrRawFetch>(async (url, init) => {
      seen = { url, init };
      return makeRaw({ text: JSON.stringify({ code: 0, data: { uniID: "U1", url: "https://login.123pan.com/qrcode/xxx" } }) });
    });
    const c = new Pan123QrLoginClient({ fetchImpl });
    await c.getQrSession();
    expect(seen?.url).toBe("https://login.123pan.com/api/user/qr-code/generate");
    expect(seen?.init.method).toBe("GET");
    expect(seen?.init.headers["platform"]).toBe("web");
    expect(seen?.init.headers["app-version"]).toBe("3");
    expect(seen?.init.headers["content-type"]).toBe("application/json;charset=UTF-8");
  });

  it("throws when generate returns code!==0", async () => {
    const c = new Pan123QrLoginClient({ fetchImpl: jsonFetch({ code: 1, data: { uniID: "U1", url: "https://x" } }) });
    await expect(c.getQrSession()).rejects.toThrow(/PAN123_QR_GENERATE_FAILED/);
  });

  it("throws when generate is missing uniID", async () => {
    const c = new Pan123QrLoginClient({ fetchImpl: jsonFetch({ code: 0, data: { url: "https://x" } }) });
    await expect(c.getQrSession()).rejects.toThrow(/PAN123_QR_GENERATE_FAILED/);
  });

  it("throws when generate is missing url", async () => {
    const c = new Pan123QrLoginClient({ fetchImpl: jsonFetch({ code: 0, data: { uniID: "U1" } }) });
    await expect(c.getQrSession()).rejects.toThrow(/PAN123_QR_GENERATE_FAILED/);
  });

  it("fails LOUD on a non-JSON generate body", async () => {
    const c = new Pan123QrLoginClient({ fetchImpl: vi.fn<Pan123QrRawFetch>(async () => makeRaw({ status: 200, text: "<html>challenge</html>" })) });
    await expect(c.getQrSession()).rejects.toThrow(/PAN123_QR_HTTP_FAILED: status=200 non-JSON body/);
  });
});
