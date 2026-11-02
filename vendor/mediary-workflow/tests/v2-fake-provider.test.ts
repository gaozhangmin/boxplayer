import { describe, expect, it } from "vitest";
import { FakeResourceProviderV2 } from "../src/acquisition-v2/fake-provider.js";

describe("FakeResourceProviderV2", () => {
  it("returns a snapshot of candidates for a known keyword (normalized lookup)", async () => {
    const provider = new FakeResourceProviderV2({
      results: {
        "show 4k": [
          { id: "cand_full", title: "Show S01 全集 4K" },
        ],
      },
    });

    const snapshot = await provider.search("Show 4K");

    expect(snapshot.keyword).toBe("Show 4K");
    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0]?.id).toBe("cand_full");
    expect(snapshot.id).toMatch(/^snap_/);
  });

  it("returns an empty snapshot for an unknown keyword (a miss, not an error)", async () => {
    const provider = new FakeResourceProviderV2({ results: {} });
    const snapshot = await provider.search("nothing here");
    expect(snapshot.candidates).toEqual([]);
  });

  it("throws for a keyword configured to error (a provider failure is evidence, not the end)", async () => {
    const provider = new FakeResourceProviderV2({ results: {}, errorKeywords: ["boom"] });
    await expect(provider.search("boom")).rejects.toThrow("PROVIDER_ERROR");
  });

  it("gives the same content-addressed snapshot id for the same result set (dedup-safe)", async () => {
    const same = [{ id: "c1", title: "T" }];
    const provider = new FakeResourceProviderV2({ results: { k1: same, k2: same } });

    const a = await provider.search("k1");
    const b = await provider.search("k2");

    // Real PanSou ids are content hashes: identical result sets (esp. empty)
    // recur across searches, so the id is the candidate set, not the keyword.
    expect(a.id).toBe(b.id);
  });
});
