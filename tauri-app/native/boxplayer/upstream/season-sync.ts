import { createEpisodeStates } from "./domain.js";
import type { EpisodeState, TrackedSeason } from "./domain.js";

/**
 * Re-sync a tracked season against fresh TMDB metadata — the GUI equivalent of
 * the original skill's Type 3 `db.sync_all(tmdb)`. Without this, a season's
 * `latestAiredEpisode` is frozen at tracking time and the sweep can never
 * discover episodes that aired AFTER tracking began.
 *
 * Rules:
 * - `latestAiredEpisode` and `totalEpisodes` only ever advance (max), so a
 *   stale/regressing TMDB read never un-airs episodes already known.
 * - Newly-aired episodes surface as aired-but-not-obtained (real gaps the
 *   sweep will then acquire); a higher total grows the episode list.
 * - Already-obtained episodes keep their obtained flag and verified files.
 * - `status` is intentionally left untouched: episodes still need acquiring,
 *   so the season must stay in whatever lifecycle state it was — only the
 *   finale (all obtained) graduates it to completed.
 */
export function syncSeasonAgainstMetadata(input: {
  season: TrackedSeason;
  episodes: EpisodeState[];
  latestAiredEpisode: number;
  totalEpisodes: number;
}): { season: TrackedSeason; episodes: EpisodeState[]; changed: boolean } {
  const newTotal = Math.max(input.season.totalEpisodes, input.totalEpisodes);
  const newLatest = Math.min(newTotal, Math.max(input.season.latestAiredEpisode, input.latestAiredEpisode));
  const changed = newTotal !== input.season.totalEpisodes || newLatest !== input.season.latestAiredEpisode;
  if (!changed) {
    return { season: input.season, episodes: input.episodes, changed: false };
  }

  const season: TrackedSeason = { ...input.season, totalEpisodes: newTotal, latestAiredEpisode: newLatest };
  const baseline = createEpisodeStates({
    trackedSeasonId: input.season.id,
    seasonNumber: input.season.seasonNumber,
    totalEpisodes: newTotal,
    latestAiredEpisode: newLatest,
  });
  const oldByCode = new Map(input.episodes.map((episode) => [episode.episodeCode, episode]));
  const merged: EpisodeState[] = baseline.map((base) => {
    const old = oldByCode.get(base.episodeCode);
    if (old === undefined) {
      return base;
    }
    if (old.obtained) {
      return {
        ...base,
        obtained: true,
        verifiedFileIds: old.verifiedFileIds,
        metadataStatus: old.metadataStatus,
        airDate: old.airDate,
        title: old.title,
      };
    }
    return { ...base, airDate: old.airDate, title: old.title };
  });

  // Preserve obtained provider-ahead episodes that sit beyond the (new) total.
  const mergedCodes = new Set(merged.map((episode) => episode.episodeCode));
  for (const old of input.episodes) {
    if (!mergedCodes.has(old.episodeCode) && old.obtained) {
      merged.push(old);
    }
  }

  return { season, episodes: merged, changed: true };
}
