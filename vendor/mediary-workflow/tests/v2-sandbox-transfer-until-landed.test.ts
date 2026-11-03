import { describe, expect, it } from "vitest";
import { TaskSandbox } from "../src/acquisition-v2/sandbox.js";
import { FakeResourceProviderV2 } from "../src/acquisition-v2/fake-provider.js";
import { Storage115Simulator } from "../src/acquisition-v2/storage-115-simulator.js";
import { RealStorageV2 } from "../src/acquisition-v2/real-storage-adapter.js";
import { CandidateRegistry } from "../src/acquisition-v2/candidate-registry.js";
import type { StorageExecutor, UnparsedVideoFile } from "../src/ports.js";
import type { PackageTreeFile, ResourceCandidate, TransferAttempt, VerifiedFile } from "../src/domain.js";

/**
 * The movie-only `transferUntilLanded` tool (2026-06-15, user-designed):
 * iterate an AGENT-ORDERED list of candidates the agent judged to be the SAME
 * target film (best → next-best), stopping at the FIRST that 秒传-lands; the rest
 * are abandoned. Fail-loud SHARE links ONLY (115/夸克/天翼/123 转存分享) — every
 * share-transfer brand fails LOUD on a dead link, so the iterate-on-failure logic
 * is sound; a magnet's success is only knowable by the landing point, so magnets
 * (and unknown links) are rejected (the agent uses transferCandidate + observe
 * for those). Candidate SELECTION stays the agent's (the wildcard search
 * returns unrelated works — 葫芦小金刚 under "抓娃娃" — so the system must never
 * iterate the raw result set). TV/anime never gets this tool.
 */
async function movieSetup(options: {
  results: Array<{ id: string; title: string }>;
  packs?: Record<string, { files: Array<{ path: string; sizeBytes: number }> }>;
  linkKinds?: Record<string, "share" | "magnet">;
  failureMessages?: Record<string, string>;
}) {
  const provider = new FakeResourceProviderV2({
    results: { oppenheimer: options.results.map((r) => ({ ...r })) },
  });
  const storage = new Storage115Simulator({
    ...(options.packs ? { packs: options.packs } : {}),
    ...(options.linkKinds ? { linkKinds: options.linkKinds } : {}),
    ...(options.failureMessages ? { failureMessages: options.failureMessages } : {}),
  });
  const movieDir = await storage.createDirectory({ name: "奥本海默 (2023)", parentId: "root" });
  const sandbox = new TaskSandbox({
    provider,
    storage,
    stagingDirectoryId: movieDir,
    targetMovieDirectoryId: movieDir,
    need: ["MOVIE"],
  });
  return { sandbox, storage, movieDir };
}

