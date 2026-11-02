import { describe, it, expect, vi } from "vitest";
import type {
  TianyiQrSession,
  TianyiQrStatus,
  TianyiQrRawFetch,
  TianyiQrRawResponse,
  TianyiQrRequestInit,
} from "./tianyi-qrcode-login.js";
import { TianyiQrLoginClient } from "./tianyi-qrcode-login.js";

const RETURN_URL = "https://m.cloud.189.cn/zhuanti/2020/loginErrorPc/index.html";

interface StubResponse {
  status?: number;
  text?: string;
  setCookie?: string[];
  location?: string | null;
}

/** Build a TianyiQrRawResponse from a compact spec (exposes Location + Set-Cookie
 *  so the client's cookie-jar threading is actually exercised, not just shape). */
function makeRaw(r: StubResponse): TianyiQrRawResponse {
  return {
    status: r.status ?? 200,
    text: r.text ?? "",
    headers: {
      get: (name: string): string | null => (name.toLowerCase() === "location" ? (r.location ?? null) : null),
      getSetCookie: (): string[] => r.setCookie ?? [],
    },
  };
}

function sessionFixture(): TianyiQrSession {
  return {
    uuid: "U",
    encryuuid: "E",
    paramId: "P",
    reqId: "R",
    lt: "L",
    appId: "8025431004",
    clientType: "10020",
    returnUrl: RETURN_URL,
    cookies: [["COOKIE_A", "1"]],
    qrcodeContent: "U",
  };
}

