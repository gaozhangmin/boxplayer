import { describe, expect, it, vi } from "vitest";
import type { ResourceCandidate, ResourceType } from "./domain.js";
import { TianyiAuthError } from "./tianyi-client.js";
import type { TianyiClient, TianyiItem } from "./tianyi-client.js";
import { parseTianyiShareUrl, TianyiStorageExecutor } from "./tianyi-storage-executor.js";

/** The slice of TianyiClient the executor drives. Fakes must match the REAL
 *  method signatures (read from tianyi-client.ts, not guessed). */
type TianyiClientShape = Pick<
  TianyiClient,
  "listFiles" | "createFolder" | "saveShare" | "renameFile" | "batchDelete" | "moveFiles"
>;

function fakeClient(overrides: Partial<TianyiClientShape> = {}): TianyiClientShape {
  return {
    listFiles: vi.fn<TianyiClient["listFiles"]>(async () => []),
    createFolder: vi.fn<TianyiClient["createFolder"]>(async () => "newdir123"),
    saveShare: vi.fn<TianyiClient["saveShare"]>(async () => ({ ok: true, failed: 0, message: "" })),
    renameFile: vi.fn<TianyiClient["renameFile"]>(async () => {}),
    batchDelete: vi.fn<TianyiClient["batchDelete"]>(async () => {}),
    moveFiles: vi.fn<TianyiClient["moveFiles"]>(async () => {}),
    ...overrides,
  };
}

function makeExecutor(client: TianyiClientShape, writeScopeDirectoryIds: string[] = [SCOPE]): TianyiStorageExecutor {
  return new TianyiStorageExecutor({
    client: client as unknown as TianyiClient,
    writeScopeDirectoryIds,
  });
}

/** ⚠️ bigint lesson (Task 1): fake items use STRING ids — an 18-digit int64 as a
 *  bare JS number literal is silently rounded before the stub even sees it. */
function folder(id: string, name: string): TianyiItem {
  return { id, name, size: 0, md5: "", isFolder: true };
}

function file(id: string, name: string, size = 50 * 1024 * 1024): TianyiItem {
  return { id, name, size, md5: "", isFolder: false };
}

function candidate(overrides: Partial<ResourceCandidate> = {}): ResourceCandidate {
  return {
    id: "cand-1",
    snapshotId: "snap-1",
    index: 0,
    title: "Some Show",
    type: "manual" as ResourceType,
    source: "test",
    providerPayload: { url: "https://cloud.189.cn/t/abc123?accessCode=x8fd" },
    ...overrides,
  };
}

const SCOPE = "scope-dir";

describe("parseTianyiShareUrl", () => {
  it("parses the cloud.189.cn/t/<code> form with an accessCode query", () => {
    expect(parseTianyiShareUrl("https://cloud.189.cn/t/QzUnmqBvYr2q?accessCode=x8fd")).toEqual({
      shareCode: "QzUnmqBvYr2q",
      accessCode: "x8fd",
    });
    expect(parseTianyiShareUrl("https://cloud.189.cn/t/QzUnmqBvYr2q")).toEqual({
      shareCode: "QzUnmqBvYr2q",
      accessCode: "",
    });
  });

  it("parses the /web/share?code= form and accepts pwd as the access-code param", () => {
    expect(parseTianyiShareUrl("https://cloud.189.cn/web/share?code=AbCd12&pwd=1234")).toEqual({
      shareCode: "AbCd12",
      accessCode: "1234",
    });
  });

  it("strips the URL fragment before parsing the accessCode (both forms)", () => {
    expect(parseTianyiShareUrl("https://cloud.189.cn/t/QzUnmqBvYr2q?accessCode=x8fd#frag")).toEqual({
      shareCode: "QzUnmqBvYr2q",
      accessCode: "x8fd",
    });
    expect(parseTianyiShareUrl("https://cloud.189.cn/web/share?code=AbCd12&pwd=1234#x")).toEqual({
      shareCode: "AbCd12",
      accessCode: "1234",
    });
  });

  it("returns null for a non-天翼 url", () => {
    expect(parseTianyiShareUrl("https://pan.quark.cn/s/abc123")).toBeNull();
  });
});

