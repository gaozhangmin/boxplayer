import { describe, expect, it } from "vitest";
import {
  createEpisodeStates,
  getSearchPageView,
  InMemoryMediaSearchCache,
  InMemoryWorkflowRepository,
  reserveMovie,
  type MediaSearchCandidate,
  type MediaSearchProvider,
  type MediaTitle,
  type TrackedSeason,
} from "../src/index.js";

const NOW = "2026-06-15T00:00:00.000Z";

function movieCandidate(releaseDate: string | null): MediaSearchCandidate {
  return {
    tmdbId: 1000,
    mediaType: "movie",
    title: "未上映大片",
    originalTitle: "Future Blockbuster",
    year: 2026,
    releaseDate,
    overview: "",
    posterPath: null,
    backdropPath: null,
    seasons: [],
  };
}

describe("getSearchPageView", () => {
  it("returns an empty search state without calling the provider when query is blank", async () => {
    const provider = countingSearchProvider([]);

    const view = await getSearchPageView({
      query: "   ",
      provider,
      cache: new InMemoryMediaSearchCache(),
      repository: new InMemoryWorkflowRepository(),
    });

    expect(provider.calls).toBe(0);
    expect(view).toMatchObject({
      query: "",
      state: "empty",
      cacheStatus: "none",
      candidates: [],
    });
  });

  it("degrades to provider_error instead of crashing when every TMDB access is unreachable (issue #134)", async () => {
    // A GFW-blocked deployment (direct TMDB AND the workers.dev proxy both
    // unreachable) makes the provider throw — the page must degrade, not 500.
    const provider: MediaSearchProvider = {
      async searchMedia() {
        throw new Error("All 1 TMDB access(es) failed: TypeError: fetch failed");
      },
    };

    const view = await getSearchPageView({
      query: "星际牛仔",
      provider,
      cache: new InMemoryMediaSearchCache(),
      repository: new InMemoryWorkflowRepository(),
    });

    expect(view).toMatchObject({
      query: "星际牛仔",
      state: "provider_error",
      cacheStatus: "miss",
      candidates: [],
    });
    expect(view.providerError).toContain("TMDB access(es) failed");
  });

  it("formats a non-Error provider throw into a readable diagnostic (not [object Object])", async () => {
    const provider: MediaSearchProvider = {
      async searchMedia() {
        throw { code: "ECONNRESET" };
      },
    };

    const view = await getSearchPageView({
      query: "翘楚",
      provider,
      cache: new InMemoryMediaSearchCache(),
      repository: new InMemoryWorkflowRepository(),
    });

    expect(view.state).toBe("provider_error");
    expect(view.providerError).toBe('{"code":"ECONNRESET"}');
  });

  it("does NOT cache a provider failure — the next search retries the provider", async () => {
    const cache = new InMemoryMediaSearchCache();
    const repository = new InMemoryWorkflowRepository();
    let fail = true;
    const provider: MediaSearchProvider = {
      async searchMedia() {
        if (fail) throw new Error("fetch failed");
        return [qiaochuCandidate()];
      },
    };

    const failed = await getSearchPageView({ query: "翘楚", provider, cache, repository });
    expect(failed.state).toBe("provider_error");

    fail = false;
    const recovered = await getSearchPageView({ query: "翘楚", provider, cache, repository });
    expect(recovered.state).toBe("ready");
    // cacheStatus "miss" proves the earlier failure was not cached as a result.
    expect(recovered.cacheStatus).toBe("miss");
    expect(recovered.candidates).toHaveLength(1);
  });

  it("still serves a warm cache when the provider is down", async () => {
    const cache = new InMemoryMediaSearchCache();
    await cache.set("翘楚", [qiaochuCandidate()]);
    const provider: MediaSearchProvider = {
      async searchMedia() {
        throw new Error("fetch failed");
      },
    };

    const view = await getSearchPageView({
      query: "翘楚",
      provider,
      cache,
      repository: new InMemoryWorkflowRepository(),
    });

    expect(view.state).toBe("ready");
    expect(view.cacheStatus).toBe("hit");
    expect(view.candidates).toHaveLength(1);
  });

  it("maps provider candidates into UI cards with requestable action state", async () => {
    const provider = countingSearchProvider([qiaochuCandidate()]);

    const view = await getSearchPageView({
      query: "翘楚",
      provider,
      cache: new InMemoryMediaSearchCache(),
      repository: new InMemoryWorkflowRepository(),
    });

    expect(provider.calls).toBe(1);
    expect(view.state).toBe("ready");
    expect(view.cacheStatus).toBe("miss");
    expect(view.candidates).toMatchObject([
      {
        // The search card is season-agnostic for TV — it does NOT pre-pick a
        // season (the user chooses via SeasonRequestMenu), so the id is the
        // show-level title id and no season is selected.
        id: "tmdb_tv_289271",
        tmdbId: 289271,
        mediaType: "tv",
        title: "翘楚",
        year: 2026,
        selectedSeasonNumber: null,
        action: {
          state: "can_request",
          label: "获取",
          disabled: false,
        },
      },
    ]);
  });

  it("keeps the TV card season-agnostic even when a season is already tracked", async () => {
    // Per-season tracked state for a TV show is surfaced by the UI's
    // SeasonRequestMenu / trackedLabel (built from listTrackedSeasonStates),
    // NOT by a card-level action. So the card must NOT collapse a multi-season
    // show into season 1's tracked state — it stays requestable & seasonless.
    const repository = new InMemoryWorkflowRepository();
    const { title, season } = trackedFixture();
    await repository.saveWorkflowRunSnapshot({
      title,
      season,
      workflowRun: workflowRun(season, "succeeded"),
      episodes: createEpisodeStates({
        trackedSeasonId: season.id,
        seasonNumber: season.seasonNumber,
        totalEpisodes: season.totalEpisodes,
        latestAiredEpisode: season.latestAiredEpisode,
      }),
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });

    const view = await getSearchPageView({
      query: "翘楚",
      provider: countingSearchProvider([qiaochuCandidate()]),
      cache: new InMemoryMediaSearchCache(),
      repository,
    });

    expect(view.candidates[0]?.mediaType).toBe("tv");
    expect(view.candidates[0]?.selectedSeasonNumber).toBeNull();
    expect(view.candidates[0]?.action).toMatchObject({
      state: "can_request",
      disabled: false,
    });
  });

  it("marks an already-acquired movie as tracked so it cannot be re-requested in search", async () => {
    const repository = new InMemoryWorkflowRepository();
    const title: MediaTitle = {
      id: "tmdb_movie_872585",
      tmdbId: 872585,
      type: "movie",
      title: "奥本海默",
      originalTitle: "Oppenheimer",
      year: 2023,
      aliases: [],
    };
    const season: TrackedSeason = {
      id: "tmdb_movie_872585_movie",
      mediaTitleId: title.id,
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "115_dir_movie",
      totalEpisodes: 1,
      latestAiredEpisode: 1,
      latestAiredSource: "metadata",
    };
    await repository.saveWorkflowRunSnapshot({
      title,
      season,
      workflowRun: {
        id: "run_movie",
        kind: "movie_init",
        status: "succeeded",
        trackedSeasonId: season.id,
        startedAt: "2026-06-12T00:00:00.000Z",
        finishedAt: "2026-06-12T00:02:00.000Z",
        auditEvents: [],
      },
      // An acquired movie: its single anchor episode is obtained.
      episodes: createEpisodeStates({
        trackedSeasonId: season.id,
        seasonNumber: 1,
        totalEpisodes: 1,
        latestAiredEpisode: 1,
      }).map((episode) => ({ ...episode, obtained: true })),
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });

    const view = await getSearchPageView({
      query: "奥本海默",
      provider: countingSearchProvider([oppenheimerCandidate()]),
      cache: new InMemoryMediaSearchCache(),
      repository,
    });

    // A finished, fully-obtained film reads as 已获取 (not 已追踪) — and is still
    // disabled so it can't be re-requested.
    expect(view.candidates[0]).toMatchObject({
      id: "tmdb_movie_872585",
      mediaType: "movie",
      action: { state: "already_tracked", label: "已获取", disabled: true },
    });
  });

  it("a movie obtained on one drive is still 获取-able on ANOTHER drive's workspace (tree-model scope)", async () => {
    const repository = new InMemoryWorkflowRepository();
    const title: MediaTitle = {
      id: "tmdb_movie_872585",
      tmdbId: 872585,
      type: "movie",
      title: "奥本海默",
      originalTitle: "Oppenheimer",
      year: 2023,
      aliases: [],
    };
    const season: TrackedSeason = {
      id: "tmdb_movie_872585_movie",
      mediaTitleId: title.id,
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "dir_movie",
      totalEpisodes: 1,
      latestAiredEpisode: 1,
      latestAiredSource: "metadata",
    };
    // Acquired on drive A only.
    await repository.saveWorkflowRunSnapshot({
      accountId: "acct_1",
      connectedStorageId: "driveA",
      title,
      season,
      workflowRun: {
        id: "run_movie_A",
        kind: "movie_init",
        status: "succeeded",
        trackedSeasonId: season.id,
        startedAt: "2026-06-12T00:00:00.000Z",
        finishedAt: "2026-06-12T00:02:00.000Z",
        auditEvents: [],
      },
      episodes: createEpisodeStates({
        trackedSeasonId: season.id,
        seasonNumber: 1,
        totalEpisodes: 1,
        latestAiredEpisode: 1,
      }).map((episode) => ({ ...episode, obtained: true })),
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });

    // Drive A's workspace → already obtained.
    const onA = await getSearchPageView({
      query: "奥本海默",
      provider: countingSearchProvider([oppenheimerCandidate()]),
      cache: new InMemoryMediaSearchCache(),
      repository,
      scope: { accountId: "acct_1", connectedStorageId: "driveA" },
    });
    expect(onA.candidates[0]?.action).toMatchObject({ label: "已获取", disabled: true });

    // Drive B's workspace (same account, different drive) → still acquirable.
    const onB = await getSearchPageView({
      query: "奥本海默",
      provider: countingSearchProvider([oppenheimerCandidate()]),
      cache: new InMemoryMediaSearchCache(),
      repository,
      scope: { accountId: "acct_1", connectedStorageId: "driveB" },
    });
    expect(onB.candidates[0]?.action).toMatchObject({ state: "can_request", label: "获取", disabled: false });
  });

  it("keeps the TV card season-agnostic even while a season's workflow is running", async () => {
    // A TV season mid-acquisition is already tracked, so the UI drops it from
    // untrackedSeasons and surfaces it via trackedLabel — the duplicate-request
    // guard for TV does not live in a card-level action.
    const repository = new InMemoryWorkflowRepository();
    const { title, season } = trackedFixture();
    await repository.saveWorkflowRunSnapshot({
      title,
      season,
      workflowRun: workflowRun(season, "running"),
      episodes: [],
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });

    const view = await getSearchPageView({
      query: "翘楚",
      provider: countingSearchProvider([qiaochuCandidate()]),
      cache: new InMemoryMediaSearchCache(),
      repository,
    });

    expect(view.candidates[0]?.action).toMatchObject({ state: "can_request", disabled: false });
  });

  it("gates a MOVIE card on its active workflow (card-level action is the movie's button)", async () => {
    // Movies are the single-anchor case whose card-level action actually drives
    // the one acquire button — so an in-flight movie must read as 获取中.
    const repository = new InMemoryWorkflowRepository();
    const title: MediaTitle = {
      id: "tmdb_movie_872585",
      tmdbId: 872585,
      type: "movie",
      title: "奥本海默",
      originalTitle: "Oppenheimer",
      year: 2023,
      aliases: [],
    };
    const season: TrackedSeason = {
      id: "tmdb_movie_872585_movie",
      mediaTitleId: title.id,
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "",
      totalEpisodes: 1,
      latestAiredEpisode: 1,
      latestAiredSource: "metadata",
    };
    await repository.saveWorkflowRunSnapshot({
      title,
      season,
      workflowRun: {
        id: "run_movie_active",
        kind: "movie_init",
        status: "running",
        trackedSeasonId: season.id,
        startedAt: "2026-06-12T00:00:00.000Z",
        finishedAt: null,
        auditEvents: [],
      },
      episodes: [],
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });

    const view = await getSearchPageView({
      query: "奥本海默",
      provider: countingSearchProvider([
        {
          tmdbId: 872585,
          mediaType: "movie",
          title: "奥本海默",
          originalTitle: "Oppenheimer",
          year: 2023,
          overview: "",
          posterPath: null,
          backdropPath: null,
          seasons: [],
        },
      ]),
      cache: new InMemoryMediaSearchCache(),
      repository,
    });

    expect(view.candidates[0]?.action).toMatchObject({
      state: "active_workflow",
      disabled: true,
      workflowRunId: "run_movie_active",
    });
  });

  it("offers 预定 (reserve), not 获取, for an UNRELEASED untracked movie", async () => {
    const view = await getSearchPageView({
      query: "未上映",
      provider: countingSearchProvider([movieCandidate("2026-12-25")]), // future
      cache: new InMemoryMediaSearchCache(),
      repository: new InMemoryWorkflowRepository(),
      now: () => NOW,
    });

    expect(view.candidates[0]?.action).toMatchObject({ state: "can_reserve", label: "预定", disabled: false });
  });

  it("still offers 获取 (acquire) for a RELEASED untracked movie", async () => {
    const view = await getSearchPageView({
      query: "已上映",
      provider: countingSearchProvider([movieCandidate("2024-01-01")]), // past
      cache: new InMemoryMediaSearchCache(),
      repository: new InMemoryWorkflowRepository(),
      now: () => NOW,
    });

    expect(view.candidates[0]?.action).toMatchObject({ state: "can_request", label: "获取", disabled: false });
  });

  it("reads as 已预定 (reserved) once an unreleased movie has been reserved", async () => {
    const repository = new InMemoryWorkflowRepository();
    await reserveMovie({
      title: {
        id: "tmdb_movie_1000",
        tmdbId: 1000,
        type: "movie",
        title: "未上映大片",
        originalTitle: "Future Blockbuster",
        year: 2026,
        releaseDate: "2026-12-25",
        aliases: [],
      },
      repository,
      createWorkflowRunId: () => "run_reserved",
      now: () => NOW,
    });

    const view = await getSearchPageView({
      query: "未上映",
      provider: countingSearchProvider([movieCandidate("2026-12-25")]),
      cache: new InMemoryMediaSearchCache(),
      repository,
      now: () => NOW,
    });

    expect(view.candidates[0]?.action).toMatchObject({ state: "reserved", label: "已预定", disabled: true });
  });

  it("serves repeated searches from cache instead of calling the provider again", async () => {
    const cache = new InMemoryMediaSearchCache();
    const provider = countingSearchProvider([qiaochuCandidate()]);
    const repository = new InMemoryWorkflowRepository();

    const first = await getSearchPageView({
      query: " 翘楚 ",
      provider,
      cache,
      repository,
    });
    const second = await getSearchPageView({
      query: "翘楚",
      provider,
      cache,
      repository,
    });

    expect(provider.calls).toBe(1);
    expect(first.cacheStatus).toBe("miss");
    expect(second.cacheStatus).toBe("hit");
    expect(second.candidates[0]?.title).toBe("翘楚");
  });
});

