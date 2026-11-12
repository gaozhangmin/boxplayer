import { episodeNumberFromCode } from "./domain.js";
import type {
  EpisodeState,
  MediaType,
  NotificationEvent,
  NotificationReport,
  NotificationReportStatus,
  TrackedSeason,
} from "./domain.js";

/** "S01E13" -> "E13". The season is already in the card's title row. */
function shortCode(code: string): string {
  return code.replace(/^S\d+/, "");
}

function seasonLabel(seasonNumber: number): string {
  return `第 ${seasonNumber} 季`;
}

/** [1,2,3,5] -> "1–3、5". Consecutive runs collapse to a dashed range. */
function formatSeasonRange(seasons: number[]): string {
  const sorted = [...seasons].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return "";
  }
  const groups: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let index = 1; index <= sorted.length; index += 1) {
    const current = sorted[index];
    if (current !== undefined && current === prev + 1) {
      prev = current;
      continue;
    }
    groups.push(start === prev ? `${start}` : `${start}–${prev}`);
    if (current !== undefined) {
      start = current;
      prev = current;
    }
  }
  return groups.join("、");
}

interface SeasonFacts {
  realMissing: string[]; // aired-but-not-obtained, short codes
  seasonFinished: boolean;
  fullyObtained: boolean;
  /** Highest obtained episode number (may exceed the aired cursor → provider-ahead). */
  maxObtainedEpisode: number;
  /** A resource ran ahead of TMDB: we hold episodes past the latest-aired cursor. */
  providerAhead: boolean;
}

function seasonFacts(season: TrackedSeason, episodes: EpisodeState[]): SeasonFacts {
  const aired = episodes.filter((episode) => episode.airStatus === "aired");
  const realMissing = aired.filter((episode) => !episode.obtained).map((episode) => shortCode(episode.episodeCode));
  const obtained = episodes.filter((episode) => episode.obtained);
  const seasonFinished = season.latestAiredEpisode >= season.totalEpisodes;
  const fullyObtained = seasonFinished && realMissing.length === 0 && obtained.length >= season.totalEpisodes;
  const maxObtainedEpisode = obtained.reduce(
    (max, episode) => Math.max(max, episodeNumberFromCode(episode.episodeCode)),
    0,
  );
  const providerAhead = maxObtainedEpisode > season.latestAiredEpisode;
  return { realMissing, seasonFinished, fullyObtained, maxObtainedEpisode, providerAhead };
}

export interface SeasonReportInput {
  titleName: string;
  season: TrackedSeason;
  episodes: EpisodeState[];
  /** Episodes obtained THIS run worth chipping (daily delta). Empty for first-time hauls. */
  newlyObtained?: string[];
  /** Force the no-coverage shape regardless of episode facts. */
  noCoverage?: boolean;
  /** When nothing landed because transfers were systemically BLOCKED (115 云下载
   *  配额不足 / 登录过期 / 非 VIP), the honest report is "转存失败:<reason>" with
   *  status `failed` — NOT "暂未找到资源" (the resource exists; the account is
   *  blocked). Only meaningful together with noCoverage. See classifyTransferBlock. */
  transferBlockReason?: string | null;
  /** Real landed video files: count + summed bytes. The card/push show the true
   *  per-episode size from these (总字节 / 文件数), not a claimed quality tag. */
  fileCount?: number;
  totalBytes?: number;
  /** Poster/tmdbId/year for richer pushes. */
  meta?: NotificationTitleMeta;
}

/** Only attach size facts when BOTH are present — a half-known size is omitted,
 *  never guessed (mirrors how an absent quality used to drop the line). */
function sizeFields(input: { fileCount?: number; totalBytes?: number }): {
  fileCount?: number;
  totalBytes?: number;
} {
  return input.fileCount !== undefined && input.totalBytes !== undefined
    ? { fileCount: input.fileCount, totalBytes: input.totalBytes }
    : {};
}