describe("TianyiStorageExecutor.transfer", () => {
  it("saves a share into the scope dir via SHARE_SAVE and diffs landed videos (succeeded)", async () => {
    let landed = false;
    const listFiles = vi.fn<TianyiClient["listFiles"]>(async () =>
      landed ? [file("924511245739356595", "Show.S01E01.1080p.mkv")] : [],
    );
    const saveShare = vi.fn<TianyiClient["saveShare"]>(async () => {
      landed = true;
      return { ok: true, failed: 0, message: "" };
    });
    const client = fakeClient({ listFiles, saveShare });
    const executor = makeExecutor(client);

    const attempt = await executor.transfer({
      workflowRunId: "run-1",
      directoryId: SCOPE,
      candidate: candidate(),
    });

    expect(saveShare).toHaveBeenCalledWith({
      shareCode: "abc123",
      accessCode: "x8fd",
      targetFolderId: SCOPE,
    });
    expect(attempt.status).toBe("succeeded");
    expect(attempt.materializedFileIds).toEqual(["924511245739356595"]);
    expect(attempt.id).toBe("run-1_transfer_1");
    expect(attempt.candidateId).toBe("cand-1");
  });

  it("throws TIANYI_NO_MAGNET on magnet/ed2k candidates without touching the client", async () => {
    const client = fakeClient();
    const executor = makeExecutor(client);

    await expect(
      executor.transfer({
        workflowRunId: "run-1",
        directoryId: SCOPE,
        candidate: candidate({
          type: "magnet" as ResourceType,
          providerPayload: { url: "magnet:?xt=urn:btih:deadbeef" },
        }),
      }),
    ).rejects.toThrow(/TIANYI_NO_MAGNET/);
    // ed2k is equally unsupported (no offline API), regardless of candidate.type
    await expect(
      executor.transfer({
        workflowRunId: "run-1",
        directoryId: SCOPE,
        candidate: candidate({ providerPayload: { url: "ed2k://|file|x.mkv|123|ABC|/" } }),
      }),
    ).rejects.toThrow(/TIANYI_NO_MAGNET/);
    expect(client.saveShare).not.toHaveBeenCalled();
  });

  it("reports failed (not throw) with the provider message when files are blocked (和谐/failed>0)", async () => {
    const saveShare = vi.fn<TianyiClient["saveShare"]>(async () => ({
      ok: false,
      failed: 2,
      message: "2 个文件被拦(可能被和谐)",
    }));
    const client = fakeClient({ saveShare });
    const executor = makeExecutor(client);

    const attempt = await executor.transfer({
      workflowRunId: "run-1",
      directoryId: SCOPE,
      candidate: candidate(),
    });

    expect(attempt.status).toBe("failed");
    expect(attempt.providerMessage).toMatch(/被拦/);
    expect(attempt.materializedFileIds).toEqual([]);
  });

  it("reports failed when saveShare returns ok:false with an EMPTY message (never reclassified as success/no_target_change)", async () => {
    const saveShare = vi.fn<TianyiClient["saveShare"]>(async () => ({ ok: false, failed: 0, message: "" }));
    const client = fakeClient({ saveShare });
    const executor = makeExecutor(client);

    const attempt = await executor.transfer({
      workflowRunId: "run-1",
      directoryId: SCOPE,
      candidate: candidate(),
    });

    expect(attempt.status).toBe("failed");
    expect(attempt.providerMessage).not.toBe("");
  });

  it("partial 和谐: status stays failed while materializedFileIds still carries the landed ids", async () => {
    // failed>0 with SOME files landed — downstream (sandbox/agent-loop guards)
    // depends on exactly this combination: failed status + non-empty landed ids.
    let landed = false;
    const listFiles = vi.fn<TianyiClient["listFiles"]>(async () =>
      landed ? [file("landed-1", "Show.S01E02.1080p.mkv")] : [],
    );
    const saveShare = vi.fn<TianyiClient["saveShare"]>(async () => {
      landed = true;
      return { ok: false, failed: 1, message: "1 个文件被拦(可能被和谐)" };
    });
    const client = fakeClient({ listFiles, saveShare });
    const executor = makeExecutor(client);

    const attempt = await executor.transfer({
      workflowRunId: "run-1",
      directoryId: SCOPE,
      candidate: candidate(),
    });

    expect(attempt.status).toBe("failed");
    expect(attempt.providerMessage).toMatch(/被拦/);
    expect(attempt.materializedFileIds).toEqual(["landed-1"]);
  });

  it("reports failed on an unparseable share url", async () => {
    const client = fakeClient();
    const executor = makeExecutor(client);

    const attempt = await executor.transfer({
      workflowRunId: "run-1",
      directoryId: SCOPE,
      candidate: candidate({ providerPayload: { url: "https://example.com/not-a-share" } }),
    });

    expect(attempt.status).toBe("failed");
    expect(attempt.providerMessage).toMatch(/TIANYI_TRANSFER_FAILED/);
    expect(client.saveShare).not.toHaveBeenCalled();
  });

  it("propagates TianyiAuthError so the worker can freeze the drive (never absorbed)", async () => {
    const saveShare = vi.fn<TianyiClient["saveShare"]>(async () => {
      throw new TianyiAuthError("TIANYI_AUTH_FAILED: session invalid");
    });
    const client = fakeClient({ saveShare });
    const executor = makeExecutor(client);

    await expect(
      executor.transfer({ workflowRunId: "run-1", directoryId: SCOPE, candidate: candidate() }),
    ).rejects.toThrow(TianyiAuthError);
  });

  it("providerPayload.password overrides the URL-parsed accessCode; empty diff = no_target_change", async () => {
    const saveShare = vi.fn<TianyiClient["saveShare"]>(async () => ({ ok: true, failed: 0, message: "" }));
    const client = fakeClient({ saveShare });
    const executor = makeExecutor(client);

    const attempt = await executor.transfer({
      workflowRunId: "run-1",
      directoryId: SCOPE,
      candidate: candidate({
        providerPayload: { url: "https://cloud.189.cn/t/abc123?accessCode=urlcode", password: "override1" },
      }),
    });

    expect(saveShare).toHaveBeenCalledWith(expect.objectContaining({ accessCode: "override1" }));
    expect(attempt.status).toBe("no_target_change");
    expect(attempt.providerMessage).toMatch(/未出现新视频/);
  });
});

