import { describe, expect, it } from "vitest";
import { buildMovieSystemPrompt, buildTvAnimeSystemPrompt } from "../src/index.js";

describe("languageLine — Chinese-subtitle selection guidance", () => {
  it("no preference → no LANGUAGE PREFERENCE block", () => {
    expect(buildMovieSystemPrompt({})).not.toContain("LANGUAGE PREFERENCE");
  });

  it("中文 preference → release-nature judgement (strip prefix, scene vs community, no subtitle-file trust); movie SOFT, tv HARD", () => {
    const p = buildMovieSystemPrompt({ preferredLanguage: "中文" });
    expect(p).toContain("LANGUAGE PREFERENCE");
    // judge by the release, after stripping PanSou's prepended Chinese name
    expect(p).toContain("STRIP");
    // recognise English scene releases as no-Chinese-subs
    expect(p).toMatch(/scene/i);
    // a Chinese-community release implies subs without a literal 中字 token
    expect(p).toContain("中字");
    // never infer from subtitle file / mkv
    expect(p).toMatch(/mkv/i);
    // movie: SOFT last-resort fallback (NOT a hard floor) — the 环太平洋 fix
    expect(p).toContain("subtitleFallback");
    expect(p).not.toContain("中文 subtitles — a HARD requirement");
    // the shared release-nature wording reaches the TV/anime prompt too — which IS hard
    const tv = buildTvAnimeSystemPrompt({ preferredLanguage: "中文" });
    expect(tv).toContain("STRIP");
    expect(tv).toContain("HARD");
  });

  it("non-Chinese preference → still gives a generic release-language line (no regression)", () => {
    const p = buildMovieSystemPrompt({ preferredLanguage: "English" });
    expect(p).toContain("LANGUAGE PREFERENCE");
    expect(p).toContain("English");
  });
});

describe("languageLine — 国产 (CN-origin) content needs no 中字 judgement (国产电影 fix)", () => {
  it("movie + 中文 + CN origin → 国产 native line, the 中字 floor is skipped entirely", () => {
    const p = buildMovieSystemPrompt({ preferredLanguage: "中文", originCountries: ["CN"] });
    expect(p).toMatch(/国产|原生中文|中文对白/);
    expect(p).toMatch(/无需|不需要/);
    expect(p).not.toContain("subtitleFallback"); // no fallback machinery
    expect(p).not.toContain("HARD requirement"); // no hard floor
  });

  it("movie + 中文 + foreign origin (US) → soft subtitle fallback (unchanged)", () => {
    const p = buildMovieSystemPrompt({ preferredLanguage: "中文", originCountries: ["US"] });
    expect(p).toContain("subtitleFallback");
    expect(p).not.toMatch(/国产/);
  });

  it("movie + 中文 + no origin info → soft fallback (unchanged default)", () => {
    expect(buildMovieSystemPrompt({ preferredLanguage: "中文" })).toContain("subtitleFallback");
  });

  it("TV/anime + 中文 + CN origin → 国产 native line, the 中字 floor is skipped entirely (#72 fix)", () => {
    const p = buildTvAnimeSystemPrompt({ preferredLanguage: "中文", originCountries: ["CN"] });
    expect(p).toMatch(/国产|原生中文|中文对白/);
    expect(p).toMatch(/无需|不需要/);
    expect(p).not.toContain("HARD requirement"); // no hard floor for domestic content
    expect(p).not.toContain("subtitleFallback"); // TV never has fallback anyway
  });

  it("TV/anime + 中文 + foreign origin (US) → HARD requirement for 中字", () => {
    const p = buildTvAnimeSystemPrompt({ preferredLanguage: "中文", originCountries: ["US"] });
    expect(p).toContain("HARD requirement");
    expect(p).not.toMatch(/国产/);
  });

  it("TV/anime + 中文 + no origin info → HARD requirement (unchanged default)", () => {
    const p = buildTvAnimeSystemPrompt({ preferredLanguage: "中文" });
    expect(p).toContain("HARD requirement");
    expect(p).not.toMatch(/国产/);
  });
});

describe("languageLine — 中字软默认按品牌注册表解耦 (Task 4)", () => {
  it("115/quark drives strengthen the Chinese-subs soft default for foreign titles", () => {
    for (const provider of ["pan115", "quark"]) {
      const p = buildTvAnimeSystemPrompt({
        preferredLanguage: "中文",
        originCountries: ["US"],
        storageProvider: provider,
      });
      // Should contain the strengthening language about Chinese-world drives
      expect(p).toMatch(/中文世界|中文圈|资源名.*中文.*默认.*字幕|更应默认带中/);
    }
  });

  it("guangya does NOT apply the strengthened Chinese-subs default", () => {
    const p = buildTvAnimeSystemPrompt({
      preferredLanguage: "中文",
      originCountries: ["US"],
      storageProvider: "guangya",
    });
    // Should NOT contain the 115/quark-specific strengthening
    expect(p).not.toMatch(/中文世界|中文圈.*更应默认/);
  });

  it("CN-origin content still skips 中字 judgment regardless of provider (regression check)", () => {
    for (const provider of ["pan115", "quark", "guangya"]) {
      const p = buildTvAnimeSystemPrompt({
        preferredLanguage: "中文",
        originCountries: ["CN"],
        storageProvider: provider,
      });
      expect(p).toMatch(/国产|原生中文/);
      expect(p).toMatch(/无需|不需要/);
      expect(p).not.toContain("HARD requirement");
    }
  });
})