/** The status+lines for a run that obtained nothing. Default = no_coverage
 *  ("暂未找到资源"); when transfers were systemically blocked, it's an honest
 *  `failed` + the real reason (别甩锅 — the resource exists, the account is blocked).
 *  Shared by the TV bridge and the movie workflow so both report identically. */
export function emptyRunOutcome(
  transferBlockReason?: string | null,
): { status: NotificationReportStatus; lines: string[] } {
  if (transferBlockReason && transferBlockReason.trim()) {
    return { status: "failed", lines: [`转存失败:${transferBlockReason.trim()}`] };
  }
  return { status: "no_coverage", lines: ["暂未找到可用资源 · 将持续尝试"] };
}

/**
 * Single-season report. Never lists unaired episodes as missing — `realMissing`
 * is exactly the aired-but-not-obtained set, so a season waiting on unaired
 * episodes reads as a clean "airing", not as a perpetual gap.
 */
export function buildSeasonReport(input: SeasonReportInput): NotificationReport {
  const { realMissing, fullyObtained, maxObtainedEpisode, providerAhead } = seasonFacts(
    input.season,
    input.episodes,
  );
  const newlyObtained = (input.newlyObtained ?? []).map(shortCode);
  const label = seasonLabel(input.season.seasonNumber);

  if (input.noCoverage) {
    return {
      titleName: input.titleName,
      seasonLabel: label,
      ...emptyRunOutcome(input.transferBlockReason),
      newlyObtained: [],
      realMissing,
      ...(input.meta ?? {}),
    };
  }

  let status: NotificationReportStatus;
  let lines: string[];
  if (fullyObtained) {
    status = "complete";
    lines = [`全 ${input.season.totalEpisodes} 集已完整获取，不再追踪`];
  } else if (realMissing.length > 0) {
    status = "partial";
    lines = newlyObtained.length > 0 ? ["本次有新增，仍有已播集数待补"] : ["已获取部分已播集，仍有缺集待补"];
  } else if (providerAhead) {
    // 资源超前: a full/ahead-of-schedule resource landed episodes past TMDB's
    // latest-aired cursor. Report what we actually hold, not the aired count.
    status = "airing";
    lines = [`已获取至第 ${maxObtainedEpisode} 集 · 资源超前于已播，后续更新自动追踪`];
  } else {
    status = "airing";
    lines =
      newlyObtained.length > 0
        ? ["已获取至最新 · 后续更新自动追踪"]
        : [`已获取至最新第 ${input.season.latestAiredEpisode} 集 · 后续更新自动追踪`];
  }

  return {
    titleName: input.titleName,
    seasonLabel: label,
    status,
    lines,
    newlyObtained,
    realMissing,
    ...sizeFields(input),
    ...(input.meta ?? {}),
  };
}

export interface SeriesReportSeasonInput {
  season: TrackedSeason;
  episodes: EpisodeState[];
}

/**
 * Multi-season "get everything" rollup: completed seasons collapse to a range,
 * still-airing seasons each get a "已获取至最新第 N 集 · 后续自动追踪" line, and
 * seasons with genuine aired gaps name the gap.
 */
