import { describe, expect, it } from "vitest";
import {
  DuplicateUsernameError,
  InMemoryWorkflowRepository,
  type Account,
  type Session,
} from "../src/index.js";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "acct_1",
    username: "alice",
    passwordHash: "scrypt:aa:bb",
    groupId: null,
    isOwner: true,
    createdAt: "2026-06-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("accounts + sessions repository (InMemory)", () => {
  it("creates and looks up an account by username and id", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.createAccount(account());
    expect((await repo.getAccountByUsername("alice"))?.id).toBe("acct_1");
    expect((await repo.getAccountById("acct_1"))?.username).toBe("alice");
    expect(await repo.getAccountByUsername("nobody")).toBeNull();
  });

  it("rejects a duplicate username", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.createAccount(account());
    await expect(repo.createAccount(account({ id: "acct_2" }))).rejects.toBeInstanceOf(DuplicateUsernameError);
  });

  it("lists accounts", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.createAccount(account());
    await repo.createAccount(account({ id: "acct_2", username: "bob", isOwner: false }));
    expect((await repo.listAccounts()).map((a) => a.username).sort()).toEqual(["alice", "bob"]);
  });

  it("creates, fetches and deletes a session", async () => {
    const repo = new InMemoryWorkflowRepository();
    const session: Session = {
      id: "sess_1",
      accountId: "acct_1",
      expiresAt: "2026-06-25T00:00:00.000Z",
      createdAt: "2026-06-18T00:00:00.000Z",
    };
    await repo.createSession(session);
    expect((await repo.getSession("sess_1"))?.accountId).toBe("acct_1");
    await repo.deleteSession("sess_1");
    expect(await repo.getSession("sess_1")).toBeNull();
  });
});
