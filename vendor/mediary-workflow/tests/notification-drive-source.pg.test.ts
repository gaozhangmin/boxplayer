import { describe, expect, it, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createPostgresWorkflowRepositorySync } from "../src/index.js";

// Postgres-only: listRecentNotificationsWithAccount must surface each notification's
// source drive (the run's connected_storage_id) so the outbound push can tag "来自<盘>"
// when an account has ≥2 drives. Schema: workflow_runs(id, tracked_season_id, payload,
// account_id, connected_storage_id?), notifications(id, workflow_run_id, ordinal, payload);
// createdAt/kind live INSIDE the notification payload.
//   MEDIA_TRACK_POSTGRES_URL=… npx vitest run packages/workflow/tests/notification-drive-source.pg.test.ts

const URL = process.env.MEDIA_TRACK_POSTGRES_URL;
const d = URL ? describe : describe.skip;

d("listRecentNotificationsWithAccount carries connectedStorageId", () => {
  const repo = createPostgresWorkflowRepositorySync({ connectionString: URL! });
  const pool = new pg.Pool({ connectionString: URL! });
  const RUN = "run_nds_test_1";
  const CS = "cs_nds_test_1";
  const NOTIF = "notif_nds_test_1";

  beforeAll(async () => {
    // Touch the repo once so ensureSchema() runs before we hand-insert rows.
    await repo.listRecentNotificationsWithAccount({ limit: 1 });
    await pool.query("DELETE FROM notifications WHERE id = $1", [NOTIF]);
    await pool.query("DELETE FROM workflow_runs WHERE id = $1", [RUN]);
    await pool.query(
      "INSERT INTO workflow_runs (id, tracked_season_id, account_id, connected_storage_id, payload) " +
        "VALUES ($1, 'ts_nds', 'acct_default', $2, '{}'::jsonb) ON CONFLICT (id) DO NOTHING",
      [RUN, CS],
    );
    await pool.query(
      "INSERT INTO notifications (id, workflow_run_id, ordinal, payload) VALUES ($1, $2, 0, $3::jsonb) " +
        "ON CONFLICT (id) DO NOTHING",
      [
        NOTIF,
        RUN,
        JSON.stringify({
          id: NOTIF,
          workflowRunId: RUN,
          kind: "acquire",
          title: "t",
          body: "b",
          createdAt: new Date().toISOString(),
        }),
      ],
    );
  });

  afterAll(async () => {
    await pool.query("DELETE FROM notifications WHERE id = $1", [NOTIF]);
    await pool.query("DELETE FROM workflow_runs WHERE id = $1", [RUN]);
    await pool.end();
  });

  it("returns the run's connected_storage_id on each entry", async () => {
    const rows = await repo.listRecentNotificationsWithAccount({ limit: 500 });
    const entry = rows.find((r) => r.notification.id === NOTIF);
    expect(entry).toBeDefined();
    expect(entry!.connectedStorageId).toBe(CS);
  });
});
