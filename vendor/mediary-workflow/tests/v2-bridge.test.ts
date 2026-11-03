import { describe, expect, it } from "vitest";
import { bridgeV2WorkflowToResult } from "../src/acquisition-v2/workflow-v2-bridge.js";
import type { RunAcquisitionV2WorkflowResult } from "../src/acquisition-v2/workflow-v2.js";
import type { MediaTitle } from "../src/domain.js";

const title = {
  id: "tmdb_tv_100",
  tmdbId: 100,
  type: "tv",
  title: "示例剧",
  year: 2024,
  aliases: ["Example Show"],
} as unknown as MediaTitle;

function v2Result(over: Partial<RunAcquisitionV2WorkflowResult>): RunAcquisitionV2WorkflowResult {
  return {
    directories: { showDirectoryId: "show_1", seasonDirectoryIds: { 1: "season_1_dir" }, stagingDirectoryId: "staging_1" },
    missingBefore: [],
    outcome: { resourceSnapshots: [], decisions: [], transferAttempts: [] },
    agentText: "",
    stillMissing: [],
    obtained: [],
    providerAhead: [],
    auditEvents: [],
    ...over,
  };
}

describe("bridgeV2WorkflowToResult — V2 facts → per-season WorkflowResult shape", () => {
  it("single-season type2, everything obtained → succeeded, season tracked with the V2 directory, all episodes obtained, user notification", () => {
    const result = bridgeV2WorkflowToResult({
      title,
      mode: "type2",
      seasons: [{ seasonNumber: 1, totalEpisodes: 3, latestAiredEpisode: 3, qualityPreference: "4K" }],
      v2: v2Result({
        missingBefore: ["S01E01", "S01E02", "S01E03"],
        obtained: ["S01E01", "S01E02", "S01E03"],
        stillMissing: [],
      }),
      workflowRunId: "run-x",
      now: () => "2026-06-15T00:00:00.000Z",
    });

    expect(result.status).toBe("succeeded");
    expect(result.seasons).toHaveLength(1);
    const season = result.seasons[0]!;
    expect(season.season.storageDirectoryId).toBe("season_1_dir");
    expect(season.season.id).toBe("tmdb_tv_100_s1");
    expect(season.season.status).toBe("completed"); // aired >= total
    expect(season.episodes).toHaveLength(3);
    expect(season.episodes.every((episode) => episode.obtained)).toBe(true);
    expect(result.notification.kind).toBe("tracking_initialized");
    expect(result.notification.trigger).toBe("user");
    expect(result.notifications).toContain(result.notification);
  });

  it("single-season, nothing obtained but had a gap → no_coverage notification", () => {
    const result = bridgeV2WorkflowToResult({
      title,
      mode: "type2",
      seasons: [{ seasonNumber: 1, totalEpisodes: 3, latestAiredEpisode: 3, qualityPreference: "4K" }],
      v2: v2Result({
        missingBefore: ["S01E01", "S01E02", "S01E03"],
        obtained: [],
        stillMissing: ["S01E01", "S01E02", "S01E03"],
      }),
      workflowRunId: "run-x",
      now: () => "2026-06-15T00:00:00.000Z",
    });

    expect(result.status).toBe("no_coverage");
    expect(result.seasons[0]!.episodes.every((episode) => !episode.obtained)).toBe(true);
    expect(result.notification.kind).toBe("no_coverage");
  });

  it("nothing obtained because transfers were systemically BLOCKED → honest 转存失败 (failed), not 暂未找到资源", () => {
    const result = bridgeV2WorkflowToResult({
      title,
      mode: "type2",
      seasons: [{ seasonNumber: 1, totalEpisodes: 3, latestAiredEpisode: 3, qualityPreference: "4K" }],
      v2: v2Result({
        missingBefore: ["S01E01", "S01E02", "S01E03"],
        obtained: [],
        stillMissing: ["S01E01", "S01E02", "S01E03"],
        outcome: {
          resourceSnapshots: [],
          decisions: [],
          transferAttempts: [
            { id: "t1", workflowRunId: "run-x", candidateId: "c1", status: "failed", providerMessage: "云下载配额不足，请升级VIP获得赠送配额或购买云下载配额！", materializedFileIds: [] },
            { id: "t2", workflowRunId: "run-x", candidateId: "c2", status: "failed", providerMessage: "云下载配额不足，请升级VIP获得赠送配额或购买云下载配额！", materializedFileIds: [] },
          ],
        },
      }),
      workflowRunId: "run-x",
      now: () => "2026-06-15T00:00:00.000Z",
    });

    // Run-level coverage is still no_coverage (0 obtained), but the user-facing
    // report is honest: failed + the real reason, never "暂未找到资源".
    expect(result.notification.report?.status).toBe("failed");
    expect(result.notification.body).toContain("转存失败");
    expect(result.notification.body).toContain("配额");
    expect(result.notification.body).not.toContain("暂未找到");
    // kind must NOT be no_coverage — else the leading icon + daily-digest would
    // still count this account block as 暂无资源, contradicting the failed pill.
    expect(result.notification.kind).toBe("transfer_failed");
  });

  it("no-op (nothing was missing) → succeeded, episodes reflect the already-obtained set, no transfers", () => {
    const result = bridgeV2WorkflowToResult({
      title,
      mode: "type3",
      seasons: [{ seasonNumber: 1, totalEpisodes: 3, latestAiredEpisode: 3, qualityPreference: "4K", status: "active" }],
      v2: v2Result({
        missingBefore: [],
        obtained: ["S01E01", "S01E02", "S01E03"],
        stillMissing: [],
      }),
      workflowRunId: "run-x",
      now: () => "2026-06-15T00:00:00.000Z",
    });

    expect(result.status).toBe("succeeded");
    expect(result.seasons[0]!.episodes.every((episode) => episode.obtained)).toBe(true);
    expect(result.transferAttempts).toEqual([]);
    expect(result.notification.trigger).toBe("scheduled");
  });

  it("type3 patrol no-op: airing 且本次无新增 → kind already_current（例行巡检折叠降噪）", () => {
    const result = bridgeV2WorkflowToResult({
      title,
      mode: "type3",
      // 追更中：已播 4/12，S01E01-E04 全在库，无缺无新增（金特务场景）
      seasons: [{ seasonNumber: 1, totalEpisodes: 12, latestAiredEpisode: 4, qualityPreference: "4K", status: "active" }],
      v2: v2Result({
        missingBefore: [],
        obtained: ["S01E01", "S01E02", "S01E03", "S01E04"],
        stillMissing: [],
      }),
      workflowRunId: "run-noop",
      now: () => "2026-07-09T00:00:00.000Z",
    });

    expect(result.notification.kind).toBe("already_current");
    expect(result.notification.trigger).toBe("scheduled");
    expect(result.notification.report?.status).toBe("airing");
    expect(result.notification.report?.newlyObtained).toEqual([]);
  });

  it("type3 patrol: airing 但本次真收到新集 → 仍是 episodes_restored（不许把有效更新降噪掉）", () => {
    const result = bridgeV2WorkflowToResult({
      title,
      mode: "type3",
      seasons: [{ seasonNumber: 1, totalEpisodes: 12, latestAiredEpisode: 5, qualityPreference: "4K", status: "active" }],
      v2: v2Result({
        missingBefore: ["S01E05"],
        obtained: ["S01E01", "S01E02", "S01E03", "S01E04", "S01E05"],
        stillMissing: [],
      }),
      workflowRunId: "run-gain",
      now: () => "2026-07-09T00:00:00.000Z",
    });

    expect(result.notification.kind).toBe("episodes_restored");
    expect(result.notification.report?.newlyObtained).toEqual(["E05"]);
  });

  it("type3 patrol: 有已播缺集（partial）→ 仍是 episodes_restored（真缺集不降噪）", () => {
    const result = bridgeV2WorkflowToResult({
      title,
      mode: "type3",
      seasons: [{ seasonNumber: 1, totalEpisodes: 12, latestAiredEpisode: 6, qualityPreference: "4K", status: "active" }],
      v2: v2Result({
        missingBefore: ["S01E05", "S01E06"],
        obtained: ["S01E01", "S01E02", "S01E03", "S01E04", "S01E05"],
        stillMissing: ["S01E06"],
      }),
      workflowRunId: "run-partial",
      now: () => "2026-07-09T00:00:00.000Z",
    });

    expect(result.notification.report?.status).toBe("partial");
    expect(result.notification.kind).toBe("episodes_restored");
  });

  // The finale graduation promised by season-sync.ts ("only the finale — all
  // obtained — graduates it to completed"). Callers pass the persisted status
  // through, so without graduating HERE an active season stays active forever:
  // the patrol re-sweeps a finished, fully-obtained show daily and the library
  // keeps its 追更中 badge while the notification says 不再追踪 (莫离 bug).
  it("type3 patrol: active season now fully aired AND fully obtained → persisted status graduates to completed", () => {
    const result = bridgeV2WorkflowToResult({
      title,
      mode: "type3",
      seasons: [{ seasonNumber: 1, totalEpisodes: 3, latestAiredEpisode: 3, qualityPreference: "4K", status: "active" }],
      v2: v2Result({
        missingBefore: [],
        obtained: ["S01E01", "S01E02", "S01E03"],
        stillMissing: [],
      }),
      workflowRunId: "run-x",
      now: () => "2026-06-15T00:00:00.000Z",
    });

    expect(result.seasons[0]!.season.status).toBe("completed");
    // The user-facing report agrees — persisted state and 不再追踪 wording can't diverge.
    expect(result.notification.report?.status).toBe("complete");
  });

  it("type3 patrol: fully aired but a real gap remains → stays active so the sweep keeps filling", () => {
    const result = bridgeV2WorkflowToResult({
      title,
      mode: "type3",
      seasons: [{ seasonNumber: 1, totalEpisodes: 3, latestAiredEpisode: 3, qualityPreference: "4K", status: "active" }],
      v2: v2Result({
        missingBefore: ["S01E02"],
        obtained: ["S01E01", "S01E03"],
        stillMissing: ["S01E02"],
      }),
      workflowRunId: "run-x",
      now: () => "2026-06-15T00:00:00.000Z",
    });

    expect(result.seasons[0]!.season.status).toBe("active");
  });

  it("type3 patrol: still airing (latestAired < total) with everything aired obtained → stays active", () => {
    const result = bridgeV2WorkflowToResult({
      title,
      mode: "type3",
      seasons: [{ seasonNumber: 1, totalEpisodes: 12, latestAiredEpisode: 2, qualityPreference: "4K", status: "active" }],
      v2: v2Result({
        missingBefore: [],
        obtained: ["S01E01", "S01E02"],
        stillMissing: [],
      }),
      workflowRunId: "run-x",
      now: () => "2026-06-15T00:00:00.000Z",
    });

    expect(result.seasons[0]!.season.status).toBe("active");
  });

  it("multi-season series, partial coverage → status partial, series-level rollup notification", () => {
    const result = bridgeV2WorkflowToResult({
      title,
      mode: "series",
      seasons: [
        { seasonNumber: 1, totalEpisodes: 3, latestAiredEpisode: 3, qualityPreference: "4K" },
        { seasonNumber: 2, totalEpisodes: 3, latestAiredEpisode: 3, qualityPreference: "4K" },
      ],
      v2: {
        directories: {
          showDirectoryId: "show_1",
          seasonDirectoryIds: { 1: "s1_dir", 2: "s2_dir" },
          stagingDirectoryId: "staging_1",
        },
        missingBefore: ["S01E01", "S01E02", "S01E03", "S02E01", "S02E02", "S02E03"],
        outcome: { resourceSnapshots: [], decisions: [], transferAttempts: [] },
        agentText: "",
        obtained: ["S01E01", "S01E02", "S01E03"],
        stillMissing: ["S02E01", "S02E02", "S02E03"],
        providerAhead: [],
        auditEvents: [],
      },
      workflowRunId: "run-x",
      now: () => "2026-06-15T00:00:00.000Z",
    });

    expect(result.status).toBe("partial");
    expect(result.seasons).toHaveLength(2);
    expect(result.seasons[0]!.season.storageDirectoryId).toBe("s1_dir");
    expect(result.seasons[1]!.season.storageDirectoryId).toBe("s2_dir");
    expect(result.seasons[0]!.episodes.every((episode) => episode.obtained)).toBe(true);
    expect(result.seasons[1]!.episodes.every((episode) => !episode.obtained)).toBe(true);
    expect(result.notification.kind).toBe("series_initialized");
    expect(result.notification.title).toBe("示例剧");
  });
});
