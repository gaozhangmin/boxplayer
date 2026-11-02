import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "../src/domain.js";
import {
  AUTO_REQUEUE_MAX,
  AUTO_REQUEUE_BACKOFF_MS,
  requeueWorkflowRunForRetry,
  failWorkflowRun,
  retriedWorkflowRun,
  claimableQueuedRuns,
} from "../src/repository.js";

const baseRun: WorkflowRun = {
  id: "run_1",
  kind: "movie_init",
  status: "running",
  trackedSeasonId: "tmdb_movie_1_movie",
  startedAt: "2026-06-21T05:00:00.000Z",
  finishedAt: null,
  auditEvents: [],
};

describe("requeueWorkflowRunForRetry", () => {
  it("requeues with incremented count and backoff nextAttemptAt", () => {
    const now = "2026-06-21T05:30:00.000Z";
    const out = requeueWorkflowRunForRetry(baseRun, "boom", now);
    expect(out.status).toBe("queued");
    expect(out.finishedAt).toBeNull();
    expect(out.autoRequeueCount).toBe(1);
    expect(out.nextAttemptAt).toBe(
      new Date(Date.parse(now) + AUTO_REQUEUE_BACKOFF_MS[0]!).toISOString(),
    );
    expect(out.auditEvents.at(-1)?.type).toBe("workflow_auto_requeued");
  });

  it("uses the backoff slot for the CURRENT attempt number", () => {
    const now = "2026-06-21T05:30:00.000Z";
    const second = requeueWorkflowRunForRetry({ ...baseRun, autoRequeueCount: 1 }, "boom", now);
    expect(second.autoRequeueCount).toBe(2);
    expect(second.nextAttemptAt).toBe(
      new Date(Date.parse(now) + AUTO_REQUEUE_BACKOFF_MS[1]!).toISOString(),
    );
  });
});

describe("failWorkflowRun", () => {
  it("marks terminal failed with finishedAt + audit", () => {
    const now = "2026-06-21T05:30:00.000Z";
    const out = failWorkflowRun(baseRun, "Cannot connect to API", now);
    expect(out.status).toBe("failed");
    expect(out.finishedAt).toBe(now);
    expect(out.auditEvents.at(-1)).toMatchObject({
      type: "workflow_failed",
      message: expect.stringContaining("Cannot connect"),
    });
  });
});

describe("retriedWorkflowRun", () => {
  const failed: WorkflowRun = {
    ...baseRun,
    status: "failed",
    finishedAt: "2026-06-21T05:30:00.000Z",
    autoRequeueCount: 3,
    nextAttemptAt: "2026-06-21T05:45:00.000Z",
  };
  it("resets a failed run to immediately-claimable queued", () => {
    const out = retriedWorkflowRun(failed, "2026-06-21T06:00:00.000Z");
    expect(out.status).toBe("queued");
    expect(out.finishedAt).toBeNull();
    expect(out.autoRequeueCount).toBe(0);
    expect(out.nextAttemptAt).toBeUndefined();
    expect(out.auditEvents.at(-1)?.type).toBe("workflow_manual_retried");
  });
});

describe("claimableQueuedRuns", () => {
  const now = "2026-06-21T05:30:00.000Z";
  const mk = (id: string, startedAt: string, extra: Partial<WorkflowRun> = {}): WorkflowRun => ({
    id,
    kind: "movie_init",
    status: "queued",
    trackedSeasonId: "s",
    startedAt,
    finishedAt: null,
    auditEvents: [],
    ...extra,
  });

  it("returns oldest eligible queued run of the kind, skipping future nextAttemptAt", () => {
    const runs = [
      mk("future", "2026-06-21T05:00:00.000Z", { nextAttemptAt: "2026-06-21T05:35:00.000Z" }),
      mk("ready-old", "2026-06-21T05:10:00.000Z"),
      mk("ready-new", "2026-06-21T05:20:00.000Z"),
      mk("running", "2026-06-21T04:00:00.000Z", { status: "running" }),
    ];
    const result = claimableQueuedRuns(runs, "movie_init", now);
    expect(result[0]?.id).toBe("ready-old");
    expect(result.map((r) => r.id)).not.toContain("future");
    expect(result.map((r) => r.id)).not.toContain("running");
  });

  it("claims a backed-off run once its nextAttemptAt has passed", () => {
    const runs = [mk("due", "2026-06-21T05:00:00.000Z", { nextAttemptAt: "2026-06-21T05:30:00.000Z" })];
    expect(claimableQueuedRuns(runs, "movie_init", now)[0]?.id).toBe("due");
  });

  it("filters by kind", () => {
    const runs = [mk("tv", "2026-06-21T05:00:00.000Z", { kind: "type2_init" })];
    expect(claimableQueuedRuns(runs, "movie_init", now)).toHaveLength(0);
  });
});

it("AUTO_REQUEUE_MAX matches the backoff schedule length", () => {
  expect(AUTO_REQUEUE_MAX).toBe(3);
  expect(AUTO_REQUEUE_BACKOFF_MS).toEqual([60_000, 300_000, 900_000]);
});
