import { describe, expect, it } from "vitest";
import {
  createEpisodeStates,
  getTrackedSeasonStatusView,
  InMemoryWorkflowRepository,
  type EpisodeState,
  type MediaTitle,
  type TrackedSeason,
  type WorkflowRun,
} from "../src/index.js";

describe("getTrackedSeasonStatusView", () => {
  it("projects repository state into episode grid statuses for the GUI", async () => {
    const repository = new InMemoryWorkflowRepository();
    const { title, season } = fixture();
    const episodes = [
      ...createEpisodeStates({
        trackedSeasonId: season.id,
        seasonNumber: season.seasonNumber,
        totalEpisodes: season.totalEpisodes,
        latestAiredEpisode: season.latestAiredEpisode,
      }).map((episode) =>
        episode.episodeCode === "S01E01"
          ? {
              ...episode,
              obtained: true,
              verifiedFileIds: ["file_1"],
            }
          : episode,
      ),
      providerAheadEpisode(season.id),
    ];
    await repository.saveWorkflowRunSnapshot({
      title,
      season,
      workflowRun: workflowRun(season),
      episodes,
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });

    const view = await getTrackedSeasonStatusView({
      repository,
      trackedSeasonId: season.id,
    });

    expect(view).toMatchObject({
      titleId: "title_show",
      title: "Show",
      trackedSeasonId: "season_show_1",
      seasonNumber: 1,
      totalEpisodes: 3,
      latestAiredEpisode: 2,
      obtainedEpisodes: ["S01E01", "S01E04"],
      missingAiredEpisodes: ["S01E02"],
      providerAheadEpisodes: ["S01E04"],
      obtainedCount: 2,
      missingAiredCount: 1,
    });
    expect(view?.episodes.map((episode) => [episode.episodeCode, episode.displayState])).toEqual([
      ["S01E01", "obtained"],
      ["S01E02", "missing_aired"],
      ["S01E03", "unaired"],
      ["S01E04", "provider_ahead"],
    ]);
  });

  it("returns null when the tracked season does not exist", async () => {
    const view = await getTrackedSeasonStatusView({
      repository: new InMemoryWorkflowRepository(),
      trackedSeasonId: "missing",
    });

    expect(view).toBeNull();
  });
});

function fixture(): { title: MediaTitle; season: TrackedSeason } {
  const title: MediaTitle = {
    id: "title_show",
    tmdbId: 1,
    type: "tv",
    title: "Show",
    originalTitle: "Show",
    year: 2026,
    aliases: [],
  };
  return {
    title,
    season: {
      id: "season_show_1",
      mediaTitleId: title.id,
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "dir_show_s1",
      totalEpisodes: 3,
      latestAiredEpisode: 2,
      latestAiredSource: "metadata",
    },
  };
}

function workflowRun(season: TrackedSeason): WorkflowRun {
  return {
    id: "run_1",
    kind: "type2_init",
    status: "succeeded",
    trackedSeasonId: season.id,
    startedAt: "2026-06-11T00:00:00.000Z",
    finishedAt: "2026-06-11T00:01:00.000Z",
    auditEvents: [],
  };
}

function providerAheadEpisode(trackedSeasonId: string): EpisodeState {
  return {
    trackedSeasonId,
    episodeCode: "S01E04",
    airDate: null,
    title: "S01E04",
    airStatus: "unknown",
    obtained: true,
    metadataStatus: "provider_ahead",
    verifiedFileIds: ["file_4"],
  };
}
