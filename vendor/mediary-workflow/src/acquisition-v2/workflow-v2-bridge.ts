import {
  createEpisodeStates,
  episodeNumberFromCode,
  episodePartsFromCode,
  type AgentDecision,
  type AuditEvent,
  type EpisodeState,
  type MediaTitle,
  type NotificationEvent,
  type NotificationReport,
  type ResourceSnapshot,
  type SeasonStatus,
  type TrackedSeason,
  type TransferAttempt,
  type WorkflowStatus,
} from "../domain.js";
import { buildSeasonReport, buildSeriesReport, formatReportPushText } from "../notification-report.js";
import { classifyTransferBlock } from "./transfer-block.js";
import type { RunAcquisitionV2WorkflowResult } from "./workflow-v2.js";

/**
 * Phase 7d — bridge the V2 TV/anime workflow's resource-sync facts back into the
 * existing per-season WorkflowResult shape so the runner can persist exactly like
 * the old paths (frontend/repository unchanged). Pure: no storage, no LLM — it
 * maps the already-reconciled obtained/missing sets the V2 workflow re-read from
 * real 115 onto TrackedSeason + EpisodeState records.
 *
 * The three "modes" (type2 / series / type3) are the SAME resource-sync workflow;
 * they only differ in how the resulting notification is framed (user-triggered
 * init vs scheduled patrol) and single-season vs multi-season rollup — matching
 * the kinds/triggers the old workflow.ts emitted so the feed reads identically.
 */
/** Pass landed size facts to a report builder only when both are present. */
function sizeInput(input: { fileCount?: number; totalBytes?: number }): {
  fileCount?: number;
  totalBytes?: number;
} {
  return input.fileCount !== undefined && input.totalBytes !== undefined
    ? { fileCount: input.fileCount, totalBytes: input.totalBytes }
    : {};
}

export type V2BridgeMode = "type2" | "series" | "type3";

export interface V2BridgeSeasonIntent {
  seasonNumber: number;
  totalEpisodes: number;
  latestAiredEpisode: number;
  qualityPreference: string;
  /** Tracked status; defaults to completed when fully aired, else active. */
  status?: SeasonStatus;
}

export interface BridgedSeasonResult {
  season: TrackedSeason;
  episodes: EpisodeState[];
}

export interface BridgedV2Result {
  status: WorkflowStatus;
  seasons: BridgedSeasonResult[];
  resourceSnapshots: ResourceSnapshot[];
  decisions: AgentDecision[];
  transferAttempts: TransferAttempt[];
  notification: NotificationEvent;
  notifications: NotificationEvent[];
  auditEvents: AuditEvent[];
}

export function bridgeV2WorkflowToResult(input: {
  title: MediaTitle;
  mode: V2BridgeMode;
  seasons: V2BridgeSeasonIntent[];
  v2: RunAcquisitionV2WorkflowResult;
  workflowRunId: string;
  now: () => string;
}): BridgedV2Result {
  const { title, v2, workflowRunId } = input;
  const obtainedSet = new Set(v2.obtained);
  const providerAheadSet = new Set(v2.providerAhead);
  const stillMissingSet = new Set(v2.stillMissing);

  const seasons: BridgedSeasonResult[] = input.seasons.map((intent) =>
    bridgeSeason({ title, intent, v2, obtainedSet, providerAheadSet }),
  );

  const status = resolveStatus({ missingBefore: v2.missingBefore, stillMissing: v2.stillMissing });

  // Newly obtained this run = was missing before, present now — per season.
  const newlyObtainedCodes = v2.missingBefore.filter((code) => !stillMissingSet.has(code));

  // 别甩锅: if nothing landed because transfers were systemically BLOCKED (115 云
  // 下载配额不足 / 登录过期 / 非 VIP), report an honest "转存失败:<原因>" instead of
  // "暂未找到资源" — the resource exists, the account is blocked.
  const transferBlock = classifyTransferBlock(v2.outcome.transferAttempts);
  const transferBlockReason = status === "no_coverage" && transferBlock ? transferBlock.reason : null;

  const notification = buildNotification({
    title,
    mode: input.mode,
    seasons,
    status,
    transferBlockReason,
    newlyObtainedCodes,
    workflowRunId,
    now: input.now,
    ...(v2.landedFileCount !== undefined && v2.landedBytes !== undefined
      ? { fileCount: v2.landedFileCount, totalBytes: v2.landedBytes }
      : {}),
  });

  return {
    status,
    seasons,
    resourceSnapshots: v2.outcome.resourceSnapshots,
    decisions: v2.outcome.decisions,
    transferAttempts: v2.outcome.transferAttempts,
    notification,
    notifications: [notification],
    auditEvents: v2.auditEvents,
  };
}

