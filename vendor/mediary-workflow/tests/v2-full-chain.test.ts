import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import {
  FakeResourceProvider,
  FakeStorageExecutor,
  InMemoryWorkflowRepository,
  queueMovieAcquisition,
  queueTrackingInitialization,
  runQueuedMovieAcquisition,
  runQueuedType2Workflow,
  type MediaTitle,
  type TrackedSeason,
} from "../src/index.js";

/**
 * Full-chain integration: the path a real browser click drives —
 * enqueue (command) → the run shows as active ("获取中") → the worker claims and
 * runs it (runQueued*) → it reaches a terminal status → it drops out of the
 * active list (the UI "获取中" placeholder RELEASES) → plus crash recovery
 * (a worker that died mid-run leaves a "running" run that requeues and finishes).
 *
 * These assert the chain end-to-end with NO manual mid-step trigger — exactly
 * what the unit tests didn't cover and what fell apart on live test.
 */

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const;

function emptyProvider() {
  return new FakeResourceProvider({ keywordResults: {} });
}

/** Searches once, honestly reports no coverage. */
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
      return {
        content: [{ type: "text" as const, text: "done" }],
        finishReason: { unified: "stop" as const, raw: "stop" as const },
        usage: USAGE,
        warnings: [],
      };
    },
  });
}

/** The film is already in 115 (seeded): the agent inspects, sees it, and marks
 *  MOVIE from that evidence — no search, no transfer (§6b#8). Obtained is the
 *  agent's coverage; there is no mechanical file-count no-op. */
function inspectAndMarkMovieModel() {
  const steps = [
    { tool: "inspectTargetDir", input: {} },
    { tool: "markObtained", input: { codes: ["MOVIE"] } },
    { tool: "finish", input: {} },
  ];
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      if (i < steps.length) {
        const s = steps[i]!;
        i += 1;
        return {
          content: [{ type: "tool-call" as const, toolCallId: `c${i}`, toolName: s.tool, input: JSON.stringify(s.input) }],
          finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
          usage: USAGE,
          warnings: [],
        };
      }
      return { content: [{ type: "text" as const, text: "已在库" }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
    },
  });
}

const movieTitle: MediaTitle = {
  id: "tmdb_movie_872585",
  tmdbId: 872585,
  type: "movie",
  title: "奥本海默",
  originalTitle: "Oppenheimer",
  year: 2023,
  aliases: ["Oppenheimer"],
};

async function seedMovieAlreadyPresent(storage: FakeStorageExecutor): Promise<void> {
  const dir = await storage.createDirectory({ name: `${movieTitle.title} (${movieTitle.year})`, parentId: "movies_root" });
  storage.seedDirectoryFiles(dir, [
    {
      id: "oppen_v",
      storageDirectoryId: dir,
      name: "Oppenheimer.2023.mkv",
      sizeBytes: 8_000_000_000,
      episodeCode: null,
      providerFileId: "oppen_v",
    },
  ]);
}

const now = () => "2026-06-15T00:00:00.000Z";

describe("full chain: enqueue → worker drains → terminal → 获取中 releases", () => {
  it("movie: a click enqueues (active), the worker runs it to succeeded, and it leaves the active list", async () => {
    const repository = new InMemoryWorkflowRepository();
    const storage = new FakeStorageExecutor();

    await queueMovieAcquisition({
      title: movieTitle,
      keyword: "奥本海默 4K",
      repository,
      createWorkflowRunId: () => "run_movie",
      now,
    });
    // The UI derives "获取中" from the active list — it must show the run now.
    expect(await repository.listActiveWorkflowRuns()).toHaveLength(1);

    await seedMovieAlreadyPresent(storage); // already in 115 → agent marks from evidence

    const result = await runQueuedMovieAcquisition({
      repository,
      resourceProvider: emptyProvider(),
      storage,
      model: inspectAndMarkMovieModel(),
      moviesParentDirectoryId: "movies_root",
      now,
    });

    expect(result).toMatchObject({ status: "ran", workflowStatus: "succeeded" });
    expect((await repository.getWorkflowRunSnapshot("run_movie"))?.workflowRun.status).toBe("succeeded");
    // The placeholder RELEASES: the run is terminal, no longer active.
    expect(await repository.listActiveWorkflowRuns()).toHaveLength(0);
  });

  it("movie crash recovery: a worker that died mid-run leaves a stuck 'running' run that requeues and finishes", async () => {
    const repository = new InMemoryWorkflowRepository();
    const storage = new FakeStorageExecutor();

    await queueMovieAcquisition({
      title: movieTitle,
      keyword: "奥本海默 4K",
      repository,
      createWorkflowRunId: () => "run_movie_crash",
      now,
    });
    // A worker claims it (status → running) then "crashes" (we never finish it).
    await repository.claimNextQueuedWorkflowRun({ kind: "movie_init", now: now() });
    expect((await repository.getWorkflowRunSnapshot("run_movie_crash"))?.workflowRun.status).toBe("running");
    expect(await repository.listActiveWorkflowRuns()).toHaveLength(1); // UI stuck "获取中"

    // Worker restart recovers the orphan, then drains it.
    expect(await repository.requeueRunningWorkflowRuns()).toBe(1);
    await seedMovieAlreadyPresent(storage);
    const result = await runQueuedMovieAcquisition({
      repository,
      resourceProvider: emptyProvider(),
      storage,
      model: inspectAndMarkMovieModel(),
      moviesParentDirectoryId: "movies_root",
      now,
    });

    expect(result).toMatchObject({ status: "ran", workflowStatus: "succeeded" });
    expect(await repository.listActiveWorkflowRuns()).toHaveLength(0); // released
  });

  it("tv type2: enqueue → run reaches no_coverage → placeholder still releases", async () => {
    const repository = new InMemoryWorkflowRepository();
    const title: MediaTitle = {
      id: "tmdb_tv_100",
      tmdbId: 100,
      type: "tv",
      title: "示例剧",
      originalTitle: "Example Show",
      year: 2024,
      aliases: [],
    };
    const season: TrackedSeason = {
      id: "tmdb_tv_100_s1",
      mediaTitleId: title.id,
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "",
      totalEpisodes: 2,
      latestAiredEpisode: 1,
      latestAiredSource: "metadata",
    };

    await queueTrackingInitialization({
      title,
      season,
      keyword: "示例剧 4K",
      repository,
      createWorkflowRunId: () => "run_tv",
      now,
    });
    expect(await repository.listActiveWorkflowRuns()).toHaveLength(1);

    const result = await runQueuedType2Workflow({
      repository,
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: noCoverageModel(),
      storageParentDirectoryId: "tv_root",
      now,
    });

    expect(result).toMatchObject({ status: "ran", workflowStatus: "no_coverage" });
    // Even on no_coverage the run is terminal → the placeholder releases.
    expect(await repository.listActiveWorkflowRuns()).toHaveLength(0);
  });
});
