import { describe, expect, it } from "vitest";
import { TaskSandbox } from "../src/acquisition-v2/sandbox.js";
import { FakeResourceProviderV2, type SimResourceCandidate } from "../src/acquisition-v2/fake-provider.js";
import { Storage115Simulator, type PackSpec } from "../src/acquisition-v2/storage-115-simulator.js";

/**
 * §6b acceptance suite — the 12 字字泣血 invariants. These are SYSTEM tests:
 * a scripted "agent" (no LLM) drives the sandbox tools, including adversarial
 * sequences, and we assert the sandbox either makes the documented mistake
 * impossible (fail-loud / refusal) or faithfully surfaces the real evidence the
 * agent needs to judge. No live 115, ever.
 */

function candidate(id: string, title = id): SimResourceCandidate {
  return { id, title };
}

async function makeSandbox(opts: {
  results: Record<string, SimResourceCandidate[]>;
  packs: Record<string, PackSpec>;
  need: string[];
  seedSeason?: PackSpec;
}) {
  const provider = new FakeResourceProviderV2({ results: opts.results });
  const storage = new Storage115Simulator({ packs: opts.packs });
  const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
  const targetSeasonDirectoryId = await storage.createDirectory({ name: "Season 1", parentId: "root" });
  if (opts.seedSeason) {
    // Pre-existing files already in the Season dir (Type-3 "115 already has it").
    storage["packs"].set("__seed__", opts.seedSeason);
    await storage.transferCandidate({ candidateId: "__seed__", intoDirectoryId: targetSeasonDirectoryId });
  }
  const sandbox = new TaskSandbox({ provider, storage, stagingDirectoryId, targetSeasonDirectoryIds: { 1: targetSeasonDirectoryId }, need: opts.need });
  return { sandbox, storage, stagingDirectoryId, targetSeasonDirectoryId };
}

function episodes(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `S01E${String(i + 1).padStart(2, "0")}`);
}

function seasonPack(count: number, sizeBase = 1_000): PackSpec {
  return {
    files: Array.from({ length: count }, (_, i) => ({
      path: `[Grp] Show S01/Show - ${String(i + 1).padStart(2, "0")}.mkv`,
      sizeBytes: sizeBase + i,
    })),
  };
}

