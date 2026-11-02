import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  createEpisodeStates,
  initializeWorkflowPostgresSchema,
  PostgresWorkflowRepository,
} from "../src/index.js";
import type { MediaTitle, TrackedSeason, WorkflowStatus } from "../src/index.js";

const URL = process.env.MEDIA_TRACK_POSTGRES_URL;
const d = URL ? describe : describe.skip;

const ACCOUNT = "acct_unt";
const DRIVE_A = "cs_unt_a";
const DRIVE_B = "cs_unt_b";

function tvTitle(tmdbId: number): MediaTitle {
  return {
    id: `tmdb_tv_${tmdbId}`,
    tmdbId,
    type: "tv",
    title: `Show ${tmdbId}`,
    originalTitle: `Show ${tmdbId}`,
    year: 2026,
    aliases: [],
  };
}

function tvSeason(tmdbId: number, seasonNumber: number, status: "active" | "completed"): TrackedSeason {
  return {
    id: `tmdb_tv_${tmdbId}_s${seasonNumber}`,
    mediaTitleId: `tmdb_tv_${tmdbId}`,
    seasonNumber,
    status,
    qualityPreference: "4K",
    storageDirectoryId: "dir",
    totalEpisodes: 1,
    latestAiredEpisode: 1,
    latestAiredSource: "metadata",
  };
}

async function seedSeason(
  repo: PostgresWorkflowRepository,
  opts: { tmdbId: number; seasonNumber: number; storageId: string; status?: WorkflowStatus },
): Promise<void> {
  const { tmdbId, seasonNumber, storageId, status = "succeeded" } = opts;
  const seasonId = `tmdb_tv_${tmdbId}_s${seasonNumber}`;
  const terminal = status !== "queued" && status !== "running";
  await repo.saveWorkflowRunSnapshot({
    accountId: ACCOUNT,
    connectedStorageId: storageId,
    title: tvTitle(tmdbId),
    season: tvSeason(tmdbId, seasonNumber, status === "succeeded" ? "completed" : "active"),
    workflowRun: {
      id: `run_${seasonId}_${storageId}_${status}`,
      kind: "type2_init",
      status,
      trackedSeasonId: seasonId,
      startedAt: "2026-06-21T00:00:00.000Z",
      finishedAt: terminal ? "2026-06-21T00:01:00.000Z" : null,
      auditEvents: [],
    },
    episodes: createEpisodeStates({
      trackedSeasonId: seasonId,
      seasonNumber,
      totalEpisodes: 1,
      latestAiredEpisode: 1,
    }).map((e) => ({ ...e, obtained: status === "succeeded" })),
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications: [],
  });
}

async function seedMovie(repo: PostgresWorkflowRepository, tmdbId: number, storageId: string): Promise<void> {
  const seasonId = `tmdb_movie_${tmdbId}_movie`;
  await repo.saveWorkflowRunSnapshot({
    accountId: ACCOUNT,
    connectedStorageId: storageId,
    title: {
      id: `tmdb_movie_${tmdbId}`,
      tmdbId,
      type: "movie",
      title: `Movie ${tmdbId}`,
      originalTitle: `Movie ${tmdbId}`,
      year: 2026,
      aliases: [],
    },
    season: {
      id: seasonId,
      mediaTitleId: `tmdb_movie_${tmdbId}`,
      seasonNumber: 1,
      status: "completed",
      qualityPreference: "4K",
      storageDirectoryId: "dir",
      totalEpisodes: 1,
      latestAiredEpisode: 1,
      latestAiredSource: "metadata",
    },
    workflowRun: {
      id: `run_${seasonId}_${storageId}`,
      kind: "movie_init",
      status: "succeeded",
      trackedSeasonId: seasonId,
      startedAt: "2026-06-21T00:00:00.000Z",
      finishedAt: "2026-06-21T00:01:00.000Z",
      auditEvents: [],
    },
    episodes: createEpisodeStates({ trackedSeasonId: seasonId, seasonNumber: 1, totalEpisodes: 1, latestAiredEpisode: 1 }).map(
      (e) => ({ ...e, obtained: true }),
    ),
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications: [],
  });
}

async function cleanup(pool: pg.Pool): Promise<void> {
  for (const id of [
    "tmdb_tv_500_s1",
    "tmdb_tv_500_s2",
    "tmdb_tv_501_s1",
    "tmdb_tv_502_s1",
    "tmdb_tv_600_s1",
    "tmdb_movie_600_movie",
  ]) {
    await pool.query("DELETE FROM episode_states WHERE tracked_season_id = $1", [id]);
    await pool.query("DELETE FROM workflow_runs WHERE tracked_season_id = $1", [id]);
    await pool.query("DELETE FROM tracked_seasons WHERE id = $1", [id]);
  }
  await pool.query(
    "DELETE FROM media_titles WHERE id IN ('tmdb_tv_500','tmdb_tv_501','tmdb_tv_502','tmdb_tv_600','tmdb_movie_600')",
  );
  await pool.query("DELETE FROM connected_storages WHERE id IN ($1,$2)", [DRIVE_A, DRIVE_B]);
}

