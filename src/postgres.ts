import pg from "pg";
import type { Pool, PoolClient } from "pg";
import {
  DEFAULT_ACCOUNT_ID,
  episodeNumberFromCode,
  type AgentDecision,
  type AgentStep,
  type EpisodeState,
  type MediaTitle,
  type NotificationEvent,
  type ResourceSnapshot,
  type TrackedSeason,
  type TransferAttempt,
  type WorkflowKind,
  type WorkflowRun,
  type WorkflowRunProgress,
} from "./domain.js";
import {
  claimWorkflowRun,
  claimableQueuedRuns,
  cloneWorkflowValue,
  compareTrackedSeasonStates,
  expireWorkflowRun,
  retriedWorkflowRun,
  isActiveWorkflowStatus,
  type PersistedWorkflowRunSnapshot,
  type PersistWorkflowRunSnapshotInput,
  type ReserveWorkflowRunInput,
  type TrackedSeasonState,
  validateWorkflowRunSnapshot,
  withDerivedEpisodeSummaries,
  workflowSnapshotFromReservation,
  DuplicateUsernameError,
  UNSCOPED_STORAGE,
  type WorkflowRunReservationResult,
  type WorkflowRepository,
} from "./repository.js";
import type {
  Account,
  ConnectedStorage,
  Session,
  UpsertConnectedStorageInput,
} from "./account-credentials.js";
import { normalizeScope, scopeMatches, type ScopeArg, type WorkflowScope } from "./workflow-scope.js";
import { MAGNET_DEAD_LINK_TTL_MS } from "./acquisition-v2/dead-links.js";

type Queryable = Pool | PoolClient;

// Same coherent model as the SQLite repo: each table is id (+ scope cols) plus a
// jsonb `payload` holding the domain object. node-postgres returns jsonb columns
// already parsed, and `$n::jsonb` casts a JSON.stringify'd text param on insert.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS media_titles (
    id text PRIMARY KEY,
    payload jsonb NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tracked_seasons (
    id text PRIMARY KEY,
    media_title_id text NOT NULL,
    payload jsonb NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workflow_runs (
    id text PRIMARY KEY,
    tracked_season_id text NOT NULL,
    payload jsonb NOT NULL
  );
  CREATE TABLE IF NOT EXISTS episode_states (
    tracked_season_id text NOT NULL,
    episode_code text NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (tracked_season_id, episode_code)
  );
  CREATE TABLE IF NOT EXISTS resource_snapshots (
    id text PRIMARY KEY,
    workflow_run_id text NOT NULL,
    ordinal int NOT NULL,
    payload jsonb NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_decisions (
    workflow_run_id text NOT NULL,
    ordinal int NOT NULL,
    snapshot_id text NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (workflow_run_id, ordinal)
  );
  CREATE TABLE IF NOT EXISTS agent_steps (
    workflow_run_id text NOT NULL,
    ordinal int NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (workflow_run_id, ordinal)
  );
  CREATE TABLE IF NOT EXISTS transfer_attempts (
    id text PRIMARY KEY,
    workflow_run_id text NOT NULL,
    ordinal int NOT NULL,
    candidate_id text NOT NULL,
    payload jsonb NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    workflow_run_id text NOT NULL,
    ordinal int NOT NULL,
    payload jsonb NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY,
    value text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dead_links (
    key text PRIMARY KEY,
    kind text NOT NULL,
    reason text NOT NULL,
    permanent boolean NOT NULL DEFAULT true,
    expires_at text,
    recorded_at text NOT NULL
  );
  ALTER TABLE dead_links ADD COLUMN IF NOT EXISTS permanent boolean NOT NULL DEFAULT true;
  ALTER TABLE dead_links ADD COLUMN IF NOT EXISTS expires_at text;
  CREATE TABLE IF NOT EXISTS accounts (
    id text PRIMARY KEY,
    username text UNIQUE NOT NULL,
    password_hash text NOT NULL DEFAULT '',
    group_id text,
    is_owner boolean NOT NULL DEFAULT false,
    created_at text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id text PRIMARY KEY,
    account_id text NOT NULL,
    expires_at text NOT NULL,
    created_at text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS connected_storages (
    id text PRIMARY KEY,
    account_id text NOT NULL,
    provider text NOT NULL,
    provider_uid text NOT NULL,
    label text,
    payload jsonb NOT NULL,
    root_cid text,
    movies_cid text,
    tv_cid text,
    anime_cid text,
    created_at text NOT NULL,
    UNIQUE (provider, provider_uid)
  );
  CREATE TABLE IF NOT EXISTS account_settings (
    account_id text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    PRIMARY KEY (account_id, key)
  );
  ALTER TABLE tracked_seasons ADD COLUMN IF NOT EXISTS account_id text NOT NULL DEFAULT 'acct_default';
  ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS account_id text NOT NULL DEFAULT 'acct_default';
  ALTER TABLE tracked_seasons ADD COLUMN IF NOT EXISTS connected_storage_id text;
  ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS connected_storage_id text;
  ALTER TABLE connected_storages ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
  ALTER TABLE connected_storages ADD COLUMN IF NOT EXISTS frozen_reason text;
  ALTER TABLE connected_storages ADD COLUMN IF NOT EXISTS frozen_at text;
  INSERT INTO accounts (id, username, password_hash, is_owner, created_at)
    VALUES ('acct_default', 'default', '', true, now()::text)
    ON CONFLICT (id) DO NOTHING;
  -- Tree model: make connected_storage_id part of the tracked_seasons / episode_states
  -- primary key so the SAME title can be tracked independently on multiple drives.
  -- Idempotent + guarded; self-contained backfill so SET NOT NULL is safe regardless
  -- of when the separate backfillConnectedStorageId() runs.
  ALTER TABLE episode_states ADD COLUMN IF NOT EXISTS connected_storage_id text;
  -- 1) episodes inherit their season's drive
  UPDATE episode_states e SET connected_storage_id = ts.connected_storage_id
    FROM tracked_seasons ts WHERE e.tracked_season_id = ts.id AND e.connected_storage_id IS NULL;
  -- 2) null drive -> the account's earliest-created (primary) drive
  WITH primary_drive AS (
    SELECT DISTINCT ON (account_id) account_id, id FROM connected_storages ORDER BY account_id, created_at
  )
  UPDATE tracked_seasons t SET connected_storage_id = p.id FROM primary_drive p
    WHERE t.account_id = p.account_id AND t.connected_storage_id IS NULL;
  WITH primary_drive AS (
    SELECT DISTINCT ON (account_id) account_id, id FROM connected_storages ORDER BY account_id, created_at
  )
  UPDATE workflow_runs w SET connected_storage_id = p.id FROM primary_drive p
    WHERE w.account_id = p.account_id AND w.connected_storage_id IS NULL;
  -- episodes inherit again (their season may have just been pinned)
  UPDATE episode_states e SET connected_storage_id = ts.connected_storage_id
    FROM tracked_seasons ts WHERE e.tracked_season_id = ts.id AND e.connected_storage_id IS NULL;
  -- 3) anything still null (account with zero drives) -> sentinel, with a logged count (expected 0)
  DO $do$
  DECLARE n_ts int; n_wr int; n_ep int;
  BEGIN
    UPDATE tracked_seasons SET connected_storage_id = '__unscoped__' WHERE connected_storage_id IS NULL;
    GET DIAGNOSTICS n_ts = ROW_COUNT;
    UPDATE workflow_runs SET connected_storage_id = '__unscoped__' WHERE connected_storage_id IS NULL;
    GET DIAGNOSTICS n_wr = ROW_COUNT;
    UPDATE episode_states SET connected_storage_id = '__unscoped__' WHERE connected_storage_id IS NULL;
    GET DIAGNOSTICS n_ep = ROW_COUNT;
    IF n_ts > 0 OR n_wr > 0 OR n_ep > 0 THEN
      RAISE NOTICE 'drive-scope migration: % tracked_seasons / % workflow_runs / % episode_states fell back to __unscoped__ (expected 0)', n_ts, n_wr, n_ep;
    END IF;
  END $do$;
  -- 4) enforce NOT NULL now that no nulls remain
  ALTER TABLE tracked_seasons ALTER COLUMN connected_storage_id SET NOT NULL;
  ALTER TABLE episode_states ALTER COLUMN connected_storage_id SET NOT NULL;
  -- 5) swap the primary keys (only when the current PK does not yet include the drive)
  DO $do$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
      WHERE i.indrelid='tracked_seasons'::regclass AND i.indisprimary AND a.attname='connected_storage_id'
    ) THEN
      ALTER TABLE tracked_seasons DROP CONSTRAINT IF EXISTS tracked_seasons_pkey;
      ALTER TABLE tracked_seasons ADD PRIMARY KEY (id, connected_storage_id);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
      WHERE i.indrelid='episode_states'::regclass AND i.indisprimary AND a.attname='connected_storage_id'
    ) THEN
      ALTER TABLE episode_states DROP CONSTRAINT IF EXISTS episode_states_pkey;
      ALTER TABLE episode_states ADD PRIMARY KEY (tracked_season_id, connected_storage_id, episode_code);
    END IF;
  END $do$;
