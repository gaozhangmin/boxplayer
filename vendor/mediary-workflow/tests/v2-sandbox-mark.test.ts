import { describe, expect, it } from "vitest";
import { TaskSandbox } from "../src/acquisition-v2/sandbox.js";
import { FakeResourceProviderV2 } from "../src/acquisition-v2/fake-provider.js";
import { Storage115Simulator } from "../src/acquisition-v2/storage-115-simulator.js";

async function sandboxWithNeed(need: string[]) {
  const provider = new FakeResourceProviderV2({ results: {} });
  const storage = new Storage115Simulator({ packs: {} });
  const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
  const targetSeasonDirectoryId = await storage.createDirectory({ name: "Season 1", parentId: "root" });
  return new TaskSandbox({
    provider,
    storage,
    stagingDirectoryId,
    targetSeasonDirectoryIds: { 1: targetSeasonDirectoryId },
    need,
  });
}

describe("TaskSandbox — markObtained (agent's final declaration; NO mechanical reread)", () => {
  it("records the codes the agent declares obtained — pure agent judgment, no fileId", async () => {
    const sandbox = await sandboxWithNeed(["S01E01", "S01E02"]);

    const result = await sandbox.markObtained({ codes: ["S01E01"] });

    expect(result.confirmed).toEqual(["S01E01"]);
    const summary = await sandbox.finish();
    expect(summary.obtained).toEqual(["S01E01"]);
    expect(summary.missing).toEqual(["S01E02"]);
  });

  it("records a subtitle-fallback landing so the workflow can flag 可能无中字 (movie)", async () => {
    const sandbox = await sandboxWithNeed(["MOVIE"]);
    await sandbox.markObtained({ codes: ["MOVIE"], subtitleFallback: true });
    const summary = await sandbox.finish();
    expect(summary.obtained).toEqual(["MOVIE"]);
    expect(summary.subtitleFallback).toBe(true);
  });

  it("a normal landing leaves subtitleFallback false", async () => {
    const sandbox = await sandboxWithNeed(["MOVIE"]);
    await sandbox.markObtained({ codes: ["MOVIE"] });
    expect((await sandbox.finish()).subtitleFallback).toBe(false);
  });

  it("surfaces provider-ahead marks BEYOND the need — a full pack delivered past the aired cursor (#4)", async () => {
    // The live #4 bug: need = just the aired episode (S01E01, TMDB aired=1); the
    // agent transferred a coherent full-season pack and (correctly, post skill fix)
    // markObtained all 12. finish() must surface ALL the agent's marks — not just
    // need∩marked — or E02–E12 are silently dropped here, before syncSeasonNeed can
    // record them as provider-ahead (frontend "超前"). This is exactly where the
    // quark 超市 run lost E02–E12 despite marking them.
    const sandbox = await sandboxWithNeed(["S01E01"]);
    const all = Array.from({ length: 12 }, (_, i) => `S01E${String(i + 1).padStart(2, "0")}`);

    await sandbox.markObtained({ codes: all });

    const summary = await sandbox.finish();
    expect(summary.obtained).toEqual(all); // ALL 12, not just the aired need
    expect(summary.coverageMet).toBe(true);
  });

  it("drops a malformed mark so it never reaches syncSeasonNeed's strict parser (Copilot #29)", async () => {
    // finish() feeds syncSeasonNeed → episodePartsFromCode, which THROWS on a
    // non-SxxExx token. A stray/garbage agent mark must be filtered out here, not
    // crash the whole run. Valid episode codes (incl. provider-ahead) still pass.
    const sandbox = await sandboxWithNeed(["S01E01"]);

    await sandbox.markObtained({ codes: ["S01E01", "garbage", "S01E02"] });

    const summary = await sandbox.finish();
    expect(summary.obtained).toEqual(["S01E01", "S01E02"]); // garbage dropped, sorted
  });

  it("orders obtained codes NUMERICALLY, not lexically (≥100 episodes — Copilot #29)", async () => {
    // Long-running shows (One Piece etc.) cross E99. A lexical sort would put
    // S01E100 before S01E99; finish() must order by (season, episode) numerically.
    const sandbox = await sandboxWithNeed(["S01E99"]);

    await sandbox.markObtained({ codes: ["S01E100", "S01E09", "S01E99", "S01E10"] });

    const summary = await sandbox.finish();
    expect(summary.obtained).toEqual(["S01E09", "S01E10", "S01E99", "S01E100"]);
  });

  it("does NOT re-read 115 to verify presence — the mark is the agent's call", async () => {
    // The system no longer mechanically re-reads the target dir to confirm a
    // backing file exists. move/flatten already force-reread and handed the
    // truth back; the mark is reversible; §1.13 has the agent re-judge from real
    // files every patrol, so a stale mark self-heals. Correctness is the prompt
    // ordering (clean/flatten → mark LAST), not a system gate.
    const sandbox = await sandboxWithNeed(["S01E01"]);

    const result = await sandbox.markObtained({ codes: ["S01E01"] });

    expect(result.confirmed).toEqual(["S01E01"]);
    expect((await sandbox.finish()).coverageMet).toBe(true);
  });
});
