import { describe, expect, it } from "vitest";
import {
  allowedResourceTypesForKinds,
  brandSupportsProwlarr,
  getStorageBrand,
} from "./storage-brands.js";

describe("allowedResourceTypesForKinds", () => {
  it("maps a quark brand's kinds to quark-only links", () => {
    expect(allowedResourceTypesForKinds(getStorageBrand("quark").resourceProviderKinds)).toEqual(["quark"]);
  });

  it("maps a 光鸭(magnet) brand's kinds to magnet-only links", () => {
    expect(allowedResourceTypesForKinds(getStorageBrand("guangya").resourceProviderKinds)).toEqual(["magnet"]);
  });

  it("maps a 115 brand's kinds to 115 + magnet", () => {
    expect(allowedResourceTypesForKinds(getStorageBrand("pan115").resourceProviderKinds)).toEqual([
      "115",
      "magnet",
    ]);
  });

  it("falls back to 115 + magnet for an unknown/legacy kind set", () => {
    expect(allowedResourceTypesForKinds(["pansou-115", "prowlarr"])).toEqual(["115", "magnet"]);
  });
});

describe("STORAGE_BRANDS registry", () => {
  it("registers tianyi as a token-auth share brand with pansou-tianyi kind", () => {
    const b = getStorageBrand("tianyi");
    expect(b.label).toBe("天翼云盘");
    expect(b.authKind).toBe("token");
    expect(b.resourceProviderKinds).toEqual(["pansou-tianyi"]);
    expect(b.assumeChineseSubsFromChineseTitle).toBe(true);
    expect(brandSupportsProwlarr("tianyi")).toBe(false);
    expect(allowedResourceTypesForKinds(["pansou-tianyi"])).toEqual(["tianyi"]);
  });

  it("registers pan123 as a token-auth share brand with pansou-123 kind", () => {
    const b = getStorageBrand("pan123");
    expect(b.label).toBe("123网盘");
    expect(b.authKind).toBe("token");
    expect(b.resourceProviderKinds).toEqual(["pansou-123"]);
    expect(b.assumeChineseSubsFromChineseTitle).toBe(true);
    expect(b.provisionRootId).toBe("0");
    expect(b.requiredCredentialKeys).toEqual(["token"]);
    expect(brandSupportsProwlarr("pan123")).toBe(false);
    expect(allowedResourceTypesForKinds(["pansou-123"])).toEqual(["123"]);
  });

  it("existing cookie brands report authKind cookie; guangya token", () => {
    expect(getStorageBrand("pan115").authKind).toBe("cookie");
    expect(getStorageBrand("quark").authKind).toBe("cookie");
    expect(getStorageBrand("guangya").authKind).toBe("token");
  });

  it("carries each brand's provisionRootId (category-dir root parent is registry data)", () => {
    // 115 & 夸克 provision under account root "0"; 光鸭 under "" (account root);
    // 天翼 under personal-cloud folder "-11". These drive provisionCategoryDirs'
    // baseParentId — a change here shifts where the media tree gets created.
    expect(getStorageBrand("pan115").provisionRootId).toBe("0");
    expect(getStorageBrand("quark").provisionRootId).toBe("0");
    expect(getStorageBrand("guangya").provisionRootId).toBe("");
    expect(getStorageBrand("tianyi").provisionRootId).toBe("-11");
  });

  it("carries each token brand's requiredCredentialKeys (drives the connection guard)", () => {
    // extractStorageCredential treats a token blob as connected iff every one of
    // these keys is a non-empty string; a change here changes what counts as a
    // usable credential. Cookie brands have none (they authenticate by cookie).
    expect(getStorageBrand("guangya").requiredCredentialKeys).toEqual(["accessToken", "refreshToken"]);
    expect(getStorageBrand("tianyi").requiredCredentialKeys).toEqual([
      "sessionKey",
      "accessToken",
      "refreshToken",
    ]);
    expect(getStorageBrand("pan115").requiredCredentialKeys).toBeUndefined();
    expect(getStorageBrand("quark").requiredCredentialKeys).toBeUndefined();
  });
});
