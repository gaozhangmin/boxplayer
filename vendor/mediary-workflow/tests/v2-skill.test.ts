import { describe, expect, it } from "vitest";
import { readSkillSection, SKILL_SECTION_NAMES, skillIndexForAgent } from "../src/acquisition-v2/skill.js";

/**
 * The acquisition skill is the agent's on-demand "manual" — the localized,
 * progressive-disclosure reference (like the original SKILL.md + references/),
 * read via the readSkill tool during the loop. These tests lock in that every
 * responsibility section exists, is non-trivial, is localized to the V2 sandbox
 * tools (never raw pan115/cid/manual-dir mechanics), and that each agent gets an
 * index pointing at exactly its sections.
 */

describe("acquisition skill — localized, sectioned, on-demand manual", () => {
  it("exposes every responsibility section with substantive content", () => {
    for (const name of SKILL_SECTION_NAMES) {
      const body = readSkillSection(name);
      expect(body, name).toBeTruthy();
      expect(body.length, name).toBeGreaterThan(200); // a real section, not a stub
    }
  });

  it("covers the responsibilities the live test proved were missing", () => {
    expect(SKILL_SECTION_NAMES).toEqual(
      expect.arrayContaining(["protocol", "dead-links-black-box", "dedup", "movie", "tv", "mistakes"]),
    );
  });

  it("is LOCALIZED — sections reference V2 sandbox tools, never the original pan115/cid/manual-dir mechanics", () => {
    const all = SKILL_SECTION_NAMES.map((name) => readSkillSection(name)).join("\n");
    // Speaks in V2 tools:
    expect(all).toMatch(/transferCandidate/);
    expect(all).toMatch(/inspectStaging/);
    expect(all).toMatch(/moveToSeason/);
    expect(all).toMatch(/markObtained/);
    // Never the original Mac/openclaw mechanics the V2 agent does NOT have:
    expect(all).not.toMatch(/pan115\./);
    expect(all).not.toMatch(/create_folder/);
    expect(all).not.toMatch(/flatten_directory\(/);
    expect(all).not.toMatch(/\.venv/);
    expect(all).not.toMatch(/_CID\b/);
  });

  it("the black-box section enforces inspect-after-transfer verification (the 奥本海默 fix)", () => {
    const blackBox = readSkillSection("dead-links-black-box");
    expect(blackBox).toMatch(/inspectStaging/);
    expect(blackBox.toLowerCase()).toMatch(/verif/); // must verify coverage after a black-box transfer
  });

  it("the protocol section teaches decide-the-covering-set-then-batch (not serial transfer-one-research)", () => {
    const protocol = readSkillSection("protocol");
    expect(protocol.toLowerCase()).toMatch(/evidence/);
    expect(protocol.toLowerCase()).toMatch(/decision|decide/);
    expect(protocol.toLowerCase()).toMatch(/batch|back-to-back|covering set|without searching/);
  });

  it("the tv section teaches the EXACT batch distribution usage: plan the full distribution → ONE call → verify the returned seasons", () => {
    const tv = readSkillSection("tv");
    expect(tv).toMatch(/\{moves:\s*\[\{season/); // the exact tool shape
    expect(tv.toLowerCase()).toMatch(/plan the (whole|full) distribution/); // plan first
    expect(tv.toLowerCase()).toMatch(/verify.*(returned|season)/); // verify the returned seasons after the batch
    expect(tv.toLowerCase()).toMatch(/subtitle/); // each video's subtitle rides in the same season's fileIds
  });

  it("gives each agent an index pointing at exactly its responsibility sections", () => {
    const movieIndex = skillIndexForAgent("movie");
    expect(movieIndex).toMatch(/movie/);
    expect(movieIndex).toMatch(/protocol/);
    expect(movieIndex).not.toMatch(/\btv\b/); // movie agent isn't pointed at the tv section
    expect(movieIndex).toMatch(/readSkill/);

    const tvIndex = skillIndexForAgent("tv");
    expect(tvIndex).toMatch(/\btv\b/);
    expect(tvIndex).toMatch(/protocol/);
    expect(tvIndex).toMatch(/readSkill/);
  });
});

describe("SEARCH section — raw 活期文档 doctrine (Task 5: C2/C3)", () => {
  it("teaches raw is best practice and the results are already pre-searched in viewResourceSnapshot", () => {
    const search = readSkillSection("search");
    expect(search).toMatch(/viewResourceSnapshot/);
    expect(search).toMatch(/活期文档/);
    expect(search).toMatch(/raw|裸/);
  });

  it("carries the blood-and-tears measurement table (raw recall vs quality/year-narrowed)", () => {
    const search = readSkillSection("search");
    expect(search).toContain("铁拳教育");
    expect(search).toContain("84");
    expect(search).toContain("奥本海默");
    expect(search).toContain("185");
    expect(search).toContain("庆余年");
    expect(search).toContain("146");
  });

  it("demotes searchResources to 繁体/英文 upgrades only (not for re-searching raw)", () => {
    const search = readSkillSection("search");
    expect(search).toMatch(/繁体|英文/);
    expect(search).toMatch(/searchResources/);
  });

  it("teaches reading discipline: find a good cover → use it; only reportNoCoverage after reading the WHOLE document", () => {
    const search = readSkillSection("search");
    expect(search).toMatch(/通读|读完|全部/);
    expect(search).toMatch(/reportNoCoverage/);
  });
});
