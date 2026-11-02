import { describe, expect, it } from "vitest";
import { TaskSandbox } from "../src/acquisition-v2/sandbox.js";
import { FakeResourceProviderV2 } from "../src/acquisition-v2/fake-provider.js";
import { Storage115Simulator, type TransferAttemptResult } from "../src/acquisition-v2/storage-115-simulator.js";
import type { AssrtCandidate, AssrtSubtitleFile } from "../src/subtitle-provider.js";
import { buildSandboxToolSet } from "../src/acquisition-v2/agent-loop.js";

/** The provider object shape primeSubtitleSnapshot takes. */
type FakeAssrtProvider = {
  search(keyword: string): Promise<AssrtCandidate[]>;
  detail(id: number): Promise<AssrtSubtitleFile[]>;
};

function makeAssrtProvider(
  searchResults: AssrtCandidate[],
  detailByCandidate: Record<number, AssrtSubtitleFile[]>,
  spy?: { searchCalls?: number; detailCalls?: number },
): FakeAssrtProvider {
  return {
    search: async (_keyword: string) => {
      spy?.searchCalls !== undefined && (spy.searchCalls += 1);
      return searchResults;
    },
    detail: async (id: number) => {
      spy?.detailCalls !== undefined && (spy.detailCalls += 1);
      return detailByCandidate[id] ?? [];
    },
  };
}

/** Build a TaskSandbox wired to a fake video provider + sim storage. assrt is NOT
 *  passed at construction — it goes to primeSubtitleSnapshot per-test. */
async function createSubtitleSandbox() {
  const provider = new FakeResourceProviderV2({ results: { title: [] } });
  const storage = new Storage115Simulator({ packs: {} });
  const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
  const targetSeasonDirectoryId = await storage.createDirectory({ name: "Season 1", parentId: "root" });
  const sandbox = new TaskSandbox({
    provider,
    storage,
    stagingDirectoryId,
    targetSeasonDirectoryIds: { 1: targetSeasonDirectoryId },
    need: ["S01E01"],
  });
  return { sandbox, stagingDirectoryId, targetSeasonDirectoryId };
}

describe("subtitle snapshot pre-warming + view", () => {
  it("primeSubtitleSnapshot pre-warms assrt candidates, viewSubtitleSnapshot renders them", async () => {
    const { sandbox } = await createSubtitleSandbox();
    const provider = makeAssrtProvider(
      [{ id: 713570, title: "绝命毒师 第二季 · Breaking.Bad.S02", lang: "英 简 双语" }],
      {},
    );

    await sandbox.primeSubtitleSnapshot("绝命毒师", provider);

    const snap = sandbox.viewSubtitleSnapshot();
    expect(snap.document).toContain("713570");
    expect(snap.document).toContain("绝命毒师 第二季");
    expect(snap.candidateCount).toBe(1);
  });

  it("viewSubtitleSnapshot before any pre-warm returns an empty doc", async () => {
    const { sandbox } = await createSubtitleSandbox();
    const snap = sandbox.viewSubtitleSnapshot();
    expect(snap.candidateCount).toBe(0);
    expect(snap.document).toMatch(/no subtitle|无字幕|empty|未预热/i);
  });

  it("viewSubtitleSnapshot is free + repeatable (no provider re-hit)", async () => {
    const { sandbox } = await createSubtitleSandbox();
    const spy = { searchCalls: 0, detailCalls: 0 };
    const provider = makeAssrtProvider([{ id: 1, title: "x", lang: "" }], {}, spy);

    await sandbox.primeSubtitleSnapshot("k", provider);
    const searchCallsAfterPrime = spy.searchCalls;

    sandbox.viewSubtitleSnapshot();
    sandbox.viewSubtitleSnapshot();
    expect(spy.searchCalls).toBe(searchCallsAfterPrime); // view never re-hits search
  });
});

