import type {
  LatestAiredSource,
  MediaTitle,
  MediaType,
  TrackedSeason,
} from "./domain.js";
import { classifyMediaType } from "./media-classification.js";
import type { MediaSearchCandidate, MediaSearchProvider } from "./search-view.js";

/** Refine a TV details record into tv/anime by genre + origin. */
function tvMediaType(details: TmdbTvDetails): MediaType {
  return classifyMediaType({
    baseType: "tv",
    genreIds: details.genres,
    originCountries: details.origin_country,
  });
}

export interface TmdbFetchInit {
  method: "GET";
  headers: Record<string, string>;
  /** Per-hop timeout the access chain picked for this access (direct = fail-fast,
   *  proxy = patient). defaultFetchJson honors it; injected fetchJson may ignore. */
  timeoutMs?: number;
}

export type TmdbFetchJson = (url: string, init: TmdbFetchInit) => Promise<unknown>;

export const TMDB_DIRECT_BASE_URL = "https://api.themoviedb.org/3";

/** One way to reach TMDB: a base URL and an optional bearer token. The proxy
 *  access omits the token (the Worker injects the author's key server-side). */
export interface TmdbAccess {
  baseURL: string;
  readToken?: string;
}

function normalizeAccess(access: TmdbAccess): TmdbAccess {
  const baseURL = access.baseURL.replace(/\/+$/, "");
  return access.readToken === undefined ? { baseURL } : { baseURL, readToken: access.readToken };
}

/** Try each access in order; first success wins, all-fail throws. This is the
 *  one chokepoint where user-key → proxy fallback lives.
 *
 *  `deadAccesses` (shared across a provider's lifetime) memoizes which accesses
 *  have already failed so later calls skip them instead of re-paying the cost.
 *  Without it, a user TMDB token whose direct api.themoviedb.org hop is blocked
 *  makes EVERY call (a search fires ~11) re-time-out on that hop before falling
 *  back — the cumulative stall shows as "A server error occurred" (issue #68).
 *  Keyed by baseURL + token (accessKey), so two accesses sharing a host but
 *  carrying different tokens (user key, then env token) are tracked independently
 *  — a failing user key must not skip a still-working env-token access. When every
 *  access is already marked dead the set is left untouched and all are retried
 *  (the prior failures may have been transient) rather than throwing blind. */
async function fetchViaAccessChain(
  accesses: TmdbAccess[],
  path: string,
  query: Record<string, string>,
  fetchJson: TmdbFetchJson,
  deadAccesses?: Set<string>,
): Promise<unknown> {
  let lastError: unknown = new Error("no TMDB access configured");
  let sawTimeout = false;
  // NUL sentinel for a token-less access (undefined) so it never collides with a
  // real (even empty-string) token on the same host — the function treats those
  // distinctly when setting Authorization, and the dead key must too.
  const accessKey = (a: TmdbAccess) => `${a.baseURL}\n${a.readToken === undefined ? "\u0000" : a.readToken}`;
  const isTimeout = (error: unknown): boolean =>
    (error instanceof Error && error.name === "TimeoutError") || /timeout/i.test(String(error));
  const tryOnce = async (list: TmdbAccess[]): Promise<{ ok: true; value: unknown } | { ok: false }> => {
    for (const access of list) {
      const url = `${access.baseURL}/${path}?${new URLSearchParams(query).toString()}`;
      const headers: Record<string, string> = { "Content-Type": "application/json;charset=utf-8" };
      if (access.readToken !== undefined) {
        headers.Authorization = `Bearer ${access.readToken}`;
      }
      // Per-hop timeout: the DIRECT api.themoviedb.org hop keeps the fail-fast
      // budget (a GFW-blackholed connection must not stall the chain — #68/#69);
      // any OTHER hop is a proxy we chose on purpose (CF Worker / self-hosted),
      // whose round-trip from a China router measures ~2.4s baseline — live
      // stress-testing (2026-07-02) showed jitter breaching 4.5s and crashing
      // the search page / acquire action, so the proxy gets a patient budget.
      const timeoutMs = access.baseURL.includes("api.themoviedb.org")
        ? TMDB_DIRECT_TIMEOUT_MS
        : TMDB_PROXY_TIMEOUT_MS;
      try {
        const value = await fetchJson(url, { method: "GET", headers, timeoutMs });
        // Self-heal: a hop that answers is not dead — clear any stale mark so
        // later calls go straight through instead of relying on the all-dead
        // retry fallback.
        deadAccesses?.delete(accessKey(access));
        return { ok: true, value };
      } catch (error) {
        lastError = error;
        if (isTimeout(error)) {
          sawTimeout = true;
        }
        deadAccesses?.add(accessKey(access));
      }
    }
    return { ok: false };
  };
  const live = deadAccesses ? accesses.filter((a) => !deadAccesses.has(accessKey(a))) : accesses;
  const candidates = live.length > 0 ? live : accesses;
  const first = await tryOnce(candidates);
  if (first.ok) {
    return first.value;
  }
  // A timeout is the transient failure mode (network jitter, Worker cold start)
  // — give the FULL chain exactly one more pass before surfacing an error to
  // the page/action. Non-timeout failures (401/404/parse) are deterministic;
  // retrying them only adds latency.
  if (sawTimeout) {
    const second = await tryOnce(accesses);
    if (second.ok) {
      return second.value;
    }
  }
  throw new Error(`All ${candidates.length} TMDB access(es) failed: ${String(lastError)}`);
}

