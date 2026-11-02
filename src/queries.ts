import {
  episodeNumberFromCode,
  type AirStatus,
  type EpisodeState,
  type MetadataStatus,
} from "./domain.js";
import type { WorkflowRepository } from "./repository.js";

export type EpisodeDisplayState = "obtained" | "provider_ahead" | "missing_aired" | "unaired" | "unknown";

export interface EpisodeStatusCell {
  episodeCode: string;
  airStatus: AirStatus;
  obtained: boolean;
  metadataStatus: MetadataStatus;
  verifiedFileCount: number;
  displayState: EpisodeDisplayState;
}

export interface TrackedSeasonStatusView {
  titleId: string;
  title: string;
  trackedSeasonId: string;
  seasonNumber: number;
  totalEpisodes: number;
  latestAiredEpisode: number;
  obtainedEpisodes: string[];
  missingAiredEpisodes: string[];
  providerAheadEpisodes: string[];
  obtainedCount: number;
  missingAiredCount: number;
  episodes: EpisodeStatusCell[];
}

export async function getTrackedSeasonStatusView(input: {
  repository: WorkflowRepository;
  trackedSeasonId: string;
  accountId?: string;
}): Promise<TrackedSeasonStatusView | null> {
  const state = await input.repository.getTrackedSeasonState(input.trackedSeasonId, input.accountId);
  if (!state) {
    return null;
  }

  const episodes = [...state.episodes].sort(
    (a, b) => episodeNumberFromCode(a.episodeCode) - episodeNumberFromCode(b.episodeCode),
  );
  const cells = episodes.map(toEpisodeStatusCell);
  const obtainedEpisodes = cells
    .filter((episode) => episode.obtained)
    .map((episode) => episode.episodeCode);
  const missingAiredEpisodes = cells
    .filter((episode) => episode.displayState === "missing_aired")
    .map((episode) => episode.episodeCode);
  const providerAheadEpisodes = cells
    .filter((episode) => episode.displayState === "provider_ahead")
    .map((episode) => episode.episodeCode);

  return {
    titleId: state.title.id,
    title: state.title.title,
    trackedSeasonId: state.season.id,
    seasonNumber: state.season.seasonNumber,
    totalEpisodes: state.season.totalEpisodes,
    latestAiredEpisode: state.season.latestAiredEpisode,
    obtainedEpisodes,
    missingAiredEpisodes,
    providerAheadEpisodes,
    obtainedCount: obtainedEpisodes.length,
    missingAiredCount: missingAiredEpisodes.length,
    episodes: cells,
  };
}

function toEpisodeStatusCell(episode: EpisodeState): EpisodeStatusCell {
  return {
    episodeCode: episode.episodeCode,
    airStatus: episode.airStatus,
    obtained: episode.obtained,
    metadataStatus: episode.metadataStatus,
    verifiedFileCount: episode.verifiedFileIds.length,
    displayState: displayStateForEpisode(episode),
  };
}

function displayStateForEpisode(episode: EpisodeState): EpisodeDisplayState {
  if (episode.obtained && episode.metadataStatus === "provider_ahead") {
    return "provider_ahead";
  }
  if (episode.obtained) {
    return "obtained";
  }
  if (episode.airStatus === "aired") {
    return "missing_aired";
  }
  if (episode.airStatus === "unaired") {
    return "unaired";
  }
  return "unknown";
}
