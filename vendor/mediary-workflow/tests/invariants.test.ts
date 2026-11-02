import { describe, expect, it } from "vitest";
import {
  createEpisodeStates,
  episodeCode,
  FakeResourceProvider,
  FakeStorageExecutor,
  reconcileVerifiedFiles,
  type ResourceCandidate,
  type TrackedSeason,
  type VerifiedFile,
} from "../src/index.js";

describe("episode state semantics", () => {
  it("creates visible future episodes without making them obtained", () => {
    const episodes = createEpisodeStates({
      trackedSeasonId: "season_1",
      seasonNumber: 1,
      totalEpisodes: 24,
      latestAiredEpisode: 14,
    });

    expect(episodes).toHaveLength(24);
    expect(episodes.every((episode) => episode.obtained === false)).toBe(true);
    expect(episodes.every((episode) => episode.metadataStatus === "confirmed")).toBe(true);
    expect(episodes[0]).toMatchObject({
      episodeCode: "S01E01",
      airStatus: "aired",
      obtained: false,
      metadataStatus: "confirmed",
    });
    expect(episodes[13]).toMatchObject({
      episodeCode: "S01E14",
      airStatus: "aired",
      obtained: false,
      metadataStatus: "confirmed",
    });
    expect(episodes[14]).toMatchObject({
      episodeCode: "S01E15",
      airStatus: "unaired",
      obtained: false,
      metadataStatus: "confirmed",
    });
  });

  it("records verified files ahead of TMDB as provider ahead", () => {
    const season: TrackedSeason = {
      id: "season_1",
      mediaTitleId: "title_1",
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "dir_1",
      totalEpisodes: 24,
      latestAiredEpisode: 20,
      latestAiredSource: "metadata",
    };
    const episodes = createEpisodeStates({
      trackedSeasonId: season.id,
      seasonNumber: season.seasonNumber,
      totalEpisodes: season.totalEpisodes,
      latestAiredEpisode: season.latestAiredEpisode,
    });
    const files: VerifiedFile[] = [
      {
        id: "file_21",
        storageDirectoryId: "dir_1",
        name: "Show.S01E21.mkv",
        sizeBytes: 100,
        episodeCode: "S01E21",
        providerFileId: "provider_21",
      },
    ];

    const reconciled = reconcileVerifiedFiles({
      season,
      episodes,
      files,
    });

    expect(reconciled.find((episode) => episode.episodeCode === "S01E21")).toMatchObject({
      obtained: true,
      metadataStatus: "provider_ahead",
      verifiedFileIds: ["file_21"],
    });
  });

  it("sorts reconciled episodes by numeric season and episode", () => {
    const season: TrackedSeason = {
      id: "season_1",
      mediaTitleId: "title_1",
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "dir_1",
      totalEpisodes: 0,
      latestAiredEpisode: 100,
      latestAiredSource: "metadata",
    };
    const files: VerifiedFile[] = [
      {
        id: "file_100",
        storageDirectoryId: "dir_1",
        name: "Show.S01E100.mkv",
        sizeBytes: 100,
        episodeCode: "S01E100",
        providerFileId: "provider_100",
      },
      {
        id: "file_99",
        storageDirectoryId: "dir_1",
        name: "Show.S01E99.mkv",
        sizeBytes: 99,
        episodeCode: "S01E99",
        providerFileId: "provider_99",
      },
    ];

    const reconciled = reconcileVerifiedFiles({
      season,
      episodes: [],
      files,
    });

    expect(reconciled.map((episode) => episode.episodeCode)).toEqual(["S01E99", "S01E100"]);
  });

  it("ignores verified files from other storage directories", () => {
    const season: TrackedSeason = {
      id: "season_1",
      mediaTitleId: "title_1",
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "dir_1",
      totalEpisodes: 24,
      latestAiredEpisode: 20,
      latestAiredSource: "metadata",
    };
    const episodes = createEpisodeStates({
      trackedSeasonId: season.id,
      seasonNumber: season.seasonNumber,
      totalEpisodes: season.totalEpisodes,
      latestAiredEpisode: season.latestAiredEpisode,
    });
    const files: VerifiedFile[] = [
      {
        id: "file_05",
        storageDirectoryId: "dir_2",
        name: "Show.S01E05.mkv",
        sizeBytes: 100,
        episodeCode: "S01E05",
        providerFileId: "provider_05",
      },
    ];

    const reconciled = reconcileVerifiedFiles({
      season,
      episodes,
      files,
    });

    expect(reconciled.find((episode) => episode.episodeCode === "S01E05")).toMatchObject({
      obtained: false,
      verifiedFileIds: [],
    });
  });

  it("formats episode codes consistently", () => {
    expect(episodeCode(1, 1)).toBe("S01E01");
    expect(episodeCode(12, 34)).toBe("S12E34");
  });
});

