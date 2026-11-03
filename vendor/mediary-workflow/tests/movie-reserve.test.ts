import { describe, expect, it } from "vitest";
import {
  InMemoryWorkflowRepository,
  queueMovieAcquisition,
  reserveMovie,
  type MediaTitle,
} from "../src/index.js";

const now = () => "2026-06-15T00:00:00.000Z";

function unreleasedMovie(): MediaTitle {
  return {
    id: "tmdb_movie_1000",
    tmdbId: 1000,
    type: "movie",
    title: "未上映大片",
    originalTitle: "Future Blockbuster",
    year: 2026,
    releaseDate: "2026-12-25", // future
    aliases: [],
  };
}

describe("reserveMovie — track an unreleased film WITHOUT running the agent (air-time gate)", () => {
  it("tracks the film with a non-claimable 'reserved' run (the worker never picks it up before release)", async () => {
    const repository = new InMemoryWorkflowRepository();

    const result = await reserveMovie({
      title: unreleasedMovie(),
      repository,
      createWorkflowRunId: () => "run_reserve_1",
      now,
    });

    expect(result.status).toBe("reserved");
    // The run exists but is NOT queued/running, so nothing claims it.
    const saved = await repository.getWorkflowRunSnapshot("run_reserve_1");
    expect(saved?.workflowRun.status).toBe("reserved");
    expect(saved?.workflowRun.kind).toBe("movie_init");
    const claimed = await repository.claimNextQueuedWorkflowRun({ kind: "movie_init", now: now() });
    expect(claimed).toBeNull(); // reserved is not queued → worker leaves it alone
  });

  it("a reserved film is tracked (anchor unobtained) but NOT an active run", async () => {
    const repository = new InMemoryWorkflowRepository();
    await reserveMovie({ title: unreleasedMovie(), repository, createWorkflowRunId: () => "run_reserve_1", now });

    const state = await repository.getTrackedSeasonState("tmdb_movie_1000_movie");
    expect(state).not.toBeNull();
    expect(state!.episodes).toHaveLength(1);
    expect(state!.episodes[0]!.obtained).toBe(false);
    // Not active → frontend won't show 获取中, and a later patrol can reserve a running run.
    const active = await repository.findActiveWorkflowRun({ trackedSeasonId: "tmdb_movie_1000_movie", kind: "movie_init" });
    expect(active).toBeNull();
  });

  it("is idempotent: re-reserving the same film does not create a second run", async () => {
    const repository = new InMemoryWorkflowRepository();
    await reserveMovie({ title: unreleasedMovie(), repository, createWorkflowRunId: () => "run_reserve_1", now });

    const second = await reserveMovie({
      title: unreleasedMovie(),
      repository,
      createWorkflowRunId: () => "run_reserve_2",
      now,
    });

    expect(second.status).toBe("already_tracked");
    expect(await repository.getWorkflowRunSnapshot("run_reserve_2")).toBeNull();
  });

  it("refuses to reserve a film that is already being acquired (active run wins)", async () => {
    const repository = new InMemoryWorkflowRepository();
    await queueMovieAcquisition({
      title: { ...unreleasedMovie(), releaseDate: "2024-01-01" },
      keyword: "x",
      repository,
      createWorkflowRunId: () => "run_acquire_1",
      now,
    });

    const reserved = await reserveMovie({
      title: unreleasedMovie(),
      repository,
      createWorkflowRunId: () => "run_reserve_1",
      now,
    });

    expect(reserved.status).toBe("already_running");
  });
});
