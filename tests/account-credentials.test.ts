import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCOUNT_ID,
  InMemoryWorkflowRepository,
  migrateLegacyCookieToDefaultAccount,
  parsePan115Uid,
  provisionCategoryDirs,
  resolveStorageBinding,
} from "../src/index.js";

describe("resolveStorageBinding", () => {
  const existing = { id: "cs1", accountId: "a1", provider: "pan115", providerUid: "115_X" };
  it("new uid → insert", () => {
    expect(
      resolveStorageBinding({ provider: "pan115", providerUid: "115_Y", accountId: "a1", existing: null }),
    ).toEqual({ action: "insert" });
  });
  it("same uid, same account → refresh", () => {
    expect(
      resolveStorageBinding({ provider: "pan115", providerUid: "115_X", accountId: "a1", existing }),
    ).toEqual({ action: "refresh", storageId: "cs1" });
  });
  it("same uid, other account → reject", () => {
    expect(
      resolveStorageBinding({ provider: "pan115", providerUid: "115_X", accountId: "a2", existing }),
    ).toEqual({ action: "reject", ownerAccountId: "a1" });
  });
});

describe("provisionCategoryDirs (find-or-create, idempotent)", () => {
  it("default root name is the brand 'Mediary Scout'; reuses same-name, creates missing", async () => {
    const created: string[] = [];
    const fakeStorage = {
      async listChildDirs(parentId: string) {
        return parentId === "ROOT"
          ? [{ name: "Mediary Scout", id: "rootcid" }]
          : [{ name: "Movies", id: "moviescid" }];
      },
      async createDirectory({ name, parentId }: { name: string; parentId: string }) {
        const id = `new_${name}`;
        created.push(`${name}@${parentId}`);
        return id;
      },
    };
    const cids = await provisionCategoryDirs({ storage: fakeStorage, baseParentId: "ROOT" });
    expect(cids.rootCid).toBe("rootcid"); // reused the brand-named root
    expect(cids.moviesCid).toBe("moviescid"); // reused under root
    expect(cids.tvCid).toBe("new_TV"); // created
    expect(cids.animeCid).toBe("new_Anime"); // created
    expect(created).toEqual(["TV@rootcid", "Anime@rootcid"]);
  });

  it("honors an explicit rootName override (regression)", async () => {
    const created: string[] = [];
    const fakeStorage = {
      async listChildDirs() {
        return [] as Array<{ name: string; id: string }>;
      },
      async createDirectory({ name }: { name: string; parentId: string }) {
        created.push(name);
        return `new_${name}`;
      },
    };
    await provisionCategoryDirs({ storage: fakeStorage, baseParentId: "ROOT", rootName: "media-track-test" });
    expect(created[0]).toBe("media-track-test"); // explicit value still wins
  });

  it("honors custom root + category names (all four), creating them under the custom root", async () => {
    const created: string[] = [];
    const fakeStorage = {
      async listChildDirs() {
        return [] as Array<{ name: string; id: string }>;
      },
      async createDirectory({ name, parentId }: { name: string; parentId: string }) {
        created.push(`${name}@${parentId}`);
        return `new_${name}`;
      },
    };
    const cids = await provisionCategoryDirs({
      storage: fakeStorage,
      baseParentId: "ROOT",
      rootName: "我的影音库",
      moviesName: "电影",
      tvName: "剧集",
      animeName: "番剧",
    });
    expect(created[0]).toBe("我的影音库@ROOT");
    expect(created.slice(1)).toEqual(["电影@new_我的影音库", "剧集@new_我的影音库", "番剧@new_我的影音库"]);
    expect(cids.moviesCid).toBe("new_电影");
  });

  it("treats empty / whitespace names as unset → falls back to defaults (root never collapses to the account root)", async () => {
    const created: string[] = [];
    const fakeStorage = {
      async listChildDirs() {
        return [] as Array<{ name: string; id: string }>;
      },
      async createDirectory({ name, parentId }: { name: string; parentId: string }) {
        created.push(`${name}@${parentId}`);
        return `new_${name}`;
      },
    };
    const cids = await provisionCategoryDirs({
      storage: fakeStorage,
      baseParentId: "0", // account root
      rootName: "",
      moviesName: "   ",
      tvName: "",
      animeName: "",
    });
    // Safety: an empty rootName must NOT place categories at the account root.
    // It falls back to the brand default and creates a real container folder.
    expect(created[0]).toBe("Mediary Scout@0");
    expect(cids.rootCid).toBe("new_Mediary Scout");
    expect(cids.rootCid).not.toBe("0");
    expect(created.slice(1)).toEqual(["Movies@new_Mediary Scout", "TV@new_Mediary Scout", "Anime@new_Mediary Scout"]);
  });
});

describe("parsePan115Uid", () => {
  it("extracts the numeric uid from a cookie", () => {
    expect(parsePan115Uid("UID=100000001_A1_166...; CID=abc; SEID=def")).toBe("100000001");
  });
  it("returns null when absent", () => {
    expect(parsePan115Uid("CID=abc; SEID=def")).toBeNull();
  });
});

describe("migrateLegacyCookieToDefaultAccount", () => {
  const env = {
    MEDIA_TRACK_115_TEST_ROOT_CID: "ROOT",
    MEDIA_TRACK_MOVIES_PARENT_CID: "MOV",
    MEDIA_TRACK_TV_PARENT_CID: "TV",
    MEDIA_TRACK_ANIME_PARENT_CID: "ANI",
  } as unknown as NodeJS.ProcessEnv;

  it("moves the legacy global cookie into a default-account connected_storage", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.setSetting("pan115.cookie", "UID=42_X; CID=c; SEID=s");
    await repo.setSetting("pan115.cookieMeta", JSON.stringify({ userName: "alice", app: "alipaymini" }));

    const result = await migrateLegacyCookieToDefaultAccount({ repository: repo, env, now: "t0" });

    expect(result).toEqual({ migrated: true, providerUid: "42" });
    const cs = await repo.findConnectedStorageByUid("pan115", "42");
    expect(cs?.accountId).toBe(DEFAULT_ACCOUNT_ID);
    expect(cs?.label).toBe("alice");
    expect((cs?.payload as { cookie: string }).cookie).toBe("UID=42_X; CID=c; SEID=s");
    expect(cs?.tvCid).toBe("TV");
    expect(cs?.moviesCid).toBe("MOV");
    expect(cs?.animeCid).toBe("ANI");
    expect(cs?.rootCid).toBe("ROOT");
  });

  it("is idempotent — a second run creates nothing new", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.setSetting("pan115.cookie", "UID=42_X; CID=c");
    await migrateLegacyCookieToDefaultAccount({ repository: repo, env, now: "t0" });
    const second = await migrateLegacyCookieToDefaultAccount({ repository: repo, env, now: "t1" });
    expect(second.migrated).toBe(false);
    expect((await repo.listConnectedStorages(DEFAULT_ACCOUNT_ID)).length).toBe(1);
  });

  it("no global cookie → no-op", async () => {
    const repo = new InMemoryWorkflowRepository();
    const result = await migrateLegacyCookieToDefaultAccount({ repository: repo, env, now: "t0" });
    expect(result).toEqual({ migrated: false, providerUid: null });
    expect(await repo.listConnectedStorages(DEFAULT_ACCOUNT_ID)).toEqual([]);
  });
});