function bridgeSeason(input: {
  title: MediaTitle;
  intent: V2BridgeSeasonIntent;
  v2: RunAcquisitionV2WorkflowResult;
  obtainedSet: Set<string>;
  providerAheadSet: Set<string>;
}): BridgedSeasonResult {
  const { title, intent, v2, obtainedSet, providerAheadSet } = input;
  const trackedSeasonId = `${title.id}_s${intent.seasonNumber}`;

  const base = createEpisodeStates({
    trackedSeasonId,
    seasonNumber: intent.seasonNumber,
    totalEpisodes: intent.totalEpisodes,
    latestAiredEpisode: intent.latestAiredEpisode,
  });
  const episodes: EpisodeState[] = base.map((episode) => {
    const ahead = providerAheadSet.has(episode.episodeCode);
    const obtained = obtainedSet.has(episode.episodeCode) || ahead;
    if (!obtained) {
      return episode;
    }
    return {
      ...episode,
      obtained: true,
      ...(ahead ? { metadataStatus: "provider_ahead" as const } : {}),
    };
  });

  // Provider-ahead episodes beyond the season's episode count are real files
  // that aren't in the TMDB-derived range yet; surface them as obtained,
  // provider-ahead entries (parity with reconcileVerifiedFiles).
  const present = new Set(episodes.map((episode) => episode.episodeCode));
  const extraAhead = [...providerAheadSet]
    .filter((code) => episodePartsFromCode(code).seasonNumber === intent.seasonNumber && !present.has(code))
    .sort((a, b) => episodeNumberFromCode(a) - episodeNumberFromCode(b));
  for (const code of extraAhead) {
    episodes.push({
      trackedSeasonId,
      episodeCode: code,
      airDate: null,
      title: code,
      airStatus: "unknown",
      obtained: true,
      metadataStatus: "provider_ahead",
      verifiedFileIds: [],
    });
  }

  const fullyAired = intent.totalEpisodes > 0 && intent.latestAiredEpisode >= intent.totalEpisodes;
  const baseStatus: SeasonStatus = intent.status ?? (fullyAired ? "completed" : "active");
  // The finale graduation season-sync.ts promises ("only the finale — all
  // obtained — graduates it to completed"). Callers pass the persisted status
  // through, and this bridge is the only post-creation writer of it — so an
  // active season that is now fully aired AND fully obtained must graduate
  // HERE, or the patrol re-sweeps a finished show daily and the library keeps
  // 追更中 while the notification claims 不再追踪. A season with real aired
  // gaps stays active so the sweep keeps filling them; completed never reverts.
  const fullyObtained =
    fullyAired &&
    episodes.filter((episode) => episode.airStatus === "aired").every((episode) => episode.obtained) &&
    episodes.filter((episode) => episode.obtained).length >= intent.totalEpisodes;
  const status: SeasonStatus = baseStatus === "active" && fullyObtained ? "completed" : baseStatus;

  const season: TrackedSeason = {
    id: trackedSeasonId,
    mediaTitleId: title.id,
    seasonNumber: intent.seasonNumber,
    status,
    qualityPreference: intent.qualityPreference,
    storageDirectoryId: v2.directories.seasonDirectoryIds[intent.seasonNumber] ?? "",
    totalEpisodes: intent.totalEpisodes,
    latestAiredEpisode: intent.latestAiredEpisode,
    latestAiredSource: "metadata",
  };

  return { season, episodes };
}