describe("transferSubtitle", () => {
  it("resolves the candidate's detail filelist and lands each file via storage.transferSubtitleUrl", async () => {
    const { sandbox } = await createSubtitleSandbox();
    const file = { filename: "Breaking.Bad.S02E01.ass", url: "http://file0.assrt.net/onthefly/713570/-/1/a.ass?api=1" };
    const provider = makeAssrtProvider(
      [{ id: 713570, title: "BB S02", lang: "英 简 双语" }],
      { 713570: [file] },
    );
    await sandbox.primeSubtitleSnapshot("BB", provider);

    const result = await sandbox.transferSubtitle({ candidateId: 713570 });

    expect(result.status).toBe("succeeded");
    expect(result.landedFilenames).toEqual(["Breaking.Bad.S02E01.ass"]);
  });

  it("throws when the candidate was not in the pre-warmed snapshot (no stale ids)", async () => {
    const { sandbox } = await createSubtitleSandbox();
    const provider = makeAssrtProvider([{ id: 1, title: "x", lang: "" }], {});
    await sandbox.primeSubtitleSnapshot("k", provider);

    await expect(sandbox.transferSubtitle({ candidateId: 999 })).rejects.toThrow(
      /not in.*subtitle.*snapshot|未.*预热/i,
    );
  });

  it("returns failed when the filelist is empty (detail miss)", async () => {
    const { sandbox } = await createSubtitleSandbox();
    const provider = makeAssrtProvider([{ id: 1, title: "x", lang: "" }], {}); // detail(1) -> []
    await sandbox.primeSubtitleSnapshot("k", provider);

    const result = await sandbox.transferSubtitle({ candidateId: 1 });
    expect(result.status).toBe("failed");
    expect(result.landedFilenames).toEqual([]);
  });

  it("partial success: lands the files that succeed, reports succeeded, surfaces the failure error", async () => {
    const provider = new FakeResourceProviderV2({ results: { title: [] } });
    const storage = new Storage115Simulator({ packs: {} });
    const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
    const targetSeasonDirectoryId = await storage.createDirectory({ name: "Season 1", parentId: "root" });
    const sandbox = new TaskSandbox({
      provider,
      storage,
      stagingDirectoryId,
      targetSeasonDirectoryIds: { 1: targetSeasonDirectoryId },
      need: ["S01E01"],
    });
    // Override the sim's subtitle landing: 1st file succeeds, 2nd fails.
    let call = 0;
    storage.transferSubtitleUrl = async (
      _input: { url: string; filename: string; intoDirectoryId: string },
    ): Promise<TransferAttemptResult> => {
      call += 1;
      if (call === 1) return { status: "succeeded", materializedFileIds: ["f1"] };
      return { status: "failed", materializedFileIds: [], providerMessage: "dead link" };
    };
    const files = [
      { filename: "Show.S01E01.ass", url: "http://file0.assrt.net/onthefly/1/-/1/a.ass?api=1" },
      { filename: "Show.S01E02.ass", url: "http://file0.assrt.net/onthefly/1/-/2/b.ass?api=1" },
    ];
    const assrtProvider = makeAssrtProvider([{ id: 500, title: "Show", lang: "简体" }], { 500: files });
    await sandbox.primeSubtitleSnapshot("Show", assrtProvider);

    const result = await sandbox.transferSubtitle({ candidateId: 500 });

    expect(result.status).toBe("succeeded"); // at least one landed
    expect(result.landedFilenames).toEqual(["Show.S01E01.ass"]); // only the one that landed
    expect(result.error).toBe("dead link"); // the failure's message surfaced
  });
});

