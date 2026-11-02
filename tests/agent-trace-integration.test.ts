import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { runType2InitializationV2AndPersist } from "../src/runner-v2.js";
import { FakeStorageExecutor } from "../src/fakes.js";
import { InMemoryWorkflowRepository } from "../src/repository.js";
import type { MediaTitle, ResourceSnapshot, TrackedSeason } from "../src/domain.js";
import type { ResourceProvider } from "../src/ports.js";

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

function tool(i: number, name: string, input: unknown) {
  return {
    content: [{ type: "tool-call" as const, toolCallId: `c${i}`, toolName: name, input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
    usage: USAGE,
    warnings: [],
  };
}

/** search → reportNoCoverage → done (a normal terminal run with 2 tool calls). */
function searchThenReportModel() {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      i += 1;
      if (i === 1) return tool(i, "searchResources", { keyword: "show" });
      if (i === 2) return tool(i, "reportNoCoverage", { reason: "no candidates" });
      return { content: [{ type: "text" as const, text: "done" }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
    },
  });
}

/** search (one real tool call) → then the model API throws mid-run. */
function searchThenCrashModel() {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      i += 1;
      if (i === 1) return tool(i, "searchResources", { keyword: "boom" });
      throw new Error("simulated model/API crash mid-run");
    },
  });
}

const tvTitle = {
  id: "tmdb_tv_100",
  tmdbId: 100,
  type: "tv",
  title: "示例剧",
  year: 2024,
  aliases: ["Example Show"],
} as unknown as MediaTitle;

function trackedSeason(): TrackedSeason {
  return {
    id: "tmdb_tv_100_s1",
    mediaTitleId: "tmdb_tv_100",
    seasonNumber: 1,
    status: "active",
    qualityPreference: "4K",
    storageDirectoryId: "",
    totalEpisodes: 3,
    latestAiredEpisode: 3,
    latestAiredSource: "metadata",
  } as unknown as TrackedSeason;
}

const workflowRun = { id: "run-x", startedAt: "2026-06-15T00:00:00.000Z", finishedAt: "2026-06-15T00:01:00.000Z" };

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("agent trace — runner-v2 wires the durable step trace", () => {
  it("records an ordered, args-bearing step trace for a real runner run (可复盘)", async () => {
    const repository = new InMemoryWorkflowRepository();
    await runType2InitializationV2AndPersist({
      title: tvTitle,
      season: trackedSeason(),
      categoryParentId: "tv_root",
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: searchThenReportModel(),
      repository,
      workflowRun,
    });
    await flushMicrotasks();

    const steps = await repository.listAgentSteps("run-x");
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.map((s) => s.ordinal)).toEqual(steps.map((_, i) => i)); // contiguous, ordered
    expect(steps.map((s) => s.toolName)).toContain("searchResources");
    const search = steps.find((s) => s.toolName === "searchResources")!;
    expect(search.args.keyword).toBe("show"); // the real keyword is复盘-able
    expect(steps.some((s) => s.toolName === "reportNoCoverage")).toBe(true);
  });

  it("crash-safe: steps before a mid-run crash survive even though the snapshot never persists", async () => {
    const repository = new InMemoryWorkflowRepository();
    await expect(
      runType2InitializationV2AndPersist({
        title: tvTitle,
        season: trackedSeason(),
        categoryParentId: "tv_root",
        resourceProvider: emptyProvider(),
        storage: new FakeStorageExecutor(),
        model: searchThenCrashModel(),
        repository,
        workflowRun,
      }),
    ).rejects.toThrow();
    await flushMicrotasks();

    // Persist runs AFTER the agent await, so a mid-run crash skips it entirely.
    expect(await repository.getWorkflowRunSnapshot("run-x")).toBeNull();
    // But the trace was written incrementally (pre-execution), so it survives.
    const steps = await repository.listAgentSteps("run-x");
    expect(steps.map((s) => s.toolName)).toContain("searchResources");
  });
});
