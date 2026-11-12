import {
  createEpisodeStates,
  movieAnchorSeason,
  type AcquisitionSeasonScope,
  type EpisodeState,
  type MediaTitle,
  type NotificationEvent,
  type TrackedSeason,
  type WorkflowStatus,
} from "./domain.js";
import type { StorageExecutor } from "./ports.js";
import type { WorkflowRepository } from "./repository.js";

export type TrackingInitializationRequestStatus = "already_running" | "already_tracked" | "queued" | "completed";

export interface EpisodeProgressSummary {
  totalEpisodes: number;
  latestAiredEpisode: number;
  obtainedEpisodes: string[];
  providerAheadEpisodes: string[];
  missingAiredEpisodes: string[];
}

export interface TrackingInitializationRequestResult {
  status: TrackingInitializationRequestStatus;
  titleId: string;
  trackedSeasonId: string;
  workflowRunId: string | null;
  workflowStatus: WorkflowStatus | null;
  notification: NotificationEvent | null;
  progress: EpisodeProgressSummary;
}

export async function queueTrackingInitialization(input: {
  title: MediaTitle;
  season: TrackedSeason;
  keyword: string;
  repository: WorkflowRepository;
  /** Owning account (§7). Omitted → default account (single-user). */
  accountId?: string;
  /** Owning connected storage (tree model). Omitted → null (single-drive). */
  connectedStorageId?: string | null;
  createWorkflowRunId?: () => string;
  now?: () => string;
  staleActiveRunTimeoutMs?: number;
}): Promise<TrackingInitializationRequestResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const workflowRunId = input.createWorkflowRunId?.() ?? crypto.randomUUID();
  const queuedAt = now();
  const staleActiveRunStartedBefore = staleStartedBefore(queuedAt, input.staleActiveRunTimeoutMs);
  const initialEpisodes = createEpisodeStates({
    trackedSeasonId: input.season.id,
    seasonNumber: input.season.seasonNumber,
    totalEpisodes: input.season.totalEpisodes,
    latestAiredEpisode: input.season.latestAiredEpisode,
  });

  const reservation = await input.repository.reserveWorkflowRun({
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.connectedStorageId != null ? { connectedStorageId: input.connectedStorageId } : {}),
    title: input.title,
    season: input.season,
    workflowRun: {
      id: workflowRunId,
      kind: "type2_init",
      status: "queued",
      trackedSeasonId: input.season.id,
      startedAt: queuedAt,
      finishedAt: null,
      auditEvents: [
        {
          type: "workflow_reserved",
          message: `Reserved tracking initialization workflow ${workflowRunId}`,
        },
        {
          type: "tracking_request_queued",
          message: `Queued tracking initialization workflow ${workflowRunId}`,
          data: { keyword: input.keyword },
        },
      ],
    },
    episodes: initialEpisodes,
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications: [],
    blockIfEpisodeStatesExist: true,
    blockIfTitleHasActiveRun: true,
    ...(staleActiveRunStartedBefore
      ? {
          staleActiveRunStartedBefore,
          staleFinishedAt: queuedAt,
        }
      : {}),
  });

  if (reservation.status === "already_active") {
    return {
      status: "already_running",
      titleId: input.title.id,
      trackedSeasonId: input.season.id,
      workflowRunId: reservation.snapshot.workflowRun.id,
      workflowStatus: reservation.snapshot.workflowRun.status,
      notification: reservation.snapshot.notifications[0] ?? null,
      progress: summarizeEpisodeProgress(input.season, reservation.snapshot.episodes),
    };
  }
  if (reservation.status === "already_has_episode_state") {
    return {
      status: "already_tracked",
      titleId: input.title.id,
      trackedSeasonId: input.season.id,
      workflowRunId: null,
      workflowStatus: null,
      notification: null,
      progress: summarizeEpisodeProgress(input.season, reservation.episodes),
    };
  }

  return {
    status: "queued",
    titleId: input.title.id,
    trackedSeasonId: input.season.id,
    workflowRunId,
    workflowStatus: "queued",
    notification: null,
    progress: summarizeEpisodeProgress(input.season, initialEpisodes),
  };
}

function staleStartedBefore(nowIso: string, timeoutMs: number | undefined): string | null {
  if (timeoutMs === undefined) {
    return null;
  }
  if (timeoutMs <= 0) {
    throw new Error("staleActiveRunTimeoutMs must be positive");
  }
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) {
    throw new Error(`now() must return an ISO timestamp when stale recovery is enabled: ${nowIso}`);
  }
  return new Date(nowMs - timeoutMs).toISOString();
}

function summarizeEpisodeProgress(season: TrackedSeason, episodes: EpisodeState[]): EpisodeProgressSummary {
  return {
    totalEpisodes: season.totalEpisodes,
    latestAiredEpisode: season.latestAiredEpisode,
    obtainedEpisodes: episodes
      .filter((episode) => episode.obtained)
      .map((episode) => episode.episodeCode),
    providerAheadEpisodes: episodes
      .filter((episode) => episode.obtained && episode.metadataStatus === "provider_ahead")
      .map((episode) => episode.episodeCode),
    missingAiredEpisodes: episodes
      .filter((episode) => episode.airStatus === "aired" && !episode.obtained)
      .map((episode) => episode.episodeCode),
  };
}

