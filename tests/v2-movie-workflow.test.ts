import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { runMovieAcquisitionV2 } from "../src/movie-workflow-v2.js";
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
      createdAt: "2026-06-14T00:00:00.000Z",
    }),
  };
}

/** Build a MockLanguageModelV3 that emits the given tool calls in order, then stops. */
function scriptModel(steps: Array<{ tool: string; input: unknown }>) {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      if (i < steps.length) {
        const step = steps[i]!;
        i += 1;
        return {
          content: [{ type: "tool-call" as const, toolCallId: `c${i}`, toolName: step.tool, input: JSON.stringify(step.input) }],
          finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
          usage: USAGE,
          warnings: [],
        };
      }
      return { content: [{ type: "text" as const, text: "done" }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
    },
  });
}

/** Records every createDirectory call so a test can assert NO separate staging dir is made. */
class RecordingExecutor extends FakeStorageExecutor {
  readonly createdDirs: Array<{ name: string; parentId: string }> = [];
  override async createDirectory(input: { name: string; parentId: string }): Promise<string> {
    this.createdDirs.push(input);
    return super.createDirectory(input);
  }
}

const title = {
  id: "tmdb_movie_27205",
  title: "盗梦空间",
  year: 2010,
  aliases: ["Inception"],
  type: "movie",
} as unknown as MediaTitle;

