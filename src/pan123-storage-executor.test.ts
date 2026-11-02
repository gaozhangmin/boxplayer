import { describe, expect, it, vi } from "vitest";
import type { ResourceCandidate, ResourceType } from "./domain.js";
import { Pan123AuthError } from "./pan123-client.js";
import type { Pan123Client, Pan123Item } from "./pan123-client.js";
import type { Pan123StorageExecutorOptions } from "./pan123-storage-executor.js";
import { parsePan123ShareUrl, Pan123StorageExecutor } from "./pan123-storage-executor.js";

/** The slice of Pan123Client the executor drives. Fakes must match the REAL
 *  method signatures (read from pan123-client.ts, not guessed): saveShare takes
 *  shareKey/sharePwd/targetParentId and returns {ok,message}; moveFiles takes
 *  {fileIds,targetParentId}; deletion is `trash` (not batchDelete). */
type Pan123ClientShape = Pick<
  Pan123Client,
  "listFiles" | "createFolder" | "saveShare" | "renameFile" | "trash" | "moveFiles"
>;

function fakeClient(overrides: Partial<Pan123ClientShape> = {}): Pan123ClientShape {
  return {
    listFiles: vi.fn<Pan123Client["listFiles"]>(async () => []),
    createFolder: vi.fn<Pan123Client["createFolder"]>(async () => "newdir123"),
    saveShare: vi.fn<Pan123Client["saveShare"]>(async () => ({ ok: true, message: "" })),
    renameFile: vi.fn<Pan123Client["renameFile"]>(async () => {}),
    trash: vi.fn<Pan123Client["trash"]>(async () => {}),
    moveFiles: vi.fn<Pan123Client["moveFiles"]>(async () => {}),
    ...overrides,
  };
}

function makeExecutor(
  client: Pan123ClientShape,
  writeScopeDirectoryIds: string[] = [SCOPE],
  extra: Partial<Pan123StorageExecutorOptions> = {},
): Pan123StorageExecutor {
  return new Pan123StorageExecutor({
    client: client as unknown as Pan123Client,
    writeScopeDirectoryIds,
    // 默认注入 no-op sleep,让走 settle-poll 的用例(no_target_change 等)不真睡 8×2.5s。
    sleep: async () => {},
    ...extra,
  });
}

/** ⚠️ bigint lesson (Task 1): fake items use STRING ids — an 18-digit int64 as a
 *  bare JS number literal is silently rounded before the stub even sees it. */
function folder(id: string, name: string): Pan123Item {
  return { id, name, size: 0, etag: "", isFolder: true };
}

function file(id: string, name: string, size = 50 * 1024 * 1024): Pan123Item {
  return { id, name, size, etag: "", isFolder: false };
}

function candidate(overrides: Partial<ResourceCandidate> = {}): ResourceCandidate {
  return {
    id: "cand-1",
    snapshotId: "snap-1",
    index: 0,
    title: "Some Show",
    type: "manual" as ResourceType,
    source: "test",
    providerPayload: { url: "https://www.123pan.com/s/abc-1?pwd=x8fd" },
    ...overrides,
  };
}

const SCOPE = "scope-dir";

describe("parsePan123ShareUrl", () => {
  it("parses the 123pan.com/s/<key> form with a pwd query", () => {
    expect(parsePan123ShareUrl("https://www.123pan.com/s/abc-1?pwd=x8fd")).toEqual({
      shareKey: "abc-1",
      sharePwd: "x8fd",
    });
    expect(parsePan123ShareUrl("https://www.123pan.com/s/abc-1")).toEqual({
      shareKey: "abc-1",
      sharePwd: "",
    });
  });

  it("matches the mirror domains (123684/123865/123912.com/cn) and accepts `password`", () => {
    expect(parsePan123ShareUrl("https://123684.com/s/Kd9-TvBq?password=1234")).toEqual({
      shareKey: "Kd9-TvBq",
      sharePwd: "1234",
    });
    expect(parsePan123ShareUrl("https://www.123912.cn/s/Zz_00?pwd=abcd")).toEqual({
      shareKey: "Zz_00",
      sharePwd: "abcd",
    });
  });

  it("strips the URL fragment before parsing the access code", () => {
    expect(parsePan123ShareUrl("https://www.123pan.com/s/abc-1?pwd=x8fd#frag")).toEqual({
      shareKey: "abc-1",
      sharePwd: "x8fd",
    });
  });

  it("returns null for a non-123 url", () => {
    expect(parsePan123ShareUrl("https://pan.quark.cn/s/abc123")).toBeNull();
  });
});

