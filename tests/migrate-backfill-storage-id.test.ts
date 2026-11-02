import { describe, expect, it } from "vitest";
import {
  episodeCode,
  InMemoryWorkflowRepository,
  type EpisodeState,
  type MediaTitle,
  type PersistWorkflowRunSnapshotInput,
  type TrackedSeason,
  type WorkflowRun,
} from "../src/index.js";

/** A legacy snapshot with NO connectedStorageId (pre-tree-model row). */
function legacySnapshot(accountId: string, suffix: string): PersistWorkflowRunSnapshotInput {
  const title: MediaTitle = {
    id: `title_${suffix}`,
    tmdbId: 1,
    type: "tv",
    title: `Show ${suffix}`,
    originalTitle: `Show ${suffix}`,
    year: 2026,
    aliases: [],
  };
  const season: TrackedSeason = {
    id: `season_${suffix}`,
    mediaTitleId: title.id,
    seasonNumber: 1,
    status: "active",
    qualityPreference: "4K",
    storageDirectoryId: "dir_1",
    totalEpisodes: 1,
    latestAiredEpisode: 1,
    latestAiredSource: "metadata",
  };
  const workflowRun: WorkflowRun = {
    id: `run_${suffix}`,
    kind: "type2_init",
    status: "queued",
    trackedSeasonId: season.id,
    startedAt: "2026-06-18T00:00:00.000Z",
    finishedAt: null,
    auditEvents: [],
  };
  const episodes: EpisodeState[] = [
    {
      trackedSeasonId: season.id,
      episodeCode: episodeCode(1, 1),
      airDate: null,
      title: "Episode 1",
      airStatus: "aired",
      obtained: true,
      metadataStatus: "confirmed",
      verifiedFileIds: ["file_1"],
    },
  ];
  // NOTE: no connectedStorageId — this is the legacy shape backfill must fix.
  return {
    accountId,
    title,
    season,
    workflowRun,
    episodes,
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications: [],
  };
}

function storageRow(accountId: string, id: string, createdAt: string) {
  return {
    id,
    accountId,
    provider: "pan115",
    providerUid: id, // unique uid per drive
    payload: { cookie: "c" },
    createdAt,
  };
}

describe("backfillConnectedStorageId (InMemory)", () => {
  it("fills legacy rows with the account's single drive, idempotently", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.upsertConnectedStorage(storageRow("acct1", "csA", "2026-06-01T00:00:00.000Z"));
    await repo.saveWorkflowRunSnapshot(legacySnapshot("acct1", "a"));

    // before: pinning storage csA sees nothing (the row is unscoped/null)
    expect(
      (await repo.listTrackedSeasonStates({ accountId: "acct1", connectedStorageId: "csA" })).length,
    ).toBe(0);

    const filled = await repo.backfillConnectedStorageId();
    expect(filled).toBe(1);

    // after: the row is now pinned to csA
    const scoped = await repo.listTrackedSeasonStates({ accountId: "acct1", connectedStorageId: "csA" });
    expect(scoped.map((s) => s.title.id)).toEqual(["title_a"]);
    expect(scoped[0]?.connectedStorageId).toBe("csA");

    // idempotent: re-running changes nothing more
    expect(await repo.backfillConnectedStorageId()).toBe(0);
  });

  it("when the account has multiple drives, fills to the earliest (primary)", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.upsertConnectedStorage(storageRow("acct1", "csNew", "2026-06-10T00:00:00.000Z"));
    await repo.upsertConnectedStorage(storageRow("acct1", "csOld", "2026-06-01T00:00:00.000Z"));
    await repo.saveWorkflowRunSnapshot(legacySnapshot("acct1", "a"));

    await repo.backfillConnectedStorageId();
    const scoped = await repo.listTrackedSeasonStates({ accountId: "acct1", connectedStorageId: "csOld" });
    expect(scoped.map((s) => s.title.id)).toEqual(["title_a"]);
  });

  it("an account with no drives leaves its legacy rows untouched (no crash)", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.saveWorkflowRunSnapshot(legacySnapshot("acct_nodrive", "a"));
    expect(await repo.backfillConnectedStorageId()).toBe(0);
    // still visible account-only (unscoped read)
    expect((await repo.listTrackedSeasonStates("acct_nodrive")).length).toBe(1);
  });
});
