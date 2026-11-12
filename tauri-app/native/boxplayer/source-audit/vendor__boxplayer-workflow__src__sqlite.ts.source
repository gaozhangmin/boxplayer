import { createRequire } from "node:module";
import type Database from "better-sqlite3";
import { DEFAULT_ACCOUNT_ID, episodeNumberFromCode } from "./domain.js";
import type {
  AgentDecision,
  AgentStep,
  EpisodeState,
  MediaTitle,
  NotificationEvent,
  ResourceSnapshot,
  TrackedSeason,
  TransferAttempt,
  WorkflowKind,
  WorkflowRun,
  WorkflowRunProgress,
} from "./domain.js";
import type { DeadLink } from "./acquisition-v2/dead-links.js";
import { MAGNET_DEAD_LINK_TTL_MS } from "./acquisition-v2/dead-links.js";
import type {
  Account,
  ConnectedStorage,
  Session,
  UpsertConnectedStorageInput,
} from "./account-credentials.js";
import { normalizeScope, scopeMatches, type ScopeArg, type WorkflowScope } from "./workflow-scope.js";
import {
  claimableQueuedRuns,
  claimWorkflowRun,
  cloneWorkflowValue,
  compareTrackedSeasonStates,
  DuplicateUsernameError,
  expireWorkflowRun,
  isActiveWorkflowStatus,
  retriedWorkflowRun,
  seasonScopeKey,
  UNSCOPED_STORAGE,
  validateWorkflowRunSnapshot,
  withDerivedEpisodeSummaries,
  workflowSnapshotFromReservation,
} from "./repository.js";
import type {
  PersistedWorkflowRunSnapshot,
  PersistWorkflowRunSnapshotInput,
  ReserveWorkflowRunInput,
  TrackedSeasonState,
  WorkflowRepository,
  WorkflowRunReservationResult,
} from "./repository.js";

/**
 * The SQLite schema mirrors the Postgres schema (`packages/workflow/src/postgres.ts`),
 * with `text` payload columns instead of `jsonb` (SQLite has no jsonb; payloads are
 * JSON.stringify'd text). The tree-model scope columns (account_id,
 * connected_storage_id) and the composite primary keys that Postgres reaches through
 * a chain of idempotent ALTERs are declared inline here — a fresh SQLite database
 * needs the FINAL shape up front, not the migration steps. The acct_default seed row
 * matches Postgres so later tasks behave identically.
 */