/** Build the access list from either the new `accesses` or the legacy single
 *  `{readToken, baseURL}` options shape. */
function resolveAccesses(options: {
  accesses?: TmdbAccess[];
  readToken?: string;
  baseURL?: string;
}): TmdbAccess[] {
  if (options.accesses && options.accesses.length > 0) {
    return options.accesses.map(normalizeAccess);
  }
  if (options.readToken !== undefined) {
    return [normalizeAccess({ baseURL: options.baseURL ?? TMDB_DIRECT_BASE_URL, readToken: options.readToken })];
  }
  throw new Error("TmdbMetadataProvider requires `accesses` or `readToken`");
}

export interface TmdbMetadataProviderOptions {
  readToken?: string;
  accesses?: TmdbAccess[];
  baseURL?: string;
  language?: string;
  fetchJson?: TmdbFetchJson;
}

export interface TmdbSearchProviderOptions extends TmdbMetadataProviderOptions {
  maxResults?: number;
  tvDetailsLimit?: number;
}

export interface TvTrackingTargetInput {
  tmdbId: number;
  mediaType: Extract<MediaType, "tv">;
  seasonNumber: number;
  qualityPreference: string;
  storageDirectoryId?: string;
  metadataProvider: TmdbMetadataProvider;
}

export interface PreparedTrackingTarget {
  title: MediaTitle;
  season: TrackedSeason;
  keyword: string;
}

interface TmdbTvDetails {
  id: number;
  name: string;
  original_name: string;
  first_air_date: string;
  number_of_episodes: number;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  last_episode_to_air?: {
    season_number?: number;
    episode_number?: number;
  } | null;
  seasons?: Array<{
    season_number?: number;
    episode_count?: number;
  }>;
  genres: number[];
  origin_country: string[];
}

interface TmdbSeasonDetails {
  season_number: number;
  episodes?: Array<{
    episode_number?: number;
    air_date?: string | null;
  }>;
}

interface TmdbMovieDetails {
  id: number;
  title: string;
  original_title: string;
  release_date: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: number[];
  origin_country: string[];
}

export class TmdbMetadataProvider {
  private readonly accesses: TmdbAccess[];
  private readonly language: string;
  private readonly fetchJson: TmdbFetchJson;
  /** Per-instance memo of accesses that already failed (issue #68): skip them on
   *  later calls so a blocked direct hop isn't re-probed once per TMDB request. */
  private readonly deadAccesses = new Set<string>();

  constructor(options: TmdbMetadataProviderOptions) {
    this.accesses = resolveAccesses(options);
    this.language = options.language ?? "zh-CN";
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
  }

  async getTvDetails(tmdbId: number): Promise<TmdbTvDetails> {
    return parseTvDetails(
      await this.get(`tv/${tmdbId}`, {
        language: this.language,
      }),
    );
  }

  async getTvSeason(tmdbId: number, seasonNumber: number): Promise<TmdbSeasonDetails> {
    return parseSeasonDetails(
      await this.get(`tv/${tmdbId}/season/${seasonNumber}`, {
        language: this.language,
      }),
    );
  }

