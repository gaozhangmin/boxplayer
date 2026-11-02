import { describe, expect, it } from "vitest";
import pg from "pg";
import { PostgresWorkflowRepository, createEpisodeStates } from "../src/index.js";
import type { AgentStep, MediaTitle, TrackedSeason } from "../src/index.js";

async function seedRun(
  repo: PostgresWorkflowRepository,
  opts: { runId: string; account: string; storage: string; tmdb: number },
): Promise<void> {
  const title = {
    id: `tmdb_tv_${opts.tmdb}`,
    tmdbId: opts.tmdb,
    type: "tv",
    title: `Show ${opts.tmdb}`,
    originalTitle: `Show ${opts.tmdb}`,
    year: 2026,
    aliases: [],
  } as unknown as MediaTitle;
  const season = {
    id: `tmdb_tv_${opts.tmdb}_s1`,
    mediaTitleId: `tmdb_tv_${opts.tmdb}`,
    seasonNumber: 1,
    status: "active",
    qualityPreference: "4K",
    storageDirectoryId: "dir",
    totalEpisodes: 1,
    latestAiredEpisode: 1,
    latestAiredSource: "metadata",
  } as unknown as TrackedSeason;
  await repo.saveWorkflowRunSnapshot({
    accountId: opts.account,
    connectedStorageId: opts.storage,
    title,
    season,
    workflowRun: {
      id: opts.runId,
      kind: "type2_init",
      status: "succeeded",
      trackedSeasonId: season.id,
      startedAt: "2026-06-22T00:00:00.000Z",
      finishedAt: "2026-06-22T00:01:00.000Z",
      auditEvents: [],
    },
    episodes: createEpisodeStates({ trackedSeasonId: season.id, seasonNumber: 1, totalEpisodes: 1, latestAiredEpisode: 1 }),
    resourceSnapshots: [],
    decisions: [],
    transferAttempts: [],
    notifications: [],
  });
}

async function cleanupRun(
  pool: pg.Pool,
  opts: { runId: string; tmdb: number; storage: string },
): Promise<void> {
  // Drive-scoped: tracked_seasons / episode_states are keyed by (…, connected_storage_id),
  // so delete only THIS drive's rows — never another drive's for the same season.
  const seasonId = `tmdb_tv_${opts.tmdb}_s1`;
  await pool.query("DELETE FROM agent_steps WHERE workflow_run_id = $1", [opts.runId]);
  await pool.query("DELETE FROM episode_states WHERE tracked_season_id = $1 AND connected_storage_id = $2", [seasonId, opts.storage]);
  await pool.query("DELETE FROM workflow_runs WHERE id = $1", [opts.runId]);
  await pool.query("DELETE FROM tracked_seasons WHERE id = $1 AND connected_storage_id = $2", [seasonId, opts.storage]);
  await pool.query("DELETE FROM media_titles WHERE id = $1", [`tmdb_tv_${opts.tmdb}`]);
}

const URL = process.env.MEDIA_TRACK_POSTGRES_URL;
const d = URL ? describe : describe.skip;

function step(ordinal: number, toolName: string, apiCalls?: number): AgentStep {
  return {
    ordinal,
    toolName,
    args: { keyword: "莉可丽丝" },
    activity: "搜",
    phase: "search",
    ...(apiCalls === undefined ? {} : { apiCalls }),
    at: "2026-06-22T00:00:00.000Z",
  };
}

