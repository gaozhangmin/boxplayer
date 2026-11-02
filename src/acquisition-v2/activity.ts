/**
 * Cleaned, human-readable interpretation of the acquisition agent's live work,
 * for the activity page's single-line ticker + rough progress bar. Pure: maps a
 * tool call (name + args) to a 中文 phrase + a coarse pipeline phase, and a phase
 * to a phase-weighted, monotonic progress %.
 *
 * Honest by construction: the phrases describe REAL tool actions (never fabricated
 * filler), expose no ids/paths, and the progress bar is phase-weighted (Microsoft
 * Win32 guidance) — starts ~5%, weights transfer widest, never reaches 100% before
 * the finalize step actually completes, and is clamped monotonic so agent retries
 * don't rewind the bar.
 */
export type AgentPhase = "search" | "pick" | "transfer" | "verify" | "organize" | "mark" | "finalize";

export interface AgentActivity {
  activity: string;
  phase: AgentPhase;
}

/** A single tool call surfaced to the progress sink: the interpreted activity +
 *  the raw name/args (the sink reads markObtained codes to accumulate obtained). */
export interface AgentToolEvent extends AgentActivity {
  toolName: string;
  args: Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Map ONE real agent tool call to a cleaned activity line + phase. Tool names and
 *  arg keys mirror buildSandboxToolSet in agent-loop.ts exactly. */
export function interpretTool(toolName: string, args: Record<string, unknown> = {}): AgentActivity {
  switch (toolName) {
    case "readSkill":
      return { activity: "正在查阅操作手册…", phase: "search" };
    case "viewResourceSnapshot":
      // The pre-warmed 活期文档 review: the agent is browsing the system's
      // already-searched raw candidates (free, read-only) before deciding. It is
      // search-phase work (orient the candidate set, no transfer yet), so it stays
      // in the low band — never the generic "处理中…" fallback.
      return { activity: "正在浏览候选资源…", phase: "search" };
    case "searchResources": {
      const keyword = String(args.keyword ?? "").trim();
      return { activity: keyword ? `正在搜索资源:${keyword}` : "正在搜索资源…", phase: "search" };
    }
    case "transferCandidate":
    case "transferUntilLanded":
      return { activity: "正在转存到网盘…", phase: "transfer" };
    case "inspectStaging":
      return { activity: "正在核对落盘的视频文件…", phase: "verify" };
    case "inspectTargetDir":
      // EARLY orientation: the agent inspects the landing/library directory to know
      // where files go — typically BEFORE search/transfer. So it weighs as early
      // setup (low band), NOT verify. Classing it as `verify` (66%) made the
      // monotonic bar jump to ~66% right after this step, before any real work, and
      // pinned it there through the transfer. (inspectStaging — the post-transfer
      // landed-file check — is the genuine verify above.)
      return { activity: "正在核对入库目录…", phase: "search" };
    case "moveToSeason": {
      const moves = asArray(args.moves) as Array<{ season?: number }>;
      const seasons = moves.map((move) => move?.season).filter((season): season is number => typeof season === "number");
      if (seasons.length === 0) {
        return { activity: "正在整理影片文件…", phase: "organize" };
      }
      const unique = Array.from(new Set(seasons));
      return {
        activity: unique.length === 1 ? `正在整理到第 ${unique[0]} 季…` : "正在按季整理文件…",
        phase: "organize",
      };
    }
    case "deleteFiles":
      return { activity: "正在清理多余文件…", phase: "organize" };
    case "flattenMovie":
      return { activity: "正在整理影片文件…", phase: "organize" };
    case "discardStaging":
      return { activity: "正在清理暂存目录…", phase: "finalize" };
    case "markObtained": {
      const codes = asArray(args.codes).map((code) => String(code));
      if (codes.length === 1 && codes[0] === "MOVIE") {
        return { activity: "影片已入库", phase: "mark" };
      }
      return { activity: `已确认 ${codes.length} 集入库`, phase: "mark" };
    }
    // Subtitle tools (assrt 活期文档 flow). They run AFTER the video landed, so
    // they weigh in the pick/organize bands — the monotonic clamp keeps the bar
    // honest either way; the ticker text is what the user actually reads.
    case "viewSubtitleSnapshot":
      return { activity: "正在浏览字幕候选…", phase: "pick" };
    case "transferSubtitle":
      return { activity: "正在下载字幕…", phase: "organize" };
    case "renameSubtitle": {
      const count = asArray(args.renames).length;
      return { activity: count > 1 ? `正在重命名 ${count} 个字幕…` : "正在重命名字幕…", phase: "organize" };
    }
    case "finish":
      return { activity: "正在收尾…", phase: "finalize" };
    case "reportNoCoverage":
      return { activity: "未找到可用资源", phase: "finalize" };
    default:
      return { activity: "处理中…", phase: "search" };
  }
}

/** Phase → [start%, end%] band. Weighted by typical wall-clock cost (transfer
 *  widest); finalize tops at 99 so the bar only fills to 100 when the run is
 *  actually marked finished by the runner. */
const PHASE_BANDS: Record<AgentPhase, [number, number]> = {
  search: [5, 15],
  pick: [15, 25],
  transfer: [25, 60],
  verify: [60, 72],
  organize: [72, 85],
  mark: [85, 95],
  finalize: [95, 99],
};

/**
 * Rough, honest progress for a phase. `subFraction` (0–1) drives the band when a
 * real fraction is known (the mark phase's obtained/needed); otherwise the band's
 * midpoint is used so the bar advances without pretending precision it lacks.
 */
export function phaseProgress(phase: AgentPhase, subFraction?: number): number {
  const [start, end] = PHASE_BANDS[phase];
  const fraction = subFraction === undefined ? 0.5 : Math.min(1, Math.max(0, subFraction));
  return Math.round(start + (end - start) * fraction);
}

/** Never let the displayed bar rewind when the agent retries/backtracks a phase. */
export function clampMonotonic(previous: number, next: number): number {
  return Math.max(previous, next);
}