export function buildSeriesReport(input: {
  titleName: string;
  seasons: SeriesReportSeasonInput[];
  noCoverage?: boolean;
  /** See SeasonReportInput.transferBlockReason — honest 转存失败 when blocked. */
  transferBlockReason?: string | null;
  meta?: NotificationTitleMeta;
  fileCount?: number;
  totalBytes?: number;
}): NotificationReport {
  if (input.noCoverage) {
    return {
      titleName: input.titleName,
      seasonLabel: null,
      ...emptyRunOutcome(input.transferBlockReason),
      newlyObtained: [],
      realMissing: [],
      ...(input.meta ?? {}),
    };
  }

  const complete: number[] = [];
  const airing: { seasonNumber: number; latestAired: number }[] = [];
  const partial: { seasonNumber: number; missing: string[] }[] = [];
  for (const entry of input.seasons) {
    const facts = seasonFacts(entry.season, entry.episodes);
    if (facts.fullyObtained) {
      complete.push(entry.season.seasonNumber);
    } else if (facts.realMissing.length > 0) {
      partial.push({ seasonNumber: entry.season.seasonNumber, missing: facts.realMissing });
    } else {
      airing.push({ seasonNumber: entry.season.seasonNumber, latestAired: entry.season.latestAiredEpisode });
    }
  }

  const lines: string[] = [];
  if (complete.length > 0) {
    const isContiguousFromOne =
      airing.length === 0 &&
      partial.length === 0 &&
      complete.length === Math.max(...complete) &&
      Math.min(...complete) === 1;
    lines.push(
      isContiguousFromOne
        ? `全 ${complete.length} 季已完整获取`
        : `第 ${formatSeasonRange(complete)} 季已完整获取`,
    );
  }
  for (const entry of airing) {
    lines.push(`第 ${entry.seasonNumber} 季 · 已获取至最新第 ${entry.latestAired} 集 · 后续自动追踪`);
  }
  for (const entry of partial) {
    lines.push(`第 ${entry.seasonNumber} 季 · 仍缺 ${entry.missing.join("、")} 待后续获取`);
  }

  const status: NotificationReportStatus =
    airing.length === 0 && partial.length === 0 ? "complete" : partial.length > 0 ? "partial" : "airing";

  return {
    titleName: input.titleName,
    seasonLabel: null,
    status,
    lines,
    newlyObtained: [],
    realMissing: partial.flatMap((entry) => entry.missing),
    ...sizeFields(input),
    ...(input.meta ?? {}),
  };
}

/** Title metadata for richer pushes (poster image + tap-through link). */
export interface NotificationTitleMeta {
  posterPath?: string | null;
  tmdbId?: number;
  mediaType?: MediaType;
  year?: number;
}

/** Movie / one-off: nothing to track, just acquired. */
export function buildMovieReport(
  titleName: string,
  meta?: NotificationTitleMeta,
  size?: { fileCount: number; totalBytes: number },
  /** Movie 中文字幕软兜底: landed a raw-name match without a confirmed 中字 track
   *  (中字 budget exhausted) — surface it so the user can add subs / re-seek. */
  subtitleFallback = false,
): NotificationReport {
  return {
    titleName,
    seasonLabel: null,
    status: "acquired",
    lines: subtitleFallback ? ["已获取入库", "⚠️ 可能无中文字幕(兜底)"] : ["已获取入库"],
    newlyObtained: [],
    realMissing: [],
    ...sizeFields(size ?? {}),
    ...(meta ?? {}),
  };
}

const STATUS_EMOJI: Record<NotificationReportStatus, string> = {
  complete: "🎉",
  acquired: "✅",
  airing: "📈",
  partial: "🟡",
  no_coverage: "🔍",
  failed: "❌",
  retrying: "⚠️",
};

/**
 * Plain-text rendering of a report for push channels (Bark/Server酱/企微/webhook).
 * Same data the web feed renders as chips, decorated with emoji for chat-style
 * surfaces.
 */
export function formatReportPushText(report: NotificationReport): string {
  const head = report.seasonLabel ? `${report.titleName} ${report.seasonLabel}` : report.titleName;
  const parts: string[] = [`📺 ${head}`, ""];
  for (const line of report.lines) {
    parts.push(`${STATUS_EMOJI[report.status]} ${line}`);
  }
  if (report.newlyObtained.length > 0) {
    parts.push(`✅ 本次新增：${report.newlyObtained.join("、")}`);
  }
  if (report.realMissing.length > 0) {
    parts.push(`🔴 缺集：${report.realMissing.join("、")}`);
  }
  const size = landedSize(report);
  if (size) {
    parts.push(`🎞 ${size.label}：${size.value}`);
  }
  return parts.join("\n");
}

