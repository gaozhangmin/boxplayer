import { isMovieUnreleased } from "./domain.js";
import type { EpisodeState, MediaType, TrackedSeason, WorkflowKind } from "./domain.js";
import type { WorkflowRepository } from "./repository.js";
import { normalizeScope, type ScopeArg } from "./workflow-scope.js";

export type SearchPageState = "empty" | "ready" | "provider_error";
export type SearchCacheStatus = "none" | "hit" | "miss";
export type SearchActionState =
  | "can_request"
  | "already_tracked"
  | "active_workflow"
  /** An unreleased movie: offer 预定 (reserve) instead of 获取 (acquire). */
  | "can_reserve"
  /** A reserved unreleased movie already tracked, waiting for its release. */
  | "reserved";

export interface MediaSearchSeason {
  seasonNumber: number;
  episodeCount: number;
  latestAiredEpisode: number;
}

export interface MediaSearchCandidate {
  tmdbId: number;
  mediaType: Extract<MediaType, "movie" | "tv">;
  title: string;
  originalTitle: string;
  year: number;
  /** Movie release date (YYYY-MM-DD) — gates 预定 (reserve) vs 获取 (acquire). */
  releaseDate?: string | null;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  seasons: MediaSearchSeason[];
}

export interface MediaSearchProvider {
  searchMedia(input: { query: string }): Promise<MediaSearchCandidate[]>;
}

export interface MediaSearchCache {
  get(query: string): Promise<MediaSearchCandidate[] | null>;
  set(query: string, candidates: MediaSearchCandidate[]): Promise<void>;
}

export interface SearchCandidateAction {
  state: SearchActionState;
  label: string;
  disabled: boolean;
  workflowRunId: string | null;
}

export interface SearchCandidateCard {
  id: string;
  tmdbId: number;
  mediaType: MediaSearchCandidate["mediaType"];
  title: string;
  originalTitle: string;
  year: number;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  selectedSeasonNumber: number | null;
  totalEpisodes: number | null;
  latestAiredEpisode: number | null;
  /** All known seasons of the title (tv), for per-season request entries. */
  seasonNumbers: number[];
  action: SearchCandidateAction;
}

export interface SearchPageView {
  query: string;
  state: SearchPageState;
  cacheStatus: SearchCacheStatus;
  candidates: SearchCandidateCard[];
  /** Only when state === "provider_error": the underlying provider failure, for
   *  a diagnostic line in the UI and the reporter's issue. */
  providerError?: string;
}

export class InMemoryMediaSearchCache implements MediaSearchCache {
  private readonly values = new Map<string, MediaSearchCandidate[]>();

  async get(query: string): Promise<MediaSearchCandidate[] | null> {
    const value = this.values.get(normalizeSearchQuery(query));
    return value ? structuredClone(value) : null;
  }

  async set(query: string, candidates: MediaSearchCandidate[]): Promise<void> {
    this.values.set(normalizeSearchQuery(query), structuredClone(candidates));
  }
}

export async function getSearchPageView(input: {
  query: string;
  provider: MediaSearchProvider;
  cache: MediaSearchCache;
  repository: WorkflowRepository;
  /** Clock for the movie reserve air-time gate (预定 vs 获取). */
  now?: () => string;
  /** Tree model: the active workspace (account, drive). A movie's 已获取/获取
   *  state is per-drive — obtained on drive A must still be 获取-able on drive B.
   *  Undefined = account-wide (legacy / single-drive). */
  scope?: ScopeArg;
}): Promise<SearchPageView> {
  const now = input.now ?? (() => new Date().toISOString());
  const query = normalizeSearchQuery(input.query);
  if (!query) {
    return {
      query,
      state: "empty",
      cacheStatus: "none",
      candidates: [],
    };
  }

  const cached = await input.cache.get(query);
  let candidates = cached;
  if (!candidates) {
    // A deployment that cannot reach ANY TMDB access (GFW-blocked network: direct
    // API and the workers.dev proxy both dead — issue #134) makes the provider
    // throw. Degrade to a dedicated view state instead of crashing the page, and
    // do NOT cache the failure so the next search retries.
    try {
      candidates = await input.provider.searchMedia({ query });
    } catch (error) {
      return {
        query,
        state: "provider_error",
        cacheStatus: "miss",
        candidates: [],
        providerError: describeError(error),
      };
    }
    await input.cache.set(query, candidates);
  }

  return {
    query,
    state: "ready",
    cacheStatus: cached ? "hit" : "miss",
    candidates: await Promise.all(
      candidates.map((candidate) => toCandidateCard(candidate, input.repository, now(), input.scope)),
    ),
  };
}

function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

/** The diagnostic line must stay readable for ANY throw shape: bare String()
 *  renders non-Error objects as "[object Object]". */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