  async getMovieDetails(tmdbId: number): Promise<TmdbMovieDetails> {
    return parseMovieDetails(await this.get(`movie/${tmdbId}`, { language: this.language }));
  }

  private async get(path: string, query: Record<string, string>): Promise<unknown> {
    return fetchViaAccessChain(this.accesses, path, query, this.fetchJson, this.deadAccesses);
  }
}

export class TmdbSearchProvider implements MediaSearchProvider {
  private readonly accesses: TmdbAccess[];
  private readonly language: string;
  private readonly fetchJson: TmdbFetchJson;
  /** Per-instance memo of accesses that already failed (issue #68): skip them on
   *  later calls so a blocked direct hop isn't re-probed once per TMDB request. */
  private readonly deadAccesses = new Set<string>();
  private readonly maxResults: number;
  private readonly tvDetailsLimit: number;

  constructor(options: TmdbSearchProviderOptions) {
    this.accesses = resolveAccesses(options);
    this.language = options.language ?? "zh-CN";
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.maxResults = options.maxResults ?? 10;
    this.tvDetailsLimit = options.tvDetailsLimit ?? this.maxResults;
  }

  async searchMedia(input: { query: string }): Promise<MediaSearchCandidate[]> {
    const query = normalizeTitle(input.query);
    if (!query) {
      return [];
    }

    const response = await this.get("search/multi", {
      query,
      include_adult: "false",
      language: this.language,
      page: "1",
    });
    const results = parseSearchResults(response).slice(0, this.maxResults);
    const candidates: MediaSearchCandidate[] = [];
    let tvDetailsRequests = 0;

    for (const result of results) {
      if (result.media_type === "movie") {
        candidates.push(movieSearchCandidate(result));
      }

      if (result.media_type === "tv") {
        const details =
          tvDetailsRequests < this.tvDetailsLimit ? await this.getTvDetails(result.id) : null;
        tvDetailsRequests += details ? 1 : 0;
        candidates.push(tvSearchCandidate(result, details));
      }
    }

    return candidates;
  }

  private async getTvDetails(tmdbId: number): Promise<TmdbTvDetails> {
    return parseTvDetails(
      await this.get(`tv/${tmdbId}`, {
        language: this.language,
      }),
    );
  }

  private async get(path: string, query: Record<string, string>): Promise<unknown> {
    return fetchViaAccessChain(this.accesses, path, query, this.fetchJson, this.deadAccesses);
  }
}

export function createTmdbMetadataProvider(
  accesses: TmdbAccess[],
  opts: { language?: string; fetchJson?: TmdbFetchJson } = {},
): TmdbMetadataProvider {
  return new TmdbMetadataProvider({ accesses, ...opts });
}

export function createTmdbSearchProvider(
  accesses: TmdbAccess[],
  opts: { language?: string; fetchJson?: TmdbFetchJson; maxResults?: number; tvDetailsLimit?: number } = {},
): TmdbSearchProvider {
  return new TmdbSearchProvider({ accesses, ...opts });
}

/** Fetch an arbitrary TMDB list path (e.g. trending/discover) through the same
 *  user-key → proxy access chain every provider uses — the single chokepoint for
 *  fallback + timeout + dead-access memoization. Returns the raw parsed body
 *  (typically `{ results: [...] }`); callers map it. Lives here (not in apps/web)
 *  because defaultFetchJson is module-private and the fallback logic must not be
 *  duplicated. */
export async function fetchTmdbList(
  accesses: TmdbAccess[],
  path: string,
  query: Record<string, string> = {},
  opts: { fetchJson?: TmdbFetchJson } = {},
): Promise<unknown> {
  return fetchViaAccessChain(accesses, path, query, opts.fetchJson ?? defaultFetchJson);
}

export function createTmdbMetadataProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TmdbMetadataProvider {
  const readToken = env.TMDB_READ_TOKEN;
  if (!readToken) {
    throw new Error("TMDB_READ_TOKEN is required to create TmdbMetadataProvider");
  }
  return new TmdbMetadataProvider({ readToken });
}

