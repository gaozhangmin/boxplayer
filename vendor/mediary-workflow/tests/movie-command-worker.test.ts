import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import {
  FakeResourceProvider,
  FakeStorageExecutor,
  InMemoryWorkflowRepository,
  queueMovieAcquisition,
  runQueuedMovieAcquisition,
  type MediaTitle,
} from "../src/index.js";

const fixedNow = () => "2026-06-13T00:00:00.000Z";

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const;

/** §6b#8: the film is already in 115, so the agent inspects, sees it, and marks
 *  MOVIE from that evidence — no search, no transfer. (There is no mechanical
 *  file-count no-op anymore; obtained is the agent's coverage.) */
function inspectAndMarkModel() {
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

function movieTitle(): MediaTitle {
  return {
    id: "tmdb_movie_872585",
    tmdbId: 872585,
    type: "movie",
    title: "奥本海默",
    originalTitle: "Oppenheimer",
    year: 2023,
    aliases: ["Oppenheimer"],
  };
}

describe("movie acquisition command + worker", () => {
  it("queues a movie and blocks a duplicate while active (title lock)", async () => {
    const repository = new InMemoryWorkflowRepository();
    const first = await queueMovieAcquisition({
      title: movieTitle(),
      keyword: "奥本海默 4K",
      repository,
      createWorkflowRunId: () => "run_movie_1",
      now: fixedNow,
    });
    expect(first.status).toBe("queued");
    const second = await queueMovieAcquisition({
      title: movieTitle(),
      keyword: "奥本海默 4K",
      repository,
      createWorkflowRunId: () => "run_movie_2",
      now: fixedNow,
    });
    expect(second.status).toBe("already_running");
  });

  it("worker claims, runs, and persists a movie acquisition (already in 115 → agent marks from evidence → succeeded)", async () => {
    const repository = new InMemoryWorkflowRepository();
    const title = movieTitle();
    await queueMovieAcquisition({
      title,
      keyword: "奥本海默 4K",
      repository,
      createWorkflowRunId: () => "run_movie",
      now: fixedNow,
    });
    const storage = new FakeStorageExecutor();
    // Verify-or-create resolves the canonical `Title (Year)` movie dir; seed it
    // with the film already present so the run is a succeeded no-op.
    const movieDir = await storage.createDirectory({ name: `${title.title} (${title.year})`, parentId: "movies_root" });
    storage.seedDirectoryFiles(movieDir, [
      {
        id: "oppen_v",
        storageDirectoryId: movieDir,
        name: "Oppenheimer.2023.mkv",
        sizeBytes: 8_000_000_000,
        episodeCode: null,
        providerFileId: "oppen_v",
      },
    ]);

    const result = await runQueuedMovieAcquisition({
      repository,
      resourceProvider: new FakeResourceProvider({ keywordResults: {} }),
      storage,
      model: inspectAndMarkModel(),
      moviesParentDirectoryId: "movies_root",
      now: fixedNow,
    });

    expect(result.status).toBe("ran");
    const saved = await repository.getWorkflowRunSnapshot("run_movie");
    expect(saved?.workflowRun.kind).toBe("movie_init");
    expect(saved?.workflowRun.status).toBe("succeeded");
    expect(saved?.title.type).toBe("movie");
  });
});
