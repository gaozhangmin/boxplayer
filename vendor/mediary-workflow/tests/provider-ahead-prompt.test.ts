import { describe, expect, it } from "vitest";
import { buildTvAnimeSystemPrompt, buildMovieSystemPrompt } from "../src/acquisition-v2/task-agents.js";
import { readSkillSection } from "../src/acquisition-v2/skill.js";

// #4: a coherent full-season pack often carries episodes BEYOND TMDB's aired cursor
// (the release is ahead of TMDB). The agent must mark those (verified-landed) episodes
// too — sync-need records them as provider-ahead and the frontend shows 超前 — instead
// of "leaving them for the patrol". Safety: only VERIFIED-landed episodes from a coherent
// full pack, never episodes a pack merely claims.
describe("coverage honesty — trust a full pack's beyond-aired episodes (#4 provider-ahead)", () => {
  it("tv/anime: marks verified-landed beyond-aired episodes as provider-ahead", () => {
    const p = buildTvAnimeSystemPrompt({});
    // NEW #4 clause — distinctive phrases absent from the prior prompt:
    expect(p).toContain("ahead of TMDB"); // a full pack can be ahead of TMDB's aired count
    expect(p).toMatch(/markObtained them too[\s\S]{0,80}provider-ahead/i); // mark them → recorded provider-ahead
    // must MOVE the extra episodes into the season dir, or discardStaging wipes them (Copilot #23):
    expect(p).toMatch(/moveToSeason[^.]{0,140}discardStaging|discardStaging[^.]{0,140}moveToSeason/i);
    // hard-safety wording specific to this clause (not a generic 'inspect' elsewhere):
    expect(p).toContain("a pack merely claims");
    // clause-specific distinction (not an incidental 'patrol' elsewhere): genuinely-unaired
    // (no resource) is still left for the patrol, kept separate from provider-ahead.
    expect(p).toContain("no resource exists for those");
  });

  it("movie prompt is unaffected (no seasons/episodes)", () => {
    expect(buildMovieSystemPrompt({})).not.toContain("provider-ahead");
  });

  // ROOT CAUSE of the live #4 failure (quark 超市, run 36ce0a93): the agent READS the TV
  // skill manual (readSkill("tv")) and is told to trust it over memory. PR#23 added
  // provider-ahead to the SYSTEM PROMPT but NOT to skill.ts — whose "Coverage honesty"
  // said only "leave unaired for the patrol", contradicting it. The agent followed the
  // manual and only took the aired E01 despite a full 12-集 中字 pack being present.
  it("skill.ts TV manual's coverage-honesty carries the provider-ahead carve-out (not just 'leave unaired')", () => {
    const tv = readSkillSection("tv");
    expect(tv).toMatch(/provider-ahead|超前/i); // the manual must name provider-ahead
    expect(tv).toMatch(/ahead of TMDB|beyond the aired|BEYOND the aired/i); // the full-pack-ahead case
    expect(tv).toContain("markObtained"); // … and that you mark the verified-landed extras
    // hard-safety must travel with it — assert the distinctive clause wording, not a loose
    // word that could match anywhere else in the manual:
    expect(tv).toContain("a pack merely claims in its title");
  });
});
