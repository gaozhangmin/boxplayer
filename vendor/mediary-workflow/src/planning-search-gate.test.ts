import { describe, expect, it } from "vitest";
import { decideSearchGate, normalizeSearchKeyword } from "./planning-search-gate.js";

describe("normalizeSearchKeyword", () => {
  it("trims, collapses whitespace, lowercases so trivial variants collide", () => {
    expect(normalizeSearchKeyword("  孤独摇滚  ")).toBe("孤独摇滚");
    expect(normalizeSearchKeyword("Bocchi   The Rock")).toBe("bocchi the rock");
    expect(normalizeSearchKeyword("孤独摇滚")).toBe(normalizeSearchKeyword(" 孤独摇滚 "));
  });
});

describe("decideSearchGate", () => {
  it("fresh when keyword is new and under budget", () => {
    expect(
      decideSearchGate({ normalizedKeyword: "a", seenKeywords: new Set(), maxDistinctSearches: 8 }),
    ).toBe("fresh");
  });

  it("duplicate when keyword was already searched — no provider re-hit", () => {
    expect(
      decideSearchGate({
        normalizedKeyword: "a",
        seenKeywords: new Set(["a"]),
        maxDistinctSearches: 8,
      }),
    ).toBe("duplicate");
  });

  it("duplicate takes precedence over an exhausted budget", () => {
    // Re-searching an already-seen keyword is always free, even at the cap.
    expect(
      decideSearchGate({
        normalizedKeyword: "a",
        seenKeywords: new Set(["a", "b", "c"]),
        maxDistinctSearches: 3,
      }),
    ).toBe("duplicate");
  });

  it("exhausted when a NEW keyword would exceed the distinct-search budget", () => {
    expect(
      decideSearchGate({
        normalizedKeyword: "d",
        seenKeywords: new Set(["a", "b", "c"]),
        maxDistinctSearches: 3,
      }),
    ).toBe("exhausted");
  });

  it("allows exactly up to the budget of distinct searches", () => {
    expect(
      decideSearchGate({
        normalizedKeyword: "c",
        seenKeywords: new Set(["a", "b"]),
        maxDistinctSearches: 3,
      }),
    ).toBe("fresh");
  });
});

describe("decideSearchGate — reserve zone (softThreshold, the movie 8+2 budget)", () => {
  const setOfSize = (n: number): Set<string> => new Set(Array.from({ length: n }, (_, i) => `kw${i}`));

  it("returns reserve for a NEW keyword at/above softThreshold but below max", () => {
    expect(
      decideSearchGate({ normalizedKeyword: "new", seenKeywords: setOfSize(8), maxDistinctSearches: 10, softThreshold: 8 }),
    ).toBe("reserve");
    expect(
      decideSearchGate({ normalizedKeyword: "new", seenKeywords: setOfSize(9), maxDistinctSearches: 10, softThreshold: 8 }),
    ).toBe("reserve");
  });

  it("stays fresh below the softThreshold", () => {
    expect(
      decideSearchGate({ normalizedKeyword: "new", seenKeywords: setOfSize(7), maxDistinctSearches: 10, softThreshold: 8 }),
    ).toBe("fresh");
  });

  it("is exhausted at max even with a softThreshold set", () => {
    expect(
      decideSearchGate({ normalizedKeyword: "new", seenKeywords: setOfSize(10), maxDistinctSearches: 10, softThreshold: 8 }),
    ).toBe("exhausted");
  });

  it("duplicate still takes precedence inside the reserve zone", () => {
    const seen = setOfSize(8);
    seen.add("dup");
    expect(
      decideSearchGate({ normalizedKeyword: "dup", seenKeywords: seen, maxDistinctSearches: 10, softThreshold: 8 }),
    ).toBe("duplicate");
  });

  it("without softThreshold behaves exactly as before (no reserve zone)", () => {
    expect(
      decideSearchGate({ normalizedKeyword: "new", seenKeywords: setOfSize(8), maxDistinctSearches: 8 }),
    ).toBe("exhausted");
  });
});
