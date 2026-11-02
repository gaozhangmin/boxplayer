import { describe, expect, it, vi } from "vitest";
import type { MediaTitle, TrackedSeason, WorkflowRun } from "../src/domain.js";
import type { PersistedWorkflowRunSnapshot, PersistWorkflowRunSnapshotInput } from "../src/repository.js";
import { handleWorkflowRunFailure } from "../src/worker.js";

const title: MediaTitle = {
  id: "tmdb_movie_1",
  tmdbId: 1,
  type: "movie",
  title: "测试电影",
  originalTitle: "Test",
  year: 2020,
  aliases: [],
};

const season: TrackedSeason = {
  id: "tmdb_movie_1_movie",
  mediaTitleId: "tmdb_movie_1",
  seasonNumber: 1,
  status: "completed",
  qualityPreference: "4K",
  storageDirectoryId: "",
  totalEpisodes: 1,
  latestAiredEpisode: 1,
  latestAiredSource: "manual",
};

function snapshot(run: Partial<WorkflowRun> = {}): PersistedWorkflowRunSnapshot {
  const workflowRun: WorkflowRun = {
    id: "r1",
    kind: "movie_init",
    status: "running",
    trackedSeasonId: "tmdb_movie_1_movie",
    startedAt: "2026-06-21T05:00:00.000Z",
    finishedAt: null,
    auditEvents: [],
    ...run,
  };
  return {
    accountId: "acct_default",
    connectedStorageId: "cs_1",
    title,
    season,
    workflowRun,
    episodes: [],
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications: [],
    obtainedEpisodes: [],
    providerAheadEpisodes: [],
  } as PersistedWorkflowRunSnapshot;
}

const now = () => "2026-06-21T05:30:00.000Z";

describe("handleWorkflowRunFailure", () => {
  it("auto-requeues a transient error under the cap (queued + retrying notification)", async () => {
    const save = vi.fn(async (_input: PersistWorkflowRunSnapshotInput) => {});
    const out = await handleWorkflowRunFailure({
      claimed: snapshot(),
      error: new Error("Cannot connect to API: socket disconnected"),
      repository: { saveWorkflowRunSnapshot: save },
      now,
    });
    expect(out.status).toBe("auto_requeued");
    const saved = save.mock.calls[0]![0];
    expect(saved.workflowRun.status).toBe("queued");
    expect(saved.workflowRun.autoRequeueCount).toBe(1);
    expect(saved.workflowRun.nextAttemptAt).toBeDefined();
    expect(saved.notifications[0]?.report?.status).toBe("retrying");
  });

  it("terminally fails a transient error AT the cap (failed + failed notification)", async () => {
    const save = vi.fn(async (_input: PersistWorkflowRunSnapshotInput) => {});
    const out = await handleWorkflowRunFailure({
      claimed: snapshot({ autoRequeueCount: 3 }),
      error: new Error("socket hang up"),
      repository: { saveWorkflowRunSnapshot: save },
      now,
    });
    expect(out.status).toBe("failed");
    const saved = save.mock.calls[0]![0];
    expect(saved.workflowRun.status).toBe("failed");
    expect(saved.notifications[0]?.report?.status).toBe("failed");
  });

  it("preserves the claimed snapshot's episode bucket across auto-requeue (does NOT wipe it)", async () => {
    const save = vi.fn(async (_input: PersistWorkflowRunSnapshotInput) => {});
    const episodes = [
      {
        trackedSeasonId: "tmdb_movie_1_movie",
        episodeCode: "S01E01",
        airDate: null,
        airStatus: "aired" as const,
        obtained: false,
      },
    ];
    const claimed = { ...snapshot(), episodes } as PersistedWorkflowRunSnapshot;
    await handleWorkflowRunFailure({
      claimed,
      error: new Error("read ECONNRESET"),
      repository: { saveWorkflowRunSnapshot: save },
      now,
    });
    const saved = save.mock.calls[0]![0];
    // Bug (Copilot): saving with episodes:[] deletes the season's reserved bucket
    // (replaceWorkflowRunSnapshot wipes by season then re-inserts) — losing tracked
    // state on a run that is going BACK to queued. Must round-trip claimed.episodes.
    expect(saved.episodes).toHaveLength(1);
    expect(saved.episodes[0]?.episodeCode).toBe("S01E01");
  });

  it("maps an LLM 401 'Unauthorized' failure to actionable guidance in the user-facing message (#49)", async () => {
    const save = vi.fn(async (_input: PersistWorkflowRunSnapshotInput) => {});
    const out = await handleWorkflowRunFailure({
      claimed: snapshot(),
      error: new Error("Unauthorized"),
      repository: { saveWorkflowRunSnapshot: save },
      now,
    });
    expect(out.status).toBe("failed");
    expect(out.errorMessage).toContain("AI 模型鉴权失败");
    expect(out.errorMessage).not.toBe("Unauthorized");
    const saved = save.mock.calls[0]![0];
    const body = saved.notifications[0]?.body ?? "";
    expect(body).toContain("设置 → AI 模型");
    expect(body).not.toContain("Unauthorized");
  });

  it("leaves a non-LLM failure message unchanged (no false positive)", async () => {
    const save = vi.fn(async (_input: PersistWorkflowRunSnapshotInput) => {});
    const out = await handleWorkflowRunFailure({
      claimed: snapshot(),
      error: new Error("QUARK_TRANSFER_FAILED: dead share"),
      repository: { saveWorkflowRunSnapshot: save },
      now,
    });
    expect(out.errorMessage).toBe("QUARK_TRANSFER_FAILED: dead share");
  });

  it("terminally fails a NON-transient error immediately (count=0)", async () => {
    const save = vi.fn(async (_input: PersistWorkflowRunSnapshotInput) => {});
    const out = await handleWorkflowRunFailure({
      claimed: snapshot(),
      error: new Error("agent gave up: no coverage"),
      repository: { saveWorkflowRunSnapshot: save },
      now,
    });
    expect(out.status).toBe("failed");
    const saved = save.mock.calls[0]![0];
    expect(saved.workflowRun.status).toBe("failed");
    expect(saved.notifications[0]?.report?.status).toBe("failed");
  });
});
