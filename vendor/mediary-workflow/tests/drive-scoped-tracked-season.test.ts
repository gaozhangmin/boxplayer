import { describe, expect, it } from "vitest";
import { createEpisodeStates, InMemoryWorkflowRepository } from "../src/index.js";
import type { MediaTitle, TrackedSeason } from "../src/index.js";

const TITLE_ID = "tmdb_movie_13";
const SEASON_ID = "tmdb_movie_13_movie";

function movieTitle(): MediaTitle {
  return {
    id: TITLE_ID,
    tmdbId: 13,
    type: "movie",
    title: "阿甘正传",
    originalTitle: "Forrest Gump",
    year: 1994,
    aliases: [],
  };
}

function anchorSeason(): TrackedSeason {
  return {
    id: SEASON_ID,
    mediaTitleId: TITLE_ID,
    seasonNumber: 1,
    status: "active",
    qualityPreference: "4K",
    storageDirectoryId: "",
    totalEpisodes: 1,
    latestAiredEpisode: 1,
    latestAiredSource: "metadata",
  };
}

/** Acquire (obtained) the movie on a specific drive — mirrors a finished movie run. */
async function obtainOnDrive(repo: InMemoryWorkflowRepository, storageId: string): Promise<void> {
  await repo.saveWorkflowRunSnapshot({
    accountId: "acct_1",
    connectedStorageId: storageId,
    title: movieTitle(),
    season: anchorSeason(),
    workflowRun: {
      id: `run_${storageId}`,
      kind: "movie_init",
      status: "succeeded",
      trackedSeasonId: SEASON_ID,
      startedAt: "2026-06-19T00:00:00.000Z",
      finishedAt: "2026-06-19T00:01:00.000Z",
      auditEvents: [],
    },
    episodes: createEpisodeStates({
      trackedSeasonId: SEASON_ID,
      seasonNumber: 1,
      totalEpisodes: 1,
      latestAiredEpisode: 1,
    }).map((episode) => ({ ...episode, obtained: true })),
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications: [],
  });
}

describe("drive-scoped tracked-season (InMemory)", () => {
  it("a movie obtained on drive A does NOT block reserving it on drive B", async () => {
    const repo = new InMemoryWorkflowRepository();
    await obtainOnDrive(repo, "driveA");

    const res = await repo.reserveWorkflowRun({
      accountId: "acct_1",
      connectedStorageId: "driveB",
      title: movieTitle(),
      season: anchorSeason(),
      workflowRun: {
        id: "run_B_new",
        kind: "movie_init",
        status: "queued",
        trackedSeasonId: SEASON_ID,
        startedAt: "2026-06-19T01:00:00.000Z",
        finishedAt: null,
        auditEvents: [],
      },
      episodes: [],
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
      blockIfEpisodeStatesExist: true,
      blockIfTitleHasActiveRun: true,
    });

    expect(res.status).toBe("reserved"); // before fix: already_has_episode_state
  });

  it("episodes are isolated per drive (obtain on A → B sees none; re-saving B never wipes A)", async () => {
    const repo = new InMemoryWorkflowRepository();
    await obtainOnDrive(repo, "driveA");

    // Drive A has the episode; drive B (same title, different drive) has nothing.
    expect((await repo.listEpisodeStates(SEASON_ID, { accountId: "acct_1", connectedStorageId: "driveA" })).length).toBe(1);
    expect((await repo.listEpisodeStates(SEASON_ID, { accountId: "acct_1", connectedStorageId: "driveB" })).length).toBe(0);

    // Acquiring + re-saving on B must NOT clobber A's episodes (the cross-drive wipe bug).
    await obtainOnDrive(repo, "driveB");
    await obtainOnDrive(repo, "driveB");
    expect((await repo.listEpisodeStates(SEASON_ID, { accountId: "acct_1", connectedStorageId: "driveA" })).length).toBe(1);
    expect((await repo.listEpisodeStates(SEASON_ID, { accountId: "acct_1", connectedStorageId: "driveB" })).length).toBe(1);
  });

  it("account-only (null storage) read still sees the rows (single-user 零感知)", async () => {
    const repo = new InMemoryWorkflowRepository();
    await obtainOnDrive(repo, "driveA");

    const states = await repo.listTrackedSeasonStates({ accountId: "acct_1", connectedStorageId: null });
    expect(states.map((s) => s.title.id)).toContain(TITLE_ID);

    const episodes = await repo.listEpisodeStates(SEASON_ID, { accountId: "acct_1", connectedStorageId: null });
    expect(episodes.length).toBe(1);
  });
});