async function toCandidateCard(
  candidate: MediaSearchCandidate,
  repository: WorkflowRepository,
  now: string,
  scope?: ScopeArg,
): Promise<SearchCandidateCard> {
  // The search card is SEASON-AGNOSTIC for a TV show: it never pre-picks a
  // season. The user chooses one (or all remaining) via SeasonRequestMenu, and
  // that choice — not a card default — flows to the agent and the canonical
  // `Season N` landing dir. Per-season tracked state is surfaced by the UI from
  // listTrackedSeasonStates, so the card carries no season-specific identity,
  // counts, or action (those were vestigial and misleading for multi-season
  // shows). A movie is the only single-anchor case whose card-level action
  // gates its one button.
  return {
    id: mediaTitleId(candidate.mediaType, candidate.tmdbId),
    tmdbId: candidate.tmdbId,
    mediaType: candidate.mediaType,
    title: candidate.title,
    originalTitle: candidate.originalTitle,
    year: candidate.year,
    overview: candidate.overview,
    posterPath: candidate.posterPath,
    backdropPath: candidate.backdropPath,
    selectedSeasonNumber: null,
    totalEpisodes: null,
    latestAiredEpisode: null,
    seasonNumbers:
      candidate.mediaType === "tv"
        ? candidate.seasons.map((season) => season.seasonNumber).sort((a, b) => a - b)
        : [],
    action:
      candidate.mediaType === "movie"
        ? // A movie tracks as a degenerate one-"episode" anchor season; once it
          // is acquired (or acquiring) it must NOT be re-requestable in search.
          // An UNRELEASED film offers 预定 (reserve) instead of 获取 (acquire).
          await actionForTrackedSeason(
            repository,
            movieTrackedSeasonId(candidate.tmdbId),
            "movie_init",
            { releaseDate: candidate.releaseDate, now },
            scope,
          )
        : canRequestAction(),
  };
}

async function actionForTrackedSeason(
  repository: WorkflowRepository,
  trackedSeasonIdValue: string,
  kind: WorkflowKind,
  // Movie reserve air-time gate: an unreleased film offers 预定 instead of 获取.
  reserveGate?: { releaseDate: string | null | undefined; now: string },
  // Tree model: scope the obtained/active-run check to the active drive so a
  // movie obtained on another drive stays 获取-able here.
  scope?: ScopeArg,
): Promise<SearchCandidateAction> {
  const scoped = scope === undefined ? undefined : normalizeScope(scope);
  const activeRun = await repository.findActiveWorkflowRun({
    trackedSeasonId: trackedSeasonIdValue,
    kind,
    ...(scoped ? { accountId: scoped.accountId, connectedStorageId: scoped.connectedStorageId } : {}),
  });
  if (activeRun) {
    return {
      state: "active_workflow",
      label: "获取中",
      disabled: true,
      workflowRunId: activeRun.workflowRun.id,
    };
  }

  const unreleased = reserveGate ? isMovieUnreleased(reserveGate.releaseDate, reserveGate.now) : false;
  const state = await repository.getTrackedSeasonState(trackedSeasonIdValue, scope);
  if (!state || state.episodes.length === 0) {
    // Not tracked yet: an unreleased film is reservable (预定), not acquirable.
    return unreleased ? reserveAction() : canRequestAction();
  }
  // Tracked. A reserved-but-not-yet-acquired film whose release is still in the
  // future reads as 已预定 (the daily patrol collects it the moment it releases) —
  // keyed on the real acquisition signal (the anchor obtained flag), NOT on
  // isFullyAcquired, which a finished-season/unaired-anchor reserve trips falsely.
  // Otherwise, situation-aware wording: a one-off film / finished season fully in
  // hand is DONE → "已获取"; a still-airing season or real gaps is "已追踪".
  const obtained = state.episodes.some((episode) => episode.obtained);
  if (unreleased && !obtained) {
    return reservedAction();
  }
  return {
    state: "already_tracked",
    label: isFullyAcquired(state) ? "已获取" : "已追踪",
    disabled: true,
    workflowRunId: null,
  };
}

function isFullyAcquired(state: { season: TrackedSeason; episodes: EpisodeState[] }): boolean {
  const finished = state.season.latestAiredEpisode >= state.season.totalEpisodes;
  const airedMissing = state.episodes.some(
    (episode) => episode.airStatus === "aired" && !episode.obtained,
  );
  return finished && !airedMissing;
}

function canRequestAction(): SearchCandidateAction {
  return {
    state: "can_request",
    label: "获取",
    disabled: false,
    workflowRunId: null,
  };
}

/** Untracked unreleased movie → a 预定 (reserve) button. */
function reserveAction(): SearchCandidateAction {
  return {
    state: "can_reserve",
    label: "预定",
    disabled: false,
    workflowRunId: null,
  };
}

/** Reserved unreleased movie (tracked, awaiting release) → 已预定. */
function reservedAction(): SearchCandidateAction {
  return {
    state: "reserved",
    label: "已预定",
    disabled: true,
    workflowRunId: null,
  };
}

function mediaTitleId(mediaType: MediaSearchCandidate["mediaType"], tmdbId: number): string {
  return `tmdb_${mediaType}_${tmdbId}`;
}

function trackedSeasonId(tmdbId: number, seasonNumber: number): string {
  return `${mediaTitleId("tv", tmdbId)}_s${seasonNumber}`;
}

function movieTrackedSeasonId(tmdbId: number): string {
  return `${mediaTitleId("movie", tmdbId)}_movie`;
}
