import { describe, expect, it } from "vitest";
import { CompositeResourceProvider } from "../src/index.js";
import type { ResourceProvider, ResourceSnapshot } from "../src/index.js";

function fakeProvider(
  name: string,
  candidates: Array<{ url: string; infoHash?: string }>,
  throws = false,
): ResourceProvider {
  return {
    async search(input: { keyword: string }): Promise<ResourceSnapshot> {
      if (throws) throw new Error(`${name} down`);
      return {
        id: `${name}_snap`,
        provider: name,
        keyword: input.keyword,
        createdAt: "2026-06-17T00:00:00.000Z",
        candidates: candidates.map((c, index) => ({
          id: `${name}_c${index + 1}`,
          snapshotId: `${name}_snap`,
          index,
          title: `${name} ${index}`,
          type: c.infoHash ? "magnet" : "115",
          source: name,
          providerPayload: c.infoHash ? { url: c.url, infoHash: c.infoHash } : { url: c.url },
        })),
      };
    },
  };
}

describe("CompositeResourceProvider", () => {
  it("merges candidates from all providers into one snapshot with sequential ids", async () => {
    const composite = new CompositeResourceProvider({
      now: () => "2026-06-17T00:00:00.000Z",
      providers: [
        { name: "pansou", provider: fakeProvider("pansou", [{ url: "115://a" }]) },
        { name: "prowlarr", provider: fakeProvider("prowlarr", [{ url: "magnet:?xt=urn:btih:bbb", infoHash: "bbb" }]) },
      ],
    });
    const snap = await composite.search({ keyword: "x" });
    expect(snap.provider).toBe("composite");
    expect(snap.candidates).toHaveLength(2);
    expect(snap.candidates.map((c) => c.index)).toEqual([0, 1]);
    expect(snap.candidates.map((c) => c.id)).toEqual([
      `${snap.id}_candidate_1`,
      `${snap.id}_candidate_2`,
    ]);
    expect(snap.candidates.map((c) => c.source)).toEqual(["pansou", "prowlarr"]);
  });

  it("dedupes by infohash across providers", async () => {
    const composite = new CompositeResourceProvider({
      providers: [
        { name: "pansou", provider: fakeProvider("pansou", [{ url: "magnet:?xt=urn:btih:dup", infoHash: "dup" }]) },
        { name: "prowlarr", provider: fakeProvider("prowlarr", [{ url: "magnet:?xt=urn:btih:dup&x=1", infoHash: "DUP" }]) },
      ],
    });
    const snap = await composite.search({ keyword: "x" });
    expect(snap.candidates).toHaveLength(1);
  });

  it("keeps other providers' results when one throws", async () => {
    const composite = new CompositeResourceProvider({
      providers: [
        { name: "pansou", provider: fakeProvider("pansou", [{ url: "115://a" }]) },
        { name: "prowlarr", provider: fakeProvider("prowlarr", [], true) },
      ],
    });
    const snap = await composite.search({ keyword: "x" });
    expect(snap.candidates).toHaveLength(1);
    expect(snap.candidates[0]!.source).toBe("pansou");
  });
});
