import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { initializeWorkflowPostgresSchema } from "./postgres.js";

/**
 * First-boot concurrency: many connections (the in-process worker + the first
 * HTTP requests, possibly in separate Next bundles each with its own pool) all
 * trigger schema creation against a brand-new empty DB at once. Plain
 * `CREATE TABLE IF NOT EXISTS` DDL is NOT concurrency-safe — it races on the
 * system catalogs (40P01 deadlock / 23505 pg_type unique-violation). The
 * advisory lock in initializeWorkflowPostgresSchema must make N concurrent inits
 * succeed deterministically.
 *
 * Requires a reachable Postgres (CREATEDB privilege). Skips when none is
 * configured/reachable, so the suite stays green in DB-less CI.
 */
const ADMIN_URL =
  process.env.MEDIA_TRACK_TEST_POSTGRES_ADMIN_URL ??
  process.env.MEDIA_TRACK_POSTGRES_URL ??
  "postgresql://mediatrack:mediatrack@localhost:5432/postgres";

async function postgresReachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const reachable = await postgresReachable();

describe.skipIf(!reachable)("initializeWorkflowPostgresSchema (concurrent first boot)", () => {
  const dbName = `wf_schema_init_test_${Date.now()}`.toLowerCase();
  let dbUrl = "";

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const u = new URL(ADMIN_URL);
    u.pathname = `/${dbName}`;
    dbUrl = u.toString();
  });

  afterAll(async () => {
    if (!reachable) return;
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  it("creates the schema from 16 concurrent connections with zero deadlocks/races", async () => {
    const CONCURRENCY = 16;
    const pools = Array.from({ length: CONCURRENCY }, () => {
      const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
      pool.on("error", () => {}); // backend terminated on teardown — irrelevant
      return pool;
    });
    try {
      const results = await Promise.allSettled(
        pools.map((pool) => initializeWorkflowPostgresSchema(pool)),
      );
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);

      // Schema is actually usable: a known table exists.
      const probe = pools[0]!;
      const { rows } = await probe.query("SELECT to_regclass('public.workflow_runs') AS t");
      expect(rows[0]?.t).toBe("workflow_runs");
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
    }
  });
});