export function createTmdbSearchProviderFromEnv(env: NodeJS.ProcessEnv = process.env): TmdbSearchProvider {
  const readToken = env.TMDB_READ_TOKEN;
  if (!readToken) {
    throw new Error("TMDB_READ_TOKEN is required to create TmdbSearchProvider");
  }
  return new TmdbSearchProvider({ readToken });
}

export async function prepareTrackingTarget(input: TvTrackingTargetInput): Promise<PreparedTrackingTarget> {
  const [details, seasonDetails] = await Promise.all([
    input.metadataProvider.getTvDetails(input.tmdbId),
    input.metadataProvider.getTvSeason(input.tmdbId, input.seasonNumber),
  ]);
  const titleId = `tmdb_tv_${details.id}`;
  const title = normalizeTitle(details.name);
  const totalEpisodes = totalEpisodesForSeason(details, seasonDetails, input.seasonNumber);
  const latestAiredEpisode = latestAiredEpisodeForSeason(details, seasonDetails, input.seasonNumber);
  const latestAiredSource: LatestAiredSource = "metadata";

  return {
    title: {
      id: titleId,
      tmdbId: details.id,
      type: tvMediaType(details),
      originCountries: details.origin_country,
      title,
      originalTitle: normalizeTitle(details.original_name) || title,
      year: yearFromDate(details.first_air_date),
      aliases: aliasList(title, details.original_name),
      posterPath: details.poster_path,
      backdropPath: details.backdrop_path,
      overview: details.overview,
    },
    season: {
      id: `${titleId}_s${input.seasonNumber}`,
      mediaTitleId: titleId,
      seasonNumber: input.seasonNumber,
      status: latestAiredEpisode >= totalEpisodes ? "completed" : "active",
      qualityPreference: input.qualityPreference,
      storageDirectoryId: input.storageDirectoryId ?? "",
      totalEpisodes,
      latestAiredEpisode,
      latestAiredSource,
    },
    // Quality preference NEVER enters the keyword (search-methodology law): it
    // filters out title matches and drifts to same-quality wrong works. Quality
    // is post-recall selection guidance (getQualityGuidance), not a search term.
    keyword: title,
  };
}

export interface PreparedMovieTarget {
  title: MediaTitle;
  keyword: string;
}

/** "获取电影" prepare step: one TMDB movie details call → a movie MediaTitle. */
export async function prepareMovieTarget(input: {
  tmdbId: number;
  qualityPreference: string;
  metadataProvider: TmdbMetadataProvider;
}): Promise<PreparedMovieTarget> {
  const details = await input.metadataProvider.getMovieDetails(input.tmdbId);
  const titleId = `tmdb_movie_${details.id}`;
  const title = normalizeTitle(details.title);
  return {
    title: {
      id: titleId,
      tmdbId: details.id,
      type: classifyMediaType({
        baseType: "movie",
        genreIds: details.genres,
        originCountries: details.origin_country,
      }),
      // Carried so the movie agent can skip the 中文 subtitle floor for 国产片
      // (CN-origin = natively Chinese-spoken; details.origin_country is mapped from
      // the movie's production_countries). Search itself stays origin-independent.
      originCountries: details.origin_country,
      title,
      originalTitle: normalizeTitle(details.original_title) || title,
      year: yearFromDate(details.release_date),
      releaseDate: details.release_date || null,
      aliases: aliasList(title, details.original_title),
      posterPath: details.poster_path,
      backdropPath: details.backdrop_path,
      overview: details.overview,
    },
    // Bare title only — the agent owns keyword variation (year, quality,
    // original title) to maximize coverage. Quality is a preference it applies,
    // not a hardcoded filter baked into the search.
    keyword: title,
  };
}

export interface PreparedSeriesTarget {
  title: MediaTitle;
  seasons: Array<{ seasonNumber: number; totalEpisodes: number; latestAiredEpisode: number }>;
  keyword: string;
}

/**
 * Title-level prepare step for "获取全剧": one TMDB details call yields every
 * season's shape and the latest-aired cursor. Specials (season 0) are
 * excluded; seasons after the cursor's season have zero aired episodes.
 */
