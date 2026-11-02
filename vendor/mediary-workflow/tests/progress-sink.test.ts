import { describe, expect, it } from "vitest";
import type { WorkflowRunProgress } from "../src/index.js";
import { makeProgressSink } from "../src/acquisition-v2/progress-sink.js";
import { interpretTool } from "../src/acquisition-v2/activity.js";

function fakeRepo() {
  const writes: Array<{ runId: string; progress: WorkflowRunProgress }> = [];
  return {
    writes,
    updateWorkflowRunProgress: async (runId: string, progress: WorkflowRunProgress) => {
      writes.push({ runId, progress });
    },
  };
}

describe("makeProgressSink", () => {
  it("writes phase-weighted progress per tool event", () => {
    const repo = fakeRepo();
    const sink = makeProgressSink({ repository: repo, workflowRunId: "r1", now: () => "t" });
    sink({ toolName: "searchResources", args: { keyword: "x" }, activity: "正在搜索资源:x", phase: "search" });
    sink({ toolName: "transferCandidate", args: {}, activity: "正在转存到网盘…", phase: "transfer" });
    expect(repo.writes.map((w) => w.progress.phase)).toEqual(["search", "transfer"]);
    expect(repo.writes[0]!.progress.percent).toBeLessThan(repo.writes[1]!.progress.percent);
    expect(repo.writes[0]!.runId).toBe("r1");
  });

  it("accumulates obtained from markObtained and drives the mark band by obtained/needed", () => {
    const repo = fakeRepo();
    const sink = makeProgressSink({ repository: repo, workflowRunId: "r", neededHint: 4, now: () => "t" });
    sink({ toolName: "markObtained", args: { codes: ["S1E1", "S1E2"] }, activity: "已确认 2 集入库", phase: "mark" });
    const p = repo.writes.at(-1)!.progress;
    expect(p.obtained).toBe(2);
    expect(p.needed).toBe(4);
    expect(p.percent).toBe(90); // mark band [85,95], 2/4=0.5 → 90
  });

  it("never rewinds percent when a later event maps to a lower phase", () => {
    const repo = fakeRepo();
    const sink = makeProgressSink({ repository: repo, workflowRunId: "r", now: () => "t" });
    sink({ toolName: "transferCandidate", args: {}, activity: "转存", phase: "transfer" });
    sink({ toolName: "readSkill", args: { section: "x" }, activity: "查手册", phase: "search" });
    expect(repo.writes.at(-1)!.progress.percent).toBeGreaterThanOrEqual(repo.writes[0]!.progress.percent);
  });

  it("ignores the MOVIE sentinel in the obtained count", () => {
    const repo = fakeRepo();
    const sink = makeProgressSink({ repository: repo, workflowRunId: "r", neededHint: 1, now: () => "t" });
    sink({ toolName: "markObtained", args: { codes: ["MOVIE"] }, activity: "影片已入库", phase: "mark" });
    expect(repo.writes.at(-1)!.progress.obtained).toBe(0);
  });

  it("swallows repository write errors (progress must never fail the run)", () => {
    const sink = makeProgressSink({
      repository: {
        updateWorkflowRunProgress: async () => {
          throw new Error("db down");
        },
      },
      workflowRunId: "r",
      now: () => "t",
    });
    expect(() => sink({ toolName: "finish", args: {}, activity: "收尾", phase: "finalize" })).not.toThrow();
  });

  it("advances WITHIN a phase as the agent keeps working in it (a long phase must not sit flat at the midpoint)", () => {
    const repo = fakeRepo();
    const sink = makeProgressSink({ repository: repo, workflowRunId: "r", now: () => "t" });
    // Three searches in a row (e.g., the agent trying variants) — the bar should
    // creep forward with each, reflecting ongoing work, not freeze at one value.
    sink({ toolName: "searchResources", args: { keyword: "a" }, activity: "搜 a", phase: "search" });
    sink({ toolName: "searchResources", args: { keyword: "b" }, activity: "搜 b", phase: "search" });
    sink({ toolName: "searchResources", args: { keyword: "c" }, activity: "搜 c", phase: "search" });
    const p = repo.writes.map((w) => w.progress.percent);
    expect(p[1]!).toBeGreaterThan(p[0]!);
    expect(p[2]!).toBeGreaterThan(p[1]!);
    // ...but never escape the search band (must not pretend to be transferring).
    expect(p[2]!).toBeLessThan(25);
  });

  // Regression for the 2026-06-24 bug: a REAL run's tool order (run 48b20772) has the
  // agent inspect the入库目录 EARLY (ordinal 2, before search/transfer). The bar must
  // NOT jump to verify-territory (~66%) then; it should climb monotonically WITH the
  // work, reaching ~66% only at the post-transfer inspectStaging.
  it("real tool order: confirming the target dir early must not jump the bar to ~66% before transfer", () => {
    const repo = fakeRepo();
    const sink = makeProgressSink({ repository: repo, workflowRunId: "r", now: () => "t" });
    const sequence = [
      "readSkill", "readSkill", "inspectTargetDir", "searchResources",
      "transferCandidate", "transferCandidate", "transferCandidate",
      "inspectStaging", "moveToSeason", "inspectTargetDir",
      "markObtained", "discardStaging", "finish",
    ];
    for (const toolName of sequence) {
      const { activity, phase } = interpretTool(toolName, {});
      sink({ toolName, args: {}, activity, phase });
    }
    const percents = repo.writes.map((w) => w.progress.percent);
    const idxOfEarlyTargetDir = 2;
    const idxOfStaging = 7; // first genuine post-transfer verify
    // The early inspectTargetDir must keep the bar low (still in the early/search region).
    expect(percents[idxOfEarlyTargetDir]!).toBeLessThan(25); // below the transfer band start
    // The bar must not reach verify-territory before the post-transfer file check.
    expect(Math.max(...percents.slice(0, idxOfStaging))).toBeLessThan(60);
    // The transfer steps must actually move the bar (reflecting the real work).
    expect(percents[4]!).toBeGreaterThan(percents[idxOfEarlyTargetDir]!);
    // Monotonic + finishes high.
    for (let i = 1; i < percents.length; i += 1) expect(percents[i]!).toBeGreaterThanOrEqual(percents[i - 1]!);
    expect(percents.at(-1)!).toBeGreaterThanOrEqual(95);
  });
});