describe("renameSubtitle (batch, per-item guards)", () => {
  it("renames a landed subtitle to match its video (the ONE rename exception)", async () => {
    const { sandbox, storage, stagingDirectoryId } = await createSubtitleSandboxFull();
    const landed = (await storage.transferSubtitleUrl({ url: "http://x/a.ass", filename: "raw.ass", intoDirectoryId: stagingDirectoryId })).materializedFileIds[0]!;
    const out = await sandbox.renameSubtitle({ renames: [{ fileId: landed, newName: "The.Video.S02E01.ass" }] });
    expect(out.renamed).toEqual(["The.Video.S02E01.ass"]);
    expect(out.errors).toBeUndefined();
  });

  it("collects a per-item error for a fileId not in staging", async () => {
    const { sandbox } = await createSubtitleSandbox();
    const out = await sandbox.renameSubtitle({ renames: [{ fileId: "not-in-staging", newName: "x.ass" }] });
    expect(out.renamed).toEqual([]);
    expect(out.errors![0]!.error).toMatch(/NOT_IN_STAGING/i);
  });

  it("collects a per-item error for path separators in newName", async () => {
    const { sandbox, storage, stagingDirectoryId } = await createSubtitleSandboxFull();
    const landed = (await storage.transferSubtitleUrl({ url: "http://x/a.ass", filename: "raw.ass", intoDirectoryId: stagingDirectoryId })).materializedFileIds[0]!;
    const out = await sandbox.renameSubtitle({ renames: [{ fileId: landed, newName: "sub/Show.S01E01.ass" }] });
    expect(out.renamed).toEqual([]);
    expect(out.errors![0]!.error).toMatch(/path separator|INVALID_SUBTITLE_NAME/i);
  });

  it("collects a per-item error when newName drops the subtitle extension (disguise guard)", async () => {
    const { sandbox, storage, stagingDirectoryId } = await createSubtitleSandboxFull();
    const landed = (await storage.transferSubtitleUrl({ url: "http://x/a.ass", filename: "raw.ass", intoDirectoryId: stagingDirectoryId })).materializedFileIds[0]!;
    const out = await sandbox.renameSubtitle({ renames: [{ fileId: landed, newName: "Show.S01E01.mkv" }] });
    expect(out.renamed).toEqual([]);
    expect(out.errors![0]!.error).toMatch(/INVALID_SUBTITLE_NAME|subtitle extension/i);
  });

  it("collects a per-item error when the SOURCE is not a subtitle (videos stay un-renameable)", async () => {
    const { sandbox, storage, stagingDirectoryId } = await createSubtitleSandboxFull();
    const video = (await storage.transferSubtitleUrl({ url: "http://x/v.mkv", filename: "video.mkv", intoDirectoryId: stagingDirectoryId })).materializedFileIds[0]!;
    const out = await sandbox.renameSubtitle({ renames: [{ fileId: video, newName: "Show.S01E01.ass" }] });
    expect(out.renamed).toEqual([]);
    expect(out.errors![0]!.error).toMatch(/NOT_A_SUBTITLE|only subtitles/i);
  });
});

/** Like createSubtitleSandbox but also returns the storage + staging handle. */
async function createSubtitleSandboxFull() {
  const provider = new FakeResourceProviderV2({ results: { title: [] } });
  const storage = new Storage115Simulator({ packs: {} });
  const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
  const targetSeasonDirectoryId = await storage.createDirectory({ name: "Season 1", parentId: "root" });
  const sandbox = new TaskSandbox({
    provider,
    storage,
    stagingDirectoryId,
    targetSeasonDirectoryIds: { 1: targetSeasonDirectoryId },
    need: ["S01E01"],
  });
  return { sandbox, storage, stagingDirectoryId };
}

describe("buildSandboxToolSet renameSubtitle registration", () => {
  it("registers renameSubtitle only when options.subtitle is true", () => {
    const provider = new FakeResourceProviderV2({ results: { title: [] } });
    const storage = new Storage115Simulator({ packs: {} });
    const sandbox = new TaskSandbox({ provider, storage, stagingDirectoryId: "s", need: ["S01E01"] });
    expect("renameSubtitle" in buildSandboxToolSet(sandbox)).toBe(false);
    expect("renameSubtitle" in buildSandboxToolSet(sandbox, { subtitle: true })).toBe(true);
  });
});

describe("buildSandboxToolSet subtitle tool registration", () => {
  it("does NOT include viewSubtitleSnapshot/transferSubtitle by default", () => {
    const provider = new FakeResourceProviderV2({ results: { title: [] } });
    const storage = new Storage115Simulator({ packs: {} });
    const sandbox = new TaskSandbox({
      provider,
      storage,
      stagingDirectoryId: "s",
      need: ["S01E01"],
    });
    const tools = buildSandboxToolSet(sandbox);
    expect("viewSubtitleSnapshot" in tools).toBe(false);
    expect("transferSubtitle" in tools).toBe(false);
  });

  it("includes viewSubtitleSnapshot/transferSubtitle when options.subtitle is true", () => {
    const provider = new FakeResourceProviderV2({ results: { title: [] } });
    const storage = new Storage115Simulator({ packs: {} });
    const sandbox = new TaskSandbox({
      provider,
      storage,
      stagingDirectoryId: "s",
      need: ["S01E01"],
    });
    const tools = buildSandboxToolSet(sandbox, { subtitle: true });
    expect("viewSubtitleSnapshot" in tools).toBe(true);
    expect("transferSubtitle" in tools).toBe(true);
  });
});