describe("TaskSandbox — transferUntilLanded (movie-only, share-links-only, agent-ordered, stop-at-first-landed)", () => {
  it("burns through dead shares in the given order and stops at the first that lands", async () => {
    const { sandbox } = await movieSetup({
      results: [
        { id: "dead_1", title: "奥本海默 黑盒A" },
        { id: "dead_2", title: "奥本海默 黑盒B" },
        { id: "live", title: "奥本海默 黑盒C" },
        { id: "after", title: "奥本海默 黑盒D" },
      ],
      packs: {
        live: { files: [{ path: "奥本海默 (2023)/Oppenheimer.2023.2160p.mkv", sizeBytes: 9000 }] },
        after: { files: [{ path: "wrong/After.mkv", sizeBytes: 1 }] },
      },
      linkKinds: { dead_1: "share", dead_2: "share", live: "share", after: "share" },
    });
    await sandbox.searchResources("oppenheimer");

    const result = await sandbox.transferUntilLanded({ candidateIds: ["dead_1", "dead_2", "live", "after"] });

    expect(result.attempts.map((a) => a.status)).toEqual(["failed", "failed", "succeeded"]); // never reached "after"
    expect(result.transferredCandidateId).toBe("live");
    expect(result.landed.some((f) => f.isVideo)).toBe(true);
  });

  it("rejects a magnet candidate with the share-link error code — a magnet does not fail loud", async () => {
    const { sandbox } = await movieSetup({
      results: [{ id: "mag", title: "奥本海默 magnet" }],
      packs: { mag: { files: [{ path: "x.mkv", sizeBytes: 1 }] } },
      linkKinds: { mag: "magnet" },
    });
    await sandbox.searchResources("oppenheimer");
    await expect(sandbox.transferUntilLanded({ candidateIds: ["mag"] })).rejects.toThrow(
      /SANDBOX_TRANSFER_UNTIL_LANDED_REQUIRES_SHARE_LINK/,
    );
  });

  it("rejects an unknown-kind candidate with the share-link error code — only fail-loud shares iterate", async () => {
    const { sandbox } = await movieSetup({
      results: [{ id: "mystery", title: "奥本海默 未知链接" }],
      packs: { mystery: { files: [{ path: "x.mkv", sizeBytes: 1 }] } },
      // no linkKinds entry → the simulator classifies it "unknown"
    });
    await sandbox.searchResources("oppenheimer");
    await expect(sandbox.transferUntilLanded({ candidateIds: ["mystery"] })).rejects.toThrow(
      /SANDBOX_TRANSFER_UNTIL_LANDED_REQUIRES_SHARE_LINK/,
    );
  });

  it("refuses once coverage is already met", async () => {
    const { sandbox } = await movieSetup({
      results: [{ id: "live", title: "奥本海默" }],
      packs: { live: { files: [{ path: "m.mkv", sizeBytes: 1 }] } },
      linkKinds: { live: "share" },
    });
    await sandbox.searchResources("oppenheimer");
    await sandbox.markObtained({ codes: ["MOVIE"] });
    await expect(sandbox.transferUntilLanded({ candidateIds: ["live"] })).rejects.toThrow(/coverage/i);
  });

  it("refuses a candidate never observed in this task", async () => {
    const { sandbox } = await movieSetup({
      results: [{ id: "live", title: "奥本海默" }],
      packs: { live: { files: [{ path: "m.mkv", sizeBytes: 1 }] } },
      linkKinds: { live: "share" },
    });
    await sandbox.searchResources("oppenheimer");
    await expect(sandbox.transferUntilLanded({ candidateIds: ["live", "ghost"] })).rejects.toThrow(/observ|snapshot/i);
  });

  it("is movie-only — a TV-scoped task refuses it", async () => {
    const provider = new FakeResourceProviderV2({
      results: { oppenheimer: [{ id: "live", title: "x" }] },
    });
    const storage = new Storage115Simulator({
      packs: { live: { files: [{ path: "m.mkv", sizeBytes: 1 }] } },
      linkKinds: { live: "share" },
    });
    const staging = await storage.createDirectory({ name: "staging", parentId: "root" });
    const seasonDir = await storage.createDirectory({ name: "Season 1", parentId: "root" });
    const sandbox = new TaskSandbox({
      provider,
      storage,
      stagingDirectoryId: staging,
      targetSeasonDirectoryIds: { 1: seasonDir },
      need: ["S01E01"],
    });
    await sandbox.searchResources("oppenheimer");
    await expect(sandbox.transferUntilLanded({ candidateIds: ["live"] })).rejects.toThrow(/movie/i);
  });

  it("carries each attempt's providerMessage back to the agent", async () => {
    const { sandbox } = await movieSetup({
      results: [
        { id: "dead_1", title: "奥本海默 A" },
        { id: "live", title: "奥本海默 B" },
      ],
      packs: { live: { files: [{ path: "奥本海默 (2023)/Oppenheimer.mkv", sizeBytes: 9000 }] } },
      linkKinds: { dead_1: "share", live: "share" },
      failureMessages: { dead_1: "链接已过期" },
    });
    await sandbox.searchResources("oppenheimer");
    const result = await sandbox.transferUntilLanded({ candidateIds: ["dead_1", "live"] });
    expect(result.attempts).toEqual([
      { candidateId: "dead_1", status: "failed", providerMessage: "链接已过期" },
      { candidateId: "live", status: "succeeded" },
    ]);
  });

  it("STOPS at the first systemic block — does NOT burn the rest of the ranked list", async () => {
    const { sandbox } = await movieSetup({
      results: [
        { id: "c1", title: "奥本海默 A" },
        { id: "c2", title: "奥本海默 B" },
        { id: "c3", title: "奥本海默 C" },
      ],
      // All three are real 115 shares for the film, but the account's quota is
      // exhausted — every transfer fails with the same systemic message. Grinding
      // all three is the wasted-transfer the 心灵奇旅 incident is about.
      packs: { c3: { files: [{ path: "奥本海默 (2023)/o.mkv", sizeBytes: 1 }] } },
      linkKinds: { c1: "share", c2: "share", c3: "share" },
      failureMessages: {
        c1: "云下载配额不足，请升级VIP获得赠送配额或购买云下载配额！",
        c2: "云下载配额不足，请升级VIP获得赠送配额或购买云下载配额！",
        c3: "云下载配额不足，请升级VIP获得赠送配额或购买云下载配额！",
      },
    });
    await sandbox.searchResources("oppenheimer");

    const result = await sandbox.transferUntilLanded({ candidateIds: ["c1", "c2", "c3"] });

    // It stopped after the FIRST attempt (one quota failure ⇒ all will fail).
    expect(result.attempts).toHaveLength(1);
    expect(result.transferredCandidateId).toBeNull();
    expect(result.systemicBlock).toEqual({ reason: "云下载配额不足，请升级VIP获得赠送配额或购买云下载配额！" });
  });

  it("when every candidate is a dead link, returns no landing (not an exception)", async () => {
    const { sandbox } = await movieSetup({
      results: [
        { id: "dead_1", title: "奥本海默 A" },
        { id: "dead_2", title: "奥本海默 B" },
      ],
      linkKinds: { dead_1: "share", dead_2: "share" },
    });
    await sandbox.searchResources("oppenheimer");
    const result = await sandbox.transferUntilLanded({ candidateIds: ["dead_1", "dead_2"] });
    expect(result.transferredCandidateId).toBeNull();
    expect(result.attempts.map((a) => a.status)).toEqual(["failed", "failed"]);
    expect(result.landed.some((f) => f.isVideo)).toBe(false);
  });
});