describe("fake adapters", () => {
  it("keeps resource candidate ordering stable in snapshots", async () => {
    const provider = new FakeResourceProvider({
      keywordResults: {
        "翘楚 4K": [
          { title: "翘楚 S01E13 4K" },
          { title: "翘楚 S01E14 4K" },
        ],
      },
    });

    const snapshot = await provider.search({ keyword: "翘楚 4K" });

    expect(snapshot.candidates.map((candidate) => candidate.index)).toEqual([0, 1]);
    expect(snapshot.candidates.map((candidate) => candidate.title)).toEqual(["翘楚 S01E13 4K", "翘楚 S01E14 4K"]);
  });

  it("uses distinct stable ids across multiple resource snapshots", async () => {
    const provider = new FakeResourceProvider({
      keywordResults: {
        "翘楚 4K": [{ title: "翘楚 S01E13 4K" }],
        "翘楚 1080p": [{ title: "翘楚 S01E13 1080p" }],
      },
    });

    const first = await provider.search({ keyword: "翘楚 4K" });
    const second = await provider.search({ keyword: "翘楚 1080p" });

    expect([first.id, second.id]).toEqual(["snapshot_1", "snapshot_2"]);
    expect(first.candidates.map((candidate) => candidate.id)).toEqual(["snapshot_1_candidate_1"]);
    expect(second.candidates.map((candidate) => candidate.id)).toEqual(["snapshot_2_candidate_1"]);
    expect(first.candidates.map((candidate) => candidate.index)).toEqual([0]);
    expect(second.candidates.map((candidate) => candidate.index)).toEqual([0]);
  });

  it("can simulate a transfer with no target directory change", async () => {
    const storage = new FakeStorageExecutor({
      directories: { dir_1: [] },
      transferOutcomes: {
        candidate_1: {
          status: "no_target_change",
          providerMessage: "already transferred elsewhere",
          files: [],
        },
      },
    });

    const attempt = await storage.transfer({
      workflowRunId: "run_1",
      directoryId: "dir_1",
      candidate: candidateFixture("candidate_1"),
    });
    const files = await storage.listVideoFiles("dir_1");

    expect(attempt.status).toBe("no_target_change");
    expect(files).toEqual([]);
  });

  it("uses constructor-time copies of configured transfer outcome files", async () => {
    const outcomeFiles: VerifiedFile[] = [
      {
        id: "file_13",
        storageDirectoryId: "source_dir",
        name: "Show.S01E13.mkv",
        sizeBytes: 100,
        episodeCode: "S01E13",
        providerFileId: "provider_13",
      },
    ];
    const storage = new FakeStorageExecutor({
      directories: { dir_1: [] },
      transferOutcomes: {
        candidate_1: {
          status: "succeeded",
          providerMessage: "ok",
          files: outcomeFiles,
        },
      },
    });
    outcomeFiles.push({
      id: "file_14",
      storageDirectoryId: "source_dir",
      name: "Show.S01E14.mkv",
      sizeBytes: 100,
      episodeCode: "S01E14",
      providerFileId: "provider_14",
    });

    await storage.transfer({
      workflowRunId: "run_1",
      directoryId: "dir_1",
      candidate: candidateFixture("candidate_1"),
    });
    const files = await storage.listVideoFiles("dir_1");

    expect(files.map((file) => file.id)).toEqual(["file_13"]);
  });

});

