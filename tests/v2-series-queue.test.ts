import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import {
  FakeResourceProvider,
  FakeStorageExecutor,
  InMemoryWorkflowRepository,
  queueSeriesInitialization,
  runQueuedSeriesInitialization,
  type MediaTitle,
} from "../src/index.js";

/**
 * Live series-acquisition chain (the "获取全剧" path): enqueue via
 * queueSeriesInitialization → the worker drains via runQueuedSeriesInitialization
 * → runSeriesInitializationV2AndPersist (V2 engine) → per-season persistence +
 * dedup-on-repeat + anime-parent routing. Restored after Phase 8 deleted the old
 * series-init.test.ts, which also carried this live coverage (§11: every
 * runtime-driven entrypoint must keep a test asserting it from the user-action end).
 */

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const;

/** Searches once, honestly reports no coverage — drives the V2 sandbox loop. */
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

/** The seasons are already in 115 (seeded): the agent inspects, sees the files,
 *  and marks them from that evidence (§6b#8) — there is no mechanical no-op. */
function inspectAndMarkModel(codes: string[]) {
  const steps = [
    { tool: "inspectTargetDir", input: {} },
    { tool: "markObtained", input: { codes } },
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

async function seedV2SeasonDir(
  storage: FakeStorageExecutor,
  title: MediaTitle,
  seasonNumber: number,
  parentId: string,
  presentCodes: string[],
): Promise<void> {
  const showDir = await storage.createDirectory({ name: `${title.title} (${title.year})`, parentId });
  const seasonDir = await storage.createDirectory({
    name: `Season ${String(seasonNumber).padStart(2, "0")}`,
    parentId: showDir,
  });
  storage.seedDirectoryFiles(
    seasonDir,
    presentCodes.map((code, index) => ({
      id: `present_${code}_${index}`,
      storageDirectoryId: seasonDir,
      name: `The.Boys.${code}.mkv`,
      sizeBytes: 1_000_000_000,
      episodeCode: code,
      providerFileId: `present_${code}_${index}`,
    })),
  );
}

const theBoys: MediaTitle = {
  id: "tmdb_tv_76479",
  tmdbId: 76479,
  type: "tv",
  title: "黑袍纠察队",
  originalTitle: "The Boys",
  year: 2019,
  aliases: ["The Boys"],
};

const seasons = [
  { seasonNumber: 1, totalEpisodes: 2, latestAiredEpisode: 2 },
  { seasonNumber: 2, totalEpisodes: 3, latestAiredEpisode: 2 },
];

describe("queueSeriesInitialization + runQueuedSeriesInitialization (live series chain)", () => {
  it("queues once, runs the whole series, and dedupes repeat requests", async () => {
    const repository = new InMemoryWorkflowRepository();
    const queued = await queueSeriesInitialization({
      title: theBoys,
      seasons,
      keyword: "黑袍纠察队 4K",
      repository,
      createWorkflowRunId: () => "run_series_q",
      now: () => "2026-06-13T00:00:00.000Z",
    });
    expect(queued).toEqual({ status: "queued", titleId: theBoys.id, workflowRunId: "run_series_q" });

    const again = await queueSeriesInitialization({
      title: theBoys,
      seasons,
      keyword: "黑袍纠察队 4K",
      repository,
      createWorkflowRunId: () => "run_series_dup",
      now: () => "2026-06-13T00:00:01.000Z",
    });
    expect(again.status).toBe("already_running");

    // Seed both seasons' canonical V2 dirs as already complete (all aired
    // episodes present in 115). The agent inspects, sees them, and marks them
    // from that evidence (§6b#8) — succeeded. S1: 2/2 aired; S2: 2/3 aired.
    const storage = new FakeStorageExecutor();
    await seedV2SeasonDir(storage, theBoys, 1, "library_root", ["S01E01", "S01E02"]);
    await seedV2SeasonDir(storage, theBoys, 2, "library_root", ["S02E01", "S02E02"]);
    const workerResult = await runQueuedSeriesInitialization({
      repository,
      resourceProvider: new FakeResourceProvider({ keywordResults: {} }),
      storage,
      model: inspectAndMarkModel(["S01E01", "S01E02", "S02E01", "S02E02"]),
      storageParentDirectoryId: "library_root",
      now: () => "2026-06-13T00:05:00.000Z",
    });

    expect(workerResult).toMatchObject({ status: "ran", workflowStatus: "succeeded" });
    const states = await repository.listTrackedSeasonStates();
    expect(states).toHaveLength(2);

    const afterRun = await queueSeriesInitialization({
      title: theBoys,
      seasons,
      keyword: "黑袍纠察队 4K",
      repository,
      createWorkflowRunId: () => "run_series_again",
      now: () => "2026-06-13T01:00:00.000Z",
    });
    expect(afterRun.status).toBe("already_tracked");
  });

  it("lands an anime title under the separate anime parent, not the TV parent", async () => {
    const anime: MediaTitle = {
      id: "tmdb_tv_240411",
      tmdbId: 240411,
      type: "anime",
      title: "躲在超市后门吸烟的两人",
      originalTitle: "スーパーの裏でヤニ吸うふたり",
      year: 2025,
      aliases: ["スーパーの裏でヤニ吸うふたり"],
    };
    const repository = new InMemoryWorkflowRepository();
    await queueSeriesInitialization({
      title: anime,
      seasons: [{ seasonNumber: 1, totalEpisodes: 1, latestAiredEpisode: 1 }],
      keyword: "躲在超市后门吸烟的两人 4K",
      repository,
      createWorkflowRunId: () => "run_anime",
      now: () => "2026-06-13T00:00:00.000Z",
    });

    const storage = new FakeStorageExecutor();
    await runQueuedSeriesInitialization({
      repository,
      resourceProvider: new FakeResourceProvider({ keywordResults: {} }),
      storage,
      model: noCoverageModel(),
      storageParentDirectoryId: "tv_root",
      animeStorageParentDirectoryId: "anime_root",
      now: () => "2026-06-13T00:05:00.000Z",
    });

    // The show/season directory was created under the anime parent, never the
    // TV parent — the 动漫 shelf is a physically separate tree on 115.
    const [state] = await repository.listTrackedSeasonStates();
    expect(state?.season.storageDirectoryId.startsWith("anime_root_")).toBe(true);
    expect(state?.season.storageDirectoryId.includes("tv_root")).toBe(false);
  });
});
