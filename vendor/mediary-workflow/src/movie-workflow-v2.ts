import type { LanguageModel } from "ai";
import {
  createEpisodeStates,
  movieAnchorSeason,
  type AgentDecision,
  type AuditEvent,
  type EpisodeState,
  type MediaTitle,
  type MovieWorkflowResult,
  type NotificationEvent,
  type ResourceSnapshot,
  type TrackedSeason,
  type TransferAttempt,
  type WorkflowStatus,
} from "./domain.js";
import { buildMovieReport, emptyRunOutcome, formatReportPushText } from "./notification-report.js";
import { classifyTransferBlock } from "./acquisition-v2/transfer-block.js";
import type { ResourceProvider, StorageExecutor } from "./ports.js";
import type { DeadLinkStore } from "./acquisition-v2/dead-links.js";
import { readLandedSize, type LandedSize } from "./acquisition-v2/landed-size.js";
import type { AgentToolEvent } from "./acquisition-v2/activity.js";
import { runAcquisitionV2 } from "./acquisition-v2/orchestrator.js";
import { getQualityGuidance, getSearchRecipe } from "./acquisition-v2/search-profile.js";

function defaultNowIso(): string {
  return new Date().toISOString();
}

/**
 * Phase 7d — movie acquisition on the V2 engine. Same effect as the old
 * runMovieAcquisition (verify-or-create Movies/Title (Year), agent confirms the
 * one film and transfers it, mark, clean staging) but the semantic loop is the
 * strong movie task agent inside the sandbox. Produces the existing
 * MovieWorkflowResult so runner/web/UI are unchanged.
 */
export interface RunMovieAcquisitionV2Request {
  title: MediaTitle;
  resourceProvider: ResourceProvider;
  storage: StorageExecutor;
  model: LanguageModel;
  workflowRunId: string;
  moviesParentDirectoryId: string;
  searchBudget?: number;
  maxSteps?: number;
  preferredLanguage?: string;
  /** Global quality preference ("high"/"medium"); undefined = 不限 (no guidance). */
  qualityPreference?: "high" | "medium";
  /** The run's drive brand ("pan115" | "quark") — selects brand-specific skill. */
  storageProvider?: string;
  /** assrt token (Settings → 字幕来源). Undefined = 字幕流程不触发。 */
  assrtToken?: string;
  deadLinkStore?: DeadLinkStore;
  onProgress?: (event: AgentToolEvent) => void;
  now?: () => string;
}

