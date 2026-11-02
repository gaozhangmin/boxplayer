import { describe, expect, it } from "vitest";
import {
  InMemoryWorkflowRepository,
  type MediaTitle,
  type PersistWorkflowRunSnapshotInput,
  type TrackedSeason,
  type WorkflowRun,
} from "../src/index.js";

function runningSnapshot(id: string): PersistWorkflowRunSnapshotInput {
  const title: MediaTitle = {
    id: "t1",
    tmdbId: 1,
    type: "tv",
    title: "Show",
    originalTitle: "Show",
    year: 2026,
    aliases: [],
  };
  const season: TrackedSeason = {
    id: "t1_s1",
    mediaTitleId: title.id,
    seasonNumber: 1,
    status: "active",
    qualityPreference: "4K",
    storageDirectoryId: "dir",
    totalEpisodes: 12,
    latestAiredEpisode: 6,
    latestAiredSource: "metadata",
  };
  const workflowRun: WorkflowRun = {
    id,
    kind: "type2_init",
    status: "running",
    trackedSeasonId: season.id,
    startedAt: "2026-06-17T00:00:00.000Z",
    finishedAt: null,
    auditEvents: [],
  };
  return {
    title,
    season,
    workflowRun,
    episodes: [],
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications: [],
  };
}

describe("updateWorkflowRunProgress", () => {
  it("writes the live progress onto the run", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.saveWorkflowRunSnapshot(runningSnapshot("run_1"));

    await repo.updateWorkflowRunProgress("run_1", {
      activity: "正在转存到网盘…",
      phase: "transfer",
      percent: 40,
      updatedAt: "2026-06-17T00:00:10.000Z",
    });

    const snap = await repo.getWorkflowRunSnapshot("run_1");
    expect(snap?.workflowRun.progress).toMatchObject({ activity: "正在转存到网盘…", phase: "transfer", percent: 40 });
  });

  it("clamps percent monotonically but lets the activity text follow the latest", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.saveWorkflowRunSnapshot(runningSnapshot("run_2"));

    await repo.updateWorkflowRunProgress("run_2", { activity: "转存", phase: "transfer", percent: 55, updatedAt: "t1" });
    await repo.updateWorkflowRunProgress("run_2", { activity: "整理(相位回退)", phase: "organize", percent: 30, updatedAt: "t2" });

    const snap = await repo.getWorkflowRunSnapshot("run_2");
    expect(snap?.workflowRun.progress?.percent).toBe(55); // never rewinds
    expect(snap?.workflowRun.progress?.activity).toBe("整理(相位回退)"); // text is latest
  });

  it("is a no-op for an unknown run id (never throws)", async () => {
    const repo = new InMemoryWorkflowRepository();
    await expect(
      repo.updateWorkflowRunProgress("nope", { activity: "x", phase: "search", percent: 5, updatedAt: "t" }),
    ).resolves.toBeUndefined();
  });
});