`;

/**
 * Fixed key for the Postgres advisory lock that serializes schema creation. Any
 * stable arbitrary value works; every DDL path against this database must agree
 * on it (see also the TMDB cache in apps/web, which reuses this key) so all
 * first-boot schema creation is mutually serialized through one lock.
 */
export const WORKFLOW_SCHEMA_ADVISORY_LOCK_KEY = 4_011_989_141;

/**
 * Create the schema, serialized across connections AND processes by a Postgres
 * advisory lock.
 *
 * `CREATE TABLE IF NOT EXISTS` (and the other IF-NOT-EXISTS DDL here) is NOT
 * concurrency-safe: two connections running this against a brand-new database at
 * once race on the system catalogs and one fails with a deadlock (40P01) or a
 * `pg_type`/`pg_class` unique-violation (23505). That only bites on the very
 * first boot of an empty DB — exactly the docker-compose first-run, where the
 * in-process worker and the first HTTP requests (possibly living in separate
 * Next bundles, each with its own pool) all trigger schema init together.
 *
 * `pg_advisory_xact_lock` makes it deterministic: the first connection takes the
 * lock and runs the DDL; the rest block on the lock and, once it's released at
 * COMMIT, run the same idempotent IF-NOT-EXISTS statements against the
 * now-existing schema (cheap no-ops). The lock is transaction-scoped, so it is
 * always released — even if the DDL throws and we roll back.
 */
export async function initializeWorkflowPostgresSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [WORKFLOW_SCHEMA_ADVISORY_LOCK_KEY]);
    await client.query(SCHEMA);
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Surface the original DDL error, not a secondary rollback failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function createPostgresWorkflowRepository(options: {
  connectionString: string;
}): Promise<PostgresWorkflowRepository> {
  const pool = new pg.Pool({ connectionString: options.connectionString });
  await initializeWorkflowPostgresSchema(pool);
  return new PostgresWorkflowRepository(pool, Promise.resolve());
}

/**
 * Synchronous construction for callers that can't await (e.g. the web app's
 * cached `getWorkflowRepository()` getter). The schema is created lazily on
 * first use.
 */
export function createPostgresWorkflowRepositorySync(options: {
  connectionString: string;
}): PostgresWorkflowRepository {
  return new PostgresWorkflowRepository(new pg.Pool({ connectionString: options.connectionString }));
}

export class PostgresWorkflowRepository implements WorkflowRepository {
  private schemaReady: Promise<void> | undefined;

  constructor(
    private readonly pool: Pool,
    alreadyInitialized?: Promise<void>,
  ) {
    this.schemaReady = alreadyInitialized;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Create the schema once, memoized — lets the repo be constructed without
   *  awaiting yet still self-initialize on first query. */
  private ensureSchema(): Promise<void> {
    return (this.schemaReady ??= initializeWorkflowPostgresSchema(this.pool));
  }

  async saveWorkflowRunSnapshot(input: PersistWorkflowRunSnapshotInput): Promise<void> {
    validateWorkflowRunSnapshot(input);
    const snapshot = cloneWorkflowValue(input);
    await this.withTransaction((client) => this.replaceWorkflowRunSnapshot(client, snapshot));
  }

  async reserveWorkflowRun(input: ReserveWorkflowRunInput): Promise<WorkflowRunReservationResult> {
    const snapshot = cloneWorkflowValue(workflowSnapshotFromReservation(input));
    validateWorkflowRunSnapshot(snapshot);
    const accountId = snapshot.accountId ?? DEFAULT_ACCOUNT_ID;
    const connectedStorageId = snapshot.connectedStorageId ?? UNSCOPED_STORAGE;

    return this.withTransaction(async (client) => {
      await this.expireStaleActiveWorkflowRuns(client, input);

      if (input.blockIfTitleHasActiveRun === true) {
        const titleActive = (await this.selectWorkflowRunsForTitle(client, snapshot.season.mediaTitleId, accountId, connectedStorageId))
          .filter((workflowRun) => isActiveWorkflowStatus(workflowRun.status))
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
        if (titleActive) {
          const activeSnapshot = await this.loadWorkflowRunSnapshot(client, titleActive.id);
          if (!activeSnapshot) {
            throw new Error(`Missing active workflow run ${titleActive.id}`);
          }
          return { status: "already_active", snapshot: activeSnapshot };
        }
      }

      const activeRun = (await this.selectWorkflowRuns(client, snapshot.season.id, connectedStorageId))
        .filter(
          (workflowRun) =>
            workflowRun.kind === snapshot.workflowRun.kind && isActiveWorkflowStatus(workflowRun.status),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      if (activeRun) {
        const activeSnapshot = await this.loadWorkflowRunSnapshot(client, activeRun.id);
        if (!activeSnapshot) {
          throw new Error(`Missing active workflow run ${activeRun.id}`);
        }
        return { status: "already_active", snapshot: activeSnapshot };
      }

      const existingEpisodes = await this.selectEpisodeStates(client, snapshot.season.id, connectedStorageId);
      if (input.blockIfEpisodeStatesExist === true && existingEpisodes.length > 0) {
        return { status: "already_has_episode_state", episodes: existingEpisodes };
      }

      await this.replaceWorkflowRunSnapshot(client, snapshot);
      return {
        status: "reserved",
        snapshot: withDerivedEpisodeSummaries(cloneWorkflowValue(snapshot)),
      };
    });
  }

  async getWorkflowRunSnapshot(
    workflowRunId: string,
    scopeArg: ScopeArg = undefined,
  ): Promise<PersistedWorkflowRunSnapshot | null> {
    const scope = normalizeScope(scopeArg);
    const snapshot = await this.loadWorkflowRunSnapshot(this.pool, workflowRunId);
    if (
      !snapshot ||
      snapshot.accountId !== scope.accountId ||
      (scope.connectedStorageId != null && snapshot.connectedStorageId !== scope.connectedStorageId)
    ) {
      return null;
    }
    return snapshot;
  }

  async claimNextQueuedWorkflowRun(input: {
    kind: WorkflowKind;
    now: string;
  }): Promise<PersistedWorkflowRunSnapshot | null> {
    const claimedRunId = await this.withTransaction(async (client) => {
      const queuedRun = claimableQueuedRuns(
        await this.allWorkflowRuns(client),
        input.kind,
        input.now,
      )[0];
      if (!queuedRun) {
        return null;
      }
      const claimedRun = claimWorkflowRun(queuedRun, input.now);
      await this.upsertWorkflowRun(client, claimedRun);
      return claimedRun.id;
    });
    // Cross-account: load the claimed run WITHOUT an account filter (the worker
    // drains every account's queue; the snapshot carries its own accountId).
    return claimedRunId ? this.loadWorkflowRunSnapshot(this.pool, claimedRunId) : null;
  }

  async requeueRunningWorkflowRuns(): Promise<number> {
    return this.withTransaction(async (client) => {
      const running = (await this.allWorkflowRuns(client)).filter(
        (workflowRun) => workflowRun.status === "running",
      );
      for (const workflowRun of running) {
        await this.upsertWorkflowRun(client, { ...workflowRun, status: "queued", finishedAt: null });
      }
      return running.length;
    });
  }

  async findActiveWorkflowRun(input: {
    trackedSeasonId: string;
    kind: WorkflowKind;
    accountId?: string;
    connectedStorageId?: string | null;
  }): Promise<PersistedWorkflowRunSnapshot | null> {
    const scope = normalizeScope(
      input.accountId === undefined
        ? undefined
        : { accountId: input.accountId, connectedStorageId: input.connectedStorageId ?? null },
    );
    await this.ensureSchema();
    // Scope-filter (account + storage) BEFORE picking the latest: with drive-independent
    // season ids the same season can be active on multiple drives, so taking the latest
    // across all drives and THEN dropping cross-storage could return null even though a
    // scoped active run exists on an older drive. Mirror the InMemory oracle.
    const result = await this.pool.query<{
      payload: WorkflowRun;
      account_id: string;
      connected_storage_id: string | null;
    }>(
      "SELECT payload, account_id, connected_storage_id FROM workflow_runs WHERE tracked_season_id = $1 AND account_id = $2",
      [input.trackedSeasonId, scope.accountId],
    );
    const latest = result.rows
      .filter((row) => {
        const rawStorage = row.connected_storage_id ?? null;
        const storage = rawStorage === UNSCOPED_STORAGE ? null : rawStorage;
        return (
          scopeMatches(scope, row.account_id ?? DEFAULT_ACCOUNT_ID, storage) &&
          row.payload.kind === input.kind &&
          isActiveWorkflowStatus(row.payload.status)
        );
      })
      .map((row) => row.payload)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    return latest ? this.getWorkflowRunSnapshot(latest.id, scope) : null;
  }

  async listActiveWorkflowRuns(
    scopeArg: ScopeArg = undefined,
  ): Promise<PersistedWorkflowRunSnapshot[]> {
    const scope = normalizeScope(scopeArg);
    const runs = (await this.allWorkflowRunsForAccount(this.pool, scope.accountId))
      .filter((workflowRun) => isActiveWorkflowStatus(workflowRun.status))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const snapshots: PersistedWorkflowRunSnapshot[] = [];
    for (const run of runs) {
      try {
        // Full scope drops runs on other storages of the same account.
        const snapshot = await this.getWorkflowRunSnapshot(run.id, scope);
        if (snapshot) {
          snapshots.push(snapshot);
        }
      } catch {
        // Orphaned/inconsistent run — skip rather than crash callers.
      }
    }
    return snapshots;
  }

  async updateWorkflowRunProgress(workflowRunId: string, progress: WorkflowRunProgress): Promise<void> {
    await this.withTransaction(async (client) => {
      const run = await this.selectOne<WorkflowRun>(
        client,
        "SELECT payload FROM workflow_runs WHERE id = $1",
        [workflowRunId],
      );
      if (!run) {
        return;
      }
      const previousPercent = run.progress?.percent ?? 0;
      await this.upsertWorkflowRun(client, {
        ...run,
        progress: { ...progress, percent: Math.max(previousPercent, progress.percent) },
      });
    });
  }

  async appendAgentStep(workflowRunId: string, step: AgentStep): Promise<void> {
    // Hot path: fires once per agent tool call, in parallel across runs. A single
    // autocommit INSERT on the pool — no BEGIN/COMMIT/connect overhead of a tx.
    await this.ensureSchema();
    await this.pool.query(
      "INSERT INTO agent_steps (workflow_run_id, ordinal, payload) VALUES ($1, $2, $3::jsonb) " +
        "ON CONFLICT (workflow_run_id, ordinal) DO NOTHING",
      [workflowRunId, step.ordinal, json(step)],
    );
  }

  async listAgentSteps(workflowRunId: string, scopeArg: ScopeArg = undefined): Promise<AgentStep[]> {
    // Scope gate reads ONLY the run's two ownership columns — not the full snapshot
    // (season/title/episodes/...) the old getWorkflowRunSnapshot load pulled in.
    if (scopeArg !== undefined && !(await this.runMatchesScope(workflowRunId, scopeArg))) {
      return [];
    }
    return this.selectMany<AgentStep>(
      this.pool,
      "SELECT payload FROM agent_steps WHERE workflow_run_id = $1 ORDER BY ordinal",
      [workflowRunId],
    );
  }

  /** Lightweight (account, storage) visibility check for a run: reads just the two
   *  scope columns and applies the same scopeMatches predicate as everywhere else.
   *  Fail-closed — an unknown run is not visible to any scope. */
  private async runMatchesScope(workflowRunId: string, scopeArg: ScopeArg): Promise<boolean> {
    const scope = normalizeScope(scopeArg);
    await this.ensureSchema();
    const row = await this.pool.query(
      "SELECT account_id, connected_storage_id FROM workflow_runs WHERE id = $1",
      [workflowRunId],
    );
    const owner = row.rows[0];
    if (!owner) {
      return false;
    }
    const ownerAccount = (owner.account_id as string | undefined) ?? DEFAULT_ACCOUNT_ID;
    const ownerStorage = (owner.connected_storage_id as string | null | undefined) ?? null;
    return scopeMatches(scope, ownerAccount, ownerStorage);
  }

  async clearAgentSteps(workflowRunId: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query("DELETE FROM agent_steps WHERE workflow_run_id = $1", [workflowRunId]);
  }

  async cancelQueuedWorkflowRun(
    workflowRunId: string,
    scopeArg: ScopeArg = undefined,
  ): Promise<{ status: "cancelled" | "not_cancellable" }> {
    const scope = normalizeScope(scopeArg);
    return this.withTransaction(async (client) => {
      await this.ensureSchema();
      const row = await client.query(
        "SELECT payload, account_id, connected_storage_id FROM workflow_runs WHERE id = $1",
        [workflowRunId],
      );
      const run = (row.rows[0]?.payload as WorkflowRun | undefined) ?? null;
      const owner = (row.rows[0]?.account_id as string | undefined) ?? DEFAULT_ACCOUNT_ID;
      const ownerStorage = (row.rows[0]?.connected_storage_id as string | null | undefined) ?? null;
      if (
        !run ||
        owner !== scope.accountId ||
        (scope.connectedStorageId != null && ownerStorage !== scope.connectedStorageId) ||
        run.status !== "queued"
      ) {
        return { status: "not_cancellable" as const };
      }
      const seasonId = run.trackedSeasonId;
      // Tree model: the (season, drive) being torn down — never touch another drive.
      const storageValue = ownerStorage ?? UNSCOPED_STORAGE;
      // The run's own children.
      await client.query("DELETE FROM notifications WHERE workflow_run_id = $1", [workflowRunId]);
      await client.query("DELETE FROM transfer_attempts WHERE workflow_run_id = $1", [workflowRunId]);
      await client.query("DELETE FROM agent_decisions WHERE workflow_run_id = $1", [workflowRunId]);
      await client.query("DELETE FROM agent_steps WHERE workflow_run_id = $1", [workflowRunId]);
      await client.query("DELETE FROM resource_snapshots WHERE workflow_run_id = $1", [workflowRunId]);
      await client.query("DELETE FROM workflow_runs WHERE id = $1", [workflowRunId]);

      // Only tear down the tracking when no OTHER run on the SAME (season, drive)
      // still references it (a queued init is the sole run for its fresh season →
      // torn down, vanishing from the library; a re-queued run beside acquired
      // history is not). Scoped to this drive so another drive's tracking survives.
      const others = await client.query(
        "SELECT 1 FROM workflow_runs WHERE tracked_season_id = $1 AND connected_storage_id = $2 LIMIT 1",
        [seasonId, storageValue],
      );
      if (others.rowCount === 0) {
        await this.teardownSeasonScoped(client, seasonId, storageValue);
      }
      return { status: "cancelled" as const };
    });
  }

  /** Tear down one (season, drive): delete its episodes + tracked_seasons row, then
   *  delete the global media_titles row only when NO tracked_seasons reference that
   *  title anywhere (another drive tracking the same show must survive). Shared by
   *  cancelQueuedWorkflowRun and untrackTitle. */
  private async teardownSeasonScoped(
    client: PoolClient,
    seasonId: string,
    storageValue: string,
  ): Promise<void> {
    await client.query(
      "DELETE FROM episode_states WHERE tracked_season_id = $1 AND connected_storage_id = $2",
      [seasonId, storageValue],
    );
    const season = await this.selectOne<TrackedSeason>(
      client,
      "SELECT payload FROM tracked_seasons WHERE id = $1 AND connected_storage_id = $2",
      [seasonId, storageValue],
    );
    await client.query("DELETE FROM tracked_seasons WHERE id = $1 AND connected_storage_id = $2", [
      seasonId,
      storageValue,
    ]);
    if (season) {
      const siblingSeasons = await client.query(
        "SELECT 1 FROM tracked_seasons WHERE media_title_id = $1 LIMIT 1",
        [season.mediaTitleId],
      );
      if (siblingSeasons.rowCount === 0) {
        await client.query("DELETE FROM media_titles WHERE id = $1", [season.mediaTitleId]);
      }
    }
  }

  async untrackTitle(
    tmdbId: number,
    scope: WorkflowScope,
    mediaKind: "movie" | "tv",
    seasonNumber?: number,
  ): Promise<{ status: "untracked" | "not_found" | "in_flight"; removedSeasons: number }> {
    // Enumerate this drive's target seasons for the title (reuse scoped read).
    // Match mediaKind too: TMDB movie/tv id namespaces collide (movie 278 ≠ tv 278),
    // so filtering by numeric tmdbId alone would untrack the wrong title. "tv"
    // covers both tv and anime (same tv namespace).
    const wantMovie = mediaKind === "movie";
    const states = (await this.listTrackedSeasonStates(scope)).filter(
      (state) =>
        state.title.tmdbId === tmdbId &&
        (state.title.type === "movie") === wantMovie &&
        (seasonNumber === undefined || state.season.seasonNumber === seasonNumber),
    );
    if (states.length === 0) {
      return { status: "not_found", removedSeasons: 0 };
    }
    const targetSeasonIds = states.map((state) => state.season.id);
    const storageValue = scope.connectedStorageId ?? UNSCOPED_STORAGE;

    return this.withTransaction(async (client) => {
      await this.ensureSchema();
      // In-flight guard: a running run on any target season → refuse, delete nothing.
      const running = await client.query(
        "SELECT 1 FROM workflow_runs WHERE tracked_season_id = ANY($1) AND connected_storage_id = $2 " +
          "AND payload->>'status' = 'running' LIMIT 1",
        [targetSeasonIds, storageValue],
      );
      if ((running.rowCount ?? 0) > 0) {
        return { status: "in_flight" as const, removedSeasons: 0 };
      }
      // For each season: delete all run children + runs, then tear down the season.
      for (const seasonId of targetSeasonIds) {
        const runIdsSub =
          "(SELECT id FROM workflow_runs WHERE tracked_season_id = $1 AND connected_storage_id = $2)";
        await client.query(`DELETE FROM notifications WHERE workflow_run_id IN ${runIdsSub}`, [
          seasonId,
          storageValue,
        ]);
        await client.query(`DELETE FROM transfer_attempts WHERE workflow_run_id IN ${runIdsSub}`, [
          seasonId,
          storageValue,
        ]);
        await client.query(`DELETE FROM agent_decisions WHERE workflow_run_id IN ${runIdsSub}`, [
          seasonId,
          storageValue,
        ]);
        await client.query(`DELETE FROM agent_steps WHERE workflow_run_id IN ${runIdsSub}`, [
          seasonId,
          storageValue,
        ]);
        await client.query(`DELETE FROM resource_snapshots WHERE workflow_run_id IN ${runIdsSub}`, [
          seasonId,
          storageValue,
        ]);
        await client.query(
          "DELETE FROM workflow_runs WHERE tracked_season_id = $1 AND connected_storage_id = $2",
          [seasonId, storageValue],
        );
        await this.teardownSeasonScoped(client, seasonId, storageValue);
      }
      return { status: "untracked" as const, removedSeasons: targetSeasonIds.length };
    });
  }

  async retryFailedWorkflowRun(
    workflowRunId: string,
    scopeArg: ScopeArg = undefined,
  ): Promise<{ status: "retried" | "not_retriable" }> {
    const scope = normalizeScope(scopeArg);
    return this.withTransaction(async (client) => {
      await this.ensureSchema();
      const row = await client.query(
        "SELECT payload, account_id, connected_storage_id FROM workflow_runs WHERE id = $1",
        [workflowRunId],
      );
      const run = (row.rows[0]?.payload as WorkflowRun | undefined) ?? null;
      const owner = (row.rows[0]?.account_id as string | undefined) ?? DEFAULT_ACCOUNT_ID;
      const ownerStorage = (row.rows[0]?.connected_storage_id as string | null | undefined) ?? null;
      if (
        !run ||
        owner !== scope.accountId ||
        (scope.connectedStorageId != null && ownerStorage !== scope.connectedStorageId) ||
        run.status !== "failed"
      ) {
        return { status: "not_retriable" as const };
      }
      // account_id / connected_storage_id are preserved on conflict by upsert.
      await this.upsertWorkflowRun(client, retriedWorkflowRun(run, new Date().toISOString()));
      return { status: "retried" as const };
    });
  }

  async getTrackedSeasonState(
    trackedSeasonId: string,
    scopeArg: ScopeArg = undefined,
  ): Promise<TrackedSeasonState | null> {
    const scope = normalizeScope(scopeArg);
    await this.ensureSchema();
    const result = await this.pool.query(
      "SELECT payload, connected_storage_id FROM tracked_seasons " +
        "WHERE id = $1 AND account_id = $2 AND ($3::text IS NULL OR connected_storage_id = $3)",
      [trackedSeasonId, scope.accountId, scope.connectedStorageId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const season = row.payload as TrackedSeason;
    const title = await this.requireTitle(this.pool, season);
    return {
      accountId: scope.accountId,
      connectedStorageId: (row.connected_storage_id as string | null | undefined) ?? null,
      title,
      season,
      episodes: await this.selectEpisodeStates(this.pool, season.id, (row.connected_storage_id as string | null) ?? UNSCOPED_STORAGE),
    };
  }

  async listTrackedSeasonStates(
    scopeArg: ScopeArg = undefined,
  ): Promise<TrackedSeasonState[]> {
    const scope = normalizeScope(scopeArg);
    await this.ensureSchema();
    const result = await this.pool.query(
      "SELECT payload, connected_storage_id FROM tracked_seasons " +
        "WHERE account_id = $1 AND ($2::text IS NULL OR connected_storage_id = $2)",
      [scope.accountId, scope.connectedStorageId],
    );
    const states: TrackedSeasonState[] = [];
    for (const row of result.rows) {
      const season = row.payload as TrackedSeason;
      states.push({
        accountId: scope.accountId,
        connectedStorageId: (row.connected_storage_id as string | null | undefined) ?? null,
        title: await this.requireTitle(this.pool, season),
        season,
        episodes: await this.selectEpisodeStates(this.pool, season.id, (row.connected_storage_id as string | null) ?? UNSCOPED_STORAGE),
      });
    }
    return states.sort(compareTrackedSeasonStates);
  }

  async listAllTrackedSeasonStates(): Promise<TrackedSeasonState[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      "SELECT payload, account_id, connected_storage_id FROM tracked_seasons",
    );
    const states: TrackedSeasonState[] = [];
    for (const row of result.rows) {
      const season = row.payload as TrackedSeason;
      const accountId = (row.account_id as string | undefined) ?? DEFAULT_ACCOUNT_ID;
      states.push({
        accountId,
        connectedStorageId: (row.connected_storage_id as string | null | undefined) ?? null,
        title: await this.requireTitle(this.pool, season),
        season,
        episodes: await this.selectEpisodeStates(this.pool, season.id, (row.connected_storage_id as string | null) ?? UNSCOPED_STORAGE),
      });
    }
    return states.sort(compareTrackedSeasonStates);
  }

  async listEpisodeStates(
    trackedSeasonId: string,
    scopeArg: ScopeArg = undefined,
  ): Promise<EpisodeState[]> {
    // Episodes carry their own connected_storage_id now; join the season on BOTH
    // (id, storage) so each episode attributes to its own drive's season row, then
    // gate the account (episode_states has no account column) and optional storage.
    const scope = normalizeScope(scopeArg);
    const episodes = await this.selectMany<EpisodeState>(
      this.pool,
      "SELECT e.payload AS payload FROM episode_states e " +
        "JOIN tracked_seasons ts ON e.tracked_season_id = ts.id AND e.connected_storage_id = ts.connected_storage_id " +
        "WHERE e.tracked_season_id = $1 AND ts.account_id = $2 " +
        "AND ($3::text IS NULL OR e.connected_storage_id = $3)",
      [trackedSeasonId, scope.accountId, scope.connectedStorageId],
    );
    return episodes.sort((a, b) => episodeNumberFromCode(a.episodeCode) - episodeNumberFromCode(b.episodeCode));
  }

  async listNotifications(input?: {
    limit?: number;
    accountId?: string;
    connectedStorageId?: string | null;
    since?: string;
  }): Promise<NotificationEvent[]> {
    const scope = normalizeScope(
      input?.accountId === undefined
        ? undefined
        : { accountId: input.accountId, connectedStorageId: input.connectedStorageId ?? null },
    );
    // ISO-8601 UTC timestamps sort lexicographically = chronologically, so a string
    // `>=` on payload->>'createdAt' is a correct (and indexable) recency cutoff.
    const all = await this.selectMany<NotificationEvent>(
      this.pool,
      "SELECT n.payload AS payload FROM notifications n " +
        "JOIN workflow_runs wr ON n.workflow_run_id = wr.id " +
        "WHERE wr.account_id = $1 AND ($2::text IS NULL OR wr.connected_storage_id = $2) " +
        "AND ($3::text IS NULL OR (n.payload->>'createdAt') >= $3)",
      [scope.accountId, scope.connectedStorageId, input?.since ?? null],
    );
    all.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return all.slice(0, input?.limit ?? 100);
  }

  async listRecentNotificationsWithAccount(input?: {
    limit?: number;
  }): Promise<Array<{ accountId: string; connectedStorageId: string | null; notification: NotificationEvent }>> {
    await this.ensureSchema();
    const result = await this.pool.query(
      "SELECT n.payload AS payload, wr.account_id AS account_id, wr.connected_storage_id AS connected_storage_id FROM notifications n " +
        "JOIN workflow_runs wr ON n.workflow_run_id = wr.id",
    );
    const rows = result.rows.map((row) => {
      const rawStorage = (row.connected_storage_id as string | null | undefined) ?? null;
      return {
        accountId: (row.account_id as string | undefined) ?? DEFAULT_ACCOUNT_ID,
        // Collapse the internal sentinel back to null, same as loadWorkflowRunSnapshot:
        // callers must never observe UNSCOPED_STORAGE.
        connectedStorageId: rawStorage === UNSCOPED_STORAGE ? null : rawStorage,
        notification: row.payload as NotificationEvent,
      };
    });
    rows.sort((left, right) => right.notification.createdAt.localeCompare(left.notification.createdAt));
    return rows.slice(0, input?.limit ?? 100);
  }

  async getSetting(key: string): Promise<string | null> {
    await this.ensureSchema();
    const result = await this.pool.query("SELECT value FROM app_settings WHERE key = $1", [key]);
    return result.rows[0]?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [key, value],
    );
  }

  async getAccountSetting(accountId: string, key: string): Promise<string | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      "SELECT value FROM account_settings WHERE account_id = $1 AND key = $2",
      [accountId, key],
    );
    return result.rows[0]?.value ?? null;
  }

  async setAccountSetting(accountId: string, key: string, value: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      "INSERT INTO account_settings (account_id, key, value) VALUES ($1, $2, $3) " +
        "ON CONFLICT (account_id, key) DO UPDATE SET value = EXCLUDED.value",
      [accountId, key, value],
    );
  }

  async backfillConnectedStorageId(): Promise<number> {
    await this.ensureSchema();
    // Each account's earliest-created drive is its primary (root) workspace; pin
    // every legacy null-storage row to it. Accounts with no drive are skipped
    // (no matching row in the primary CTE). Idempotent: only null rows are touched.
    const primaryCte =
      "WITH primary_drive AS (" +
      "SELECT DISTINCT ON (account_id) account_id, id FROM connected_storages " +
      "ORDER BY account_id, created_at" +
      ") ";
    const ts = await this.pool.query(
      primaryCte +
        "UPDATE tracked_seasons t SET connected_storage_id = p.id FROM primary_drive p " +
        "WHERE t.account_id = p.account_id AND t.connected_storage_id IS NULL",
    );
    const wr = await this.pool.query(
      primaryCte +
        "UPDATE workflow_runs w SET connected_storage_id = p.id FROM primary_drive p " +
        "WHERE w.account_id = p.account_id AND w.connected_storage_id IS NULL",
    );
    return (ts.rowCount ?? 0) + (wr.rowCount ?? 0);
  }

  async listConnectedStorages(accountId: string): Promise<ConnectedStorage[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      "SELECT id, account_id, provider, provider_uid, label, payload, root_cid, movies_cid, tv_cid, anime_cid, status, frozen_reason, frozen_at, created_at " +
        "FROM connected_storages WHERE account_id = $1 ORDER BY created_at",
      [accountId],
    );
    return result.rows.map((row) => connectedStorageFromRow(row));
  }

  async upsertConnectedStorage(row: UpsertConnectedStorageInput): Promise<void> {
    await this.ensureSchema();
    // Instance-wide UNIQUE(provider, provider_uid) ownership: on conflict NEVER
    // reassign account_id, and only refresh the row when the SAME account owns it
    // (the WHERE makes a cross-account conflict a no-op — it can't steal or
    // overwrite another account's 网盘). The binding path rejects first; this is
    // the DB-level backstop.
    await this.pool.query(
      "INSERT INTO connected_storages " +
        "(id, account_id, provider, provider_uid, label, payload, root_cid, movies_cid, tv_cid, anime_cid, created_at) " +
        "VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11) " +
        "ON CONFLICT (provider, provider_uid) DO UPDATE SET " +
        "label = EXCLUDED.label, payload = EXCLUDED.payload, " +
        "root_cid = EXCLUDED.root_cid, movies_cid = EXCLUDED.movies_cid, tv_cid = EXCLUDED.tv_cid, anime_cid = EXCLUDED.anime_cid " +
        "WHERE connected_storages.account_id = EXCLUDED.account_id",
      [
        row.id,
        row.accountId,
        row.provider,
        row.providerUid,
        row.label ?? null,
        json(row.payload),
        row.rootCid ?? null,
        row.moviesCid ?? null,
        row.tvCid ?? null,
        row.animeCid ?? null,
        row.createdAt,
      ],
    );
  }

  async deleteConnectedStorage(accountId: string, storageId: string): Promise<void> {
    await this.ensureSchema();
    // Only the drive row (incl. its cookie) is removed. Tracking tables key on
    // (account_id, connected_storage_id) and have NO FK to connected_storages, so
    // their rows persist; re-binding the same drive (same cs_id) reconnects them.
    // account_id in the WHERE is fail-closed: can't delete another account's drive.
    await this.pool.query("DELETE FROM connected_storages WHERE id = $1 AND account_id = $2", [
      storageId,
      accountId,
    ]);
  }

  async findConnectedStorageByUid(
    provider: string,
    providerUid: string,
  ): Promise<ConnectedStorage | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      "SELECT id, account_id, provider, provider_uid, label, payload, root_cid, movies_cid, tv_cid, anime_cid, status, frozen_reason, frozen_at, created_at " +
        "FROM connected_storages WHERE provider = $1 AND provider_uid = $2",
      [provider, providerUid],
    );
    const row = result.rows[0];
    return row ? connectedStorageFromRow(row) : null;
  }

  async setConnectedStorageStatus(
    storageId: string,
    status: "active" | "frozen",
    frozenReason: string | null,
    frozenAt: string | null,
  ): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      "UPDATE connected_storages SET status = $2, frozen_reason = $3, frozen_at = $4 WHERE id = $1",
      [storageId, status, frozenReason, frozenAt],
    );
  }

  async createAccount(account: Account): Promise<void> {
    await this.ensureSchema();
    try {
      await this.pool.query(
        "INSERT INTO accounts (id, username, password_hash, group_id, is_owner, created_at) " +
          "VALUES ($1, $2, $3, $4, $5, $6)",
        [account.id, account.username, account.passwordHash, account.groupId, account.isOwner, account.createdAt],
      );
    } catch (error) {
      // 23505 = unique_violation (username UNIQUE).
      if (error && typeof error === "object" && (error as { code?: string }).code === "23505") {
        throw new DuplicateUsernameError(account.username);
      }
      throw error;
    }
  }

  async getAccountByUsername(username: string): Promise<Account | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      "SELECT id, username, password_hash, group_id, is_owner, created_at FROM accounts WHERE username = $1",
      [username],
    );
    const row = result.rows[0];
    return row ? accountFromRow(row) : null;
  }

  async getAccountById(id: string): Promise<Account | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      "SELECT id, username, password_hash, group_id, is_owner, created_at FROM accounts WHERE id = $1",
      [id],
    );
    const row = result.rows[0];
    return row ? accountFromRow(row) : null;
  }

  async listAccounts(): Promise<Account[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      "SELECT id, username, password_hash, group_id, is_owner, created_at FROM accounts ORDER BY created_at",
    );
    return result.rows.map((row) => accountFromRow(row));
  }

  async createSession(session: Session): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      "INSERT INTO sessions (id, account_id, expires_at, created_at) VALUES ($1, $2, $3, $4)",
      [session.id, session.accountId, session.expiresAt, session.createdAt],
    );
  }

  async getSession(id: string): Promise<Session | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      "SELECT id, account_id, expires_at, created_at FROM sessions WHERE id = $1",
      [id],
    );
    const row = result.rows[0];
    return row
      ? {
          id: String(row.id),
          accountId: String(row.account_id),
          expiresAt: String(row.expires_at),
          createdAt: String(row.created_at),
        }
      : null;
  }

  async deleteSession(id: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query("DELETE FROM sessions WHERE id = $1", [id]);
  }

  async adoptDefaultAccount(input: { username: string; passwordHash: string }): Promise<void> {
    await this.ensureSchema();
    try {
      await this.pool.query("UPDATE accounts SET username = $1, password_hash = $2 WHERE id = $3", [
        input.username,
        input.passwordHash,
        DEFAULT_ACCOUNT_ID,
      ]);
    } catch (error) {
      if (error && typeof error === "object" && (error as { code?: string }).code === "23505") {
        throw new DuplicateUsernameError(input.username);
      }
      throw error;
    }
  }

  async setAccountPassword(accountId: string, passwordHash: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query("UPDATE accounts SET password_hash = $1 WHERE id = $2", [passwordHash, accountId]);
  }

  async deleteSessionsForAccount(accountId: string, exceptSessionId?: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query("DELETE FROM sessions WHERE account_id = $1 AND ($2::text IS NULL OR id <> $2)", [
      accountId,
      exceptSessionId ?? null,
    ]);
  }

  async recordDeadLink(input: {
    key: string;
    kind: "pan115" | "magnet";
    reason: string;
    permanent: boolean;
    ttlMs?: number;
    now?: string;
  }): Promise<void> {
    await this.ensureSchema();
    const recordedAt = input.now ?? new Date().toISOString();
    const expiresAt = input.permanent
      ? null
      : new Date(new Date(recordedAt).getTime() + (input.ttlMs ?? MAGNET_DEAD_LINK_TTL_MS)).toISOString();
    // Idempotent: keep the first record (when it was first proven dead).
    await this.pool.query(
      "INSERT INTO dead_links (key, kind, reason, permanent, expires_at, recorded_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (key) DO NOTHING",
      [input.key, input.kind, input.reason, input.permanent, expiresAt, recordedAt],
    );
  }

  async listDeadLinkKeys(options?: { now?: string }): Promise<string[]> {
    await this.ensureSchema();
    // Permanent deaths (expires_at NULL) always filter; soft ones only until their
    // own expiry (so an unresolvable magnet's longer TTL is honored per-record).
    const now = options?.now ?? new Date().toISOString();
    const result = await this.pool.query(
      "SELECT key FROM dead_links WHERE expires_at IS NULL OR expires_at > $1",
      [now],
    );
    return result.rows.map((row) => String(row.key));
  }

  // ---- private ----

  private async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadWorkflowRunSnapshot(
    executor: Queryable,
    workflowRunId: string,
  ): Promise<PersistedWorkflowRunSnapshot | null> {
    await this.ensureSchema();
    const runRow = await executor.query(
      "SELECT payload, account_id, connected_storage_id FROM workflow_runs WHERE id = $1",
      [workflowRunId],
    );
    const workflowRun = (runRow.rows[0]?.payload as WorkflowRun | undefined) ?? null;
    if (!workflowRun) {
      return null;
    }
    const accountId = (runRow.rows[0]?.account_id as string | undefined) ?? DEFAULT_ACCOUNT_ID;
    // Collapse the UNSCOPED_STORAGE sentinel back to null for the domain snapshot — the
    // sentinel is an internal NOT-NULL detail and must never leak into connectedStorageId
    // (matches SQLite + InMemory). The season/episode lookups below re-collapse via
    // `?? UNSCOPED_STORAGE`, so scoping stays correct.
    const rawStorage = (runRow.rows[0]?.connected_storage_id as string | null | undefined) ?? null;
    const connectedStorageId = rawStorage === UNSCOPED_STORAGE ? null : rawStorage;
    // Scope the season to THIS run's drive: tracked_seasons PK is
    // (id, connected_storage_id), so the same season id can exist on multiple drives
    // with different per-drive payloads (storageDirectoryId, totals, status). Loading
    // by id alone could hydrate the wrong drive's season and break cross-drive isolation.
    const season = await this.selectOne<TrackedSeason>(
      executor,
      "SELECT payload FROM tracked_seasons WHERE id = $1 AND connected_storage_id = $2",
      [workflowRun.trackedSeasonId, connectedStorageId ?? UNSCOPED_STORAGE],
    );
    if (!season) {
      throw new Error(`Missing tracked season ${workflowRun.trackedSeasonId} for workflow run ${workflowRun.id}`);
    }
    const title = await this.requireTitle(executor, season);
    return withDerivedEpisodeSummaries({
      accountId,
      connectedStorageId,
      title,
      season,
      workflowRun,
      episodes: await this.selectEpisodeStates(executor, season.id, connectedStorageId ?? UNSCOPED_STORAGE),
      resourceSnapshots: await this.selectMany<ResourceSnapshot>(
        executor,
        "SELECT payload FROM resource_snapshots WHERE workflow_run_id = $1 ORDER BY ordinal",
        [workflowRun.id],
      ),
      decisions: await this.selectMany<AgentDecision>(
        executor,
        "SELECT payload FROM agent_decisions WHERE workflow_run_id = $1 ORDER BY ordinal",
        [workflowRun.id],
      ),
      transferAttempts: await this.selectMany<TransferAttempt>(
        executor,
        "SELECT payload FROM transfer_attempts WHERE workflow_run_id = $1 ORDER BY ordinal",
        [workflowRun.id],
      ),
      notifications: await this.selectMany<NotificationEvent>(
        executor,
        "SELECT payload FROM notifications WHERE workflow_run_id = $1 ORDER BY ordinal",
        [workflowRun.id],
      ),
    });
  }

  private async replaceWorkflowRunSnapshot(
    client: PoolClient,
    snapshot: PersistWorkflowRunSnapshotInput,
  ): Promise<void> {
    // A re-persist may omit accountId/connectedStorageId (the worker finalize path
    // doesn't re-thread them). upsertWorkflowRun preserves the stored values on
    // conflict, but the season upsert + episode bucket delete/insert key on
    // (id, connected_storage_id) — falling back to the unscoped sentinel would write
    // those into a DIFFERENT bucket than reads resolve, silently dropping the update.
    // Resolve the run's stored scope first (mirrors the InMemory oracle).
    const existing = await client.query<{
      account_id: string | null;
      connected_storage_id: string | null;
    }>("SELECT account_id, connected_storage_id FROM workflow_runs WHERE id = $1", [
      snapshot.workflowRun.id,
    ]);
    const accountId =
      snapshot.accountId ?? existing.rows[0]?.account_id ?? DEFAULT_ACCOUNT_ID;
    const connectedStorageId =
      snapshot.connectedStorageId ?? existing.rows[0]?.connected_storage_id ?? UNSCOPED_STORAGE;
    await this.upsert(client, "media_titles", "(id, payload)", [snapshot.title.id, json(snapshot.title)], "$1, $2::jsonb");
    await this.upsertTrackedSeason(client, snapshot.season, accountId, connectedStorageId);
    await this.upsertWorkflowRun(client, snapshot.workflowRun, accountId, connectedStorageId);
    await this.deleteWorkflowRunChildren(client, snapshot.workflowRun.id, snapshot.season.id, connectedStorageId);

    for (const [ordinal, episode] of snapshot.episodes.entries()) {
      void ordinal;
      await client.query(
        "INSERT INTO episode_states (tracked_season_id, connected_storage_id, episode_code, payload) VALUES ($1, $2, $3, $4::jsonb)",
        [snapshot.season.id, connectedStorageId, episode.episodeCode, json(episode)],
      );
    }
    // Snapshot ids are content-addressed and can legitimately recur; keep
    // persistence idempotent on the id instead of crashing on a duplicate.
    for (const [ordinal, resourceSnapshot] of snapshot.resourceSnapshots.entries()) {
      await client.query(
        "INSERT INTO resource_snapshots (id, workflow_run_id, ordinal, payload) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (id) DO NOTHING",
        [resourceSnapshot.id, snapshot.workflowRun.id, ordinal, json(resourceSnapshot)],
      );
    }
    for (const [ordinal, decision] of snapshot.decisions.entries()) {
      await client.query(
        "INSERT INTO agent_decisions (workflow_run_id, ordinal, snapshot_id, payload) VALUES ($1, $2, $3, $4::jsonb)",
        [snapshot.workflowRun.id, ordinal, decision.snapshotId, json(decision)],
      );
    }
    for (const [ordinal, attempt] of snapshot.transferAttempts.entries()) {
      await client.query(
        "INSERT INTO transfer_attempts (id, workflow_run_id, ordinal, candidate_id, payload) VALUES ($1, $2, $3, $4, $5::jsonb)",
        [attempt.id, snapshot.workflowRun.id, ordinal, attempt.candidateId, json(attempt)],
      );
    }
    for (const [ordinal, notification] of snapshot.notifications.entries()) {
      await client.query(
        "INSERT INTO notifications (id, workflow_run_id, ordinal, payload) VALUES ($1, $2, $3, $4::jsonb)",
        [notification.id, snapshot.workflowRun.id, ordinal, json(notification)],
      );
    }
  }

  private async upsertTrackedSeason(
    client: PoolClient,
    season: TrackedSeason,
    accountId: string = DEFAULT_ACCOUNT_ID,
    connectedStorageId: string | null = null,
  ): Promise<void> {
    // account_id / connected_storage_id are set on first insert and PRESERVED on
    // conflict (ownership + workspace are immutable; re-saves only update payload).
    await client.query(
      "INSERT INTO tracked_seasons (id, media_title_id, account_id, connected_storage_id, payload) VALUES ($1, $2, $3, $4, $5::jsonb) " +
        "ON CONFLICT (id, connected_storage_id) DO UPDATE SET media_title_id = EXCLUDED.media_title_id, payload = EXCLUDED.payload",
      [season.id, season.mediaTitleId, accountId, connectedStorageId, json(season)],
    );
  }

  private async upsertWorkflowRun(
    client: PoolClient,
    workflowRun: WorkflowRun,
    accountId: string = DEFAULT_ACCOUNT_ID,
    connectedStorageId: string | null = null,
  ): Promise<void> {
    // account_id / connected_storage_id set on insert, preserved on conflict — so
    // claim/requeue/progress updates (which don't know the owner) never clobber it.
    await client.query(
      "INSERT INTO workflow_runs (id, tracked_season_id, account_id, connected_storage_id, payload) VALUES ($1, $2, $3, $4, $5::jsonb) " +
        "ON CONFLICT (id) DO UPDATE SET tracked_season_id = EXCLUDED.tracked_season_id, payload = EXCLUDED.payload",
      [workflowRun.id, workflowRun.trackedSeasonId, accountId, connectedStorageId, json(workflowRun)],
    );
  }

  private async upsert(
    client: PoolClient,
    table: string,
    columns: string,
    params: unknown[],
    placeholders: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${table} ${columns} VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`,
      params,
    );
  }

  private async deleteWorkflowRunChildren(
    client: PoolClient,
    workflowRunId: string,
    trackedSeasonId: string,
    connectedStorageId: string,
  ): Promise<void> {
    await client.query("DELETE FROM notifications WHERE workflow_run_id = $1", [workflowRunId]);
    await client.query("DELETE FROM transfer_attempts WHERE workflow_run_id = $1", [workflowRunId]);
    await client.query("DELETE FROM agent_decisions WHERE workflow_run_id = $1", [workflowRunId]);
    // NOTE: do NOT delete agent_steps here. This runs on every saveWorkflowRunSnapshot
    // (re-persist) to clear children the snapshot RE-INSERTS. agent_steps are written
    // incrementally by the trace sink and are NOT in the snapshot, so deleting them here
    // would wipe a completed run's trace at finalize. Cross-attempt clearing is handled
    // by clearAgentSteps (sink start); true teardown is in cancel/untrack.
    await client.query("DELETE FROM resource_snapshots WHERE workflow_run_id = $1", [workflowRunId]);
    // Scope to THIS drive's episodes — never wipe another drive's episodes for the same season.
    await client.query(
      "DELETE FROM episode_states WHERE tracked_season_id = $1 AND connected_storage_id = $2",
      [trackedSeasonId, connectedStorageId],
    );
  }

  private async expireStaleActiveWorkflowRuns(
    client: PoolClient,
    input: ReserveWorkflowRunInput,
  ): Promise<void> {
    if (!input.staleActiveRunStartedBefore) {
      return;
    }
    const snapshot = workflowSnapshotFromReservation(input);
    // Only expire stale runs on the SAME drive being reserved, and clear only that
    // drive's episodes — never touch another drive's runs/episodes for the season.
    const connectedStorageId = snapshot.connectedStorageId ?? UNSCOPED_STORAGE;
    const staleRuns = (await this.selectWorkflowRuns(client, snapshot.season.id, connectedStorageId)).filter(
      (workflowRun) =>
        workflowRun.kind === snapshot.workflowRun.kind &&
        isActiveWorkflowStatus(workflowRun.status) &&
        workflowRun.startedAt < input.staleActiveRunStartedBefore!,
    );
    for (const staleRun of staleRuns) {
      const expiredRun = expireWorkflowRun(staleRun, input.staleFinishedAt ?? snapshot.workflowRun.startedAt);
      await this.upsertWorkflowRun(client, expiredRun);
      await client.query(
        "DELETE FROM episode_states WHERE tracked_season_id = $1 AND connected_storage_id = $2",
        [snapshot.season.id, connectedStorageId],
      );
    }
  }

  private async requireTitle(executor: Queryable, season: TrackedSeason): Promise<MediaTitle> {
    const title = await this.selectOne<MediaTitle>(
      executor,
      "SELECT payload FROM media_titles WHERE id = $1",
      [season.mediaTitleId],
    );
    if (!title) {
      throw new Error(`Missing media title ${season.mediaTitleId} for tracked season ${season.id}`);
    }
    return title;
  }

  private async selectEpisodeStates(
    executor: Queryable,
    trackedSeasonId: string,
    connectedStorageId: string,
  ): Promise<EpisodeState[]> {
    const episodes = await this.selectMany<EpisodeState>(
      executor,
      "SELECT payload FROM episode_states WHERE tracked_season_id = $1 AND connected_storage_id = $2",
      [trackedSeasonId, connectedStorageId],
    );
    return episodes.sort((a, b) => episodeNumberFromCode(a.episodeCode) - episodeNumberFromCode(b.episodeCode));
  }

  private async selectWorkflowRuns(
    executor: Queryable,
    trackedSeasonId: string,
    connectedStorageId: string | null = null,
  ): Promise<WorkflowRun[]> {
    return this.selectMany<WorkflowRun>(
      executor,
      "SELECT payload FROM workflow_runs WHERE tracked_season_id = $1 " +
        "AND ($2::text IS NULL OR connected_storage_id = $2)",
      [trackedSeasonId, connectedStorageId],
    );
  }

  private async selectWorkflowRunsForTitle(
    executor: Queryable,
    mediaTitleId: string,
    accountId: string,
    connectedStorageId: string | null = null,
  ): Promise<WorkflowRun[]> {
    // media_titles is global (shared cache); ownership lives on tracked_seasons —
    // so the title-level active-run lock must be scoped to the reserving
    // (account, storage): two drives may each track the same title independently.
    return this.selectMany<WorkflowRun>(
      executor,
      "SELECT wr.payload AS payload FROM workflow_runs wr " +
        "JOIN tracked_seasons ts ON wr.tracked_season_id = ts.id " +
        "WHERE ts.media_title_id = $1 AND wr.account_id = $2 " +
        "AND ($3::text IS NULL OR wr.connected_storage_id = $3)",
      [mediaTitleId, accountId, connectedStorageId],
    );
  }

  private async allWorkflowRuns(executor: Queryable): Promise<WorkflowRun[]> {
    return this.selectMany<WorkflowRun>(executor, "SELECT payload FROM workflow_runs", []);
  }

  private async allWorkflowRunsForAccount(executor: Queryable, accountId: string): Promise<WorkflowRun[]> {
    return this.selectMany<WorkflowRun>(
      executor,
      "SELECT payload FROM workflow_runs WHERE account_id = $1",
      [accountId],
    );
  }

  private async selectOne<T>(executor: Queryable, sql: string, params: unknown[]): Promise<T | null> {
    await this.ensureSchema();
    const result = await executor.query(sql, params);
    return (result.rows[0]?.payload as T) ?? null;
  }

  private async selectMany<T>(executor: Queryable, sql: string, params: unknown[]): Promise<T[]> {
    await this.ensureSchema();
    const result = await executor.query(sql, params);
    return result.rows.map((row) => row.payload as T);
  }
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function accountFromRow(row: Record<string, unknown>): Account {
  return {
    id: String(row.id),
    username: String(row.username),
    passwordHash: String(row.password_hash),
    groupId: (row.group_id as string | null | undefined) ?? null,
    isOwner: Boolean(row.is_owner),
    createdAt: String(row.created_at),
  };
}

function connectedStorageFromRow(row: Record<string, unknown>): ConnectedStorage {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    provider: String(row.provider),
    providerUid: String(row.provider_uid),
    label: (row.label as string | null | undefined) ?? null,
    payload: row.payload,
    rootCid: (row.root_cid as string | null | undefined) ?? null,
    moviesCid: (row.movies_cid as string | null | undefined) ?? null,
    tvCid: (row.tv_cid as string | null | undefined) ?? null,
    animeCid: (row.anime_cid as string | null | undefined) ?? null,
    status: (row.status as "active" | "frozen" | null | undefined) ?? "active",
    frozenReason: (row.frozen_reason as string | null | undefined) ?? null,
    frozenAt: (row.frozen_at as string | null | undefined) ?? null,
    createdAt: String(row.created_at),
  };
}
