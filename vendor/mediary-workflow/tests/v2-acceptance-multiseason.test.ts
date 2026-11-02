import { describe, expect, it } from "vitest";
import { TaskSandbox } from "../src/acquisition-v2/sandbox.js";
import { FakeResourceProviderV2, type SimResourceCandidate } from "../src/acquisition-v2/fake-provider.js";
import { Storage115Simulator, type PackSpec } from "../src/acquisition-v2/storage-115-simulator.js";

/**
 * Multi-season acceptance — the cases I had wrongly dropped. System tests: a
 * scripted agent drives the sandbox; we assert scope isolation, the cross-season
 * coverage gate, and honest unobtainable gaps.
 */
async function setup(opts: {
  need: string[];
  seasons: number[];
  results?: Record<string, SimResourceCandidate[]>;
  packs?: Record<string, PackSpec>;
}) {
  const provider = new FakeResourceProviderV2({ results: opts.results ?? {} });
  const storage = new Storage115Simulator({ packs: opts.packs ?? {} });
  const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
  const targetSeasonDirectoryIds: Record<number, string> = {};
  for (const s of opts.seasons) {
    targetSeasonDirectoryIds[s] = await storage.createDirectory({ name: `Season ${s}`, parentId: "root" });
  }
  const sandbox = new TaskSandbox({ provider, storage, stagingDirectoryId, targetSeasonDirectoryIds, need: opts.need });
  return { sandbox };
}

describe("§6b multi-season acceptance", () => {
  it("a task scoped to only some seasons refuses a move into a season the user did NOT ask for", async () => {
    const { sandbox } = await setup({
      need: ["S03E01"],
      seasons: [3, 5], // user only wants seasons 3 & 5
      results: { show: [{ id: "cand", title: "S3 pack" }] },
      packs: { cand: { files: [{ path: "S3/Show - 01.mkv", sizeBytes: 1 }] } },
    });
    const search = await sandbox.searchResources("show");
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "cand" });
    // Season 2 is out of scope — moving into it is refused (never grab seasons the user didn't pick).
    await expect(
      sandbox.moveToSeason({ moves: [{ season: 2, fileIds: [transfer.staging[0]!.id] }] }),
    ).rejects.toThrow(/NO_SEASON_DIR/);
  });

  it("once every needed episode across multiple seasons is obtained, further transfers are refused", async () => {
    const { sandbox } = await setup({
      need: ["S01E01", "S02E01"],
      seasons: [1, 2],
      results: {
        show: [
          { id: "complete", title: "Complete Series" },
          { id: "extra", title: "extra pack" },
        ],
      },
      packs: {
        complete: { files: [{ path: "C/Season 1/E01.mkv", sizeBytes: 1 }, { path: "C/Season 2/E01.mkv", sizeBytes: 1 }] },
        extra: { files: [{ path: "X/E.mkv", sizeBytes: 1 }] },
      },
    });
    const search = await sandbox.searchResources("show");
    const t = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "complete" });
    const s1 = t.staging.find((f) => f.path.includes("Season 1"))!;
    const s2 = t.staging.find((f) => f.path.includes("Season 2"))!;
    await sandbox.moveToSeason({
      moves: [
        { season: 1, fileIds: [s1.id] },
        { season: 2, fileIds: [s2.id] },
      ],
    });
    await sandbox.markObtained({ codes: ["S01E01", "S02E01"] });

    await expect(
      sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "extra" }),
    ).rejects.toThrow(/COVERAGE_ALREADY_MET/);
  });

  it("an unobtainable missing episode is left as an honest gap (finish reports it still missing)", async () => {
    const { sandbox } = await setup({
      need: ["S01E01", "S02E07"], // S02E07 has no covering resource anywhere
      seasons: [1, 2],
      results: { show: [{ id: "s1only", title: "Season 1 only" }] },
      packs: { s1only: { files: [{ path: "S1/E01.mkv", sizeBytes: 1 }] } },
    });
    const search = await sandbox.searchResources("show");
    const t = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "s1only" });
    await sandbox.moveToSeason({ moves: [{ season: 1, fileIds: [t.staging[0]!.id] }] });
    await sandbox.markObtained({ codes: ["S01E01"] });

    const summary = await sandbox.finish();
    expect(summary.coverageMet).toBe(false);
    expect(summary.obtained).toEqual(["S01E01"]);
    expect(summary.missing).toEqual(["S02E07"]); // honest gap, not fabricated
  });
});
