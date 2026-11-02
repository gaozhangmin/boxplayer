import { describe, expect, it, vi } from "vitest";
import { fetchTmdbList } from "../src/tmdb-provider.js";

describe("fetchTmdbList", () => {
  it("fetches a raw list path via the access chain and returns the parsed body", async () => {
    const fetchJson = vi.fn(async (url: string) => {
      expect(url).toContain("/trending/movie/week");
      expect(url).toContain("language=zh-CN");
      return { results: [{ id: 1 }] };
    });
    const result = await fetchTmdbList(
      [{ baseURL: "https://proxy.example" }],
      "trending/movie/week",
      { language: "zh-CN" },
      { fetchJson },
    );
    expect(result).toEqual({ results: [{ id: 1 }] });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("falls back to the second access when the first throws", async () => {
    const fetchJson = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ results: [] });
    const result = await fetchTmdbList(
      [{ baseURL: "https://a", readToken: "k" }, { baseURL: "https://b" }],
      "trending/tv/week",
      {},
      { fetchJson },
    );
    expect(result).toEqual({ results: [] });
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });
});
