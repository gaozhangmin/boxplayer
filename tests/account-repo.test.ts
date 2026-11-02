import { describe, expect, it } from "vitest";
import { InMemoryWorkflowRepository } from "../src/repository.js";
import { DEFAULT_ACCOUNT_ID } from "../src/domain.js";

function seededDefault(repo: InMemoryWorkflowRepository) {
  // Mirror the factory-seeded acct_default (empty password, is_owner).
  return repo.createAccount({
    id: DEFAULT_ACCOUNT_ID,
    username: "default",
    passwordHash: "",
    groupId: null,
    isOwner: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("adoptDefaultAccount", () => {
  it("sets username+passwordHash on acct_default in place (keeps id + is_owner)", async () => {
    const repo = new InMemoryWorkflowRepository();
    await seededDefault(repo);
    await repo.adoptDefaultAccount({ username: "alice", passwordHash: "scrypt:x:y" });
    const acct = await repo.getAccountById(DEFAULT_ACCOUNT_ID);
    expect(acct?.username).toBe("alice");
    expect(acct?.passwordHash).toBe("scrypt:x:y");
    expect(acct?.isOwner).toBe(true);
    expect(await repo.getAccountByUsername("alice")).not.toBeNull();
  });

  it("rejects a username already taken by ANOTHER account", async () => {
    const repo = new InMemoryWorkflowRepository();
    await seededDefault(repo);
    await repo.createAccount({
      id: "acct_b", username: "bob", passwordHash: "scrypt:1:2", groupId: null, isOwner: false, createdAt: "t",
    });
    await expect(repo.adoptDefaultAccount({ username: "bob", passwordHash: "scrypt:x:y" })).rejects.toThrow();
  });
});

describe("setAccountPassword", () => {
  it("updates only the password hash of the target account", async () => {
    const repo = new InMemoryWorkflowRepository();
    await seededDefault(repo);
    await repo.adoptDefaultAccount({ username: "alice", passwordHash: "scrypt:a:1" });
    await repo.setAccountPassword(DEFAULT_ACCOUNT_ID, "scrypt:b:2");
    const acct = await repo.getAccountById(DEFAULT_ACCOUNT_ID);
    expect(acct?.passwordHash).toBe("scrypt:b:2");
    expect(acct?.username).toBe("alice");
  });
});

describe("deleteSessionsForAccount", () => {
  it("deletes all sessions of an account except an optional kept one", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.createSession({ id: "s1", accountId: "a", expiresAt: "z", createdAt: "z" });
    await repo.createSession({ id: "s2", accountId: "a", expiresAt: "z", createdAt: "z" });
    await repo.createSession({ id: "s3", accountId: "b", expiresAt: "z", createdAt: "z" });
    await repo.deleteSessionsForAccount("a", "s1");
    expect(await repo.getSession("s1")).not.toBeNull(); // kept
    expect(await repo.getSession("s2")).toBeNull(); // deleted
    expect(await repo.getSession("s3")).not.toBeNull(); // other account untouched
  });

  it("deletes ALL of an account's sessions when no exception given", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.createSession({ id: "s1", accountId: "a", expiresAt: "z", createdAt: "z" });
    await repo.createSession({ id: "s2", accountId: "a", expiresAt: "z", createdAt: "z" });
    await repo.deleteSessionsForAccount("a");
    expect(await repo.getSession("s1")).toBeNull();
    expect(await repo.getSession("s2")).toBeNull();
  });
});
