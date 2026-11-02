import { describe, expect, it } from "vitest";
import { syncSeasonNeed } from "../src/acquisition-v2/sync-need.js";

/**
 * 应有(TMDB aired) vs 实有(DB obtained marks) = 缺什么. The sync is a PURE
 * computation over the DB marks — it NEVER scans 115 and NEVER parses filenames
 * (§1.11/§1.13/§7b). 实有 is what the agent marked via markObtained, recorded in
 * the DB; not a per-run file scan.
 */
describe("syncSeasonNeed — 应有 vs 实有(DB marks) = 缺什么 (no 115 scan, no parser)", () => {
  it("missing = aired episodes not in the DB obtained marks", () => {
    const result = syncSeasonNeed({
      seasons: [{ seasonNumber: 1, latestAiredEpisode: 5 }],
      obtained: ["S01E01", "S01E02", "S01E03"],
    });
    expect(result.missing).toEqual(["S01E04", "S01E05"]);
    expect(result.obtained).toEqual(["S01E01", "S01E02", "S01E03"]);
  });

  it("computes a CROSS-SEASON missing set (need can span seasons)", () => {
    const result = syncSeasonNeed({
      seasons: [
        { seasonNumber: 1, latestAiredEpisode: 2 },
        { seasonNumber: 2, latestAiredEpisode: 3 },
      ],
      obtained: ["S01E01", "S01E02", "S02E01"], // season 1 complete, season 2 partial
    });
    expect(result.missing).toEqual(["S02E02", "S02E03"]); // only season 2's gap
  });

  it("unaired episodes are NOT missing; DB marks beyond the aired cursor are provider-ahead", () => {
    const result = syncSeasonNeed({
      seasons: [{ seasonNumber: 1, latestAiredEpisode: 2 }],
      obtained: ["S01E01", "S01E02", "S01E03"], // E03 marked but TMDB says only E02 aired
    });
    expect(result.missing).toEqual([]);
    expect(result.providerAhead).toEqual(["S01E03"]);
  });

  it("实有 is PURELY the DB marks — empty marks ⇒ every aired episode is missing (no disk fallback)", () => {
    const result = syncSeasonNeed({
      seasons: [{ seasonNumber: 1, latestAiredEpisode: 3 }],
      obtained: [],
    });
    expect(result.missing).toEqual(["S01E01", "S01E02", "S01E03"]);
    expect(result.obtained).toEqual([]);
  });
});
