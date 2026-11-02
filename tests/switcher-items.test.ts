import { describe, expect, it } from "vitest";
import { switcherItems } from "../src/index.js";

const drives = [
  { id: "csNew", label: null, providerUid: "100000002", createdAt: "2026-06-10T00:00:00.000Z", status: "active" as const },
  { id: "csOld", label: "我的主号", providerUid: "100000001", createdAt: "2026-06-01T00:00:00.000Z", status: "active" as const },
];

describe("switcherItems", () => {
  it("primary (earliest) routes to '/', others to /w/<id>", () => {
    const items = switcherItems(drives, "/");
    expect(items.map((i) => [i.id, i.href])).toEqual([
      ["csOld", "/"],
      ["csNew", "/w/csNew"],
    ]);
  });
  it("on '/' the primary is active", () => {
    expect(switcherItems(drives, "/").find((i) => i.isActive)?.id).toBe("csOld");
  });
  it("on /w/<id> that drive is active", () => {
    expect(switcherItems(drives, "/w/csNew").find((i) => i.isActive)?.id).toBe("csNew");
  });
  it("a non-workspace path (/settings) keeps the primary active", () => {
    expect(switcherItems(drives, "/settings").find((i) => i.isActive)?.id).toBe("csOld");
  });
  it("carries provider through to the output item", () => {
    const withProvider = [
      { id: "csOld", label: "主号", provider: "pan115", providerUid: "100000001", createdAt: "2026-06-01T00:00:00.000Z", status: "active" as const },
      { id: "csNew", label: null, provider: "quark", providerUid: "100000002", createdAt: "2026-06-10T00:00:00.000Z", status: "active" as const },
    ];
    const items = switcherItems(withProvider, "/");
    expect(items.find((i) => i.id === "csOld")?.provider).toBe("pan115");
    expect(items.find((i) => i.id === "csNew")?.provider).toBe("quark");
  });
  it("provider is undefined when the storage omits it (no throw)", () => {
    const items = switcherItems(drives, "/"); // top-of-file drives have no provider
    expect(items[0]!.provider).toBeUndefined();
  });
  it("unnamed label uses the brand registry label per provider (光鸭 ≠ 115)", () => {
    const branded = [
      { id: "g", label: null, provider: "guangya", providerUid: "100000003", createdAt: "2026-06-01T00:00:00.000Z", status: "active" as const },
      { id: "q", label: null, provider: "quark", providerUid: "100000002", createdAt: "2026-06-10T00:00:00.000Z", status: "active" as const },
      { id: "p", label: null, provider: "pan115", providerUid: "100000001", createdAt: "2026-06-20T00:00:00.000Z", status: "active" as const },
    ];
    const items = switcherItems(branded, "/");
    expect(items.find((i) => i.id === "g")?.label).toContain("光鸭");
    expect(items.find((i) => i.id === "g")?.label).not.toContain("115");
    expect(items.find((i) => i.id === "q")?.label).toContain("夸克");
    expect(items.find((i) => i.id === "p")?.label).toContain("115");
  });
  it("label falls back to a uid-tail when unnamed; frozen surfaced", () => {
    const frozen = [
      { id: "csOld", label: null, providerUid: "100000001", createdAt: "2026-06-01T00:00:00.000Z", status: "active" as const },
      { id: "csNew", label: null, providerUid: "100000002", createdAt: "2026-06-10T00:00:00.000Z", status: "frozen" as const },
    ];
    const items = switcherItems(frozen, "/");
    expect(items[0]!.label).toContain("0001");
    expect(items.find((i) => i.id === "csNew")?.frozen).toBe(true);
  });
});