describe("TianyiStorageExecutor.createDirectory", () => {
  it("find-or-create reuses a same-name folder and registers it in derived scope", async () => {
    // A same-name FILE must not match — only isFolder items count.
    const listFiles = vi.fn<TianyiClient["listFiles"]>(async () => [
      file("afile", "TV"),
      folder("exist", "TV"),
    ]);
    const client = fakeClient({ listFiles });
    const executor = makeExecutor(client, ["root"]);

    await expect(executor.createDirectory({ name: "TV", parentId: "root" })).resolves.toBe("exist");
    expect(client.createFolder).not.toHaveBeenCalled();
    // derived: a subsequent write into "exist" must now pass the scope guard
    await expect(
      executor.renameFile({ directoryId: "exist", fileId: "f1", newName: "x.mkv" }),
    ).resolves.toBeUndefined();
    expect(client.renameFile).toHaveBeenCalledWith({ fileId: "f1", name: "x.mkv" });
  });

  it("creates a new folder when none matches and authorizes writes into it", async () => {
    const createFolder = vi.fn<TianyiClient["createFolder"]>(async () => "fresh-dir");
    const client = fakeClient({ createFolder });
    const executor = makeExecutor(client, ["root"]);

    await expect(executor.createDirectory({ name: "Movies", parentId: "root" })).resolves.toBe("fresh-dir");
    expect(createFolder).toHaveBeenCalledWith({ name: "Movies", parentId: "root" });

    // derived scope covers the CREATE branch too. The port only hands ids, so
    // entries go name-less with isFolder:false (moved things are always files).
    const moved = await executor.moveFiles({ fileIds: ["f1"], targetDirectoryId: "fresh-dir" });
    expect(moved).toEqual({ moved: ["f1"] });
    expect(client.moveFiles).toHaveBeenCalledWith({
      entries: [{ id: "f1", isFolder: false }],
      targetFolderId: "fresh-dir",
    });
  });

  it("refuses createDirectory under an out-of-scope parent (WRITE_SCOPE_VIOLATION)", async () => {
    const client = fakeClient();
    const executor = makeExecutor(client);
    await expect(executor.createDirectory({ name: "x", parentId: "elsewhere" })).rejects.toThrow(
      /WRITE_SCOPE_VIOLATION/,
    );
  });
});

