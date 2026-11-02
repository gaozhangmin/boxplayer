import { describe, expect, it } from "vitest";
import { TaskSandbox } from "../src/acquisition-v2/sandbox.js";
import { FakeResourceProviderV2 } from "../src/acquisition-v2/fake-provider.js";
import { Storage115Simulator } from "../src/acquisition-v2/storage-115-simulator.js";

/**
 * Multi-season acquisition — the case I had wrongly collapsed to single-season.
 * A completed/long-running show often arrives as a complete-series or multi-season
 * pack; the agent distributes its files into each season's own directory, only
 * extracts what is still missing, and never recopies seasons already covered.
 * (architecture §Multi-season 1932-2000, permission-audit 105/209, plan §2)
 */
async function multiSeasonSetup(opts: {
  need: string[];
  packFiles: Array<{ path: string; sizeBytes: number }>;
}) {
  const provider = new FakeResourceProviderV2({
    results: { show: [{ id: "series", title: "Show Complete Series" }] },
  });
  const storage = new Storage115Simulator({ packs: { series: { files: opts.packFiles } } });
  const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
  const s1 = await storage.createDirectory({ name: "Season 1", parentId: "root" });
  const s2 = await storage.createDirectory({ name: "Season 2", parentId: "root" });
  const sandbox = new TaskSandbox({
    provider,
    storage,
    stagingDirectoryId,
    targetSeasonDirectoryIds: { 1: s1, 2: s2 },
    need: opts.need,
  });
  return { sandbox };
}

describe("TaskSandbox — multi-season distribution", () => {
  it("distributes a multi-season pack's files into their own season directories", async () => {
    const { sandbox } = await multiSeasonSetup({
      need: ["S01E07", "S02E13"],
      packFiles: [
        { path: "Show Complete/Season 1/Show - 07.mkv", sizeBytes: 9 },
        { path: "Show Complete/Season 2/Show - 13.mkv", sizeBytes: 9 },
      ],
    });
    const search = await sandbox.searchResources("show");
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "series" });
    const s1file = transfer.staging.find((f) => f.path.includes("Season 1"))!;
    const s2file = transfer.staging.find((f) => f.path.includes("Season 2"))!;

    await sandbox.moveToSeason({
      moves: [
        { season: 1, fileIds: [s1file.id] },
        { season: 2, fileIds: [s2file.id] },
      ],
    });

    // Each season dir holds ONLY its own episode (distributed, not dumped together).
    expect((await sandbox.inspectTargetDir({ season: 1 })).map((f) => f.path)).toEqual(["Show - 07.mkv"]);
    expect((await sandbox.inspectTargetDir({ season: 2 })).map((f) => f.path)).toEqual(["Show - 13.mkv"]);

    await sandbox.markObtained({ codes: ["S01E07", "S02E13"] });
    expect(sandbox.isCoverageMet()).toBe(true); // cross-season coverage met
  });

  it("refuses a move without a season when the task spans multiple seasons", async () => {
    const { sandbox } = await multiSeasonSetup({
      need: ["S01E01", "S02E01"],
      packFiles: [{ path: "Show/Season 1/Show - 01.mkv", sizeBytes: 1 }],
    });
    const search = await sandbox.searchResources("show");
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "series" });
    await expect(sandbox.moveToSeason({ moves: [{ fileIds: [transfer.staging[0]!.id] }] })).rejects.toThrow(/SEASON_REQUIRED/);
  });

  it("extracts only the missing episode from a complete-series pack; covered seasons are not recopied", async () => {
    // need is only S02E13, but the only resource is the whole-series pack (S1 + S2).
    // The agent moves ONLY S02E13 into Season 2; Season 1's files stay in staging,
    // never recopied into the already-covered Season 1 dir (the daily-patrol rule
    // applied across seasons).
    const { sandbox } = await multiSeasonSetup({
      need: ["S02E13"],
      packFiles: [
        { path: "Show Complete/Season 1/Show - 01.mkv", sizeBytes: 9 },
        { path: "Show Complete/Season 1/Show - 02.mkv", sizeBytes: 9 },
        { path: "Show Complete/Season 2/Show - 13.mkv", sizeBytes: 9 },
      ],
    });
    const search = await sandbox.searchResources("show");
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "series" });
    const wanted = transfer.staging.find((f) => f.path.includes("Season 2"))!;

    await sandbox.moveToSeason({ moves: [{ season: 2, fileIds: [wanted.id] }] });

    expect((await sandbox.inspectTargetDir({ season: 2 })).map((f) => f.path)).toEqual(["Show - 13.mkv"]);
    expect(await sandbox.inspectTargetDir({ season: 1 })).toHaveLength(0); // S1 NOT recopied
    await sandbox.markObtained({ codes: ["S02E13"] });
    expect(sandbox.isCoverageMet()).toBe(true);
  });
});