describe("Pan123StorageExecutor.transfer", () => {
  it("saves a share into the scope dir and diffs landed videos (succeeded)", async () => {
    let landed = false;
    const listFiles = vi.fn<Pan123Client["listFiles"]>(async () =>
      landed ? [file("924511245739356595", "Show.S01E01.1080p.mkv")] : [],
    );
    const saveShare = vi.fn<Pan123Client["saveShare"]>(async () => {
      landed = true;
      return { ok: true, message: "" };
    });
    const client = fakeClient({ listFiles, saveShare });
    const executor = makeExecutor(client);

    const attempt = await executor.transfer({
      workflowRunId: "run-1",
      directoryId: SCOPE,
      candidate: candidate(),
    });

    expect(saveShare).toHaveBeenCalledWith({
      shareKey: "abc-1",
      sharePwd: "x8fd",
      targetParentId: SCOPE,
    });
    expect(attempt.status).toBe("succeeded");
    expect(attempt.materializedFileIds).toEqual(["924511245739356595"]);
    expect(attempt.id).toBe("run-1_transfer_1");
    expect(attempt.candidateId).toBe("cand-1");
  });

  it("throws PAN123_NO_MAGNET on magnet/ed2k candidates without touching the client", async () => {
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
    ).rejects.toThrow(/PAN123_NO_MAGNET/);
    // ed2k is equally unsupported (no offline API), regardless of candidate.type
    await expect(
      executor.transfer({
        workflowRunId: "run-1",
        directoryId: SCOPE,
        candidate: candidate({ providerPayload: { url: "ed2k://|file|x.mkv|123|ABC|/" } }),
      }),
    ).rejects.toThrow(/PAN123_NO_MAGNET/);
    expect(client.saveShare).not.toHaveBeenCalled();
  });

  it("reports failed (not throw) with the provider message for a dead/empty share", async () => {
    const saveShare = vi.fn<Pan123Client["saveShare"]>(async () => ({
      ok: false,
      message: "分享为空 / 已失效(share empty / dead)",
    }));
    const client = fakeClient({ saveShare });
    const executor = makeExecutor(client);

    const attempt = await executor.transfer({
      workflowRunId: "run-1",
      directoryId: SCOPE,
      candidate: candidate(),
    });

    expect(attempt.status).toBe("failed");
    expect(attempt.providerMessage).toMatch(/失效/);
    expect(attempt.materializedFileIds).toEqual([]);
  });

  it("reports failed when saveShare returns ok:false with an EMPTY message (never reclassified as success/no_target_change)", async () => {
    const saveShare = vi.fn<Pan123Client["saveShare"]>(async () => ({ ok: false, message: "" }));
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

  it("reports failed on an unparseable share url without touching the client", async () => {
    const client = fakeClient();
    const executor = makeExecutor(client);

    const attempt = await executor.transfer({
      workflowRunId: "run-1",
      directoryId: SCOPE,
      candidate: candidate({ providerPayload: { url: "https://example.com/not-a-share" } }),
    });

    expect(attempt.status).toBe("failed");
    expect(attempt.providerMessage).toMatch(/PAN123_TRANSFER_FAILED/);
    expect(client.saveShare).not.toHaveBeenCalled();
  });

  it("propagates Pan123AuthError so the worker can freeze the drive (never absorbed)", async () => {
    const saveShare = vi.fn<Pan123Client["saveShare"]>(async () => {
      throw new Pan123AuthError("PAN123_AUTH_FAILED: token dead");
    });
    const client = fakeClient({ saveShare });
    const executor = makeExecutor(client);

    await expect(
      executor.transfer({ workflowRunId: "run-1", directoryId: SCOPE, candidate: candidate() }),
    ).rejects.toThrow(Pan123AuthError);
  });

  it("bounded settle-poll: waits for the async copy to land, then reports succeeded (copy/async is server-side async)", async () => {
    // /file/copy/async returns before the copy finishes queuing (saveShare is
    // fire-copy, unlike tianyi's poll-to-done). A single immediate re-list would
    // miss a big transfer still in the queue → false no_target_change ("lands
    // nothing" 老伤). Poll the target dir (probe: 8×2.5s) until videos appear.
    let lists = 0;
    const listFiles = vi.fn<Pan123Client["listFiles"]>(async () => {
      lists += 1;
      // #1 before-list empty; #2/#3 after-list empty (still queuing); #4 landed.
      return lists >= 4 ? [file("924511245739356595", "Show.S01E01.mkv")] : [];
    });
    const saveShare = vi.fn<Pan123Client["saveShare"]>(async () => ({ ok: true, message: "" }));
    const sleeps: number[] = [];
    const executor = makeExecutor(fakeClient({ listFiles, saveShare }), [SCOPE], {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const attempt = await executor.transfer({
      workflowRunId: "run-1",
      directoryId: SCOPE,
      candidate: candidate(),
    });

    expect(attempt.status).toBe("succeeded");
    expect(attempt.materializedFileIds).toEqual(["924511245739356595"]);
    expect(sleeps.length).toBeGreaterThanOrEqual(2); // waited across the empty reads
    expect(sleeps.every((ms) => ms === 2500)).toBe(true); // default interval aligns with the probe
  });

  it("settle-poll exhausts and reports no_target_change when nothing ever lands (sleeps attempts-1 times)", async () => {
    const listFiles = vi.fn<Pan123Client["listFiles"]>(async () => []); // never lands
    const saveShare = vi.fn<Pan123Client["saveShare"]>(async () => ({ ok: true, message: "" }));
    const sleeps: number[] = [];
    const executor = makeExecutor(fakeClient({ listFiles, saveShare }), [SCOPE], {
      transferSettlePollAttempts: 4,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const attempt = await executor.transfer({
      workflowRunId: "run-1",
      directoryId: SCOPE,
      candidate: candidate(),
    });

    expect(attempt.status).toBe("no_target_change");
    expect(attempt.materializedFileIds).toEqual([]);
    expect(sleeps.length).toBe(3); // attempts-1: sleep BETWEEN reads only, not after the last
  });

  it("diffs against a NON-empty before set: materializedFileIds carries only the newly landed id", async () => {
    // before was always empty in the other cases; verify the !before.has filter
    // excludes a pre-existing video and reports only the new one.
    let landed = false;
    const listFiles = vi.fn<Pan123Client["listFiles"]>(async () =>
      landed
        ? [file("old-1", "Show.S01E01.mkv"), file("new-1", "Show.S01E02.mkv")]
        : [file("old-1", "Show.S01E01.mkv")],
    );
    const saveShare = vi.fn<Pan123Client["saveShare"]>(async () => {
      landed = true;
      return { ok: true, message: "" };
    });
    const executor = makeExecutor(fakeClient({ listFiles, saveShare }));

    const attempt = await executor.transfer({
      workflowRunId: "run-1",
      directoryId: SCOPE,
      candidate: candidate(),
    });

    expect(attempt.status).toBe("succeeded");
    expect(attempt.materializedFileIds).toEqual(["new-1"]); // NOT old-1
  });

  it("providerPayload.password overrides the URL-parsed sharePwd; empty diff = no_target_change", async () => {
    const saveShare = vi.fn<Pan123Client["saveShare"]>(async () => ({ ok: true, message: "" }));
    const client = fakeClient({ saveShare });
    const executor = makeExecutor(client);

    const attempt = await executor.transfer({
      workflowRunId: "run-1",
      directoryId: SCOPE,
      candidate: candidate({
        providerPayload: { url: "https://www.123pan.com/s/abc-1?pwd=urlcode", password: "override1" },
      }),
    });

    expect(saveShare).toHaveBeenCalledWith(expect.objectContaining({ sharePwd: "override1" }));
    expect(attempt.status).toBe("no_target_change");
    expect(attempt.providerMessage).toMatch(/未出现新视频/);
  });
});

describe("Pan123StorageExecutor.createDirectory", () => {
  it("find-or-create reuses a same-name folder and registers it in derived scope", async () => {
    // A same-name FILE must not match — only isFolder items count.
    const listFiles = vi.fn<Pan123Client["listFiles"]>(async () => [
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
    const createFolder = vi.fn<Pan123Client["createFolder"]>(async () => "fresh-dir");
    const client = fakeClient({ createFolder });
    const executor = makeExecutor(client, ["root"]);

    await expect(executor.createDirectory({ name: "Movies", parentId: "root" })).resolves.toBe("fresh-dir");
    expect(createFolder).toHaveBeenCalledWith({ name: "Movies", parentId: "root" });

    // derived scope covers the CREATE branch too. The port only hands ids; 123's
    // moveFiles takes a bare fileIds[] + targetParentId.
    const moved = await executor.moveFiles({ fileIds: ["f1"], targetDirectoryId: "fresh-dir" });
    expect(moved).toEqual({ moved: ["f1"] });
    expect(client.moveFiles).toHaveBeenCalledWith({ fileIds: ["f1"], targetParentId: "fresh-dir" });
  });

  it("refuses createDirectory under an out-of-scope parent (WRITE_SCOPE_VIOLATION)", async () => {
    const client = fakeClient();
    const executor = makeExecutor(client);
    await expect(executor.createDirectory({ name: "x", parentId: "elsewhere" })).rejects.toThrow(
      /WRITE_SCOPE_VIOLATION/,
    );
  });
});

describe("Pan123StorageExecutor write-scope guard (derived scope)", () => {
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
    const fs = new Map<string, Pan123Item[]>();
    fs.set(MOVIE, [folder(wrapperId, "Oppenheimer.2023.1080p")]);
    fs.set(wrapperId, []);
    const listFiles = vi.fn<Pan123Client["listFiles"]>(async (dirId) => fs.get(dirId ?? "") ?? []);
    const trash = vi.fn<Pan123Client["trash"]>(async () => {});
    const executor = makeExecutor(fakeClient({ listFiles, trash }), [MOVIE]);

    const subdirs = await executor.listSubdirectories({ directoryId: MOVIE });
    expect(subdirs.map((d) => d.id)).toContain(wrapperId);

    await expect(executor.removeDirectory(wrapperId)).resolves.toEqual({ removed: true });
    // Folder delete MUST carry isFolder:true; name is unknown at this call site — sent name-less.
    expect(trash).toHaveBeenCalledWith([{ id: wrapperId, isFolder: true }]);
  });

  it("does NOT widen scope by listing an OUT-of-scope dir (read ≠ write)", async () => {
    const fs = new Map<string, Pan123Item[]>();
    fs.set("elsewhere", [folder("stranger", "x")]);
    fs.set("stranger", []);
    const listFiles = vi.fn<Pan123Client["listFiles"]>(async (dirId) => fs.get(dirId ?? "") ?? []);
    const executor = makeExecutor(fakeClient({ listFiles }));

    await executor.listSubdirectories({ directoryId: "elsewhere" });
    await expect(executor.removeDirectory("stranger")).rejects.toThrow(/WRITE_SCOPE_VIOLATION/);
  });
});

describe("Pan123StorageExecutor.removeDirectory / recursive-list safety", () => {
  it("refuses to remove a write-scope root (SAFETY_VIOLATION)", async () => {
    const executor = makeExecutor(fakeClient());
    await expect(executor.removeDirectory(SCOPE)).rejects.toThrow(/SAFETY_VIOLATION/);
  });

  it("refuses to recursively list the 123 account root 0 even with an empty (dev) scope", async () => {
    const executor = makeExecutor(fakeClient(), []);
    await expect(executor.listVideoFiles("0")).rejects.toThrow(/SAFETY_VIOLATION/);
    await expect(executor.listTree({ directoryId: "0" })).rejects.toThrow(/SAFETY_VIOLATION/);
  });
});

describe("Pan123StorageExecutor.flattenDirectory", () => {
  it("moves large nested videos up (moveFiles fileIds) and trashes wrapper dirs left without large videos", async () => {
    const fs = new Map<string, Pan123Item[]>();
    fs.set(SCOPE, [folder("wrap", "Movie.2020.1080p"), folder("junk", "ads")]);
    fs.set("wrap", [file("v1", "Movie.2020.mkv"), file("nfo", "info.nfo", 100)]);
    fs.set("junk", [file("ad", "ad.txt", 100)]);
    const listFiles = vi.fn<Pan123Client["listFiles"]>(async (dirId) => fs.get(dirId ?? "") ?? []);
    const moveFiles = vi.fn<Pan123Client["moveFiles"]>(async ({ fileIds, targetParentId }) => {
      for (const id of fileIds) {
        for (const items of fs.values()) {
          const idx = items.findIndex((i) => i.id === id);
          if (idx >= 0) {
            const [moved] = items.splice(idx, 1);
            if (moved) {
              fs.get(targetParentId)?.push(moved);
            }
          }
        }
      }
    });
    const trash = vi.fn<Pan123Client["trash"]>(async () => {});
    const executor = makeExecutor(fakeClient({ listFiles, moveFiles, trash }));

    const result = await executor.flattenDirectory(SCOPE);

    expect(result.moved).toEqual(["v1"]);
    // videos are always isFolder:false — only fileIds ride along for 123's moveFiles.
    expect(moveFiles).toHaveBeenCalledWith({ fileIds: ["v1"], targetParentId: SCOPE });
    // "wrap" lost its only large video to the move; "junk" never had one — both go,
    // as FOLDER entries (isFolder:true + name from the flatten's own listing).
    expect(result.removed).toEqual(["wrap", "junk"]);
    expect(trash).toHaveBeenCalledWith([
      { id: "wrap", name: "Movie.2020.1080p", isFolder: true },
      { id: "junk", name: "ads", isFolder: true },
    ]);
  });

  it("fails loud when the trash call reports failure (no zombie wrappers masquerading as success)", async () => {
    const fs = new Map<string, Pan123Item[]>();
    fs.set(SCOPE, [folder("junk", "ads")]);
    fs.set("junk", []);
    const listFiles = vi.fn<Pan123Client["listFiles"]>(async (dirId) => fs.get(dirId ?? "") ?? []);
    const trash = vi.fn<Pan123Client["trash"]>(async () => {
      throw new Error("PAN123_FAILED(/file/trash): code=5000 ...");
    });
    const executor = makeExecutor(fakeClient({ listFiles, trash }));

    await expect(executor.flattenDirectory(SCOPE)).rejects.toThrow(/PAN123_FAILED/);
  });
});

describe("Pan123StorageExecutor.deleteFiles", () => {
  it("deletes a non-video file (subtitle) that the directory TREE contains — verify via listTree, not listVideoFiles", async () => {
    const listFiles = vi.fn<Pan123Client["listFiles"]>(async () => [file("sub1", "多余字幕.srt", 77944)]);
    const trash = vi.fn<Pan123Client["trash"]>(async () => {});
    const executor = makeExecutor(fakeClient({ listFiles, trash }));

    await expect(executor.deleteFiles({ directoryId: SCOPE, fileIds: ["sub1"] })).resolves.toEqual({
      deleted: ["sub1"],
    });
    // File entries: isFolder:false; the basename is free from the just-walked tree.
    expect(trash).toHaveBeenCalledWith([{ id: "sub1", name: "多余字幕.srt", isFolder: false }]);
  });

  it("refuses ids that are nowhere in the directory tree (SAFETY_VIOLATION)", async () => {
    const listFiles = vi.fn<Pan123Client["listFiles"]>(async () => [file("sub1", "多余字幕.srt", 77944)]);
    const client = fakeClient({ listFiles });
    const executor = makeExecutor(client);

    await expect(executor.deleteFiles({ directoryId: SCOPE, fileIds: ["ghost"] })).rejects.toThrow(
      /SAFETY_VIOLATION/,
    );
    expect(client.trash).not.toHaveBeenCalled();
  });
});

describe("Pan123StorageExecutor item adapter (isFolder/id/name/size)", () => {
  it("listVideoFiles recurses, filters by video extension and parses episode codes", async () => {
    const fs = new Map<string, Pan123Item[]>();
    fs.set(SCOPE, [
      file("v1", "Show.S01E03.1080p.mkv"),
      file("p1", "poster.jpg", 100),
      folder("d1", "Extras"),
    ]);
    fs.set("d1", [file("v2", "Movie.2020.mp4")]);
    const listFiles = vi.fn<Pan123Client["listFiles"]>(async (dirId) => fs.get(dirId ?? "") ?? []);
    const executor = makeExecutor(fakeClient({ listFiles }));

    const videos = await executor.listVideoFiles(SCOPE);

    expect(videos.map((v) => v.name).sort()).toEqual(["Movie.2020.mp4", "Show.S01E03.1080p.mkv"]);
    expect(videos.find((v) => v.id === "v1")?.episodeCode).toBe("S01E03");
    expect(videos.find((v) => v.id === "v2")?.episodeCode).toBeNull();
  });

  it("listUnparsedVideoFiles returns only videos lacking an episode code", async () => {
    const listFiles = vi.fn<Pan123Client["listFiles"]>(async () => [
      file("v1", "Show.S01E03.mkv"),
      file("v2", "神印王座之无名乱斗.mp4"),
    ]);
    const executor = makeExecutor(fakeClient({ listFiles }));

    const unparsed = await executor.listUnparsedVideoFiles(SCOPE);
    expect(unparsed.map((u) => u.providerFileId)).toEqual(["v2"]);
  });

  it("listChildDirectories returns only isFolder entries (one level)", async () => {
    const listFiles = vi.fn<Pan123Client["listFiles"]>(async () => [
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
