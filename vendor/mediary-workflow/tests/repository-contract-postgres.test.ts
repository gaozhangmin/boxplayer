import { afterAll, describe, it } from "vitest";
import pg from "pg";
import { createPostgresWorkflowRepositorySync } from "../src/postgres.js";
import { runRepositoryContract } from "./repository-contract.js";
import type { WorkflowRepository } from "../src/repository.js";

/**
 * The anti-divergence ARBITER: run the SAME shared contract against a REAL
 * Postgres, proving SQLite ≡ Postgres for every behavior the contract asserts
 * (Postgres is production truth). Skips cleanly when no Postgres is reachable so
 * DB-less CI stays green; run locally against the dev Postgres to verify parity.
 */
// This test CREATE/DROPs a throwaway database, so it deliberately does NOT fall back to
// MEDIA_TRACK_POSTGRES_URL (the runtime/prod connection) — pointing that at a shared or
// production DB and running the suite must never let it create/drop databases there. Use
// an explicit test-only admin URL, else the local dev default (which requires CREATEDB).
const ADMIN_URL =
  process.env.MEDIA_TRACK_TEST_POSTGRES_ADMIN_URL ??
  "postgresql://mediatrack:mediatrack@localhost:5432/postgres";

// Every table the workflow schema owns — TRUNCATE between make()s for a fresh repo.
const TABLES = [
  "media_titles",
  "tracked_seasons",
  "workflow_runs",
  "episode_states",
  "resource_snapshots",
  "agent_decisions",
  "agent_steps",
  "transfer_attempts",
  "notifications",
  "app_settings",
  "dead_links",
  "accounts",
  "sessions",
  "connected_storages",
  "account_settings",
];

async function postgresReachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    // Always release the socket (best-effort) so a partial connect can't leak a
    // handle and make Vitest hang on open sockets.
    await client.end().catch(() => {});
  }
}

const reachable = await postgresReachable();

// Provision a dedicated throwaway database. If PG is reachable but the user lacks
// CREATEDB (common on managed/shared instances), CREATE DATABASE throws — capture it
// and skip cleanly instead of hard-failing the whole test file at import time.
interface PgHarness {
  dbName: string;
  repository: ReturnType<typeof createPostgresWorkflowRepositorySync>;
  resetPool: pg.Pool;
}
let harness: PgHarness | null = null;
let setupError: string | null = null;

if (reachable) {
  const dbName = `wf_contract_${Date.now()}`.toLowerCase();
  try {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    try {
      await admin.connect();
      await admin.query(`CREATE DATABASE ${dbName}`);
    } finally {
      // Close the admin socket even if CREATE DATABASE throws (e.g. no CREATEDB),
      // so a skipped suite can't leak a connection and keep the process alive.
      await admin.end().catch(() => {});
    }
    const dbUrl = (() => {
      const u = new URL(ADMIN_URL);
      u.pathname = `/${dbName}`;
      return u.toString();
    })();
    harness = {
      dbName,
      repository: createPostgresWorkflowRepositorySync({ connectionString: dbUrl }),
      resetPool: new pg.Pool({ connectionString: dbUrl }),
    };
  } catch (error) {
    setupError = error instanceof Error ? error.message : String(error);
  }
}

if (!harness) {
  const reason = !reachable
    ? "no DB reachable — set MEDIA_TRACK_TEST_POSTGRES_ADMIN_URL (or run a local dev Postgres)"
    : `could not provision a test database (the admin user needs CREATEDB): ${setupError}`;
  describe.skip(`WorkflowRepository contract: Postgres (${reason})`, () => {
    it("skipped", () => {});
  });
} else {
  const { dbName, repository, resetPool } = harness;

  async function truncateAll(): Promise<void> {
    await resetPool.query(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    // Re-seed acct_default exactly like the schema DDL does (mirrors SQLite, which
    // also seeds it), so all engines start each test from identical state.
    await resetPool.query(
      "INSERT INTO accounts (id, username, password_hash, is_owner, created_at) " +
        "VALUES ('acct_default', 'default', '', true, '1970-01-01T00:00:00.000Z') ON CONFLICT (id) DO NOTHING",
    );
  }

  afterAll(async () => {
    await resetPool.end();
    // The repository pool must close before the DB can be dropped.
    await (repository as unknown as { pool: pg.Pool }).pool.end();
    const dropAdmin = new pg.Client({ connectionString: ADMIN_URL });
    await dropAdmin.connect();
    await dropAdmin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await dropAdmin.end();
  });

  runRepositoryContract("Postgres", {
    make: async (): Promise<WorkflowRepository> => {
      // First call also lazily creates the schema (repository.ensureSchema on first query).
      // A no-op query forces schema init before the truncate.
      await repository.getSetting("__schema_init__");
      await truncateAll();
      return repository;
    },
  });
}