function countingSearchProvider(results: MediaSearchCandidate[]): MediaSearchProvider & { calls: number } {
  return {
    calls: 0,
    async searchMedia() {
      this.calls += 1;
      return results;
    },
  };
}

function qiaochuCandidate(): MediaSearchCandidate {
  return {
    tmdbId: 289271,
    mediaType: "tv",
    title: "翘楚",
    originalTitle: "翘楚",
    year: 2026,
    overview: "国产剧更新中。",
    posterPath: "/qiaochu.jpg",
    backdropPath: "/qiaochu-backdrop.jpg",
    seasons: [
      {
        seasonNumber: 1,
        episodeCount: 24,
        latestAiredEpisode: 14,
      },
    ],
  };
}

function oppenheimerCandidate(): MediaSearchCandidate {
  return {
    tmdbId: 872585,
    mediaType: "movie",
    title: "奥本海默",
    originalTitle: "Oppenheimer",
    year: 2023,
    overview: "原子弹之父的传记片。",
    posterPath: "/oppenheimer.jpg",
    backdropPath: "/oppenheimer-backdrop.jpg",
    seasons: [],
  };
}

function trackedFixture(): { title: MediaTitle; season: TrackedSeason } {
  const title: MediaTitle = {
    id: "tmdb_tv_289271",
    tmdbId: 289271,
    type: "tv",
    title: "翘楚",
    originalTitle: "翘楚",
    year: 2026,
    aliases: [],
  };
  return {
    title,
    season: {
      id: "tmdb_tv_289271_s1",
      mediaTitleId: title.id,
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "115_dir_qiaochu_s1",
      totalEpisodes: 24,
      latestAiredEpisode: 14,
      latestAiredSource: "metadata",
    },
  };
}

function workflowRun(season: TrackedSeason, status: "running" | "succeeded") {
  return {
    id: "run_qiaochu",
    kind: "type2_init" as const,
    status,
    trackedSeasonId: season.id,
    startedAt: "2026-06-12T00:00:00.000Z",
    finishedAt: status === "succeeded" ? "2026-06-12T00:02:00.000Z" : null,
    auditEvents: [],
  };
}
