import { describe, expect, it } from "vitest";
import { DEFAULT_ACCOUNT_ID } from "../src/domain.js";
import {
  globalNavHref,
  lastQueryKey,
  resolveWorkspaceFromParam,
  scopeFromAccount,
  showHref,
  switcherTabHref,
  workspaceSection,
  type WorkflowScope,
} from "../src/workflow-scope.js";

describe("WorkflowScope", () => {
  it("scopeFromAccount fills account + storage", () => {
    const s: WorkflowScope = scopeFromAccount(DEFAULT_ACCOUNT_ID, "cs_1");
    expect(s).toEqual({ accountId: DEFAULT_ACCOUNT_ID, connectedStorageId: "cs_1" });
  });
  it("scopeFromAccount allows null storage (pre-migration / unscoped reads)", () => {
    expect(scopeFromAccount(DEFAULT_ACCOUNT_ID, null)).toEqual({
      accountId: DEFAULT_ACCOUNT_ID,
      connectedStorageId: null,
    });
  });
});

describe("globalNavHref", () => {
  it("returns bare base when no active drive (primary/undefined)", () => {
    expect(globalNavHref("/notifications", undefined)).toBe("/notifications");
  });
  it("appends ?w for a non-primary drive", () => {
    expect(globalNavHref("/activity", "cs_quark_AA")).toBe("/activity?w=cs_quark_AA");
  });
  it("encodes the drive id", () => {
    expect(globalNavHref("/settings", "a b/c")).toBe("/settings?w=a%20b%2Fc");
  });
});

describe("resolveWorkspaceFromParam", () => {
  const drives = [
    { id: "cs_primary", createdAt: "2026-01-01T00:00:00Z" },
    { id: "cs_quark", createdAt: "2026-02-01T00:00:00Z" },
  ];
  it("no w → primary (earliest), bare basePath, undefined active", () => {
    expect(resolveWorkspaceFromParam(drives, undefined)).toEqual({
      connectedStorageId: "cs_primary",
      basePath: "/",
      activeStorageId: undefined,
    });
  });
  it("w of a non-primary owned drive → that drive, /w/<id>, active set", () => {
    expect(resolveWorkspaceFromParam(drives, "cs_quark")).toEqual({
      connectedStorageId: "cs_quark",
      basePath: "/w/cs_quark",
      activeStorageId: "cs_quark",
    });
  });
  it("w equal to primary id → canonical primary (bare, undefined active)", () => {
    expect(resolveWorkspaceFromParam(drives, "cs_primary")).toEqual({
      connectedStorageId: "cs_primary",
      basePath: "/",
      activeStorageId: undefined,
    });
  });
  it("unknown/stale w → falls back to primary (no throw)", () => {
    expect(resolveWorkspaceFromParam(drives, "cs_gone")).toEqual({
      connectedStorageId: "cs_primary",
      basePath: "/",
      activeStorageId: undefined,
    });
  });
  it("no drives → null connectedStorageId, bare basePath", () => {
    expect(resolveWorkspaceFromParam([], "cs_x")).toEqual({
      connectedStorageId: null,
      basePath: "/",
      activeStorageId: undefined,
    });
  });
});

describe("workspaceSection", () => {
  it("content root/workspace → search by default, library when tab=library", () => {
    expect(workspaceSection("/", null)).toBe("search");
    expect(workspaceSection("/", "library")).toBe("library");
    expect(workspaceSection("/w/cs_x", "search")).toBe("search");
    expect(workspaceSection("/w/cs_x", "library")).toBe("library");
  });
  it("global pages map by pathname", () => {
    expect(workspaceSection("/notifications", null)).toBe("notifications");
    expect(workspaceSection("/activity", null)).toBe("activity");
    expect(workspaceSection("/settings", null)).toBe("settings");
  });
  it("unknown paths → other", () => {
    expect(workspaceSection("/show/123", null)).toBe("other");
    expect(workspaceSection("/foreign-work/abc", null)).toBe("other");
  });
});

describe("switcherTabHref", () => {
  const primary = "cs_primary";
  it("library/search keep the tab, on the target drive's content path", () => {
    expect(switcherTabHref("library", "cs_quark", primary)).toBe("/w/cs_quark?tab=library");
    expect(switcherTabHref("search", "cs_quark", primary)).toBe("/w/cs_quark?tab=search");
    expect(switcherTabHref("library", primary, primary)).toBe("/?tab=library");
    expect(switcherTabHref("search", primary, primary)).toBe("/?tab=search");
  });
  it("global sections keep the section, carry ?w (primary omits it)", () => {
    expect(switcherTabHref("notifications", "cs_quark", primary)).toBe("/notifications?w=cs_quark");
    expect(switcherTabHref("activity", "cs_quark", primary)).toBe("/activity?w=cs_quark");
    expect(switcherTabHref("settings", primary, primary)).toBe("/settings");
  });
  it("other → target drive workspace root", () => {
    expect(switcherTabHref("other", "cs_quark", primary)).toBe("/w/cs_quark");
    expect(switcherTabHref("other", primary, primary)).toBe("/");
  });
});

describe("lastQueryKey", () => {
  it("keys search memory by basePath (per-drive)", () => {
    expect(lastQueryKey("/")).toBe("media-track.lastQuery./");
    expect(lastQueryKey("/w/cs_quark")).toBe("media-track.lastQuery./w/cs_quark");
    expect(lastQueryKey("/")).not.toBe(lastQueryKey("/w/cs_quark"));
  });
});

describe("showHref", () => {
  it("omits ?w on primary (undefined) — link stays scope-free", () => {
    expect(showHref(278, "library", undefined)).toBe("/show/278?from=library");
    expect(showHref(278, "search", undefined)).toBe("/show/278?from=search");
  });
  it("carries &w for a non-primary drive so the detail page resolves the right drive", () => {
    expect(showHref(278, "library", "cs_100000002")).toBe("/show/278?from=library&w=cs_100000002");
    expect(showHref(37165, "search", "cs_quark")).toBe("/show/37165?from=search&w=cs_quark");
  });
  it("carries &t=type hint so untracked titles resolve the right TMDB namespace (movie≠tv id)", () => {
    expect(showHref(278, "search", undefined, "movie")).toBe("/show/278?from=search&t=movie");
    expect(showHref(278, "library", "cs_x", "movie")).toBe("/show/278?from=library&w=cs_x&t=movie");
    expect(showHref(1399, "search", undefined, "tv")).toBe("/show/1399?from=search&t=tv");
    expect(showHref(123, "library", undefined, "anime")).toBe("/show/123?from=library&t=anime");
  });
});