export const SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS media_titles (
    id text PRIMARY KEY,
    payload text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tracked_seasons (
    id text NOT NULL,
    media_title_id text NOT NULL,
    account_id text NOT NULL DEFAULT 'acct_default',
    connected_storage_id text NOT NULL,
    payload text NOT NULL,
    PRIMARY KEY (id, connected_storage_id)
  );
  CREATE TABLE IF NOT EXISTS workflow_runs (
    id text PRIMARY KEY,
    tracked_season_id text NOT NULL,
    account_id text NOT NULL DEFAULT 'acct_default',
    connected_storage_id text NOT NULL,
    payload text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS episode_states (
    tracked_season_id text NOT NULL,
    connected_storage_id text NOT NULL,
    episode_code text NOT NULL,
    payload text NOT NULL,
    PRIMARY KEY (tracked_season_id, connected_storage_id, episode_code)
  );
  CREATE TABLE IF NOT EXISTS resource_snapshots (
    id text PRIMARY KEY,
    workflow_run_id text NOT NULL,
    ordinal integer NOT NULL,
    payload text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_decisions (
    workflow_run_id text NOT NULL,
    ordinal integer NOT NULL,
    snapshot_id text NOT NULL,
    payload text NOT NULL,
    PRIMARY KEY (workflow_run_id, ordinal)
  );
  CREATE TABLE IF NOT EXISTS agent_steps (
    workflow_run_id text NOT NULL,
    ordinal integer NOT NULL,
    payload text NOT NULL,
    PRIMARY KEY (workflow_run_id, ordinal)
  );
  CREATE TABLE IF NOT EXISTS transfer_attempts (
    id text PRIMARY KEY,
    workflow_run_id text NOT NULL,
    ordinal integer NOT NULL,
    candidate_id text NOT NULL,
    payload text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    workflow_run_id text NOT NULL,
    ordinal integer NOT NULL,
    payload text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY,
    value text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS account_settings (
    account_id text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    PRIMARY KEY (account_id, key)
  );
  CREATE TABLE IF NOT EXISTS dead_links (
    key text PRIMARY KEY,
    kind text NOT NULL,
    reason text NOT NULL,
    permanent integer NOT NULL DEFAULT 1,
    expires_at text,
    recorded_at text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS accounts (
    id text PRIMARY KEY,
    username text UNIQUE NOT NULL,
    password_hash text NOT NULL DEFAULT '',
    group_id text,
    is_owner integer NOT NULL DEFAULT 0,
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
    payload text NOT NULL,
    root_cid text,
    movies_cid text,
    tv_cid text,
    anime_cid text,
    status text NOT NULL DEFAULT 'active',
    frozen_reason text,
    frozen_at text,
    created_at text NOT NULL,
    UNIQUE (provider, provider_uid)
  );
  INSERT INTO accounts (id, username, password_hash, is_owner, created_at)
    VALUES ('acct_default', 'default', '', 1, '1970-01-01T00:00:00.000Z')
    ON CONFLICT (id) DO NOTHING;
`;

// Lazy-load the native better-sqlite3 at CALL time (the desktop path), NOT at module
// evaluation time. This keeps `import "@media-track/workflow"` (container, Vercel
// serverless demo — Postgres-only) free of the native module, so those paths never pay
// the native load and can't hard-crash on a platform where better-sqlite3 isn't built.
const requireNative = createRequire(import.meta.url);

export function createSqliteWorkflowRepository(options: { path: string }): SqliteWorkflowRepository {
  let DatabaseCtor: typeof import("better-sqlite3");
  try {
    DatabaseCtor = requireNative("better-sqlite3") as typeof import("better-sqlite3");
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      "SQLite mode is enabled (MEDIA_TRACK_SQLITE_PATH is set) but the optional native " +
        "dependency 'better-sqlite3' could not be loaded. Install it (e.g. `npm install` " +
        "without --no-optional) and ensure it is built for this platform's Node/Electron ABI " +
        `(desktop builds: @electron/rebuild). Original error: ${cause}`,
      { cause: error },
    );
  }
  return new SqliteWorkflowRepository(new DatabaseCtor(options.path));
}

export class SqliteWorkflowRepository implements WorkflowRepository {
  constructor(private readonly db: Database.Database) {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SQLITE_SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  async saveWorkflowRunSnapshot(input: PersistWorkflowRunSnapshotInput): Promise<void> {
    validateWorkflowRunSnapshot(input);
    const snapshot = cloneWorkflowValue(input);
    // better-sqlite3 transactions are synchronous — the whole multi-table write
    // commits atomically or rolls back on throw.
    this.db.transaction(() => this.replaceWorkflowRunSnapshot(snapshot))();
  }

  async reserveWorkflowRun(input: ReserveWorkflowRunInput): Promise<WorkflowRunReservationResult> {
    const snapshot = cloneWorkflowValue(workflowSnapshotFromReservation(input));
    validateWorkflowRunSnapshot(snapshot);
    const accountId = snapshot.accountId ?? DEFAULT_ACCOUNT_ID;
    const connectedStorageId = snapshot.connectedStorageId ?? UNSCOPED_STORAGE;

    return this.db.transaction((): WorkflowRunReservationResult => {
      this.expireStaleActiveWorkflowRuns(input);

      if (input.blockIfTitleHasActiveRun === true) {
        const titleActive = this.selectWorkflowRunsForTitle(
          snapshot.season.mediaTitleId,
          accountId,
          connectedStorageId,
        )
          .filter((workflowRun) => isActiveWorkflowStatus(workflowRun.status))
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
        if (titleActive) {
          const activeSnapshot = this.loadSnapshot(titleActive.id);
          if (!activeSnapshot) {
            throw new Error(`Missing active workflow run ${titleActive.id}`);
          }
          return { status: "already_active", snapshot: activeSnapshot };
        }
      }

      const activeRun = this.selectWorkflowRuns(snapshot.season.id, connectedStorageId)
        .filter(
          (workflowRun) =>
            workflowRun.kind === snapshot.workflowRun.kind && isActiveWorkflowStatus(workflowRun.status),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      if (activeRun) {
        const activeSnapshot = this.loadSnapshot(activeRun.id);
        if (!activeSnapshot) {
          throw new Error(`Missing active workflow run ${activeRun.id}`);
        }
        return { status: "already_active", snapshot: activeSnapshot };
      }

      const existingEpisodes = this.selectEpisodeStates(snapshot.season.id, connectedStorageId);
      if (input.blockIfEpisodeStatesExist === true && existingEpisodes.length > 0) {
        return { status: "already_has_episode_state", episodes: existingEpisodes };
      }

      this.replaceWorkflowRunSnapshot(snapshot);
      return {
        status: "reserved",
        snapshot: withDerivedEpisodeSummaries(cloneWorkflowValue(snapshot)),
      };
    })();
  }

  async getWorkflowRunSnapshot(
    workflowRunId: string,
    scopeArg: ScopeArg = undefined,
  ): Promise<PersistedWorkflowRunSnapshot | null> {
    const scope = normalizeScope(scopeArg);
    const snapshot = this.loadSnapshot(workflowRunId);
    if (
      !snapshot ||
      snapshot.accountId !== scope.accountId ||
      (scope.connectedStorageId != null && snapshot.connectedStorageId !== scope.connectedStorageId)
    ) {
      return null;
    }
    return snapshot;
  }

  // ----- snapshot persist + reserve helpers (mirror postgres.ts) -----

  private loadSnapshot(workflowRunId: string): PersistedWorkflowRunSnapshot | null {
    const runRow = this.db
      .prepare("SELECT payload, account_id, connected_storage_id FROM workflow_runs WHERE id = ?")
      .get(workflowRunId) as
      | { payload: string; account_id: string; connected_storage_id: string | null }
      | undefined;
    if (!runRow) {
      return null;
    }
    const workflowRun = JSON.parse(runRow.payload) as WorkflowRun;
    const accountId = runRow.account_id ?? DEFAULT_ACCOUNT_ID;
    // Collapse the UNSCOPED_STORAGE sentinel back to null for the domain snapshot.
    const rawStorage = runRow.connected_storage_id ?? null;
    const connectedStorageId = rawStorage === UNSCOPED_STORAGE ? null : rawStorage;

    // Scope the season to THIS run's drive: tracked_seasons PK is
    // (id, connected_storage_id), so the same season id can exist on multiple drives
    // with different per-drive payloads (storageDirectoryId, totals, status). Loading
    // by id alone could hydrate the wrong drive's season and break cross-drive isolation.
    const seasonRow = this.db
      .prepare("SELECT payload FROM tracked_seasons WHERE id = ? AND connected_storage_id = ?")
      .get(workflowRun.trackedSeasonId, rawStorage ?? UNSCOPED_STORAGE) as { payload: string } | undefined;
    if (!seasonRow) {
      throw new Error(
        `Missing tracked season ${workflowRun.trackedSeasonId} for workflow run ${workflowRun.id}`,
      );
    }
    const season = JSON.parse(seasonRow.payload) as TrackedSeason;

    const titleRow = this.db
      .prepare("SELECT payload FROM media_titles WHERE id = ?")
      .get(season.mediaTitleId) as { payload: string } | undefined;
    if (!titleRow) {
      throw new Error(`Missing media title ${season.mediaTitleId} for tracked season ${season.id}`);
    }
    const title = JSON.parse(titleRow.payload) as MediaTitle;

    return withDerivedEpisodeSummaries({
      accountId,
      connectedStorageId,
      title,
      season,
      workflowRun,
      episodes: this.selectEpisodeStates(season.id, rawStorage ?? UNSCOPED_STORAGE),
      resourceSnapshots: this.selectChildPayloads<ResourceSnapshot>(
        "SELECT payload FROM resource_snapshots WHERE workflow_run_id = ? ORDER BY ordinal",
        workflowRun.id,
      ),
      decisions: this.selectChildPayloads<AgentDecision>(
        "SELECT payload FROM agent_decisions WHERE workflow_run_id = ? ORDER BY ordinal",
        workflowRun.id,
      ),
      transferAttempts: this.selectChildPayloads<TransferAttempt>(
        "SELECT payload FROM transfer_attempts WHERE workflow_run_id = ? ORDER BY ordinal",
        workflowRun.id,
      ),
      notifications: this.selectChildPayloads<NotificationEvent>(
        "SELECT payload FROM notifications WHERE workflow_run_id = ? ORDER BY ordinal",
        workflowRun.id,
      ),
    });
  }

  private selectChildPayloads<T>(sql: string, workflowRunId: string): T[] {
    const rows = this.db.prepare(sql).all(workflowRunId) as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as T);
  }

  private replaceWorkflowRunSnapshot(snapshot: PersistWorkflowRunSnapshotInput): void {
    // A re-persist may omit accountId/connectedStorageId (the worker finalize path
    // doesn't re-thread them). upsertWorkflowRun preserves the stored values on
    // conflict, but the season upsert + episode bucket delete/insert below key on
    // (id, connected_storage_id) — falling back to the unscoped sentinel here would
    // write those into a DIFFERENT bucket than subsequent reads resolve, silently
    // dropping the update. Resolve the run's stored scope first (mirrors the
    // InMemory oracle in repository.ts saveWorkflowRunSnapshot).
    const existing = this.db
      .prepare("SELECT account_id, connected_storage_id FROM workflow_runs WHERE id = ?")
      .get(snapshot.workflowRun.id) as
      | { account_id: string | null; connected_storage_id: string | null }
      | undefined;
    const accountId = snapshot.accountId ?? existing?.account_id ?? DEFAULT_ACCOUNT_ID;
    const connectedStorageId =
      snapshot.connectedStorageId ?? existing?.connected_storage_id ?? UNSCOPED_STORAGE;

    this.db
      .prepare(
        "INSERT INTO media_titles (id, payload) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET payload = excluded.payload",
      )
      .run(snapshot.title.id, JSON.stringify(snapshot.title));

    this.upsertTrackedSeason(snapshot.season, accountId, connectedStorageId);
    this.upsertWorkflowRun(snapshot.workflowRun, accountId, connectedStorageId);
    this.deleteWorkflowRunChildren(snapshot.workflowRun.id, snapshot.season.id, connectedStorageId);

    const insertEpisode = this.db.prepare(
      "INSERT INTO episode_states (tracked_season_id, connected_storage_id, episode_code, payload) VALUES (?, ?, ?, ?)",
    );
    for (const episode of snapshot.episodes) {
      insertEpisode.run(
        snapshot.season.id,
        connectedStorageId,
        episode.episodeCode,
        JSON.stringify(episode),
      );
    }
    // Snapshot ids are content-addressed and can legitimately recur; keep
    // persistence idempotent on the id instead of crashing on a duplicate.
    const insertSnapshot = this.db.prepare(
      "INSERT INTO resource_snapshots (id, workflow_run_id, ordinal, payload) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
    );
    snapshot.resourceSnapshots.forEach((resourceSnapshot, ordinal) => {
      insertSnapshot.run(
        resourceSnapshot.id,
        snapshot.workflowRun.id,
        ordinal,
        JSON.stringify(resourceSnapshot),
      );
    });
    const insertDecision = this.db.prepare(
      "INSERT INTO agent_decisions (workflow_run_id, ordinal, snapshot_id, payload) VALUES (?, ?, ?, ?)",
    );
    snapshot.decisions.forEach((decision, ordinal) => {
      insertDecision.run(snapshot.workflowRun.id, ordinal, decision.snapshotId, JSON.stringify(decision));
    });
    const insertTransfer = this.db.prepare(
      "INSERT INTO transfer_attempts (id, workflow_run_id, ordinal, candidate_id, payload) VALUES (?, ?, ?, ?, ?)",
    );
    snapshot.transferAttempts.forEach((attempt, ordinal) => {
      insertTransfer.run(
        attempt.id,
        snapshot.workflowRun.id,
        ordinal,
        attempt.candidateId,
        JSON.stringify(attempt),
      );
    });
    const insertNotification = this.db.prepare(
      "INSERT INTO notifications (id, workflow_run_id, ordinal, payload) VALUES (?, ?, ?, ?)",
    );
    snapshot.notifications.forEach((notification, ordinal) => {
      insertNotification.run(
        notification.id,
        snapshot.workflowRun.id,
        ordinal,
        JSON.stringify(notification),
      );
    });
  }

  private upsertTrackedSeason(
    season: TrackedSeason,
    accountId: string = DEFAULT_ACCOUNT_ID,
    connectedStorageId: string = UNSCOPED_STORAGE,
  ): void {
    // account_id / connected_storage_id are part of the PK / set on insert and
    // PRESERVED on conflict (ownership + workspace are immutable; re-saves only
    // update payload).
    this.db
      .prepare(
        "INSERT INTO tracked_seasons (id, media_title_id, account_id, connected_storage_id, payload) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT (id, connected_storage_id) DO UPDATE SET media_title_id = excluded.media_title_id, payload = excluded.payload",
      )
      .run(season.id, season.mediaTitleId, accountId, connectedStorageId, JSON.stringify(season));
  }

  private upsertWorkflowRun(
    workflowRun: WorkflowRun,
    accountId: string = DEFAULT_ACCOUNT_ID,
    connectedStorageId: string = UNSCOPED_STORAGE,
  ): void {
    // account_id / connected_storage_id set on insert, preserved on conflict — so
    // claim/requeue/progress updates (which don't know the owner) never clobber it.
    this.db
      .prepare(
        "INSERT INTO workflow_runs (id, tracked_season_id, account_id, connected_storage_id, payload) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT (id) DO UPDATE SET tracked_season_id = excluded.tracked_season_id, payload = excluded.payload",
      )
      .run(
        workflowRun.id,
        workflowRun.trackedSeasonId,
        accountId,
        connectedStorageId,
        JSON.stringify(workflowRun),
      );
  }

  private deleteWorkflowRunChildren(
    workflowRunId: string,
    trackedSeasonId: string,
    connectedStorageId: string,
  ): void {
    this.db.prepare("DELETE FROM notifications WHERE workflow_run_id = ?").run(workflowRunId);
    this.db.prepare("DELETE FROM transfer_attempts WHERE workflow_run_id = ?").run(workflowRunId);
    this.db.prepare("DELETE FROM agent_decisions WHERE workflow_run_id = ?").run(workflowRunId);
    // NOTE: do NOT delete agent_steps here (see postgres.ts) — they're written
    // incrementally by the trace sink and are NOT part of the snapshot.
    this.db.prepare("DELETE FROM resource_snapshots WHERE workflow_run_id = ?").run(workflowRunId);
    // Scope to THIS drive's episodes — never wipe another drive's episodes for the season.
    this.db
      .prepare("DELETE FROM episode_states WHERE tracked_season_id = ? AND connected_storage_id = ?")
      .run(trackedSeasonId, connectedStorageId);
  }

  private expireStaleActiveWorkflowRuns(input: ReserveWorkflowRunInput): void {
    if (!input.staleActiveRunStartedBefore) {
      return;
    }
    const snapshot = workflowSnapshotFromReservation(input);
    // Only expire stale runs on the SAME drive being reserved, and clear only that
    // drive's episodes — never touch another drive's runs/episodes for the season.
    const connectedStorageId = snapshot.connectedStorageId ?? UNSCOPED_STORAGE;
    const staleRuns = this.selectWorkflowRuns(snapshot.season.id, connectedStorageId).filter(
      (workflowRun) =>
        workflowRun.kind === snapshot.workflowRun.kind &&
        isActiveWorkflowStatus(workflowRun.status) &&
        workflowRun.startedAt < input.staleActiveRunStartedBefore!,
    );
    for (const staleRun of staleRuns) {
      const expiredRun = expireWorkflowRun(
        staleRun,
        input.staleFinishedAt ?? snapshot.workflowRun.startedAt,
      );
      this.upsertWorkflowRun(expiredRun);
      this.db
        .prepare("DELETE FROM episode_states WHERE tracked_season_id = ? AND connected_storage_id = ?")
        .run(snapshot.season.id, connectedStorageId);
    }
  }

  private selectEpisodeStates(trackedSeasonId: string, connectedStorageId: string): EpisodeState[] {
    const rows = this.db
      .prepare(
        "SELECT payload FROM episode_states WHERE tracked_season_id = ? AND connected_storage_id = ?",
      )
      .all(trackedSeasonId, connectedStorageId) as Array<{ payload: string }>;
    return rows
      .map((row) => JSON.parse(row.payload) as EpisodeState)
      .sort((a, b) => episodeNumberFromCode(a.episodeCode) - episodeNumberFromCode(b.episodeCode));
  }

  private selectWorkflowRuns(trackedSeasonId: string, connectedStorageId: string): WorkflowRun[] {
    const rows = this.db
      .prepare(
        "SELECT payload FROM workflow_runs WHERE tracked_season_id = ? AND connected_storage_id = ?",
      )
      .all(trackedSeasonId, connectedStorageId) as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as WorkflowRun);
  }

  private selectWorkflowRunsForTitle(
    mediaTitleId: string,
    accountId: string,
    connectedStorageId: string,
  ): WorkflowRun[] {
    // media_titles is global (shared cache); ownership lives on tracked_seasons —
    // so the title-level active-run lock is scoped to the reserving (account, storage).
    const rows = this.db
      .prepare(
        "SELECT wr.payload AS payload FROM workflow_runs wr " +
          "JOIN tracked_seasons ts ON wr.tracked_season_id = ts.id AND wr.connected_storage_id = ts.connected_storage_id " +
          "WHERE ts.media_title_id = ? AND wr.account_id = ? AND wr.connected_storage_id = ?",
      )
      .all(mediaTitleId, accountId, connectedStorageId) as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as WorkflowRun);
  }

  async claimNextQueuedWorkflowRun(input: {
    kind: WorkflowKind;
    now: string;
  }): Promise<PersistedWorkflowRunSnapshot | null> {
    // Read the oldest claimable queued run and flip it to running INSIDE one
    // transaction so two ticks can't double-claim (single-writer + WAL make the
    // read+update atomic). claimableQueuedRuns applies the nextAttemptAt gate + FIFO.
    const claimedRunId = this.db.transaction((): string | null => {
      // Prefilter to queued runs of this kind in SQL (json_extract) rather than
      // scanning every run each tick; claimableQueuedRuns then applies the
      // nextAttemptAt backoff gate + FIFO on that small set.
      const queuedRun = claimableQueuedRuns(this.queuedRunsOfKind(input.kind), input.kind, input.now)[0];
      if (!queuedRun) {
        return null;
      }
      const claimedRun = claimWorkflowRun(queuedRun, input.now);
      // upsertWorkflowRun preserves account_id / connected_storage_id on conflict.
      this.upsertWorkflowRun(claimedRun);
      return claimedRun.id;
    })();
    // Cross-account: load WITHOUT an account filter (the worker drains every
    // account's queue; the snapshot carries its own accountId).
    return claimedRunId ? this.loadSnapshot(claimedRunId) : null;
  }

  async requeueRunningWorkflowRuns(): Promise<number> {
    // Crash recovery: every `running` run → `queued` (finishedAt cleared).
    return this.db.transaction((): number => {
      const running = this.allWorkflowRuns().filter(
        (workflowRun) => workflowRun.status === "running",
      );
      for (const workflowRun of running) {
        this.upsertWorkflowRun({ ...workflowRun, status: "queued", finishedAt: null });
      }
      return running.length;
    })();
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
    // Scope-filter (account + storage) BEFORE picking the latest: with drive-independent
    // season ids the same season can be active on multiple drives, so taking the latest
    // across all drives and THEN dropping cross-storage could return null even though a
    // scoped active run exists on an older drive. Mirror the InMemory oracle.
    const latest = this.scopedRunRows()
      .filter(
        (row) =>
          row.trackedSeasonId === input.trackedSeasonId &&
          scopeMatches(scope, row.accountId, row.connectedStorageId) &&
          row.kind === input.kind &&
          isActiveWorkflowStatus(row.status),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    return latest ? this.getWorkflowRunSnapshot(latest.id, scope) : null;
  }

  async listActiveWorkflowRuns(
    scopeArg: ScopeArg = undefined,
  ): Promise<PersistedWorkflowRunSnapshot[]> {
    const scope = normalizeScope(scopeArg);
    const runs = this.allWorkflowRunsForAccount(scope.accountId)
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

  private allWorkflowRuns(): WorkflowRun[] {
    const rows = this.db.prepare("SELECT payload FROM workflow_runs").all() as Array<{
      payload: string;
    }>;
    return rows.map((row) => JSON.parse(row.payload) as WorkflowRun);
  }

  private queuedRunsOfKind(kind: WorkflowKind): WorkflowRun[] {
    const rows = this.db
      .prepare(
        "SELECT payload FROM workflow_runs " +
          "WHERE json_extract(payload, '$.status') = 'queued' AND json_extract(payload, '$.kind') = ?",
      )
      .all(kind) as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as WorkflowRun);
  }

  private allWorkflowRunsForAccount(accountId: string): WorkflowRun[] {
    const rows = this.db
      .prepare("SELECT payload FROM workflow_runs WHERE account_id = ?")
      .all(accountId) as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as WorkflowRun);
  }

  async updateWorkflowRunProgress(
    workflowRunId: string,
    progress: WorkflowRunProgress,
  ): Promise<void> {
    // Read the run's payload, clamp percent monotonically (a retry never rewinds the
    // bar), and re-upsert. Unknown run → no-op. upsertWorkflowRun preserves the
    // account/storage columns on conflict. Mirrors postgres.ts.
    const row = this.db
      .prepare("SELECT payload FROM workflow_runs WHERE id = ?")
      .get(workflowRunId) as { payload: string } | undefined;
    if (!row) {
      return;
    }
    const run = JSON.parse(row.payload) as WorkflowRun;
    const previousPercent = run.progress?.percent ?? 0;
    this.upsertWorkflowRun({
      ...run,
      progress: { ...progress, percent: Math.max(previousPercent, progress.percent) },
    });
  }

  async appendAgentStep(workflowRunId: string, step: AgentStep): Promise<void> {
    // Best-effort trace write (fire-and-forget at call sites). Idempotent on
    // (workflow_run_id, ordinal) so a re-emitted step never fails an acquisition.
    this.db
      .prepare(
        "INSERT INTO agent_steps (workflow_run_id, ordinal, payload) VALUES (?, ?, ?) " +
          "ON CONFLICT (workflow_run_id, ordinal) DO NOTHING",
      )
      .run(workflowRunId, step.ordinal, JSON.stringify(step));
  }

  async listAgentSteps(workflowRunId: string, scopeArg: ScopeArg = undefined): Promise<AgentStep[]> {
    // Scope gate reads ONLY the run's two ownership columns (not the full snapshot).
    // Fail-closed: an unknown run isn't visible to any scope. No scope = raw read.
    if (scopeArg !== undefined && !this.runMatchesScope(workflowRunId, scopeArg)) {
      return [];
    }
    return this.selectChildPayloads<AgentStep>(
      "SELECT payload FROM agent_steps WHERE workflow_run_id = ? ORDER BY ordinal",
      workflowRunId,
    );
  }

  /** Lightweight (account, storage) visibility check: reads just the two scope
   *  columns and applies the shared scopeMatches predicate. Fail-closed — an
   *  unknown run is not visible to any scope. Mirrors postgres.ts. */
  private runMatchesScope(workflowRunId: string, scopeArg: ScopeArg): boolean {
    const scope = normalizeScope(scopeArg);
    const owner = this.db
      .prepare("SELECT account_id, connected_storage_id FROM workflow_runs WHERE id = ?")
      .get(workflowRunId) as { account_id: string; connected_storage_id: string | null } | undefined;
    if (!owner) {
      return false;
    }
    const ownerAccount = owner.account_id ?? DEFAULT_ACCOUNT_ID;
    const rawStorage = owner.connected_storage_id ?? null;
    const ownerStorage = rawStorage === UNSCOPED_STORAGE ? null : rawStorage;
    return scopeMatches(scope, ownerAccount, ownerStorage);
  }

  async clearAgentSteps(workflowRunId: string): Promise<void> {
    this.db.prepare("DELETE FROM agent_steps WHERE workflow_run_id = ?").run(workflowRunId);
  }

  async cancelQueuedWorkflowRun(
    workflowRunId: string,
    scopeArg: ScopeArg = undefined,
  ): Promise<{ status: "cancelled" | "not_cancellable" }> {
    const scope = normalizeScope(scopeArg);
    return this.db.transaction((): { status: "cancelled" | "not_cancellable" } => {
      const row = this.db
        .prepare("SELECT payload, account_id, connected_storage_id FROM workflow_runs WHERE id = ?")
        .get(workflowRunId) as
        | { payload: string; account_id: string; connected_storage_id: string | null }
        | undefined;
      const run = row ? (JSON.parse(row.payload) as WorkflowRun) : null;
      const owner = row?.account_id ?? DEFAULT_ACCOUNT_ID;
      const rawStorage = row?.connected_storage_id ?? null;
      const ownerStorage = rawStorage === UNSCOPED_STORAGE ? null : rawStorage;
      if (!run || !scopeMatches(scope, owner, ownerStorage) || run.status !== "queued") {
        return { status: "not_cancellable" as const };
      }
      const seasonId = run.trackedSeasonId;
      // Tree model: the (season, drive) being torn down — never touch another drive.
      const storageValue = rawStorage ?? UNSCOPED_STORAGE;
      // The run's own children (a queued run created no 网盘 dirs — pure DB delete).
      this.db.prepare("DELETE FROM notifications WHERE workflow_run_id = ?").run(workflowRunId);
      this.db.prepare("DELETE FROM transfer_attempts WHERE workflow_run_id = ?").run(workflowRunId);
      this.db.prepare("DELETE FROM agent_decisions WHERE workflow_run_id = ?").run(workflowRunId);
      this.db.prepare("DELETE FROM agent_steps WHERE workflow_run_id = ?").run(workflowRunId);
      this.db.prepare("DELETE FROM resource_snapshots WHERE workflow_run_id = ?").run(workflowRunId);
      this.db.prepare("DELETE FROM workflow_runs WHERE id = ?").run(workflowRunId);

      // Only tear down the tracking when no OTHER run on the SAME (season, drive)
      // still references it. Scoped to this drive so another drive's tracking survives.
      const others = this.db
        .prepare(
          "SELECT 1 FROM workflow_runs WHERE tracked_season_id = ? AND connected_storage_id = ? LIMIT 1",
        )
        .get(seasonId, storageValue);
      if (!others) {
        this.teardownSeasonScoped(seasonId, storageValue);
      }
      return { status: "cancelled" as const };
    })();
  }

  /** Tear down one (season, drive): delete its episodes + tracked_seasons row, then
   *  delete the global media_titles row only when NO tracked_seasons reference that
   *  title anywhere (another drive tracking the same show must survive). Shared by
   *  cancelQueuedWorkflowRun and untrackTitle. Mirrors postgres.ts. */
  private teardownSeasonScoped(seasonId: string, storageValue: string): void {
    this.db
      .prepare("DELETE FROM episode_states WHERE tracked_season_id = ? AND connected_storage_id = ?")
      .run(seasonId, storageValue);
    const seasonRow = this.db
      .prepare("SELECT payload FROM tracked_seasons WHERE id = ? AND connected_storage_id = ?")
      .get(seasonId, storageValue) as { payload: string } | undefined;
    this.db
      .prepare("DELETE FROM tracked_seasons WHERE id = ? AND connected_storage_id = ?")
      .run(seasonId, storageValue);
    if (seasonRow) {
      const season = JSON.parse(seasonRow.payload) as TrackedSeason;
      const sibling = this.db
        .prepare("SELECT 1 FROM tracked_seasons WHERE media_title_id = ? LIMIT 1")
        .get(season.mediaTitleId);
      if (!sibling) {
        this.db.prepare("DELETE FROM media_titles WHERE id = ?").run(season.mediaTitleId);
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
    const targetSeasonIds = [...new Set(states.map((state) => state.season.id))];
    const storageValue = scope.connectedStorageId ?? UNSCOPED_STORAGE;

    return this.db.transaction(
      (): { status: "untracked" | "not_found" | "in_flight"; removedSeasons: number } => {
        // In-flight guard: a running run on any target season → refuse, delete nothing.
        const hasRunning = targetSeasonIds.some((seasonId) =>
          this.selectWorkflowRuns(seasonId, storageValue).some((run) => run.status === "running"),
        );
        if (hasRunning) {
          return { status: "in_flight" as const, removedSeasons: 0 };
        }
        // For each season: delete all run children + runs, then tear down the season.
        for (const seasonId of targetSeasonIds) {
          const runIds = this.db
            .prepare(
              "SELECT id FROM workflow_runs WHERE tracked_season_id = ? AND connected_storage_id = ?",
            )
            .all(seasonId, storageValue) as Array<{ id: string }>;
          for (const { id } of runIds) {
            this.db.prepare("DELETE FROM notifications WHERE workflow_run_id = ?").run(id);
            this.db.prepare("DELETE FROM transfer_attempts WHERE workflow_run_id = ?").run(id);
            this.db.prepare("DELETE FROM agent_decisions WHERE workflow_run_id = ?").run(id);
            this.db.prepare("DELETE FROM agent_steps WHERE workflow_run_id = ?").run(id);
            this.db.prepare("DELETE FROM resource_snapshots WHERE workflow_run_id = ?").run(id);
          }
          this.db
            .prepare(
              "DELETE FROM workflow_runs WHERE tracked_season_id = ? AND connected_storage_id = ?",
            )
            .run(seasonId, storageValue);
          this.teardownSeasonScoped(seasonId, storageValue);
        }
        return { status: "untracked" as const, removedSeasons: targetSeasonIds.length };
      },
    )();
  }

  async retryFailedWorkflowRun(
    workflowRunId: string,
    scopeArg: ScopeArg = undefined,
  ): Promise<{ status: "retried" | "not_retriable" }> {
    const scope = normalizeScope(scopeArg);
    return this.db.transaction((): { status: "retried" | "not_retriable" } => {
      const row = this.db
        .prepare("SELECT payload, account_id, connected_storage_id FROM workflow_runs WHERE id = ?")
        .get(workflowRunId) as
        | { payload: string; account_id: string; connected_storage_id: string | null }
        | undefined;
      const run = row ? (JSON.parse(row.payload) as WorkflowRun) : null;
      const owner = row?.account_id ?? DEFAULT_ACCOUNT_ID;
      const rawStorage = row?.connected_storage_id ?? null;
      const ownerStorage = rawStorage === UNSCOPED_STORAGE ? null : rawStorage;
      if (!run || !scopeMatches(scope, owner, ownerStorage) || run.status !== "failed") {
        return { status: "not_retriable" as const };
      }
      // upsertWorkflowRun preserves account_id / connected_storage_id on conflict.
      this.upsertWorkflowRun(retriedWorkflowRun(run, new Date().toISOString()));
      return { status: "retried" as const };
    })();
  }

  async getTrackedSeasonState(
    trackedSeasonId: string,
    scopeArg?: ScopeArg,
  ): Promise<TrackedSeasonState | null> {
    const scope = normalizeScope(scopeArg);
    // Mirror the oracle: the LATEST run (by startedAt desc) for this season within
    // scope defines the state; episodes come from that (season, drive) bucket.
    const latest = this.scopedRunRows()
      .filter(
        (row) =>
          row.trackedSeasonId === trackedSeasonId &&
          scopeMatches(scope, row.accountId, row.connectedStorageId),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (!latest) {
      return null;
    }
    return this.trackedSeasonStateFromRun(latest);
  }

  async listTrackedSeasonStates(scopeArg?: ScopeArg): Promise<TrackedSeasonState[]> {
    const scope = normalizeScope(scopeArg);
    return this.latestRunPerSeason(
      this.scopedRunRows().filter((row) => scopeMatches(scope, row.accountId, row.connectedStorageId)),
    )
      .map((row) => this.trackedSeasonStateFromRun(row))
      .sort(compareTrackedSeasonStates);
  }

  async listAllTrackedSeasonStates(): Promise<TrackedSeasonState[]> {
    // Cross-account (no scope filter): each state carries its own accountId/storage.
    return this.latestRunPerSeason(this.scopedRunRows())
      .map((row) => this.trackedSeasonStateFromRun(row))
      .sort(compareTrackedSeasonStates);
  }

  async listEpisodeStates(trackedSeasonId: string, scopeArg?: ScopeArg): Promise<EpisodeState[]> {
    // A concrete-drive scope reads that drive's bucket; an account-only scope (null
    // storage) merges episodes across the account's drives that have this season
    // (legacy "match all drives" semantics — mirror the InMemory oracle exactly).
    const scope = normalizeScope(scopeArg);
    if (scope.connectedStorageId != null) {
      return cloneWorkflowValue(this.selectEpisodeStates(trackedSeasonId, scope.connectedStorageId));
    }
    const storages = new Set<string | null>();
    for (const row of this.scopedRunRows()) {
      if (
        row.trackedSeasonId === trackedSeasonId &&
        scopeMatches(scope, row.accountId, row.connectedStorageId)
      ) {
        storages.add(row.connectedStorageId);
      }
    }
    const out: EpisodeState[] = [];
    for (const storage of storages) {
      out.push(...this.selectEpisodeStates(trackedSeasonId, storage ?? UNSCOPED_STORAGE));
    }
    return cloneWorkflowValue(out);
  }

  /** All workflow_runs as {trackedSeasonId, accountId, connectedStorageId (collapsed
   *  UNSCOPED→null), startedAt, id} — the raw material the tracked-season queries dedup. */
  private scopedRunRows(): Array<{
    id: string;
    trackedSeasonId: string;
    accountId: string;
    connectedStorageId: string | null;
    startedAt: string;
    kind: WorkflowRun["kind"];
    status: WorkflowRun["status"];
  }> {
    const rows = this.db
      .prepare("SELECT payload, account_id, connected_storage_id FROM workflow_runs")
      .all() as Array<{ payload: string; account_id: string; connected_storage_id: string | null }>;
    return rows.map((row) => {
      const run = JSON.parse(row.payload) as WorkflowRun;
      const rawStorage = row.connected_storage_id ?? null;
      return {
        id: run.id,
        trackedSeasonId: run.trackedSeasonId,
        accountId: row.account_id ?? DEFAULT_ACCOUNT_ID,
        connectedStorageId: rawStorage === UNSCOPED_STORAGE ? null : rawStorage,
        startedAt: run.startedAt,
        kind: run.kind,
        status: run.status,
      };
    });
  }

  /** Keep only the latest (startedAt desc) run row per season id. */
  private latestRunPerSeason<
    T extends { trackedSeasonId: string; connectedStorageId: string | null; startedAt: string },
  >(rows: T[]): T[] {
    const latest = new Map<string, T>();
    for (const row of [...rows].sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
      // Key by (season, drive), NOT season alone: season.id is drive-independent
      // (`${title.id}_s${n}`), so the same season tracked on two drives is two distinct
      // tracked entities. Collapsing by season id would drop a drive (and make the
      // desktop sweep skip it) — Postgres keys tracked_seasons by (id, storage) too.
      const key = seasonScopeKey(row.trackedSeasonId, row.connectedStorageId);
      if (!latest.has(key)) {
        latest.set(key, row);
      }
    }
    return Array.from(latest.values());
  }

  /** Build a TrackedSeasonState from a run row: load the run's tracked_season (scoped
   *  to its own drive) + global title, and the season+drive episode bucket. */
  private trackedSeasonStateFromRun(row: {
    trackedSeasonId: string;
    accountId: string;
    connectedStorageId: string | null;
  }): TrackedSeasonState {
    const storageValue = row.connectedStorageId ?? UNSCOPED_STORAGE;
    const seasonRow = this.db
      .prepare("SELECT payload FROM tracked_seasons WHERE id = ? AND connected_storage_id = ?")
      .get(row.trackedSeasonId, storageValue) as { payload: string } | undefined;
    if (!seasonRow) {
      throw new Error(`Missing tracked season ${row.trackedSeasonId} on storage ${storageValue}`);
    }
    const season = JSON.parse(seasonRow.payload) as TrackedSeason;
    const titleRow = this.db
      .prepare("SELECT payload FROM media_titles WHERE id = ?")
      .get(season.mediaTitleId) as { payload: string } | undefined;
    if (!titleRow) {
      throw new Error(`Missing media title ${season.mediaTitleId} for tracked season ${season.id}`);
    }
    const title = JSON.parse(titleRow.payload) as MediaTitle;
    return cloneWorkflowValue({
      accountId: row.accountId,
      connectedStorageId: row.connectedStorageId,
      title,
      season,
      episodes: this.selectEpisodeStates(season.id, storageValue),
    });
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
    // Push the (account, storage) scope + `since` cutoff into SQL — matching Postgres —
    // so we don't scan every account's notifications and filter in JS. A concrete-storage
    // scope compares the raw column (an unscoped/sentinel row can't match a concrete drive);
    // an account-only scope passes null → the `? IS NULL` arm matches all of the account's
    // drives. ISO-8601 UTC sorts lexicographically = chronologically, so string `>=` on
    // json_extract(createdAt) is a correct inclusive recency cutoff.
    const since = input?.since ?? null;
    const rows = this.db
      .prepare(
        "SELECT n.payload AS payload FROM notifications n " +
          "JOIN workflow_runs wr ON n.workflow_run_id = wr.id " +
          "WHERE wr.account_id = ? AND (? IS NULL OR wr.connected_storage_id = ?) " +
          "AND (? IS NULL OR json_extract(n.payload, '$.createdAt') >= ?)",
      )
      .all(scope.accountId, scope.connectedStorageId, scope.connectedStorageId, since, since) as Array<{
      payload: string;
    }>;
    const all = rows.map((row) => JSON.parse(row.payload) as NotificationEvent);
    all.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return all.slice(0, input?.limit ?? 100);
  }

  async listRecentNotificationsWithAccount(input?: {
    limit?: number;
  }): Promise<Array<{ accountId: string; connectedStorageId: string | null; notification: NotificationEvent }>> {
    // Cross-account: each notification tagged with its run's owning (account, storage).
    const rows = this.db
      .prepare(
        "SELECT n.payload AS payload, wr.account_id AS account_id, wr.connected_storage_id AS connected_storage_id " +
          "FROM notifications n JOIN workflow_runs wr ON n.workflow_run_id = wr.id",
      )
      .all() as Array<{ payload: string; account_id: string; connected_storage_id: string | null }>;
    const tagged = rows.map((row) => {
      const rawStorage = row.connected_storage_id ?? null;
      return {
        accountId: row.account_id ?? DEFAULT_ACCOUNT_ID,
        connectedStorageId: rawStorage === UNSCOPED_STORAGE ? null : rawStorage,
        notification: JSON.parse(row.payload) as NotificationEvent,
      };
    });
    tagged.sort((left, right) =>
      right.notification.createdAt.localeCompare(left.notification.createdAt),
    );
    return tagged.slice(0, input?.limit ?? 100);
  }

  async getSetting(key: string): Promise<string | null> {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  async getAccountSetting(accountId: string, key: string): Promise<string | null> {
    const row = this.db
      .prepare("SELECT value FROM account_settings WHERE account_id = ? AND key = ?")
      .get(accountId, key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async setAccountSetting(accountId: string, key: string, value: string): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO account_settings (account_id, key, value) VALUES (?, ?, ?) ON CONFLICT (account_id, key) DO UPDATE SET value = excluded.value",
      )
      .run(accountId, key, value);
  }

  async backfillConnectedStorageId(): Promise<number> {
    // SQLite's schema makes connected_storage_id NOT NULL, so a "legacy null" row is
    // stored as the UNSCOPED_STORAGE sentinel. Pin every sentinel row to its account's
    // earliest-created (primary) drive; skip accounts with no drive. Mirrors the
    // InMemory oracle: move tracked_seasons + workflow_runs + the episode bucket, and
    // count one per moved workflow_run.
    return this.db.transaction((): number => {
      // Earliest-created drive per account = its primary (root) workspace.
      const drives = this.db
        .prepare("SELECT account_id, id FROM connected_storages ORDER BY created_at")
        .all() as Array<{ account_id: string; id: string }>;
      const primaryByAccount = new Map<string, string>();
      for (const drive of drives) {
        if (!primaryByAccount.has(drive.account_id)) {
          primaryByAccount.set(drive.account_id, drive.id);
        }
      }

      const runRows = this.db
        .prepare(
          "SELECT id, tracked_season_id, account_id FROM workflow_runs WHERE connected_storage_id = ?",
        )
        .all(UNSCOPED_STORAGE) as Array<{ id: string; tracked_season_id: string; account_id: string }>;

      let filled = 0;
      const movedSeasons = new Set<string>();
      for (const run of runRows) {
        const primary = primaryByAccount.get(run.account_id ?? DEFAULT_ACCOUNT_ID);
        if (!primary) {
          continue; // account has no drive — leave the legacy row untouched
        }
        this.db
          .prepare("UPDATE workflow_runs SET connected_storage_id = ? WHERE id = ?")
          .run(primary, run.id);
        // Move the season's tracked_seasons row + episode bucket off the sentinel too,
        // once per season, so scoped reads (which read season+drive) still find them.
        const seasonKey = `${run.tracked_season_id} ${primary}`;
        if (!movedSeasons.has(seasonKey)) {
          movedSeasons.add(seasonKey);
          this.db
            .prepare(
              "UPDATE tracked_seasons SET connected_storage_id = ? WHERE id = ? AND connected_storage_id = ?",
            )
            .run(primary, run.tracked_season_id, UNSCOPED_STORAGE);
          this.db
            .prepare(
              "UPDATE episode_states SET connected_storage_id = ? WHERE tracked_season_id = ? AND connected_storage_id = ?",
            )
            .run(primary, run.tracked_season_id, UNSCOPED_STORAGE);
        }
        filled += 1;
      }
      return filled;
    })();
  }

  private connectedStorageFromRow(row: Record<string, unknown>): ConnectedStorage {
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      provider: String(row.provider),
      providerUid: String(row.provider_uid),
      label: (row.label as string | null | undefined) ?? null,
      payload: JSON.parse(String(row.payload)),
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

  async listConnectedStorages(accountId: string): Promise<ConnectedStorage[]> {
    const rows = this.db
      .prepare(
        "SELECT id, account_id, provider, provider_uid, label, payload, root_cid, movies_cid, tv_cid, anime_cid, status, frozen_reason, frozen_at, created_at " +
          "FROM connected_storages WHERE account_id = ? ORDER BY created_at",
      )
      .all(accountId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.connectedStorageFromRow(row));
  }

  async upsertConnectedStorage(row: UpsertConnectedStorageInput): Promise<void> {
    // Instance-wide UNIQUE(provider, provider_uid) ownership: on conflict NEVER
    // reassign account_id, and only refresh the row when the SAME account owns it
    // (the WHERE makes a cross-account conflict a no-op — it can't steal or
    // overwrite another account's 网盘). status/frozen are intentionally absent
    // from the column list and the SET, so a re-scan preserves a frozen state.
    this.db
      .prepare(
        "INSERT INTO connected_storages " +
          "(id, account_id, provider, provider_uid, label, payload, root_cid, movies_cid, tv_cid, anime_cid, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT (provider, provider_uid) DO UPDATE SET " +
          "label = excluded.label, payload = excluded.payload, " +
          "root_cid = excluded.root_cid, movies_cid = excluded.movies_cid, tv_cid = excluded.tv_cid, anime_cid = excluded.anime_cid " +
          "WHERE connected_storages.account_id = excluded.account_id",
      )
      .run(
        row.id,
        row.accountId,
        row.provider,
        row.providerUid,
        row.label ?? null,
        JSON.stringify(row.payload),
        row.rootCid ?? null,
        row.moviesCid ?? null,
        row.tvCid ?? null,
        row.animeCid ?? null,
        row.createdAt,
      );
  }

  async deleteConnectedStorage(accountId: string, storageId: string): Promise<void> {
    // account_id in the WHERE is fail-closed: can't delete another account's drive.
    this.db
      .prepare("DELETE FROM connected_storages WHERE id = ? AND account_id = ?")
      .run(storageId, accountId);
  }

  async findConnectedStorageByUid(
    provider: string,
    providerUid: string,
  ): Promise<ConnectedStorage | null> {
    const row = this.db
      .prepare(
        "SELECT id, account_id, provider, provider_uid, label, payload, root_cid, movies_cid, tv_cid, anime_cid, status, frozen_reason, frozen_at, created_at " +
          "FROM connected_storages WHERE provider = ? AND provider_uid = ?",
      )
      .get(provider, providerUid) as Record<string, unknown> | undefined;
    return row ? this.connectedStorageFromRow(row) : null;
  }

  async setConnectedStorageStatus(
    storageId: string,
    status: "active" | "frozen",
    frozenReason: string | null,
    frozenAt: string | null,
  ): Promise<void> {
    this.db
      .prepare(
        "UPDATE connected_storages SET status = ?, frozen_reason = ?, frozen_at = ? WHERE id = ?",
      )
      .run(status, frozenReason, frozenAt, storageId);
  }

  private accountFromRow(row: Record<string, unknown>): Account {
    return {
      id: String(row.id),
      username: String(row.username),
      passwordHash: String(row.password_hash),
      groupId: (row.group_id as string | null | undefined) ?? null,
      isOwner: row.is_owner === 1,
      createdAt: String(row.created_at),
    };
  }

  async createAccount(account: Account): Promise<void> {
    try {
      this.db
        .prepare(
          "INSERT INTO accounts (id, username, password_hash, group_id, is_owner, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          account.id,
          account.username,
          account.passwordHash,
          account.groupId,
          account.isOwner ? 1 : 0,
          account.createdAt,
        );
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: accounts\.username/.test(error.message)) {
        throw new DuplicateUsernameError(account.username);
      }
      throw error;
    }
  }

  async getAccountByUsername(username: string): Promise<Account | null> {
    const row = this.db
      .prepare(
        "SELECT id, username, password_hash, group_id, is_owner, created_at FROM accounts WHERE username = ?",
      )
      .get(username) as Record<string, unknown> | undefined;
    return row ? this.accountFromRow(row) : null;
  }

  async getAccountById(id: string): Promise<Account | null> {
    const row = this.db
      .prepare(
        "SELECT id, username, password_hash, group_id, is_owner, created_at FROM accounts WHERE id = ?",
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.accountFromRow(row) : null;
  }

  async listAccounts(): Promise<Account[]> {
    const rows = this.db
      .prepare(
        "SELECT id, username, password_hash, group_id, is_owner, created_at FROM accounts ORDER BY created_at",
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.accountFromRow(row));
  }

  async createSession(session: Session): Promise<void> {
    this.db
      .prepare("INSERT INTO sessions (id, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(session.id, session.accountId, session.expiresAt, session.createdAt);
  }

  async getSession(id: string): Promise<Session | null> {
    const row = this.db
      .prepare("SELECT id, account_id, expires_at, created_at FROM sessions WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
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
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  async adoptDefaultAccount(input: { username: string; passwordHash: string }): Promise<void> {
    try {
      this.db
        .prepare("UPDATE accounts SET username = ?, password_hash = ? WHERE id = ?")
        .run(input.username, input.passwordHash, DEFAULT_ACCOUNT_ID);
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: accounts\.username/.test(error.message)) {
        throw new DuplicateUsernameError(input.username);
      }
      throw error;
    }
  }

  async setAccountPassword(accountId: string, passwordHash: string): Promise<void> {
    this.db
      .prepare("UPDATE accounts SET password_hash = ? WHERE id = ?")
      .run(passwordHash, accountId);
  }

  async deleteSessionsForAccount(accountId: string, exceptSessionId?: string): Promise<void> {
    if (exceptSessionId === undefined) {
      this.db.prepare("DELETE FROM sessions WHERE account_id = ?").run(accountId);
    } else {
      this.db
        .prepare("DELETE FROM sessions WHERE account_id = ? AND id != ?")
        .run(accountId, exceptSessionId);
    }
  }

  async recordDeadLink(input: {
    key: string;
    kind: DeadLink["kind"];
    reason: string;
    permanent: boolean;
    ttlMs?: number;
    now?: string;
  }): Promise<void> {
    const recordedAt = input.now ?? new Date().toISOString();
    const expiresAt = input.permanent
      ? null
      : new Date(new Date(recordedAt).getTime() + (input.ttlMs ?? MAGNET_DEAD_LINK_TTL_MS)).toISOString();
    // Idempotent: keep the first record (when it was first proven dead).
    this.db
      .prepare(
        "INSERT INTO dead_links (key, kind, reason, permanent, expires_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (key) DO NOTHING",
      )
      .run(input.key, input.kind, input.reason, input.permanent ? 1 : 0, expiresAt, recordedAt);
  }

  async listDeadLinkKeys(options?: { now?: string }): Promise<string[]> {
    // Permanent deaths (expires_at NULL) always filter; soft ones only until their
    // own expiry (so an unresolvable magnet's longer TTL is honored per-record).
    const now = options?.now ?? new Date().toISOString();
    const rows = this.db
      .prepare("SELECT key FROM dead_links WHERE expires_at IS NULL OR expires_at > ?")
      .all(now) as { key: string }[];
    return rows.map((row) => String(row.key));
  }
}
