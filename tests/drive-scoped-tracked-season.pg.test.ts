import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  createEpisodeStates,
  initializeWorkflowPostgresSchema,
  PostgresWorkflowRepository,
} from "../src/index.js";
import type { MediaTitle, TrackedSeason } from "../src/index.js";

const T_ID = "tmdb_movie_13";
const S_ID = "tmdb_movie_13_movie";
function pgMovieTitle(): MediaTitle {
  return { id: T_ID, tmdbId: 13, type: "movie", title: "阿甘正传", originalTitle: "Forrest Gump", year: 1994, aliases: [] };
}
function pgAnchorSeason(): TrackedSeason {
  return { id: S_ID, mediaTitleId: T_ID, seasonNumber: 1, status: "active", qualityPreference: "4K", storageDirectoryId: "", totalEpisodes: 1, latestAiredEpisode: 1, latestAiredSource: "metadata" };
}
async function pgObtain(repo: PostgresWorkflowRepository, storageId: string): Promise<void> {
  await repo.saveWorkflowRunSnapshot({
    accountId: "acct_ds",
    connectedStorageId: storageId,
    title: pgMovieTitle(),
    season: pgAnchorSeason(),
    workflowRun: { id: `run_ds_${storageId}`, kind: "movie_init", status: "succeeded", trackedSeasonId: S_ID, startedAt: "2026-06-19T00:00:00.000Z", finishedAt: "2026-06-19T00:01:00.000Z", auditEvents: [] },
    episodes: createEpisodeStates({ trackedSeasonId: S_ID, seasonNumber: 1, totalEpisodes: 1, latestAiredEpisode: 1 }).map((e) => ({ ...e, obtained: true })),
    resourceSnapshots: [], decisions: [], transferAttempts: [], notifications: [],
  });
}

// Gated on a real Postgres (same pattern as postgres-schema-init.test.ts).
const URL = process.env.MEDIA_TRACK_POSTGRES_URL;
const d = URL ? describe : describe.skip;

async function pkColumns(pool: pg.Pool, table: string): Promise<string[]> {
  const r = await pool.query(
    "SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) " +
      `WHERE i.indrelid='${table}'::regclass AND i.indisprimary`,
  );
  return r.rows.map((row) => row.attname as string).sort();
}

d("drive-scoped schema migration (Postgres)", () => {
  it("connected_storage_id is in the PK of tracked_seasons + episode_states; idempotent; NOT NULL", async () => {
    const pool = new pg.Pool({ connectionString: URL });
    try {
      await initializeWorkflowPostgresSchema(pool);
      await initializeWorkflowPostgresSchema(pool); // second run must be a no-op (idempotent)

      expect(await pkColumns(pool, "tracked_seasons")).toEqual(["connected_storage_id", "id"]);
      expect(await pkColumns(pool, "episode_states")).toEqual([
        "connected_storage_id",
        "episode_code",
        "tracked_season_id",
      ]);

      const col = await pool.query(
        "SELECT is_nullable FROM information_schema.columns WHERE table_name='episode_states' AND column_name='connected_storage_id'",
      );
      expect(col.rows[0]?.is_nullable).toBe("NO");

      const tsCol = await pool.query(
        "SELECT is_nullable FROM information_schema.columns WHERE table_name='tracked_seasons' AND column_name='connected_storage_id'",
      );
      expect(tsCol.rows[0]?.is_nullable).toBe("NO");
    } finally {
      await pool.end();
    }
  });

  it("Postgres: obtained on drive A does not block drive B; episodes independent; re-saving B keeps A", async () => {
    const pool = new pg.Pool({ connectionString: URL });
    const repo = new PostgresWorkflowRepository(pool);
    try {
      // clean slate for this title + the two test drives
      await pool.query("DELETE FROM episode_states WHERE tracked_season_id = $1", [S_ID]);
      await pool.query("DELETE FROM workflow_runs WHERE tracked_season_id = $1", [S_ID]);
      await pool.query("DELETE FROM tracked_seasons WHERE id = $1", [S_ID]);
      await pool.query("DELETE FROM connected_storages WHERE id IN ('ds_driveA','ds_driveB')");
      await pool.query(
        "INSERT INTO connected_storages (id, account_id, provider, provider_uid, payload, created_at) VALUES " +
          "('ds_driveA','acct_ds','pan115','ds_uidA','{}'::jsonb,'2026-06-19T00:00:00Z')," +
          "('ds_driveB','acct_ds','pan115','ds_uidB','{}'::jsonb,'2026-06-19T00:00:01Z') ON CONFLICT DO NOTHING",
      );

      await pgObtain(repo, "ds_driveA");

      const res = await repo.reserveWorkflowRun({
        accountId: "acct_ds",
        connectedStorageId: "ds_driveB",
        title: pgMovieTitle(),
        season: pgAnchorSeason(),
        workflowRun: { id: "run_ds_B_reserve", kind: "movie_init", status: "queued", trackedSeasonId: S_ID, startedAt: "2026-06-19T01:00:00.000Z", finishedAt: null, auditEvents: [] },
        episodes: [],
        resourceSnapshots: [], decisions: [], transferAttempts: [], notifications: [],
        blockIfEpisodeStatesExist: true,
        blockIfTitleHasActiveRun: true,
      });
      expect(res.status).toBe("reserved");

      await pgObtain(repo, "ds_driveB");
      expect((await repo.listEpisodeStates(S_ID, { accountId: "acct_ds", connectedStorageId: "ds_driveA" })).length).toBe(1);
      expect((await repo.listEpisodeStates(S_ID, { accountId: "acct_ds", connectedStorageId: "ds_driveB" })).length).toBe(1);

      // Re-saving B's run must NOT wipe A's episodes (deleteWorkflowRunChildren scope).
      await pgObtain(repo, "ds_driveB");
      expect((await repo.listEpisodeStates(S_ID, { accountId: "acct_ds", connectedStorageId: "ds_driveA" })).length).toBe(1);

      // cleanup
      await pool.query("DELETE FROM episode_states WHERE tracked_season_id = $1", [S_ID]);
      await pool.query("DELETE FROM workflow_runs WHERE tracked_season_id = $1", [S_ID]);
      await pool.query("DELETE FROM tracked_seasons WHERE id = $1", [S_ID]);
      await pool.query("DELETE FROM connected_storages WHERE id IN ('ds_driveA','ds_driveB')");
    } finally {
      await pool.end();
    }
  });
});
