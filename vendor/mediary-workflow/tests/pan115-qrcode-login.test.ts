import { describe, expect, it } from "vitest";
import { Pan115QrLoginClient } from "../src/index.js";

interface RecordedRequest {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
}

describe("Pan115QrLoginClient", () => {
  it("gets a QR session token and falls back to the scan URL when qrcode is absent", async () => {
    const requests: RecordedRequest[] = [];
    const client = new Pan115QrLoginClient({
      fetchJson: async (url, init) => {
        requests.push({ url, method: init.method });
        return { state: 1, code: 0, data: { uid: "uid_1", time: 1718000000, sign: "sig" } };
      },
    });

    const session = await client.getToken();

    expect(requests[0]?.url).toBe("https://qrcodeapi.115.com/api/1.0/web/1.0/token/");
    expect(session).toEqual({
      uid: "uid_1",
      time: 1718000000,
      sign: "sig",
      qrcodeContent: "https://115.com/scan/dg-uid_1",
    });
  });

  it("maps poll status codes, treating a missing status field as waiting", async () => {
    const statuses: unknown[] = [
      { data: { status: 0 } },
      { data: { status: 1 } },
      { data: { status: 2 } },
      { data: { status: -1 } },
      { data: { status: -2 } },
      { data: {} }, // long-poll timeout shape
    ];
    let call = 0;
    const client = new Pan115QrLoginClient({
      fetchJson: async (url) => {
        expect(url).toContain("https://qrcodeapi.115.com/get/status/?uid=uid_1&time=1718000000&sign=sig");
        return statuses[call++];
      },
    });
    const session = { uid: "uid_1", time: 1718000000, sign: "sig", qrcodeContent: "x" };

    expect(await client.pollStatus(session)).toBe("waiting");
    expect(await client.pollStatus(session)).toBe("scanned");
    expect(await client.pollStatus(session)).toBe("confirmed");
    expect(await client.pollStatus(session)).toBe("expired");
    expect(await client.pollStatus(session)).toBe("canceled");
    expect(await client.pollStatus(session)).toBe("waiting");
  });

  it("exchanges a confirmed session for a serialized cookie with the chosen app", async () => {
    const requests: RecordedRequest[] = [];
    const client = new Pan115QrLoginClient({
      fetchJson: async (url, init) => {
        requests.push({ url, method: init.method, body: init.body ?? "", headers: init.headers ?? {} });
        return {
          state: 1,
          data: {
            cookie: { UID: "u_R2_1", CID: "c", SEID: "s", KID: "k" },
            user_id: 42,
            user_name: "fancy",
          },
        };
      },
    });

    const result = await client.exchangeCookie(
      { uid: "uid_1", time: 1, sign: "sig", qrcodeContent: "x" },
      "alipaymini",
    );

    expect(requests[0]?.url).toBe(
      "https://passportapi.115.com/app/1.0/alipaymini/1.0/login/qrcode/",
    );
    expect(requests[0]?.body).toBe("account=uid_1&app=alipaymini");
    expect(result).toEqual({
      cookie: "UID=u_R2_1; CID=c; SEID=s; KID=k",
      userId: 42,
      userName: "fancy",
      app: "alipaymini",
    });
  });

  it("fails loudly when the exchange returns no cookie", async () => {
    const client = new Pan115QrLoginClient({
      fetchJson: async () => ({ state: 0, message: "登录失败", data: {} }),
    });

    await expect(
      client.exchangeCookie({ uid: "u", time: 1, sign: "s", qrcodeContent: "x" }),
    ).rejects.toThrow("PAN115_QR_EXCHANGE_FAILED: 登录失败");
  });
});
