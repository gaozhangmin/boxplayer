import { describe, expect, it } from "vitest";
import { RealStorageV2 } from "../src/acquisition-v2/real-storage-adapter.js";
import { CandidateRegistry } from "../src/acquisition-v2/candidate-registry.js";
import type { StorageExecutor, UnparsedVideoFile } from "../src/ports.js";
import type { PackageTreeFile, ResourceCandidate, TransferAttempt, VerifiedFile } from "../src/domain.js";

function candidate(id: string): ResourceCandidate {
  return {
    id,
    snapshotId: "snap",
    index: 0,
    title: "Show 全集",
    type: "115",
    source: "pansou",
    providerPayload: { url: "https://115.com/s/abc", receiveCode: "pw" },
  };
}

/** Minimal StorageExecutor that records calls and returns canned data. */
class RecordingExecutor implements StorageExecutor {
  transfers: Array<{ workflowRunId: string; directoryId: string; candidateId: string }> = [];
  deletes: Array<{ directoryId: string; fileIds: string[] }> = [];
  removed: string[] = [];
  constructor(private readonly opts: { status?: TransferAttempt["status"]; message?: string; tree?: PackageTreeFile[]; removeOk?: boolean } = {}) {}

  async createDirectory(input: { name: string; parentId: string }): Promise<string> {
    return `dir_${input.name}`;
  }
  async transfer(input: { workflowRunId: string; directoryId: string; candidate: ResourceCandidate }): Promise<TransferAttempt> {
    this.transfers.push({ workflowRunId: input.workflowRunId, directoryId: input.directoryId, candidateId: input.candidate.id });
    return {
      id: "att_1",
      workflowRunId: input.workflowRunId,
      candidateId: input.candidate.id,
      status: this.opts.status ?? "succeeded",
      providerMessage: this.opts.message ?? "",
      materializedFileIds: this.opts.status && this.opts.status !== "succeeded" ? [] : ["f1", "f2"],
    };
  }
  async listTree(): Promise<PackageTreeFile[]> {
    return this.opts.tree ?? [{ path: "Pack/Show - 01.mkv", providerFileId: "f1", sizeBytes: 9 }];
  }
  async listSubdirectories(): Promise<Array<{ id: string; path: string }>> {
    return [{ id: "wrap", path: "Pack" }];
  }
  async listChildDirectories(): Promise<Array<{ id: string; name: string }>> {
    return [{ id: "wrap", name: "Pack" }];
  }
  async moveFiles(input: { fileIds: string[]; targetDirectoryId: string }): Promise<{ moved: string[] }> {
    return { moved: input.fileIds };
  }
  async deleteFiles(input: { directoryId: string; fileIds: string[] }): Promise<{ deleted: string[] }> {
    this.deletes.push(input);
    return { deleted: input.fileIds };
  }
  async removeDirectory(directoryId: string): Promise<{ removed: boolean }> {
    if (this.opts.removeOk ?? true) this.removed.push(directoryId);
    return { removed: this.opts.removeOk ?? true };
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

class FakeDeadLinkStore {
  recorded: Array<{ key: string; kind: string; reason: string; permanent: boolean; ttlMs?: number }> = [];
  async recordDeadLink(input: { key: string; kind: "pan115" | "magnet"; reason: string; permanent: boolean; ttlMs?: number }): Promise<void> {
    this.recorded.push({ key: input.key, kind: input.kind, reason: input.reason, permanent: input.permanent, ...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs }) });
  }
  async listDeadLinkKeys(): Promise<string[]> {
    return this.recorded.map((r) => r.key);
  }
}

function adapter(executor: StorageExecutor, registry = new CandidateRegistry(), deadLinkStore?: FakeDeadLinkStore) {
  return {
    storage: new RealStorageV2({ executor, registry, workflowRunId: "run-7", ...(deadLinkStore ? { deadLinkStore } : {}) }),
    registry,
  };
}

