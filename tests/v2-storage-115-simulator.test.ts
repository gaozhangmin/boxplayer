import { describe, expect, it } from "vitest";
import { Storage115Simulator } from "../src/acquisition-v2/storage-115-simulator.js";

function fullSeasonPack(episodes: number) {
  return {
    files: Array.from({ length: episodes }, (_, i) => ({
      // Real packs nest the episodes inside the pack's own directory — which is
      // exactly why flatten is needed later.
      path: `[NC-Raws] Show S01/Show - ${String(i + 1).padStart(2, "0")} [1080p].mkv`,
      sizeBytes: 1_000_000_000 + i,
    })),
  };
}

describe("Storage115Simulator — transfer materialization", () => {
  it("materializes a full-season pack's episode files into staging, nested in the pack dir", async () => {
    const sim = new Storage115Simulator({ packs: { cand_full: fullSeasonPack(12) } });
    const showDir = await sim.createDirectory({ name: "Show (2026)", parentId: "root" });
    const staging = await sim.createDirectory({ name: "staging-1", parentId: showDir });

    const attempt = await sim.transferCandidate({ candidateId: "cand_full", intoDirectoryId: staging });

    expect(attempt.status).toBe("succeeded");
    expect(attempt.materializedFileIds).toHaveLength(12);

    const tree = await sim.listTree({ directoryId: staging });
    const videos = tree.filter((file) => file.isVideo);
    expect(videos).toHaveLength(12);
    // The episodes landed nested inside the pack's own directory, not directly
    // in staging — the wrapper dir flatten will later have to peel off.
    expect(videos.every((file) => file.path.startsWith("[NC-Raws] Show S01/"))).toBe(true);
  });

  it("reports a failed transfer (dead share) without materializing anything", async () => {
    const sim = new Storage115Simulator({ packs: {} }); // unknown candidate = dead share
    const staging = await sim.createDirectory({ name: "staging-1", parentId: "root" });

    const attempt = await sim.transferCandidate({ candidateId: "cand_dead", intoDirectoryId: staging });

    expect(attempt.status).toBe("failed");
    expect(attempt.materializedFileIds).toEqual([]);
    expect((await sim.listTree({ directoryId: staging })).length).toBe(0);
  });
});

describe("Storage115Simulator — move + name collision", () => {
  it("renames a colliding file to '(1)' when overlapping packs land the same episode", async () => {
    // Two overlapping 分集 packs (no full-season pack exists): both carry E02
    // under the same filename. Moving both into Season 1 collides -> a "(1)"
    // duplicate, which the dedup step (agent, keep-larger) later resolves.
    const sim = new Storage115Simulator({
      packs: {
        cand_a: { files: [
          { path: "Show - 01.mkv", sizeBytes: 100 },
          { path: "Show - 02.mkv", sizeBytes: 200 },
        ] },
        cand_b: { files: [
          { path: "Show - 02.mkv", sizeBytes: 210 },
          { path: "Show - 03.mkv", sizeBytes: 300 },
        ] },
      },
    });
    const season = await sim.createDirectory({ name: "Season 1", parentId: "root" });
    const stagingA = await sim.createDirectory({ name: "staging-a", parentId: "root" });
    const stagingB = await sim.createDirectory({ name: "staging-b", parentId: "root" });
    await sim.transferCandidate({ candidateId: "cand_a", intoDirectoryId: stagingA });
    await sim.transferCandidate({ candidateId: "cand_b", intoDirectoryId: stagingB });

    await sim.moveFiles({
      fileIds: (await sim.listTree({ directoryId: stagingA })).map((f) => f.id),
      targetDirectoryId: season,
    });
    await sim.moveFiles({
      fileIds: (await sim.listTree({ directoryId: stagingB })).map((f) => f.id),
      targetDirectoryId: season,
    });

    const names = (await sim.listTree({ directoryId: season })).map((f) => f.path).sort();
    expect(names).toEqual([
      "Show - 01.mkv",
      "Show - 02 (1).mkv",
      "Show - 02.mkv",
      "Show - 03.mkv",
    ]);
    // Staging dirs are emptied of the moved files.
    expect(await sim.listTree({ directoryId: stagingA })).toHaveLength(0);
  });

  it("deletes files by id", async () => {
    const sim = new Storage115Simulator({
      packs: { cand_a: { files: [{ path: "a.mkv", sizeBytes: 1 }, { path: "b.mkv", sizeBytes: 2 }] } },
    });
    const dir = await sim.createDirectory({ name: "d", parentId: "root" });
    await sim.transferCandidate({ candidateId: "cand_a", intoDirectoryId: dir });
    const files = await sim.listTree({ directoryId: dir });
    const result = await sim.deleteFiles({ directoryId: dir, fileIds: [files[0]!.id] });
    expect(result.deleted).toEqual([files[0]!.id]);
    expect((await sim.listTree({ directoryId: dir })).map((f) => f.path)).toEqual(["b.mkv"]);
  });
});

describe("Storage115Simulator — directory listing + removal (flatten support)", () => {
  it("lists the nested wrapper subdirectories a pack materialized", async () => {
    const sim = new Storage115Simulator({ packs: { cand: fullSeasonPack(2) } });
    const staging = await sim.createDirectory({ name: "staging", parentId: "root" });
    await sim.transferCandidate({ candidateId: "cand", intoDirectoryId: staging });

    const subdirs = await sim.listSubdirectories({ directoryId: staging });

    expect(subdirs.map((d) => d.path)).toEqual(["[NC-Raws] Show S01"]);
  });

  it("removes a wrapper directory and everything still nested inside it", async () => {
    const sim = new Storage115Simulator({
      packs: { cand: { files: [{ path: "Pack/a.mkv", sizeBytes: 1 }, { path: "Pack/note.txt", sizeBytes: 1 }] } },
    });
    const staging = await sim.createDirectory({ name: "staging", parentId: "root" });
    await sim.transferCandidate({ candidateId: "cand", intoDirectoryId: staging });
    const packDir = (await sim.listSubdirectories({ directoryId: staging })).find((d) => d.path === "Pack")!;

    await sim.removeDirectory({ directoryId: packDir.id });

    expect(await sim.listTree({ directoryId: staging })).toHaveLength(0);
    expect(await sim.listSubdirectories({ directoryId: staging })).toHaveLength(0);
  });
});

describe("Storage115Simulator — API budget (the 逆鳞)", () => {
  it("fails loud with PAN115_RATE_LIMIT when the per-task API budget is exhausted", async () => {
    // A transfer costs ~1 + one call per file, so a 10-file pack overruns a tiny
    // budget — modelling 链锯人, where over-selecting packs blew the 240-call guard.
    const sim = new Storage115Simulator({
      apiBudget: 4,
      packs: { big: { files: Array.from({ length: 10 }, (_, i) => ({ path: `e${i}.mkv`, sizeBytes: 1 })) } },
    });
    const dir = await sim.createDirectory({ name: "d", parentId: "root" });

    await expect(sim.transferCandidate({ candidateId: "big", intoDirectoryId: dir })).rejects.toThrow(
      "PAN115_RATE_LIMIT",
    );
  });

  it("stays within budget for a modest acquisition", async () => {
    const sim = new Storage115Simulator({
      apiBudget: 50,
      packs: { ok: { files: [{ path: "a.mkv", sizeBytes: 1 }, { path: "b.mkv", sizeBytes: 1 }] } },
    });
    const dir = await sim.createDirectory({ name: "d", parentId: "root" });
    const attempt = await sim.transferCandidate({ candidateId: "ok", intoDirectoryId: dir });
    expect(attempt.status).toBe("succeeded");
  });
});
