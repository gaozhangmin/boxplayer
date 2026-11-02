import { describe, expect, it } from "vitest";
import {
  FakeStorageExecutor,
  InMemoryWorkflowRepository,
  queueTrackingInitialization,
  importForeignWorkAsMovie,
  type MediaTitle,
  type TrackedSeason,
} from "../src/index.js";

describe("queueTrackingInitialization", () => {
  it("queues a type2 initialization without searching resources or touching storage", async () => {
    const repository = new InMemoryWorkflowRepository();
    const { title, season } = trackedFixture();

    const result = await queueTrackingInitialization({
      title,
      season,
      keyword: "Show 4K",
      repository,
      createWorkflowRunId: () => "run_queued_type2",
      now: fixedNow,
    });

    expect(result).toMatchObject({
      status: "queued",
      workflowRunId: "run_queued_type2",
      workflowStatus: "queued",
      progress: {
        totalEpisodes: 2,
        latestAiredEpisode: 1,
        obtainedEpisodes: [],
        missingAiredEpisodes: ["S01E01"],
      },
    });
    await expect(repository.getWorkflowRunSnapshot("run_queued_type2")).resolves.toMatchObject({
      workflowRun: {
        id: "run_queued_type2",
        status: "queued",
        auditEvents: [
          { type: "workflow_reserved" },
          {
            type: "tracking_request_queued",
            data: { keyword: "Show 4K" },
          },
        ],
      },
    });
  });
});

function trackedFixture(): { title: MediaTitle; season: TrackedSeason } {
  const title: MediaTitle = {
    id: "title_show",
    tmdbId: 123,
    type: "tv",
    title: "Show",
    originalTitle: "Show",
    year: 2026,
    aliases: [],
  };
  return {
    title,
    season: {
      id: "season_show_1",
      mediaTitleId: title.id,
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "dir_show_s1",
      totalEpisodes: 2,
      latestAiredEpisode: 1,
      latestAiredSource: "metadata",
    },
  };
}

function fixedNow(): string {
  return "2026-06-11T00:00:00.000Z";
}

describe("importForeignWorkAsMovie", () => {
  it("moves user-confirmed foreign files into the Title (Year) directory keeping their original name", async () => {
    const storage = new FakeStorageExecutor({
      unparsedFiles: {
        staging_pack: [
          { providerFileId: "el_camino", name: "El.Camino.2019.2160p.mkv", sizeBytes: 30_000_000_000 },
        ],
      },
    });

    const result = await importForeignWorkAsMovie({
      storage,
      providerFileIds: ["el_camino"],
      movieTitle: "续命之徒：绝命毒师电影",
      year: 2019,
      moviesParentDirectoryId: "movies_root",
    });

    expect(result.movedFileIds).toEqual(["el_camino"]);
    // No rename — the identity is the `Title (Year)` wrapper directory, so the
    // video keeps its original filename (and avoids `(1)` collisions).
    const stagingLeft = await storage.listUnparsedVideoFiles("staging_pack");
    expect(stagingLeft).toEqual([]);
    const landedUnparsed = await storage.listUnparsedVideoFiles(result.movieDirectoryId);
    expect(landedUnparsed.map((file) => file.name)).toEqual(["El.Camino.2019.2160p.mkv"]);
  });

  it("throws when no files were given", async () => {
    await expect(
      importForeignWorkAsMovie({
        storage: new FakeStorageExecutor(),
        providerFileIds: [],
        movieTitle: "Movie",
        year: 2020,
        moviesParentDirectoryId: "movies_root",
      }),
    ).rejects.toThrow("FOREIGN_WORK_IMPORT_EMPTY");
  });
});
