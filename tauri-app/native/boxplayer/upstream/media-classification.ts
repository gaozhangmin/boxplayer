import type { MediaType } from "./domain.js";

/** TMDB genre id for "Animation" (shared by tv and movie). */
const ANIMATION_GENRE_ID = 16;

/**
 * Refine a base TMDB type into the library's shelf type.
 *
 * - A **movie is always a movie** — an animated film (你的名字, 哪吒) belongs on the
 *   电影 shelf and routes to the movie agent. Animation genre never reshelves a film.
 * - A **series** becomes "anime" whenever it's the Animation genre, regardless of
 *   origin — 日漫 / 国漫 / 美漫 (无敌少侠) / anything animated. The 动漫 shelf means
 *   "all animated series", not a region. (`originCountries` is kept in the signature
 *   for callers but no longer affects the result.)
 */
export function classifyMediaType(input: {
  baseType: Extract<MediaType, "tv" | "movie">;
  genreIds: number[];
  originCountries: string[];
}): MediaType {
  if (input.baseType === "movie") {
    return "movie";
  }
  return input.genreIds.includes(ANIMATION_GENRE_ID) ? "anime" : "tv";
}
