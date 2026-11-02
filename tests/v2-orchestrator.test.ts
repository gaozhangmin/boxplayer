import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { runAcquisitionV2 } from "../src/acquisition-v2/orchestrator.js";
import type { ResourceProvider } from "../src/ports.js";
import type { ResourceSnapshot } from "../src/domain.js";
import { FakeStorageExecutor } from "../src/fakes.js";

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const;

function emptySnapshot(keyword: string): ResourceSnapshot {
  return { id: "snap_empty", provider: "pansou", keyword, candidates: [], createdAt: "2026-06-14T00:00:00.000Z" };
}

/** A model that immediately reports no-coverage after one search, then stops. */
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
      // Keyword must reference the title (the new title-guard); "Show" is the target.
      if (i === 1) return tool("searchResources", { keyword: "Show" });
      if (i === 2) return tool("reportNoCoverage", { reason: "no candidates" });
      return { content: [{ type: "text" as const, text: "done" }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
    },
  });
}

describe("runAcquisitionV2 — composition root wiring real adapters + sandbox + task agent", () => {
  it("seeds a TV task with the missing-episode need and drives the loop", async () => {
    const searched: string[] = [];
    const provider: ResourceProvider = {
      search: async ({ keyword }) => {
        searched.push(keyword);
        return emptySnapshot(keyword);
      },
    };
    const executor = new FakeStorageExecutor({ directories: { staging: [], season: [] } });

    const result = await runAcquisitionV2({
      provider,
      executor,
      model: searchThenReportModel(),
      workflowRunId: "run-1",
      target: { kind: "tv", title: "Show", aliases: [], seasons: [1], missingEpisodes: ["S01E01", "S01E02"], qualityPreference: "1080p" },
      stagingDirectoryId: "staging",
      targetSeasonDirectoryIds: { 1: "season" },
    });

    // The need came from the missing episodes; nothing landed → honestly unmet.
    expect(result.coverage.missing).toEqual(["S01E01", "S01E02"]);
    expect(searched).toEqual(["Show"]); // the real provider was driven through the adapter
    // The persistable trace is assembled from the adapters: one (empty) snapshot
    // observed, no transfers, so no decisions.
    expect(result.outcome.resourceSnapshots.map((s) => s.id)).toEqual(["snap_empty"]);
    expect(result.outcome.transferAttempts).toEqual([]);
    expect(result.outcome.decisions).toEqual([]);
  });

  it("seeds a movie task with the MOVIE need", async () => {
    const provider: ResourceProvider = { search: async ({ keyword }) => emptySnapshot(keyword) };
    const executor = new FakeStorageExecutor({ directories: { staging: [], movie: [] } });

    const result = await runAcquisitionV2({
      provider,
      executor,
      model: searchThenReportModel(),
      workflowRunId: "run-2",
      target: { kind: "movie", title: "Some Film", aliases: [], year: 2025, qualityPreference: "1080p" },
      stagingDirectoryId: "staging",
      targetMovieDirectoryId: "movie",
    });

    expect(result.coverage.missing).toEqual(["MOVIE"]);
  });
});

