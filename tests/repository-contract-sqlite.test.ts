import { describe, it, expect } from "vitest";
import { createSqliteWorkflowRepository, SqliteWorkflowRepository } from "../src/sqlite.js";
import { runRepositoryContract } from "./repository-contract.js";
import { workflowPersistenceFixture } from "./workflow-fixtures.js";

// Use an in-memory DB per repo: the contract needs a fresh empty store, not file
// semantics, so ":memory:" avoids leaving hundreds of /tmp/ms-sqlite-* dirs behind.
// (better-sqlite3 gives each connection its own private in-memory database.)
function makeSqliteRepo(): SqliteWorkflowRepository {
  return createSqliteWorkflowRepository({ path: ":memory:" });
}

runRepositoryContract("SQLite", {
  make: makeSqliteRepo,
  teardown: (repo) => {
    (repo as SqliteWorkflowRepository).close();
  },
});

// SQLite-specific: the shared contract can't assert nextAttemptAt gating because the
// InMemory oracle intentionally does NOT gate (pure FIFO), while Postgres AND SQLite do
// (via claimableQueuedRuns). This locks the PRODUCTION engine's gate directly — and, more
// SQLite-specifically, proves nextAttemptAt survives the JSON *text* payload round-trip so
// the gate can actually see it.
describe("SQLite claim honors nextAttemptAt backoff gate", () => {
  const base = workflowPersistenceFixture();
  const gatedRun = (nextAttemptAt: string) => ({
    ...base,
    workflowRun: {
      ...base.workflowRun,
      id: "run_gated",
      status: "queued" as const,
      finishedAt: null,
      autoRequeueCount: 1,
      nextAttemptAt,
      startedAt: "2026-07-05T00:00:00.000Z",
    },
    // child rows are validated to belong to workflowRun.id; drop them since we
    // re-id the run and this test only exercises claim gating.
    transferAttempts: [],
    notifications: [],
  });

  it("skips a queued run until now reaches its nextAttemptAt, then claims it", async () => {
    const repo = makeSqliteRepo();
    try {
      await repo.saveWorkflowRunSnapshot(gatedRun("2026-07-05T06:00:00.000Z"));
      // Before the backoff deadline: not yet claimable.
      expect(await repo.claimNextQueuedWorkflowRun({ kind: base.workflowRun.kind, now: "2026-07-05T05:59:59.000Z" })).toBeNull();
      // At/after the deadline: claimed (proves nextAttemptAt round-tripped through the text payload).
      const claimed = await repo.claimNextQueuedWorkflowRun({ kind: base.workflowRun.kind, now: "2026-07-05T06:00:00.000Z" });
      expect(claimed?.workflowRun.id).toBe("run_gated");
      expect(claimed?.workflowRun.status).toBe("running");
    } finally {
      repo.close();
    }
  });
});

// SQLite-specific: appendAgentStep is idempotent on (workflow_run_id, ordinal)
// (ON CONFLICT DO NOTHING), so a re-appended ordinal is a no-op. The InMemory oracle
// intentionally just pushes (no dedup), so this invariant can't live in the shared
// contract — it's asserted directly against the PRODUCTION engine here (mirrors
// agent-steps.pg for Postgres).
describe("SQLite appendAgentStep is idempotent on (run, ordinal)", () => {
  const step = (ordinal: number, toolName: string) => ({
    ordinal,
    toolName,
    args: { keyword: "x" },
    activity: "搜",
    phase: "search" as const,
    at: "2026-06-22T00:00:00.000Z",
  });

  it("ignores a duplicate ordinal append", async () => {
    const repo = makeSqliteRepo();
    try {
      const snapshot = workflowPersistenceFixture();
      await repo.saveWorkflowRunSnapshot(snapshot);
      const runId = snapshot.workflowRun.id;
      await repo.appendAgentStep(runId, step(0, "searchResources"));
      await repo.appendAgentStep(runId, step(1, "transferCandidate"));
      // Re-append ordinal 0 → no new row (ON CONFLICT DO NOTHING keeps the first).
      await repo.appendAgentStep(runId, step(0, "searchResources"));
      const steps = await repo.listAgentSteps(runId);
      expect(steps.map((s) => s.ordinal)).toEqual([0, 1]);
      expect(steps[0]!.toolName).toBe("searchResources");
    } finally {
      repo.close();
    }
  });
});

// SQLite-specific: backfillConnectedStorageId. This is a genuine engine divergence, so
// it can't live in the shared contract (see the note there). A null-storage persist
// collapses to the UNSCOPED_STORAGE sentinel; SQLite's backfill targets that sentinel
// and actively pins the row to the account's primary drive (Postgres targets literal
// NULL and is dead code post-persist). This locks the PRODUCTION (desktop) engine.
describe("SQLite backfillConnectedStorageId pins sentinel rows to the primary drive", () => {
  it("pins a storage-less row (and its episodes) to the account's earliest drive, idempotently", async () => {
    const repo = makeSqliteRepo();
    try {
      await repo.saveWorkflowRunSnapshot({
        ...workflowPersistenceFixture(),
        accountId: "acct_default",
        // connectedStorageId intentionally omitted → sentinel
      });
      await repo.upsertConnectedStorage({
        id: "cs_primary",
        accountId: "acct_default",
        provider: "pan115",
        providerUid: "uid_primary",
        payload: { cookie: "c" },
        createdAt: "2026-06-01T00:00:00.000Z",
      });

      // Before: the concrete-drive scope sees nothing (row is unscoped).
      expect(
        await repo.listTrackedSeasonStates({ accountId: "acct_default", connectedStorageId: "cs_primary" }),
      ).toHaveLength(0);

      expect(await repo.backfillConnectedStorageId()).toBe(1);

      const scoped = await repo.listTrackedSeasonStates({ accountId: "acct_default", connectedStorageId: "cs_primary" });
      expect(scoped.map((s) => s.season.id)).toEqual(["season_1"]);
      expect(scoped[0]?.connectedStorageId).toBe("cs_primary");
      expect(scoped[0]?.episodes.map((e) => e.episodeCode)).toEqual(["S01E01", "S01E02"]);
      // Idempotent.
      expect(await repo.backfillConnectedStorageId()).toBe(0);
    } finally {
      repo.close();
    }
  });
});
