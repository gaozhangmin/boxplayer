import { describe, expect, it } from "vitest";
import { buildTvAnimeSystemPrompt, buildMovieSystemPrompt } from "../src/acquisition-v2/task-agents.js";

// #2: the user's emphatic complaint was "语言偏好一点屁用没有" — the agent settled for raw.
// 中文 is a HARD floor for TV/anime: when no 中文-subbed candidate is reachable, reportNoCoverage
// rather than land 生肉 (raw Japanese is unwatchable AND would falsely mark an episode obtained,
// blocking the patrol). 2026-06-27 (环太平洋): MOVIES get a last-resort SOFT fallback — when the
// search budget is exhausted and no 中字 is reachable but a correct-film raw match exists, land it
// (flagged 可能无中字); 有正片胜过没资源, and the release may carry undeclared embedded subs.
describe("language preference — 中文 floor: HARD for TV/anime, SOFT fallback for movie", () => {
  it("tv/anime: 中文 unreachable → report no-coverage, never land raw (hard floor)", () => {
    const p = buildTvAnimeSystemPrompt({ preferredLanguage: "中文" });
    expect(p).toContain("中文 subtitles — a HARD requirement");
    expect(p).toContain("NOT acceptable coverage");
    expect(p).toContain("该盘无中文字幕源");
    expect(p).not.toContain("weak coverage");
    expect(p).not.toContain("subtitleFallback"); // no fallback for TV/anime
  });

  it("movie: 中字 preferred, last-resort raw fallback authorized + flagged (not a hard floor)", () => {
    const p = buildMovieSystemPrompt({ preferredLanguage: "中文" });
    expect(p).not.toContain("中文 subtitles — a HARD requirement");
    expect(p).toContain("subtitleFallback");
    expect(p).toMatch(/兜底|可能无中文字幕/);
  });

  it("no preference set → no language block (不限)", () => {
    expect(buildTvAnimeSystemPrompt({})).not.toContain("LANGUAGE PREFERENCE");
    expect(buildMovieSystemPrompt({})).not.toContain("LANGUAGE PREFERENCE");
  });
});