export async function prepareSeriesTarget(input: {
  tmdbId: number;
  qualityPreference: string;
  metadataProvider: TmdbMetadataProvider;
}): Promise<PreparedSeriesTarget> {
  const details = await input.metadataProvider.getTvDetails(input.tmdbId);
  const titleId = `tmdb_tv_${details.id}`;
  const title = normalizeTitle(details.name);
  const lastAiredSeason = details.last_episode_to_air?.season_number ?? 0;
  const lastAiredEpisode = details.last_episode_to_air?.episode_number ?? 0;

  const seasons = (details.seasons ?? [])
    .map((season) => ({
      seasonNumber: season.season_number ?? 0,
      totalEpisodes: season.episode_count ?? 0,
    }))
    .filter((season) => season.seasonNumber > 0 && season.totalEpisodes > 0)
    .sort((left, right) => left.seasonNumber - right.seasonNumber)
    .map((season) => ({
      seasonNumber: season.seasonNumber,
      totalEpisodes: season.totalEpisodes,
      latestAiredEpisode:
        season.seasonNumber < lastAiredSeason
          ? season.totalEpisodes
          : season.seasonNumber === lastAiredSeason
            ? lastAiredEpisode
            : 0,
    }));
  if (seasons.length === 0) {
    throw new Error(`TMDB tv/${input.tmdbId} exposes no seasons with episodes`);
  }

  return {
    title: {
      id: titleId,
      tmdbId: details.id,
      type: tvMediaType(details),
      originCountries: details.origin_country,
      title,
      originalTitle: normalizeTitle(details.original_name) || title,
      year: yearFromDate(details.first_air_date),
      aliases: aliasList(title, details.original_name),
      posterPath: details.poster_path,
      backdropPath: details.backdrop_path,
      overview: details.overview,
    },
    seasons,
    // Quality preference NEVER enters the keyword (search-methodology law): it
    // filters out title matches and drifts to same-quality wrong works. Quality
    // is post-recall selection guidance (getQualityGuidance), not a search term.
    keyword: title,
  };
}

/** Per-request timeout for the DIRECT api.themoviedb.org hop. A blocked direct
 *  connection otherwise hangs on the platform default (~10s+), and a search fires
 *  many hops in series — the cumulative stall is what surfaced as a server error
 *  in issue #68. Bounding it lets the access chain fail over to the proxy
 *  well within the page's render budget. TMDB itself answers in well under a second. */
const TMDB_DIRECT_TIMEOUT_MS = 4500;
/** Per-request timeout for PROXY hops (CF Worker / self-hosted). Deliberately
 *  patient: from a China router the Worker round-trip measures ~2.4s baseline,
 *  and live stress-testing (2026-07-02) saw jitter breach 4.5s twice — crashing
 *  the search page and silently dropping an acquire action. A proxy is the LAST
 *  hop in the chain, so patience here delays only the error path, not a fallback. */
const TMDB_PROXY_TIMEOUT_MS = 12000;

async function defaultFetchJson(url: string, init: TmdbFetchInit): Promise<unknown> {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    signal: AbortSignal.timeout(init.timeoutMs ?? TMDB_DIRECT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`TMDB request failed with HTTP ${response.status}`);
  }
  return response.json();
}

function parseTvDetails(value: unknown): TmdbTvDetails {
  if (!isRecord(value)) {
    throw new Error("TMDB TV details response must be an object");
  }
  return {
    id: numberValue(value["id"]),
    name: stringValue(value["name"]),
    original_name: stringValue(value["original_name"]),
    first_air_date: stringValue(value["first_air_date"]),
    number_of_episodes: numberValue(value["number_of_episodes"]),
    overview: stringValue(value["overview"]),
    poster_path: optionalStringOrNull(value["poster_path"]),
    backdrop_path: optionalStringOrNull(value["backdrop_path"]),
    last_episode_to_air: isRecord(value["last_episode_to_air"])
      ? optionalEpisodePointer(value["last_episode_to_air"])
      : null,
    seasons: Array.isArray(value["seasons"])
      ? value["seasons"].filter(isRecord).map(optionalSeasonSummary)
      : [],
    genres: Array.isArray(value["genres"])
      ? value["genres"]
          .filter(isRecord)
          .map((genre) => optionalNumberValue(genre["id"]))
          .filter((id): id is number => id !== undefined)
      : [],
    origin_country: Array.isArray(value["origin_country"])
      ? value["origin_country"].filter((country): country is string => typeof country === "string")
      : [],
  };
}

