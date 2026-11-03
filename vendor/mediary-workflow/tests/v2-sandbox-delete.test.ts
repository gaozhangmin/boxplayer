import { describe, expect, it } from "vitest";
import { TaskSandbox } from "../src/acquisition-v2/sandbox.js";
import { FakeResourceProviderV2 } from "../src/acquisition-v2/fake-provider.js";
import { Storage115Simulator } from "../src/acquisition-v2/storage-115-simulator.js";

async function setup() {
  const provider = new FakeResourceProviderV2({
    results: { show: [{ id: "cand", title: "Show" }] },
  });
  const storage = new Storage115Simulator({
    packs: { cand: { files: [{ path: "a.mkv", sizeBytes: 1 }, { path: "b.mkv", sizeBytes: 1 }] } },
  });
  const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
  const targetSeasonDirectoryId = await storage.createDirectory({ name: "Season 1", parentId: "root" });
  const sandbox = new TaskSandbox({ provider, storage, stagingDirectoryId, targetSeasonDirectoryIds: { 1: targetSeasonDirectoryId } });
  return { sandbox };
}

describe("TaskSandbox — deleteFiles (agent-decided dedup/residue, scoped, reread)", () => {
  it("deletes agent-chosen files in the season dir and rereads the result", async () => {
    const { sandbox } = await setup();
    const search = await sandbox.searchResources("show");
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "cand" });
    const moved = await sandbox.moveToSeason({ moves: [{ season: 1, fileIds: transfer.staging.map((f) => f.id) }] });
    const toDelete = moved.seasons[1]!.find((f) => f.path === "a.mkv")!.id;

    const result = await sandbox.deleteFiles({ directory: "season", fileIds: [toDelete], season: 1 });

    expect(result.directory.map((f) => f.path)).toEqual(["b.mkv"]);
  });

  it("refuses deleting a file that is not in the named scoped directory", async () => {
    const { sandbox } = await setup();
    await expect(sandbox.deleteFiles({ directory: "season", fileIds: ["ghost"], season: 1 })).rejects.toThrow(
      /FILES_NOT_IN/,
    );
  });
});
