import { describe, expect, it } from "vitest";
import {
  InMemoryWorkflowRepository,
  type MediaTitle,
  type PersistWorkflowRunSnapshotInput,
  type TrackedSeason,
  type WorkflowStatus,
} from "../src/index.js";

function snapshot(id: string, status: WorkflowStatus, seasonId = "t1_s1", titleId = "t1"): PersistWorkflowRunSnapshotInput {
  const title: MediaTitle = {
    id: titleId,
    tmdbId: 1,
    type: "tv",
    title: "Show",
    originalTitle: "Show",
    year: 2026,
    aliases: [],
  };
  const season: TrackedSeason = {
    id: seasonId,
    mediaTitleId: titleId,
    seasonNumber: 1,
    status: "active",
    qualityPreference: "4K",
    storageDirectoryId: "dir",
    totalEpisodes: 12,
    latestAiredEpisode: 6,
    latestAiredSource: "metadata",
  };
  return {
    title,
    season,
    workflowRun: {
      id,
      kind: "type2_init",
      status,
      trackedSeasonId: seasonId,
      startedAt: "2026-06-17T00:00:00.000Z",
      finishedAt: status === "queued" || status === "running" ? null : "2026-06-17T00:01:00.000Z",
      auditEvents: [],
    },
    episodes: [],
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications: [],
  };
}

describe("cancelQueuedWorkflowRun", () => {
  it("cancels a queued run and removes the title from the library (tracking vanishes)", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.saveWorkflowRunSnapshot(snapshot("run_q", "queued"));
    expect((await repo.listTrackedSeasonStates()).length).toBe(1);

    const result = await repo.cancelQueuedWorkflowRun("run_q");

    expect(result.status).toBe("cancelled");
    expect(await repo.getWorkflowRunSnapshot("run_q")).toBeNull();
    expect(await repo.listTrackedSeasonStates()).toEqual([]);
    expect(await repo.listActiveWorkflowRuns()).toEqual([]);
  });

  it("refuses to cancel a run the worker already claimed (running)", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.saveWorkflowRunSnapshot(snapshot("run_r", "running"));

    const result = await repo.cancelQueuedWorkflowRun("run_r");

    expect(result.status).toBe("not_cancellable");
    expect(await repo.getWorkflowRunSnapshot("run_r")).not.toBeNull();
  });

  it("is not_cancellable for an unknown run id", async () => {
    const repo = new InMemoryWorkflowRepository();
    expect((await repo.cancelQueuedWorkflowRun("nope")).status).toBe("not_cancellable");
  });

  it("keeps a co-tracked season of the same title intact (only removes the cancelled one)", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.saveWorkflowRunSnapshot(snapshot("run_done", "succeeded", "t1_s1", "t1"));
    await repo.saveWorkflowRunSnapshot(snapshot("run_q2", "queued", "t1_s2", "t1"));

    await repo.cancelQueuedWorkflowRun("run_q2");

    const seasons = await repo.listTrackedSeasonStates();
    expect(seasons.map((s) => s.season.id)).toEqual(["t1_s1"]);
  });
});