function candidateFixture(id: string): ResourceCandidate {
  return {
    id,
    snapshotId: "snapshot_1",
    index: 0,
    title: "Show S01E01 4K",
    type: "115",
    source: "test",
    providerPayload: {
      url: "https://115.com/s/example",
      rawType: "115",
    },
  };
}

describe("FakeStorageExecutor package trees", () => {
  it("returns the configured tree and materializes moved files for verification", async () => {
    const storage = new FakeStorageExecutor({
      packageTrees: {
        staging_1: [
          { path: "pack/S01/Show.S01E01.mkv", providerFileId: "f1", sizeBytes: 100, episodeCode: "S01E01" },
          { path: "pack/S01/Show.S01E02.mkv", providerFileId: "f2", sizeBytes: 100, episodeCode: "S01E02" },
          { path: "pack/doc/Making.Of.mkv", providerFileId: "f3", sizeBytes: 50 },
        ],
      },
    });

    const tree = await storage.listTree({ directoryId: "staging_1" });
    expect(tree.map((file) => file.providerFileId)).toEqual(["f1", "f2", "f3"]);

    const seasonDir = await storage.createDirectory({ name: "Season 1", parentId: "show_dir" });
    const moved = await storage.moveFiles({ fileIds: ["f1", "f2"], targetDirectoryId: seasonDir });
    expect(moved.moved).toEqual(["f1", "f2"]);

    const videos = await storage.listVideoFiles(seasonDir);
    expect(videos.map((video) => video.episodeCode).sort()).toEqual(["S01E01", "S01E02"]);

    const remaining = await storage.listTree({ directoryId: "staging_1" });
    expect(remaining.map((file) => file.providerFileId)).toEqual(["f3"]);
  });
});

describe("directory find-or-create and storage coherence", () => {
  it("reuses an existing same-name directory instead of duplicating it", async () => {
    const storage = new FakeStorageExecutor();
    const first = await storage.createDirectory({ name: "绝命毒师 (2008)", parentId: "root" });
    const second = await storage.createDirectory({ name: "绝命毒师 (2008)", parentId: "root" });
    expect(second).toBe(first);
    const other = await storage.createDirectory({ name: "绝命毒师 (2008)", parentId: "other_root" });
    expect(other).not.toBe(first);
  });

  it("lists transferred files in the tree and moves them between directories", async () => {
    const storage = new FakeStorageExecutor({
      transferOutcomes: {
        cand_1: {
          status: "succeeded",
          providerMessage: "",
          files: [
            {
              id: "f1",
              storageDirectoryId: "any",
              name: "Show.S01E01.mkv",
              sizeBytes: 1_000,
              episodeCode: "S01E01",
              providerFileId: "f1",
            },
          ],
        },
      },
    });
    const staging = await storage.createDirectory({ name: "staging-1", parentId: "root" });
    await storage.transfer({ workflowRunId: "r", directoryId: staging, candidate: candidateFixture("cand_1") });

    const tree = await storage.listTree({ directoryId: staging });
    expect(tree).toEqual([{ path: "Show.S01E01.mkv", providerFileId: "f1", sizeBytes: 1_000 }]);

    const seasonDir = await storage.createDirectory({ name: "Season 1", parentId: "show" });
    await storage.moveFiles({ fileIds: ["f1"], targetDirectoryId: seasonDir });
    expect(await storage.listVideoFiles(seasonDir)).toHaveLength(1);
    expect(await storage.listTree({ directoryId: staging })).toEqual([]);
    expect(await storage.listVideoFiles(staging)).toEqual([]);
  });
});
