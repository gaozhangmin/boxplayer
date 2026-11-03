import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { runAcquisitionAgent } from "../src/acquisition-v2/agent-loop.js";
import { TaskSandbox } from "../src/acquisition-v2/sandbox.js";
import { FakeResourceProviderV2 } from "../src/acquisition-v2/fake-provider.js";
import { Storage115Simulator } from "../src/acquisition-v2/storage-115-simulator.js";

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const;

/** A model scripted by a queue of step outputs: each is either a tool call or
 *  final text. The AI SDK feeds tool results back between steps automatically. */
function scriptedModel(steps: Array<{ tool: string; input: unknown } | { text: string }>) {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const step = steps[i++]!;
      if ("text" in step) {
        return { content: [{ type: "text" as const, text: step.text }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
      }
      return {
        content: [{ type: "tool-call" as const, toolCallId: `c${i}`, toolName: step.tool, input: JSON.stringify(step.input) }],
        finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
        usage: USAGE,
        warnings: [],
      };
    },
  });
}

async function setup(need: string[]) {
  const provider = new FakeResourceProviderV2({
    results: { "lycoris recoil": [{ id: "full_pack", title: "Lycoris Recoil S01 全集" }] },
  });
  const storage = new Storage115Simulator({
    packs: { full_pack: { files: [{ path: "[Grp] LR/LR - 01.mkv", sizeBytes: 100 }] } },
  });
  const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
  const targetSeasonDirectoryId = await storage.createDirectory({ name: "Season 1", parentId: "root" });
  const sandbox = new TaskSandbox({ provider, storage, stagingDirectoryId, targetSeasonDirectoryIds: { 1: targetSeasonDirectoryId }, need });
  return { sandbox, storage, targetSeasonDirectoryId };
}

