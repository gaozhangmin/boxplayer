import { describe, expect, it } from "vitest";
import {
  animeSearchTabooWarnings,
  getQualityGuidance,
  getSearchRecipe,
  searchProfile,
  SEARCH_PROFILES,
} from "../src/index.js";

describe("getSearchRecipe — post-deep-research recipe", () => {
  it("us-tv leads with 裸中文名 (NOT the old 别裸搜/+美剧), and forbids +美剧", () => {
    const r = getSearchRecipe("us-tv");
    expect(r).not.toContain("别裸搜");
    expect(r).toMatch(/首搜[^。]*中文/); // bare Chinese name first
    expect(r).toMatch(/避免[^]*美剧|美剧[^]*(有害|禁|避免|别)/); // +美剧 forbidden
  });

  it("cn-anime leads with 裸中文名 (research bare=0 was API jitter) and forbids +年份", () => {
    const r = getSearchRecipe("cn-anime");
    expect(r).toMatch(/首搜[^。]*中文|裸中文名/);
    expect(r).toMatch(/避免[^]*年份|年份[^]*(危险|避免|禁)/); // +年份 dangerous (拉真人版)
    expect(r).toContain("国漫"); // +国漫 still present as disambiguator
  });

  it("jp-anime forbids +年份 (脆/偏) and mandates 复搜 on 0", () => {
    const r = getSearchRecipe("jp-anime");
    expect(r).toMatch(/避免[^]*年份|年份[^]*(避免|禁|脆|别)/);
    expect(r).toMatch(/复搜/);
  });

  it("universal laws: 复搜 hardened (multiple times), 子类型词 forbidden (国漫 exception), 语言 follows 字幕偏好", () => {
    const r = getSearchRecipe("movie"); // laws ride on every recipe
    expect(r).toMatch(/复搜[^。]*[2-3]|[2-3][^。]*次/); // re-search 2-3 times
    expect(r).toContain("子类型词"); // the new sub-type-token law
    expect(r).toContain("国漫"); // its stated exception
    expect(r).toMatch(/字幕偏好|偏好[^。]*中文译名/); // search-language-follows-subtitle law
  });
});

describe("searchProfile", () => {
  it("maps any movie to the single movie profile, regardless of origin", () => {
    expect(searchProfile({ type: "movie", originCountries: ["CN"] })).toBe("movie");
    expect(searchProfile({ type: "movie", originCountries: ["JP"] })).toBe("movie");
    expect(searchProfile({ type: "movie", originCountries: [] })).toBe("movie");
  });

  it("splits tv by origin (cn/us/kr/jp), else generic-tv", () => {
    expect(searchProfile({ type: "tv", originCountries: ["CN"] })).toBe("cn-tv");
    expect(searchProfile({ type: "tv", originCountries: ["US"] })).toBe("us-tv");
    expect(searchProfile({ type: "tv", originCountries: ["KR"] })).toBe("kr-tv");
    expect(searchProfile({ type: "tv", originCountries: ["JP"] })).toBe("jp-tv");
    expect(searchProfile({ type: "tv", originCountries: ["GB"] })).toBe("generic-tv");
    expect(searchProfile({ type: "tv", originCountries: [] })).toBe("generic-tv");
  });

  it("splits anime by origin (jp/cn/us), else generic-anime", () => {
    expect(searchProfile({ type: "anime", originCountries: ["JP"] })).toBe("jp-anime");
    expect(searchProfile({ type: "anime", originCountries: ["CN"] })).toBe("cn-anime");
    expect(searchProfile({ type: "anime", originCountries: ["US"] })).toBe("us-anime");
    expect(searchProfile({ type: "anime", originCountries: ["KR"] })).toBe("generic-anime");
    expect(searchProfile({ type: "anime", originCountries: [] })).toBe("generic-anime");
  });

  it("resolves co-productions by a deterministic precedence", () => {
    // anime: JP wins (anime is JP-centric); tv: CN wins (indexed in the 国产/合拍 circle).
    expect(searchProfile({ type: "anime", originCountries: ["US", "JP"] })).toBe("jp-anime");
    expect(searchProfile({ type: "tv", originCountries: ["US", "CN"] })).toBe("cn-tv");
  });
});

