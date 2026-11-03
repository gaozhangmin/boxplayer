import { describe, expect, it } from "vitest";
import { buildMovieSystemPrompt, buildTvAnimeSystemPrompt } from "../src/index.js";

describe("system prompt searchHints injection", () => {
  it("injects the per-run recipe into the tv/anime prompt when provided", () => {
    const p = buildTvAnimeSystemPrompt({ searchHints: "RECIPE-TV-XYZ" });
    expect(p).toContain("RECIPE-TV-XYZ");
    expect(p).toContain("SEARCH STRATEGY"); // labelled block
  });

  it("injects the recipe into the movie prompt when provided", () => {
    expect(buildMovieSystemPrompt({ searchHints: "RECIPE-MOV-XYZ" })).toContain("RECIPE-MOV-XYZ");
  });

  it("omits the block entirely when no hints (no empty label)", () => {
    expect(buildTvAnimeSystemPrompt({})).not.toContain("SEARCH STRATEGY");
    expect(buildMovieSystemPrompt({})).not.toContain("SEARCH STRATEGY");
  });
});
