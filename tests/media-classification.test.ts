import { describe, expect, it } from "vitest";
import { classifyMediaType } from "../src/index.js";

describe("classifyMediaType", () => {
  it("classifies a Japanese animation series as anime", () => {
    expect(
      classifyMediaType({ baseType: "tv", genreIds: [16, 10765], originCountries: ["JP"] }),
    ).toBe("anime");
  });

  it("classifies a Chinese animation series (国漫) as anime", () => {
    // 国漫 (e.g. 一人之下): Animation genre + CN origin → 动漫 shelf, like 日漫.
    expect(classifyMediaType({ baseType: "tv", genreIds: [16], originCountries: ["CN"] })).toBe(
      "anime",
    );
  });

  it("keeps a Japanese animated MOVIE as a movie (a film is a film)", () => {
    // 你的名字 / 千与千寻: animation genre + JP, but a movie stays a movie — it
    // belongs on the 电影 shelf and routes to the movie agent, not 动漫.
    expect(classifyMediaType({ baseType: "movie", genreIds: [16], originCountries: ["JP"] })).toBe(
      "movie",
    );
  });

  it("keeps a Chinese animated MOVIE as a movie too", () => {
    expect(classifyMediaType({ baseType: "movie", genreIds: [16], originCountries: ["CN"] })).toBe(
      "movie",
    );
  });

  it("classifies a Western animation series (美漫, e.g. 无敌少侠) as anime — any animation counts", () => {
    expect(classifyMediaType({ baseType: "tv", genreIds: [16], originCountries: ["US"] })).toBe(
      "anime",
    );
  });

  it("classifies a Korean animation series as anime too (origin no longer matters)", () => {
    expect(classifyMediaType({ baseType: "tv", genreIds: [16], originCountries: ["KR"] })).toBe(
      "anime",
    );
  });

  it("classifies an animation series with no origin info as anime (genre is the only signal)", () => {
    expect(classifyMediaType({ baseType: "tv", genreIds: [16], originCountries: [] })).toBe("anime");
  });

  it("keeps a live-action Japanese series as tv (animation genre required)", () => {
    expect(classifyMediaType({ baseType: "tv", genreIds: [18], originCountries: ["JP"] })).toBe("tv");
  });

  it("falls back to the base type when genre/origin are unknown", () => {
    expect(classifyMediaType({ baseType: "movie", genreIds: [], originCountries: [] })).toBe("movie");
    expect(classifyMediaType({ baseType: "tv", genreIds: [], originCountries: [] })).toBe("tv");
  });
});
