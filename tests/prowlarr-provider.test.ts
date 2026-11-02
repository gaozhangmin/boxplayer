import { describe, expect, it } from "vitest";
import { ProwlarrResourceProvider } from "../src/index.js";

function provider(results: unknown, calls?: { url?: string; apiKey?: string }) {
  return new ProwlarrResourceProvider({
    baseURL: "https://prowlarr.example/",
    apiKey: "KEY123",
    now: () => "2026-06-17T00:00:00.000Z",
    fetchJson: async (url, init) => {
      if (calls) {
        calls.url = url;
        calls.apiKey = init.headers["X-Api-Key"] ?? "";
      }
      return results;
    },
  });
}

describe("ProwlarrResourceProvider", () => {
  it("maps a torrent release with infoHash into a magnet candidate", async () => {
    const calls: { url?: string; apiKey?: string } = {};
    const snap = await provider(
      [
        {
          title: "Some Movie 2024 2160p",
          protocol: "torrent",
          infoHash: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
          indexer: "1337x",
          seeders: 42,
          size: 1024,
          downloadUrl: "https://1337x.example/torrent/1",
        },
      ],
      calls,
    ).search({ keyword: "Some Movie" });

    expect(calls.apiKey).toBe("KEY123");
    expect(calls.url).toContain("https://prowlarr.example/api/v1/search?query=Some%20Movie&type=search");
    expect(snap.provider).toBe("prowlarr");
    expect(snap.candidates).toHaveLength(1);
    const c = snap.candidates[0]!;
    expect(c.type).toBe("magnet");
    expect(c.source).toBe("1337x");
    expect(c.providerPayload.url).toBe("magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01");
    expect(c.providerPayload.infoHash).toBe("abcdef0123456789abcdef0123456789abcdef01");
  });

  it("uses a magnet downloadUrl when infoHash is absent and back-fills the hash", async () => {
    const snap = await provider([
      {
        title: "Show S01E01 1080p",
        protocol: "torrent",
        downloadUrl: "magnet:?xt=urn:btih:DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF&dn=x",
        indexer: "TPB",
      },
    ]).search({ keyword: "Show" });
    const c = snap.candidates[0]!;
    expect(c.providerPayload.url).toContain("magnet:?xt=urn:btih:DEADBEEF");
    expect(c.providerPayload.infoHash).toBe("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
  });

  it("skips torrent releases that have neither infoHash nor a magnet downloadUrl", async () => {
    const snap = await provider([
      { title: "No Hash", protocol: "torrent", downloadUrl: "https://x.example/a.torrent", indexer: "X" },
    ]).search({ keyword: "x" });
    expect(snap.candidates).toHaveLength(0);
  });

  it("skips usenet releases", async () => {
    const snap = await provider([
      { title: "Usenet", protocol: "usenet", infoHash: "AA", indexer: "NZB" },
    ]).search({ keyword: "x" });
    expect(snap.candidates).toHaveLength(0);
  });

  it("returns an empty snapshot when the request fails", async () => {
    const failing = new ProwlarrResourceProvider({
      baseURL: "https://prowlarr.example",
      apiKey: "K",
      now: () => "2026-06-17T00:00:00.000Z",
      fetchJson: async () => {
        throw new Error("HTTP 500");
      },
    });
    const snap = await failing.search({ keyword: "x" });
    expect(snap.candidates).toHaveLength(0);
    expect(snap.provider).toBe("prowlarr");
  });
});
