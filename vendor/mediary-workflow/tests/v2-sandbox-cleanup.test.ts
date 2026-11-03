import { describe, expect, it } from "vitest";
import { TaskSandbox } from "../src/acquisition-v2/sandbox.js";
import { FakeResourceProviderV2 } from "../src/acquisition-v2/fake-provider.js";
import { Storage115Simulator } from "../src/acquisition-v2/storage-115-simulator.js";

describe("TaskSandbox.discardStaging — harnessed wholesale staging wipe (TV/anime)", () => {
  it("wipes the whole staging dir after the agent distributed what it needs; the season dir survives", async () => {
    const provider = new FakeResourceProviderV2({
      results: { show: [{ id: "cand", title: "Show" }] },
    });
    const storage = new Storage115Simulator({
      packs: { cand: { files: [{ path: "Show - 01.mkv", sizeBytes: 9 }, { path: "Show - 02.mkv", sizeBytes: 9 }] } },
    });
    const staging = await storage.createDirectory({ name: "staging", parentId: "root" });
    const season = await storage.createDirectory({ name: "Season 1", parentId: "root" });
    const sandbox = new TaskSandbox({
      provider,
      storage,
      stagingDirectoryId: staging,
      targetSeasonDirectoryIds: { 1: season },
      need: ["S01E01"],
    });
    const search = await sandbox.searchResources("show");
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "cand" });
    const ep01 = transfer.staging.find((f) => f.path.includes("01"))!;
    await sandbox.moveToSeason({ moves: [{ season: 1, fileIds: [ep01.id] }] });

    // Show - 02 is left behind in staging; discardStaging wipes the WHOLE staging
    // wholesale (no classification, no isolation), keeping only what was moved.
    const result = await sandbox.discardStaging();

    expect(result.removed.length).toBeGreaterThan(0);
    await expect(sandbox.inspectStaging()).rejects.toThrow(/SIM_DIR_NOT_FOUND/);
    expect((await sandbox.inspectTargetDir({ season: 1 })).map((f) => f.path)).toEqual(["Show - 01.mkv"]);
  });

  it("refuses to discard when staging IS a target dir (movie: staging === movie dir)", async () => {
    const provider = new FakeResourceProviderV2({ results: {} });
    const storage = new Storage115Simulator({ packs: {} });
    const movieDir = await storage.createDirectory({ name: "Inception (2010)", parentId: "root" });
    const sandbox = new TaskSandbox({
      provider,
      storage,
      stagingDirectoryId: movieDir,
      targetMovieDirectoryId: movieDir,
      need: ["MOVIE"],
    });
    await expect(sandbox.discardStaging()).rejects.toThrow(/STAGING_IS_TARGET/);
  });
});

describe("TaskSandbox.flattenMovie — automatic video+subtitle extraction (movie)", () => {
  it("extracts ALL video and subtitle files to the movie dir root and removes the wrapper", async () => {
    const provider = new FakeResourceProviderV2({
      results: { x: [{ id: "film", title: "Inception" }] },
    });
    const storage = new Storage115Simulator({
      packs: {
        film: {
          files: [
            { path: "Inception.2010.1080p/Inception.mkv", sizeBytes: 100 },
            { path: "Inception.2010.1080p/Inception.zh.ass", sizeBytes: 3 },
            { path: "Inception.2010.1080p/cover.jpg", sizeBytes: 1 },
          ],
        },
      },
    });
    const movieDir = await storage.createDirectory({ name: "Inception (2010)", parentId: "root" });
    const sandbox = new TaskSandbox({
      provider,
      storage,
      stagingDirectoryId: movieDir,
      targetMovieDirectoryId: movieDir,
      need: ["MOVIE"],
    });
    const search = await sandbox.searchResources("x");
    await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "film" });

    const result = await sandbox.flattenMovie();

    // video + subtitle extracted FLAT to the movie dir root (subtitle kept!);
    // cover.jpg (non-media) is discarded with the wrapper.
    expect(result.movie.map((f) => f.path).sort()).toEqual(["Inception.mkv", "Inception.zh.ass"]);
    expect(await sandbox.inspectStagingDirs()).toEqual([]); // wrapper removed
  });
});
