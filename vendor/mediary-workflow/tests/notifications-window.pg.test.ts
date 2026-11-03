import { describe, expect, it } from "vitest";
import pg from "pg";
import { initializeWorkflowPostgresSchema, PostgresWorkflowRepository } from "../src/index.js";
import type { NotificationEvent, PersistWorkflowRunSnapshotInput } from "../src/index.js";

const URL = process.env.MEDIA_TRACK_POSTGRES_URL;
const d = URL ? describe : describe.skip;

const ACCOUNT = "acct_nw";
const DRIVE = "cs_nw";
const RUN_ID = "run_nw";
const SEASON_ID = "tmdb_tv_700_s1";

function notif(id: string, createdAt: string): NotificationEvent {
  return { id, workflowRunId: RUN_ID, kind: "tracking_completed", title: `N ${id}`, body: "b", createdAt };
}

function snapshot(notifications: NotificationEvent[]): PersistWorkflowRunSnapshotInput {
  return {
    accountId: ACCOUNT,
    connectedStorageId: DRIVE,
    title: { id: "tmdb_tv_700", tmdbId: 700, type: "tv", title: "S", originalTitle: "S", year: 2026, aliases: [] },
    season: {
      id: SEASON_ID,
      mediaTitleId: "tmdb_tv_700",
      seasonNumber: 1,
      status: "completed",
      qualityPreference: "4K",
      storageDirectoryId: "dir",
      totalEpisodes: 1,
      latestAiredEpisode: 1,
      latestAiredSource: "metadata",
    },
    workflowRun: {
      id: RUN_ID,
      kind: "type2_init",
      status: "succeeded",
      trackedSeasonId: SEASON_ID,
      startedAt: "2026-06-01T00:00:00.000Z",
      finishedAt: "2026-06-01T00:01:00.000Z",
      auditEvents: [],
    },
    episodes: [],
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications,
  };
}

async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query("DELETE FROM notifications WHERE workflow_run_id = $1", [RUN_ID]);
  await pool.query("DELETE FROM workflow_runs WHERE id = $1", [RUN_ID]);
  await pool.query("DELETE FROM tracked_seasons WHERE id = $1", [SEASON_ID]);
  await pool.query("DELETE FROM media_titles WHERE id = 'tmdb_tv_700'");
  await pool.query("DELETE FROM connected_storages WHERE id = $1", [DRIVE]);
}

d("listNotifications since (Postgres)", () => {
  it("filters by the ISO createdAt cutoff", async () => {
    const pool = new pg.Pool({ connectionString: URL });
    const repo = new PostgresWorkflowRepository(pool);
    try {
      await initializeWorkflowPostgresSchema(pool);
      await cleanup(pool);
      await pool.query(
        "INSERT INTO connected_storages (id, account_id, provider, provider_uid, payload, created_at) " +
          "VALUES ($1,$2,'pan115','uid_nw','{}'::jsonb,'2026-06-01T00:00:00Z') ON CONFLICT DO NOTHING",
        [DRIVE, ACCOUNT],
      );
      await repo.saveWorkflowRunSnapshot(
        snapshot([
          notif("recent", "2026-06-20T00:00:00.000Z"),
          notif("edge", "2026-06-14T00:00:00.000Z"),
          notif("old", "2026-06-01T00:00:00.000Z"),
        ]),
      );

      const within = await repo.listNotifications({
        accountId: ACCOUNT,
        connectedStorageId: DRIVE,
        since: "2026-06-14T00:00:00.000Z",
      });
      expect(within.map((n) => n.id)).toEqual(["recent", "edge"]);

      const all = await repo.listNotifications({ accountId: ACCOUNT, connectedStorageId: DRIVE });
      expect(all.length).toBe(3);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });
});