describe("runAcquisitionV2 — raw snapshot pre-warming integration", () => {
  it("primes raw snapshot before building prompt, snapshot visible to agent", async () => {
    const searches: string[] = [];
    const provider: ResourceProvider = {
      search: async ({ keyword }) => {
        searches.push(keyword);
        // 预热搜索裸标题 "铁拳教育",返回候选
        if (keyword === "铁拳教育") {
          return {
            id: "snap_raw",
            provider: "pansou",
            keyword,
            candidates: [
              { id: "c1", snapshotId: "snap_raw", index: 0, title: "铁拳教育 S01", type: "115", source: "pansou", providerPayload: {} },
              { id: "c2", snapshotId: "snap_raw", index: 1, title: "铁拳教育 全集", type: "115", source: "pansou", providerPayload: {} },
            ],
            createdAt: "2026-06-29T00:00:00.000Z",
          };
        }
        return emptySnapshot(keyword);
      },
    };
    const executor = new FakeStorageExecutor({ directories: { staging: [], season: [] } });

    // Model 调用 viewResourceSnapshot 工具查看预热候选
    let viewCalled = false;
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        // 第一轮:检查 system prompt 包含预热计数指针
        if (!viewCalled) {
          const systemMsg = prompt.find((p) => p.role === "system");
          expect(systemMsg?.content).toContain("2"); // prefetchedCandidateCount
          expect(systemMsg?.content).toMatch(/RAW SNAPSHOT|活期文档/);
          expect(systemMsg?.content).toContain("viewResourceSnapshot");

          viewCalled = true;
          return {
            content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "viewResourceSnapshot", input: "{}" }],
            finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
            usage: USAGE,
            warnings: [],
          };
        }
        // 第二轮:agent 看到预热候选后,直接报告无覆盖(测试用)
        return {
          content: [{ type: "tool-call" as const, toolCallId: "c2", toolName: "reportNoCoverage", input: JSON.stringify({ reason: "test" }) }],
          finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
          usage: USAGE,
          warnings: [],
        };
      },
    });

    const result = await runAcquisitionV2({
      provider,
      executor,
      model,
      workflowRunId: "run-prime",
      target: { kind: "tv", title: "铁拳教育", aliases: [], seasons: [1], missingEpisodes: ["S01E01"], qualityPreference: "1080p" },
      stagingDirectoryId: "staging",
      targetSeasonDirectoryIds: { 1: "season" },
    });

    // 预热搜索应该发生在 agent loop 之前
    expect(searches[0]).toBe("铁拳教育"); // 第一次搜索是预热
    expect(viewCalled).toBe(true); // agent 确实调用了 viewResourceSnapshot
    // 预热的 snapshot 应该在 outcome 中
    expect(result.outcome.resourceSnapshots.some((s) => s.id === "snap_raw")).toBe(true);
  });

  it("gracefully degrades when pre-warming fails — workflow does not crash", async () => {
    let callCount = 0;
    const provider: ResourceProvider = {
      search: async ({ keyword }) => {
        callCount += 1;
        // 第一次(预热)抛错模拟 provider 故障
        if (callCount === 1) {
          throw new Error("Provider unavailable");
        }
        // 后续 agent 自己搜索时正常返回
        return emptySnapshot(keyword);
      },
    };
    const executor = new FakeStorageExecutor({ directories: { staging: [], season: [] } });

    const result = await runAcquisitionV2({
      provider,
      executor,
      model: searchThenReportModel(),
      workflowRunId: "run-degrade",
      target: { kind: "tv", title: "Show", aliases: [], seasons: [1], missingEpisodes: ["S01E01"], qualityPreference: "1080p" },
      stagingDirectoryId: "staging",
      targetSeasonDirectoryIds: { 1: "season" },
    });

    // 工作流应该成功完成(虽然没有预热)
    expect(result.coverage.missing).toEqual(["S01E01"]);
    // agent 自己搜索了(callCount >= 2)
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("movie task also gets raw snapshot pre-warming", async () => {
    const searches: string[] = [];
    const provider: ResourceProvider = {
      search: async ({ keyword }) => {
        searches.push(keyword);
        if (keyword === "流浪地球") {
          return {
            id: "snap_movie_raw",
            provider: "pansou",
            keyword,
            candidates: [{ id: "m1", snapshotId: "snap_movie_raw", index: 0, title: "流浪地球 4K", type: "115", source: "pansou", providerPayload: {} }],
            createdAt: "2026-06-29T00:00:00.000Z",
          };
        }
        return emptySnapshot(keyword);
      },
    };
    const executor = new FakeStorageExecutor({ directories: { staging: [], movie: [] } });

    let promptChecked = false;
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        if (!promptChecked) {
          const systemMsg = prompt.find((p) => p.role === "system");
          expect(systemMsg?.content).toContain("1"); // prefetchedCandidateCount
          expect(systemMsg?.content).toMatch(/RAW SNAPSHOT|活期文档/);
          promptChecked = true;
        }
        return {
          content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "reportNoCoverage", input: JSON.stringify({ reason: "test" }) }],
          finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
          usage: USAGE,
          warnings: [],
        };
      },
    });

    await runAcquisitionV2({
      provider,
      executor,
      model,
      workflowRunId: "run-movie-prime",
      target: { kind: "movie", title: "流浪地球", aliases: [], year: 2019, qualityPreference: "4K" },
      stagingDirectoryId: "staging",
      targetMovieDirectoryId: "movie",
    });

    expect(searches[0]).toBe("流浪地球"); // 预热
    expect(promptChecked).toBe(true);
  });

  it("auditEvents surface from sandbox through orchestrator (病4)", async () => {
    const provider: ResourceProvider = { search: async ({ keyword }) => emptySnapshot(keyword) };
    const executor = new FakeStorageExecutor({ directories: { staging: [], season: [] } });

    const result = await runAcquisitionV2({
      provider,
      executor,
      model: searchThenReportModel(),
      workflowRunId: "test-audit",
      target: {
        kind: "tv",
        title: "Show",
        aliases: [],
        seasons: [1],
        missingEpisodes: ["S01E01"],
        qualityPreference: "high",
      },
      stagingDirectoryId: "staging_dir",
      targetSeasonDirectoryIds: { 1: "season1_dir" },
    });

    // The agent searches "Show" which was pre-warmed, hitting dedup → search_dedup event.
    // This proves audit events flow from sandbox → orchestrator → workflow → bridge.
    expect(result.auditEvents.some((e) => e.type === "search_dedup")).toBe(true);
    expect(result.auditEvents[0]?.message).toContain("重复搜索");
  });
});
