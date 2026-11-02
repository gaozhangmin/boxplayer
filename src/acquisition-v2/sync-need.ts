import { episodeCode, episodeNumberFromCode, episodePartsFromCode } from "../domain.js";

/**
 * Phase 7b — sync the need. The whole product is a resource-sync problem:
 * compare what SHOULD exist (应有 = aired episodes per season, from TMDB) against
 * what REALLY exists (实有 = the episodes the agent has marked obtained, recorded
 * in the DB), and the difference is what's missing. The need may span seasons.
 *
 * ⚠️ 2026-06-15: this is a PURE computation over the DB obtained marks. It does
 * NOT scan 115 and does NOT parse filenames (§1.11/§1.13/§7b). 实有 is the agent's
 * markObtained set, not a per-run file scan — the agent verifies against the real
 * 115 inside its run (inspectTargetDir, §6b#8), and a stale mark self-heals next
 * patrol. Mirrors the original skill's `db.sync_all` (reads DB obtained; shows
 * with zero missing don't appear). Unaired episodes are NOT missing; DB marks
 * beyond the aired cursor are provider-ahead. (see type-and-multiseason-model)
 */
export interface SeasonSyncInput {
  seasonNumber: number;
  /** Aired up to this episode (the should-exist range is E01..latestAiredEpisode). */
  latestAiredEpisode: number;
}

export interface SeasonNeedResult {
  /** Missing episode codes across all in-scope seasons (e.g. ["S01E07","S02E13"]). */
  missing: string[];
  /** Aired episodes already obtained (per the DB marks). */
  obtained: string[];
  /** DB marks beyond the aired cursor (115 had them before TMDB caught up). */
  providerAhead: string[];
}

export function syncSeasonNeed(input: {
  seasons: SeasonSyncInput[];
  /** 实有 = the DB obtained marks (agent's markObtained). NOT a 115 scan. */
  obtained: string[];
}): SeasonNeedResult {
  const have = new Set(input.obtained);
  const missing: string[] = [];
  const obtained: string[] = [];

  for (const season of input.seasons) {
    // Should-exist = aired episodes only; unaired are NOT missing.
    for (let episode = 1; episode <= season.latestAiredEpisode; episode += 1) {
      const code = episodeCode(season.seasonNumber, episode);
      (have.has(code) ? obtained : missing).push(code);
    }
  }

  // Provider-ahead = a DB mark beyond the aired cursor of an in-scope season.
  const airedMax = new Map(input.seasons.map((season) => [season.seasonNumber, season.latestAiredEpisode]));
  const providerAhead: string[] = [];
  for (const code of have) {
    const max = airedMax.get(episodePartsFromCode(code).seasonNumber);
    if (max !== undefined && episodeNumberFromCode(code) > max) {
      providerAhead.push(code);
    }
  }

  return { missing, obtained, providerAhead };
}
