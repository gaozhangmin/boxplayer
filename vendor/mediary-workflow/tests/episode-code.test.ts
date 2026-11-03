import { describe, expect, it } from "vitest";
import { episodeCodeFromFileName } from "../src/index.js";

describe("episodeCodeFromFileName", () => {
  it("parses standard SxxExx names", () => {
    expect(episodeCodeFromFileName("Show.S02E12.2160p.mkv")).toBe("S02E12");
    expect(episodeCodeFromFileName("show s01e05.mkv")).toBe("S01E05");
  });

  it("parses 4-digit episode numbers for 1000+ episode anime (One Piece etc.)", () => {
    // \d{1,3} truncated "E1050" -> "E105"; long-running anime needs 4 digits.
    expect(episodeCodeFromFileName("One.Piece.S01E1050.mkv")).toBe("S01E1050");
    expect(episodeCodeFromFileName("海贼王 第1050集.mp4")).toBe("S01E1050");
  });

  it("does not mistake a stray non-episode number for the episode", () => {
    // No [Ee] prefix before 2160 — quality, not an episode.
    expect(episodeCodeFromFileName("Show.S01E05.2160p.mkv")).toBe("S01E05");
    expect(episodeCodeFromFileName("Movie.2023.2160p.mkv")).toBeNull();
  });
});
