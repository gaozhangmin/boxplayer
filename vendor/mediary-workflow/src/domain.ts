/**
 * The implicit account that owns all data in a single-user (multi-user disabled)
 * deployment, and the fail-closed default everywhere an account is not explicitly
 * supplied. §7 multi-account scopes tracking data by account_id; single-user is
 * simply "one account, auto-logged-in" — there is no separate code path.
 */
export const DEFAULT_ACCOUNT_ID = "acct_default";

export type MediaType = "movie" | "tv" | "anime";
export type SeasonStatus = "active" | "completed";
export type LatestAiredSource = "metadata" | "manual" | "unknown";
export type AirStatus = "aired" | "unaired" | "unknown";
export type MetadataStatus = "confirmed" | "provider_ahead" | "storage_only";
export type WorkflowKind = "type1_package_init" | "type2_init" | "type3_monitor" | "movie_init";
export type WorkflowStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "partial"
  | "no_coverage"
  /** A reserved (未上映) movie: tracked so the daily patrol can collect it when it
   *  releases, but NOT queued/running — the worker never claims it and it is not an
   *  "active" run (see isActiveWorkflowStatus). The air-time gate runs the agent. */
  | "reserved";
export type ResourceType = "115" | "magnet" | "manual" | "quark" | "tianyi" | "123";
export type TransferStatus = "succeeded" | "failed" | "no_target_change";
export type Confidence = "low" | "medium" | "high";

export interface MediaTitle {
  id: string;
  tmdbId: number;
  type: MediaType;
  title: string;
  originalTitle: string;
  year: number;
  aliases: string[];
  /** TMDB origin_country (e.g. ["JP"], ["CN"]) — drives the per-media-type search
   *  recipe (searchProfile) for tv/anime, and lets the movie agent skip the 中文
   *  subtitle floor for 国产片 (CN-origin). Set for tv/anime AND movies (movie
   *  search itself stays origin-independent); absent only for demo titles. */
  originCountries?: string[];
  /** TMDB release date (YYYY-MM-DD) for a movie — the air-time gate for reserve:
   *  an unreleased film (date in the future) is reserved, not acquired, until it
   *  releases. Absent/null for TV and for movies TMDB has no date for. */
  releaseDate?: string | null;
  /** Scraped artwork/metadata — durable product state, read straight from the DB. */
  posterPath?: string | null;
  backdropPath?: string | null;
  overview?: string;
}

export interface TrackedSeason {
  id: string;
  mediaTitleId: string;
  seasonNumber: number;
  status: SeasonStatus;
  qualityPreference: string;
  storageDirectoryId: string;
  totalEpisodes: number;
  latestAiredEpisode: number;
  latestAiredSource: LatestAiredSource;
}

export interface EpisodeState {
  trackedSeasonId: string;
  episodeCode: string;
  airDate: string | null;
  title: string;
  airStatus: AirStatus;
  obtained: boolean;
  metadataStatus: MetadataStatus;
  verifiedFileIds: string[];
}

/** Live, cleaned agent progress written mid-run for the activity page's ticker +
 *  rough bar. Absent until the run starts producing work; `percent` is clamped
 *  monotonic on write. Not authoritative for anything — purely a display signal. */
export interface WorkflowRunProgress {
  /** Cleaned 中文 line of what the agent is doing now (no ids/paths). */
  activity: string;
  /** Coarse pipeline phase (AgentPhase): search/pick/transfer/verify/organize/mark/finalize. */
  phase: string;
  /** Rough 0–100 progress, phase-weighted + monotonic. */
  percent: number;
  updatedAt: string;
  /** Real sub-fraction headline when known (episodes obtained / needed this run). */
  obtained?: number;
  needed?: number;
}