function parseMovieDetails(value: unknown): TmdbMovieDetails {
  if (!isRecord(value)) {
    throw new Error("TMDB movie details response must be an object");
  }
  return {
    id: numberValue(value["id"]),
    title: stringValue(value["title"]),
    original_title: stringValue(value["original_title"]),
    release_date: stringValue(value["release_date"]),
    overview: stringValue(value["overview"]),
    poster_path: optionalStringOrNull(value["poster_path"]),
    backdrop_path: optionalStringOrNull(value["backdrop_path"]),
    genres: Array.isArray(value["genres"])
      ? value["genres"]
          .filter(isRecord)
          .map((genre) => optionalNumberValue(genre["id"]))
          .filter((id): id is number => id !== undefined)
      : [],
    // Movies expose production_countries rather than origin_country.
    origin_country: Array.isArray(value["production_countries"])
      ? value["production_countries"]
          .filter(isRecord)
          .map((country) => country["iso_3166_1"])
          .filter((code): code is string => typeof code === "string")
      : [],
  };
}

function parseSeasonDetails(value: unknown): TmdbSeasonDetails {
  if (!isRecord(value)) {
    throw new Error("TMDB season response must be an object");
  }
  return {
    season_number: numberValue(value["season_number"]),
    episodes: Array.isArray(value["episodes"])
      ? value["episodes"].filter(isRecord).map(optionalSeasonEpisode)
      : [],
  };
}

type TmdbSearchResult =
  | {
      id: number;
      media_type: "movie";
      title: string;
      original_title: string;
      release_date: string;
      overview: string;
      poster_path: string | null;
      backdrop_path: string | null;
    }
  | {
      id: number;
      media_type: "tv";
      name: string;
      original_name: string;
      first_air_date: string;
      overview: string;
      poster_path: string | null;
      backdrop_path: string | null;
    };

function parseSearchResults(value: unknown): TmdbSearchResult[] {
  if (!isRecord(value)) {
    throw new Error("TMDB search response must be an object");
  }
  if (!Array.isArray(value["results"])) {
    return [];
  }
  return value["results"].filter(isRecord).flatMap(optionalSearchResult);
}

function optionalSearchResult(value: Record<string, unknown>): TmdbSearchResult[] {
  const mediaType = value["media_type"];
  if (mediaType === "movie") {
    const title = normalizeTitle(stringValue(value["title"]));
    if (!title) {
      return [];
    }
    return [
      {
        id: numberValue(value["id"]),
        media_type: "movie",
        title,
        original_title: stringValue(value["original_title"]),
        release_date: stringValue(value["release_date"]),
        overview: stringValue(value["overview"]),
        poster_path: optionalStringOrNull(value["poster_path"]),
        backdrop_path: optionalStringOrNull(value["backdrop_path"]),
      },
    ];
  }
  if (mediaType === "tv") {
    const name = normalizeTitle(stringValue(value["name"]));
    if (!name) {
      return [];
    }
    return [
      {
        id: numberValue(value["id"]),
        media_type: "tv",
        name,
        original_name: stringValue(value["original_name"]),
        first_air_date: stringValue(value["first_air_date"]),
        overview: stringValue(value["overview"]),
        poster_path: optionalStringOrNull(value["poster_path"]),
        backdrop_path: optionalStringOrNull(value["backdrop_path"]),
      },
    ];
  }
  return [];
}

function tvSearchCandidate(result: Extract<TmdbSearchResult, { media_type: "tv" }>, details: TmdbTvDetails | null): MediaSearchCandidate {
  const title = normalizeTitle(result.name);
  return {
    tmdbId: result.id,
    mediaType: "tv",
    title,
    originalTitle: normalizeTitle(result.original_name) || title,
    year: yearFromDate(result.first_air_date),
    overview: result.overview,
    posterPath: result.poster_path,
    backdropPath: result.backdrop_path,
    seasons: details ? searchSeasonsFromTvDetails(details) : [],
  };
}

function movieSearchCandidate(result: Extract<TmdbSearchResult, { media_type: "movie" }>): MediaSearchCandidate {
  const title = normalizeTitle(result.title);
  return {
    tmdbId: result.id,
    mediaType: "movie",
    title,
    originalTitle: normalizeTitle(result.original_title) || title,
    year: yearFromDate(result.release_date),
    releaseDate: result.release_date || null,
    overview: result.overview,
    posterPath: result.poster_path,
    backdropPath: result.backdrop_path,
    seasons: [],
  };
}