describe("RealStorageV2 — StorageExecutor → StorageV2 adapter", () => {
  it("transfers a registry candidate via the executor with the run id and maps success", async () => {
    const executor = new RecordingExecutor();
    const { storage, registry } = adapter(executor);
    registry.record(candidate("cand"));

    const result = await storage.transferCandidate({ candidateId: "cand", intoDirectoryId: "staging" });

    expect(result.status).toBe("succeeded");
    expect(result.materializedFileIds).toEqual(["f1", "f2"]);
    expect(executor.transfers).toEqual([{ workflowRunId: "run-7", directoryId: "staging", candidateId: "cand" }]);
  });

  it("maps no_target_change to a failed attempt AND surfaces the noTargetChange flag", async () => {
    const executor = new RecordingExecutor({ status: "no_target_change" });
    const { storage, registry } = adapter(executor);
    registry.record(candidate("cand"));

    const result = await storage.transferCandidate({ candidateId: "cand", intoDirectoryId: "staging" });
    expect(result.status).toBe("failed");
    // the flag lets brand-agnostic callers (transferUntilLanded) tell a silent-late
    // async copy (123's settle window — possible FALSE miss) from a loud dead link
    expect(result.noTargetChange).toBe(true);
  });

  it("surfaces the executor's providerMessage on a failed transfer (so the agent sees WHY)", async () => {
    const executor = new RecordingExecutor({ status: "failed", message: "云下载配额不足，请升级VIP获得赠送配额或购买云下载配额！" });
    const { storage, registry } = adapter(executor);
    registry.record(candidate("cand"));

    const result = await storage.transferCandidate({ candidateId: "cand", intoDirectoryId: "staging" });
    expect(result.status).toBe("failed");
    expect(result.providerMessage).toBe("云下载配额不足，请升级VIP获得赠送配额或购买云下载配额！");
    expect(result.noTargetChange).toBeUndefined(); // a loud failure is NOT an ntc
  });

  it("fails loud when the candidate id was never observed (not in the registry)", async () => {
    const { storage } = adapter(new RecordingExecutor());
    await expect(storage.transferCandidate({ candidateId: "ghost", intoDirectoryId: "staging" })).rejects.toThrow(
      /CANDIDATE_NOT_REGISTERED/,
    );
  });

  it("maps listTree to SimTreeFile with id=providerFileId and extension-based isVideo/isSubtitle", async () => {
    const executor = new RecordingExecutor({
      tree: [
        { path: "Pack/Show - 01.mkv", providerFileId: "f1", sizeBytes: 9 },
        { path: "Pack/Show - 01.ass", providerFileId: "f2", sizeBytes: 2 },
        { path: "Pack/cover.jpg", providerFileId: "f3", sizeBytes: 1 },
      ],
    });
    const { storage } = adapter(executor);

    const tree = await storage.listTree({ directoryId: "staging" });
    expect(tree).toEqual([
      { id: "f1", path: "Pack/Show - 01.mkv", sizeBytes: 9, isVideo: true, isSubtitle: false },
      { id: "f2", path: "Pack/Show - 01.ass", sizeBytes: 2, isVideo: false, isSubtitle: true },
      { id: "f3", path: "Pack/cover.jpg", sizeBytes: 1, isVideo: false, isSubtitle: false },
    ]);
  });

  it("maps removeDirectory boolean to the removed-id list", async () => {
    const executor = new RecordingExecutor({ removeOk: true });
    const { storage } = adapter(executor);
    const result = await storage.removeDirectory({ directoryId: "wrap" });
    expect(result.removed).toEqual(["wrap"]);
    expect(executor.removed).toEqual(["wrap"]);
  });

  it("scopes deleteFiles to the named directory", async () => {
    const executor = new RecordingExecutor();
    const { storage } = adapter(executor);
    await storage.deleteFiles({ directoryId: "season", fileIds: ["f1"] });
    expect(executor.deletes).toEqual([{ directoryId: "season", fileIds: ["f1"] }]);
  });

  it("keeps subtitle transfers OUT of attempts() so they can't fail snapshot persistence validation", async () => {
    // A subtitle transfer's synthetic `subtitle:<filename>` candidateId belongs to no
    // resource snapshot; validateWorkflowRunSnapshot rejects any persisted transferAttempt
    // whose candidateId is not in a snapshot. So subtitle attempts must NOT enter attempts()
    // (the persisted video-candidate trace) — otherwise a subtitle would abort the whole
    // run's save after the video already landed.
    const executor = new RecordingExecutor();
    const { storage, registry } = adapter(executor);
    registry.record(candidate("cand"));

    await storage.transferCandidate({ candidateId: "cand", intoDirectoryId: "staging" });
    await storage.transferSubtitleUrl({
      url: "http://file0.assrt.net/onthefly/1/Show.S01E01.ass",
      filename: "Show.S01E01.ass",
      intoDirectoryId: "staging",
    });

    const attempts = storage.attempts();
    expect(attempts).toHaveLength(1); // only the video transfer, not the subtitle
    expect(attempts[0]!.candidateId).toBe("cand");
    expect(attempts.some((a) => a.candidateId.startsWith("subtitle:"))).toBe(false);
  });

  it("classifies candidate link kind from the recorded url (fail-loud share brand / magnet / unknown)", async () => {
    const { storage, registry } = adapter(new RecordingExecutor());
    // every 转存分享 brand (fail-loud) → "share"
    registry.record({ ...candidate("s115"), providerPayload: { url: "https://115cdn.com/s/abc?password=x" } });
    registry.record({ ...candidate("s115b"), providerPayload: { url: "https://115.com/s/def" } });
    registry.record({ ...candidate("squark"), type: "quark", providerPayload: { url: "https://pan.quark.cn/s/zzz?passcode=ab12" } });
    registry.record({ ...candidate("stianyi"), type: "tianyi", providerPayload: { url: "https://cloud.189.cn/t/QzUnmqBvYr2q?accessCode=x8fd" } });
    registry.record({ ...candidate("stianyi_web"), type: "tianyi", providerPayload: { url: "https://cloud.189.cn/web/share?code=AbCd12&pwd=1234" } });
    registry.record({ ...candidate("s123"), type: "123", providerPayload: { url: "https://www.123pan.com/s/abc-1?pwd=x8fd" } });
    registry.record({ ...candidate("s123_mirror"), type: "123", providerPayload: { url: "https://123684.com/s/Kd9-TvBq?password=1234" } });
    // silent-fail magnet and unrecognized hosts stay out
    registry.record({ ...candidate("mag"), type: "magnet", providerPayload: { url: "magnet:?xt=urn:btih:deadbeef" } });
    registry.record({ ...candidate("weird"), providerPayload: { url: "https://pan.baidu.com/s/1abcDEF" } });

    for (const id of ["s115", "s115b", "squark", "stianyi", "stianyi_web", "s123", "s123_mirror"]) {
      expect(storage.candidateLinkKind(id)).toBe("share");
    }
    expect(storage.candidateLinkKind("mag")).toBe("magnet");
    expect(storage.candidateLinkKind("weird")).toBe("unknown"); // unrecognized share host
    expect(storage.candidateLinkKind("ghost")).toBe("unknown"); // never recorded
  });

  describe("dead-link recording (#15)", () => {
    it("records a 115 share that failed loud with a death message", async () => {
      const store = new FakeDeadLinkStore();
      const executor = new RecordingExecutor({ status: "failed", message: "链接已过期" });
      const { storage, registry } = adapter(executor, new CandidateRegistry(), store);
      registry.record({ ...candidate("share"), providerPayload: { url: "https://115cdn.com/s/sww96353nl6?password=g876" } });

      await storage.transferCandidate({ candidateId: "share", intoDirectoryId: "staging" });

      expect(store.recorded).toEqual([{ key: "115:sww96353nl6", kind: "pan115", reason: "链接已过期", permanent: true }]);
    });

    it("records a magnet that did NOT 秒传 (no_target_change), keyed by infohash", async () => {
      const store = new FakeDeadLinkStore();
      const executor = new RecordingExecutor({ status: "no_target_change", message: "no target materialized" });
      const { storage, registry } = adapter(executor, new CandidateRegistry(), store);
      registry.record({ ...candidate("mag"), type: "magnet", providerPayload: { url: "magnet:?xt=urn:btih:edef9b0fc91c9ccdf5b3e43f6cc5278160e81dd5" } });

      await storage.transferCandidate({ candidateId: "mag", intoDirectoryId: "staging" });

      expect(store.recorded).toEqual([
        // a magnet is SOFT (permanent: false) — it may resurrect (see deadLinkKey).
        { key: "magnet:edef9b0fc91c9ccdf5b3e43f6cc5278160e81dd5", kind: "magnet", reason: "no target materialized", permanent: false },
      ]);
    });

    it("gives an unresolvable magnet (name == infohash) a longer soft TTL (90 days)", async () => {
      const store = new FakeDeadLinkStore();
      const executor = new RecordingExecutor({ status: "no_target_change", message: "offline task unresolved (name == infohash); likely fake/dead" });
      const { storage, registry } = adapter(executor, new CandidateRegistry(), store);
      registry.record({ ...candidate("mag"), type: "magnet", providerPayload: { url: "magnet:?xt=urn:btih:edef9b0fc91c9ccdf5b3e43f6cc5278160e81dd5" } });

      await storage.transferCandidate({ candidateId: "mag", intoDirectoryId: "staging" });

      expect(store.recorded[0]).toMatchObject({ kind: "magnet", permanent: false, ttlMs: 90 * 24 * 60 * 60 * 1000 });
    });

    it("does NOT record a 任务已存在 magnet (prior good task) nor a successful transfer", async () => {
      const store = new FakeDeadLinkStore();
      const dup = new RecordingExecutor({ status: "no_target_change", message: "任务已存在，请勿输入重复的链接地址" });
      const a = adapter(dup, new CandidateRegistry(), store);
      a.registry.record({ ...candidate("mag"), type: "magnet", providerPayload: { url: "magnet:?xt=urn:btih:edef9b0fc91c9ccdf5b3e43f6cc5278160e81dd5" } });
      await a.storage.transferCandidate({ candidateId: "mag", intoDirectoryId: "staging" });

      const ok = new RecordingExecutor({ status: "succeeded" });
      const b = adapter(ok, new CandidateRegistry(), store);
      b.registry.record(candidate("share"));
      await b.storage.transferCandidate({ candidateId: "share", intoDirectoryId: "staging" });

      expect(store.recorded).toEqual([]);
    });
  });
});
