import { describe, expect, it } from "vitest";
import {
  getStorageBrand,
  parseQuarkUid,
  parsePan115Uid,
  STORAGE_BRANDS,
  isPan115AuthError,
  isQuarkAuthError,
  Pan115AuthError,
  QuarkAuthError,
} from "../src/index.js";
import { GuangYaAuthError, parseGuangYaUid } from "../src/guangya-client.js";

/** Build a fake 光鸭 JWT whose payload (2nd segment, base64url) carries `payload`. */
function makeGuangYaJwt(payload: Record<string, unknown>): string {
  return `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
}

describe("storage brand registry", () => {
  it("registers exactly pan115 + quark + guangya + tianyi + pan123", () => {
    expect(STORAGE_BRANDS.map((b) => b.provider).sort()).toEqual([
      "guangya",
      "pan115",
      "pan123",
      "quark",
      "tianyi",
    ]);
  });

  it("getStorageBrand resolves guangya with its label, magnet/prowlarr kinds + uid parsing", () => {
    const g = getStorageBrand("guangya");
    expect(g.provider).toBe("guangya");
    expect(g.label).toBe("光鸭云盘");
    expect(g.resourceProviderKinds).toContain("pansou-magnet");
    expect(g.resourceProviderKinds).toContain("prowlarr"); // 光鸭支持磁力
    expect(g.parseUid).toBe(parseGuangYaUid);
    expect(g.parseUid(makeGuangYaJwt({ sub: "U1" }))).toBe("U1");
    expect(g.isAuthError(new GuangYaAuthError("x"))).toBe(true);
    expect(g.isAuthError(new QuarkAuthError("y"))).toBe(false);
  });

  it("getStorageBrand resolves quark with its label + resource kinds (no prowlarr)", () => {
    const q = getStorageBrand("quark");
    expect(q.provider).toBe("quark");
    expect(q.label).toBe("夸克网盘");
    expect(q.resourceProviderKinds).toContain("pansou-quark");
    expect(q.resourceProviderKinds).not.toContain("prowlarr"); // 磁力对夸克隐藏
    expect(q.parseUid).toBe(parseQuarkUid);
    expect(q.isAuthError(new QuarkAuthError("x"))).toBe(true);
    expect(q.isAuthError(new Pan115AuthError("y"))).toBe(false);
  });

  it("getStorageBrand resolves pan115 keeping magnet sources", () => {
    const p = getStorageBrand("pan115");
    expect(p.provider).toBe("pan115");
    expect(p.label).toBe("115 网盘");
    expect(p.resourceProviderKinds).toContain("pansou-115");
    expect(p.resourceProviderKinds).toContain("prowlarr");
    expect(p.parseUid).toBe(parsePan115Uid);
    expect(p.isAuthError).toBe(isPan115AuthError);
  });

  it("each brand's isAuthError only matches its own auth error", () => {
    // sanity: the registry wires the right classifier per brand
    expect(isQuarkAuthError(new QuarkAuthError("x"))).toBe(true);
    expect(getStorageBrand("quark").isAuthError(new Error("plain"))).toBe(false);
  });

  it("unknown provider throws", () => {
    expect(() => getStorageBrand("baidu")).toThrowError(/unknown storage brand/i);
  });

  it("brandSupportsProwlarr: 115 yes, quark no, unknown safely false", async () => {
    const { brandSupportsProwlarr } = await import("../src/index.js");
    expect(brandSupportsProwlarr("pan115")).toBe(true);
    expect(brandSupportsProwlarr("quark")).toBe(false);
    expect(brandSupportsProwlarr("guangya")).toBe(true);
    expect(brandSupportsProwlarr("baidu")).toBe(false);
  });

  it("brand registry carries assumeChineseSubsFromChineseTitle flag (Task 4)", () => {
    // 115 and quark are Chinese-world drives → assume Chinese subs from Chinese titles
    expect(getStorageBrand("pan115").assumeChineseSubsFromChineseTitle).toBe(true);
    expect(getStorageBrand("quark").assumeChineseSubsFromChineseTitle).toBe(true);
    // guangya is magnet-only, more strict
    expect(getStorageBrand("guangya").assumeChineseSubsFromChineseTitle).toBe(false);
  });
});