export async function runMovieAcquisitionV2(
  request: RunMovieAcquisitionV2Request,
): Promise<MovieWorkflowResult> {
  const now = request.now ?? defaultNowIso;

  // verify-or-create Movies/Title (Year). For a movie this dir IS the staging,
  // the flatten target, and the final location — there is NO separate staging
  // (§5): transfer lands here, the wrapper is flattened in place, mark. So
  // stagingDirectoryId === targetMovieDirectoryId === the movie dir.
  const movieDirectoryId = await request.storage.createDirectory({
    name: `${request.title.title} (${request.title.year ?? "—"})`,
    parentId: request.moviesParentDirectoryId,
  });

  const v2 = await runAcquisitionV2({
    provider: request.resourceProvider,
    executor: request.storage,
    model: request.model,
    workflowRunId: request.workflowRunId,
    target: {
      kind: "movie",
      title: request.title.title,
      aliases: request.title.aliases,
      year: request.title.year ?? 0,
      qualityPreference: "4K",
    },
    stagingDirectoryId: movieDirectoryId,
    targetMovieDirectoryId: movieDirectoryId,
    searchHints: getSearchRecipe("movie"), // movie search is origin-independent
    searchProfile: "movie",
    ...(getQualityGuidance("movie", request.qualityPreference) === ""
      ? {}
      : { qualityGuidance: getQualityGuidance("movie", request.qualityPreference) }),
    ...(request.searchBudget === undefined ? {} : { searchBudget: request.searchBudget }),
    ...(request.maxSteps === undefined ? {} : { maxSteps: request.maxSteps }),
    ...(request.preferredLanguage === undefined ? {} : { preferredLanguage: request.preferredLanguage }),
    // 国产片(CN origin)→ 电影 prompt 跳过中文字幕 floor(原生中文对白,无中字可寻)。
    ...(request.title.originCountries === undefined ? {} : { originCountries: request.title.originCountries }),
    ...(request.storageProvider === undefined ? {} : { storageProvider: request.storageProvider }),
    ...(request.assrtToken === undefined ? {} : { assrtToken: request.assrtToken }),
    ...(request.deadLinkStore ? { deadLinkStore: request.deadLinkStore } : {}),
    ...(request.onProgress ? { onProgress: request.onProgress } : {}),
  });

  // Truth = the AGENT'S coverage (its markObtained), NOT a mechanical file scan
  // (§1.13/§7b). The agent looked at the real files and declared coverage; the
  // workflow records that, it does not re-derive obtained by counting files.
  const obtained = v2.coverage.coverageMet;

  // Real landed volume for the push (best-effort; never fails the run). The
  // movie dir IS the staging+final location, so its video file(s) are the film.
  const landed = obtained ? await readLandedSize(request.storage, [movieDirectoryId]) : undefined;

  return buildResult({
    request,
    movieDirectoryId,
    obtained,
    status: obtained ? "succeeded" : "no_coverage",
    kind: obtained ? "movie_init" : "no_coverage",
    snapshots: v2.outcome.resourceSnapshots,
    attempts: v2.outcome.transferAttempts,
    decisions: v2.outcome.decisions,
    auditEvents: v2.auditEvents,
    // 中文字幕软兜底: the agent landed a raw match with no confirmed 中字 → flag it.
    subtitleFallback: obtained && v2.coverage.subtitleFallback,
    ...(landed ? { landed } : {}),
    now,
  });
}

function buildResult(input: {
  request: RunMovieAcquisitionV2Request;
  movieDirectoryId: string;
  obtained: boolean;
  status: WorkflowStatus;
  kind: string;
  snapshots: ResourceSnapshot[];
  attempts: TransferAttempt[];
  decisions: AgentDecision[];
  auditEvents: AuditEvent[];
  /** Landed via the 中文字幕 last-resort fallback (no confirmed 中字) → notification flag. */
  subtitleFallback?: boolean;
  landed?: LandedSize;
  now: () => string;
}): MovieWorkflowResult {
  const season: TrackedSeason = movieAnchorSeason({
    titleId: input.request.title.id,
    qualityPreference: "4K",
    storageDirectoryId: input.movieDirectoryId,
  });
  const episodes: EpisodeState[] = createEpisodeStates({
    trackedSeasonId: season.id,
    seasonNumber: 1,
    totalEpisodes: 1,
    latestAiredEpisode: 1,
  }).map((episode) => ({ ...episode, obtained: input.obtained }));

  const t = input.request.title;
  const baseReport = buildMovieReport(
    t.title,
    { posterPath: t.posterPath ?? null, tmdbId: t.tmdbId, mediaType: t.type, year: t.year },
    input.landed,
    input.subtitleFallback ?? false,
  );
  // 别甩锅: nothing landed could mean truly no resource (no_coverage) OR the
  // account was systemically blocked (115 云下载配额不足/登录过期) — say which.
  const report = input.obtained
    ? baseReport
    : { ...baseReport, ...emptyRunOutcome(classifyTransferBlock(input.attempts)?.reason ?? null) };
  const notification: NotificationEvent = {
    id: `notification_${input.request.workflowRunId}`,
    workflowRunId: input.request.workflowRunId,
    // A systemic transfer block → report.status "failed" → distinct kind so the
    // leading icon + daily-digest don't count it as 暂无资源.
    kind: report.status === "failed" ? "transfer_failed" : input.kind,
    title: input.request.title.title,
    body: formatReportPushText(report),
    createdAt: input.now(),
    trigger: "user",
    report,
  };

  return {
    status: input.status,
    title: input.request.title,
    season,
    episodes,
    resourceSnapshots: input.snapshots,
    transferAttempts: input.attempts,
    decisions: input.decisions,
    notification,
    notifications: [notification],
    auditEvents: input.auditEvents,
  };
}