export interface SeriesInitializationRequestResult {
  status: "queued" | "already_running" | "already_tracked";
  titleId: string;
  workflowRunId: string | null;
}

/**
 * "获取全剧" entrypoint. Reserves one queued type1_package_init run keyed on
 * season 1 (idempotency lock for the whole title) carrying the series need
 * set in its audit data; the worker claims it and runs title-level
 * initialization for every season.
 */
export async function queueSeriesInitialization(input: {
  title: MediaTitle;
  seasons: AcquisitionSeasonScope[];
  keyword: string;
  repository: WorkflowRepository;
  /** Owning account (§7). Omitted → default account (single-user). */
  accountId?: string;
  /** Owning connected storage (tree model). Omitted → null (single-drive). */
  connectedStorageId?: string | null;
  createWorkflowRunId?: () => string;
  now?: () => string;
  staleActiveRunTimeoutMs?: number;
}): Promise<SeriesInitializationRequestResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const workflowRunId = input.createWorkflowRunId?.() ?? crypto.randomUUID();
  const queuedAt = now();
  const staleActiveRunStartedBefore = staleStartedBefore(queuedAt, input.staleActiveRunTimeoutMs);
  const firstSeason = input.seasons[0];
  if (firstSeason === undefined) {
    throw new Error("Series initialization needs at least one season");
  }
  const lockSeason: TrackedSeason = {
    id: `${input.title.id}_s${firstSeason.seasonNumber}`,
    mediaTitleId: input.title.id,
    seasonNumber: firstSeason.seasonNumber,
    status: firstSeason.latestAiredEpisode >= firstSeason.totalEpisodes ? "completed" : "active",
    qualityPreference: "4K",
    storageDirectoryId: "",
    totalEpisodes: firstSeason.totalEpisodes,
    latestAiredEpisode: firstSeason.latestAiredEpisode,
    latestAiredSource: "metadata",
  };

  const reservation = await input.repository.reserveWorkflowRun({
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.connectedStorageId != null ? { connectedStorageId: input.connectedStorageId } : {}),
    title: input.title,
    season: lockSeason,
    workflowRun: {
      id: workflowRunId,
      kind: "type1_package_init",
      status: "queued",
      trackedSeasonId: lockSeason.id,
      startedAt: queuedAt,
      finishedAt: null,
      auditEvents: [
        {
          type: "series_init_queued",
          message: `Queued series initialization workflow ${workflowRunId}`,
          data: { keyword: input.keyword, seasons: input.seasons },
        },
      ],
    },
    episodes: [],
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications: [],
    blockIfEpisodeStatesExist: true,
    blockIfTitleHasActiveRun: true,
    ...(staleActiveRunStartedBefore
      ? { staleActiveRunStartedBefore, staleFinishedAt: queuedAt }
      : {}),
  });
  if (reservation.status === "already_active") {
    return {
      status: "already_running",
      titleId: input.title.id,
      workflowRunId: reservation.snapshot.workflowRun.id,
    };
  }
  if (reservation.status === "already_has_episode_state") {
    return { status: "already_tracked", titleId: input.title.id, workflowRunId: null };
  }
  return { status: "queued", titleId: input.title.id, workflowRunId };
}

export interface MovieAcquisitionRequestResult {
  status: "queued" | "already_running" | "already_tracked";
  titleId: string;
  workflowRunId: string | null;
}

/**
 * "获取电影" entrypoint. Reserves one queued movie_init run on the movie's
 * single-season anchor (title lock prevents overlapping acquisitions of the
 * same film); the worker claims it and runs the movie acquisition workflow.
 */
export async function queueMovieAcquisition(input: {
  title: MediaTitle;
  keyword: string;
  repository: WorkflowRepository;
  /** Owning account (§7). Omitted → default account (single-user). */
  accountId?: string;
  /** Owning connected storage (tree model). Omitted → null (single-drive). */
  connectedStorageId?: string | null;
  createWorkflowRunId?: () => string;
  now?: () => string;
  staleActiveRunTimeoutMs?: number;
}): Promise<MovieAcquisitionRequestResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const workflowRunId = input.createWorkflowRunId?.() ?? crypto.randomUUID();
  const queuedAt = now();
  const staleActiveRunStartedBefore = staleStartedBefore(queuedAt, input.staleActiveRunTimeoutMs);
  const season = movieAnchorSeason({
    titleId: input.title.id,
    qualityPreference: "4K",
    storageDirectoryId: "",
  });

  const reservation = await input.repository.reserveWorkflowRun({
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.connectedStorageId != null ? { connectedStorageId: input.connectedStorageId } : {}),
    title: input.title,
    season,
    workflowRun: {
      id: workflowRunId,
      kind: "movie_init",
      status: "queued",
      trackedSeasonId: season.id,
      startedAt: queuedAt,
      finishedAt: null,
      auditEvents: [
        {
          type: "movie_init_queued",
          message: `Queued movie acquisition workflow ${workflowRunId}`,
          data: { keyword: input.keyword },
        },
      ],
    },
    episodes: [],
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications: [],
    blockIfEpisodeStatesExist: true,
    blockIfTitleHasActiveRun: true,
    ...(staleActiveRunStartedBefore
      ? { staleActiveRunStartedBefore, staleFinishedAt: queuedAt }
      : {}),
  });
  if (reservation.status === "already_active") {
    return { status: "already_running", titleId: input.title.id, workflowRunId: reservation.snapshot.workflowRun.id };
  }
  if (reservation.status === "already_has_episode_state") {
    return { status: "already_tracked", titleId: input.title.id, workflowRunId: null };
  }
  return { status: "queued", titleId: input.title.id, workflowRunId };
}

