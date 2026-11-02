import { describe, expect, it } from "vitest";
import {
  createExecutorForBrand,
  QuarkStorageExecutor,
  Storage115Executor,
} from "../src/index.js";
import { GuangYaStorageExecutor } from "../src/guangya-storage-executor.js";
import { Pan123StorageExecutor } from "../src/pan123-storage-executor.js";
import { TianyiStorageExecutor } from "../src/tianyi-storage-executor.js";
import * as barrel from "../src/index.js";

describe("createExecutorForBrand", () => {
  it("pan115 → Storage115Executor (write scope from scopeCids)", () => {
    const exec = createExecutorForBrand({ provider: "pan115", cookie: "UID=1;CID=2", scopeCids: ["root"] });
    expect(exec).toBeInstanceOf(Storage115Executor);
  });

  it("quark → QuarkStorageExecutor", () => {
    const exec = createExecutorForBrand({ provider: "quark", cookie: "__uid=1", scopeCids: ["ROOT"] });
    expect(exec).toBeInstanceOf(QuarkStorageExecutor);
  });

  it("guangya → GuangYaStorageExecutor (from a token credential blob, no cookie)", () => {
    const exec = createExecutorForBrand({
      provider: "guangya",
      credential: { accessToken: "AT", refreshToken: "RT", deviceId: "d" },
      scopeCids: ["root"],
    });
    expect(exec).toBeInstanceOf(GuangYaStorageExecutor);
  });

  it("tianyi → TianyiStorageExecutor (from a token credential blob, no cookie)", () => {
    const exec = createExecutorForBrand({
      provider: "tianyi",
      credential: { sessionKey: "SK", accessToken: "AT", refreshToken: "RT" },
      scopeCids: ["s1"],
    });
    expect(exec).toBeInstanceOf(TianyiStorageExecutor);
  });

  it("tianyi constructs across the optional paths (familySessionKey / onCredentialRefresh present and absent)", () => {
    // exactOptionalPropertyTypes pin: the factory must not set optional client
    // options to `undefined` — both shapes must construct.
    const bare = createExecutorForBrand({
      provider: "tianyi",
      credential: { sessionKey: "SK", accessToken: "AT", refreshToken: "RT" },
      scopeCids: ["s1"],
    });
    expect(bare).toBeInstanceOf(TianyiStorageExecutor);

    const full = createExecutorForBrand({
      provider: "tianyi",
      credential: {
        sessionKey: "SK",
        accessToken: "AT",
        refreshToken: "RT",
        familySessionKey: "FSK",
      },
      scopeCids: ["s1"],
      onCredentialRefresh: () => {},
    });
    expect(full).toBeInstanceOf(TianyiStorageExecutor);
  });

  it("pan123 → Pan123StorageExecutor (from a token credential blob, no cookie)", () => {
    const exec = createExecutorForBrand({
      provider: "pan123",
      credential: { token: "TK" },
      scopeCids: ["s1"],
    });
    expect(exec).toBeInstanceOf(Pan123StorageExecutor);
  });

  it("pan123 constructs when the credential is missing or empty (token falls back to '')", () => {
    const empty = createExecutorForBrand({ provider: "pan123", credential: {}, scopeCids: ["s1"] });
    expect(empty).toBeInstanceOf(Pan123StorageExecutor);

    const absent = createExecutorForBrand({ provider: "pan123", scopeCids: ["s1"] });
    expect(absent).toBeInstanceOf(Pan123StorageExecutor);
  });

  it("barrel exports the three pan123 modules (client / qrcode login / executor)", () => {
    expect(barrel.Pan123StorageExecutor).toBe(Pan123StorageExecutor);
    expect(typeof barrel.Pan123Client).toBe("function");
    expect(typeof barrel.Pan123QrLoginClient).toBe("function");
  });

  it("barrel exports the three tianyi modules (client / qrcode login / executor)", () => {
    expect(barrel.TianyiStorageExecutor).toBe(TianyiStorageExecutor);
    expect(typeof barrel.TianyiClient).toBe("function");
    expect(typeof barrel.TianyiQrLoginClient).toBe("function");
  });

  it("unknown provider throws", () => {
    expect(() => createExecutorForBrand({ provider: "baidu", cookie: "x", scopeCids: ["y"] })).toThrowError(
      /unknown storage brand/i,
    );
  });
});