describe("subtitle snapshot evidence + failure bounding", () => {
  it("viewSubtitleSnapshot renders vote score + release site so the agent can pick the community favorite", async () => {
    const { sandbox } = await createSubtitleSandbox();
    const provider = makeAssrtProvider(
      [{ id: 2, title: "BB S02", lang: "简", voteScore: 50, releaseSite: "YYeTs", uploadTime: "2023-05-01 12:00:00" }],
      {},
    );
    await sandbox.primeSubtitleSnapshot("BB", provider);
    const snap = sandbox.viewSubtitleSnapshot();
    expect(snap.document).toContain("★50");
    expect(snap.document).toContain("YYeTs");
  });

  it("aborts after 3 consecutive landing failures instead of hammering the whole filelist (115 budget guard)", async () => {
    const provider = new FakeResourceProviderV2({ results: { title: [] } });
    class AlwaysFailingStorage extends Storage115Simulator {
      calls = 0;
      override async transferSubtitleUrl(): Promise<TransferAttemptResult> {
        this.calls += 1;
        return { status: "failed", materializedFileIds: [], providerMessage: "dead link" };
      }
    }
    const storage = new AlwaysFailingStorage({ packs: {} });
    const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
    const sandbox = new TaskSandbox({ provider, storage, stagingDirectoryId, targetSeasonDirectoryIds: {}, need: [] });
    const files = Array.from({ length: 10 }, (_, i) => ({ filename: `E${i}.ass`, url: `http://x/${i}.ass` }));
    const assrt = makeAssrtProvider([{ id: 7, title: "t", lang: "" }], { 7: files });
    await sandbox.primeSubtitleSnapshot("t", assrt);

    const result = await sandbox.transferSubtitle({ candidateId: 7 });

    expect(result.status).toBe("failed");
    expect(storage.calls).toBe(3);
    expect(result.error).toMatch(/连续|consecutive/i);
  });

  it("a success in between resets the consecutive-failure counter", async () => {
    const provider = new FakeResourceProviderV2({ results: { title: [] } });
    class FlakyStorage extends Storage115Simulator {
      calls = 0;
      override async transferSubtitleUrl(input: { url: string; filename: string; intoDirectoryId: string }): Promise<TransferAttemptResult> {
        this.calls += 1;
        // fail, fail, succeed, fail, fail, succeed, ... — never 3 in a row
        if (this.calls % 3 === 0) return super.transferSubtitleUrl(input);
        return { status: "failed", materializedFileIds: [], providerMessage: "flaky" };
      }
    }
    const storage = new FlakyStorage({ packs: {} });
    const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
    const sandbox = new TaskSandbox({ provider, storage, stagingDirectoryId, targetSeasonDirectoryIds: {}, need: [] });
    const files = Array.from({ length: 6 }, (_, i) => ({ filename: `E${i}.ass`, url: `http://x/${i}.ass` }));
    const assrt = makeAssrtProvider([{ id: 8, title: "t", lang: "" }], { 8: files });
    await sandbox.primeSubtitleSnapshot("t", assrt);

    const result = await sandbox.transferSubtitle({ candidateId: 8 });

    expect(result.status).toBe("succeeded");
    expect(storage.calls).toBe(6); // all 6 attempted — counter reset by the successes
    expect(result.landedFilenames).toEqual(["E2.ass", "E5.ass"]);
  });
});