export interface WorkflowRun {
  id: string;
  kind: WorkflowKind;
  status: WorkflowStatus;
  trackedSeasonId: string;
  startedAt: string;
  finishedAt: string | null;
  auditEvents: AuditEvent[];
  progress?: WorkflowRunProgress;
  /** Count of automatic retries already performed for a transient failure.
   *  Absent/0 = never auto-requeued. Capped at AUTO_REQUEUE_MAX. */
  autoRequeueCount?: number;
  /** Earliest ISO time the worker may re-claim this run. Set when auto-requeued
   *  (backoff); absent = immediately claimable. */
  nextAttemptAt?: string;
}

export interface AuditEvent {
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface ResourceCandidate {
  id: string;
  snapshotId: string;
  index: number;
  title: string;
  type: ResourceType;
  source: string;
  providerPayload: Record<string, unknown>;
}

export interface ResourceSnapshot {
  id: string;
  provider: string;
  keyword: string;
  candidates: ResourceCandidate[];
  createdAt: string;
}

export interface AgentDecision {
  node: string;
  snapshotId: string;
  selectedCandidateIds: string[];
  episodeMapping: Record<string, string[]>;
  providerAheadEpisodeMapping: Record<string, string[]>;
  rejectedCandidateIds: string[];
  confidence: Confidence;
  reason: string;
}

/**
 * One agent tool call, captured live (pre-execution) for post-mortem复盘. Appended
 * incrementally so a run that crashes or aborts on a 115 budget throw still leaves its trace behind.
 * `phase` mirrors AgentPhase in acquisition-v2/activity.ts (inlined here to avoid a
 * domain→acquisition-v2 dependency).
 */
export interface AgentStep {
  ordinal: number;
  toolName: string;
  args: Record<string, unknown>;
  activity: string;
  phase: "search" | "pick" | "transfer" | "verify" | "organize" | "mark" | "finalize";
  /** Cumulative 115 API calls before this step ran (real 115 runs only; omitted otherwise). */
  apiCalls?: number;
  at: string;
}

export type CandidateDispositionKind = "selected" | "rejected" | "uncertain";

export interface CandidateDisposition {
  candidateId: string;
  disposition: CandidateDispositionKind;
  /** Episode codes this candidate covers; required non-empty for "selected". */
  episodes: string[];
  reason: string;
}

export interface AcquisitionPlan {
  node: string;
  /** Snapshot id observed in this planning run, or null when nothing covers the need. */
  selectedSnapshotId: string | null;
  searchedKeywords: string[];
  candidateDispositions: CandidateDisposition[];
  confidence: Confidence;
  reason: string;
}

export interface AcquisitionFailureEvidence {
  candidateId: string;
  candidateTitle: string;
  transferStatus: TransferStatus;
  providerMessage: string;
  episodesStillMissing: string[];
}

export interface TransferAttempt {
  id: string;
  workflowRunId: string;
  candidateId: string;
  status: TransferStatus;
  providerMessage: string;
  materializedFileIds: string[];
}

export interface VerifiedFile {
  id: string;
  storageDirectoryId: string;
  name: string;
  sizeBytes: number;
  /**
   * The parsed episode code, or null for videos whose name exposes none (e.g.
   * movies). A file is a video by virtue of its media EXTENSION; the episode
   * code is optional metadata layered on top — TV coverage/dedup ignore nulls.
   */
  episodeCode: string | null;
  providerFileId: string;
}

/** Where a notification's run was triggered from — drives feed grouping. */
export type NotificationTrigger = "user" | "scheduled";

/**
 * Semantic state of an acquisition, surfaced to the user without the internal
 * Type 1/2/3 taxonomy. Crucially, `partial` means an AIRED episode is still
 * missing — unaired episodes never make a report look incomplete.
 */
export type NotificationReportStatus =
  | "complete" // completed series/season, fully obtained — graduated, no longer tracking
  | "acquired" // movie / one-off fully acquired
  | "airing" // still airing; obtained up to the latest aired episode, future auto-tracked
  | "partial" // a genuine aired gap remains
  | "no_coverage" // nothing found yet
  | "failed" // acquisition failed terminally (transient retries exhausted, or a hard error)
  | "retrying"; // transient failure; an automatic retry is scheduled

/**
 * Structured acquisition report. The single source of wording: the web feed
 * renders it as native UI (status pill + chips) and the push channels render it
 * as emoji text — both are pure functions of this object.
 */
export interface NotificationReport {
  titleName: string;
  /** "第 1 季" for a single season; null for a whole-series rollup or a movie. */
  seasonLabel: string | null;
  status: NotificationReportStatus;
  /** 1–2 concise summary lines, e.g. ["已获取至最新第 12 集 · 后续更新自动追踪"]. */
  lines: string[];
  /** Episodes obtained THIS run (the daily-sweep additions). */
  newlyObtained: string[];
  /** Aired-but-not-obtained genuine gaps. Never includes unaired episodes. */
  realMissing: string[];
  /** TMDB poster path (e.g. "/abc.jpg"); rendered as an image in rich pushes via
   *  the TMDB CDN — no self-hosting. Null/absent → no poster. */
  posterPath?: string | null;
  /** For the tap-through link `{webBaseUrl}/show/{tmdbId}` (only when a public
   *  base URL is configured). */
  tmdbId?: number;
  mediaType?: MediaType;
  /** Movie release year, shown in the title as "标题 (年份)". */
  year?: number;
  /** Optional landing facts, shown when readily available. */
  fileCount?: number;
  totalBytes?: number;
  landingDir?: string;
}

export interface NotificationEvent {
  id: string;
  workflowRunId: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
  /** Absent on legacy/foreign-work events; generators set it going forward. */
  trigger?: NotificationTrigger;
  report?: NotificationReport;
}

export function episodeCode(seasonNumber: number, episodeNumber: number): string {
  return `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
}

export function episodeNumberFromCode(code: string): number {
  const match = /^S\d{2}E(\d{2,})$/.exec(code);
  if (!match) {
    throw new Error(`Invalid episode code: ${code}`);
  }
  return Number(match[1]);
}

export function episodePartsFromCode(code: string): { seasonNumber: number; episodeNumber: number } {
  const match = /^S(\d{2,})E(\d{2,})$/.exec(code);
  if (!match) {
    throw new Error(`Invalid episode code: ${code}`);
  }
  return {
    seasonNumber: Number(match[1]),
    episodeNumber: Number(match[2]),
  };
}

/**
 * A movie persists as a degenerate single-"episode" season anchor so it reuses
 * the whole tracked-season machinery (repository, library wall, notifications)
 * with no parallel type system. The user never sees the anchor — only "已入库".
 * status is `completed` (no monitoring) and there is no real airing concept.
 */
/**
 * The reserve air-time gate. A movie is "unreleased" (→ reserve, don't run the
 * agent yet) only when it has a release date still in the FUTURE relative to now.
 * Missing/empty/null date → released (we never gate on the unknown; the patrol's
 * no_coverage retry already covers 已上映无源). Compared by calendar date
 * (YYYY-MM-DD lexicographic), so the day it releases it counts as released.
 */
export function isMovieUnreleased(releaseDate: string | null | undefined, now: string): boolean {
  if (!releaseDate) {
    return false;
  }
  const release = releaseDate.slice(0, 10);
  const today = now.slice(0, 10);
  return release > today;
}

export function movieAnchorSeason(input: {
  titleId: string;
  qualityPreference: string;
  storageDirectoryId: string;
}): TrackedSeason {
  return {
    id: `${input.titleId}_movie`,
    mediaTitleId: input.titleId,
    seasonNumber: 1,
    status: "completed",
    qualityPreference: input.qualityPreference,
    storageDirectoryId: input.storageDirectoryId,
    totalEpisodes: 1,
    latestAiredEpisode: 1,
    latestAiredSource: "manual",
  };
}

export function createEpisodeStates(input: {
  trackedSeasonId: string;
  seasonNumber: number;
  totalEpisodes: number;
  latestAiredEpisode: number;
}): EpisodeState[] {
  return Array.from({ length: input.totalEpisodes }, (_, index) => {
    const episodeNumber = index + 1;
    return {
      trackedSeasonId: input.trackedSeasonId,
      episodeCode: episodeCode(input.seasonNumber, episodeNumber),
      airDate: null,
      title: `Episode ${episodeNumber}`,
      airStatus: episodeNumber <= input.latestAiredEpisode ? "aired" : "unaired",
      obtained: false,
      metadataStatus: "confirmed",
      verifiedFileIds: [],
    };
  });
}

export function reconcileVerifiedFiles(input: {
  season: TrackedSeason;
  episodes: EpisodeState[];
  files: VerifiedFile[];
}): EpisodeState[] {
  const byCode = new Map(input.episodes.map((episode) => [episode.episodeCode, { ...episode }]));

  for (const file of input.files) {
    if (file.storageDirectoryId !== input.season.storageDirectoryId) {
      continue;
    }
    // Episode-less videos (movies, unparsed names) are real files but cannot map
    // to a TV episode — coverage tracking ignores them.
    if (file.episodeCode === null) {
      continue;
    }

    const existing = byCode.get(file.episodeCode);
    const episodeNumber = episodeNumberFromCode(file.episodeCode);
    const metadataStatus: MetadataStatus =
      existing?.metadataStatus ?? (episodeNumber > input.season.latestAiredEpisode ? "provider_ahead" : "storage_only");
    const next: EpisodeState = existing ?? {
      trackedSeasonId: input.season.id,
      episodeCode: file.episodeCode,
      airDate: null,
      title: file.episodeCode,
      airStatus: episodeNumber <= input.season.latestAiredEpisode ? "aired" : "unknown",
      obtained: false,
      metadataStatus,
      verifiedFileIds: [],
    };

    byCode.set(file.episodeCode, {
      ...next,
      obtained: true,
      metadataStatus: episodeNumber > input.season.latestAiredEpisode ? "provider_ahead" : next.metadataStatus,
      verifiedFileIds: Array.from(new Set([...next.verifiedFileIds, file.id])),
    });
  }

  return Array.from(byCode.values()).sort((a, b) => {
    const aParts = episodePartsFromCode(a.episodeCode);
    const bParts = episodePartsFromCode(b.episodeCode);
    return aParts.seasonNumber - bParts.seasonNumber || aParts.episodeNumber - bParts.episodeNumber;
  });
}

/**
 * Per-season acquisition scope (which seasons, and how much of each, are in
 * play for a series/title-level acquisition). Relocated from the retired
 * pre-V2 `workflow.ts`; consumed by the V2 runner, queue commands, and worker.
 */
export interface AcquisitionSeasonScope {
  seasonNumber: number;
  totalEpisodes: number;
  latestAiredEpisode: number;
}

/** A file in a (recursively listed) provider package tree: path + handle + size. */
export interface PackageTreeFile {
  path: string;
  providerFileId: string;
  sizeBytes: number;
}

/** Identity + lifecycle timestamps a runner threads through a persisted workflow run. */
export interface WorkflowRunMetadata {
  id: string;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * Facts produced by a movie acquisition run. Relocated from the retired
 * pre-V2 `movie-workflow.ts`; the V2 movie path (`movie-workflow-v2.ts`,
 * `runner-v2.ts`) emits exactly this shape so runner/web/UI are unchanged.
 */
export interface MovieWorkflowResult {
  status: WorkflowStatus;
  title: MediaTitle;
  season: TrackedSeason;
  episodes: EpisodeState[];
  resourceSnapshots: ResourceSnapshot[];
  transferAttempts: TransferAttempt[];
  decisions: AgentDecision[];
  notification: NotificationEvent;
  notifications: NotificationEvent[];
  auditEvents: AuditEvent[];
}
