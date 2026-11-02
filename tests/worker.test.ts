import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import {
  FakeResourceProvider,
  FakeStorageExecutor,
  InMemoryWorkflowRepository,
  queueTrackingInitialization,
  runQueuedType2Workflow,
  type MediaTitle,
  type TrackedSeason,
} from "../src/index.js";

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const;

/** Searches once, honestly reports no coverage. Drives the V2 sandbox loop. */
function noCoverageModel() {
  let i = 0;
  const tool = (name: string, input: unknown) => ({
    content: [{ type: "tool-call" as const, toolCallId: `c${i}`, toolName: name, input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
    usage: USAGE,
    warnings: [],
  });
  return new MockLanguageModelV3({
    doGenerate: async () => {
      i += 1;
      if (i === 1) return tool("searchResources", { keyword: "show" });
      if (i === 2) return tool("reportNoCoverage", { reason: "no candidates" });
      return { content: [{ type: "text" as const, text: "done" }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
    },
  });
}

/** A model whose API is down — a hard infra failure mid-run. */
function throwingModel() {
  return new MockLanguageModelV3({
    doGenerate: async () => {
      throw new Error("agent model unavailable");
    },
  });
}

describe("runQueuedType2Workflow (V2 engine)", () => {
  it("resolves the CLAIMED run's account context (per-account 115 creds) — §7 form B", async () => {
    const repository = new InMemoryWorkflowRepository();
    const { title, season } = trackedFixture();
    await queueTrackingInitialization({
      title,
      season,
      keyword: "Show 4K",
      repository,
      accountId: "acct_bob",
      createWorkflowRunId: () => "run_bob_type2",
      now: fixedNow,
    });

    const bobStorage = new FakeStorageExecutor();
    const seenAccountIds: string[] = [];
    await runQueuedType2Workflow({
      repository,
      // Base deps (the "default account" fallback) — must NOT decide bob's run.
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: noCoverageModel(),
      storageParentDirectoryId: "default_root",
      resolveAccountContext: async (accountId) => {
        seenAccountIds.push(accountId);
        return { storage: bobStorage, storageParentDirectoryId: "bob_root" };
      },
    });

    // The resolver was called with the queued run's OWNER, not the default account.
    expect(seenAccountIds).toEqual(["acct_bob"]);
    const snapshot = await repository.getWorkflowRunSnapshot("run_bob_type2", "acct_bob");
    expect(snapshot?.accountId).toBe("acct_bob");
  });

  it("returns idle when no queued type2 run exists", async () => {
    const result = await runQueuedType2Workflow({
      repository: new InMemoryWorkflowRepository(),
      resourceProvider: new FakeResourceProvider({ keywordResults: {} }),
      storage: new FakeStorageExecutor(),
      model: throwingModel(),
      storageParentDirectoryId: "library_root",
      now: fixedNow,
    });

    expect(result).toEqual({ status: "idle" });
  });

  it("claims one queued type2 run, executes it on the V2 engine, and persists a type2_init snapshot", async () => {
    const repository = new InMemoryWorkflowRepository();
    const { title, season } = trackedFixture();
    await queueTrackingInitialization({
      title,
      season,
      keyword: "Show 4K",
      repository,
      createWorkflowRunId: () => "run_queued_type2",
      now: fixedNow,
    });

    const result = await runQueuedType2Workflow({
      repository,
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: noCoverageModel(),
      storageParentDirectoryId: "library_root",
      now: fixedNow,
    });

    expect(result).toMatchObject({ status: "ran", workflowRunId: "run_queued_type2" });
    const snapshot = await repository.getWorkflowRunSnapshot("run_queued_type2");
    expect(snapshot!.workflowRun.kind).toBe("type2_init");
    expect(snapshot!.workflowRun.status).toBe("no_coverage");
  });

  it("stamps finishedAt at completion (after the run), so it is never before the notification createdAt", async () => {
    const repository = new InMemoryWorkflowRepository();
    const { title, season } = trackedFixture();
    await queueTrackingInitialization({
      title,
      season,
      keyword: "Show 4K",
      repository,
      createWorkflowRunId: () => "run_timing_type2",
      now: fixedNow,
    });

    // A clock that advances on every read. The acquisition reads it mid-run for
    // the notification createdAt; finishedAt must be stamped from a LATER read
    // (post-run), not pre-computed as a call argument before the run executes.
    const now = monotonicNow();
    await runQueuedType2Workflow({
      repository,
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: noCoverageModel(),
      storageParentDirectoryId: "library_root",
      now,
    });

    const snapshot = await repository.getWorkflowRunSnapshot("run_timing_type2");
    const finishedAt = snapshot!.workflowRun.finishedAt;
    expect(finishedAt).not.toBeNull();
    // finishedAt reflects completion, strictly after the run's startedAt.
    expect(finishedAt! > snapshot!.workflowRun.startedAt).toBe(true);
    // The notification createdAt is read DURING the run; finishedAt is stamped
    // from a strictly later read AFTER it. The pre-fix bug froze the engine clock
    // to a precomputed finishedAt, making createdAt === finishedAt (no progress).
    const [notification] = await repository.listNotifications();
    expect(notification).toBeDefined();
    expect(finishedAt! > notification!.createdAt).toBe(true);
  });

  it("marks a claimed run failed and clears initial episode state when the agent model dies mid-run", async () => {
    const repository = new InMemoryWorkflowRepository();
    const { title, season } = trackedFixture();
    await queueTrackingInitialization({
      title,
      season,
      keyword: "Show 4K",
      repository,
      createWorkflowRunId: () => "run_failing_type2",
      now: fixedNow,
    });

    const result = await runQueuedType2Workflow({
      repository,
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: throwingModel(),
      storageParentDirectoryId: "library_root",
      now: fixedNow,
    });

    expect(result).toMatchObject({
      status: "failed",
      workflowRunId: "run_failing_type2",
      errorMessage: "agent model unavailable",
    });
    await expect(repository.getWorkflowRunSnapshot("run_failing_type2")).resolves.toMatchObject({
      workflowRun: {
        status: "failed",
        auditEvents: [
          { type: "workflow_reserved" },
          { type: "tracking_request_queued" },
          { type: "workflow_claimed" },
          { type: "workflow_failed" },
        ],
      },
      episodes: [],
    });
    await expect(repository.listEpisodeStates(season.id)).resolves.toEqual([]);
  });
});

function emptyProvider() {
  return new FakeResourceProvider({ keywordResults: {} });
}

function trackedFixture(): { title: MediaTitle; season: TrackedSeason } {
  const title: MediaTitle = {
    id: "title_show",
    tmdbId: 123,
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
      totalEpisodes: 2,
      latestAiredEpisode: 1,
      latestAiredSource: "metadata",
    },
  };
}

function fixedNow(): string {
  return "2026-06-11T00:00:00.000Z";
}

/** A wall clock that advances one second per read, for ordering assertions. */
function monotonicNow(): () => string {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 5, 11, 0, 0, tick)).toISOString();
  };
}
