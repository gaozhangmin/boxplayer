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

/** A minimal snapshot scoped to a specific (account, storage), keyed so two
 *  storages of the same account never collide. */
function snapshotFor(
  accountId: string,
  connectedStorageId: string,
  suffix: string,
): PersistWorkflowRunSnapshotInput {
  const title: MediaTitle = {
    id: `title_${suffix}`,
    tmdbId: 100,
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
  return {
    accountId,
    connectedStorageId,
    title,
    season,
    workflowRun,
    episodes,
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications: [
      {
        id: `notif_${suffix}`,
        workflowRunId: workflowRun.id,
        kind: "tracking_initialized",
        title: "init",
        body: "done",
        createdAt: "2026-06-18T00:00:00.000Z",
      },
    ],
  };
}

describe("repository (account, storage) scope — InMemory", () => {
  it("listTrackedSeasonStates isolates by storage within one account", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.saveWorkflowRunSnapshot(snapshotFor("acct1", "csA", "a"));
    await repo.saveWorkflowRunSnapshot(snapshotFor("acct1", "csB", "b"));

    const a = await repo.listTrackedSeasonStates({ accountId: "acct1", connectedStorageId: "csA" });
    expect(a.map((s) => s.title.id)).toEqual(["title_a"]);
    const b = await repo.listTrackedSeasonStates({ accountId: "acct1", connectedStorageId: "csB" });
    expect(b.map((s) => s.title.id)).toEqual(["title_b"]);
  });

  it("getWorkflowRunSnapshot returns null cross-storage, carries storageId same-storage", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.saveWorkflowRunSnapshot(snapshotFor("acct1", "csA", "a"));
    expect(
      await repo.getWorkflowRunSnapshot("run_a", { accountId: "acct1", connectedStorageId: "csB" }),
    ).toBeNull();
    const same = await repo.getWorkflowRunSnapshot("run_a", { accountId: "acct1", connectedStorageId: "csA" });
    expect(same?.connectedStorageId).toBe("csA");
  });

  it("listNotifications isolates per-drive", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.saveWorkflowRunSnapshot(snapshotFor("acct1", "csA", "a"));
    await repo.saveWorkflowRunSnapshot(snapshotFor("acct1", "csB", "b"));
    const a = await repo.listNotifications({ accountId: "acct1", connectedStorageId: "csA" });
    expect(a.map((n) => n.id)).toEqual(["notif_a"]);
  });

  it("a bare accountId (string) keeps legacy account-only behavior (no storage filter)", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.saveWorkflowRunSnapshot(snapshotFor("acct1", "csA", "a"));
    await repo.saveWorkflowRunSnapshot(snapshotFor("acct1", "csB", "b"));
    const all = await repo.listTrackedSeasonStates("acct1");
    expect(all.map((s) => s.title.id).sort()).toEqual(["title_a", "title_b"]);
  });
});