function searchSeasonsFromTvDetails(details: TmdbTvDetails): MediaSearchCandidate["seasons"] {
  return (details.seasons ?? [])
    // Same filter as prepareSeriesTarget: a real season (not specials) that
    // actually HAS episodes. An announced-but-empty season (episode_count 0)
    // must not be offered for acquisition — it would only ever be no_coverage,
    // and it made the card show "共 2 季" while the detail page showed 1.
    .filter((season) => (season.season_number ?? 0) > 0 && (season.episode_count ?? 0) > 0)
    .map((season) => {
      const seasonNumber = season.season_number ?? 0;
      const episodeCount = season.episode_count ?? 0;
      const latestAiredEpisode =
        details.last_episode_to_air?.season_number === seasonNumber
          ? details.last_episode_to_air.episode_number ?? 0
          : episodeCount;
      return {
        seasonNumber,
        episodeCount,
        latestAiredEpisode: Math.min(episodeCount, latestAiredEpisode),
      };
    });
}

function optionalEpisodePointer(value: Record<string, unknown>): {
  season_number?: number;
  episode_number?: number;
} {
  const pointer: {
    season_number?: number;
    episode_number?: number;
  } = {};
  const seasonNumber = optionalNumberValue(value["season_number"]);
  if (seasonNumber !== undefined) {
    pointer.season_number = seasonNumber;
  }
  const episodeNumber = optionalNumberValue(value["episode_number"]);
  if (episodeNumber !== undefined) {
    pointer.episode_number = episodeNumber;
  }
  return pointer;
}

function optionalSeasonSummary(value: Record<string, unknown>): {
  season_number?: number;
  episode_count?: number;
} {
  const summary: {
    season_number?: number;
    episode_count?: number;
  } = {};
  const seasonNumber = optionalNumberValue(value["season_number"]);
  if (seasonNumber !== undefined) {
    summary.season_number = seasonNumber;
  }
  const episodeCount = optionalNumberValue(value["episode_count"]);
  if (episodeCount !== undefined) {
    summary.episode_count = episodeCount;
  }
  return summary;
}

function optionalSeasonEpisode(value: Record<string, unknown>): {
  episode_number?: number;
  air_date?: string | null;
} {
  const episode: {
    episode_number?: number;
    air_date?: string | null;
  } = {};
  const episodeNumber = optionalNumberValue(value["episode_number"]);
  if (episodeNumber !== undefined) {
    episode.episode_number = episodeNumber;
  }
  episode.air_date = typeof value["air_date"] === "string" ? value["air_date"] : null;
  return episode;
}

function totalEpisodesForSeason(
  details: TmdbTvDetails,
  seasonDetails: TmdbSeasonDetails,
  seasonNumber: number,
): number {
  const seasonEpisodeCount = details.seasons?.find((season) => season.season_number === seasonNumber)?.episode_count;
  return seasonEpisodeCount ?? seasonDetails.episodes?.length ?? details.number_of_episodes;
}

function latestAiredEpisodeForSeason(
  details: TmdbTvDetails,
  seasonDetails: TmdbSeasonDetails,
  seasonNumber: number,
): number {
  const lastEpisode = details.last_episode_to_air;
  if (lastEpisode?.season_number === seasonNumber && lastEpisode.episode_number !== undefined) {
    return lastEpisode.episode_number;
  }
  return Math.max(
    0,
    ...(seasonDetails.episodes ?? [])
      .filter((episode) => episode.air_date !== null && episode.air_date !== "")
      .map((episode) => episode.episode_number ?? 0),
  );
}

function normalizeTitle(value: string): string {
  return value.trim();
}

function aliasList(title: string, originalTitle: string): string[] {
  const normalizedOriginal = normalizeTitle(originalTitle);
  if (!normalizedOriginal || normalizedOriginal === title) {
    return [];
  }
  return [normalizedOriginal];
}

function yearFromDate(value: string): number {
  const match = /^(\d{4})/.exec(value);
  return match ? Number(match[1]) : 0;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
