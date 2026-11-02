import { describe, expect, it } from "vitest";
import {
  isPan115AuthError,
  Pan115AuthError,
  Pan115CookieClient,
} from "../src/index.js";

/** A client whose HTTP layer always returns the given canned JSON. */
function clientReturning(json: unknown): Pan115CookieClient {
  return new Pan115CookieClient({
    cookie: "UID=1_x; CID=x; SEID=x",
    listPageDelayMs: 0,
    fetchJson: async () => json,
  });
}

describe("Pan115 auth-failure classification", () => {
  it("a dead cookie (errno 990001 / 登录超时) → Pan115AuthError on list", async () => {
    // The real shape, captured live: {state:false, error:"登录超时，请重新登录。", errno:990001}
    const client = clientReturning({
      state: false,
      error: "登录超时，请重新登录。",
      errno: 990001,
      errNo: 990001,
    });
    await expect(client.listItems({ directoryId: "123" })).rejects.toThrowError(Pan115AuthError);
  });

  it("a NON-auth failure (e.g. bad param) → generic error, NOT Pan115AuthError", async () => {
    const client = clientReturning({ state: false, error: "参数错误", errno: 20130827 });
    let caught: unknown;
    try {
      await client.listItems({ directoryId: "123" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(isPan115AuthError(caught)).toBe(false);
  });

  it("isPan115AuthError narrows correctly", () => {
    expect(isPan115AuthError(new Pan115AuthError("登录超时"))).toBe(true);
    expect(isPan115AuthError(new Error("nope"))).toBe(false);
    expect(isPan115AuthError(null)).toBe(false);
  });
});
