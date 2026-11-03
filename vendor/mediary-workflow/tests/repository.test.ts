import { describe, expect, it } from "vitest";
import {
  episodeCode,
  InMemoryWorkflowRepository,
  type AgentDecision,
  type EpisodeState,
  type MediaTitle,
  type NotificationEvent,
  type ResourceSnapshot,
  type TrackedSeason,
  type TransferAttempt,
  type WorkflowRun,
} from "../src/index.js";
import { workflowPersistenceFixture } from "./workflow-fixtures.js";

describe("InMemoryWorkflowRepository", () => {
  it("persists a complete workflow run snapshot and returns defensive copies", async () => {
    const repository = new InMemoryWorkflowRepository();
    const snapshot = workflowPersistenceFixture();

    await repository.saveWorkflowRunSnapshot(snapshot);
    snapshot.episodes[0]!.obtained = false;
    snapshot.resourceSnapshots[0]!.candidates[0]!.title = "mutated outside repository";

    const loaded = await repository.getWorkflowRunSnapshot("run_1");

    expect(loaded).toMatchObject({
      title: { id: "title_1" },
      season: { id: "season_1" },
      workflowRun: { id: "run_1", status: "succeeded" },
      obtainedEpisodes: ["S01E01"],
      providerAheadEpisodes: [],
    });
    expect(loaded?.episodes.find((episode) => episode.episodeCode === "S01E01")).toMatchObject({
      obtained: true,
      verifiedFileIds: ["file_1"],
    });
    expect(loaded?.resourceSnapshots[0]?.candidates[0]?.title).toBe("Show S01E01");

    loaded!.episodes[0]!.obtained = false;
    const loadedAgain = await repository.getWorkflowRunSnapshot("run_1");

    expect(loadedAgain?.episodes[0]).toMatchObject({
      episodeCode: "S01E01",
      obtained: true,
    });
  });

  it("requeues orphaned running runs (worker-crash recovery), leaving queued and terminal runs untouched", async () => {
    const repository = new InMemoryWorkflowRepository();
    const base = workflowPersistenceFixture({
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });
    const save = (id: string, status: "running" | "queued" | "succeeded") =>
      repository.saveWorkflowRunSnapshot({
        ...base,
        workflowRun: {
          ...base.workflowRun,
          id,
          status,
          finishedAt: status === "succeeded" ? base.workflowRun.finishedAt : null,
        },
      });
    await save("run_orphan", "running");
    await save("run_queued", "queued");
    await save("run_done", "succeeded");

    const requeued = await repository.requeueRunningWorkflowRuns();

    expect(requeued).toBe(1);
    expect((await repository.getWorkflowRunSnapshot("run_orphan"))?.workflowRun.status).toBe("queued");
    expect((await repository.getWorkflowRunSnapshot("run_queued"))?.workflowRun.status).toBe("queued");
    expect((await repository.getWorkflowRunSnapshot("run_done"))?.workflowRun.status).toBe("succeeded");
    // the requeued orphan is now claimable again
    const claimed = await repository.claimNextQueuedWorkflowRun({ kind: "type2_init", now: "2026-06-11T01:00:00.000Z" });
    expect(claimed).not.toBeNull();
  });

  it("rejects inconsistent workflow snapshots before mutating stored state", async () => {
    const repository = new InMemoryWorkflowRepository();
    const validSnapshot = workflowPersistenceFixture();
    await repository.saveWorkflowRunSnapshot(validSnapshot);

    const invalidSnapshot = workflowPersistenceFixture({
      workflowRun: {
        ...validSnapshot.workflowRun,
        status: "failed",
      },
      decisions: [
        {
          ...validSnapshot.decisions[0]!,
          selectedCandidateIds: ["snapshot_99_candidate_1"],
        },
      ],
    });

    await expect(repository.saveWorkflowRunSnapshot(invalidSnapshot)).rejects.toThrow(
      "Agent decision referenced candidates outside persisted resource snapshots",
    );

    const loaded = await repository.getWorkflowRunSnapshot("run_1");
    expect(loaded?.workflowRun.status).toBe("succeeded");
    expect(loaded?.decisions[0]?.selectedCandidateIds).toEqual(["snapshot_1_candidate_1"]);
  });

  it("rejects each invalid reference branch with a clear error", async () => {
    const cases: Array<{
      name: string;
      snapshot: ReturnType<typeof workflowPersistenceFixture>;
      message: string;
    }> = [
      {
        name: "season title mismatch",
        snapshot: workflowPersistenceFixture({
          season: {
            ...workflowPersistenceFixture().season,
            mediaTitleId: "other_title",
          },
        }),
        message: "Tracked season does not belong to media title",
      },
      {
        name: "workflow run season mismatch",
        snapshot: workflowPersistenceFixture({
          workflowRun: {
            ...workflowPersistenceFixture().workflowRun,
            trackedSeasonId: "other_season",
          },
        }),
        message: "Workflow run does not belong to tracked season",
      },
      {
        name: "episode season mismatch",
        snapshot: workflowPersistenceFixture({
          episodes: [
            {
              ...workflowPersistenceFixture().episodes[0]!,
              trackedSeasonId: "other_season",
            },
          ],
        }),
        message: "Episode S01E01 does not belong to tracked season",
      },
      {
        name: "transfer run mismatch",
        snapshot: workflowPersistenceFixture({
          transferAttempts: [
            {
              ...workflowPersistenceFixture().transferAttempts[0]!,
              workflowRunId: "other_run",
            },
          ],
        }),
        message: "Transfer attempt transfer_1 does not belong to workflow run",
      },
      {
        name: "notification run mismatch",
        snapshot: workflowPersistenceFixture({
          notifications: [
            {
              ...workflowPersistenceFixture().notifications[0]!,
              workflowRunId: "other_run",
            },
          ],
        }),
        message: "Notification notification_1 does not belong to workflow run",
      },
      {
        name: "candidate snapshot mismatch",
        snapshot: workflowPersistenceFixture({
          resourceSnapshots: [
            {
              ...workflowPersistenceFixture().resourceSnapshots[0]!,
              candidates: [
                {
                  ...workflowPersistenceFixture().resourceSnapshots[0]!.candidates[0]!,
                  snapshotId: "other_snapshot",
                },
              ],
            },
          ],
        }),
        message: "Resource candidate snapshot_1_candidate_1 does not belong to snapshot snapshot_1",
      },
      {
        name: "transfer unknown candidate",
        snapshot: workflowPersistenceFixture({
          transferAttempts: [
            {
              ...workflowPersistenceFixture().transferAttempts[0]!,
              candidateId: "snapshot_99_candidate_1",
            },
          ],
        }),
        message: "Transfer attempt transfer_1 referenced an unknown candidate",
      },
    ];

    for (const testCase of cases) {
      const repository = new InMemoryWorkflowRepository();
      await expect(repository.saveWorkflowRunSnapshot(testCase.snapshot), testCase.name).rejects.toThrow(testCase.message);
      await expect(repository.getWorkflowRunSnapshot("run_1")).resolves.toBeNull();
    }
  });

  it("lists stored episode state for a tracked season", async () => {
    const repository = new InMemoryWorkflowRepository();
    const snapshot = workflowPersistenceFixture();

    await repository.saveWorkflowRunSnapshot(snapshot);

    await expect(repository.listEpisodeStates("season_1")).resolves.toEqual(snapshot.episodes);
    await expect(repository.listEpisodeStates("missing_season")).resolves.toEqual([]);
  });

  it("lists tracked season states and claims the oldest queued workflow run", async () => {
    const repository = new InMemoryWorkflowRepository();
    const queuedOld = workflowPersistenceFixture({
      workflowRun: {
        ...workflowPersistenceFixture().workflowRun,
        id: "run_queued_old",
        status: "queued",
        startedAt: "2026-06-11T00:00:00.000Z",
        finishedAt: null,
      },
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });
    const queuedNew = workflowPersistenceFixture({
      title: {
        ...workflowPersistenceFixture().title,
        id: "title_2",
        title: "Other Show",
      },
      season: {
        ...workflowPersistenceFixture().season,
        id: "season_2",
        mediaTitleId: "title_2",
      },
      workflowRun: {
        ...workflowPersistenceFixture().workflowRun,
        id: "run_queued_new",
        status: "queued",
        trackedSeasonId: "season_2",
        startedAt: "2026-06-11T00:01:00.000Z",
        finishedAt: null,
      },
      episodes: workflowPersistenceFixture().episodes.map((episode) => ({
        ...episode,
        trackedSeasonId: "season_2",
      })),
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });
    await repository.saveWorkflowRunSnapshot(queuedNew);
    await repository.saveWorkflowRunSnapshot(queuedOld);

    await expect(repository.listTrackedSeasonStates()).resolves.toMatchObject([
      {
        season: { id: "season_2" },
      },
      {
        season: { id: "season_1" },
      },
    ]);

    const claimed = await repository.claimNextQueuedWorkflowRun({
      kind: "type2_init",
      now: "2026-06-11T00:02:00.000Z",
    });

    expect(claimed).toMatchObject({
      workflowRun: {
        id: "run_queued_old",
        status: "running",
        auditEvents: [
          { type: "resource_snapshot_created" },
          { type: "workflow_claimed" },
        ],
      },
    });
    await expect(repository.getWorkflowRunSnapshot("run_queued_old")).resolves.toMatchObject({
      workflowRun: {
        status: "running",
      },
    });
  });

  it("finds the latest active workflow run for a tracked season and kind", async () => {
    const repository = new InMemoryWorkflowRepository();
    const succeeded = workflowPersistenceFixture({
      workflowRun: {
        ...workflowPersistenceFixture().workflowRun,
        id: "run_succeeded",
        status: "succeeded",
        startedAt: "2026-06-11T00:00:00.000Z",
      },
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });
    const oldActive = workflowPersistenceFixture({
      workflowRun: {
        ...workflowPersistenceFixture().workflowRun,
        id: "run_old_active",
        status: "queued",
        startedAt: "2026-06-11T00:01:00.000Z",
        finishedAt: null,
      },
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });
    const latestActive = workflowPersistenceFixture({
      workflowRun: {
        ...workflowPersistenceFixture().workflowRun,
        id: "run_latest_active",
        status: "running",
        startedAt: "2026-06-11T00:02:00.000Z",
        finishedAt: null,
      },
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });

    await repository.saveWorkflowRunSnapshot(succeeded);
    await repository.saveWorkflowRunSnapshot(oldActive);
    await repository.saveWorkflowRunSnapshot(latestActive);

    const active = await repository.findActiveWorkflowRun({
      trackedSeasonId: "season_1",
      kind: "type2_init",
    });
    active!.workflowRun.status = "failed";

    const activeAgain = await repository.findActiveWorkflowRun({
      trackedSeasonId: "season_1",
      kind: "type2_init",
    });

    expect(activeAgain?.workflowRun.id).toBe("run_latest_active");
    expect(activeAgain?.workflowRun.status).toBe("running");
    await expect(
      repository.findActiveWorkflowRun({
        trackedSeasonId: "season_1",
        kind: "type3_monitor",
      }),
    ).resolves.toBeNull();
  });

  it("reserves a workflow run only when there is no active run or tracked state", async () => {
    const repository = new InMemoryWorkflowRepository();
    const active = workflowPersistenceFixture({
      workflowRun: {
        ...workflowPersistenceFixture().workflowRun,
        id: "run_active",
        status: "running",
        finishedAt: null,
      },
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });
    const competing = workflowPersistenceFixture({
      workflowRun: {
        ...workflowPersistenceFixture().workflowRun,
        id: "run_competing",
        status: "running",
        finishedAt: null,
      },
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });
    await repository.saveWorkflowRunSnapshot(active);

    await expect(
      repository.reserveWorkflowRun({
        ...competing,
        blockIfEpisodeStatesExist: true,
      }),
    ).resolves.toMatchObject({
      status: "already_active",
      snapshot: {
        workflowRun: { id: "run_active" },
      },
    });
    await expect(repository.getWorkflowRunSnapshot("run_competing")).resolves.toBeNull();

    const trackedRepository = new InMemoryWorkflowRepository();
    await trackedRepository.saveWorkflowRunSnapshot(workflowPersistenceFixture());
    const trackedResult = await trackedRepository.reserveWorkflowRun({
      ...competing,
      blockIfEpisodeStatesExist: true,
    });
    expect(trackedResult.status).toBe("already_has_episode_state");
    expect(trackedResult.status === "already_has_episode_state" ? trackedResult.episodes[0]?.episodeCode : null).toBe(
      "S01E01",
    );
    await expect(trackedRepository.getWorkflowRunSnapshot("run_competing")).resolves.toBeNull();

    const emptyRepository = new InMemoryWorkflowRepository();
    await expect(
      emptyRepository.reserveWorkflowRun({
        ...competing,
        blockIfEpisodeStatesExist: true,
      }),
    ).resolves.toMatchObject({
      status: "reserved",
      snapshot: {
        workflowRun: { id: "run_competing" },
      },
    });
    await expect(emptyRepository.getWorkflowRunSnapshot("run_competing")).resolves.toMatchObject({
      workflowRun: { status: "running" },
    });
  });

  it("blocks a second acquisition for the same title under the title lock, across season and kind", async () => {
    const repository = new InMemoryWorkflowRepository();
    // An active Type 2 run for season 1 of title_1.
    const seasonOneRun = workflowPersistenceFixture({
      workflowRun: {
        ...workflowPersistenceFixture().workflowRun,
        id: "run_s1",
        kind: "type2_init",
        status: "running",
        finishedAt: null,
      },
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });
    await repository.saveWorkflowRunSnapshot(seasonOneRun);

    // Second click: season 2 of the SAME title — different season id AND a
    // different kind (series init). The old per-(season,kind) lock would miss
    // this entirely; the title lock must catch it.
    const seasonTwo: TrackedSeason = { ...seasonOneRun.season, id: "season_2", seasonNumber: 2 };
    await expect(
      repository.reserveWorkflowRun({
        title: seasonOneRun.title,
        season: seasonTwo,
        workflowRun: {
          id: "run_s2",
          kind: "type1_package_init",
          status: "queued",
          trackedSeasonId: seasonTwo.id,
          startedAt: "2026-06-11T02:00:00.000Z",
          finishedAt: null,
          auditEvents: [],
        },
        episodes: [],
        resourceSnapshots: [],
        decisions: [],
        transferAttempts: [],
        notifications: [],
        blockIfTitleHasActiveRun: true,
      }),
    ).resolves.toMatchObject({
      status: "already_active",
      snapshot: { workflowRun: { id: "run_s1" } },
    });
    await expect(repository.getWorkflowRunSnapshot("run_s2")).resolves.toBeNull();
  });

  it("does not block a different title under the title lock", async () => {
    const repository = new InMemoryWorkflowRepository();
    await repository.saveWorkflowRunSnapshot(
      workflowPersistenceFixture({
        workflowRun: {
          ...workflowPersistenceFixture().workflowRun,
          id: "run_s1",
          status: "running",
          finishedAt: null,
        },
        resourceSnapshots: [],
        decisions: [],
        transferAttempts: [],
        notifications: [],
      }),
    );

    const otherTitle: MediaTitle = { ...workflowPersistenceFixture().title, id: "title_2", tmdbId: 200 };
    const otherSeason: TrackedSeason = {
      ...workflowPersistenceFixture().season,
      id: "season_t2",
      mediaTitleId: otherTitle.id,
    };
    await expect(
      repository.reserveWorkflowRun({
        title: otherTitle,
        season: otherSeason,
        workflowRun: {
          id: "run_other",
          kind: "type2_init",
          status: "queued",
          trackedSeasonId: otherSeason.id,
          startedAt: "2026-06-11T02:00:00.000Z",
          finishedAt: null,
          auditEvents: [],
        },
        episodes: [],
        resourceSnapshots: [],
        decisions: [],
        transferAttempts: [],
        notifications: [],
        blockIfTitleHasActiveRun: true,
      }),
    ).resolves.toMatchObject({ status: "reserved" });
  });

  it("expires stale active workflow runs during reservation", async () => {
    const repository = new InMemoryWorkflowRepository();
    const stale = workflowPersistenceFixture({
      workflowRun: {
        ...workflowPersistenceFixture().workflowRun,
        id: "run_stale",
        status: "running",
        startedAt: "2026-06-11T00:00:00.000Z",
        finishedAt: null,
      },
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });
    const competing = workflowPersistenceFixture({
      workflowRun: {
        ...workflowPersistenceFixture().workflowRun,
        id: "run_competing",
        status: "running",
        startedAt: "2026-06-11T01:00:00.000Z",
        finishedAt: null,
      },
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });

    await repository.saveWorkflowRunSnapshot(stale);

    await expect(
      repository.reserveWorkflowRun({
        ...competing,
        blockIfEpisodeStatesExist: true,
        staleActiveRunStartedBefore: "2026-06-11T00:30:00.000Z",
        staleFinishedAt: "2026-06-11T01:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "reserved",
      snapshot: {
        workflowRun: { id: "run_competing" },
      },
    });

    await expect(repository.getWorkflowRunSnapshot("run_stale")).resolves.toMatchObject({
      workflowRun: {
        status: "failed",
        finishedAt: "2026-06-11T01:00:00.000Z",
        auditEvents: [
          { type: "resource_snapshot_created" },
          { type: "workflow_expired" },
        ],
      },
      episodes: [],
    });
  });
});


describe("listNotifications", () => {
  it("returns notifications across runs, newest first", async () => {
    const { InMemoryWorkflowRepository } = await import("../src/index.js");
    const repository = new InMemoryWorkflowRepository();
    const base = workflowPersistenceFixture();
    await repository.saveWorkflowRunSnapshot({
      ...base,
      notifications: [
        { id: "n1", workflowRunId: base.workflowRun.id, kind: "tracking_initialized", title: "A", body: "a", createdAt: "2026-06-12T08:00:00.000Z" },
      ],
    });
    const second = workflowPersistenceFixture();
    second.workflowRun = { ...second.workflowRun, id: "run_2", trackedSeasonId: "season_2" };
    second.season = { ...second.season, id: "season_2" };
    second.episodes = second.episodes.map((episode) => ({ ...episode, trackedSeasonId: "season_2" }));
    second.transferAttempts = second.transferAttempts.map((attempt) => ({ ...attempt, workflowRunId: "run_2" }));
    await repository.saveWorkflowRunSnapshot({
      ...second,
      notifications: [
        { id: "n2", workflowRunId: "run_2", kind: "episodes_restored", title: "B", body: "b", createdAt: "2026-06-13T08:00:00.000Z" },
      ],
    });

    const feed = await repository.listNotifications();
    expect(feed.map((notification) => notification.id)).toEqual(["n2", "n1"]);
  });
});