describe("getQualityGuidance", () => {
  it("returns empty for 不限 / undefined", () => {
    expect(getQualityGuidance("movie", undefined)).toBe("");
    expect(getQualityGuidance("jp-anime", undefined)).toBe("");
  });

  it("high on a 4K-reachable profile promises real 4K + coverage-first fallback", () => {
    const g = getQualityGuidance("us-tv", "high");
    expect(g).toContain("高");
    expect(g).toMatch(/2160p|4K/);
    expect(g).toContain("覆盖"); // coverage-first fallback present
    expect(g).not.toMatch(/极少|没有|稀缺/); // reachable → not the scarcity warning
  });

  it("high prefers playable REMUX/video and warns AGAINST 原盘/ISO disc images", () => {
    // Live e2e caught a 100GB 4K BD原盘 .iso being picked — high quality but
    // unplayable, not a single video. Guidance must steer to REMUX/video.
    for (const p of ["movie", "us-tv", "jp-anime"] as const) {
      const g = getQualityGuidance(p, "high");
      expect(g).toContain("REMUX");
      expect(g).toMatch(/避免[^]*?(ISO|原盘|BDMV)/); // AVOID disc images, not promote them
    }
  });

  it("cn-anime is 4K-reachable (GM-Team HEVC=4K) — high guidance is NOT the scarcity variant", () => {
    const g = getQualityGuidance("cn-anime", "high");
    expect(g).toMatch(/2160p|4K/);
    expect(g).not.toMatch(/极少|没有|稀缺/);
  });

  it("high on a 4K-scarce profile warns 4K is rare and forbids over-searching", () => {
    for (const p of ["jp-anime", "us-anime", "jp-tv"] as const) {
      const g = getQualityGuidance(p, "high");
      expect(g).toMatch(/极少|没有|稀缺/); // scarcity stated
      expect(g).toMatch(/过度搜索|撞限|预算/); // over-search warning
      expect(g).toContain("1080"); // realistic ceiling
    }
  });

  it("medium targets 1080p, coverage-first, and reminds quality never enters the keyword", () => {
    const g = getQualityGuidance("movie", "medium");
    expect(g).toContain("1080");
    expect(g).toContain("覆盖");
    expect(g).toMatch(/不进搜索|不进关键词|召回后/);
  });

  it("medium has a CEILING — avoid 4K/2160p/REMUX/原盘 by title token before transfer", () => {
    // Live bug: quality=medium still 秒传'd a 74.9GB 4K REMUX into a 15GB drive.
    // Root cause was an asymmetric (floor-only) medium guidance: it told the agent
    // to prefer 1080p but never to AVOID over-spec 4K/remux. medium must mirror
    // high's two-sidedness — a ceiling so the agent skips 2160p/4K/REMUX/原盘 by
    // reading the candidate TITLE *before* transferring (so the giant file is
    // never 秒传'd → no recycle-bin accumulation).
    for (const p of SEARCH_PROFILES) {
      const g = getQualityGuidance(p, "medium");
      // names the over-spec tokens to avoid
      expect(g).toMatch(/2160p|4K/);
      expect(g).toContain("REMUX");
      expect(g).toMatch(/原盘|ISO|BDMV/);
      // frames them as something to AVOID/不取, not to prefer
      expect(g).toMatch(/避免|别选|不取|跳过/);
      // the decision is by-title, pre-transfer (no delete-and-redo)
      expect(g).toMatch(/转存前|落盘前|读标题|看标题/);
    }
  });

  it("medium yields ONE tier for Chinese subs (4K中字 beats 1080p无中字), but keeps the bloated-disc ceiling", () => {
    const g = getQualityGuidance("movie", "medium");
    expect(g).toContain("中字");
    expect(g).toContain("破一档");
    // still avoids 原盘/REMUX/ISO even for subs (no unlimited bump)
    expect(g).toMatch(/原盘|REMUX|ISO/);
  });
});

describe("animeSearchTabooWarnings（病2b — 硬规则转校验器，警告不阻断）", () => {
  const titleTerms = ["新攻壳机动队", "攻壳机动队", "Ghost in the Shell"];

  it("动漫 + 4位年份 → 年份警告（攻壳事故的「2020」）", () => {
    const w = animeSearchTabooWarnings({ keyword: "攻壳机动队 2020", profile: "jp-anime", titleTerms });
    expect(w.some((x) => x.includes("年份"))).toBe(true);
  });

  it("年份是正牌标题的一部分 → 豁免（SAC_2045 / 2046 这类片名自带年份数字）", () => {
    // 问询判卷抓出的误伤面：MiMo 的合法升级词「攻殻機動隊 SAC_2045」会被年份
    // 规则误警——2045 就是官方标题的一部分。出现在任一 titleTerm 里的 4 位数字
    // 不是禁忌年份，是名字。
    const terms = ["攻壳机动队 SAC_2045", "攻殻機動隊 SAC_2045", "Ghost in the Shell: SAC_2045"];
    const w = animeSearchTabooWarnings({ keyword: "攻殻機動隊 SAC_2045", profile: "jp-anime", titleTerms: terms });
    expect(w.some((x) => x.includes("年份"))).toBe(false);
  });

  it("动漫 + 片名外的拉丁附加词 → 疑似跨系列警告（攻壳事故的「ARISE」）", () => {
    const w = animeSearchTabooWarnings({ keyword: "攻壳机动队 ARISE", profile: "jp-anime", titleTerms });
    expect(w.some((x) => x.includes("ARISE"))).toBe(true);
  });

  it("拉丁词是片名/别名的一部分 → 不警告（正当的英文名升级）", () => {
    const w = animeSearchTabooWarnings({ keyword: "Ghost in the Shell", profile: "jp-anime", titleTerms });
    expect(w).toEqual([]);
  });

  it("动漫 + 子类型词(番剧) → 警告", () => {
    const w = animeSearchTabooWarnings({ keyword: "攻壳机动队 番剧", profile: "jp-anime", titleTerms });
    expect(w.some((x) => x.includes("番剧"))).toBe(true);
  });

  it("国漫例外：cn-anime 的 +国漫 是配方明令的消歧词，不警告", () => {
    const w = animeSearchTabooWarnings({ keyword: "一人之下 国漫", profile: "cn-anime", titleTerms: ["一人之下"] });
    expect(w).toEqual([]);
  });

  it("cn-anime 年份照警（配方明言年份危险：拉同名真人版）", () => {
    const w = animeSearchTabooWarnings({ keyword: "一人之下 2021", profile: "cn-anime", titleTerms: ["一人之下"] });
    expect(w.some((x) => x.includes("年份"))).toBe(true);
  });

  it("非动漫 profile → 永远空（年份是真人片的合法收窄键）", () => {
    const w = animeSearchTabooWarnings({ keyword: "默杀 2024", profile: "movie", titleTerms: ["默杀"] });
    expect(w).toEqual([]);
  });

  it("干净的裸标题 → 空", () => {
    const w = animeSearchTabooWarnings({ keyword: "攻壳机动队", profile: "jp-anime", titleTerms });
    expect(w).toEqual([]);
  });
});