describe("TianyiStorageExecutor write-scope guard (derived scope)", () => {
  it("refuses transfer into an id not in scope, before any client call", async () => {
    const client = fakeClient();
    const executor = makeExecutor(client);
    await expect(
      executor.transfer({ workflowRunId: "run-1", directoryId: "elsewhere", candidate: candidate() }),
    ).rejects.toThrow(/WRITE_SCOPE_VIOLATION/);
    expect(client.saveShare).not.toHaveBeenCalled();
    expect(client.listFiles).not.toHaveBeenCalled();
  });

  it("authorizes removeDirectory of a server-created subdir discovered under an in-scope dir (PR#58)", async () => {
    // SHARE_SAVE materializes wrapper dirs SERVER-SIDE (not via createDirectory).
    // Discovering one by listing its in-scope parent must make it removable, or
    // movie-flatten cleanup leaves empty wrappers behind.
    const MOVIE = "movie-dir";
    const wrapperId = "wrapper-1";
    const fs = new Map<string, TianyiItem[]>();
    fs.set(MOVIE, [folder(wrapperId, "Oppenheimer.2023.1080p")]);
    fs.set(wrapperId, []);
    const listFiles = vi.fn<TianyiClient["listFiles"]>(async (dirId) => fs.get(dirId ?? "") ?? []);
    const batchDelete = vi.fn<TianyiClient["batchDelete"]>(async () => {});
    const executor = makeExecutor(fakeClient({ listFiles, batchDelete }), [MOVIE]);

    const subdirs = await executor.listSubdirectories({ directoryId: MOVIE });
    expect(subdirs.map((d) => d.id)).toContain(wrapperId);

    await expect(executor.removeDirectory(wrapperId)).resolves.toEqual({ removed: true });
    // Folder delete MUST carry isFolder:true (probe-verified: isFolder:0 on a dir
    // deletes nothing). Name is unknown at this call site — sent name-less.
    expect(batchDelete).toHaveBeenCalledWith([{ id: wrapperId, isFolder: true }]);
  });

  it("does NOT widen scope by listing an OUT-of-scope dir (read ≠ write)", async () => {
    const fs = new Map<string, TianyiItem[]>();
    fs.set("elsewhere", [folder("stranger", "x")]);
    fs.set("stranger", []);
    const listFiles = vi.fn<TianyiClient["listFiles"]>(async (dirId) => fs.get(dirId ?? "") ?? []);
    const executor = makeExecutor(fakeClient({ listFiles }));

    await executor.listSubdirectories({ directoryId: "elsewhere" });
    await expect(executor.removeDirectory("stranger")).rejects.toThrow(/WRITE_SCOPE_VIOLATION/);
  });
});

describe("TianyiStorageExecutor.removeDirectory / recursive-list safety", () => {
  it("refuses to remove a write-scope root (SAFETY_VIOLATION)", async () => {
    const executor = makeExecutor(fakeClient());
    await expect(executor.removeDirectory(SCOPE)).rejects.toThrow(/SAFETY_VIOLATION/);
  });

  it("refuses to recursively list the 天翼 account root -11 even with an empty (dev) scope", async () => {
    const executor = makeExecutor(fakeClient(), []);
    await expect(executor.listVideoFiles("-11")).rejects.toThrow(/SAFETY_VIOLATION/);
    await expect(executor.listTree({ directoryId: "-11" })).rejects.toThrow(/SAFETY_VIOLATION/);
  });
});

describe("TianyiStorageExecutor.flattenDirectory", () => {
  it("moves large nested videos up and removes wrapper dirs left without large videos", async () => {
    const fs = new Map<string, TianyiItem[]>();
    fs.set(SCOPE, [folder("wrap", "Movie.2020.1080p"), folder("junk", "ads")]);
    fs.set("wrap", [file("v1", "Movie.2020.mkv"), file("nfo", "info.nfo", 100)]);
    fs.set("junk", [file("ad", "ad.txt", 100)]);
    const listFiles = vi.fn<TianyiClient["listFiles"]>(async (dirId) => fs.get(dirId ?? "") ?? []);
    const moveFiles = vi.fn<TianyiClient["moveFiles"]>(async ({ entries, targetFolderId }) => {
      for (const entry of entries) {
        for (const items of fs.values()) {
          const idx = items.findIndex((i) => i.id === entry.id);
          if (idx >= 0) {
            const [moved] = items.splice(idx, 1);
            if (moved) {
              fs.get(targetFolderId)?.push(moved);
            }
          }
        }
      }
    });
    const batchDelete = vi.fn<TianyiClient["batchDelete"]>(async () => {});
    const executor = makeExecutor(fakeClient({ listFiles, moveFiles, batchDelete }));

    const result = await executor.flattenDirectory(SCOPE);

    expect(result.moved).toEqual(["v1"]);
    // The flatten call site KNOWS folderness+name from its own listing — both ride along.
    expect(moveFiles).toHaveBeenCalledWith({
      entries: [{ id: "v1", name: "Movie.2020.mkv", isFolder: false }],
      targetFolderId: SCOPE,
    });
    // "wrap" lost its only large video to the move; "junk" never had one — both go,
    // as FOLDER entries (isFolder:true + name, probe-verified shape).
    expect(result.removed).toEqual(["wrap", "junk"]);
    expect(batchDelete).toHaveBeenCalledWith([
      { id: "wrap", name: "Movie.2020.1080p", isFolder: true },
      { id: "junk", name: "ads", isFolder: true },
    ]);
  });

  it("fails loud when the DELETE batch task reports failure (no zombie wrappers masquerading as success)", async () => {
    const fs = new Map<string, TianyiItem[]>();
    fs.set(SCOPE, [folder("junk", "ads")]);
    fs.set("junk", []);
    const listFiles = vi.fn<TianyiClient["listFiles"]>(async (dirId) => fs.get(dirId ?? "") ?? []);
    const batchDelete = vi.fn<TianyiClient["batchDelete"]>(async () => {
      throw new Error("TIANYI_DELETE_FAILED: 1 项失败(failedCount>0)");
    });
    const executor = makeExecutor(fakeClient({ listFiles, batchDelete }));

    await expect(executor.flattenDirectory(SCOPE)).rejects.toThrow(/TIANYI_DELETE_FAILED/);
  });
});