// ── pollStatus: THE v1-critical 4-state mapping (probe-verified, spec §登录) ────
describe("TianyiQrLoginClient.pollStatus (v1-critical 4-state mapping)", () => {
  const cases: Array<[number, TianyiQrStatus]> = [
    [-106, "waiting"],
    [-11002, "scanned"],
    [0, "confirmed"],
    [-11001, "expired"],
  ];
  for (const [code, phase] of cases) {
    it(`maps qrcodeLoginState status ${code} → ${phase}`, async () => {
      const rawFetch = vi.fn<TianyiQrRawFetch>(async () =>
        makeRaw({
          text: JSON.stringify({ status: code, redirectUrl: code === 0 ? "https://cloud.189.cn/grant" : "" }),
        }),
      );
      const c = new TianyiQrLoginClient({ rawFetch });
      const r = await c.pollStatus(sessionFixture());
      expect(r.status).toBe(phase);
    });
  }

  it("carries redirectUrl through on confirmed (needed to exchange the session)", async () => {
    const rawFetch = vi.fn<TianyiQrRawFetch>(async () =>
      makeRaw({ text: JSON.stringify({ status: 0, redirectUrl: "https://cloud.189.cn/grant" }) }),
    );
    const c = new TianyiQrLoginClient({ rawFetch });
    const r = await c.pollStatus(sessionFixture());
    expect(r.status).toBe("confirmed");
    expect(r.redirectUrl).toBe("https://cloud.189.cn/grant");
  });

  it("treats an unknown status code as still-waiting (never a false-confirm)", async () => {
    const rawFetch = vi.fn<TianyiQrRawFetch>(async () => makeRaw({ text: JSON.stringify({ status: -999 }) }));
    const c = new TianyiQrLoginClient({ rawFetch });
    expect((await c.pollStatus(sessionFixture())).status).toBe("waiting");
  });

  it("treats a non-JSON poll body as still-waiting (never a false-confirm)", async () => {
    const rawFetch = vi.fn<TianyiQrRawFetch>(async () => makeRaw({ text: "<html>gateway</html>" }));
    const c = new TianyiQrLoginClient({ rawFetch });
    expect((await c.pollStatus(sessionFixture())).status).toBe("waiting");
  });

  it("does NOT false-confirm on {status: null} (numberValue coerces null→0)", async () => {
    // A garbled/empty status must never map to confirmed — the confirm branch
    // requires a real redirectUrl, which a null-status response cannot carry.
    const rawFetch = vi.fn<TianyiQrRawFetch>(async () => makeRaw({ text: JSON.stringify({ status: null }) }));
    const c = new TianyiQrLoginClient({ rawFetch });
    expect((await c.pollStatus(sessionFixture())).status).toBe("waiting");
  });

  it("does NOT confirm on status 0 with an empty redirectUrl", async () => {
    const rawFetch = vi.fn<TianyiQrRawFetch>(async () => makeRaw({ text: JSON.stringify({ status: 0, redirectUrl: "" }) }));
    const c = new TianyiQrLoginClient({ rawFetch });
    expect((await c.pollStatus(sessionFixture())).status).toBe("waiting");
  });

  it("POSTs qrcodeLoginState.do with cookie jar + encryuuid + concat date + Referer/Reqid/lt; threads harvested cookies", async () => {
    let seen: { url: string; init: TianyiQrRequestInit } | undefined;
    const rawFetch = vi.fn<TianyiQrRawFetch>(async (url: string, init: TianyiQrRequestInit) => {
      seen = { url, init };
      return makeRaw({ text: JSON.stringify({ status: -11002 }), setCookie: ["POLLCK=zzz; Path=/"] });
    });
    const c = new TianyiQrLoginClient({ rawFetch });
    const r = await c.pollStatus({
      uuid: "UU",
      encryuuid: "EE",
      paramId: "PP",
      reqId: "RR",
      lt: "LL",
      appId: "8025431004",
      clientType: "10020",
      returnUrl: "https://ret",
      cookies: [["SESS", "abc"]],
    });
    expect(seen?.url).toContain("/api/logbox/oauth2/qrcodeLoginState.do");
    const form = new URLSearchParams(seen?.init.body ?? "");
    expect(form.get("uuid")).toBe("UU");
    expect(form.get("encryuuid")).toBe("EE"); // encryuuid, NOT encodeuuid
    expect(form.get("paramId")).toBe("PP");
    expect(form.get("appId")).toBe("8025431004");
    expect(form.get("clientType")).toBe("10020");
    expect(form.get("returnUrl")).toBe("https://ret");
    // date format YYYY-MM-DDHH:mm:ss.SSS — day and time concatenated, NO separator.
    expect(form.get("date")).toMatch(/^\d{4}-\d{2}-\d{2}\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(form.get("timeStamp")).toMatch(/^\d+$/);
    expect(seen?.init.headers?.Referer).toBe("https://open.e.189.cn"); // no trailing slash (probe)
    expect(seen?.init.headers?.Reqid).toBe("RR");
    expect(seen?.init.headers?.lt).toBe("LL");
    expect(seen?.init.headers?.Cookie).toContain("SESS=abc"); // jar sent
    expect(r.status).toBe("scanned");
    expect(r.cookies).toContainEqual(["SESS", "abc"]); // jar preserved
    expect(r.cookies).toContainEqual(["POLLCK", "zzz"]); // + newly harvested
  });
});

// ─ getQrSession: unifyLoginForPC (regex + cookies) → getUUID → verbatim uuid ──
describe("TianyiQrLoginClient.getQrSession (unifyLoginForPC → getUUID)", () => {
  it("parses lt/reqId/paramId, returns the verbatim uuid as qrcodeContent, captures the cookie jar", async () => {
    const calls: Array<{ url: string; init: TianyiQrRequestInit }> = [];
    const rawFetch = vi.fn<TianyiQrRawFetch>(async (url: string, init: TianyiQrRequestInit) => {
      calls.push({ url, init });
      if (url.includes("unifyLoginForPC")) {
        return makeRaw({
          text: `<html><script>var lt = "LT_TOKEN"; var reqId = "REQ_1"; var paramId = "PARAM_9";</script></html>`,
          setCookie: ["LOGIN_COOKIE=abc; Path=/"],
        });
      }
      if (url.includes("getUUID.do")) {
        return makeRaw({
          text: JSON.stringify({ result: "0", uuid: "UUID_ABC", encodeuuid: "ENC", encryuuid: "ENCRY_XYZ" }),
          setCookie: ["UUID_CK=def; Path=/"],
        });
      }
      throw new Error("unexpected " + url);
    });
    const c = new TianyiQrLoginClient({ rawFetch });
    const s = await c.getQrSession();
    const unify = calls.find((x) => x.url.includes("unifyLoginForPC"));
    const uuidCall = calls.find((x) => x.url.includes("getUUID.do"));
    expect(unify?.url).toContain("/api/portal/unifyLoginForPC.action");
    expect(unify?.url).toContain("appId=8025431004");
    expect(unify?.url).toContain("clientType=10020");
    // getUUID carries the unifyLoginForPC cookie (jar threaded), form appId only.
    expect(uuidCall?.init.headers?.Cookie).toContain("LOGIN_COOKIE=abc");
    expect(new URLSearchParams(uuidCall?.init.body ?? "").get("appId")).toBe("8025431004");
    expect(s.uuid).toBe("UUID_ABC");
    expect(s.encryuuid).toBe("ENCRY_XYZ");
    expect(s.lt).toBe("LT_TOKEN");
    expect(s.reqId).toBe("REQ_1");
    expect(s.paramId).toBe("PARAM_9");
    expect(s.appId).toBe("8025431004");
    expect(s.clientType).toBe("10020");
    expect(s.qrcodeContent).toBe("UUID_ABC"); // verbatim uuid — the QR encodes getUUID.do's uuid field as-is (live-verified: that field is the full qrClinentLogin login URL)
    expect(s.cookies).toContainEqual(["LOGIN_COOKIE", "abc"]);
    expect(s.cookies).toContainEqual(["UUID_CK", "def"]);
  });

  it("follows unifyLoginForPC redirects (≤6 hops), harvesting cookies at each hop", async () => {
    const rawFetch = vi.fn<TianyiQrRawFetch>(async (url: string) => {
      if (url.includes("unifyLoginForPC")) {
        return makeRaw({
          status: 302,
          location: "https://open.e.189.cn/api/logbox/oauth2/unifyAccountLogin.do?x=1",
          setCookie: ["HOP1=a; Path=/"],
        });
      }
      if (url.includes("unifyAccountLogin.do")) {
        return makeRaw({ text: `lt = "L2"; paramId = "P2"; reqId = "R2";`, setCookie: ["HOP2=b; Path=/"] });
      }
      if (url.includes("getUUID.do")) {
        return makeRaw({ text: JSON.stringify({ uuid: "UU2", encryuuid: "EE2" }) });
      }
      throw new Error("unexpected " + url);
    });
    const c = new TianyiQrLoginClient({ rawFetch });
    const s = await c.getQrSession();
    expect(s.lt).toBe("L2");
    expect(s.paramId).toBe("P2");
    expect(s.cookies).toContainEqual(["HOP1", "a"]);
    expect(s.cookies).toContainEqual(["HOP2", "b"]);
  });

  it("throws TIANYI_QR_INIT_FAILED if the login page carries no lt/paramId", async () => {
    const rawFetch = vi.fn<TianyiQrRawFetch>(async () => makeRaw({ text: "<html>nope</html>" }));
    const c = new TianyiQrLoginClient({ rawFetch });
    await expect(c.getQrSession()).rejects.toThrow(/TIANYI_QR_INIT_FAILED/);
  });

  it("throws TIANYI_QR_INIT_FAILED when lt/paramId are present but reqId is missing", async () => {
    // reqId rides as the Reqid header on every subsequent poll; a missing one must
    // fail fast at init, not defer to a less-actionable later poll failure.
    const rawFetch = vi.fn<TianyiQrRawFetch>(async () => makeRaw({ text: `lt = "L"; paramId = "P";` }));
    const c = new TianyiQrLoginClient({ rawFetch });
    await expect(c.getQrSession()).rejects.toThrow(/TIANYI_QR_INIT_FAILED/);
  });

  it("throws TIANYI_QR_UUID_FAILED if getUUID.do returns no uuid", async () => {
    const rawFetch = vi.fn<TianyiQrRawFetch>(async (url: string) => {
      if (url.includes("unifyLoginForPC")) return makeRaw({ text: `lt = "L"; paramId = "P"; reqId = "R";` });
      return makeRaw({ text: JSON.stringify({ result: "-1" }) });
    });
    const c = new TianyiQrLoginClient({ rawFetch });
    await expect(c.getQrSession()).rejects.toThrow(/TIANYI_QR_UUID_FAILED/);
  });

  it("fails LOUD (not 'no uuid') when getUUID.do returns a non-JSON 502/WAF body", async () => {
    // A gateway HTML page must surface as an HTTP error carrying the status, not be
    // misattributed as a missing uuid field (mirrors tianyi-client's unwrap discipline).
    const rawFetch = vi.fn<TianyiQrRawFetch>(async (url: string) => {
      if (url.includes("unifyLoginForPC")) return makeRaw({ text: `lt = "L"; paramId = "P"; reqId = "R";` });
      return makeRaw({ status: 502, text: "<html>gateway timeout</html>" });
    });
    const c = new TianyiQrLoginClient({ rawFetch });
    await expect(c.getQrSession()).rejects.toThrow(/TIANYI_QR_HTTP_FAILED: status=502/);
  });
});

// ── exchangeSession: getSessionForPC(redirectURL) → 7-field session ───────────
describe("TianyiQrLoginClient.exchangeSession (getSessionForPC)", () => {
  it("calls getSessionForPC with redirectURL + TELEPC suffix (NO appId), sends the jar, returns 7 fields", async () => {
    let seen: { url: string; init: TianyiQrRequestInit } | undefined;
    const rawFetch = vi.fn<TianyiQrRawFetch>(async (url: string, init: TianyiQrRequestInit) => {
      seen = { url, init };
      return makeRaw({
        text: JSON.stringify({
          res_code: 0,
          sessionKey: "SK-36",
          sessionSecret: "SS-32",
          accessToken: "AT-32",
          refreshToken: "RT-32",
          familySessionKey: "FSK-43",
          familySessionSecret: "FSS-32",
          loginName: "13800138000",
          keepAlive: 1,
        }),
      });
    });
    const c = new TianyiQrLoginClient({ rawFetch });
    const session = await c.exchangeSession(
      { ...sessionFixture(), cookies: [["SESS", "xyz"]] },
      "https://cloud.189.cn/api/portal/loginUrl.action?redirectURL=deep",
    );
    expect(seen?.url).toContain("api.cloud.189.cn/getSessionForPC.action");
    expect(seen?.url).toContain("clientType=TELEPC");
    expect(seen?.url).toContain("version=6.2");
    expect(seen?.url).toContain("channelId=web_cloud.189.cn");
    expect(seen?.url).toContain("rand=");
    expect(seen?.url).toContain("redirectURL=");
    expect(seen?.url).not.toContain("appId="); // probe's clientSuffix has NO appId
    expect(seen?.init.headers?.Cookie).toContain("SESS=xyz"); // jar threaded to the exchange
    // One login yields BOTH personal + family credentials (spec §session 字段).
    expect(session).toEqual({
      sessionKey: "SK-36",
      sessionSecret: "SS-32",
      accessToken: "AT-32",
      refreshToken: "RT-32",
      familySessionKey: "FSK-43",
      familySessionSecret: "FSS-32",
      loginName: "13800138000",
    });
  });

  it("throws when getSessionForPC returns no sessionKey (login expired)", async () => {
    const rawFetch = vi.fn<TianyiQrRawFetch>(async () =>
      makeRaw({ text: JSON.stringify({ res_code: -1, res_message: "login expired" }) }),
    );
    const c = new TianyiQrLoginClient({ rawFetch });
    await expect(c.exchangeSession(sessionFixture(), "https://x")).rejects.toThrow(
      /TIANYI_SESSION_EXCHANGE_FAILED/,
    );
  });

  it("fails LOUD (not 'no sessionKey') when getSessionForPC returns a non-JSON 502/WAF body", async () => {
    const rawFetch = vi.fn<TianyiQrRawFetch>(async () => makeRaw({ status: 502, text: "<html>bad gateway</html>" }));
    const c = new TianyiQrLoginClient({ rawFetch });
    await expect(c.exchangeSession(sessionFixture(), "https://x")).rejects.toThrow(
      /TIANYI_QR_HTTP_FAILED: status=502/,
    );
  });
});

// ── formatTianyiDate: lock the exact YYYY-MM-DDHH:mm:ss.SSS format deterministically
describe("qrcodeLoginState date format (YYYY-MM-DDHH:mm:ss.SSS)", () => {
  it("zero-pads month/day/hour and pads ms to 3 digits, with day+hour concatenated", async () => {
    // Fix the clock: month index 0 → -01, single-digit day 5 → -05, hour 3 → 03,
    // ms 5 → .005. Exercised through the real pollStatus wiring (local-tz stable
    // because both construction and formatting use local getters).
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 0, 5, 3, 7, 9, 5));
      let body = "";
      const rawFetch = vi.fn<TianyiQrRawFetch>(async (_url: string, init: TianyiQrRequestInit) => {
        body = init.body ?? "";
        return makeRaw({ text: JSON.stringify({ status: -106 }) });
      });
      const c = new TianyiQrLoginClient({ rawFetch });
      await c.pollStatus(sessionFixture());
      expect(new URLSearchParams(body).get("date")).toBe("2026-01-0503:07:09.005");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── loginBySson: SSON cookie fallback (reference-derived; shape + jar threaded) ─
describe("TianyiQrLoginClient.loginBySson (SSON fallback — reference-derived)", () => {
  it("does unifyLoginForPC → loginBySsoCooike(Cookie has SSON + jar) → getSessionForPC", async () => {
    const calls: Array<{ url: string; init: TianyiQrRequestInit }> = [];
    const rawFetch = vi.fn<TianyiQrRawFetch>(async (url: string, init: TianyiQrRequestInit) => {
      calls.push({ url, init });
      if (url.includes("unifyLoginForPC")) {
        return makeRaw({ text: `lt = "LT1"; paramId = "PM1"; reqId = "RQ1";`, setCookie: ["UNI=1; Path=/"] });
      }
      if (url.includes("loginBySsoCooike")) {
        return makeRaw({
          text: JSON.stringify({
            result: 0,
            toUrl: "https://cloud.189.cn/api/portal/loginUrl.action?redirectURL=grant",
          }),
        });
      }
      if (url.includes("getSessionForPC")) {
        return makeRaw({
          text: JSON.stringify({
            res_code: 0,
            sessionKey: "SK",
            sessionSecret: "SS",
            accessToken: "AT",
            refreshToken: "RT",
            familySessionKey: "FSK",
            familySessionSecret: "FSS",
            loginName: "LOGIN",
          }),
        });
      }
      throw new Error("unexpected " + url);
    });
    const c = new TianyiQrLoginClient({ rawFetch });
    const session = await c.loginBySson("MY_SSON_COOKIE");
    const sso = calls.find((x) => x.url.includes("loginBySsoCooike"));
    const exch = calls.find((x) => x.url.includes("getSessionForPC"));
    expect(calls.some((x) => x.url.includes("unifyLoginForPC"))).toBe(true);
    expect(sso?.init.headers?.Cookie).toContain("SSON=MY_SSON_COOKIE");
    expect(sso?.init.headers?.Cookie).toContain("UNI=1"); // login jar threaded
    expect(exch?.url).toContain("redirectURL=");
    expect(session.sessionKey).toBe("SK");
    expect(session.loginName).toBe("LOGIN");
  });

  it("rejects an empty SSON before touching the network", async () => {
    const rawFetch = vi.fn<TianyiQrRawFetch>(async () => makeRaw({}));
    const c = new TianyiQrLoginClient({ rawFetch });
    await expect(c.loginBySson("  ")).rejects.toThrow(/TIANYI_SSON_LOGIN_FAILED/);
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("throws when loginBySsoCooike yields no redirect (bad/expired SSON)", async () => {
    const rawFetch = vi.fn<TianyiQrRawFetch>(async (url: string) => {
      if (url.includes("unifyLoginForPC")) return makeRaw({ text: `lt = "L"; paramId = "P"; reqId = "R";` });
      return makeRaw({ text: JSON.stringify({ result: -1, msg: "SSON invalid" }) });
    });
    const c = new TianyiQrLoginClient({ rawFetch });
    await expect(c.loginBySson("BAD")).rejects.toThrow(/TIANYI_SSON_LOGIN_FAILED/);
  });
});
