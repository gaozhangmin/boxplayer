import { describe, it, expect, afterEach } from "vitest";
import { DuplicateUsernameError, type WorkflowRepository } from "../src/repository.js";
import type { Account } from "../src/account-credentials.js";
import { workflowPersistenceFixture } from "./workflow-fixtures.js";

/** A factory that yields a FRESH, empty repository and a teardown. Postgres/SQLite
 *  return async; InMemory is sync — accept both. */
export interface RepoHarness {
  make: () => Promise<WorkflowRepository> | WorkflowRepository;
  teardown?: (repo: WorkflowRepository) => Promise<void> | void;
}

export function runRepositoryContract(name: string, harness: RepoHarness): void {
  describe(`WorkflowRepository contract: ${name}`, () => {
    // Track every repository a test opened and tear it down afterwards, so SQLite
    // file handles / future engine pools don't leak across the (many) contract tests.
    const opened: WorkflowRepository[] = [];
    afterEach(async () => {
      for (const repo of opened.splice(0)) {
        await harness.teardown?.(repo);
      }
    });
    async function fresh(): Promise<WorkflowRepository> {
      const repo = await harness.make();
      opened.push(repo);
      return repo;
    }

    describe("settings", () => {
      it("round-trips an instance setting and returns null for unknown keys", async () => {
        const repo = await fresh();
        expect(await repo.getSetting("missing")).toBeNull();
        await repo.setSetting("daily_sweep_time", "06:00");
        expect(await repo.getSetting("daily_sweep_time")).toBe("06:00");
        await repo.setSetting("daily_sweep_time", "07:30"); // upsert overwrites
        expect(await repo.getSetting("daily_sweep_time")).toBe("07:30");
      });

      it("scopes account settings per account", async () => {
        const repo = await fresh();
        await repo.setAccountSetting("acct_a", "llm_key", "A");
        await repo.setAccountSetting("acct_b", "llm_key", "B");
        expect(await repo.getAccountSetting("acct_a", "llm_key")).toBe("A");
        expect(await repo.getAccountSetting("acct_b", "llm_key")).toBe("B");
        expect(await repo.getAccountSetting("acct_a", "missing")).toBeNull();
      });
    });

    describe("accounts + sessions", () => {
      const account = (over: Partial<Account> = {}): Account => ({
        id: "acct_1",
        username: "alice",
        passwordHash: "h",
        groupId: null,
        isOwner: true,
        createdAt: "2026-07-04T00:00:00.000Z",
        ...over,
      });

      // The implicit default account exists as a seeded schema row on SQLite/Postgres
      // but not on InMemory. Establish it through the public interface so the
      // adoptDefaultAccount contract starts from identical state on every engine.
      async function ensureDefaultAccount(repo: WorkflowRepository): Promise<void> {
        if (!(await repo.getAccountById("acct_default"))) {
          await repo.createAccount(
            account({ id: "acct_default", username: "default", passwordHash: "", isOwner: true }),
          );
        }
      }

      it("creates and reads back an account (discrete columns, is_owner round-trips)", async () => {
        const repo = await fresh();
        await repo.createAccount(account());
        const byName = await repo.getAccountByUsername("alice");
        expect(byName?.id).toBe("acct_1");
        expect(byName?.isOwner).toBe(true);
        expect(byName?.groupId).toBeNull();
        expect((await repo.getAccountById("acct_1"))?.username).toBe("alice");
        expect(await repo.getAccountByUsername("nobody")).toBeNull();
      });

      it("rejects a duplicate username", async () => {
        const repo = await fresh();
        await repo.createAccount(account());
        await expect(repo.createAccount(account({ id: "acct_2" }))).rejects.toBeInstanceOf(
          DuplicateUsernameError,
        );
      });

      it("round-trips and deletes a session", async () => {
        const repo = await fresh();
        await repo.createSession({
          id: "sess_1",
          accountId: "acct_1",
          createdAt: "2026-07-04T00:00:00.000Z",
          expiresAt: "2026-08-04T00:00:00.000Z",
        });
        expect((await repo.getSession("sess_1"))?.accountId).toBe("acct_1");
        await repo.deleteSession("sess_1");
        expect(await repo.getSession("sess_1")).toBeNull();
      });

      it("adoptDefaultAccount claims the seeded acct_default in place", async () => {
        const repo = await fresh();
        await ensureDefaultAccount(repo);
        await repo.adoptDefaultAccount({ username: "owner", passwordHash: "ph" });
        const acct = await repo.getAccountByUsername("owner");
        expect(acct?.id).toBe("acct_default");
        expect(acct?.isOwner).toBe(true);
      });

      it("deletes an account's sessions except an optional kept one", async () => {
        const repo = await fresh();
        await repo.createSession({ id: "s1", accountId: "acct_x", createdAt: "t", expiresAt: "t2" });
        await repo.createSession({ id: "s2", accountId: "acct_x", createdAt: "t", expiresAt: "t2" });
        await repo.deleteSessionsForAccount("acct_x", "s2");
        expect(await repo.getSession("s1")).toBeNull();
        expect(await repo.getSession("s2")).not.toBeNull();
      });
    });

    describe("connected_storages", () => {
      const drive = (over = {}) => ({
        id: "cs_1",
        accountId: "acct_a",
        provider: "pan115",
        providerUid: "uid1",
        payload: { cookie: "A" },
        createdAt: "2026-07-04T00:00:00.000Z",
        ...over,
      });

      it("upserts and lists a drive for its account", async () => {
        const repo = await fresh();
        await repo.upsertConnectedStorage(drive());
        const list = await repo.listConnectedStorages("acct_a");
        expect(list).toHaveLength(1);
        expect(list[0]?.provider).toBe("pan115");
      });

      it("refuses to let a different account overwrite an existing drive binding", async () => {
        const repo = await fresh();
        await repo.upsertConnectedStorage(drive());
        await repo.upsertConnectedStorage(
          drive({ id: "cs_2", accountId: "acct_b", payload: { cookie: "B" } }),
        );
        expect(await repo.listConnectedStorages("acct_a")).toHaveLength(1);
        expect(await repo.listConnectedStorages("acct_b")).toHaveLength(0);
      });

      it("refresh preserves status (frozen stays frozen across re-scan)", async () => {
        const repo = await fresh();
        await repo.upsertConnectedStorage(drive());
        await repo.setConnectedStorageStatus(
          "cs_1",
          "frozen",
          "cookie died",
          "2026-07-04T01:00:00.000Z",
        );
        await repo.upsertConnectedStorage(drive({ payload: { cookie: "refreshed" } })); // same provider/uid
        const found = await repo.findConnectedStorageByUid("pan115", "uid1");
        expect(found?.status).toBe("frozen");
        expect(found?.frozenReason).toBe("cookie died");
      });

      it("finds by uid and deletes fail-closed on account", async () => {
        const repo = await fresh();
        await repo.upsertConnectedStorage(drive());
        expect((await repo.findConnectedStorageByUid("pan115", "uid1"))?.id).toBe("cs_1");
        await repo.deleteConnectedStorage("acct_WRONG", "cs_1"); // wrong account = no-op
        expect(await repo.findConnectedStorageByUid("pan115", "uid1")).not.toBeNull();
        await repo.deleteConnectedStorage("acct_a", "cs_1");
        expect(await repo.findConnectedStorageByUid("pan115", "uid1")).toBeNull();
      });
    });

    describe("dead_links", () => {
      it("records idempotently and hides expired non-permanent links but keeps permanent ones", async () => {
        const repo = await fresh();
        await repo.recordDeadLink({ key: "k_temp", kind: "magnet", reason: "r", permanent: false, ttlMs: 1000, now: "2026-07-04T00:00:00.000Z" });
        await repo.recordDeadLink({ key: "k_temp", kind: "magnet", reason: "changed", permanent: true, now: "2026-07-04T00:00:00.000Z" }); // idempotent: ignored
        await repo.recordDeadLink({ key: "k_perm", kind: "magnet", reason: "r", permanent: true, now: "2026-07-04T00:00:00.000Z" });
        const soon = await repo.listDeadLinkKeys({ now: "2026-07-04T00:00:00.500Z" });
        expect(new Set(soon)).toEqual(new Set(["k_temp", "k_perm"]));
        const later = await repo.listDeadLinkKeys({ now: "2026-07-04T00:00:02.000Z" });
        expect(new Set(later)).toEqual(new Set(["k_perm"]));
      });
    });

    describe("snapshot persist + reserve", () => {
      it("persists a snapshot and reads it back with derived episode summaries", async () => {
        const repo = await fresh();
        const snap = workflowPersistenceFixture();
        await repo.saveWorkflowRunSnapshot(snap);
        const got = await repo.getWorkflowRunSnapshot(snap.workflowRun.id);
        expect(got?.workflowRun.id).toBe(snap.workflowRun.id);
        expect(got?.obtainedEpisodes).toContain("S01E01"); // episode 1 obtained in the fixture
        expect(got?.obtainedEpisodes).not.toContain("S01E02");
      });

      // A snapshot whose transfer_attempts / notifications reference the run's id
      // (validateWorkflowRunSnapshot enforces this). When a test re-ids the run, the
      // child collections must be cleared or re-parented, exactly as the oracle's own
      // reserve tests do (repository.test.ts). These helpers keep the run id coherent.
      const reIded = (id: string, over: Record<string, unknown> = {}) => {
        const base = workflowPersistenceFixture();
        return {
          ...base,
          workflowRun: { ...base.workflowRun, id, status: "queued" as const, finishedAt: null },
          resourceSnapshots: [],
          decisions: [],
          transferAttempts: [],
          notifications: [],
          ...over,
        };
      };

      it("reserves once, then reports already_active for the same season+kind+scope", async () => {
        const repo = await fresh();
        expect((await repo.reserveWorkflowRun(reIded("run_a"))).status).toBe("reserved");
        const again = await repo.reserveWorkflowRun(reIded("run_b"));
        expect(again.status).toBe("already_active");
      });

      it("blockIfEpisodeStatesExist returns already_has_episode_state when the scoped bucket is non-empty", async () => {
        const repo = await fresh();
        // Seed episode states via a TERMINAL (succeeded) run so the active-run check
        // (which precedes the episode-state check) does not short-circuit to
        // already_active — mirrors the oracle's own already_has_episode_state test.
        await repo.saveWorkflowRunSnapshot(workflowPersistenceFixture());
        const blocked = await repo.reserveWorkflowRun(
          reIded("run_d", { blockIfEpisodeStatesExist: true }),
        );
        expect(blocked.status).toBe("already_has_episode_state");
      });

      it("does NOT block reserving the same title on a DIFFERENT drive (cross-drive isolation)", async () => {
        const repo = await fresh();
        await repo.reserveWorkflowRun(reIded("run_A", { connectedStorageId: "cs_A" }));
        const onB = await repo.reserveWorkflowRun(
          reIded("run_B", { connectedStorageId: "cs_B", blockIfEpisodeStatesExist: true }),
        );
        expect(onB.status).toBe("reserved"); // cs_B is a different bucket
      });

      it("re-persist without connectedStorageId preserves the run's original storage", async () => {
        const repo = await fresh();
        const snap = reIded("run_e");
        await repo.saveWorkflowRunSnapshot({ ...snap, connectedStorageId: "cs_keep" });
        await repo.saveWorkflowRunSnapshot({ ...snap }); // omit connectedStorageId
        const got = await repo.getWorkflowRunSnapshot("run_e");
        expect(got?.connectedStorageId).toBe("cs_keep");
      });

      it("re-persist without connectedStorageId writes episodes into the run's ORIGINAL storage bucket", async () => {
        const repo = await fresh();
        const snap = reIded("run_f");
        await repo.saveWorkflowRunSnapshot({ ...snap, connectedStorageId: "cs_keep" });
        // Finalize path: re-persist omits the storage but flips episode 2 to obtained.
        const updatedEpisodes = snap.episodes.map((episode) =>
          episode.episodeCode === "S01E02"
            ? { ...episode, airStatus: "aired" as const, obtained: true, verifiedFileIds: ["file_2"] }
            : episode,
        );
        await repo.saveWorkflowRunSnapshot({ ...snap, episodes: updatedEpisodes });
        const got = await repo.getWorkflowRunSnapshot("run_f");
        // The update must land in the cs_keep bucket the run was persisted onto —
        // not a parallel unscoped bucket that reads never resolve.
        expect(got?.obtainedEpisodes).toContain("S01E02");
      });
    });

    describe("claim + active queries", () => {
      // Build a standalone queued run for a UNIQUE (season, drive) bucket so several
      // can coexist without tripping the same-season active-run guard. Episodes +
      // children are cleared and re-parented so the re-ided season stays coherent
      // (validateWorkflowRunSnapshot rejects orphaned episodes/attempts otherwise).
      const queued = (
        id: string,
        over: {
          startedAt?: string;
          kind?: string;
          connectedStorageId?: string;
          nextAttemptAt?: string;
        } = {},
      ) => {
        const base = workflowPersistenceFixture();
        const seasonId = `season_${id}`;
        return {
          ...base,
          connectedStorageId: over.connectedStorageId ?? `cs_${id}`,
          season: { ...base.season, id: seasonId },
          workflowRun: {
            ...base.workflowRun,
            id,
            trackedSeasonId: seasonId,
            status: "queued" as const,
            finishedAt: null,
            startedAt: over.startedAt ?? base.workflowRun.startedAt,
            ...(over.kind ? { kind: over.kind as typeof base.workflowRun.kind } : {}),
            ...(over.nextAttemptAt ? { nextAttemptAt: over.nextAttemptAt } : {}),
          },
          episodes: [],
          resourceSnapshots: [],
          decisions: [],
          transferAttempts: [],
          notifications: [],
        };
      };

      it("claims the OLDEST queued run of the kind first, then the next, then null", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot(queued("older", { startedAt: "2026-06-11T00:00:00.000Z" }));
        await repo.saveWorkflowRunSnapshot(queued("newer", { startedAt: "2026-06-11T00:05:00.000Z" }));

        const now = "2026-06-11T01:00:00.000Z";
        const first = await repo.claimNextQueuedWorkflowRun({ kind: "type2_init", now });
        expect(first?.workflowRun.id).toBe("older");
        expect(first?.workflowRun.status).toBe("running");

        const second = await repo.claimNextQueuedWorkflowRun({ kind: "type2_init", now });
        expect(second?.workflowRun.id).toBe("newer");
        expect(second?.workflowRun.status).toBe("running");

        // Both drained (now running) → a third claim finds nothing queued.
        const third = await repo.claimNextQueuedWorkflowRun({ kind: "type2_init", now });
        expect(third).toBeNull();
      });

      it("claims an immediately-claimable run and does not pick a later gated one", async () => {
        const repo = await fresh();
        // A claimable run (older startedAt) alongside one gated by a FUTURE
        // nextAttemptAt (newer startedAt). Every engine claims the claimable run:
        //  - the gating-aware engines (SQLite/Postgres via claimableQueuedRuns) filter
        //    the gated run out entirely;
        //  - the InMemory oracle ignores nextAttemptAt but its FIFO-by-startedAt still
        //    picks the older claimable run first.
        // NOTE: the InMemory oracle does NOT honor nextAttemptAt, so a "gated-run-ALONE
        // → null" scenario legitimately diverges across engines and is intentionally
        // NOT asserted here — the pure gate is unit-tested in run-retry-transitions.test.ts.
        await repo.saveWorkflowRunSnapshot(
          queued("claimable", { startedAt: "2026-06-11T00:00:00.000Z" }),
        );
        await repo.saveWorkflowRunSnapshot(
          queued("gated", {
            startedAt: "2026-06-11T00:05:00.000Z",
            nextAttemptAt: "2030-01-01T00:00:00.000Z",
          }),
        );

        const claimed = await repo.claimNextQueuedWorkflowRun({
          kind: "type2_init",
          now: "2026-06-11T01:00:00.000Z",
        });
        expect(claimed?.workflowRun.id).toBe("claimable");
      });

      it("requeueRunningWorkflowRuns turns a running run back to queued and returns the count", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot(queued("q1", { startedAt: "2026-06-11T00:00:00.000Z" }));
        // Claim it → running.
        await repo.claimNextQueuedWorkflowRun({ kind: "type2_init", now: "2026-06-11T01:00:00.000Z" });
        expect((await repo.getWorkflowRunSnapshot("q1"))?.workflowRun.status).toBe("running");

        const count = await repo.requeueRunningWorkflowRuns();
        expect(count).toBe(1);
        const requeued = await repo.getWorkflowRunSnapshot("q1");
        expect(requeued?.workflowRun.status).toBe("queued");
        expect(requeued?.workflowRun.finishedAt).toBeNull();
      });

      it("findActiveWorkflowRun matches (season, kind) and rejects a different scope", async () => {
        const repo = await fresh();
        const snap = queued("find", { startedAt: "2026-06-11T00:00:00.000Z" });
        await repo.saveWorkflowRunSnapshot(snap);

        const found = await repo.findActiveWorkflowRun({
          trackedSeasonId: snap.season.id,
          kind: "type2_init",
          accountId: "acct_default",
          connectedStorageId: snap.connectedStorageId,
        });
        expect(found?.workflowRun.id).toBe("find");

        // Wrong kind → none.
        expect(
          await repo.findActiveWorkflowRun({
            trackedSeasonId: snap.season.id,
            kind: "movie_init",
            accountId: "acct_default",
            connectedStorageId: snap.connectedStorageId,
          }),
        ).toBeNull();
        // Wrong drive scope → none.
        expect(
          await repo.findActiveWorkflowRun({
            trackedSeasonId: snap.season.id,
            kind: "type2_init",
            accountId: "acct_default",
            connectedStorageId: "cs_other",
          }),
        ).toBeNull();
      });

      it("listActiveWorkflowRuns returns queued+running for the scope, excludes terminal, newest-first", async () => {
        const repo = await fresh();
        const scope = { accountId: "acct_default", connectedStorageId: "cs_shared" };
        // Two active runs (different seasons, same drive) + one terminal run.
        await repo.saveWorkflowRunSnapshot(
          queued("act_old", { startedAt: "2026-06-11T00:00:00.000Z", connectedStorageId: "cs_shared" }),
        );
        await repo.saveWorkflowRunSnapshot(
          queued("act_new", { startedAt: "2026-06-11T00:05:00.000Z", connectedStorageId: "cs_shared" }),
        );
        // Terminal (succeeded) run on the same drive — must be excluded.
        const done = queued("done", { startedAt: "2026-06-11T00:03:00.000Z", connectedStorageId: "cs_shared" });
        await repo.saveWorkflowRunSnapshot({
          ...done,
          workflowRun: {
            ...done.workflowRun,
            status: "succeeded" as const,
            finishedAt: "2026-06-11T00:04:00.000Z",
          },
        });

        const active = await repo.listActiveWorkflowRuns(scope);
        expect(active.map((snapshot) => snapshot.workflowRun.id)).toEqual(["act_new", "act_old"]);
      });
    });

    describe("tracked-season + episode queries", () => {
      // A fully self-contained snapshot for a UNIQUE (title, season, drive) tuple.
      // Re-ids the title/season/run so several coexist; children are dropped/re-parented
      // so validateWorkflowRunSnapshot accepts the re-ided run. Episodes are carried on
      // the fixture's default (S01E01 obtained + S01E02) unless overridden.
      const trackedSnapshot = (over: {
        key: string;
        titleName?: string;
        seasonNumber?: number;
        accountId?: string;
        connectedStorageId?: string;
        startedAt?: string;
        runId?: string;
      }) => {
        const base = workflowPersistenceFixture();
        const titleId = `title_${over.key}`;
        const seasonId = `season_${over.key}`;
        return {
          accountId: over.accountId ?? "acct_default",
          connectedStorageId: over.connectedStorageId ?? "cs_default",
          title: { ...base.title, id: titleId, title: over.titleName ?? base.title.title },
          season: {
            ...base.season,
            id: seasonId,
            mediaTitleId: titleId,
            seasonNumber: over.seasonNumber ?? base.season.seasonNumber,
          },
          workflowRun: {
            ...base.workflowRun,
            id: over.runId ?? `run_${over.key}`,
            trackedSeasonId: seasonId,
            startedAt: over.startedAt ?? base.workflowRun.startedAt,
          },
          episodes: base.episodes.map((episode) => ({ ...episode, trackedSeasonId: seasonId })),
          resourceSnapshots: [],
          decisions: [],
          transferAttempts: [],
          notifications: [],
        };
      };

      it("getTrackedSeasonState returns the LATEST run's state for the season", async () => {
        const repo = await fresh();
        const seasonKey = "latest";
        // Two runs for the SAME (season, drive), different startedAt.
        await repo.saveWorkflowRunSnapshot(
          trackedSnapshot({ key: seasonKey, runId: "run_old", startedAt: "2026-06-11T00:00:00.000Z" }),
        );
        await repo.saveWorkflowRunSnapshot(
          trackedSnapshot({ key: seasonKey, runId: "run_new", startedAt: "2026-06-12T00:00:00.000Z" }),
        );
        const state = await repo.getTrackedSeasonState(`season_${seasonKey}`, {
          accountId: "acct_default",
          connectedStorageId: "cs_default",
        });
        expect(state).not.toBeNull();
        expect(state?.season.id).toBe(`season_${seasonKey}`);
        expect(state?.connectedStorageId).toBe("cs_default");
        // Episodes come from the season+drive bucket: S01E01 obtained + S01E02.
        expect(state?.episodes.map((episode) => episode.episodeCode)).toEqual(["S01E01", "S01E02"]);
        expect(state?.episodes.find((episode) => episode.episodeCode === "S01E01")?.obtained).toBe(true);
        // Unknown season → null.
        expect(
          await repo.getTrackedSeasonState("season_missing", {
            accountId: "acct_default",
            connectedStorageId: "cs_default",
          }),
        ).toBeNull();
      });

      it("listTrackedSeasonStates returns seasons ordered by compareTrackedSeasonStates (title, season, id)", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot(
          trackedSnapshot({ key: "zulu", titleName: "Zulu", connectedStorageId: "cs_default" }),
        );
        await repo.saveWorkflowRunSnapshot(
          trackedSnapshot({ key: "alpha", titleName: "Alpha", connectedStorageId: "cs_default" }),
        );
        const states = await repo.listTrackedSeasonStates({
          accountId: "acct_default",
          connectedStorageId: "cs_default",
        });
        expect(states.map((state) => state.title.title)).toEqual(["Alpha", "Zulu"]);
      });

      it("listTrackedSeasonStates isolates by drive scope", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot(
          trackedSnapshot({ key: "onA", connectedStorageId: "cs_A" }),
        );
        const onB = await repo.listTrackedSeasonStates({
          accountId: "acct_default",
          connectedStorageId: "cs_B",
        });
        expect(onB).toHaveLength(0);
        const onA = await repo.listTrackedSeasonStates({
          accountId: "acct_default",
          connectedStorageId: "cs_A",
        });
        expect(onA.map((state) => state.season.id)).toEqual(["season_onA"]);
      });

      it("listAllTrackedSeasonStates returns seasons across accounts, each with its own accountId", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot(
          trackedSnapshot({ key: "acctA", titleName: "Alpha", accountId: "acct_A", connectedStorageId: "cs_A" }),
        );
        await repo.saveWorkflowRunSnapshot(
          trackedSnapshot({ key: "acctB", titleName: "Bravo", accountId: "acct_B", connectedStorageId: "cs_B" }),
        );
        const all = await repo.listAllTrackedSeasonStates();
        const bySeason = new Map(all.map((state) => [state.season.id, state]));
        expect(bySeason.get("season_acctA")?.accountId).toBe("acct_A");
        expect(bySeason.get("season_acctB")?.accountId).toBe("acct_B");
        // Ordered by title.
        expect(all.map((state) => state.title.title)).toEqual(["Alpha", "Bravo"]);
      });

      it("listEpisodeStates returns the drive's episodes for a concrete scope", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot(
          trackedSnapshot({ key: "eps", connectedStorageId: "cs_default" }),
        );
        const episodes = await repo.listEpisodeStates("season_eps", {
          accountId: "acct_default",
          connectedStorageId: "cs_default",
        });
        expect(episodes.map((episode) => episode.episodeCode)).toEqual(["S01E01", "S01E02"]);
        expect(episodes.find((episode) => episode.episodeCode === "S01E01")?.obtained).toBe(true);
        // A different drive has no episodes for this season.
        expect(
          await repo.listEpisodeStates("season_eps", {
            accountId: "acct_default",
            connectedStorageId: "cs_other",
          }),
        ).toHaveLength(0);
      });
    });

    describe("agent_steps + progress", () => {
      const step = (ordinal: number, toolName: string) => ({
        ordinal,
        toolName,
        args: { keyword: "x" },
        activity: "搜",
        phase: "search" as const,
        at: "2026-06-22T00:00:00.000Z",
      });

      // NOTE: idempotency on (run, ordinal) is a PRODUCTION-engine invariant
      // (SQLite/Postgres ON CONFLICT DO NOTHING). The InMemory oracle intentionally
      // just pushes (no dedup), so a duplicate-ordinal append legitimately diverges
      // across engines and is asserted engine-specifically (repository-contract-sqlite
      // / agent-steps.pg), NOT in this shared contract.
      it("appends steps and lists them ordered by ordinal", async () => {
        const repo = await fresh();
        // Persist the run so its ownership row exists for the scope-gated read below.
        const snapshot = workflowPersistenceFixture();
        await repo.saveWorkflowRunSnapshot(snapshot);
        const runId = snapshot.workflowRun.id;

        await repo.appendAgentStep(runId, step(1, "transferCandidate"));
        await repo.appendAgentStep(runId, step(0, "searchResources"));
        const steps = await repo.listAgentSteps(runId);
        expect(steps.map((s) => s.ordinal)).toEqual([0, 1]);
        expect(steps[0]!.toolName).toBe("searchResources");
      });

      it("listAgentSteps is fail-closed on scope (wrong scope → [], correct scope → steps)", async () => {
        const repo = await fresh();
        const snapshot = workflowPersistenceFixture();
        await repo.saveWorkflowRunSnapshot(snapshot);
        const runId = snapshot.workflowRun.id;
        await repo.appendAgentStep(runId, step(0, "searchResources"));

        // Wrong account → not visible → [].
        expect(
          await repo.listAgentSteps(runId, { accountId: "acct_other", connectedStorageId: null }),
        ).toEqual([]);
        // Correct scope (the fixture run is owned by acct_default, unscoped storage) → steps.
        const visible = await repo.listAgentSteps(runId, {
          accountId: "acct_default",
          connectedStorageId: null,
        });
        expect(visible.map((s) => s.ordinal)).toEqual([0]);
      });

      it("clearAgentSteps empties the run's steps", async () => {
        const repo = await fresh();
        const snapshot = workflowPersistenceFixture();
        await repo.saveWorkflowRunSnapshot(snapshot);
        const runId = snapshot.workflowRun.id;
        await repo.appendAgentStep(runId, step(0, "searchResources"));
        await repo.appendAgentStep(runId, step(1, "transferCandidate"));
        await repo.clearAgentSteps(runId);
        expect(await repo.listAgentSteps(runId)).toEqual([]);
      });

      it("updateWorkflowRunProgress clamps percent monotonically; unknown run is a no-op", async () => {
        const repo = await fresh();
        const snapshot = workflowPersistenceFixture();
        await repo.saveWorkflowRunSnapshot(snapshot);
        const runId = snapshot.workflowRun.id;

        await repo.updateWorkflowRunProgress(runId, {
          activity: "转存",
          phase: "transfer",
          percent: 40,
          updatedAt: "2026-06-22T00:00:10.000Z",
        });
        expect((await repo.getWorkflowRunSnapshot(runId))?.workflowRun.progress?.percent).toBe(40);

        // Lower percent never rewinds the bar (monotonic clamp), but text follows latest.
        await repo.updateWorkflowRunProgress(runId, {
          activity: "整理(相位回退)",
          phase: "organize",
          percent: 20,
          updatedAt: "2026-06-22T00:00:20.000Z",
        });
        const clamped = (await repo.getWorkflowRunSnapshot(runId))?.workflowRun.progress;
        expect(clamped?.percent).toBe(40);
        expect(clamped?.activity).toBe("整理(相位回退)");

        // Higher percent advances.
        await repo.updateWorkflowRunProgress(runId, {
          activity: "完成收尾",
          phase: "finalize",
          percent: 70,
          updatedAt: "2026-06-22T00:00:30.000Z",
        });
        expect((await repo.getWorkflowRunSnapshot(runId))?.workflowRun.progress?.percent).toBe(70);

        // Unknown run → no-op (never throws).
        await expect(
          repo.updateWorkflowRunProgress("unknown_run", {
            activity: "x",
            phase: "search",
            percent: 5,
            updatedAt: "t",
          }),
        ).resolves.toBeUndefined();
      });
    });

    describe("notifications", () => {
      it("listNotifications returns a run's notification for its (account, storage) scope", async () => {
        const repo = await fresh();
        // The fixture run is owned by acct_default with an explicit drive here.
        await repo.saveWorkflowRunSnapshot({
          ...workflowPersistenceFixture(),
          connectedStorageId: "cs_notif",
        });
        const got = await repo.listNotifications({
          accountId: "acct_default",
          connectedStorageId: "cs_notif",
        });
        expect(got.map((n) => n.id)).toEqual(["notification_1"]);
      });

      it("listNotifications applies a future `since` cutoff (returns []) and a scope mismatch (returns [])", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot({
          ...workflowPersistenceFixture(),
          connectedStorageId: "cs_notif",
        });
        // since strictly after the notification's createdAt → filtered out.
        expect(
          await repo.listNotifications({
            accountId: "acct_default",
            connectedStorageId: "cs_notif",
            since: "2030-01-01T00:00:00.000Z",
          }),
        ).toEqual([]);
        // Wrong drive scope → not visible.
        expect(
          await repo.listNotifications({
            accountId: "acct_default",
            connectedStorageId: "cs_other",
          }),
        ).toEqual([]);
      });

      it("listRecentNotificationsWithAccount tags each notification with its owning account", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot({
          ...workflowPersistenceFixture(),
          accountId: "acct_default",
          connectedStorageId: "cs_notif",
        });
        const recent = await repo.listRecentNotificationsWithAccount();
        expect(recent).toHaveLength(1);
        expect(recent[0]?.accountId).toBe("acct_default");
        expect(recent[0]?.connectedStorageId).toBe("cs_notif");
        expect(recent[0]?.notification.id).toBe("notification_1");
      });

      it("listRecentNotificationsWithAccount surfaces unscoped runs as null, never the internal sentinel", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot({
          ...workflowPersistenceFixture(),
          accountId: "acct_default",
        });
        const recent = await repo.listRecentNotificationsWithAccount();
        expect(recent).toHaveLength(1);
        expect(recent[0]?.connectedStorageId).toBeNull();
      });
    });

    describe("lifecycle mutations", () => {
      // A standalone QUEUED run for a unique (season, drive) bucket, children cleared so
      // the re-ided run passes validateWorkflowRunSnapshot.
      const queuedRun = (over: {
        id: string;
        status?: "queued" | "running" | "failed" | "succeeded";
        connectedStorageId?: string;
        tmdbId?: number;
        type?: "movie" | "tv" | "anime";
        seasonNumber?: number;
      }) => {
        const base = workflowPersistenceFixture();
        const seasonId = `season_${over.id}`;
        const titleId = `title_${over.id}`;
        return {
          accountId: "acct_default",
          connectedStorageId: over.connectedStorageId ?? `cs_${over.id}`,
          title: {
            ...base.title,
            id: titleId,
            tmdbId: over.tmdbId ?? base.title.tmdbId,
            type: over.type ?? base.title.type,
          },
          season: {
            ...base.season,
            id: seasonId,
            mediaTitleId: titleId,
            seasonNumber: over.seasonNumber ?? base.season.seasonNumber,
          },
          workflowRun: {
            ...base.workflowRun,
            id: over.id,
            trackedSeasonId: seasonId,
            status: over.status ?? ("queued" as const),
            finishedAt: over.status === "succeeded" ? base.workflowRun.finishedAt : null,
          },
          episodes: base.episodes.map((e) => ({ ...e, trackedSeasonId: seasonId })),
          resourceSnapshots: [],
          decisions: [],
          transferAttempts: [],
          notifications: [],
        };
      };

      it("cancelQueuedWorkflowRun cancels a QUEUED run and it disappears from reads", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot(queuedRun({ id: "cancelme", connectedStorageId: "cs_c" }));
        const scope = { accountId: "acct_default", connectedStorageId: "cs_c" };
        expect((await repo.cancelQueuedWorkflowRun("cancelme", scope)).status).toBe("cancelled");
        expect(await repo.getWorkflowRunSnapshot("cancelme", scope)).toBeNull();
        expect(await repo.listActiveWorkflowRuns(scope)).toHaveLength(0);
      });

      it("cancelQueuedWorkflowRun refuses a non-queued (succeeded) run", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot(
          queuedRun({ id: "donerun", status: "succeeded", connectedStorageId: "cs_d" }),
        );
        expect(
          (
            await repo.cancelQueuedWorkflowRun("donerun", {
              accountId: "acct_default",
              connectedStorageId: "cs_d",
            })
          ).status,
        ).toBe("not_cancellable");
      });

      it("untrackTitle removes a tracked tv season by tmdbId + mediaKind", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot(
          queuedRun({ id: "utv", status: "succeeded", connectedStorageId: "cs_u", tmdbId: 555, type: "tv" }),
        );
        const scope = { accountId: "acct_default", connectedStorageId: "cs_u" };
        const result = await repo.untrackTitle(555, scope, "tv");
        expect(result).toEqual({ status: "untracked", removedSeasons: 1 });
        expect(await repo.listTrackedSeasonStates(scope)).toHaveLength(0);
      });

      it("untrackTitle returns not_found for a mismatched mediaKind (movie vs tv namespace)", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot(
          queuedRun({ id: "utv2", status: "succeeded", connectedStorageId: "cs_u2", tmdbId: 777, type: "tv" }),
        );
        const scope = { accountId: "acct_default", connectedStorageId: "cs_u2" };
        expect((await repo.untrackTitle(777, scope, "movie")).status).toBe("not_found");
        // untouched
        expect(await repo.listTrackedSeasonStates(scope)).toHaveLength(1);
      });

      it("untrackTitle returns in_flight and removes nothing when a target season has a running run", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot(
          queuedRun({ id: "urun", status: "running", connectedStorageId: "cs_u3", tmdbId: 888, type: "tv" }),
        );
        const scope = { accountId: "acct_default", connectedStorageId: "cs_u3" };
        expect(await repo.untrackTitle(888, scope, "tv")).toEqual({
          status: "in_flight",
          removedSeasons: 0,
        });
        expect(await repo.listTrackedSeasonStates(scope)).toHaveLength(1);
      });

      it("retryFailedWorkflowRun requeues a failed run so it becomes claimable", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot(
          queuedRun({ id: "failed_r", status: "failed", connectedStorageId: "cs_r" }),
        );
        const scope = { accountId: "acct_default", connectedStorageId: "cs_r" };
        expect((await repo.retryFailedWorkflowRun("failed_r", scope)).status).toBe("retried");
        const after = await repo.getWorkflowRunSnapshot("failed_r", scope);
        expect(after?.workflowRun.status).toBe("queued");
        // Immediately claimable (counters cleared, no future nextAttemptAt).
        const claimed = await repo.claimNextQueuedWorkflowRun({
          kind: "type2_init",
          now: "2030-01-01T00:00:00.000Z",
        });
        expect(claimed?.workflowRun.id).toBe("failed_r");
      });

      it("retryFailedWorkflowRun refuses a non-failed (queued) run", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot(queuedRun({ id: "queued_r", connectedStorageId: "cs_rq" }));
        expect(
          (
            await repo.retryFailedWorkflowRun("queued_r", {
              accountId: "acct_default",
              connectedStorageId: "cs_rq",
            })
          ).status,
        ).toBe("not_retriable");
      });
    });

    describe("unscoped storage surfaces as null", () => {
      it("returns connectedStorageId=null for a run persisted with no drive (sentinel is an internal detail)", async () => {
        const repo = await fresh();
        await repo.saveWorkflowRunSnapshot({
          ...workflowPersistenceFixture(),
          accountId: "acct_default",
          // connectedStorageId omitted → collapses to the UNSCOPED_STORAGE sentinel internally.
          transferAttempts: [],
          notifications: [],
        });
        const snap = await repo.getWorkflowRunSnapshot("run_1");
        // The domain contract says the sentinel must surface as null, never leak "__unscoped__".
        expect(snap?.connectedStorageId).toBeNull();
      });
    });

    describe("cross-drive season payload isolation", () => {
      it("hydrates each run's snapshot with ITS drive's season payload when the same season id is tracked on two drives", async () => {
        const repo = await fresh();
        const base = workflowPersistenceFixture();
        // Same season id ("season_1") on two drives, but DIFFERENT per-drive season
        // payload (storageDirectoryId). tracked_seasons PK is (id, connected_storage_id),
        // so loading the season by id alone could hydrate the WRONG drive's payload.
        const onDrive = (storageId: string, runId: string, dir: string) => ({
          ...base,
          connectedStorageId: storageId,
          workflowRun: { ...base.workflowRun, id: runId },
          season: { ...base.season, storageDirectoryId: dir },
          // child rows are validated to belong to workflowRun.id; drop them since we re-id the run.
          transferAttempts: [],
          notifications: [],
        });
        await repo.saveWorkflowRunSnapshot(onDrive("cs_A", "run_dirA", "dir_A"));
        await repo.saveWorkflowRunSnapshot(onDrive("cs_B", "run_dirB", "dir_B"));

        const a = await repo.getWorkflowRunSnapshot("run_dirA");
        const b = await repo.getWorkflowRunSnapshot("run_dirB");
        expect(a?.season.storageDirectoryId).toBe("dir_A");
        expect(b?.season.storageDirectoryId).toBe("dir_B");
      });

      it("lists one tracked-season state per (season, drive), not collapsed by season id", async () => {
        const repo = await fresh();
        const base = workflowPersistenceFixture();
        // season.id is drive-independent (`${title.id}_s${n}`), so the SAME season id
        // exists on both drives. Listing must return a state PER DRIVE — collapsing by
        // season id would drop a drive (and make the desktop sweep skip it).
        const onDrive = (storageId: string, runId: string) => ({
          ...base,
          connectedStorageId: storageId,
          workflowRun: { ...base.workflowRun, id: runId },
          transferAttempts: [],
          notifications: [],
        });
        await repo.saveWorkflowRunSnapshot(onDrive("cs_A", "run_mdA"));
        await repo.saveWorkflowRunSnapshot(onDrive("cs_B", "run_mdB"));

        // The cross-account sweep list (what runScheduledType3 patrols) must see both drives.
        const all = await repo.listAllTrackedSeasonStates();
        const allStorages = all
          .filter((s) => s.season.id === base.season.id)
          .map((s) => s.connectedStorageId)
          .sort();
        expect(allStorages).toEqual(["cs_A", "cs_B"]);

        // The account-scoped list (all drives) must too.
        const scoped = await repo.listTrackedSeasonStates({ accountId: "acct_default", connectedStorageId: null });
        const scopedStorages = scoped
          .filter((s) => s.season.id === base.season.id)
          .map((s) => s.connectedStorageId)
          .sort();
        expect(scopedStorages).toEqual(["cs_A", "cs_B"]);
      });

      it("findActiveWorkflowRun returns the SCOPED drive's active run, not null, when a newer active run exists on another drive", async () => {
        const repo = await fresh();
        const base = workflowPersistenceFixture();
        const activeOn = (storageId: string, runId: string, startedAt: string) => ({
          ...base,
          connectedStorageId: storageId,
          workflowRun: { ...base.workflowRun, id: runId, status: "queued" as const, finishedAt: null, startedAt },
          transferAttempts: [],
          notifications: [],
        });
        // drive A has an OLDER active run; drive B has a NEWER active run (same season+kind).
        await repo.saveWorkflowRunSnapshot(activeOn("cs_A", "run_fa_A", "2026-07-01T00:00:00.000Z"));
        await repo.saveWorkflowRunSnapshot(activeOn("cs_B", "run_fa_B", "2026-07-02T00:00:00.000Z"));

        const found = await repo.findActiveWorkflowRun({
          trackedSeasonId: base.season.id,
          kind: base.workflowRun.kind,
          accountId: "acct_default",
          connectedStorageId: "cs_A",
        });
        // Must scope-filter FIRST: return cs_A's run, not the newer cs_B run (and not null).
        expect(found?.workflowRun.id).toBe("run_fa_A");
      });
    });

    // NOTE: backfillConnectedStorageId is deliberately NOT in the shared contract.
    // It is a genuine, pre-existing engine divergence: at runtime a null-storage
    // persist collapses to the UNSCOPED_STORAGE sentinel, so SQLite's backfill (which
    // targets the sentinel) actively pins the row (count 1), while Postgres's backfill
    // targets literal NULL and is effectively dead code post-persist (count 0). The
    // shared contract only asserts behavior ALL engines agree on; SQLite's backfill is
    // locked in repository-contract-sqlite.test.ts, InMemory's in migrate-backfill-storage-id.test.ts.
  });
}