describe("transferSubtitle — non-subtitle files are filtered at the boundary", () => {
  it("lands only subtitle-extension files from a mixed filelist (readme/fonts skipped, no budget waste)", async () => {
    const provider = new FakeResourceProviderV2({ results: { title: [] } });
    class CountingStorage extends Storage115Simulator {
      calls: string[] = [];
      override async transferSubtitleUrl(input: { url: string; filename: string; intoDirectoryId: string }): Promise<TransferAttemptResult> {
        this.calls.push(input.filename);
        return super.transferSubtitleUrl(input);
      }
    }
    const storage = new CountingStorage({ packs: {} });
    const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
    const sandbox = new TaskSandbox({ provider, storage, stagingDirectoryId, targetSeasonDirectoryIds: {}, need: [] });
    const assrt = makeAssrtProvider(
      [{ id: 9, title: "t", lang: "简" }],
      { 9: [
        { filename: "Show.S01E01.ass", url: "http://x/1.ass" },
        { filename: "readme.txt", url: "http://x/readme.txt" },
        { filename: "fonts.zip", url: "http://x/fonts.zip" },
      ] },
    );
    await sandbox.primeSubtitleSnapshot("t", assrt);

    const result = await sandbox.transferSubtitle({ candidateId: 9 });

    expect(result.status).toBe("succeeded");
    expect(result.landedFilenames).toEqual(["Show.S01E01.ass"]);
    expect(storage.calls).toEqual(["Show.S01E01.ass"]); // txt/zip never hit 115
  });

  it("whole-package zip fallback → failed WITHOUT any storage call (a zip in staging is unusable junk)", async () => {
    const { sandbox } = await createSubtitleSandbox();
    const assrt = makeAssrtProvider(
      [{ id: 10, title: "t", lang: "简" }],
      { 10: [{ filename: "pack.zip", url: "http://x/pack.zip" }] },
    );
    await sandbox.primeSubtitleSnapshot("t", assrt);

    const result = await sandbox.transferSubtitle({ candidateId: 10 });

    expect(result.status).toBe("failed");
    expect(result.landedFilenames).toEqual([]);
    expect(result.error).toMatch(/压缩包|zip|字幕文件/i);
  });
});

describe("renameSubtitle — batch shape (压测发现:77 集逐文件改名导致规模崩塌)", () => {
  it("renames a whole batch in ONE call, per-item guards still enforced, one listTree for all", async () => {
    const provider = new FakeResourceProviderV2({ results: { title: [] } });
    class CountingListStorage extends Storage115Simulator {
      listTreeCalls = 0;
      override async listTree(input: { directoryId: string }) {
        this.listTreeCalls += 1;
        return super.listTree(input);
      }
    }
    const storage = new CountingListStorage({ packs: {} });
    const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
    // 直接放 3 个文件进 staging:2 个字幕 + 1 个视频
    const subA = (await storage.transferSubtitleUrl({ url: "http://x/a", filename: "ep01.ass", intoDirectoryId: stagingDirectoryId })).materializedFileIds[0]!;
    const subB = (await storage.transferSubtitleUrl({ url: "http://x/b", filename: "ep02.ass", intoDirectoryId: stagingDirectoryId })).materializedFileIds[0]!;
    const vid = (await storage.transferSubtitleUrl({ url: "http://x/v", filename: "ep01.mkv", intoDirectoryId: stagingDirectoryId })).materializedFileIds[0]!;
    const sandbox = new TaskSandbox({ provider, storage, stagingDirectoryId, targetSeasonDirectoryIds: {}, need: [] });
    storage.listTreeCalls = 0;

    const result = await sandbox.renameSubtitle({
      renames: [
        { fileId: subA, newName: "Show.S01E01.ass" },
        { fileId: subB, newName: "Show.S01E02.ass" },
        { fileId: vid, newName: "Show.S01E01.mkv" }, // 视频:守卫必须拦
      ],
    });

    expect(result.renamed).toEqual(["Show.S01E01.ass", "Show.S01E02.ass"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]!.error).toMatch(/NOT_A_SUBTITLE|only subtitles/i);
    expect(storage.listTreeCalls).toBe(1); // 整批一次 listTree,不逐文件烧预算
  });

  it("empty renames array is rejected loudly (agent must decide pairings first)", async () => {
    const { sandbox } = await createSubtitleSandbox();
    await expect(sandbox.renameSubtitle({ renames: [] })).rejects.toThrow(/empty|至少/i);
  });
});
