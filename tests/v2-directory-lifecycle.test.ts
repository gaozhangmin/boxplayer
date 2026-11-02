import { describe, expect, it } from "vitest";
import { ensureSeasonAcquisitionDirectories } from "../src/acquisition-v2/directory-lifecycle.js";
import { FakeStorageExecutor } from "../src/fakes.js";

describe("ensureSeasonAcquisitionDirectories — verify-or-create the 115 directory tree", () => {
  it("creates show dir under category, each Season dir under show, staging under show (never inside a season)", async () => {
    const executor = new FakeStorageExecutor();
    const dirs = await ensureSeasonAcquisitionDirectories({
      executor,
      categoryParentId: "tv_root",
      showName: "绝命毒师",
      year: 2008,
      seasons: [1, 2, 3],
      workflowRunId: "run-1",
    });

    expect(dirs.showDirectoryId).toContain("tv_root"); // show under category
    expect(Object.keys(dirs.seasonDirectoryIds)).toEqual(["1", "2", "3"]);
    for (const id of Object.values(dirs.seasonDirectoryIds)) {
      expect(id).toContain(dirs.showDirectoryId); // each season under the show dir
    }
    // staging under the show dir, NOT inside any season dir
    expect(dirs.stagingDirectoryId).toContain(dirs.showDirectoryId);
    for (const seasonId of Object.values(dirs.seasonDirectoryIds)) {
      expect(dirs.stagingDirectoryId).not.toContain(seasonId);
    }
  });

  it("is idempotent: re-running reuses the SAME show/season dirs (find-or-create, never duplicates)", async () => {
    const executor = new FakeStorageExecutor();
    const a = await ensureSeasonAcquisitionDirectories({
      executor, categoryParentId: "tv_root", showName: "Show", year: 2024, seasons: [1], workflowRunId: "run-1",
    });
    const b = await ensureSeasonAcquisitionDirectories({
      executor, categoryParentId: "tv_root", showName: "Show", year: 2024, seasons: [1], workflowRunId: "run-1",
    });
    expect(b.showDirectoryId).toBe(a.showDirectoryId);
    expect(b.seasonDirectoryIds[1]).toBe(a.seasonDirectoryIds[1]);
  });

  it("adds a new season dir under the SAME show dir when later acquiring another season", async () => {
    const executor = new FakeStorageExecutor();
    const first = await ensureSeasonAcquisitionDirectories({
      executor, categoryParentId: "tv_root", showName: "Show", year: 2024, seasons: [1], workflowRunId: "r1",
    });
    const second = await ensureSeasonAcquisitionDirectories({
      executor, categoryParentId: "tv_root", showName: "Show", year: 2024, seasons: [2], workflowRunId: "r2",
    });
    expect(second.showDirectoryId).toBe(first.showDirectoryId); // same show dir reused
    expect(second.seasonDirectoryIds[2]).toContain(first.showDirectoryId); // new season under it
  });
});