/** Minimal StorageExecutor for the RealStorageV2 tests below — per-candidate
 *  scripted outcomes (default: succeed and land one video); everything else inert. */
class LandingExecutor implements StorageExecutor {
  transfers: string[] = [];
  constructor(
    private readonly outcomes: Record<string, { status: TransferAttempt["status"]; message?: string }> = {},
  ) {}
  async createDirectory(input: { name: string; parentId: string }): Promise<string> {
    return `dir_${input.name}`;
  }
  async transfer(input: { workflowRunId: string; directoryId: string; candidate: ResourceCandidate }): Promise<TransferAttempt> {
    this.transfers.push(input.candidate.id);
    const outcome = this.outcomes[input.candidate.id] ?? { status: "succeeded" as const };
    return {
      id: `att_${this.transfers.length}`,
      workflowRunId: input.workflowRunId,
      candidateId: input.candidate.id,
      status: outcome.status,
      providerMessage: outcome.message ?? "",
      materializedFileIds: outcome.status === "succeeded" ? ["f1"] : [],
    };
  }
  async listTree(): Promise<PackageTreeFile[]> {
    return [{ path: "某片 (2023)/Movie.2023.mkv", providerFileId: "f1", sizeBytes: 9000 }];
  }
  async listSubdirectories(): Promise<Array<{ id: string; path: string }>> {
    return [];
  }
  async listChildDirectories(): Promise<Array<{ id: string; name: string }>> {
    return [];
  }
  async moveFiles(input: { fileIds: string[]; targetDirectoryId: string }): Promise<{ moved: string[] }> {
    return { moved: input.fileIds };
  }
  async deleteFiles(input: { directoryId: string; fileIds: string[] }): Promise<{ deleted: string[] }> {
    return { deleted: input.fileIds };
  }
  async removeDirectory(): Promise<{ removed: boolean }> {
    return { removed: true };
  }
  async listVideoFiles(): Promise<VerifiedFile[]> {
    return [];
  }
  async listUnparsedVideoFiles(): Promise<UnparsedVideoFile[]> {
    return [];
  }
  async renameFile(): Promise<void> {}
  async transferSubtitleUrl(input: { url: string; filename: string; directoryId: string; workflowRunId: string }): Promise<TransferAttempt> {
    return {
      id: `${input.workflowRunId}_subtitle_1`,
      workflowRunId: input.workflowRunId,
      candidateId: `subtitle:${input.filename}`,
      status: "succeeded",
      providerMessage: "",
      materializedFileIds: ["sub_f1"],
    };
  }
  async flattenDirectory(): Promise<{ moved: string[]; removed: string[] }> {
    return { moved: [], removed: [] };
  }
}

/** Movie sandbox wired to the REAL storage adapter (real url classifier) with each
 *  candidate's actual share url in the registry — the end-to-end gate truth. */
async function realAdapterMultiSetup(
  candidates: Array<{
    id: string;
    url: string;
    type: ResourceCandidate["type"];
    outcome?: { status: TransferAttempt["status"]; message?: string };
  }>,
) {
  const provider = new FakeResourceProviderV2({
    results: { film: candidates.map((c) => ({ id: c.id, title: `某片 2023 ${c.id}` })) },
  });
  const registry = new CandidateRegistry();
  const outcomes: Record<string, { status: TransferAttempt["status"]; message?: string }> = {};
  for (const c of candidates) {
    registry.record({
      id: c.id,
      snapshotId: "snap",
      index: 0,
      title: `某片 2023 ${c.id}`,
      type: c.type,
      source: "pansou",
      providerPayload: { url: c.url },
    });
    if (c.outcome) {
      outcomes[c.id] = c.outcome;
    }
  }
  const executor = new LandingExecutor(outcomes);
  const storage = new RealStorageV2({ executor, registry, workflowRunId: "run-gate" });
  const sandbox = new TaskSandbox({
    provider,
    storage,
    stagingDirectoryId: "movie_dir",
    targetMovieDirectoryId: "movie_dir",
    need: ["MOVIE"],
  });
  await sandbox.searchResources("film");
  return { sandbox, executor };
}

