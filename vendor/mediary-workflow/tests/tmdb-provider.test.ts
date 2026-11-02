import { describe, expect, it } from "vitest";
import {
  createTmdbMetadataProvider,
  createTmdbSearchProvider,
  prepareMovieTarget,
  prepareTrackingTarget,
  TmdbMetadataProvider,
  TmdbSearchProvider,
} from "../src/index.js";

describe("TmdbMetadataProvider", () => {
  it("prepares a TV tracking target from TMDB details and season metadata", async () => {
    const requests: string[] = [];
    const provider = new TmdbMetadataProvider({
      readToken: "token",
      fetchJson: async (url, init) => {
        requests.push(url);
        expect(init.headers.Authorization).toBe("Bearer token");
        if (url.includes("/tv/289271?")) {
          return {
            id: 289271,
            name: "翘楚",
            original_name: "翘楚",
            first_air_date: "2026-06-01",
            number_of_episodes: 24,
            overview: "一部很好看的剧。",
            poster_path: "/qiaochu-poster.jpg",
            backdrop_path: "/qiaochu-backdrop.jpg",
            last_episode_to_air: {
              season_number: 1,
              episode_number: 14,
            },
            seasons: [
              {
                season_number: 1,
                episode_count: 24,
              },
            ],
          };
        }
        if (url.includes("/tv/289271/season/1?")) {
          return {
            id: 987,
            season_number: 1,
            episodes: Array.from({ length: 24 }, (_, index) => ({
              episode_number: index + 1,
              name: `Episode ${index + 1}`,
              air_date: index < 14 ? `2026-06-${String(index + 1).padStart(2, "0")}` : null,
            })),
          };
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    const target = await prepareTrackingTarget({
      tmdbId: 289271,
      mediaType: "tv",
      seasonNumber: 1,
      qualityPreference: "4K",
      storageDirectoryId: "dir_qiaochu_s1",
      metadataProvider: provider,
    });

    expect(requests).toEqual([
      "https://api.themoviedb.org/3/tv/289271?language=zh-CN",
      "https://api.themoviedb.org/3/tv/289271/season/1?language=zh-CN",
    ]);
    expect(target).toEqual({
      title: {
        id: "tmdb_tv_289271",
        tmdbId: 289271,
        type: "tv",
        title: "翘楚",
        originalTitle: "翘楚",
        year: 2026,
        aliases: [],
        originCountries: [],
        posterPath: "/qiaochu-poster.jpg",
        backdropPath: "/qiaochu-backdrop.jpg",
        overview: "一部很好看的剧。",
      },
      season: {
        id: "tmdb_tv_289271_s1",
        mediaTitleId: "tmdb_tv_289271",
        seasonNumber: 1,
        status: "active",
        qualityPreference: "4K",
        storageDirectoryId: "dir_qiaochu_s1",
        totalEpisodes: 24,
        latestAiredEpisode: 14,
        latestAiredSource: "metadata",
      },
      keyword: "翘楚",
    });
  });

  it("uses aired season episodes when last_episode_to_air is absent or from another season", async () => {
    const provider = new TmdbMetadataProvider({
      readToken: "token",
      fetchJson: async (url) => {
        if (url.includes("/tv/1?")) {
          return {
            id: 1,
            name: "Show",
            original_name: "Original Show",
            first_air_date: "",
            number_of_episodes: 10,
            last_episode_to_air: {
              season_number: 2,
              episode_number: 3,
            },
            seasons: [
              {
                season_number: 1,
                episode_count: 8,
              },
            ],
          };
        }
        if (url.includes("/tv/1/season/1?")) {
          return {
            season_number: 1,
            episodes: [
              { episode_number: 1, air_date: "2026-01-01" },
              { episode_number: 2, air_date: "2026-01-08" },
              { episode_number: 3, air_date: "" },
              { episode_number: 4, air_date: null },
            ],
          };
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    const target = await prepareTrackingTarget({
      tmdbId: 1,
      mediaType: "tv",
      seasonNumber: 1,
      qualityPreference: "1080p",
      storageDirectoryId: "dir_show_s1",
      metadataProvider: provider,
    });

    expect(target.title).toMatchObject({
      id: "tmdb_tv_1",
      title: "Show",
      originalTitle: "Original Show",
      year: 0,
    });
    expect(target.season).toMatchObject({
      id: "tmdb_tv_1_s1",
      totalEpisodes: 8,
      latestAiredEpisode: 2,
      latestAiredSource: "metadata",
    });
    expect(target.keyword).toBe("Show"); // quality preference must NOT pollute the keyword
  });
});

describe("TmdbSearchProvider", () => {
  it("maps TMDB multi-search results into media search candidates and enriches TV seasons", async () => {
    const requests: string[] = [];
    const provider = new TmdbSearchProvider({
      readToken: "token",
      baseURL: "https://tmdb.test/3",
      fetchJson: async (url, init) => {
        requests.push(url);
        expect(init.headers.Authorization).toBe("Bearer token");
        if (url.includes("/search/multi?")) {
          return {
            results: [
              {
                id: 289271,
                media_type: "tv",
                name: "翘楚",
                original_name: "翘楚",
                first_air_date: "2026-06-01",
                overview: "国产剧",
                poster_path: "/qiaochu.jpg",
                backdrop_path: "/qiaochu-bg.jpg",
              },
              {
                id: 1311031,
                media_type: "movie",
                title: "我的僵尸女儿",
                original_title: "My Zombie Daughter",
                release_date: "2025-10-31",
                overview: "电影",
                poster_path: null,
                backdrop_path: "/zombie-bg.jpg",
              },
              {
                id: 42,
                media_type: "person",
                name: "not a media candidate",
              },
            ],
          };
        }
        if (url.includes("/tv/289271?")) {
          return {
            id: 289271,
            name: "翘楚",
            original_name: "翘楚",
            first_air_date: "2026-06-01",
            number_of_episodes: 24,
            last_episode_to_air: {
              season_number: 1,
              episode_number: 14,
            },
            seasons: [
              {
                season_number: 0,
                episode_count: 1,
              },
              {
                season_number: 1,
                episode_count: 24,
              },
            ],
          };
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    const candidates = await provider.searchMedia({ query: "翘楚" });

    expect(requests).toEqual([
      "https://tmdb.test/3/search/multi?query=%E7%BF%98%E6%A5%9A&include_adult=false&language=zh-CN&page=1",
      "https://tmdb.test/3/tv/289271?language=zh-CN",
    ]);
    expect(candidates).toEqual([
      {
        tmdbId: 289271,
        mediaType: "tv",
        title: "翘楚",
        originalTitle: "翘楚",
        year: 2026,
        overview: "国产剧",
        posterPath: "/qiaochu.jpg",
        backdropPath: "/qiaochu-bg.jpg",
        seasons: [
          {
            seasonNumber: 1,
            episodeCount: 24,
            latestAiredEpisode: 14,
          },
        ],
      },
      {
        tmdbId: 1311031,
        mediaType: "movie",
        title: "我的僵尸女儿",
        originalTitle: "My Zombie Daughter",
        year: 2025,
        releaseDate: "2025-10-31",
        overview: "电影",
        posterPath: null,
        backdropPath: "/zombie-bg.jpg",
        seasons: [],
      },
    ]);
  });

  it("excludes announced-but-empty seasons (episode_count 0) from a search candidate", async () => {
    // Bug: the card showed 孤独摇滚 as 共 2 季 (offering an announced Season 2 with
    // no episodes), while the detail page showed 1. A season with no episodes is
    // only ever no_coverage — it must not be offered until it actually has them.
    const provider = new TmdbSearchProvider({
      readToken: "token",
      baseURL: "https://tmdb.test/3",
      fetchJson: async (url) => {
        if (url.includes("/search/multi?")) {
          return {
            results: [
              { id: 119100, media_type: "tv", name: "孤独摇滚", original_name: "ぼっち・ざ・ろっく！", first_air_date: "2022-10-08", overview: "" },
            ],
          };
        }
        if (url.includes("/tv/119100?")) {
          return {
            id: 119100,
            name: "孤独摇滚",
            original_name: "ぼっち・ざ・ろっく！",
            first_air_date: "2022-10-08",
            last_episode_to_air: { season_number: 1, episode_number: 12 },
            seasons: [
              { season_number: 0, episode_count: 5 },
              { season_number: 1, episode_count: 12 },
              { season_number: 2, episode_count: 0 },
            ],
          };
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    const [candidate] = await provider.searchMedia({ query: "孤独摇滚" });

    // Only the real, non-empty season 1 survives — not specials (0) nor the
    // empty season 2.
    expect(candidate?.seasons.map((season) => season.seasonNumber)).toEqual([1]);
  });

  it("classifies a Japanese animation as anime while keeping the tmdb_tv id for routing", async () => {
    const provider = new TmdbMetadataProvider({
      readToken: "token",
      fetchJson: async (url) => {
        if (url.includes("/tv/240411?")) {
          return {
            id: 240411,
            name: "葬送的芙莉莲",
            original_name: "葬送のフリーレン",
            first_air_date: "2023-09-29",
            number_of_episodes: 28,
            overview: "",
            poster_path: null,
            backdrop_path: null,
            last_episode_to_air: { season_number: 1, episode_number: 28 },
            seasons: [{ season_number: 1, episode_count: 28 }],
            genres: [{ id: 16, name: "动画" }, { id: 10765, name: "Sci-Fi & Fantasy" }],
            origin_country: ["JP"],
          };
        }
        if (url.includes("/tv/240411/season/1?")) {
          return {
            id: 1,
            season_number: 1,
            episodes: Array.from({ length: 28 }, (_, index) => ({
              episode_number: index + 1,
              air_date: "2023-09-29",
            })),
          };
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    const target = await prepareTrackingTarget({
      tmdbId: 240411,
      mediaType: "tv",
      seasonNumber: 1,
      qualityPreference: "4K",
      metadataProvider: provider,
    });

    expect(target.title.type).toBe("anime");
    expect(target.title.id).toBe("tmdb_tv_240411");
  });

  it("prepares a movie target and keeps a Japanese animated film as a movie (a film is a film)", async () => {
    const provider = new TmdbMetadataProvider({
      readToken: "token",
      fetchJson: async (url) => {
        if (url.includes("/movie/129?")) {
          return {
            id: 129,
            title: "千与千寻",
            original_title: "千と千尋の神隠し",
            release_date: "2001-07-20",
            overview: "",
            poster_path: "/p.jpg",
            backdrop_path: null,
            genres: [{ id: 16, name: "动画" }],
            production_countries: [{ iso_3166_1: "JP", name: "Japan" }],
          };
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    const target = await prepareMovieTarget({ tmdbId: 129, qualityPreference: "4K", metadataProvider: provider });
    expect(target.title.id).toBe("tmdb_movie_129");
    expect(target.title.type).toBe("movie"); // an animated film stays a movie — 电影 shelf + movie agent

    expect(target.title.year).toBe(2001);
    expect(target.title.releaseDate).toBe("2001-07-20"); // full date kept for the reserve air-time gate
    // origin_country (mapped from production_countries) is carried so the movie agent
    // can skip the 中文 subtitle floor for 国产片 (a CN movie would carry ["CN"]).
    expect(target.title.originCountries).toEqual(["JP"]);
    expect(target.keyword).toBe("千与千寻"); // bare title — no quality token in the keyword
  });
});

const movieJson = (id: number) => ({
  id,
  title: "x",
  original_title: "x",
  release_date: "1994-01-01",
  overview: "",
  poster_path: null,
  backdrop_path: null,
  genres: [],
  origin_country: [],
});

describe("TmdbMetadataProvider multi-access fallback", () => {
  it("uses the first access and skips the rest on success", async () => {
    const calls: string[] = [];
    const provider = new TmdbMetadataProvider({
      accesses: [
        { baseURL: "https://primary.example/3", readToken: "userkey" },
        { baseURL: "https://proxy.example", readToken: "proxykey" },
      ],
      fetchJson: async (url) => {
        calls.push(url);
        return movieJson(278);
      },
    });
    await provider.getMovieDetails(278);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("https://primary.example/3/movie/278");
  });

  it("falls back to the next access when the first throws", async () => {
    const calls: string[] = [];
    const provider = new TmdbMetadataProvider({
      accesses: [
        { baseURL: "https://primary.example/3", readToken: "badkey" },
        { baseURL: "https://proxy.example" },
      ],
      fetchJson: async (url) => {
        calls.push(url);
        if (url.startsWith("https://primary.example")) throw new Error("HTTP 401");
        return movieJson(278);
      },
    });
    const details = await provider.getMovieDetails(278);
    expect(details.id).toBe(278);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("https://proxy.example/movie/278");
  });

  it("throws when every access fails", async () => {
    const provider = new TmdbMetadataProvider({
      accesses: [
        { baseURL: "https://a.example/3", readToken: "k" },
        { baseURL: "https://b.example" },
      ],
      fetchJson: async () => {
        throw new Error("boom");
      },
    });
    await expect(provider.getMovieDetails(278)).rejects.toThrow(/access/i);
  });

  it("remembers a dead access and skips it on later calls within the same provider (issue #68)", async () => {
    // The #68 repro: a user TMDB token makes api.themoviedb.org the first access.
    // When that endpoint is unreachable (blocked network) it fails per call. A
    // search fires ~11 TMDB calls; without memo, EVERY call re-pays the dead
    // direct hop → cumulative timeout → "A server error occurred". The provider
    // must probe the dead access once, then go straight to the working proxy.
    const calls: string[] = [];
    const provider = new TmdbMetadataProvider({
      accesses: [
        { baseURL: "https://primary.example/3", readToken: "userkey" },
        { baseURL: "https://proxy.example" },
      ],
      fetchJson: async (url) => {
        calls.push(url);
        if (url.startsWith("https://primary.example")) throw new Error("ETIMEDOUT");
        return movieJson(278);
      },
    });
    await provider.getMovieDetails(278);
    await provider.getMovieDetails(550);
    await provider.getMovieDetails(155);
    const primaryCalls = calls.filter((u) => u.startsWith("https://primary.example"));
    const proxyCalls = calls.filter((u) => u.startsWith("https://proxy.example"));
    expect(primaryCalls).toHaveLength(1); // probed once, then remembered as dead
    expect(proxyCalls).toHaveLength(3); // every call still resolves via the proxy
  });

  it("keys the dead set by baseURL + token, so a failing user key does not poison a working env key on the same host (Copilot #69)", async () => {
    // getTmdbAccesses produces two accesses with the SAME baseURL (TMDB direct)
    // but different tokens: the user key, then the env token. A bad user key must
    // not make later calls skip the env-token access (same host) — only the exact
    // failing access should be remembered as dead.
    const tokensTried: string[] = [];
    const provider = new TmdbMetadataProvider({
      accesses: [
        { baseURL: "https://api.themoviedb.org/3", readToken: "bad-user-key" },
        { baseURL: "https://api.themoviedb.org/3", readToken: "good-env-key" },
        { baseURL: "https://proxy.example" },
      ],
      fetchJson: async (_url, init) => {
        const auth = init.headers.Authorization ?? "(none)";
        tokensTried.push(auth);
        if (auth === "Bearer bad-user-key") throw new Error("HTTP 401");
        return movieJson(278);
      },
    });
    await provider.getMovieDetails(278);
    await provider.getMovieDetails(550);
    await provider.getMovieDetails(155);
    // The good env key is used on every call; the proxy is never needed.
    expect(tokensTried.filter((a) => a === "Bearer good-env-key")).toHaveLength(3);
    expect(tokensTried.filter((a) => a === "(none)")).toHaveLength(0); // proxy never hit
    // The bad user key is probed once, then remembered as dead (not retried).
    expect(tokensTried.filter((a) => a === "Bearer bad-user-key")).toHaveLength(1);
  });

  it("the dead key keeps readToken undefined distinct from an empty-string token (Copilot #70)", async () => {
    // `readToken: ""` (Authorization "Bearer ") and `readToken: undefined` (no
    // Authorization) are different accesses; the dead-access key must not conflate
    // them via `?? ""`, else a failing "" access on a host would also disable the
    // undefined-token access there. (Defensive: getTmdbAccesses never emits "".)
    let proxyHits = 0;
    const provider = new TmdbMetadataProvider({
      accesses: [
        { baseURL: "https://same.example/3", readToken: "" }, // Authorization "Bearer " → fails
        { baseURL: "https://same.example/3" }, // undefined token, same host → must stay live
        { baseURL: "https://proxy.example" },
      ],
      fetchJson: async (url, init) => {
        if (url.startsWith("https://proxy.example")) {
          proxyHits += 1;
          return movieJson(278);
        }
        if (init.headers.Authorization === "Bearer ") throw new Error("HTTP 401");
        return movieJson(278); // the undefined-token same-host access succeeds
      },
    });
    await provider.getMovieDetails(278);
    await provider.getMovieDetails(550);
    // The undefined-token direct access serves every call; the proxy is never needed.
    expect(proxyHits).toBe(0);
  });

  it("sends Authorization only when the access has a readToken", async () => {
    const seen: Array<Record<string, string>> = [];
    const provider = new TmdbMetadataProvider({
      accesses: [{ baseURL: "https://proxy.example" }],
      fetchJson: async (_url, init) => {
        seen.push(init.headers);
        return movieJson(1);
      },
    });
    await provider.getMovieDetails(1);
    expect(seen[0]?.Authorization).toBeUndefined();
  });

  it("still supports the legacy single readToken option", async () => {
    const seen: Array<Record<string, string>> = [];
    const provider = new TmdbMetadataProvider({
      readToken: "legacy",
      fetchJson: async (_url, init) => {
        seen.push(init.headers);
        return movieJson(1);
      },
    });
    await provider.getMovieDetails(1);
    expect(seen[0]?.Authorization).toBe("Bearer legacy");
  });
});

describe("TmdbSearchProvider multi-access fallback", () => {
  it("falls back to the proxy access when the user key fails", async () => {
    const calls: string[] = [];
    const provider = new TmdbSearchProvider({
      accesses: [
        { baseURL: "https://primary.example/3", readToken: "badkey" },
        { baseURL: "https://proxy.example" },
      ],
      fetchJson: async (url) => {
        calls.push(url);
        if (url.startsWith("https://primary.example")) throw new Error("HTTP 429");
        return { results: [] };
      },
    });
    const out = await provider.searchMedia({ query: "matrix" });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("https://proxy.example/search/multi");
  });
});

describe("createTmdbMetadataProvider / createTmdbSearchProvider", () => {
  it("builds a metadata provider from an access list", async () => {
    const provider = createTmdbMetadataProvider([{ baseURL: "https://proxy.example" }], {
      fetchJson: async () => movieJson(9),
    });
    expect((await provider.getMovieDetails(9)).id).toBe(9);
  });

  it("builds a search provider from an access list", async () => {
    const provider = createTmdbSearchProvider([{ baseURL: "https://proxy.example" }], {
      fetchJson: async () => ({ results: [] }),
    });
    expect(await provider.searchMedia({ query: "x" })).toEqual([]);
  });
});

describe("per-access timeout + timeout retry (2026-07-02 压测发现:软路由→CF Worker 基线 2.4s,4.5s 死限抖动即崩)", () => {
  it("direct api.themoviedb.org hop keeps the fail-fast timeout; other hops (proxy) get the patient one", async () => {
    const timeouts: Array<number | undefined> = [];
    const provider = new TmdbMetadataProvider({
      accesses: [
        { baseURL: "https://api.themoviedb.org/3", readToken: "userkey" },
        { baseURL: "https://proxy.example" },
      ],
      fetchJson: async (url, init) => {
        timeouts.push(init.timeoutMs);
        if (url.startsWith("https://api.themoviedb.org")) throw new Error("TMDB request failed with HTTP 500");
        return movieJson(278);
      },
    });
    await provider.getMovieDetails(278);
    expect(timeouts).toEqual([4500, 12000]);
  });

  it("retries the WHOLE chain once when every access failed and at least one failure was a timeout", async () => {
    let calls = 0;
    const provider = new TmdbMetadataProvider({
      accesses: [{ baseURL: "https://proxy.example" }],
      fetchJson: async () => {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
        }
        return movieJson(278);
      },
    });
    const details = await provider.getMovieDetails(278);
    expect(details.id).toBe(278);
    expect(calls).toBe(2); // first pass timed out, single retry pass succeeded
  });

  it("does NOT retry when the failures were not timeouts (401s keep failing fast)", async () => {
    let calls = 0;
    const provider = new TmdbMetadataProvider({
      accesses: [{ baseURL: "https://proxy.example", readToken: "k" }],
      fetchJson: async () => {
        calls += 1;
        throw new Error("TMDB request failed with HTTP 401");
      },
    });
    await expect(provider.getMovieDetails(278)).rejects.toThrow(/access/i);
    expect(calls).toBe(1);
  });

  it("a retry-pass success HEALS the dead-access memo — the next call goes straight through", async () => {
    let calls = 0;
    const provider = new TmdbMetadataProvider({
      accesses: [{ baseURL: "https://proxy.example" }],
      fetchJson: async () => {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
        }
        return movieJson(278);
      },
    });
    await provider.getMovieDetails(278); // timeout → retry → success (2 calls), memo healed
    await provider.getMovieDetails(278); // healed memo → single straight call
    expect(calls).toBe(3);
  });
});
