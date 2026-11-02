import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { runTvAcquisitionV2 } from "../src/acquisition-v2/run-tv-v2.js";
import { FakeStorageExecutor } from "../src/fakes.js";
import type { ResourceProvider } from "../src/ports.js";
import type { MediaTitle, ResourceSnapshot } from "../src/domain.js";

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const;

function emptyProvider(): ResourceProvider {
  return {
    search: async ({ keyword }): Promise<ResourceSnapshot> => ({
      id: "snap_empty",
      provider: "pansou",
      keyword,
      candidates: [],
      createdAt: "2026-06-15T00:00:00.000Z",
    }),
  };
}

/** Searches once then honestly reports no coverage. */
function searchThenReportModel() {
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
      if (i === 1) return tool("searchResources", { keyword: "示例剧" });
      if (i === 2) return tool("reportNoCoverage", { reason: "no candidates" });
      return { content: [{ type: "text" as const, text: "done" }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
    },
  });
}

const title = {
  id: "tmdb_tv_100",
  tmdbId: 100,
  type: "tv",
  title: "示例剧",
  year: 2024,
  aliases: ["Example Show"],
} as unknown as MediaTitle;

describe("runTvAcquisitionV2 — single TV entry over the V2 engine", () => {
  it("single-season type2 with no coverage → verify-or-creates the dir, agent runs, status no_coverage", async () => {
    const storage = new FakeStorageExecutor();
    const result = await runTvAcquisitionV2({
      title,
      mode: "type2",
      seasons: [{ seasonNumber: 1, totalEpisodes: 3, latestAiredEpisode: 3, qualityPreference: "4K" }],
      categoryParentId: "tv_root",
      resourceProvider: emptyProvider(),
      storage,
      model: searchThenReportModel(),
      workflowRunId: "run-tv-1",
      now: () => "2026-06-15T00:00:00.000Z",
    });

    expect(result.status).toBe("no_coverage");
    expect(result.seasons).toHaveLength(1);
    expect(result.seasons[0]!.season.storageDirectoryId).not.toBe("");
    expect(result.notification.kind).toBe("no_coverage");
    expect(result.notification.trigger).toBe("user");
  });

  it("no_coverage run surfaces auditEvents (病4 end-to-end persistence)", async () => {
    const storage = new FakeStorageExecutor();
    const result = await runTvAcquisitionV2({
      title,
      mode: "type2",
      seasons: [{ seasonNumber: 1, totalEpisodes: 3, latestAiredEpisode: 3, qualityPreference: "4K" }],
      categoryParentId: "tv_root",
      resourceProvider: emptyProvider(),
      storage,
      model: searchThenReportModel(),
      workflowRunId: "run-tv-2",
      now: () => "2026-06-15T00:00:00.000Z",
    });

    expect(result.status).toBe("no_coverage");
    // The PRIMARY event: the honest no-coverage report itself must be in the
    // bridged auditEvents — this mirrors the live acceptance criterion for 病4.
    expect(result.auditEvents.some((e) => e.type === "no_coverage_reported")).toBe(true);
    // Secondary: the agent searches "示例剧" which was pre-warmed, hitting dedup →
    // search_dedup event. Both together prove multi-event flow
    // sandbox → orchestrator → workflow → bridge → runner.
    expect(result.auditEvents.some((e) => e.type === "search_dedup")).toBe(true);
  });

  it("no-op type3 patrol (nothing missing) → succeeded, the model is never invoked", async () => {
    const storage = new FakeStorageExecutor();
    let modelCalled = false;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        modelCalled = true;
        throw new Error("model should not run on a no-op");
      },
    });
    const result = await runTvAcquisitionV2({
      title,
      mode: "type3",
      seasons: [{ seasonNumber: 1, totalEpisodes: 3, latestAiredEpisode: 0, qualityPreference: "4K", status: "active" }],
      categoryParentId: "tv_root",
      resourceProvider: emptyProvider(),
      storage,
      model,
      workflowRunId: "run-tv-2",
      now: () => "2026-06-15T00:00:00.000Z",
    });

    expect(modelCalled).toBe(false);
    expect(result.status).toBe("succeeded");
    expect(result.notification.trigger).toBe("scheduled");
    expect(result.transferAttempts).toEqual([]);
  });

  it("threads qualityPreference→per-profile guidance into the agent's REAL system prompt", async () => {
    // Capture the system prompt the agent actually receives, end to end through
    // run-tv-v2 → workflow-v2 → orchestrator → task-agents → agent-loop.
    function capturingModel(sink: { system: string }) {
      return new MockLanguageModelV3({
        doGenerate: async (options: unknown) => {
          const prompt = (options as { prompt?: unknown }).prompt;
          const system = (Array.isArray(prompt) ? prompt : []).find(
            (m: { role?: string }) => m.role === "system",
          );
          sink.system = JSON.stringify(system ?? prompt);
          return {
            content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "reportNoCoverage", input: JSON.stringify({ reason: "x" }) }],
            finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
            usage: USAGE,
            warnings: [],
          };
        },
      });
    }

    // jp-anime + 高 → the SCARCITY guidance (4K rare, don't over-search), not the reachable one.
    const animeTitle = { ...title, type: "anime", originCountries: ["JP"] } as unknown as MediaTitle;
    const scarce = { system: "" };
    await runTvAcquisitionV2({
      title: animeTitle,
      mode: "type2",
      seasons: [{ seasonNumber: 1, totalEpisodes: 3, latestAiredEpisode: 3, qualityPreference: "4K" }],
      categoryParentId: "tv_root",
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: capturingModel(scarce),
      qualityPreference: "high",
      workflowRunId: "run-tv-q1",
      now: () => "2026-06-15T00:00:00.000Z",
    });
    expect(scarce.system).toContain("画质偏好:高");
    expect(scarce.system).toMatch(/极少|稀缺|没有/);
    expect(scarce.system).toContain("1080");

    // us-tv + 高 → the REACHABLE guidance (real 4K exists), NOT the scarcity warning.
    const usTvTitle = { ...title, type: "tv", originCountries: ["US"] } as unknown as MediaTitle;
    const reachable = { system: "" };
    await runTvAcquisitionV2({
      title: usTvTitle,
      mode: "type2",
      seasons: [{ seasonNumber: 1, totalEpisodes: 3, latestAiredEpisode: 3, qualityPreference: "4K" }],
      categoryParentId: "tv_root",
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: capturingModel(reachable),
      qualityPreference: "high",
      workflowRunId: "run-tv-q2",
      now: () => "2026-06-15T00:00:00.000Z",
    });
    expect(reachable.system).toContain("真 4K 通常存在");
    expect(reachable.system).not.toMatch(/极少|稀缺/);

    // 不限 (no preference) → NO quality block at all.
    const none = { system: "" };
    await runTvAcquisitionV2({
      title: usTvTitle,
      mode: "type2",
      seasons: [{ seasonNumber: 1, totalEpisodes: 3, latestAiredEpisode: 3, qualityPreference: "4K" }],
      categoryParentId: "tv_root",
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: capturingModel(none),
      workflowRunId: "run-tv-q3",
      now: () => "2026-06-15T00:00:00.000Z",
    });
    expect(none.system).not.toContain("画质偏好");
  });

  it("multi-season series → builds a season intent per season, distinct verify-or-created dirs", async () => {
    const storage = new FakeStorageExecutor();
    const result = await runTvAcquisitionV2({
      title,
      mode: "series",
      seasons: [
        { seasonNumber: 1, totalEpisodes: 3, latestAiredEpisode: 3, qualityPreference: "4K" },
        { seasonNumber: 2, totalEpisodes: 3, latestAiredEpisode: 3, qualityPreference: "4K" },
      ],
      categoryParentId: "tv_root",
      resourceProvider: emptyProvider(),
      storage,
      model: searchThenReportModel(),
      workflowRunId: "run-tv-3",
      now: () => "2026-06-15T00:00:00.000Z",
    });

    expect(result.seasons).toHaveLength(2);
    const dirs = result.seasons.map((season) => season.season.storageDirectoryId);
    expect(new Set(dirs).size).toBe(2); // each season its own directory
    expect(result.notification.kind).toBe("no_coverage"); // empty provider
  });
});
