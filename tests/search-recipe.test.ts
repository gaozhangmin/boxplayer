import { describe, expect, it } from "vitest";
import { getSearchRecipe, SEARCH_PROFILES } from "../src/index.js";

describe("getSearchRecipe", () => {
  it("every profile yields a non-empty recipe that carries the universal laws", () => {
    for (const profile of SEARCH_PROFILES) {
      const text = getSearchRecipe(profile);
      expect(text.length).toBeGreaterThan(40);
      // Universal laws must ride along on every recipe.
      expect(text).toContain("复搜"); // 单次 0 必复搜
      expect(text).toContain("画质"); // 画质≠搜索词
    }
  });

  it("encodes the profile-specific lead strategy", () => {
    expect(getSearchRecipe("movie")).toContain("裸中文名");
    expect(getSearchRecipe("us-tv")).toContain("裸中文译名"); // 2026-06-17 纠偏:中文名先行(带中字),非英文名
    expect(getSearchRecipe("cn-anime")).toContain("国漫"); // +国漫 同名消歧
    expect(getSearchRecipe("jp-anime")).toContain("1080"); // 要画质用 +1080P 非 4K
    expect(getSearchRecipe("kr-tv")).toContain("译名");
    expect(getSearchRecipe("us-anime")).toContain("英文名");
  });

  it("us-tv now LEADS with bare 中文译名 (not the old 别裸搜) and forbids +美剧", () => {
    const r = getSearchRecipe("us-tv");
    expect(r).not.toContain("别裸搜");
    expect(r).toMatch(/首搜[^。]*中文译名/);
    expect(r).toMatch(/美剧[^。]*(有害|0 胜 7|0-for-7)|避免[^]*美剧/);
  });

  it("movie recipe judges 中字 by reading titles (CHS-ENG…) and forbids 中字/国语 marker keywords (环太平洋 lesson)", () => {
    const movie = getSearchRecipe("movie");
    expect(movie).toContain("CHS-ENG"); // recognize 中字 by reading the release name
    expect(movie).toContain("别把"); // do NOT append 中字/国语/双语/字幕 markers (cut recall)
  });
});