/** Human-readable byte size: KB below 1 MB, whole MB below 1 GB, else GB to one
 *  decimal. Video files are large, so MB/GB is the common case. */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  if (mb < 1024) {
    return `${Math.round(mb)} MB`;
  }
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * The size line a card/push should show for a report — the TRUE landed volume,
 * not a claimed quality tag. A movie (status "acquired", one file) shows its
 * total volume; a series shows the real per-episode average (总字节 / 文件数, what
 * exposed "几百 MB 不是 4K"). Undefined when size facts are absent — omit, never
 * guess (the same contract the old quality line used).
 */
export function landedSize(report: NotificationReport): { label: string; value: string } | undefined {
  const { fileCount, totalBytes } = report;
  if (fileCount === undefined || totalBytes === undefined || fileCount <= 0 || totalBytes <= 0) {
    return undefined;
  }
  if (report.status === "acquired") {
    return { label: "体积", value: formatBytes(totalBytes) };
  }
  return { label: "每集", value: `约 ${formatBytes(totalBytes / fileCount)}` };
}

/**
 * One consolidated digest for a whole scheduled sweep, so a daily routine
 * pushes a single message instead of one per show. Shows that changed get a
 * detail line; shows checked with nothing to do collapse into a tail count.
 */
export function formatDailyDigestPushText(
  notifications: NotificationEvent[],
  opts?: { sourceLabelById?: Map<string, string> },
): string {
  const withReport = notifications.filter((notification) => notification.report !== undefined);
  const changed = withReport.filter((notification) => notification.kind !== "already_current");
  const unchanged = withReport.length - changed.length;

  // No "每日巡检" header line: the push's title field already carries it, and a
  // repeated heading rendered a duplicate title under it (same fix as the movie
  // notification). The body is just the per-show list.
  if (changed.length === 0) {
    return `本次巡检无更新，已检查 ${withReport.length} 部追踪剧集。`;
  }

  const lines: string[] = [];
  for (const notification of changed) {
    const report = notification.report;
    if (report === undefined) {
      continue;
    }
    const head = report.seasonLabel ? `${report.titleName} ${report.seasonLabel}` : report.titleName;
    const size = landedSize(report);
    const sizeSuffix = size ? ` · ${size.value}` : "";
    let detail: string;
    if (notification.kind === "tracking_completed") {
      // Even a finale should say WHICH episodes were the last to land + size,
      // so a single push carries real information, not just "追完".
      const gained = report.newlyObtained.length > 0 ? `（补齐 ${report.newlyObtained.join("、")}）` : "";
      detail = `🎉 追完，全部获取${gained}${sizeSuffix}`;
    } else {
      const segments: string[] = [];
      if (report.newlyObtained.length > 0) {
        segments.push(`新增 ${report.newlyObtained.join("、")}${sizeSuffix}`);
      }
      if (report.realMissing.length > 0) {
        segments.push(`缺 ${report.realMissing.join("、")}`);
      }
      // No episode delta this sweep → fall back to the report's concrete progress
      // line ("已获取至最新第 6 集"), never a content-free "已更新".
      detail = segments.join(" · ") || report.lines[0] || "已是最新";
    }
    // Markdown: bold name + bullet, so Server酱 renders a real list, not a flat
    // text blob (desp is markdown; bare "·" lines read as a wall of plain text).
    // Source-drive suffix only present when the push layer passes the map (≥2 drives).
    const source = opts?.sourceLabelById?.get(notification.id);
    const sourceSuffix = source ? ` · 来自${source}` : "";
    lines.push(`- **${head}** — ${detail}${sourceSuffix}`);
  }

  if (unchanged > 0) {
    // Name the shows checked-with-nothing-to-do, don't just count them.
    const names = withReport
      .filter((notification) => notification.kind === "already_current")
      .map((notification) => notification.report?.titleName)
      .filter((name): name is string => Boolean(name));
    lines.push("");
    lines.push(
      names.length > 0 ? `其余已是最新：${names.join("、")}` : `其余 ${unchanged} 部已是最新。`,
    );
  }
  return lines.join("\n");
}
