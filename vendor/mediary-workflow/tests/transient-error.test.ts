import { describe, expect, it } from "vitest";
import { isTransientAcquisitionError } from "../src/acquisition-v2/transient-error.js";

describe("isTransientAcquisitionError", () => {
  it("matches connection-class errors", () => {
    for (const msg of [
      "Cannot connect to API: Client network socket disconnected before secure TLS connection was established",
      "fetch failed",
      "read ECONNRESET",
      "connect ETIMEDOUT 1.2.3.4:443",
      "connect ECONNREFUSED",
      "getaddrinfo ENOTFOUND webapi.115.com",
      "getaddrinfo EAI_AGAIN api.example.com",
      "socket hang up",
    ]) {
      expect(isTransientAcquisitionError(new Error(msg)), msg).toBe(true);
    }
  });

  it("matches AI SDK RetryError wrapping a connection error", () => {
    const err = new Error(
      "Failed after 3 attempts. Last error: Cannot connect to API: Client network socket disconnected",
    );
    err.name = "AI_RetryError";
    expect(isTransientAcquisitionError(err)).toBe(true);
  });

  it("recurses into error.cause", () => {
    const inner = new Error("read ECONNRESET");
    const outer = new Error("acquisition step failed");
    (outer as Error & { cause?: unknown }).cause = inner;
    expect(isTransientAcquisitionError(outer)).toBe(true);
  });

  it("is false for non-transient failures", () => {
    expect(isTransientAcquisitionError(new Error("no coverage found"))).toBe(false);
    expect(isTransientAcquisitionError(new Error("validation failed: bad title"))).toBe(false);
    expect(isTransientAcquisitionError(new Error("agent gave up after max steps"))).toBe(false);
    expect(isTransientAcquisitionError("a plain string")).toBe(false);
    expect(isTransientAcquisitionError(undefined)).toBe(false);
  });
});
