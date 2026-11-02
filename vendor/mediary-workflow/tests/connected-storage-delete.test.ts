import { describe, expect, it } from "vitest";
import { InMemoryWorkflowRepository, type UpsertConnectedStorageInput } from "../src/index.js";

function driveRow(accountId: string): UpsertConnectedStorageInput {
  return {
    id: "cs_100000001",
    accountId,
    provider: "pan115",
    providerUid: "100000001",
    label: "主115",
    payload: {},
    rootCid: "r",
    moviesCid: "m",
    tvCid: "t",
    animeCid: "a",
    createdAt: "2026-06-20T00:00:00.000Z",
  };
}

describe("deleteConnectedStorage (InMemory)", () => {
  it("removes the drive row but keeps the account's other drives", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.upsertConnectedStorage(driveRow("acct_default"));
    await repo.upsertConnectedStorage({ ...driveRow("acct_default"), id: "cs_quark_X", provider: "quark", providerUid: "X" });
    expect((await repo.listConnectedStorages("acct_default")).map((s) => s.id).sort()).toEqual(["cs_100000001", "cs_quark_X"]);

    await repo.deleteConnectedStorage("acct_default", "cs_100000001");
    expect((await repo.listConnectedStorages("acct_default")).map((s) => s.id)).toEqual(["cs_quark_X"]);
  });

  it("is fail-closed: does NOT delete a drive owned by a different account", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.upsertConnectedStorage(driveRow("acct_alice"));
    await repo.deleteConnectedStorage("acct_bob", "cs_100000001"); // wrong account
    expect((await repo.listConnectedStorages("acct_alice")).map((s) => s.id)).toEqual(["cs_100000001"]);
  });

  it("re-binding the SAME physical drive (same uid → same cs_id) reconnects scoped data", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.upsertConnectedStorage(driveRow("acct_default"));
    await repo.deleteConnectedStorage("acct_default", "cs_100000001");
    expect(await repo.listConnectedStorages("acct_default")).toEqual([]);
    await repo.upsertConnectedStorage(driveRow("acct_default"));
    expect((await repo.listConnectedStorages("acct_default")).map((s) => s.id)).toEqual(["cs_100000001"]);
  });
});
