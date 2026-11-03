import { describe, expect, it } from "vitest";
import {
  createBootstrapPan115CookieStorageExecutor,
  createProtectedStorage115Executor,
  infoHashFromMagnet,
  Pan115ApiGuard,
  Pan115RiskControlError,
  Storage115Executor,
  type Pan115ActionResult,
  type Pan115DirectoryInfo,
  type Pan115Item,
  type Pan115OfflineTask,
  type Pan115StorageApi,
  type ResourceCandidate,
} from "../src/index.js";

describe("infoHashFromMagnet", () => {
  it("reads a 40-char hex btih, lowercased", () => {
    const hex = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
    expect(infoHashFromMagnet(`magnet:?xt=urn:btih:${hex}&dn=x`)).toBe(hex.toLowerCase());
  });

  it("decodes a 32-char base32 btih to hex so base32 magnets are cancellable", () => {
    // 32 'A's = 20 zero bytes = 40 hex zeros; 32 '7's = 20 0xFF bytes = 40 'f's.
    expect(infoHashFromMagnet("magnet:?xt=urn:btih:" + "A".repeat(32))).toBe("0".repeat(40));
    expect(infoHashFromMagnet("magnet:?xt=urn:btih:" + "7".repeat(32))).toBe("f".repeat(40));
  });

  it("returns null for non-magnet or malformed links", () => {
    expect(infoHashFromMagnet("https://115.com/s/abc")).toBeNull();
    expect(infoHashFromMagnet("magnet:?xt=urn:btih:tooshort")).toBeNull();
  });
});

