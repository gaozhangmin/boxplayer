import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/index.js";

describe("password hashing (scrypt)", () => {
  it("verifies the correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("produces a different salted hash each time (no rainbow tables)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("verify returns false on a malformed/empty stored hash instead of throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "not-a-real-hash")).toBe(false);
    expect(await verifyPassword("x", "scrypt:zzz")).toBe(false);
  });
});
