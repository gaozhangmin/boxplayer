import { describe, expect, it } from "vitest";
import {
  clampMonotonic,
  interpretTool,
  phaseProgress,
  type AgentPhase,
} from "../src/acquisition-v2/activity.js";

describe("interpretTool — real agent tool names → cleaned 中文 + phase", () => {
  it("search echoes the keyword", () => {
    expect(interpretTool("searchResources", { keyword: "斗破苍穹 4K" })).toEqual({
      activity: "正在搜索资源:斗破苍穹 4K",
      phase: "search",
    });
  });

  it("transfer / transferUntilLanded → transfer phase", () => {
    expect(interpretTool("transferCandidate", { snapshotId: "s", candidateId: "c" }).phase).toBe("transfer");
    expect(interpretTool("transferUntilLanded", { candidateIds: ["a", "b"] }).phase).toBe("transfer");
  });

  it("inspectStaging → verify (post-transfer file check), no ids leaked", () => {
    expect(interpretTool("inspectStaging", {})).toEqual({ activity: "正在核对落盘的视频文件…", phase: "verify" });
  });

  it("inspectTargetDir is EARLY orientation → must NOT weigh as verify (else the bar jumps to ~66% before any transfer)", () => {
    // 2026-06-24 bug: 确认入库目录 runs early (orient the landing dir before transfer),
    // but was classed as `verify` → the monotonic bar jumped to ~66% right after it,
    // before the real search/transfer work. Its progress weight must be LOW.
    const targetDir = interpretTool("inspectTargetDir", { season: 5 });
    expect(targetDir.activity).toBe("正在核对入库目录…");
    expect(targetDir.phase).not.toBe("verify");
    expect(phaseProgress(targetDir.phase)).toBeLessThan(phaseProgress("transfer"));
  });

  it("moveToSeason reads the moves plan: single season names it, multi-season generalizes, movie move", () => {
    expect(interpretTool("moveToSeason", { moves: [{ season: 5, fileIds: ["1"] }] })).toEqual({
      activity: "正在整理到第 5 季…",
      phase: "organize",
    });
    expect(interpretTool("moveToSeason", { moves: [{ season: 1, fileIds: [] }, { season: 2, fileIds: [] }] })).toEqual({
      activity: "正在按季整理文件…",
      phase: "organize",
    });
    expect(interpretTool("moveToSeason", { moves: [{ fileIds: ["1"] }] }).activity).toBe("正在整理影片文件…");
  });

  it("deleteFiles / flattenMovie → organize; discardStaging → finalize", () => {
    expect(interpretTool("deleteFiles", { directory: "staging", fileIds: ["1"] }).phase).toBe("organize");
    expect(interpretTool("flattenMovie", {}).phase).toBe("organize");
    expect(interpretTool("discardStaging", {}).phase).toBe("finalize");
  });

  it("markObtained counts codes (and special-cases a movie)", () => {
    expect(interpretTool("markObtained", { codes: ["S05E1", "S05E2"] })).toEqual({
      activity: "已确认 2 集入库",
      phase: "mark",
    });
    expect(interpretTool("markObtained", { codes: ["MOVIE"] }).activity).toBe("影片已入库");
  });

  it("finish / reportNoCoverage → finalize; readSkill is benign meta", () => {
    expect(interpretTool("finish", {}).phase).toBe("finalize");
    expect(interpretTool("reportNoCoverage", { reason: "x" })).toEqual({ activity: "未找到可用资源", phase: "finalize" });
    expect(interpretTool("readSkill", { section: "protocol" }).activity).toBe("正在查阅操作手册…");
  });

  it("viewResourceSnapshot is the pre-warmed 活期文档 review → mapped (not the generic 处理中 fallback)", () => {
    const r = interpretTool("viewResourceSnapshot", {});
    expect(r.activity).not.toBe("处理中…");
    expect(r.activity).toMatch(/候选|预搜|活期文档|浏览/);
    expect(r.phase).toBe("search");
  });

  it("searchResources trims leading/trailing whitespace from the displayed keyword (no stray-space echo)", () => {
    expect(interpretTool("searchResources", { keyword: "  庆余年  " })).toEqual({
      activity: "正在搜索资源:庆余年",
      phase: "search",
    });
  });

  it("never leaks ids/paths and falls back for an unknown tool", () => {
    expect(interpretTool("weirdTool", { cid: "33988", path: "/x" })).toEqual({ activity: "处理中…", phase: "search" });
  });
});

describe("phaseProgress — phase-weighted, starts ~5%, never 100% pre-finalize", () => {
  it("bands per phase", () => {
    expect(phaseProgress("search")).toBeGreaterThanOrEqual(5);
    expect(phaseProgress("search")).toBeLessThan(15);
    expect(phaseProgress("transfer")).toBeGreaterThanOrEqual(25);
    expect(phaseProgress("transfer")).toBeLessThanOrEqual(60);
    expect(phaseProgress("finalize")).toBeLessThanOrEqual(99);
  });

  it("mark band driven by the real obtained/needed fraction", () => {
    expect(phaseProgress("mark", 0)).toBe(85);
    expect(phaseProgress("mark", 1)).toBe(95);
    expect(phaseProgress("mark", 0.5)).toBe(90);
  });
});

describe("clampMonotonic — never rewinds", () => {
  it("keeps the larger", () => {
    expect(clampMonotonic(80, 60)).toBe(80);
    expect(clampMonotonic(60, 80)).toBe(80);
  });
});

it("phase order is the canonical 7-phase pipeline", () => {
  const order: AgentPhase[] = ["search", "pick", "transfer", "verify", "organize", "mark", "finalize"];
  const percents = order.map((p) => phaseProgress(p, 0));
  for (let i = 1; i < percents.length; i += 1) {
    expect(percents[i]!).toBeGreaterThanOrEqual(percents[i - 1]!);
  }
});

describe("interpretTool — subtitle tools (mirror contract with buildSandboxToolSet)", () => {
  it("viewSubtitleSnapshot → 浏览字幕候选 (pick, not the generic fallback)", () => {
    expect(interpretTool("viewSubtitleSnapshot", {})).toEqual({ activity: "正在浏览字幕候选…", phase: "pick" });
  });

  it("transferSubtitle → 下载字幕 (organize band — post-video side work)", () => {
    expect(interpretTool("transferSubtitle", { candidateId: 713570 })).toEqual({ activity: "正在下载字幕…", phase: "organize" });
  });

  it("renameSubtitle → 重命名字幕 (organize)", () => {
    expect(interpretTool("renameSubtitle", { renames: [{ fileId: "f", newName: "Show.S01E01.ass" }] })).toEqual({ activity: "正在重命名字幕…", phase: "organize" });
    expect(interpretTool("renameSubtitle", { renames: [{ fileId: "a", newName: "A.ass" }, { fileId: "b", newName: "B.ass" }] })).toEqual({ activity: "正在重命名 2 个字幕…", phase: "organize" });
  });
});
