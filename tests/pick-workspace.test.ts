import { describe, expect, it } from "vitest";
import { pickWorkspaceStorageId, WorkspaceNotFoundError } from "../src/index.js";

const drives = [
  { id: "csNew", createdAt: "2026-06-10T00:00:00.000Z" },
  { id: "csOld", createdAt: "2026-06-01T00:00:00.000Z" },
];

describe("pickWorkspaceStorageId", () => {
  it("no param → the earliest-created (primary) drive", () => {
    expect(pickWorkspaceStorageId(drives, undefined)).toBe("csOld");
  });
  it("explicit param that the account owns → that drive", () => {
    expect(pickWorkspaceStorageId(drives, "csNew")).toBe("csNew");
  });
  it("explicit param the account does NOT own → throws WorkspaceNotFoundError", () => {
    expect(() => pickWorkspaceStorageId(drives, "csStranger")).toThrowError(WorkspaceNotFoundError);
  });
  it("no drives + no param → null (single-user fresh; root works account-only)", () => {
    expect(pickWorkspaceStorageId([], undefined)).toBeNull();
  });
  it("no drives + explicit param → throws (can't open a workspace that isn't yours)", () => {
    expect(() => pickWorkspaceStorageId([], "csX")).toThrowError(WorkspaceNotFoundError);
  });
});