describe("§6b acceptance — the 12 invariants", () => {
  it("#1 once a full-season pack covers the season, further transfers are refused (only 1 transfer)", async () => {
    const need = episodes(12);
    const { sandbox } = await makeSandbox({
      results: { show: Array.from({ length: 6 }, (_, i) => candidate(`pack${i}`)) },
      packs: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`pack${i}`, seasonPack(12)])),
      need,
    });
    const search = await sandbox.searchResources("show");
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "pack0" });
    await sandbox.moveToSeason({ moves: [{ season: 1, fileIds: transfer.staging.filter((f) => f.isVideo).map((f) => f.id) }] });
    await sandbox.markObtained({ codes: need });

    // Every later overlapping pack is refused — the system, not the agent, enforces it.
    await expect(
      sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "pack1" }),
    ).rejects.toThrow(/COVERAGE_ALREADY_MET/);
  });

  it("#2 reread reveals a candidate covered more than predicted → coverage met, no further transfer", async () => {
    const need = episodes(13);
    const { sandbox } = await makeSandbox({
      results: { show: [candidate("cand_full"), candidate("cand_extra")] },
      packs: { cand_full: seasonPack(13), cand_extra: seasonPack(13) },
      need,
    });
    const search = await sandbox.searchResources("show");
    // Agent predicted "only E01" but the forced reread returns all 13 — the truth.
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "cand_full" });
    expect(transfer.staging.filter((f) => f.isVideo)).toHaveLength(13);
    await sandbox.moveToSeason({ moves: [{ season: 1, fileIds: transfer.staging.filter((f) => f.isVideo).map((f) => f.id) }] });
    await sandbox.markObtained({ codes: need });
    expect(sandbox.isCoverageMet()).toBe(true);
    await expect(
      sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "cand_extra" }),
    ).rejects.toThrow(/COVERAGE_ALREADY_MET/);
  });

  it("#3 a wrong-target transfer surfaces the REAL files (not the prediction) so the agent can re-decide", async () => {
    const { sandbox } = await makeSandbox({
      results: { show: [candidate("looks_right"), candidate("actually_right")] },
      // The first share is actually a different work entirely.
      packs: {
        looks_right: { files: [{ path: "Some Other Movie (2019).mkv", sizeBytes: 5 }] },
        actually_right: seasonPack(1),
      },
      need: episodes(1),
    });
    const search = await sandbox.searchResources("show");
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "looks_right" });
    // System hands back ground truth — the agent can SEE it's the wrong work.
    expect(transfer.staging.map((f) => f.path)).toEqual(["Some Other Movie (2019).mkv"]);
    // Nothing was auto-marked; coverage is still unmet, so the agent may try another candidate.
    expect(sandbox.isCoverageMet()).toBe(false);
  });

  it("#4 keyword recovery is allowed within budget but unbounded search is blocked", async () => {
    const { sandbox } = await makeSandbox({
      results: {},
      packs: {},
      need: episodes(1),
    });
    let refusedAt = -1;
    for (let i = 0; i < 20; i += 1) {
      const result = await sandbox.searchResources(`keyword variant ${i}`);
      if (result.refused) {
        refusedAt = i;
        break;
      }
    }
    // It let the agent recover with several distinct keywords, then drew the line.
    expect(refusedAt).toBeGreaterThan(0);
  });

  it("#5 only the target files move; extras stay surfaced in staging (no silent residue)", async () => {
    const { sandbox } = await makeSandbox({
      results: { show: [candidate("cand")] },
      packs: {
        cand: { files: [
          { path: "Show - 01.mkv", sizeBytes: 9 },
          { path: "Show - 01.NCOP.mkv", sizeBytes: 2 },
          { path: "Show - 01.ass", sizeBytes: 1 },
        ] },
      },
      need: episodes(1),
    });
    const search = await sandbox.searchResources("show");
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "cand" });
    const target = transfer.staging.find((f) => f.path === "Show - 01.mkv")!;
    await sandbox.moveToSeason({ moves: [{ season: 1, fileIds: [target.id] }] });

    // Extras were NOT moved and NOT silently deleted — still visible for classification.
    const residue = await sandbox.inspectStaging();
    expect(residue.map((f) => f.path).sort()).toEqual(["Show - 01.NCOP.mkv", "Show - 01.ass"]);
  });

  it("#6 a foreign work in the pack is never auto-mapped — it just stays, visible, untouched", async () => {
    const { sandbox } = await makeSandbox({
      results: { show: [candidate("bb_pack")] },
      packs: {
        bb_pack: { files: [
          { path: "Breaking Bad - 01.mkv", sizeBytes: 9 },
          { path: "El Camino (2019).mkv", sizeBytes: 9 }, // a different work bundled in
        ] },
      },
      need: episodes(1),
    });
    const search = await sandbox.searchResources("show");
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "bb_pack" });
    const ep = transfer.staging.find((f) => f.path.startsWith("Breaking Bad"))!;
    await sandbox.moveToSeason({ moves: [{ season: 1, fileIds: [ep.id] }] });

    // El Camino was never auto-moved or auto-marked — it remains in staging for review.
    const residue = await sandbox.inspectStaging();
    expect(residue.map((f) => f.path)).toEqual(["El Camino (2019).mkv"]);
  });

  it("#7 a dead-link transfer returns a failed attempt with real (empty) evidence, not a silent success", async () => {
    const { sandbox } = await makeSandbox({
      results: { show: [candidate("dead")] },
      packs: {}, // unknown candidate = dead share
      need: episodes(1),
    });
    const search = await sandbox.searchResources("show");
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "dead" });
    expect(transfer.attempt.status).toBe("failed");
    expect(transfer.attempt.materializedFileIds).toEqual([]);
    expect(transfer.staging).toEqual([]); // honest evidence: nothing landed
  });

  it("#8 Type-3: 115 already has the file → mark from existing evidence, no search/transfer", async () => {
    const { sandbox } = await makeSandbox({
      results: {},
      packs: {},
      need: episodes(1),
      seedSeason: { files: [{ path: "Show - 01.mkv", sizeBytes: 9 }] },
    });
    // The agent inspects 115, sees the file already there, and marks from that
    // evidence — no search, no transfer (§6b#8).
    const present = await sandbox.inspectTargetDir({ season: 1 });
    expect(present).toHaveLength(1);
    await sandbox.markObtained({ codes: ["S01E01"] });
    expect(sandbox.isCoverageMet()).toBe(true);
  });

  it("#9 a missing/invalid scoped dir fails loud — no fallback to a wrong directory", async () => {
    const provider = new FakeResourceProviderV2({ results: { show: [candidate("cand")] } });
    const storage = new Storage115Simulator({ packs: { cand: seasonPack(1) } });
    const sandbox = new TaskSandbox({
      provider,
      storage,
      stagingDirectoryId: "ghost_staging", // never created
      targetSeasonDirectoryIds: { 1: "ghost_season" },
      need: episodes(1),
    });
    const search = await sandbox.searchResources("show");
    await expect(
      sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "cand" }),
    ).rejects.toThrow(/SIM_DIR_NOT_FOUND/);
  });

  it("#10 markObtained records the agent's declared codes — no mechanical present-check", async () => {
    // 2026-06-15: the system no longer re-reads 115 to verify a backing file (the
    // mark is reversible, move/flatten already reread, §1.13 re-judges each
    // patrol). markObtained is the agent's final declaration; ordering (mark LAST,
    // after flatten) is enforced by the prompt, not a system gate.
    const { sandbox } = await makeSandbox({ results: {}, packs: {}, need: episodes(1) });
    const result = await sandbox.markObtained({ codes: ["S01E01"] });
    expect(result.confirmed).toEqual(["S01E01"]);
    expect(sandbox.isCoverageMet()).toBe(true);
  });

  it("#11 dedup keeps the larger files (Life Tree) when the agent groups duplicates", async () => {
    // Old large E01-12 already in Season; new small pack carries E01-14.
    const { sandbox, targetSeasonDirectoryId, storage } = await makeSandbox({
      results: { show: [candidate("new_small")] },
      packs: {
        new_small: { files: episodes(14).map((_, i) => ({ path: `Show - ${String(i + 1).padStart(2, "0")}.mkv`, sizeBytes: 100 })) },
      },
      need: episodes(14),
      seedSeason: { files: episodes(12).map((_, i) => ({ path: `Show - ${String(i + 1).padStart(2, "0")}.mkv`, sizeBytes: 999_999 })) },
    });
    const search = await sandbox.searchResources("show");
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "new_small" });
    // Move the new pack in: E01-12 collide -> "(1)" duplicates; E13-14 are new.
    await sandbox.moveToSeason({ moves: [{ season: 1, fileIds: transfer.staging.map((f) => f.id) }] });
    const season = await sandbox.inspectTargetDir();
    // Agent groups by episode and keeps the LARGER of each colliding pair (keep-big).
    const collisions = season.filter((f) => /\(1\)/.test(f.path));
    expect(collisions).toHaveLength(12); // the small new copies of E01-12 landed as "(1)"
    const smallDupIds = collisions.map((f) => f.id);
    await sandbox.deleteFiles({ directory: "season", fileIds: smallDupIds, season: 1 });

    const after = await sandbox.inspectTargetDir();
    expect(after.filter((f) => /\(1\)/.test(f.path))).toHaveLength(0); // no dup pollution
    expect(after).toHaveLength(14); // E01-12 (large originals) + E13-14 (new)
    // The kept E01 is the large original, not the small new copy.
    expect(after.find((f) => f.path === "Show - 01.mkv")!.sizeBytes).toBe(999_999);
  });

  it("#12 flatten: targets land flat in Season N, the residual shell is wiped by discardStaging, no (1) pollution, one transfer", async () => {
    const need = episodes(3);
    const { sandbox } = await makeSandbox({
      results: { show: [candidate("pack"), candidate("other")] },
      packs: { pack: seasonPack(3), other: seasonPack(3) },
      need,
    });
    const search = await sandbox.searchResources("show");
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "pack" });
    const moved = await sandbox.moveToSeason({ moves: [{ season: 1, fileIds: transfer.staging.filter((f) => f.isVideo).map((f) => f.id) }] });
    // Files are now flat in Season 1 (extracted out of the wrapper).
    expect(moved.seasons[1]!.every((f) => !f.path.includes("/"))).toBe(true);
    expect(moved.seasons[1]!.some((f) => /\(1\)/.test(f.path))).toBe(false);
    // One pack sufficed — further transfers refused once marked.
    await sandbox.markObtained({ codes: need });
    await expect(
      sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "other" }),
    ).rejects.toThrow(/COVERAGE_ALREADY_MET/);
    // The now-residual wrapper shell is wiped wholesale by discardStaging (new model:
    // no per-wrapper flattenPack — moveToSeason flattens, discardStaging clears leftovers).
    const discarded = await sandbox.discardStaging();
    expect(discarded.removed.length).toBeGreaterThan(0); // the residual wrapper shell was removed
  });
});
