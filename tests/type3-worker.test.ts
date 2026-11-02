import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import {
  createEpisodeStates,
  FakeResourceProvider,
  FakeStorageExecutor,
  InMemoryWorkflowRepository,
  reconcileVerifiedFiles,
  reserveMovie,
  runScheduledType3Monitoring,
  type MediaTitle,
  type TrackedSeason,
  type VerifiedFile,
} from "../src/index.js";

const fixedNow = () => "2026-06-12T00:00:00.000Z";

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const;

/** Searches once, honestly reports no coverage. */
function noCoverageModel() {
  let i = 0;
  const tool = (name: string, input: unknown) => ({
    content: [{ type: "tool-call" as const, toolCallId: `c${i}`, toolName: name, input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
    usage: USAGE,
    warnings: [],
  });
  return new MockLanguageModelV3({
    doGenerate: async () => {
      i += 1;
      if (i === 1) return tool("searchResources", { keyword: "show" });
      if (i === 2) return tool("reportNoCoverage", { reason: "no candidates" });
      return { content: [{ type: "text" as const, text: "done" }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
    },
  });
}

/** Throws on any call — a model whose API is down, and a guard the no-op path
 *  must never invoke. */
function throwingModel() {
  return new MockLanguageModelV3({
    doGenerate: async () => {
      throw new Error("agent model unavailable");
    },
  });
}

function emptyProvider() {
  return new FakeResourceProvider({ keywordResults: {} });
}

function trackedFixture(suffix = "show") {
  const title: MediaTitle = {
    id: `title_${suffix}`,
    tmdbId: 1,
    type: "tv",
    title: `Show ${suffix}`,
    originalTitle: `Show ${suffix}`,
    year: 2026,
    aliases: [],
  };
  const season: TrackedSeason = {
    id: `season_${suffix}_1`,
    mediaTitleId: title.id,
    seasonNumber: 1,
    status: "active",
    qualityPreference: "4K",
    storageDirectoryId: `dir_${suffix}_s1`,
    totalEpisodes: 2,
    latestAiredEpisode: 2,
    latestAiredSource: "metadata",
  };
  return { title, season };
}

function verifiedFile(directoryId: string, id: string, code: string): VerifiedFile {
  return {
    id,
    storageDirectoryId: directoryId,
    name: `Show.${code}.mkv`,
    sizeBytes: 1_000_000_000,
    episodeCode: code,
    providerFileId: `provider_${id}`,
  };
}

async function seedTrackedSeason(input: {
  repository: InMemoryWorkflowRepository;
  title: MediaTitle;
  season: TrackedSeason;
  obtainedCodes: string[];
}) {
  const files = input.obtainedCodes.map((code, index) =>
    verifiedFile(input.season.storageDirectoryId, `seed_${index}`, code),
  );
  const episodes = reconcileVerifiedFiles({
    season: input.season,
    episodes: createEpisodeStates({
      trackedSeasonId: input.season.id,
      seasonNumber: input.season.seasonNumber,
      totalEpisodes: input.season.totalEpisodes,
      latestAiredEpisode: input.season.latestAiredEpisode,
    }),
    files,
  });
  await input.repository.saveWorkflowRunSnapshot({
    title: input.title,
    season: input.season,
    workflowRun: {
      id: `seed_${input.season.id}`,
      kind: "type2_init",
      status: "succeeded",
      trackedSeasonId: input.season.id,
      startedAt: fixedNow(),
      finishedAt: fixedNow(),
      auditEvents: [],
    },
    episodes,
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications: [],
  });
}

/**
 * Pre-create the canonical V2 directory tree (`Title (Year)/Season NN`) under
 * the category parent and seed the season directory with the files a previous
 * run already landed — the V2 workflow verify-or-creates this same tree and
 * syncs against it, ignoring the tracked season's stored storageDirectoryId.
 */
async function seedV2Season(
  storage: FakeStorageExecutor,
  title: MediaTitle,
  season: TrackedSeason,
  presentCodes: string[],
): Promise<string> {
  const showDir = await storage.createDirectory({ name: `${title.title} (${title.year})`, parentId: "library_root" });
  const seasonDir = await storage.createDirectory({
    name: `Season ${String(season.seasonNumber).padStart(2, "0")}`,
    parentId: showDir,
  });
  storage.seedDirectoryFiles(
    seasonDir,
    presentCodes.map((code, index) => verifiedFile(seasonDir, `present_${code}_${index}`, code)),
  );
  return seasonDir;
}

describe("runScheduledType3Monitoring (V2 engine)", () => {
  it("returns an empty outcome list when nothing is tracked", async () => {
    const outcomes = await runScheduledType3Monitoring({
      repository: new InMemoryWorkflowRepository(),
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: throwingModel(),
      storageParentDirectoryId: "library_root",
      now: fixedNow,
    });

    expect(outcomes).toEqual([]);
  });

  it("detects a real gap, runs the agent over the sandbox, and persists a type3_monitor run", async () => {
    const repository = new InMemoryWorkflowRepository();
    const { title, season } = trackedFixture();
    await seedTrackedSeason({ repository, title, season, obtainedCodes: ["S01E01", "S01E02"] });
    const storage = new FakeStorageExecutor();
    await seedV2Season(storage, title, season, ["S01E01"]); // external mutation: E02 gone

    const outcomes = await runScheduledType3Monitoring({
      repository,
      resourceProvider: emptyProvider(),
      storage,
      model: noCoverageModel(),
      storageParentDirectoryId: "library_root",
      now: fixedNow,
      createWorkflowRunId: () => "run_sched_type3",
    });

    expect(outcomes[0]).toMatchObject({ trackedSeasonId: season.id, status: "ran", workflowRunId: "run_sched_type3" });
    const saved = await repository.getWorkflowRunSnapshot("run_sched_type3");
    expect(saved?.workflowRun.kind).toBe("type3_monitor");
  });

  it("syncs against fresh TMDB metadata so episodes that aired after tracking began become the need", async () => {
    const repository = new InMemoryWorkflowRepository();
    const { title } = trackedFixture("airing");
    const season: TrackedSeason = { ...trackedFixture("airing").season, totalEpisodes: 4, latestAiredEpisode: 2 };
    await seedTrackedSeason({ repository, title, season, obtainedCodes: ["S01E01", "S01E02"] });
    const storage = new FakeStorageExecutor();
    await seedV2Season(storage, title, season, ["S01E01", "S01E02"]);

    const outcomes = await runScheduledType3Monitoring({
      repository,
      resourceProvider: emptyProvider(),
      storage,
      model: noCoverageModel(),
      storageParentDirectoryId: "library_root",
      now: fixedNow,
      createWorkflowRunId: () => "run_sync_type3",
      // TMDB now reports episode 4 as the latest aired.
      syncSeasonMetadata: async () => ({ latestAiredEpisode: 4, totalEpisodes: 4 }),
    });

    expect(outcomes[0]).toMatchObject({ trackedSeasonId: season.id, status: "ran" });
    const saved = await repository.getWorkflowRunSnapshot("run_sync_type3");
    // The sync refreshed the season's aired cursor so E03/E04 became the need.
    expect(saved?.season.latestAiredEpisode).toBe(4);
  });

  it("records a no-op run when a tracked season is already current — the agent model is never invoked", async () => {
    const repository = new InMemoryWorkflowRepository();
    const { title, season } = trackedFixture();
    await seedTrackedSeason({ repository, title, season, obtainedCodes: ["S01E01", "S01E02"] });
    const storage = new FakeStorageExecutor();
    await seedV2Season(storage, title, season, ["S01E01", "S01E02"]); // all aired present

    const outcomes = await runScheduledType3Monitoring({
      repository,
      resourceProvider: emptyProvider(),
      storage,
      model: throwingModel(), // must NOT be invoked on a no-op
      storageParentDirectoryId: "library_root",
      now: fixedNow,
      createWorkflowRunId: () => "run_noop_type3",
    });

    expect(outcomes).toEqual([
      { trackedSeasonId: season.id, status: "ran", workflowRunId: "run_noop_type3", workflowStatus: "succeeded" },
    ]);
  });

  it("no-op patrol of a still-airing season persists an already_current notification (routine, folds in UI)", async () => {
    const repository = new InMemoryWorkflowRepository();
    const { title, season } = trackedFixture();
    // Still airing: 2 of 3 episodes aired, both already obtained — nothing to do.
    season.totalEpisodes = 3;
    season.latestAiredEpisode = 2;
    await seedTrackedSeason({ repository, title, season, obtainedCodes: ["S01E01", "S01E02"] });
    const storage = new FakeStorageExecutor();
    await seedV2Season(storage, title, season, ["S01E01", "S01E02"]);

    await runScheduledType3Monitoring({
      repository,
      resourceProvider: emptyProvider(),
      storage,
      model: throwingModel(), // no gap → the agent must never be invoked
      storageParentDirectoryId: "library_root",
      now: fixedNow,
      createWorkflowRunId: () => "run_airing_noop",
    });

    const notifications = await repository.listNotifications();
    const patrol = notifications.filter((notification) => notification.workflowRunId === "run_airing_noop");
    expect(patrol).toHaveLength(1);
    expect(patrol[0]!.kind).toBe("already_current");
    expect(patrol[0]!.trigger).toBe("scheduled");
    expect(patrol[0]!.report?.status).toBe("airing");
  });

  it("skips a season that already has an active workflow run", async () => {
    const repository = new InMemoryWorkflowRepository();
    const { title, season } = trackedFixture();
    await seedTrackedSeason({ repository, title, season, obtainedCodes: [] });
    await repository.saveWorkflowRunSnapshot({
      title,
      season,
      workflowRun: {
        id: "active_run",
        kind: "type3_monitor",
        status: "running",
        trackedSeasonId: season.id,
        startedAt: fixedNow(),
        finishedAt: null,
        auditEvents: [],
      },
      episodes: createEpisodeStates({
        trackedSeasonId: season.id,
        seasonNumber: season.seasonNumber,
        totalEpisodes: season.totalEpisodes,
        latestAiredEpisode: season.latestAiredEpisode,
      }),
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });

    const outcomes = await runScheduledType3Monitoring({
      repository,
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: throwingModel(),
      storageParentDirectoryId: "library_root",
      now: fixedNow,
    });

    expect(outcomes).toEqual([{ trackedSeasonId: season.id, status: "skipped_active" }]);
  });

  it("patrols a tracked-but-unobtained movie by dispatching the movie agent (by title.type)", async () => {
    const repository = new InMemoryWorkflowRepository();
    const movie: MediaTitle = {
      id: "tmdb_movie_872585",
      tmdbId: 872585,
      type: "movie",
      title: "奥本海默",
      originalTitle: "Oppenheimer",
      year: 2023,
      aliases: ["Oppenheimer"],
    };
    // A movie tracked via 获取 that found no resource (已上映无源): one unobtained
    // anchor episode, season status completed (movie convention).
    await repository.saveWorkflowRunSnapshot({
      title: movie,
      season: {
        id: `${movie.id}_movie`,
        mediaTitleId: movie.id,
        seasonNumber: 1,
        status: "completed",
        qualityPreference: "4K",
        storageDirectoryId: "",
        totalEpisodes: 1,
        latestAiredEpisode: 1,
        latestAiredSource: "manual",
      },
      workflowRun: {
        id: "seed_movie",
        kind: "movie_init",
        status: "no_coverage",
        trackedSeasonId: `${movie.id}_movie`,
        startedAt: fixedNow(),
        finishedAt: fixedNow(),
        auditEvents: [],
      },
      episodes: createEpisodeStates({ trackedSeasonId: `${movie.id}_movie`, seasonNumber: 1, totalEpisodes: 1, latestAiredEpisode: 1 }),
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });

    const outcomes = await runScheduledType3Monitoring({
      repository,
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: noCoverageModel(),
      storageParentDirectoryId: "tv_root",
      moviesParentDirectoryId: "movies_root",
      now: fixedNow,
      createWorkflowRunId: () => "run_movie_patrol",
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ trackedSeasonId: `${movie.id}_movie`, status: "ran", workflowRunId: "run_movie_patrol" });
    const saved = await repository.getWorkflowRunSnapshot("run_movie_patrol");
    expect(saved?.workflowRun.kind).toBe("movie_init");
  });

  it("does NOT patrol a reserved film whose release date is still in the future (air-time gate)", async () => {
    const repository = new InMemoryWorkflowRepository();
    await reserveMovie({
      title: {
        id: "tmdb_movie_999",
        tmdbId: 999,
        type: "movie",
        title: "未上映大片",
        originalTitle: "Future Blockbuster",
        year: 2026,
        releaseDate: "2026-12-25", // after fixedNow (2026-06-12) → unreleased
        aliases: [],
      },
      repository,
      createWorkflowRunId: () => "run_reserved",
      now: fixedNow,
    });

    const outcomes = await runScheduledType3Monitoring({
      repository,
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: noCoverageModel(),
      storageParentDirectoryId: "tv_root",
      moviesParentDirectoryId: "movies_root",
      now: fixedNow,
      createWorkflowRunId: () => "run_should_not_exist",
    });

    expect(outcomes).toEqual([]); // skipped — the agent never runs before release
    expect(await repository.getWorkflowRunSnapshot("run_should_not_exist")).toBeNull();
  });

  it("patrols a reserved film ONCE its release date has arrived (auto-collect at release)", async () => {
    const repository = new InMemoryWorkflowRepository();
    await reserveMovie({
      title: {
        id: "tmdb_movie_998",
        tmdbId: 998,
        type: "movie",
        title: "刚上映",
        originalTitle: "Just Released",
        year: 2026,
        releaseDate: "2026-01-01", // before fixedNow (2026-06-12) → released, collect it
        aliases: [],
      },
      repository,
      createWorkflowRunId: () => "run_reserved",
      now: fixedNow,
    });

    const outcomes = await runScheduledType3Monitoring({
      repository,
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: noCoverageModel(),
      storageParentDirectoryId: "tv_root",
      moviesParentDirectoryId: "movies_root",
      now: fixedNow,
      createWorkflowRunId: () => "run_release_patrol",
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ status: "ran", workflowRunId: "run_release_patrol" });
  });

  it("does not patrol an already-obtained movie", async () => {
    const repository = new InMemoryWorkflowRepository();
    const movie: MediaTitle = {
      id: "tmdb_movie_1",
      tmdbId: 1,
      type: "movie",
      title: "Done Movie",
      originalTitle: "Done Movie",
      year: 2020,
      aliases: [],
    };
    const obtainedEpisode = createEpisodeStates({ trackedSeasonId: `${movie.id}_movie`, seasonNumber: 1, totalEpisodes: 1, latestAiredEpisode: 1 }).map(
      (episode) => ({ ...episode, obtained: true }),
    );
    await repository.saveWorkflowRunSnapshot({
      title: movie,
      season: {
        id: `${movie.id}_movie`,
        mediaTitleId: movie.id,
        seasonNumber: 1,
        status: "completed",
        qualityPreference: "4K",
        storageDirectoryId: "movies_root_done",
        totalEpisodes: 1,
        latestAiredEpisode: 1,
        latestAiredSource: "manual",
      },
      workflowRun: {
        id: "seed_done_movie",
        kind: "movie_init",
        status: "succeeded",
        trackedSeasonId: `${movie.id}_movie`,
        startedAt: fixedNow(),
        finishedAt: fixedNow(),
        auditEvents: [],
      },
      episodes: obtainedEpisode,
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });

    const outcomes = await runScheduledType3Monitoring({
      repository,
      resourceProvider: emptyProvider(),
      storage: new FakeStorageExecutor(),
      model: throwingModel(), // must not run for an already-obtained movie
      storageParentDirectoryId: "tv_root",
      moviesParentDirectoryId: "movies_root",
      now: fixedNow,
    });

    expect(outcomes).toEqual([]);
  });

  it("isolates one season's failure and continues with the next", async () => {
    const repository = new InMemoryWorkflowRepository();
    const broken = trackedFixture("broken");
    const healthy = trackedFixture("healthy");
    await seedTrackedSeason({ repository, title: broken.title, season: broken.season, obtainedCodes: ["S01E01"] });
    // Healthy season's DB marks cover all aired (实有 = aired) → a true no-op, the
    // agent is never invoked. (实有 is the DB marks now, not a 115 scan.)
    await seedTrackedSeason({ repository, title: healthy.title, season: healthy.season, obtainedCodes: ["S01E01", "S01E02"] });
    const storage = new FakeStorageExecutor();
    await seedV2Season(storage, broken.title, broken.season, []); // gap → agent runs → model dies
    await seedV2Season(storage, healthy.title, healthy.season, ["S01E01", "S01E02"]); // current → no-op
    let counter = 0;

    const outcomes = await runScheduledType3Monitoring({
      repository,
      resourceProvider: emptyProvider(),
      storage,
      model: throwingModel(),
      storageParentDirectoryId: "library_root",
      now: fixedNow,
      createWorkflowRunId: () => `run_multi_${(counter += 1)}`,
    });

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({
      trackedSeasonId: broken.season.id,
      status: "failed",
      errorMessage: "agent model unavailable",
    });
    expect(outcomes[1]).toMatchObject({ trackedSeasonId: healthy.season.id, status: "ran", workflowStatus: "succeeded" });
    const failed = await repository.getWorkflowRunSnapshot("run_multi_1");
    expect(failed?.workflowRun.status).toBe("failed");
  });
});