d("untrackTitle (Postgres)", () => {
  it("整剧取消:本盘行清空 + 分盘隔离 + 全局 title 仅末次引用才删 + 不误删别的剧", async () => {
    const pool = new pg.Pool({ connectionString: URL });
    const repo = new PostgresWorkflowRepository(pool);
    try {
      await initializeWorkflowPostgresSchema(pool);
      await cleanup(pool);
      await pool.query(
        "INSERT INTO connected_storages (id, account_id, provider, provider_uid, payload, created_at) VALUES " +
          "($1,$3,'pan115','uid_a','{}'::jsonb,'2026-06-21T00:00:00Z')," +
          "($2,$3,'pan115','uid_b','{}'::jsonb,'2026-06-21T00:00:01Z') ON CONFLICT DO NOTHING",
        [DRIVE_A, DRIVE_B, ACCOUNT],
      );
      // Title 500: S1+S2 on A, S1 on B. Title 501: S1 on A (control — must survive).
      await seedSeason(repo, { tmdbId: 500, seasonNumber: 1, storageId: DRIVE_A });
      await seedSeason(repo, { tmdbId: 500, seasonNumber: 2, storageId: DRIVE_A });
      await seedSeason(repo, { tmdbId: 500, seasonNumber: 1, storageId: DRIVE_B });
      await seedSeason(repo, { tmdbId: 501, seasonNumber: 1, storageId: DRIVE_A });

      const result = await repo.untrackTitle(500, { accountId: ACCOUNT, connectedStorageId: DRIVE_A }, "tv");
      expect(result).toEqual({ status: "untracked", removedSeasons: 2 });

      // A-drive rows for 500 cleared.
      const aSeasons = await pool.query(
        "SELECT 1 FROM tracked_seasons WHERE media_title_id = 'tmdb_tv_500' AND connected_storage_id = $1",
        [DRIVE_A],
      );
      expect(aSeasons.rowCount).toBe(0);
      const aRuns = await pool.query(
        "SELECT 1 FROM workflow_runs WHERE tracked_season_id IN ('tmdb_tv_500_s1','tmdb_tv_500_s2') AND connected_storage_id = $1",
        [DRIVE_A],
      );
      expect(aRuns.rowCount).toBe(0);
      const aEps = await pool.query(
        "SELECT 1 FROM episode_states WHERE tracked_season_id IN ('tmdb_tv_500_s1','tmdb_tv_500_s2') AND connected_storage_id = $1",
        [DRIVE_A],
      );
      expect(aEps.rowCount).toBe(0);

      // B-drive 500 preserved → global title preserved; control title 501 preserved.
      const bSeasons = await pool.query(
        "SELECT 1 FROM tracked_seasons WHERE media_title_id = 'tmdb_tv_500' AND connected_storage_id = $1",
        [DRIVE_B],
      );
      expect(bSeasons.rowCount).toBe(1);
      expect((await pool.query("SELECT 1 FROM media_titles WHERE id = 'tmdb_tv_500'")).rowCount).toBe(1);
      expect((await pool.query("SELECT 1 FROM media_titles WHERE id = 'tmdb_tv_501'")).rowCount).toBe(1);

      // Now untrack the last reference (B drive) → global title finally deleted.
      const second = await repo.untrackTitle(500, { accountId: ACCOUNT, connectedStorageId: DRIVE_B }, "tv");
      expect(second.status).toBe("untracked");
      expect((await pool.query("SELECT 1 FROM media_titles WHERE id = 'tmdb_tv_500'")).rowCount).toBe(0);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it("在途 running 拒绝:返回 in_flight,零删除", async () => {
    const pool = new pg.Pool({ connectionString: URL });
    const repo = new PostgresWorkflowRepository(pool);
    try {
      await initializeWorkflowPostgresSchema(pool);
      await cleanup(pool);
      await pool.query(
        "INSERT INTO connected_storages (id, account_id, provider, provider_uid, payload, created_at) VALUES " +
          "($1,$2,'pan115','uid_a','{}'::jsonb,'2026-06-21T00:00:00Z') ON CONFLICT DO NOTHING",
        [DRIVE_A, ACCOUNT],
      );
      await seedSeason(repo, { tmdbId: 502, seasonNumber: 1, storageId: DRIVE_A, status: "running" });

      const result = await repo.untrackTitle(502, { accountId: ACCOUNT, connectedStorageId: DRIVE_A }, "tv");
      expect(result).toEqual({ status: "in_flight", removedSeasons: 0 });
      expect(
        (await pool.query("SELECT 1 FROM tracked_seasons WHERE id = 'tmdb_tv_502_s1'")).rowCount,
      ).toBe(1);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it("跨类型隔离:取消同 id 的剧集不删同 id 的电影", async () => {
    const pool = new pg.Pool({ connectionString: URL });
    const repo = new PostgresWorkflowRepository(pool);
    try {
      await initializeWorkflowPostgresSchema(pool);
      await cleanup(pool);
      await pool.query(
        "INSERT INTO connected_storages (id, account_id, provider, provider_uid, payload, created_at) VALUES " +
          "($1,$2,'pan115','uid_a','{}'::jsonb,'2026-06-21T00:00:00Z') ON CONFLICT DO NOTHING",
        [DRIVE_A, ACCOUNT],
      );
      await seedSeason(repo, { tmdbId: 600, seasonNumber: 1, storageId: DRIVE_A });
      await seedMovie(repo, 600, DRIVE_A);

      const result = await repo.untrackTitle(600, { accountId: ACCOUNT, connectedStorageId: DRIVE_A }, "tv");
      expect(result).toEqual({ status: "untracked", removedSeasons: 1 });

      // tv gone, movie (same numeric id) survives.
      expect((await pool.query("SELECT 1 FROM media_titles WHERE id = 'tmdb_tv_600'")).rowCount).toBe(0);
      expect((await pool.query("SELECT 1 FROM media_titles WHERE id = 'tmdb_movie_600'")).rowCount).toBe(1);
      expect(
        (await pool.query("SELECT 1 FROM tracked_seasons WHERE id = 'tmdb_movie_600_movie'")).rowCount,
      ).toBe(1);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });
});
