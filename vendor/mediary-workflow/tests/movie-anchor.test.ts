import { describe, expect, it } from "vitest";
import { movieAnchorSeason } from "../src/index.js";

describe("movieAnchorSeason", () => {
  it("builds a single-episode completed anchor for a movie title", () => {
    const anchor = movieAnchorSeason({
      titleId: "tmdb_movie_872585",
      qualityPreference: "4K",
      storageDirectoryId: "dir_movie",
    });
    expect(anchor).toEqual({
      id: "tmdb_movie_872585_movie",
      mediaTitleId: "tmdb_movie_872585",
      seasonNumber: 1,
      status: "completed",
      qualityPreference: "4K",
      storageDirectoryId: "dir_movie",
      totalEpisodes: 1,
      latestAiredEpisode: 1,
      latestAiredSource: "manual",
    });
  });
});
