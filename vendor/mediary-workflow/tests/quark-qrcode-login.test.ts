import { describe, expect, it } from "vitest";
import { QuarkQrLoginClient } from "../src/index.js";

describe("QuarkQrLoginClient", () => {
  it("getToken returns token + a su.quark.cn qrcode URL", async () => {
    const client = new QuarkQrLoginClient({
      fetchJson: async (url) => {
        expect(url).toContain("uop.quark.cn/cas/ajax/getTokenForQrcodeLogin");
        expect(url).toContain("client_id=532");
        return { status: 2000000, data: { members: { token: "TK123" } } };
      },
    });
    const s = await client.getToken();
    expect(s.token).toBe("TK123");
    expect(s.qrcodeContent).toContain("su.quark.cn");
    expect(s.qrcodeContent).toContain("token=TK123");
  });

  it("pollStatus maps confirmed (2000000 + service_ticket)", async () => {
    const client = new QuarkQrLoginClient({
      fetchJson: async (url) => {
        expect(url).toContain("getServiceTicketByQrcodeToken");
        expect(url).toContain("token=TK123");
        return { status: 2000000, message: "ok", data: { members: { service_ticket: "ST999" } } };
      },
    });
    const r = await client.pollStatus({ token: "TK123", qrcodeContent: "" });
    expect(r.status).toBe("confirmed");
    expect(r.serviceTicket).toBe("ST999");
  });

  it("pollStatus maps waiting when no ticket yet", async () => {
    const client = new QuarkQrLoginClient({ fetchJson: async () => ({ status: 50004001, message: "wait", data: {} }) });
    expect((await client.pollStatus({ token: "x", qrcodeContent: "" })).status).toBe("waiting");
  });

  it("pollStatus maps expired on an expiry message", async () => {
    const client = new QuarkQrLoginClient({ fetchJson: async () => ({ status: 50004002, message: "token expired", data: {} }) });
    expect((await client.pollStatus({ token: "x", qrcodeContent: "" })).status).toBe("expired");
  });

  it("exchangeCookie assembles the drive cookie from accumulated Set-Cookie, requires __pus + uid", async () => {
    const hops = [
      {
        status: 302,
        setCookie: ["__pus=PUS1; Path=/; HttpOnly", "__uid=AARtUID; Path=/"],
        location: "https://pan.quark.cn/account/callback?x=1",
      },
      { status: 200, setCookie: ["__kps=KPS1; Path=/", "__ktd=KTD1; Path=/"], location: null },
    ];
    let i = 0;
    const client = new QuarkQrLoginClient({
      rawFetch: async () => {
        const hop = hops[i++]!;
        return {
          status: hop.status,
          headers: {
            getSetCookie: () => hop.setCookie,
            get: (n: string) => (n.toLowerCase() === "location" ? hop.location : null),
          },
        };
      },
    });
    const out = await client.exchangeCookie("ST999");
    expect(out.cookie).toContain("__pus=PUS1");
    expect(out.cookie).toContain("__uid=AARtUID");
    expect(out.cookie).toContain("__kps=KPS1");
    expect(out.providerUid).toBe("AARtUID");
  });

  it("exchangeCookie throws when no __pus arrives", async () => {
    const client = new QuarkQrLoginClient({
      rawFetch: async () => ({
        status: 200,
        headers: { getSetCookie: () => ["foo=bar"], get: () => null },
      }),
    });
    await expect(client.exchangeCookie("ST")).rejects.toThrow(/QUARK_QR_EXCHANGE_FAILED/);
  });
});