async function realAdapterMovieSetup(url: string, type: ResourceCandidate["type"]) {
  return realAdapterMultiSetup([{ id: "cand", url, type }]);
}

describe("transferUntilLanded gate over the REAL url classifier — every fail-loud 转存分享 brand passes", () => {
  it.each([
    ["115", "https://115.com/s/sww96353nl6?password=g876", "115"],
    ["夸克", "https://pan.quark.cn/s/1a2b3c4d?passcode=ab12", "quark"],
    ["天翼", "https://cloud.189.cn/t/QzUnmqBvYr2q?accessCode=x8fd", "tianyi"],
    ["天翼 web/share", "https://cloud.189.cn/web/share?code=AbCd12&pwd=1234", "tianyi"],
    ["123", "https://www.123pan.com/s/abc-1?pwd=x8fd", "123"],
    ["123 镜像域", "https://123684.com/s/Kd9-TvBq?password=1234", "123"],
  ] as const)("a %s share candidate passes the gate and enters the iterate loop", async (_brand, url, type) => {
    const { sandbox, executor } = await realAdapterMovieSetup(url, type);

    const result = await sandbox.transferUntilLanded({ candidateIds: ["cand"] });

    expect(executor.transfers).toEqual(["cand"]); // the loop really ran the transfer
    expect(result.transferredCandidateId).toBe("cand");
    expect(result.landed.some((f) => f.isVideo)).toBe(true);
  });

  it("still rejects a magnet through the real classifier (silent-fail — landing point only)", async () => {
    const { sandbox, executor } = await realAdapterMovieSetup(
      "magnet:?xt=urn:btih:edef9b0fc91c9ccdf5b3e43f6cc5278160e81dd5",
      "magnet",
    );
    await expect(sandbox.transferUntilLanded({ candidateIds: ["cand"] })).rejects.toThrow(
      /SANDBOX_TRANSFER_UNTIL_LANDED_REQUIRES_SHARE_LINK/,
    );
    expect(executor.transfers).toEqual([]); // nothing ran
  });

  it("still rejects an unrecognized link through the real classifier", async () => {
    const { sandbox, executor } = await realAdapterMovieSetup("https://pan.baidu.com/s/1abcDEF", "manual");
    await expect(sandbox.transferUntilLanded({ candidateIds: ["cand"] })).rejects.toThrow(
      /SANDBOX_TRANSFER_UNTIL_LANDED_REQUIRES_SHARE_LINK/,
    );
    expect(executor.transfers).toEqual([]);
  });
});

describe("transferUntilLanded — no_target_change STOPS the loop (123 异步 copy 的假 miss 防双落)", () => {
  it("stops at a no_target_change attempt with nothing landed — does NOT burn the next candidate", async () => {
    // A's 转存 went through but nothing appeared within the settle window: on 123's
    // fire-copy async transfer this may be a FALSE miss (the server-side copy is
    // still in flight). Burning B now could double-land the film once A's copy
    // arrives — the loop must stop and hand judgment back (runbook: re-read first).
    const ntcMessage = "转存完成但目标目录未出现新视频(20s settle 窗口)";
    const { sandbox, executor } = await realAdapterMultiSetup([
      { id: "A", url: "https://www.123pan.com/s/aaa-1?pwd=x1", type: "123", outcome: { status: "no_target_change", message: ntcMessage } },
      { id: "B", url: "https://www.123pan.com/s/bbb-2?pwd=y2", type: "123" },
    ]);

    const result = await sandbox.transferUntilLanded({ candidateIds: ["A", "B"] });

    expect(executor.transfers).toEqual(["A"]); // B was never transferred
    expect(result.transferredCandidateId).toBeNull();
    expect(result.attempts).toEqual([{ candidateId: "A", status: "failed", providerMessage: ntcMessage }]);
    expect(result.systemicBlock).toBeUndefined(); // an ntc stop is NOT an account block
  });

  it("an ordinary loud dead link (failed, non-ntc) still iterates to the next candidate", async () => {
    const { sandbox, executor } = await realAdapterMultiSetup([
      { id: "A", url: "https://www.123pan.com/s/aaa-1?pwd=x1", type: "123", outcome: { status: "failed", message: "分享已取消" } },
      { id: "B", url: "https://www.123pan.com/s/bbb-2?pwd=y2", type: "123" },
    ]);

    const result = await sandbox.transferUntilLanded({ candidateIds: ["A", "B"] });

    expect(executor.transfers).toEqual(["A", "B"]); // dead link burned through as before
    expect(result.transferredCandidateId).toBe("B");
    expect(result.attempts.map((a) => a.status)).toEqual(["failed", "succeeded"]);
  });
});