describe("runAcquisitionAgent — the real AI SDK tool-loop over the sandbox", () => {
  it("drives a full search→transfer→extract→mark→finish loop and reads honest coverage", async () => {
    const { sandbox, storage, targetSeasonDirectoryId } = await setup(["S01E01"]);

    // A statically-scripted model can't read ids that the loop discovers at
    // runtime, so we pre-roll the storage into the post-extract state to learn
    // the real season file id, then let the model drive a fresh sandbox over
    // that same storage (inspect → mark → finish).
    const search = await sandbox.searchResources("lycoris recoil");
    const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "full_pack" });
    const stagingFileId = transfer.staging[0]!.id;
    await sandbox.moveToSeason({ moves: [{ season: 1, fileIds: [stagingFileId] }] });
    // Now a fresh sandbox over the SAME storage state, driven purely by the model.
    const liveSandbox = new TaskSandbox({
      provider: new FakeResourceProviderV2({ results: {} }),
      storage,
      stagingDirectoryId: (await storage.listSubdirectories({ directoryId: "root" })).find((d) => d.path === "staging")!.id,
      targetSeasonDirectoryIds: { 1: targetSeasonDirectoryId },
      need: ["S01E01"],
    });

    const model = scriptedModel([
      { tool: "inspectTargetDir", input: {} },
      { tool: "markObtained", input: { codes: ["S01E01"] } },
      { tool: "finish", input: {} },
      { text: "Covered S01E01 from the existing season file." },
    ]);

    const result = await runAcquisitionAgent({
      sandbox: liveSandbox,
      model,
      system: "You acquire media into the scoped sandbox.",
      prompt: "Ensure S01E01 is obtained.",
      maxSteps: 10,
    });

    expect(result.coverage.coverageMet).toBe(true);
    expect(result.coverage.obtained).toEqual(["S01E01"]);
    // finish is TERMINAL (mechanical stop): the loop ends AT the finish step, so
    // the scripted closing free-text turn ("Covered") is never reached — coverage
    // comes from the sandbox, not the model's prose. (复联4 live: finish ×3 tail.)
    expect(result.text).toBe("");
    expect(result.steps).toBeGreaterThanOrEqual(3);
  });

  it("stops the loop early on a systemic transfer block (account quota) instead of grinding every candidate", async () => {
    // The provider has many real 115 shares for the film, but the account's 云下载
    // quota is exhausted: EVERY transfer fails with the same systemic message. The
    // 心灵奇旅 incident ground through 13 of these. The loop must stop after the first.
    const provider = new FakeResourceProviderV2({
      results: {
        soul: Array.from({ length: 8 }, (_, i) => ({ id: `cand_${i}`, title: `心灵奇旅 ${i}` })),
      },
    });
    const failureMessages: Record<string, string> = {};
    for (let i = 0; i < 8; i++) failureMessages[`cand_${i}`] = "云下载配额不足，请升级VIP获得赠送配额或购买云下载配额！";
    const storage = new Storage115Simulator({ failureMessages });
    const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
    const targetSeasonDirectoryId = await storage.createDirectory({ name: "Season 1", parentId: "root" });
    const sandbox = new TaskSandbox({ provider, storage, stagingDirectoryId, targetSeasonDirectoryIds: { 1: targetSeasonDirectoryId }, need: ["S01E01"] });
    const search = await sandbox.searchResources("soul");
    const snapshotId = search.snapshot!.id;

    // A relentless agent that would otherwise transfer all 8 candidates one by one.
    const model = scriptedModel(
      Array.from({ length: 8 }, (_, i) => ({ tool: "transferCandidate", input: { snapshotId, candidateId: `cand_${i}` } })),
    );

    const result = await runAcquisitionAgent({
      sandbox,
      model,
      system: "You acquire media into the scoped sandbox.",
      prompt: "Ensure S01E01 is obtained.",
      maxSteps: 20,
    });

    // The systemic-block stop fired after the FIRST failed transfer — not all 8.
    expect(result.steps).toBeLessThanOrEqual(2);
    expect(result.coverage.coverageMet).toBe(false);
  });

  it("the cage still bites inside the loop: a refused tool call comes back as error evidence, not a crash", async () => {
    const { sandbox } = await setup(["S01E01"]);
    const model = scriptedModel([
      // A transfer bound to a snapshot never observed in THIS task is refused by
      // the cage; the refusal returns as {error} evidence, the loop does not crash.
      { tool: "transferCandidate", input: { snapshotId: "snap_never_seen", candidateId: "x" } },
      { text: "That candidate was not from a snapshot I searched; stopping." },
    ]);

    const result = await runAcquisitionAgent({
      sandbox,
      model,
      system: "You acquire media into the scoped sandbox.",
      prompt: "Ensure S01E01 is obtained.",
      maxSteps: 10,
    });

    // The loop completed (no throw); coverage honestly unmet.
    expect(result.coverage.coverageMet).toBe(false);
    expect(result.coverage.missing).toEqual(["S01E01"]);
  });

  it("病1: 成功 reportNoCoverage 后循环立即收束 — 不再有后续步（攻壳 2.5min 尾巴重放）", async () => {
    const { sandbox } = await setup(["S01E01"]);
    // 先真搜一次，让 §9 证据护栏放行 no-coverage 上报。
    await sandbox.searchResources("lycoris recoil");
    // 攻壳式脚本：报告无覆盖后，模型还想 readSkill、二次上报、finish——都不应该发生。
    const model = scriptedModel([
      { tool: "reportNoCoverage", input: { reason: "提供方无该作品资源" } },
      { tool: "readSkill", input: { section: "无覆盖上报" } },
      { tool: "reportNoCoverage", input: { reason: "再次确认无资源" } },
      { tool: "finish", input: {} },
      { text: "done" },
    ]);
    const result = await runAcquisitionAgent({
      sandbox,
      model,
      system: "You acquire media into the scoped sandbox.",
      prompt: "Ensure S01E01 is obtained.",
      maxSteps: 20,
    });
    // 报告成功的那一步就是最后一步。
    expect(result.steps).toBe(1);
    expect(result.coverage.coverageMet).toBe(false);
  });

  it("病1: 无搜索证据的 reportNoCoverage 被拒（{error}）→ 循环继续", async () => {
    const { sandbox } = await setup(["S01E01"]);
    // 不预搜——§9 护栏会 throw，asEvidence 转成 {error} 返回。
    const model = scriptedModel([
      { tool: "reportNoCoverage", input: { reason: "premature" } },
      { text: "guard refused my report; stopping." },
    ]);
    const result = await runAcquisitionAgent({
      sandbox,
      model,
      system: "You acquire media into the scoped sandbox.",
      prompt: "Ensure S01E01 is obtained.",
      maxSteps: 10,
    });
    // 第 1 步被拒后模型还能走到第 2 步输出文本（循环没被 stop 砍断）。
    expect(result.steps).toBe(2);
    expect(result.text).toMatch(/stopping/);
  });
});
