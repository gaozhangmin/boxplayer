import { describe, expect, it } from "vitest";
import { InMemoryWorkflowRepository } from "../src/index.js";
import type { NotificationEvent, PersistWorkflowRunSnapshotInput } from "../src/index.js";

const ACCOUNT = "acct_default";

function notif(id: string, createdAt: string): NotificationEvent {
  return {
    id,
    workflowRunId: "run_n",
    kind: "tracking_completed",
    title: `N ${id}`,
    body: "body",
    createdAt,
  };
}

function snapshotWithNotifications(notifications: NotificationEvent[]): PersistWorkflowRunSnapshotInput {
  return {
    accountId: ACCOUNT,
    connectedStorageId: "cs_a",
    title: {
      id: "tmdb_tv_1",
      tmdbId: 1,
      type: "tv",
      title: "Show",
      originalTitle: "Show",
      year: 2026,
      aliases: [],
    },
    season: {
      id: "tmdb_tv_1_s1",
      mediaTitleId: "tmdb_tv_1",
      seasonNumber: 1,
      status: "completed",
      qualityPreference: "4K",
      storageDirectoryId: "dir",
      totalEpisodes: 1,
      latestAiredEpisode: 1,
      latestAiredSource: "metadata",
    },
    workflowRun: {
      id: "run_n",
      kind: "type2_init",
      status: "succeeded",
      trackedSeasonId: "tmdb_tv_1_s1",
      startedAt: "2026-06-01T00:00:00.000Z",
      finishedAt: "2026-06-01T00:01:00.000Z",
      auditEvents: [],
    },
    episodes: [],
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications,
  };
}

describe("listNotifications — since (7-day window)", () => {
  it("returns only notifications at/after the `since` cutoff", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.saveWorkflowRunSnapshot(
      snapshotWithNotifications([
        notif("recent", "2026-06-20T00:00:00.000Z"),
        notif("edge", "2026-06-14T00:00:00.000Z"), // exactly at the cutoff → kept
        notif("old", "2026-06-01T00:00:00.000Z"), // older than cutoff → dropped
      ]),
    );

    const within = await repo.listNotifications({
      accountId: ACCOUNT,
      connectedStorageId: "cs_a",
      since: "2026-06-14T00:00:00.000Z",
    });

    expect(within.map((n) => n.id)).toEqual(["recent", "edge"]);
  });

  it("without `since`, returns all (unchanged behavior)", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.saveWorkflowRunSnapshot(
      snapshotWithNotifications([
        notif("recent", "2026-06-20T00:00:00.000Z"),
        notif("old", "2026-06-01T00:00:00.000Z"),
      ]),
    );

    const all = await repo.listNotifications({ accountId: ACCOUNT, connectedStorageId: "cs_a" });
    expect(all.map((n) => n.id).sort()).toEqual(["old", "recent"]);
  });
});