describe("Storage115Executor", () => {
  it("refuses to create a protected live executor without a configured write scope", () => {
    expect(() =>
      createProtectedStorage115Executor({
        api: new FakePan115Api(),
        env: {},
        apiGuardOptions: { minDelayMs: 0 },
      }),
    ).toThrow("MEDIA_TRACK_115_WRITE_SCOPE_REQUIRED");
  });

  it("createBootstrapPan115CookieStorageExecutor does NOT require a write scope (escapes the provisioning catch-22)", () => {
    // The protected factory throws on empty scope; the bootstrap variant must not,
    // so connect-time provisionCategoryDirs can create the media tree under root.
    expect(() => createBootstrapPan115CookieStorageExecutor({ cookie: "UID=1_abc" })).not.toThrow();
    expect(createBootstrapPan115CookieStorageExecutor({ cookie: "UID=1_abc" })).toBeInstanceOf(Storage115Executor);
  });

  it("uses the configured 115 test root as the default write scope", async () => {
    const api = new FakePan115Api({
      shareFiles: {
        abc123: [
          {
            fid: "file_1",
            n: "Show.S01E01.mkv",
            s: "1000000000",
          },
        ],
      },
      directoryInfo: {
        season_1: seasonPathInfo("test_root", "season_1"),
        outside_season: seasonPathInfo("other_root", "outside_season"),
      },
    });
    const executor = createProtectedStorage115Executor({
      api,
      env: {
        MEDIA_TRACK_115_TEST_ROOT_CID: "test_root",
      },
      apiGuardOptions: { minDelayMs: 0 },
    });

    await expect(
      executor.transfer({
        workflowRunId: "run_1",
        directoryId: "outside_season",
        candidate: candidateFixture({
          type: "115",
          providerPayload: {
            url: "https://115.com/s/abc123?password=pw",
            rawType: "115",
          },
        }),
      }),
    ).rejects.toThrow("WRITE_SCOPE_VIOLATION");

    await expect(
      executor.transfer({
        workflowRunId: "run_1",
        directoryId: "season_1",
        candidate: candidateFixture({
          type: "115",
          providerPayload: {
            url: "https://115.com/s/abc123?password=pw",
            rawType: "115",
          },
        }),
      }),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(api.receivedShares).toEqual([
      {
        shareCode: "abc123",
        receiveCode: "pw",
        directoryId: "season_1",
      },
    ]);
  });

  it("marks configured 115 library roots and the test root as protected flatten targets", async () => {
    const executor = createProtectedStorage115Executor({
      api: new FakePan115Api(),
      env: {
        MEDIA_TRACK_115_TEST_ROOT_CID: "test_root",
        CLAWD_MEDIA_ROOT_CID: "media_root",
        TV_SHOWS_CID: "tv_root",
      },
      apiGuardOptions: { minDelayMs: 0 },
    });

    await expect(executor.flattenDirectory("test_root")).rejects.toThrow(
      "SAFETY_VIOLATION: refusing to flatten protected directory cid=test_root",
    );
    await expect(executor.flattenDirectory("tv_root")).rejects.toThrow(
      "SAFETY_VIOLATION: refusing to flatten protected directory cid=tv_root",
    );
  });

  it("refuses recursive listing of protected root/parent/category directories", async () => {
    const executor = createProtectedStorage115Executor({
      api: new FakePan115Api(),
      env: {
        MEDIA_TRACK_115_TEST_ROOT_CID: "test_root",
        CLAWD_MEDIA_ROOT_CID: "media_root",
        TV_SHOWS_CID: "tv_root",
      },
      apiGuardOptions: { minDelayMs: 0 },
    });

    await expect(executor.listVideoFiles("test_root")).rejects.toThrow(
      "SAFETY_VIOLATION: refusing to recursively list videos in protected directory cid=test_root",
    );
    await expect(executor.listVideoFiles("tv_root")).rejects.toThrow("SAFETY_VIOLATION");
    await expect(executor.listTree({ directoryId: "media_root" })).rejects.toThrow("SAFETY_VIOLATION");
    // The 115 root cid "0" is always protected.
    await expect(executor.listUnparsedVideoFiles("0")).rejects.toThrow("SAFETY_VIOLATION");
  });

  it("transfers a selected 115 candidate and verifies newly materialized video files", async () => {
    const api = new FakePan115Api({
      shareFiles: {
        abc123: [
          {
            fid: "file_1",
            n: "Show.S01E01.mkv",
            s: "1000000000",
          },
        ],
      },
    });
    const executor = new Storage115Executor({ api });

    const attempt = await executor.transfer({
      workflowRunId: "run_1",
      directoryId: "123",
      candidate: candidateFixture({
        type: "115",
        providerPayload: {
          url: "https://115.com/s/abc123?password=pw",
          rawType: "115",
        },
      }),
    });

    expect(api.receivedShares).toEqual([
      {
        shareCode: "abc123",
        receiveCode: "pw",
        directoryId: "123",
      },
    ]);
    expect(attempt).toMatchObject({
      // Run-scoped id so it can't collide across runs/process restarts on the
      // global transfer_attempts.id primary key.
      id: "run_1_transfer_1",
      workflowRunId: "run_1",
      candidateId: "candidate_1",
      status: "succeeded",
      providerMessage: "",
      materializedFileIds: ["file_1"],
    });
    await expect(executor.listVideoFiles("123")).resolves.toEqual([
      {
        id: "file_1",
        storageDirectoryId: "123",
        name: "Show.S01E01.mkv",
        sizeBytes: 1_000_000_000,
        episodeCode: "S01E01",
        providerFileId: "file_1",
      },
    ]);
  });

  it("lists video files by media extension, not by episode wildcard", async () => {
    // A movie file has no SxxExx/第N集 code but is still a real video. Detection
    // must key off the media extension; the episode code is optional metadata.
    const api = new FakePan115Api({
      directories: {
        movie_dir: [
          { fid: "movie_v", n: "奥本海默 (2023).mkv", s: "28000000000" },
          { fid: "ep_v", n: "Show.S01E03.mkv", s: "1000000000" },
          { fid: "note_f", n: "readme.txt", s: "1024" },
        ],
      },
    });
    const executor = new Storage115Executor({ api });

    const files = await executor.listVideoFiles("movie_dir");

    expect(files).toEqual([
      {
        id: "movie_v",
        storageDirectoryId: "movie_dir",
        name: "奥本海默 (2023).mkv",
        sizeBytes: 28_000_000_000,
        episodeCode: null,
        providerFileId: "movie_v",
      },
      {
        id: "ep_v",
        storageDirectoryId: "movie_dir",
        name: "Show.S01E03.mkv",
        sizeBytes: 1_000_000_000,
        episodeCode: "S01E03",
        providerFileId: "ep_v",
      },
    ]);
  });

  it("records duplicate 115 transfers as no target change", async () => {
    const api = new FakePan115Api({
      receiveShareResults: {
        abc123: {
          ok: false,
          message: "资源已转存过(可能在其他目录)，目标目录未新增文件",
          alreadyTransferred: true,
        },
      },
    });
    const executor = new Storage115Executor({ api });

    const attempt = await executor.transfer({
      workflowRunId: "run_1",
      directoryId: "123",
      candidate: candidateFixture({
        type: "115",
        providerPayload: {
          url: "https://115.com/s/abc123?password=pw",
          rawType: "115",
        },
      }),
    });

    expect(attempt).toMatchObject({
      candidateId: "candidate_1",
      status: "no_target_change",
      providerMessage: "资源已转存过(可能在其他目录)，目标目录未新增文件",
      materializedFileIds: [],
    });
  });

  it("removes an ephemeral sub-directory (e.g. staging) via 115 delete", async () => {
    const api = new FakePan115Api();
    const executor = new Storage115Executor({ api, writeScopeDirectoryIds: [] });

    const result = await executor.removeDirectory("staging_run_movie_p1");

    expect(result).toEqual({ removed: true });
    expect(api.deletes).toEqual([{ fileIds: ["staging_run_movie_p1"] }]);
  });

  it("refuses to remove a protected/root directory", async () => {
    const api = new FakePan115Api();
    const executor = new Storage115Executor({ api, protectedDirectoryIds: ["tv_root"] });

    await expect(executor.removeDirectory("tv_root")).rejects.toThrow("SAFETY_VIOLATION");
    expect(api.deletes).toEqual([]);
  });

  it("adds magnet candidates as offline tasks through 115", async () => {
    const api = new FakePan115Api();
    const executor = new Storage115Executor({ api, offlineMaterializeAttempts: 0 });

    const attempt = await executor.transfer({
      workflowRunId: "run_1",
      directoryId: "123",
      candidate: candidateFixture({
        type: "magnet",
        providerPayload: {
          url: "magnet:?xt=urn:btih:abcdef",
          rawType: "magnet",
        },
      }),
    });

    expect(api.offlineTasks).toEqual([
      {
        url: "magnet:?xt=urn:btih:abcdef",
        directoryId: "123",
      },
    ]);
    expect(attempt).toMatchObject({
      status: "no_target_change",
      providerMessage: "offline task accepted; no target video materialized yet",
      materializedFileIds: [],
    });
  });

  it("briefly confirms an offline task's 秒传 before judging it materialized", async () => {
    const api = new FakePan115Api();
    // A 秒传 hit (115 already has the resource cached) reflects a beat after the
    // task is accepted — the video appears on the second list. The short
    // confirmation window catches it without waiting on a real download.
    let graceWaits = 0;
    const executor = new Storage115Executor({
      api,
      apiGuardOptions: { minDelayMs: 0 },
      offlineMaterializeAttempts: 3,
      offlineMaterializePollMs: 25,
      sleep: async () => {
        graceWaits += 1;
        if (graceWaits === 2) {
          api.directories["123"] = [
            { fid: "magnet_v", n: "Movie.2023.2160p.mkv", s: "8000000000" },
          ];
        }
      },
    });

    await executor.transfer({
      workflowRunId: "run_magnet",
      directoryId: "123",
      candidate: candidateFixture({
        type: "magnet",
        providerPayload: {
          url: "magnet:?xt=urn:btih:abcdef",
          rawType: "magnet",
        },
      }),
    });

    // It confirmed across the short window — did not give up on the first
    // (empty) check, and stopped as soon as the 秒传'd video appeared.
    expect(graceWaits).toBe(2);
    // The video is now in the staging tree, so the workflow's subsequent
    // listTree scan finds it (a movie file has no episode code, so the probe is
    // extension-based, not episode-based).
    const tree = await executor.listTree({ directoryId: "123" });
    expect(tree.map((file) => file.path)).toContain("Movie.2023.2160p.mkv");
    // It 秒传'd, so the queued task is real — do NOT cancel it.
    expect(api.removedOfflineHashes).toEqual([]);
  });

  it("the DEFAULT 秒传 window reaches past the old 2-poll span (a ~late-landing 秒传 is still caught)", async () => {
    // A real-115 survey measured live 秒传s landing at up to ~4.3s — past the old
    // 2×2s window. The default must now span ~8s (4 polls) or ~20% of good magnets
    // would be mis-judged dead. Here the video only appears on the 3rd grace wait,
    // which the old default (2) would have missed and cancelled.
    const api = new FakePan115Api();
    let graceWaits = 0;
    const executor = new Storage115Executor({
      api,
      apiGuardOptions: { minDelayMs: 0 },
      // NB: offlineMaterializeAttempts intentionally NOT set — exercise the default.
      offlineMaterializePollMs: 1,
      sleep: async () => {
        graceWaits += 1;
        if (graceWaits === 3) {
          api.directories["123"] = [{ fid: "late_v", n: "Movie.2160p.mkv", s: "9000000000" }];
        }
      },
    });

    const attempt = await executor.transfer({
      workflowRunId: "run_late_miaochuan",
      directoryId: "123",
      candidate: candidateFixture({ type: "magnet", providerPayload: { url: "magnet:?xt=urn:btih:abcdef", rawType: "magnet" } }),
    });

    expect(attempt.status).toBe("succeeded");
    expect(attempt.materializedFileIds).toEqual(["late_v"]);
    expect(api.removedOfflineHashes).toEqual([]); // caught in time → not cancelled
  });

  it("lists nested subdirectories recursively (the flatten wrapper-dir source)", async () => {
    const api = new FakePan115Api({
      directories: {
        staging: [{ isDirectory: true, cid: "wrap", n: "[Grp] Show S01" }],
        wrap: [
          { isDirectory: true, cid: "inner", n: "Extras" },
          { fid: "f1", n: "Show - 01.mkv", s: "9" },
        ],
        inner: [{ fid: "f2", n: "NCOP.mkv", s: "1" }],
      },
    });
    const executor = new Storage115Executor({ api });

    const subdirs = await executor.listSubdirectories({ directoryId: "staging" });

    expect(subdirs).toEqual([
      { id: "wrap", path: "[Grp] Show S01" },
      { id: "inner", path: "[Grp] Show S01/Extras" },
    ]);
  });

  it("cancels a non-秒传 offline task so it does not drain the quota", async () => {
    const api = new FakePan115Api();
    // Nothing materializes in the grace window → 115 has no cached copy → the
    // queued download is junk and must be canceled by its info_hash.
    const executor = new Storage115Executor({ api, offlineMaterializeAttempts: 0 });

    const attempt = await executor.transfer({
      workflowRunId: "run_junk",
      directoryId: "123",
      candidate: candidateFixture({
        type: "magnet",
        providerPayload: {
          url: "magnet:?xt=urn:btih:57E6D442793C87D7F81EECC675AB4EB3B4925BD3&dn=junk",
          rawType: "magnet",
        },
      }),
    });

    expect(attempt.status).toBe("no_target_change");
    expect(api.removedOfflineHashes).toEqual([
      "57e6d442793c87d7f81eecc675ab4eb3b4925bd3",
    ]);
  });

  it("does NOT cancel an offline task 115 refused as a duplicate (任务已存在)", async () => {
    const api = new FakePan115Api();
    // 115 rejecting a duplicate ("任务已存在") is anti-spam, not a junk resource —
    // it may be a prior good task we must not kill.
    api.addOfflineTask = async (input) => {
      api.offlineTasks.push({ ...input });
      return { ok: true, alreadyTransferred: true, message: "任务已存在" };
    };
    const executor = new Storage115Executor({ api, offlineMaterializeAttempts: 0 });

    const attempt = await executor.transfer({
      workflowRunId: "run_dup",
      directoryId: "123",
      candidate: candidateFixture({
        type: "magnet",
        providerPayload: {
          url: "magnet:?xt=urn:btih:57E6D442793C87D7F81EECC675AB4EB3B4925BD3",
          rawType: "magnet",
        },
      }),
    });

    expect(attempt.status).toBe("no_target_change");
    expect(api.removedOfflineHashes).toEqual([]);
  });

  it("does not cancel an offline task 115 reports as a 秒传 via statusText 下载成功, percentDone stuck at 0 (file listing lags)", async () => {
    const hash = "57e6d442793c87d7f81eecc675ab4eb3b4925bd3";
    // REAL 115 shape (measured on the test root): a 秒传 reports statusText
    // "下载成功" while percentDone STAYS 0 the whole time — the file is merely slow
    // to list. A percentDone>=100 check would NEVER recognize it and would cancel
    // this good 秒传; reading statusText prevents that.
    const api = new FakePan115Api({
      offlineTaskList: [
        { infoHash: hash, name: "Movie", percentDone: 0, status: 1, statusText: "下载成功", url: "" },
      ],
    });
    const executor = new Storage115Executor({
      api,
      offlineMaterializeAttempts: 2,
      offlineMaterializePollMs: 1,
      sleep: async () => {},
    });

    const attempt = await executor.transfer({
      workflowRunId: "run_slow_miaochuan",
      directoryId: "123",
      candidate: candidateFixture({
        type: "magnet",
        providerPayload: { url: `magnet:?xt=urn:btih:${hash.toUpperCase()}`, rawType: "magnet" },
      }),
    });

    expect(attempt.status).toBe("no_target_change");
    expect(api.removedOfflineHashes).toEqual([]); // the 秒传 was kept (NOT cancelled)
    expect(api.listOfflineTasksCalls).toBeGreaterThan(0); // status was actually read
    // The attempt carries the ALIVE signal so the dead-link recorder (#15) never
    // poisons this confirmed-but-lagging 秒传.
    expect(attempt.providerMessage).toMatch(/下载成功|秒传 confirmed/);
  });

  it("cancels an offline task stuck 等待中 (no cache, percentDone 0 — the dead-magnet signature)", async () => {
    const hash = "57e6d442793c87d7f81eecc675ab4eb3b4925bd3";
    // REAL dead/no-cache shape: 115 accepts the magnet but the task sits at
    // statusText "等待中" with percentDone 0 forever. We never wait on a real
    // download, so it is dead-for-us → cancel it.
    const api = new FakePan115Api({
      offlineTaskList: [
        { infoHash: hash, name: "Movie", percentDone: 0, status: 1, statusText: "等待中", url: "" },
      ],
    });
    const executor = new Storage115Executor({
      api,
      offlineMaterializeAttempts: 2,
      offlineMaterializePollMs: 1,
      sleep: async () => {},
    });

    const attempt = await executor.transfer({
      workflowRunId: "run_stuck_waiting",
      directoryId: "123",
      candidate: candidateFixture({
        type: "magnet",
        providerPayload: { url: `magnet:?xt=urn:btih:${hash}`, rawType: "magnet" },
      }),
    });

    expect(attempt.status).toBe("no_target_change");
    expect(api.removedOfflineHashes).toEqual([hash]); // stuck 等待中 → cancelled
  });

  it("flags an unresolvable magnet (offline-task name == infohash → no metadata, fake/dead)", async () => {
    const hash = "57e6d442793c87d7f81eecc675ab4eb3b4925bd3";
    // 115 accepted a fake/non-existent magnet but resolved NO metadata, so it shows
    // the raw infohash as the task name. Measured on the real test root.
    const api = new FakePan115Api({
      offlineTaskList: [{ infoHash: hash, name: hash, percentDone: 0, status: 1, statusText: "等待中", url: "" }],
    });
    const executor = new Storage115Executor({ api, offlineMaterializeAttempts: 2, offlineMaterializePollMs: 1, sleep: async () => {} });

    const attempt = await executor.transfer({
      workflowRunId: "run_unresolved",
      directoryId: "123",
      candidate: candidateFixture({ type: "magnet", providerPayload: { url: `magnet:?xt=urn:btih:${hash}`, rawType: "magnet" } }),
    });

    expect(attempt.status).toBe("no_target_change");
    expect(api.removedOfflineHashes).toEqual([hash]); // still cancelled (frees quota)
    // The attempt carries the signal the dead-link recorder uses to pick a longer TTL.
    expect(attempt.providerMessage).toMatch(/name == infohash/);
  });

  it("cancels an offline task that task status shows still downloading (not 秒传)", async () => {
    const hash = "57e6d442793c87d7f81eecc675ab4eb3b4925bd3";
    const api = new FakePan115Api({
      offlineTaskList: [
        { infoHash: hash, name: "Movie", percentDone: 12, status: 2, statusText: "下载中", url: "" },
      ],
    });
    const executor = new Storage115Executor({
      api,
      offlineMaterializeAttempts: 2,
      offlineMaterializePollMs: 1,
      sleep: async () => {},
    });

    const attempt = await executor.transfer({
      workflowRunId: "run_real_dl",
      directoryId: "123",
      candidate: candidateFixture({
        type: "magnet",
        providerPayload: { url: `magnet:?xt=urn:btih:${hash}`, rawType: "magnet" },
      }),
    });

    expect(attempt.status).toBe("no_target_change");
    expect(api.removedOfflineHashes).toEqual([hash]); // in-flight download → cancelled
  });

  it("rejects flattening protected directories", async () => {
    const executor = new Storage115Executor({
      api: new FakePan115Api(),
      protectedDirectoryIds: ["0", "tv_root"],
    });

    await expect(executor.flattenDirectory("tv_root")).rejects.toThrow(
      "SAFETY_VIOLATION: refusing to flatten protected directory cid=tv_root",
    );
  });

  it("caps recursive video collection so a deep tree can't fan out unbounded listItems", async () => {
    // A pathological chain deeper than the cap (6): a video sits beyond the
    // limit and must NOT be collected, and the walk must NOT keep issuing
    // listItems past it — otherwise a corrupt/adversarial tree could trip 风控.
    const api = new FakePan115Api({
      directories: {
        deep_root: [
          { fid: "v_shallow", n: "Show.S01E01.mkv", s: "1000000000" },
          { cid: "lvl2", n: "L2", fc: "0" },
        ],
        lvl2: [{ cid: "lvl3", n: "L3", fc: "0" }],
        lvl3: [{ cid: "lvl4", n: "L4", fc: "0" }],
        lvl4: [{ cid: "lvl5", n: "L5", fc: "0" }],
        lvl5: [{ cid: "lvl6", n: "L6", fc: "0" }],
        lvl6: [{ cid: "lvl7", n: "L7", fc: "0" }],
        lvl7: [{ fid: "v_deep", n: "Show.S01E09.mkv", s: "1000000000" }],
      },
      directoryInfo: {
        deep_root: {
          state: true,
          path: [
            { cid: "0", name: "root" },
            { cid: "tv_root", name: "TV Shows" },
            { cid: "deep_root", name: "Season 1" },
          ],
        },
      },
    });
    const executor = new Storage115Executor({ api, protectedDirectoryIds: ["0", "tv_root"] });

    const videos = await executor.listVideoFiles("deep_root");

    // The shallow video is collected; the one beyond the depth cap is not.
    expect(videos.map((video) => video.name)).toContain("Show.S01E01.mkv");
    expect(videos.map((video) => video.name)).not.toContain("Show.S01E09.mkv");
    // The walk stopped at the cap — it never listed the directory past it.
    expect(api.listCalls).not.toContain("lvl7");
  });

  it("moves nested videos to a safe season leaf and removes empty child folders", async () => {
    const api = new FakePan115Api({
      directories: {
        season_1: [
          {
            cid: "nested_1",
            n: "Pack",
            fc: "0",
          },
        ],
        nested_1: [
          {
            fid: "nested_file_1",
            n: "Show.S01E02.mkv",
            s: "2000000000",
          },
        ],
      },
      directoryInfo: {
        season_1: {
          state: true,
          path: [
            { cid: "0", name: "root" },
            { cid: "tv_root", name: "TV Shows" },
            { cid: "show_1", name: "Show" },
            { cid: "season_1", name: "Season 1" },
          ],
        },
      },
    });
    const executor = new Storage115Executor({ api, protectedDirectoryIds: ["0", "tv_root"] });

    const result = await executor.flattenDirectory("season_1");

    expect(api.moves).toEqual([
      {
        fileIds: ["nested_file_1"],
        targetDirectoryId: "season_1",
      },
    ]);
    expect(api.deletes).toEqual([
      {
        fileIds: ["nested_1"],
      },
    ]);
    expect(result).toEqual({
      moved: ["nested_file_1"],
      removed: ["nested_1"],
    });
  });

  it("allows transfers when the target directory is inside the configured write scope", async () => {
    const api = new FakePan115Api({
      shareFiles: {
        abc123: [
          {
            fid: "file_1",
            n: "Show.S01E01.mkv",
            s: "1000000000",
          },
        ],
      },
      directoryInfo: {
        season_1: seasonPathInfo("test_root", "season_1"),
      },
    });
    const executor = new Storage115Executor({ api, writeScopeDirectoryIds: ["test_root"] });

    const attempt = await executor.transfer({
      workflowRunId: "run_1",
      directoryId: "season_1",
      candidate: candidateFixture({
        type: "115",
        providerPayload: {
          url: "https://115.com/s/abc123?password=pw",
          rawType: "115",
        },
      }),
    });

    expect(attempt.status).toBe("succeeded");
    expect(api.receivedShares).toHaveLength(1);
  });

  it("rejects transfers outside the configured write scope before touching the target", async () => {
    const api = new FakePan115Api({
      shareFiles: {
        abc123: [
          {
            fid: "file_1",
            n: "Show.S01E01.mkv",
            s: "1000000000",
          },
        ],
      },
      directoryInfo: {
        outside_season: seasonPathInfo("other_root", "outside_season"),
      },
    });
    const executor = new Storage115Executor({ api, writeScopeDirectoryIds: ["test_root"] });

    await expect(
      executor.transfer({
        workflowRunId: "run_1",
        directoryId: "outside_season",
        candidate: candidateFixture({
          type: "115",
          providerPayload: {
            url: "https://115.com/s/abc123?password=pw",
            rawType: "115",
          },
        }),
      }),
    ).rejects.toThrow("WRITE_SCOPE_VIOLATION");
    expect(api.listCalls).toEqual([]);
    expect(api.receivedShares).toEqual([]);
  });

  it("rejects delete operations outside the configured write scope", async () => {
    const api = new FakePan115Api({
      directoryInfo: {
        outside_season: seasonPathInfo("other_root", "outside_season"),
      },
    });
    const executor = new Storage115Executor({ api, writeScopeDirectoryIds: ["test_root"] });

    await expect(
      executor.deleteFiles({
        directoryId: "outside_season",
        fileIds: ["file_1"],
      }),
    ).rejects.toThrow("WRITE_SCOPE_VIOLATION");
    expect(api.deletes).toEqual([]);
  });

  it("deletes only file ids verified inside the target directory", async () => {
    const api = new FakePan115Api({
      directories: {
        season_1: [
          {
            fid: "file_1",
            n: "Show.S01E01.mkv",
            s: "1000000000",
          },
        ],
      },
      directoryInfo: {
        season_1: seasonPathInfo("test_root", "season_1"),
      },
    });
    const executor = new Storage115Executor({ api, writeScopeDirectoryIds: ["test_root"] });

    await expect(
      executor.deleteFiles({
        directoryId: "season_1",
        fileIds: ["file_1"],
      }),
    ).resolves.toEqual({ deleted: ["file_1"] });
    expect(api.deletes).toEqual([{ fileIds: ["file_1"] }]);
  });

  it("deletes a subtitle (non-video) file — cleanup must verify against ALL files, not just videos (光鸭 e2e 2026-07-02 暴露的跨盘缺陷)", async () => {
    const api = new FakePan115Api({
      directories: {
        season_1: [
          {
            fid: "sub_1",
            n: "多余字幕.srt",
            s: "88753",
          },
        ],
      },
      directoryInfo: {
        season_1: seasonPathInfo("test_root", "season_1"),
      },
    });
    const executor = new Storage115Executor({ api, writeScopeDirectoryIds: ["test_root"] });

    await expect(
      executor.deleteFiles({
        directoryId: "season_1",
        fileIds: ["sub_1"],
      }),
    ).resolves.toEqual({ deleted: ["sub_1"] });
    expect(api.deletes).toEqual([{ fileIds: ["sub_1"] }]);
  });

  it("rejects delete file ids that were not verified in the target directory", async () => {
    const api = new FakePan115Api({
      directories: {
        season_1: [
          {
            fid: "file_1",
            n: "Show.S01E01.mkv",
            s: "1000000000",
          },
        ],
      },
      directoryInfo: {
        season_1: seasonPathInfo("test_root", "season_1"),
      },
    });
    const executor = new Storage115Executor({ api, writeScopeDirectoryIds: ["test_root"] });

    await expect(
      executor.deleteFiles({
        directoryId: "season_1",
        fileIds: ["file_2"],
      }),
    ).rejects.toThrow("SAFETY_VIOLATION: refusing to delete unverified file ids");
    expect(api.deletes).toEqual([]);
  });

  it("allows creating folders only under the configured write scope", async () => {
    const api = new FakePan115Api({
      directoryInfo: {
        outside_parent: seasonPathInfo("other_root", "outside_parent"),
      },
    });
    const executor = new Storage115Executor({ api, writeScopeDirectoryIds: ["test_root"] });

    await expect(
      executor.createDirectory({
        name: "media-track-smoke",
        parentId: "outside_parent",
      }),
    ).rejects.toThrow("WRITE_SCOPE_VIOLATION");

    await expect(
      executor.createDirectory({
        name: "media-track-smoke",
        parentId: "test_root",
      }),
    ).resolves.toContain("test_root_media-track-smoke");
  });

  it("spaces 115 API calls through the configured guard", async () => {
    const api = new FakePan115Api({
      shareFiles: {
        abc123: [
          {
            fid: "file_1",
            n: "Show.S01E01.mkv",
            s: "1000000000",
          },
        ],
      },
    });
    let now = 0;
    const sleeps: number[] = [];
    const guard = new Pan115ApiGuard({
      minDelayMs: 750,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    const executor = new Storage115Executor({ api, apiGuard: guard });

    await executor.transfer({
      workflowRunId: "run_1",
      directoryId: "123",
      candidate: candidateFixture({
        type: "115",
        providerPayload: {
          url: "https://115.com/s/abc123?password=pw",
          rawType: "115",
        },
      }),
    });

    expect(api.listCalls).toEqual(["123", "123"]);
    expect(api.receivedShares).toHaveLength(1);
    expect(sleeps).toEqual([750, 750]);
  });

  it("opens a circuit breaker when 115 returns a risk-control signal", async () => {
    const api = new FakePan115Api({
      receiveShareResults: {
        abc123: {
          ok: false,
          message: "请求过于频繁，请稍后再试",
          code: 429,
        },
      },
    });
    const events: string[] = [];
    const guard = new Pan115ApiGuard({
      onEvent: (event) => events.push(event.kind),
    });
    const executor = new Storage115Executor({ api, apiGuard: guard });

    await expect(
      executor.transfer({
        workflowRunId: "run_1",
        directoryId: "123",
        candidate: candidateFixture({
          type: "115",
          providerPayload: {
            url: "https://115.com/s/abc123?password=pw",
            rawType: "115",
          },
        }),
      }),
    ).rejects.toBeInstanceOf(Pan115RiskControlError);

    await expect(executor.listVideoFiles("123")).rejects.toThrow("circuit breaker open");
    expect(api.listCalls).toEqual(["123"]);
    expect(events).toContain("risk_detected");
    expect(events).toContain("circuit_open");
  });

  it("stops before exceeding the configured 115 API call budget", async () => {
    const api = new FakePan115Api({
      shareFiles: {
        abc123: [
          {
            fid: "file_1",
            n: "Show.S01E01.mkv",
            s: "1000000000",
          },
        ],
      },
    });
    const guard = new Pan115ApiGuard({ maxCallsPerOperation: 2 });
    const executor = new Storage115Executor({ api, apiGuard: guard });

    await expect(
      executor.transfer({
        workflowRunId: "run_1",
        directoryId: "123",
        candidate: candidateFixture({
          type: "115",
          providerPayload: {
            url: "https://115.com/s/abc123?password=pw",
            rawType: "115",
          },
        }),
      }),
    ).rejects.toThrow("API call budget exhausted");
    expect(api.listCalls).toEqual(["123"]);
    expect(api.receivedShares).toHaveLength(1);
  });

  it("reads guard budget overrides from the environment", async () => {
    const api = new FakePan115Api({
      directories: { season_1: [] },
      directoryInfo: {
        season_1: seasonPathInfo("test_root", "season_1"),
      },
    });
    const executor = createProtectedStorage115Executor({
      api,
      env: {
        MEDIA_TRACK_115_TEST_ROOT_CID: "test_root",
        MEDIA_TRACK_115_MAX_API_CALLS: "2",
        MEDIA_TRACK_115_MIN_DELAY_MS: "1",
      },
    });

    await executor.listVideoFiles("season_1");
    await executor.listVideoFiles("season_1");
    await expect(executor.listVideoFiles("season_1")).rejects.toThrow(
      "maxCallsPerOperation=2",
    );
  });

  it("rejects malformed guard budget environment values", () => {
    expect(() =>
      createProtectedStorage115Executor({
        api: new FakePan115Api(),
        env: {
          MEDIA_TRACK_115_TEST_ROOT_CID: "test_root",
          MEDIA_TRACK_115_MAX_API_CALLS: "many",
        },
      }),
    ).toThrow("MEDIA_TRACK_115_GUARD_OPTION_INVALID");
  });

  it("stops scanning when a list response is too large for the guard policy", async () => {
    const api = new FakePan115Api({
      directories: {
        big: Array.from({ length: 231 }, (_, index) => ({
          fid: `file_${index}`,
          n: `NonVideo.${index}.txt`,
          s: "100",
        })),
      },
    });
    const guard = new Pan115ApiGuard({ maxListItemsPerResponse: 230 });
    const executor = new Storage115Executor({ api, apiGuard: guard });

    await expect(executor.listVideoFiles("big")).rejects.toThrow(
      "listItems returned 231 items, above maxListItemsPerResponse=230",
    );
    await expect(executor.listVideoFiles("big")).rejects.toThrow("circuit breaker open");
    expect(api.listCalls).toEqual(["big"]);
  });
});

describe("Storage115Executor.transferSubtitleUrl", () => {
  it("createProtectedStorage115Executor passes the subtitle window options through (tuning must not be silently ignored)", async () => {
    // Target a staging SUBDIR inside the write scope — the scope root itself is
    // (correctly) protected from recursive listing.
    const api = new FakePan115Api({
      directories: { sub_stage: [] },
      directoryInfo: { sub_stage: seasonPathInfo("test_root", "sub_stage") },
    });
    let listCalls = 0;
    api.addOfflineTask = async () => ({ ok: true, message: "accepted" });
    const origList = api.listItems.bind(api);
    api.listItems = async (input) => {
      listCalls += 1;
      // Listing #1 is the BEFORE-snapshot; the tuned window (1) polls exactly once
      // (listing #2). Landing on listing #3 is inside the DEFAULT window (8) but
      // outside the tuned one — if the factory drops the tuning, this sees succeeded.
      if (listCalls === 3) {
        api.directories["sub_stage"] = [{ fid: "late_sub", n: "Tuned.S01E01.ass", s: "40KB" }];
      }
      return origList(input);
    };
    const executor = createProtectedStorage115Executor({
      api,
      env: { MEDIA_TRACK_115_TEST_ROOT_CID: "test_root" },
      apiGuardOptions: { minDelayMs: 0 },
      subtitleMaterializeAttempts: 1,
      subtitleMaterializePollMs: 1,
      sleep: async () => {},
    });

    const attempt = await executor.transferSubtitleUrl!({
      url: "http://file0.assrt.net/onthefly/1/Tuned.S01E01.ass",
      filename: "Tuned.S01E01.ass",
      directoryId: "sub_stage",
      workflowRunId: "run-test",
    });

    expect(attempt.status).toBe("no_target_change");
  });

  it("uses a subtitle-specific materialization window wider than the video default (live e2e: real assrt landings took ~60s, video window is 4x2s)", async () => {
    const api = new FakePan115Api({ directories: { stage: [] } });
    let listCalls = 0;
    api.addOfflineTask = async () => ({ ok: true, message: "accepted" });
    const origList = api.listItems.bind(api);
    api.listItems = async (input) => {
      listCalls += 1;
      // The file materializes only on the 6th listing — beyond the video window
      // (4 attempts) but inside the subtitle window.
      if (listCalls === 6) {
        api.directories["stage"] = [{ fid: "late_sub", n: "Late.S01E01.ass", s: "40KB" }];
      }
      return origList(input);
    };
    const executor = new Storage115Executor({ api, sleep: async () => {} });

    const attempt = await executor.transferSubtitleUrl!({
      url: "http://file0.assrt.net/onthefly/1/Late.S01E01.ass",
      filename: "Late.S01E01.ass",
      directoryId: "stage",
      workflowRunId: "run-test",
    });

    expect(attempt.status).toBe("succeeded");
    expect(attempt.materializedFileIds).toEqual(["late_sub"]);
  });

  it("does NOT claim a pre-existing same-named file — only a file that APPEARS after submission counts", async () => {
    const api = new FakePan115Api({
      directories: { stage: [{ fid: "old_leftover", n: "Show.S01E01.ass", s: "1KB" }] },
    });
    api.addOfflineTask = async () => ({ ok: true, message: "accepted" }); // lands nothing new
    const executor = new Storage115Executor({
      api,
      subtitleMaterializeAttempts: 1,
      subtitleMaterializePollMs: 1,
      sleep: async () => {},
    });

    const attempt = await executor.transferSubtitleUrl!({
      url: "http://file0.assrt.net/onthefly/1/Show.S01E01.ass",
      filename: "Show.S01E01.ass",
      directoryId: "stage",
      workflowRunId: "run-test",
    });

    expect(attempt.status).toBe("no_target_change");
    expect(attempt.materializedFileIds).toEqual([]);
  });

  it("guard-rejected invalid filenames consume attempt numbers — ids never collide", async () => {
    const api = new FakePan115Api({ directories: { stage: [] } });
    const executor = new Storage115Executor({ api });

    const a = await executor.transferSubtitleUrl!({ url: "http://x/a.ass", filename: "a/b.ass", directoryId: "stage", workflowRunId: "run-test" });
    const b = await executor.transferSubtitleUrl!({ url: "http://x/c.ass", filename: "c\\d.ass", directoryId: "stage", workflowRunId: "run-test" });

    expect(a.status).toBe("failed");
    expect(b.status).toBe("failed");
    expect(a.id).not.toBe(b.id);
    expect(a.candidateId).not.toBe(b.candidateId);
    expect(a.candidateId).not.toContain("/"); // raw filename kept OUT of the id
  });

  it("rejects a filename containing path separators at the boundary (zero API calls)", async () => {
    const api = new FakePan115Api({ directories: { stage: [] } });
    let offlineCalls = 0;
    api.addOfflineTask = async () => {
      offlineCalls += 1;
      return { ok: true, message: "accepted" };
    };
    const executor = new Storage115Executor({ api });

    const attempt = await executor.transferSubtitleUrl!({
      url: "http://file0.assrt.net/onthefly/1/evil.ass",
      filename: "subdir/evil.ass",
      directoryId: "stage",
      workflowRunId: "run-test",
    });

    expect(attempt.status).toBe("failed");
    expect(attempt.providerMessage).toMatch(/path separator|路径分隔/i);
    expect(attempt.materializedFileIds).toEqual([]);
    expect(offlineCalls).toBe(0);
  });

  it("submits an offline task with the subtitle url, then confirms landing via listTree by filename", async () => {
    const api = new FakePan115Api({
      directories: { stage: [] },
    });
    const SUBTITLE_FILENAME = "Breaking.Bad.S02E01.ass";
    api.addOfflineTask = async (input) => {
      api.directories[input.directoryId] = [
        ...(api.directories[input.directoryId] ?? []),
        { fid: `sub_${input.url.slice(-6)}`, n: SUBTITLE_FILENAME, s: "718KB" },
      ];
      return { ok: true, message: "offline task accepted" };
    };
    const executor = new Storage115Executor({ api });

    const attempt = await executor.transferSubtitleUrl!({
      url: "http://file0.assrt.net/onthefly/713570/-/1/Breaking.Bad.S02E01.ass?api=1",
      filename: SUBTITLE_FILENAME,
      directoryId: "stage",
      workflowRunId: "run-test",
    });

    expect(attempt.status).toBe("succeeded");
    expect(attempt.materializedFileIds.length).toBe(1);
    expect(attempt.providerMessage).toBe("");
  });

  it("reports failed when addOfflineTask returns ok:false (e.g. dead link)", async () => {
    const api = new FakePan115Api({ directories: { stage: [] } });
    api.addOfflineTask = async () => ({ ok: false, message: "invalid url" });
    const executor = new Storage115Executor({ api });

    const attempt = await executor.transferSubtitleUrl!({
      url: "http://file0.assrt.net/dead.zip",
      filename: "dead.ass",
      directoryId: "stage",
      workflowRunId: "run-test",
    });

    expect(attempt.status).toBe("failed");
    expect(attempt.providerMessage).toContain("invalid url");
    expect(attempt.materializedFileIds).toEqual([]);
  });

  it("reports no_target_change when the file never appears in listTree", async () => {
    const api = new FakePan115Api({ directories: { stage: [] } });
    api.addOfflineTask = async () => ({ ok: true, message: "accepted" });
    const executor = new Storage115Executor({
      api,
      subtitleMaterializeAttempts: 1,
      subtitleMaterializePollMs: 1,
      sleep: async () => {},
    });

    const attempt = await executor.transferSubtitleUrl!({
      url: "http://file0.assrt.net/onthefly/slow.ass",
      filename: "slow.ass",
      directoryId: "stage",
      workflowRunId: "run-test",
    });

    expect(attempt.status).toBe("no_target_change");
    expect(attempt.materializedFileIds).toEqual([]);
  });

  it("best-effort cancels the in-flight offline task on no_target_change (frees quota, prevents late drop)", async () => {
    const SUBTITLE_URL = "http://file0.assrt.net/onthefly/never-lands.ass";
    const api = new FakePan115Api({
      directories: { stage: [] },
      offlineTaskList: [
        { infoHash: "hash-abc", name: "never-lands.ass", percentDone: 0, status: 1, statusText: "downloading", url: SUBTITLE_URL },
      ],
    });
    api.addOfflineTask = async () => ({ ok: true, message: "accepted" });
    const executor = new Storage115Executor({
      api,
      subtitleMaterializeAttempts: 1,
      subtitleMaterializePollMs: 1,
      sleep: async () => {},
    });

    const attempt = await executor.transferSubtitleUrl!({
      url: SUBTITLE_URL,
      filename: "never-lands.ass",
      directoryId: "stage",
      workflowRunId: "run-test",
    });

    expect(attempt.status).toBe("no_target_change");
    expect(api.removedOfflineHashes).toContain("hash-abc"); // the queued task was cancelled by its infoHash
  });

  it("assigns DISTINCT attempt ids across a succeed-then-fail sequence on one executor (no transfer_attempts PK collision)", async () => {
    // A multi-file subtitle package loops transferSubtitleUrl per file on the SAME
    // executor instance. A succeeded call followed by a failed call must NOT reuse
    // the same attempt id — otherwise both attempts collide on the transfer_attempts
    // primary key and the run's single-transaction persist rolls back, losing the
    // video's obtained marks (a subtitle failure blocking the video).
    const api = new FakePan115Api({ directories: { stage: [] } });
    let call = 0;
    api.addOfflineTask = async (input) => {
      call += 1;
      if (call === 1) {
        api.directories[input.directoryId] = [
          ...(api.directories[input.directoryId] ?? []),
          { fid: "sub_ok", n: "Show.S01E01.ass", s: "700KB" },
        ];
        return { ok: true, message: "offline task accepted" };
      }
      return { ok: false, message: "invalid url" };
    };
    const executor = new Storage115Executor({ api });

    const first = await executor.transferSubtitleUrl!({
      url: "http://file0.assrt.net/onthefly/1/Show.S01E01.ass",
      filename: "Show.S01E01.ass",
      directoryId: "stage",
      workflowRunId: "run-collide",
    });
    const second = await executor.transferSubtitleUrl!({
      url: "http://file0.assrt.net/dead.ass",
      filename: "Show.S01E02.ass",
      directoryId: "stage",
      workflowRunId: "run-collide",
    });

    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("failed");
    expect(first.id).not.toBe(second.id); // distinct ids — no PK collision
  });
});

class FakePan115Api implements Pan115StorageApi {
  readonly directories: Record<string, Pan115Item[]>;
  readonly shareFiles: Record<string, Pan115Item[]>;
  readonly receiveShareResults: Record<string, Pan115ActionResult>;
  readonly directoryInfo: Record<string, Pan115DirectoryInfo>;
  readonly receivedShares: Array<{ shareCode: string; receiveCode: string; directoryId: string }> = [];
  readonly offlineTasks: Array<{ url: string; directoryId: string }> = [];
  readonly offlineTaskList: Pan115OfflineTask[];
  listOfflineTasksCalls = 0;
  readonly removedOfflineHashes: string[] = [];
  readonly moves: Array<{ fileIds: string[]; targetDirectoryId: string }> = [];
  readonly deletes: Array<{ fileIds: string[] }> = [];
  readonly renames: Array<{ fileId: string; newName: string }> = [];
  readonly listCalls: string[] = [];
  private nextFolder = 1;

  constructor(input: {
    directories?: Record<string, Pan115Item[]>;
    shareFiles?: Record<string, Pan115Item[]>;
    receiveShareResults?: Record<string, Pan115ActionResult>;
    directoryInfo?: Record<string, Pan115DirectoryInfo>;
    offlineTaskList?: Pan115OfflineTask[];
  } = {}) {
    this.directories = cloneDirectories(input.directories ?? {});
    this.shareFiles = cloneDirectories(input.shareFiles ?? {});
    this.receiveShareResults = { ...(input.receiveShareResults ?? {}) };
    this.directoryInfo = { ...(input.directoryInfo ?? {}) };
    this.offlineTaskList = [...(input.offlineTaskList ?? [])];
  }

  async listOfflineTasks(): Promise<Pan115OfflineTask[]> {
    this.listOfflineTasksCalls += 1;
    return [...this.offlineTaskList];
  }

  async createFolder(input: { name: string; parentId: string }): Promise<string> {
    const id = `${input.parentId}_${input.name}_${this.nextFolder}`;
    this.nextFolder += 1;
    this.directories[id] = [];
    return id;
  }

  async listItems(input: { directoryId: string }): Promise<Pan115Item[]> {
    this.listCalls.push(input.directoryId);
    return [...(this.directories[input.directoryId] ?? [])];
  }

  async getDirectoryInfo(input: { directoryId: string }): Promise<Pan115DirectoryInfo | null> {
    return this.directoryInfo[input.directoryId] ?? {
      state: true,
      path: [
        { cid: "0", name: "root" },
        { cid: input.directoryId, name: "Season 1" },
      ],
    };
  }

  async receiveShare(input: {
    shareCode: string;
    receiveCode: string;
    directoryId: string;
  }): Promise<Pan115ActionResult> {
    this.receivedShares.push({ ...input });
    const configuredResult = this.receiveShareResults[input.shareCode];
    if (configuredResult) {
      return configuredResult;
    }
    const files = this.shareFiles[input.shareCode] ?? [];
    this.directories[input.directoryId] = [...(this.directories[input.directoryId] ?? []), ...files];
    return { ok: true, message: "" };
  }

  async addOfflineTask(input: { url: string; directoryId: string }): Promise<Pan115ActionResult> {
    this.offlineTasks.push({ ...input });
    return { ok: true, message: "offline task accepted" };
  }

  async removeOfflineTask(input: { infoHashes: string[] }): Promise<Pan115ActionResult> {
    this.removedOfflineHashes.push(...input.infoHashes);
    return { ok: true, message: "" };
  }

  async moveItems(input: { fileIds: string[]; targetDirectoryId: string }): Promise<Pan115ActionResult> {
    this.moves.push({ fileIds: [...input.fileIds], targetDirectoryId: input.targetDirectoryId });
    const movedItems: Pan115Item[] = [];
    const wantedFileIds = new Set(input.fileIds);
    for (const [directoryId, items] of Object.entries(this.directories)) {
      const remaining: Pan115Item[] = [];
      for (const item of items) {
        const fileId = String(item.fid ?? item.file_id ?? item.id ?? "");
        if (wantedFileIds.has(fileId)) {
          movedItems.push(item);
        } else {
          remaining.push(item);
        }
      }
      this.directories[directoryId] = remaining;
    }
    this.directories[input.targetDirectoryId] = [
      ...(this.directories[input.targetDirectoryId] ?? []),
      ...movedItems,
    ];
    return { ok: true, message: "" };
  }

  async deleteItems(input: { fileIds: string[] }): Promise<Pan115ActionResult> {
    this.deletes.push({ fileIds: [...input.fileIds] });
    return { ok: true, message: "" };
  }

  async renameFile(input: { fileId: string; newName: string }): Promise<Pan115ActionResult> {
    this.renames.push({ ...input });
    for (const items of Object.values(this.directories)) {
      for (const item of items) {
        const fileId = String(item.fid ?? item.file_id ?? item.id ?? "");
        if (fileId === input.fileId) {
          item.name = input.newName;
          item.n = input.newName;
        }
      }
    }
    return { ok: true, message: "" };
  }
}

function candidateFixture(input: {
  type: ResourceCandidate["type"];
  providerPayload: Record<string, unknown>;
}): ResourceCandidate {
  return {
    id: "candidate_1",
    snapshotId: "snapshot_1",
    index: 0,
    title: "Show S01E01",
    type: input.type,
    source: "pansou",
    providerPayload: input.providerPayload,
  };
}

function cloneDirectories(input: Record<string, Pan115Item[]>): Record<string, Pan115Item[]> {
  return Object.fromEntries(
    Object.entries(input).map(([directoryId, items]) => [
      directoryId,
      items.map((item) => ({ ...item })),
    ]),
  );
}

function seasonPathInfo(rootId: string, seasonId: string): Pan115DirectoryInfo {
  return {
    state: true,
    path: [
      { cid: "0", name: "root" },
      { cid: rootId, name: "Media Track Test Root" },
      { cid: "show_1", name: "Show" },
      { cid: seasonId, name: "Season 1" },
    ],
  };
}