d("Postgres agent steps", () => {
  it("appends and lists ordered, idempotent on (run, ordinal)", async () => {
    const pool = new pg.Pool({ connectionString: URL });
    const repo = new PostgresWorkflowRepository(pool);
    const runId = `run_steps_${Date.now()}`;
    try {
      await repo.appendAgentStep(runId, step(1, "transferCandidate", 50));
      await repo.appendAgentStep(runId, step(0, "searchResources", 3));
      // duplicate ordinal must not throw (ON CONFLICT DO NOTHING)
      await repo.appendAgentStep(runId, step(0, "searchResources", 999));
      const steps = await repo.listAgentSteps(runId);
      expect(steps.map((s) => s.ordinal)).toEqual([0, 1]);
      expect(steps[0]!.apiCalls).toBe(3);
      expect(steps[0]!.args.keyword).toBe("莉可丽丝");
      expect(steps[1]!.toolName).toBe("transferCandidate");
    } finally {
      await pool.query("DELETE FROM agent_steps WHERE workflow_run_id = $1", [runId]);
      await pool.end();
    }
  });

  it("scope-gates the trace: no/matching scope returns steps, wrong account returns []", async () => {
    const pool = new pg.Pool({ connectionString: URL });
    const repo = new PostgresWorkflowRepository(pool);
    const tmdb = 800000 + (Date.now() % 100000);
    const runId = `run_scope_${tmdb}`;
    try {
      await seedRun(repo, { runId, account: "acct_obs_a", storage: "cs_obs_x", tmdb });
      await repo.appendAgentStep(runId, step(0, "searchResources"));
      expect((await repo.listAgentSteps(runId)).length).toBe(1); // no scope
      expect((await repo.listAgentSteps(runId, { accountId: "acct_obs_a", connectedStorageId: "cs_obs_x" })).length).toBe(1); // in scope
      expect(await repo.listAgentSteps(runId, { accountId: "acct_other", connectedStorageId: null })).toEqual([]); // wrong account
      expect(await repo.listAgentSteps(runId, { accountId: "acct_obs_a", connectedStorageId: "cs_other" })).toEqual([]); // wrong drive
    } finally {
      await cleanupRun(pool, { runId, tmdb, storage: "cs_obs_x" });
      await pool.end();
    }
  });

  it("agent_steps survive a terminal re-persist (saveWorkflowRunSnapshot must NOT wipe the trace)", async () => {
    const pool = new pg.Pool({ connectionString: URL });
    const repo = new PostgresWorkflowRepository(pool);
    const tmdb = 810000 + (Date.now() % 90000);
    const runId = `run_persist_${tmdb}`;
    try {
      await seedRun(repo, { runId, account: "acct_obs_b", storage: "cs_obs_y", tmdb });
      await repo.appendAgentStep(runId, step(0, "searchResources"));
      await repo.appendAgentStep(runId, step(1, "markObtained"));
      expect((await repo.listAgentSteps(runId)).length).toBe(2);
      // The worker finalizes a completed run by re-persisting its snapshot. That path
      // (replaceWorkflowRunSnapshot → deleteWorkflowRunChildren) must NOT delete the
      // incrementally-written trace — the snapshot doesn't carry agent_steps to re-insert.
      await seedRun(repo, { runId, account: "acct_obs_b", storage: "cs_obs_y", tmdb });
      expect((await repo.listAgentSteps(runId)).map((s) => s.ordinal)).toEqual([0, 1]);
    } finally {
      await cleanupRun(pool, { runId, tmdb, storage: "cs_obs_y" });
      await pool.end();
    }
  });

  it("clearAgentSteps drops a prior attempt so a retry (same run id) re-traces from 0", async () => {
    const pool = new pg.Pool({ connectionString: URL });
    const repo = new PostgresWorkflowRepository(pool);
    const runId = `run_retry_${Date.now()}`;
    try {
      await repo.appendAgentStep(runId, step(0, "searchResources"));
      await repo.appendAgentStep(runId, step(1, "transferCandidate"));
      await repo.appendAgentStep(runId, step(2, "markObtained"));
      // retry: clear, then re-append from ordinal 0 (would otherwise be DROPPED by ON CONFLICT)
      await repo.clearAgentSteps(runId);
      await repo.appendAgentStep(runId, step(0, "reportNoCoverage"));
      const steps = await repo.listAgentSteps(runId);
      expect(steps.map((s) => s.ordinal)).toEqual([0]);
      expect(steps[0]!.toolName).toBe("reportNoCoverage");
    } finally {
      await pool.query("DELETE FROM agent_steps WHERE workflow_run_id = $1", [runId]);
      await pool.end();
    }
  });
});
