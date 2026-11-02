import { describe, expect, it } from "vitest";
import { TaskSandbox } from "../src/acquisition-v2/sandbox.js";
import { FakeResourceProviderV2 } from "../src/acquisition-v2/fake-provider.js";
import { Storage115Simulator } from "../src/acquisition-v2/storage-115-simulator.js";

async function setup() {
  const provider = new FakeResourceProviderV2({
    results: { show: [{ id: "cand_full", title: "Show 全集" }] },
  });
  const storage = new Storage115Simulator({
    packs: { cand_full: { files: Array.from({ length: 3 }, (_, i) => ({ path: `Show - 0${i + 1}.mkv`, sizeBytes: 1 })) } },
  });
  const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
  const sandbox = new TaskSandbox({ provider, storage, stagingDirectoryId });
  return { sandbox, storage };
}

describe("TaskSandbox — transferCandidate (snapshot-bound, into staging, force-reread)", () => {
  it("transfers a snapshot-bound candidate into staging and returns the reread evidence", async () => {
    const { sandbox } = await setup();
    const search = await sandbox.searchResources("show");

    const result = await sandbox.transferCandidate({
      snapshotId: search.snapshot!.id,
      candidateId: "cand_full",
    });

    expect(result.attempt.status).toBe("succeeded");
    // The agent never trusts the transfer call — the sandbox force-rereads and
    // hands back what ACTUALLY landed in staging.
    expect(result.staging.filter((file) => file.isVideo)).toHaveLength(3);
  });

  it("refuses a candidate from a snapshot never observed in this task", async () => {
    const { sandbox } = await setup();
    await expect(
      sandbox.transferCandidate({ snapshotId: "never_seen", candidateId: "cand_full" }),
    ).rejects.toThrow(/snapshot/i);
  });

  it("refuses a candidate id that is not in the observed snapshot (no stale ids)", async () => {
    const { sandbox } = await setup();
    const search = await sandbox.searchResources("show");
    await expect(
      sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "bogus" }),
    ).rejects.toThrow(/candidate/i);
  });

  it("surfaces a SYSTEMIC block (configures providerMessage + systemicBlock) so the agent stops grinding", async () => {
    const provider = new FakeResourceProviderV2({
      results: { show: [{ id: "cand_full", title: "Show 全集" }] },
    });
    // The resource EXISTS (pack present) but the account cannot transfer it (quota) —
    // exactly the 心灵奇旅 free-account case. The sim returns the loud provider message.
    const storage = new Storage115Simulator({
      packs: { cand_full: { files: [{ path: "Show - 01.mkv", sizeBytes: 1 }] } },
      failureMessages: { cand_full: "云下载配额不足，请升级VIP获得赠送配额或购买云下载配额！" },
    });
    const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
    const sandbox = new TaskSandbox({ provider, storage, stagingDirectoryId, need: ["S01E01"] });
    const search = await sandbox.searchResources("show");

    const result = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "cand_full" });

    expect(result.attempt.status).toBe("failed");
    expect(result.attempt.providerMessage).toContain("配额");
    expect(result.systemicBlock).toEqual({ reason: "云下载配额不足，请升级VIP获得赠送配额或购买云下载配额！" });
    expect(result.staging).toHaveLength(0); // nothing landed
  });

  it("does NOT flag a dead-link failure as a systemic block (keep iterating)", async () => {
    const provider = new FakeResourceProviderV2({
      results: { show: [{ id: "dead", title: "Show 全集" }] },
    });
    const storage = new Storage115Simulator({
      failureMessages: { dead: "链接已过期" },
    });
    const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
    const sandbox = new TaskSandbox({ provider, storage, stagingDirectoryId, need: ["S01E01"] });
    const search = await sandbox.searchResources("show");

    const result = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "dead" });

    expect(result.attempt.status).toBe("failed");
    expect(result.attempt.providerMessage).toBe("链接已过期");
    expect(result.systemicBlock).toBeUndefined();
  });
});
