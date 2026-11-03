import { describe, expect, it } from "vitest";
import { signSession, verifySession, isSessionExpired, generateSessionId } from "../src/index.js";

const SECRET = "test-secret";

describe("session cookie signing (HMAC)", () => {
  it("round-trips a signed session id", () => {
    const signed = signSession("sess_abc", SECRET);
    expect(signed).toContain("sess_abc.");
    expect(verifySession(signed, SECRET)).toBe("sess_abc");
  });

  it("rejects a tampered value", () => {
    const signed = signSession("sess_abc", SECRET);
    const tampered = signed.replace("sess_abc", "sess_evil");
    expect(verifySession(tampered, SECRET)).toBeNull();
  });

  it("rejects a wrong secret", () => {
    const signed = signSession("sess_abc", SECRET);
    expect(verifySession(signed, "other-secret")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifySession("", SECRET)).toBeNull();
    expect(verifySession("nodot", SECRET)).toBeNull();
    expect(verifySession("a.b.c.d", SECRET)).toBeNull();
  });
});

describe("isSessionExpired", () => {
  it("compares ISO timestamps", () => {
    expect(isSessionExpired("2026-06-18T00:00:00.000Z", "2026-06-18T00:00:01.000Z")).toBe(true);
    expect(isSessionExpired("2026-06-18T00:00:02.000Z", "2026-06-18T00:00:01.000Z")).toBe(false);
  });
});

describe("generateSessionId", () => {
  it("produces unique, prefixed ids", () => {
    const a = generateSessionId();
    const b = generateSessionId();
    expect(a).not.toBe(b);
    expect(a.startsWith("sess_")).toBe(true);
  });
});