describe("TianyiStorageExecutor.deleteFiles", () => {
  it("deletes a non-video file (subtitle) that the directory TREE contains — verify via listTree, not listVideoFiles", async () => {
    const listFiles = vi.fn<TianyiClient["listFiles"]>(async () => [file("sub1", "多余字幕.srt", 77944)]);
    const batchDelete = vi.fn<TianyiClient["batchDelete"]>(async () => {});
    const executor = makeExecutor(fakeClient({ listFiles, batchDelete }));

    await expect(executor.deleteFiles({ directoryId: SCOPE, fileIds: ["sub1"] })).resolves.toEqual({
      deleted: ["sub1"],
    });
    // File entries: isFolder:false; the name is free from the just-walked tree.
    expect(batchDelete).toHaveBeenCalledWith([{ id: "sub1", name: "多余字幕.srt", isFolder: false }]);
  });

  it("refuses ids that are nowhere in the directory tree (SAFETY_VIOLATION)", async () => {
    const listFiles = vi.fn<TianyiClient["listFiles"]>(async () => [file("sub1", "多余字幕.srt", 77944)]);
    const client = fakeClient({ listFiles });
    const executor = makeExecutor(client);

    await expect(executor.deleteFiles({ directoryId: SCOPE, fileIds: ["ghost"] })).rejects.toThrow(
      /SAFETY_VIOLATION/,
    );
    expect(client.batchDelete).not.toHaveBeenCalled();
  });
});

describe("TianyiStorageExecutor item adapter (isFolder/id/name/size)", () => {
  it("listVideoFiles recurses, filters by video extension and parses episode codes", async () => {
    const fs = new Map<string, TianyiItem[]>();
    fs.set(SCOPE, [
      file("v1", "Show.S01E03.1080p.mkv"),
      file("p1", "poster.jpg", 100),
      folder("d1", "Extras"),
    ]);
    fs.set("d1", [file("v2", "Movie.2020.mp4")]);
    const listFiles = vi.fn<TianyiClient["listFiles"]>(async (dirId) => fs.get(dirId ?? "") ?? []);
    const executor = makeExecutor(fakeClient({ listFiles }));

    const videos = await executor.listVideoFiles(SCOPE);

    expect(videos.map((v) => v.name).sort()).toEqual(["Movie.2020.mp4", "Show.S01E03.1080p.mkv"]);
    expect(videos.find((v) => v.id === "v1")?.episodeCode).toBe("S01E03");
    expect(videos.find((v) => v.id === "v2")?.episodeCode).toBeNull();
  });

  it("listUnparsedVideoFiles returns only videos lacking an episode code", async () => {
    const listFiles = vi.fn<TianyiClient["listFiles"]>(async () => [
      file("v1", "Show.S01E03.mkv"),
      file("v2", "神印王座之无名乱斗.mp4"),
    ]);
    const executor = makeExecutor(fakeClient({ listFiles }));

    const unparsed = await executor.listUnparsedVideoFiles(SCOPE);
    expect(unparsed.map((u) => u.providerFileId)).toEqual(["v2"]);
  });

  it("listChildDirectories returns only isFolder entries (one level)", async () => {
    const listFiles = vi.fn<TianyiClient["listFiles"]>(async () => [
      folder("d1", "Season 1"),
      file("f1", "ep.mkv"),
      folder("d2", "Season 2"),
    ]);
    const executor = makeExecutor(fakeClient({ listFiles }));

    await expect(executor.listChildDirectories(SCOPE)).resolves.toEqual([
      { id: "d1", name: "Season 1" },
      { id: "d2", name: "Season 2" },
    ]);
  });
});
