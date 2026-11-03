import { describe, expect, it } from "vitest";
import { InMemoryWorkflowRepository } from "../src/index.js";

function row(id: string) {
  return {
    id,
    accountId: "acct1",
    provider: "pan115",
    providerUid: id,
    payload: { cookie: "c" },
    createdAt: "2026-06-18T00:00:00.000Z",
  };
}

describe("setConnectedStorageStatus (InMemory)", () => {
  it("freezes with reason/time, then unfreezes clearing them", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.upsertConnectedStorage(row("csA"));
    expect((await repo.findConnectedStorageByUid("pan115", "csA"))?.status).toBe("active");

    await repo.setConnectedStorageStatus("csA", "frozen", "登录超时", "2026-06-18T10:00:00.000Z");
    const frozen = await repo.findConnectedStorageByUid("pan115", "csA");
    expect(frozen?.status).toBe("frozen");
    expect(frozen?.frozenReason).toBe("登录超时");
    expect(frozen?.frozenAt).toBe("2026-06-18T10:00:00.000Z");

    await repo.setConnectedStorageStatus("csA", "active", null, null);
    const active = await repo.findConnectedStorageByUid("pan115", "csA");
    expect(active?.status).toBe("active");
    expect(active?.frozenReason).toBeNull();
    expect(active?.frozenAt).toBeNull();
  });

  it("a re-scan (upsert refresh) does NOT clear a frozen status by itself", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.upsertConnectedStorage(row("csA"));
    await repo.setConnectedStorageStatus("csA", "frozen", "登录超时", "2026-06-18T10:00:00.000Z");
    // re-scan refreshes the cookie payload but must not implicitly unfreeze
    await repo.upsertConnectedStorage({ ...row("csA"), payload: { cookie: "fresh" } });
    expect((await repo.findConnectedStorageByUid("pan115", "csA"))?.status).toBe("frozen");
  });
});