export interface MovieReservationResult {
  status: "reserved" | "already_running" | "already_tracked";
  titleId: string;
  workflowRunId: string | null;
}

/**
 * "预定电影" entrypoint for an UNRELEASED film. Tracks the movie (title + anchor,
 * carrying its release date) under a `reserved` run that the worker NEVER claims
 * and that is not an active run — so the acquisition agent does NOT run before
 * release. The daily patrol's air-time gate (isMovieUnreleased) runs the MOVIE
 * agent once the release date arrives ("点预定 → 上映后巡检自然收"). Idempotent:
 * already-tracked (reserved or acquired) and already-acquiring are no-ops.
 */
export async function reserveMovie(input: {
  title: MediaTitle;
  repository: WorkflowRepository;
  /** Owning account (§7). Omitted → default account (single-user). */
  accountId?: string;
  /** Owning connected storage (tree model). Omitted → null (single-drive). */
  connectedStorageId?: string | null;
  createWorkflowRunId?: () => string;
  now?: () => string;
}): Promise<MovieReservationResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const workflowRunId = input.createWorkflowRunId?.() ?? crypto.randomUUID();
  const reservedAt = now();
  const season = movieAnchorSeason({
    titleId: input.title.id,
    qualityPreference: "4K",
    storageDirectoryId: "",
  });
  // A single unaired, unobtained anchor episode — so the title reads as TRACKED
  // (not re-requestable) and the patrol/UI can tell reserved from acquired.
  const episodes = createEpisodeStates({
    trackedSeasonId: season.id,
    seasonNumber: 1,
    totalEpisodes: 1,
    latestAiredEpisode: 0,
  });

  const reservation = await input.repository.reserveWorkflowRun({
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.connectedStorageId != null ? { connectedStorageId: input.connectedStorageId } : {}),
    title: input.title,
    season,
    workflowRun: {
      id: workflowRunId,
      kind: "movie_init",
      status: "reserved",
      trackedSeasonId: season.id,
      startedAt: reservedAt,
      finishedAt: null,
      auditEvents: [
        {
          type: "movie_reserved",
          message: `Reserved unreleased movie ${workflowRunId}`,
          data: { releaseDate: input.title.releaseDate ?? null },
        },
      ],
    },
    episodes,
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications: [],
    blockIfEpisodeStatesExist: true,
    blockIfTitleHasActiveRun: true,
  });
  if (reservation.status === "already_active") {
    return { status: "already_running", titleId: input.title.id, workflowRunId: reservation.snapshot.workflowRun.id };
  }
  if (reservation.status === "already_has_episode_state") {
    return { status: "already_tracked", titleId: input.title.id, workflowRunId: null };
  }
  return { status: "reserved", titleId: input.title.id, workflowRunId };
}

export interface ForeignWorkImportResult {
  movieDirectoryId: string;
  movedFileIds: string[];
}

/**
 * User-confirmed import of foreign-work files quarantined in staging. The
 * recognition agent only FLAGS a file as belonging to a different title;
 * naming the destination and pulling the trigger is the user's decision.
 * Deterministic execution: find-or-create `Title (Year)` under the movies
 * parent and move the files in. The video's ORIGINAL name is kept untouched —
 * the identity is the `Title (Year)` wrapper directory, not the filename, so
 * there is no need to rename (and renaming only invites `(1)` collisions).
 */
export async function importForeignWorkAsMovie(input: {
  storage: StorageExecutor;
  providerFileIds: string[];
  movieTitle: string;
  year: number;
  moviesParentDirectoryId: string;
}): Promise<ForeignWorkImportResult> {
  if (input.providerFileIds.length === 0) {
    throw new Error("FOREIGN_WORK_IMPORT_EMPTY: no files to import");
  }
  const movieName = `${input.movieTitle} (${input.year})`;
  const movieDirectoryId = await input.storage.createDirectory({
    name: movieName,
    parentId: input.moviesParentDirectoryId,
  });
  const { moved } = await input.storage.moveFiles({
    fileIds: input.providerFileIds,
    targetDirectoryId: movieDirectoryId,
  });
  if (moved.length === 0) {
    throw new Error("FOREIGN_WORK_IMPORT_NOTHING_MOVED: none of the requested files could be moved");
  }

  return { movieDirectoryId, movedFileIds: moved };
}