/** Mirrors workflow.ts resolveAcquisitionStatus exactly. */
function resolveStatus(input: { missingBefore: string[]; stillMissing: string[] }): WorkflowStatus {
  if (input.stillMissing.length === 0) {
    return "succeeded";
  }
  if (input.stillMissing.length < input.missingBefore.length) {
    return "partial";
  }
  return "no_coverage";
}

function buildNotification(input: {
  title: MediaTitle;
  mode: V2BridgeMode;
  seasons: BridgedSeasonResult[];
  status: WorkflowStatus;
  /** Honest 转存失败 reason when transfers were systemically blocked (else null). */
  transferBlockReason?: string | null;
  newlyObtainedCodes: string[];
  workflowRunId: string;
  now: () => string;
  fileCount?: number;
  totalBytes?: number;
}): NotificationEvent {
  const { title, mode, seasons, status, workflowRunId } = input;
  const noCoverage = status === "no_coverage";
  const titleMeta = { posterPath: title.posterPath ?? null, tmdbId: title.tmdbId, mediaType: title.type, year: title.year };

  if (mode === "series") {
    const report = buildSeriesReport({
      titleName: title.title,
      seasons: seasons.map((entry) => ({ season: entry.season, episodes: entry.episodes })),
      noCoverage,
      transferBlockReason: input.transferBlockReason ?? null,
      meta: titleMeta,
      ...sizeInput(input),
    });
    return {
      id: `notification_${workflowRunId}`,
      workflowRunId,
      // A systemic transfer block surfaces as report.status "failed" → use a
      // distinct kind so the leading icon + daily-digest don't count it as 暂无资源.
      kind: report.status === "failed" ? "transfer_failed" : noCoverage ? "no_coverage" : "series_initialized",
      title: report.titleName,
      body: formatReportPushText(report),
      createdAt: input.now(),
      trigger: "user",
      report,
    };
  }

  // Single-season (type2 init or type3 patrol). Both render a season report; the
  // difference is the trigger and the kind framing.
  const entry = seasons[0]!;
  const newlyObtained = input.newlyObtainedCodes.filter(
    (code) => episodePartsFromCode(code).seasonNumber === entry.season.seasonNumber,
  );
  const report: NotificationReport = buildSeasonReport({
    titleName: title.title,
    season: entry.season,
    episodes: entry.episodes,
    newlyObtained,
    noCoverage,
    transferBlockReason: input.transferBlockReason ?? null,
    meta: titleMeta,
    ...sizeInput(input),
  });

  if (mode === "type3") {
    return {
      id: `notification_${workflowRunId}`,
      workflowRunId,
      kind:
        report.status === "failed"
          ? "transfer_failed"
          : noCoverage
            ? "no_coverage"
            : report.status === "complete"
              ? "tracking_completed"
              : // 例行巡检查过、追更中且本季无新增 = 无事发生：already_current 让
                // 通知页折叠成一张例行巡检卡、digest 归入「其余已是最新」，不再每日
                // 刷屏。airing 构造上保证 realMissing 为空（notification-report.ts
                // buildSeasonReport），有新增的 airing 必须保持 episodes_restored。
                report.status === "airing" && newlyObtained.length === 0
                ? "already_current"
                : "episodes_restored",
      title: `${report.titleName} ${report.seasonLabel}`,
      body: formatReportPushText(report),
      createdAt: input.now(),
      trigger: "scheduled",
      report,
    };
  }

  return {
    id: `notification_${workflowRunId}`,
    workflowRunId,
    kind: report.status === "failed" ? "transfer_failed" : noCoverage ? "no_coverage" : "tracking_initialized",
    title: `${report.titleName} ${report.seasonLabel}`,
    body: formatReportPushText(report),
    createdAt: input.now(),
    trigger: "user",
    report,
  };
}
