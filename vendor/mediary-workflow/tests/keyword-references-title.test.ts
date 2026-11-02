import { describe, expect, it } from "vitest";
import { keywordReferencesTitle } from "../src/planning-search-gate.js";

describe("keywordReferencesTitle", () => {
  const terms = ["公民义警", "Citizen Vigilante"];

  it("accepts keywords containing the title or an alias", () => {
    for (const k of [
      "公民义警",
      "公民义警 2026",
      "公民义警 电影",
      "Citizen Vigilante",
      "Citizen Vigilante 2026",
    ]) {
      expect(keywordReferencesTitle(k, terms), k).toBe(true);
    }
  });

  it("rejects genre-only / year-only / genre+year keywords (the '2026 电影' garbage)", () => {
    for (const k of ["电影", "2026", "2026 电影", "电影 2026"]) {
      expect(keywordReferencesTitle(k, terms), k).toBe(false);
    }
  });

  it("matches across case / spacing / punctuation", () => {
    expect(keywordReferencesTitle("超人 2025 4K", ["超人", "Superman"])).toBe(true);
    expect(keywordReferencesTitle("SUPERMAN.2025", ["超人", "Superman"])).toBe(true);
  });

  it("fails open when no usable title terms are known", () => {
    expect(keywordReferencesTitle("anything", [])).toBe(true);
    expect(keywordReferencesTitle("anything", ["", "  "])).toBe(true);
  });
});
