import { describe, expect, it } from "vitest";
import { TaskSandbox } from "../src/acquisition-v2/sandbox.js";
import { FakeResourceProviderV2 } from "../src/acquisition-v2/fake-provider.js";
import { Storage115Simulator } from "../src/acquisition-v2/storage-115-simulator.js";

async function setup() {
  const provider = new FakeResourceProviderV2({
    results: { show: [{ id: "cand", title: "Show" }] },
  });
  const storage = new Storage115Simulator({
    packs: { cand: { files: [{ path: "Pack/Show - 01.mkv", sizeBytes: 9 }, { path: "Pack/readme.txt", sizeBytes: 1 }] } },
  });
  const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
  const targetSeasonDirectoryId = await storage.createDirectory({ name: "Season 1", parentId: "root" });
  const sandbox = new TaskSandbox({ provider, storage, stagingDirectoryId, targetSeasonDirectoryIds: { 1: targetSeasonDirectoryId } });
  return { sandbox };
}

describe("TaskSandbox — inspect tools (read-only, full raw tree, scoped)", () => {
  it("inspectStaging returns the full raw tree the agent must judge from", async () => {
    const { sandbox } = await setup();
    const search = await sandbox.searchResources("show");
    await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "cand" });

    const tree = await sandbox.inspectStaging();

    expect([...tree.map((f) => f.path)].sort()).toEqual(["Pack/Show - 01.mkv", "Pack/readme.txt"]);
    expect(tree.find((f) => f.path.endsWith(".mkv"))!.isVideo).toBe(true);
  });

  it("inspectTargetDir reflects what has actually landed in the season dir", async () => {
    const { sandbox } = await setup();
    const search = await sandbox.searchResources("show");
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "cand" });
    const videoIds = transfer.staging.filter((f) => f.isVideo).map((f) => f.id);
    await sandbox.moveToSeason({ moves: [{ season: 1, fileIds: videoIds }] });

    const tree = await sandbox.inspectTargetDir();

    expect(tree.map((f) => f.path)).toEqual(["Show - 01.mkv"]);
  });
});
