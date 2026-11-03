import { describe, expect, it } from "vitest";
import { createStubAcquisitionModel } from "../src/acquisition-v2/stub-model.js";
import { runTvAcquisitionV2 } from "../src/acquisition-v2/run-tv-v2.js";
import { FakeStorageExecutor } from "../src/fakes.js";
import type { MediaTitle, ResourceSnapshot } from "../src/domain.js";
import type { ResourceProvider } from "../src/ports.js";

function emptyProvider(): ResourceProvider {
  return {
    search: async ({ keyword }): Promise<ResourceSnapshot> => ({
      id: "snap_empty",
      provider: "pansou",
      keyword,
      candidates: [],
      createdAt: "2026-06-15T00:00:00.000Z",
    }),
  };
}

const title = {
  id: "tmdb_tv_1",
  tmdbId: 1,
  type: "tv",
  title: "Stub Show",
  year: 2025,
  aliases: [],
} as unknown as MediaTitle;

describe("createStubAcquisitionModel — the fake/dev no-op agent", () => {
  it("drives the real tool-loop to a clean no_coverage outcome", async () => {
    const result = await runTvAcquisitionV2({
      title,
      mode: "type2",
      seasons: [{ seasonNumber: 1, totalEpisodes: 1, latestAiredEpisode: 1, qualityPreference: "4K" }],
      categoryParentId: "tv_root",
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: createStubAcquisitionModel(),
      workflowRunId: "run-stub",
      now: () => "2026-06-15T00:00:00.000Z",
    });

    expect(result.status).toBe("no_coverage");
  });
});