describe("runMovieAcquisitionV2 — obtained comes from the AGENT'S coverage, never a mechanical file count", () => {
  it("no coverage → status no_coverage, the synthetic movie episode is not obtained", async () => {
    const executor = new FakeStorageExecutor();
    const result = await runMovieAcquisitionV2({
      title,
      resourceProvider: emptyProvider(),
      storage: executor,
      model: scriptModel([
        { tool: "searchResources", input: { keyword: "盗梦空间" } },
        { tool: "reportNoCoverage", input: { reason: "no candidates" } },
      ]),
      workflowRunId: "run-m1",
      moviesParentDirectoryId: "movies_root",
      now: () => "2026-06-14T00:00:00.000Z",
    });

    expect(result.status).toBe("no_coverage");
    expect(result.episodes).toHaveLength(1);
    expect(result.episodes[0]!.obtained).toBe(false);
    expect(result.notification.kind).toBe("no_coverage");
    expect(result.season.storageDirectoryId).toContain("movies_root"); // movie dir verify-or-created
    // 病4: the movie path's bridged auditEvents carry the honest report — parity
    // with the TV e2e (sandbox → orchestrator → movie workflow persistence).
    expect(result.auditEvents.some((e) => e.type === "no_coverage_reported")).toBe(true);
  });

  it("transfers systemically BLOCKED (配额不足) → honest 转存失败 report, NOT 暂未找到资源 (别甩锅)", async () => {
    // The resource EXISTS (a candidate is found + transfer attempted) but the
    // account can't materialize it (115 云下载配额不足). The report must say so,
    // not blame the resource — mirrors the real 心灵奇旅-on-free-account incident.
    const candidateId = "cand_q";
    const executor = new FakeStorageExecutor({
      transferOutcomes: {
        [candidateId]: { status: "failed", providerMessage: "云下载配额不足，请升级VIP获得赠送配额或购买云下载配额！", files: [] },
      },
    });
    const provider: ResourceProvider = {
      search: async ({ keyword }): Promise<ResourceSnapshot> => ({
        id: "snap_q",
        provider: "pansou",
        keyword,
        candidates: [
          {
            id: candidateId,
            snapshotId: "snap_q",
            index: 0,
            title: "心灵奇旅 2020 1080p",
            type: "magnet",
            source: "pansou",
            providerPayload: { url: "magnet:?xt=urn:btih:deadbeef" },
          },
        ],
        createdAt: "2026-06-14T00:00:00.000Z",
      }),
    };

    const result = await runMovieAcquisitionV2({
      title,
      resourceProvider: provider,
      storage: executor,
      model: scriptModel([
        { tool: "searchResources", input: { keyword: "盗梦空间" } },
        { tool: "transferCandidate", input: { snapshotId: "snap_q", candidateId } },
        { tool: "reportNoCoverage", input: { reason: "nothing landed" } },
      ]),
      workflowRunId: "run-blocked",
      moviesParentDirectoryId: "movies_root",
      now: () => "2026-06-14T00:00:00.000Z",
    });

    expect(result.episodes[0]!.obtained).toBe(false);
    expect(result.notification.report?.status).toBe("failed");
    expect(result.notification.body).toContain("转存失败");
    expect(result.notification.body).toContain("配额");
    expect(result.notification.body).not.toContain("暂未找到");
    expect(result.notification.kind).toBe("transfer_failed");
  });

  it("obtained TRUE when the agent declares MOVIE coverage (agent mark, not files on disk)", async () => {
    const executor = new FakeStorageExecutor();
    const result = await runMovieAcquisitionV2({
      title,
      resourceProvider: emptyProvider(),
      storage: executor,
      // The agent declares MOVIE obtained; coverage is met by the mark, not a scan.
      model: scriptModel([
        { tool: "searchResources", input: { keyword: "盗梦空间" } },
        { tool: "markObtained", input: { codes: ["MOVIE"] } },
        { tool: "finish", input: {} },
      ]),
      workflowRunId: "run-m2",
      moviesParentDirectoryId: "movies_root",
      now: () => "2026-06-14T00:00:00.000Z",
    });

    expect(result.status).toBe("succeeded");
    expect(result.episodes[0]!.obtained).toBe(true);
  });

  it("中文字幕软兜底: markObtained({subtitleFallback:true}) flags 可能无中文字幕 in the notification (环太平洋)", async () => {
    const executor = new FakeStorageExecutor();
    const result = await runMovieAcquisitionV2({
      title,
      resourceProvider: emptyProvider(),
      storage: executor,
      // The agent exhausted its 中字 budget and landed a raw-name match of the correct
      // film — declaring the subtitle fallback. The thread markObtained→finish→
      // coverage→buildResult→buildMovieReport must surface it.
      model: scriptModel([
        { tool: "searchResources", input: { keyword: "盗梦空间" } },
        { tool: "markObtained", input: { codes: ["MOVIE"], subtitleFallback: true } },
        { tool: "finish", input: {} },
      ]),
      workflowRunId: "run-m-fb",
      moviesParentDirectoryId: "movies_root",
      now: () => "2026-06-14T00:00:00.000Z",
    });

    expect(result.status).toBe("succeeded");
    expect(result.notification.report?.lines.some((l) => l.includes("可能无中文字幕"))).toBe(true);
    expect(result.notification.body).toContain("可能无中文字幕");
  });

  it("obtained reflects agent coverage, NOT a file sitting in the dir (the mechanical bug)", async () => {
    // A stray file is present in the movie dir, but the agent judged no coverage and
    // never marked. The old code did `listVideoFiles().length > 0` → wrongly obtained.
    const executor = new FakeStorageExecutor();
    const movieDir = await executor.createDirectory({ name: "盗梦空间 (2010)", parentId: "movies_root" });
    executor.seedDirectoryFiles(movieDir, [
      { id: "stray", storageDirectoryId: movieDir, name: "随便.mkv", sizeBytes: 1, episodeCode: null, providerFileId: "stray" },
    ]);

    const result = await runMovieAcquisitionV2({
      title,
      resourceProvider: emptyProvider(),
      storage: executor,
      model: scriptModel([
        { tool: "searchResources", input: { keyword: "盗梦空间" } },
        { tool: "reportNoCoverage", input: { reason: "the stray file is not the film" } },
      ]),
      workflowRunId: "run-m3",
      moviesParentDirectoryId: "movies_root",
      now: () => "2026-06-14T00:00:00.000Z",
    });

    expect(result.status).toBe("no_coverage");
    expect(result.episodes[0]!.obtained).toBe(false); // file present, but agent did not mark → not obtained
  });

  it("uses NO separate staging directory — staging IS the movie dir (flatten in place)", async () => {
    const executor = new RecordingExecutor();
    await runMovieAcquisitionV2({
      title,
      resourceProvider: emptyProvider(),
      storage: executor,
      model: scriptModel([
        { tool: "searchResources", input: { keyword: "盗梦空间" } },
        { tool: "reportNoCoverage", input: { reason: "no candidates" } },
      ]),
      workflowRunId: "run-m4",
      moviesParentDirectoryId: "movies_root",
      now: () => "2026-06-14T00:00:00.000Z",
    });

    // Exactly one directory is created — the movie dir. No `staging-*` sibling.
    expect(executor.createdDirs).toEqual([{ name: "盗梦空间 (2010)", parentId: "movies_root" }]);
  });
});
