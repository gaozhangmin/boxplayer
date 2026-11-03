import { describe, expect, it } from "vitest";
import pg from "pg";
import { MockLanguageModelV3 } from "ai/test";
import {
  FakeResourceProvider,
  FakeStorageExecutor,
  initializeWorkflowPostgresSchema,
  PostgresWorkflowRepository,
  queueMovieAcquisition,
  runQueuedMovieAcquisition,
  type MediaTitle,
} from "../src/index.js";

// Postgres-only regression for the bug a concurrent multi-drive live test found:
// the WORKER dropped connectedStorageId when persisting a finished run, so on
// Postgres (composite PK incl. connected_storage_id) the obtained episode marks
// landed on a phantom __unscoped__ row while the real drive showed obtained=false
// → the per-drive library read the film as missing. InMemory masked it (it derives
// the bucket differently), so this guard must run against real Postgres + the worker.
//   MEDIA_TRACK_POSTGRES_URL=… npx vitest run packages/workflow/tests/worker-drive-scope.pg.test.ts

const URL = process.env.MEDIA_TRACK_POSTGRES_URL;
const d = URL ? describe : describe.skip;

const fixedNow = () => "2026-06-13T00:00:00.000Z";
const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const;

const TMDB = 872585;
const T_ID = "tmdb_movie_872585";
const S_ID = "tmdb_movie_872585_movie";
const DRIVE = "wds_driveX";

function movieTitle(): MediaTitle {
  return { id: T_ID, tmdbId: TMDB, type: "movie", title: "奥本海默", originalTitle: "Oppenheimer", year: 2023, aliases: ["Oppenheimer"] };
}

/** Film already in storage → agent inspects, sees it, marks MOVIE from evidence. */
function inspectAndMarkModel() {
  const steps = [
    { tool: "inspectTargetDir", input: {} },
    { tool: "markObtained", input: { codes: ["MOVIE"] } },
    { tool: "finish", input: {} },
  ];
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      if (i < steps.length) {
        const s = steps[i]!;
        i += 1;
        return {
          content: [{ type: "tool-call" as const, toolCallId: `c${i}`, toolName: s.tool, input: JSON.stringify(s.input) }],
          finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
          usage: USAGE,
          warnings: [],
        };
      }
      return { content: [{ type: "text" as const, text: "已在库" }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
    },
  });
}

d("worker persists the obtained mark on the run's DRIVE (Postgres)", () => {
  it("a scoped movie run's obtained mark lands on its drive, not __unscoped__", async () => {
    const pool = new pg.Pool({ connectionString: URL });
    const repository = new PostgresWorkflowRepository(pool);
    try {
      await initializeWorkflowPostgresSchema(pool);
      // clean slate
      await pool.query("DELETE FROM episode_states WHERE tracked_season_id = $1", [S_ID]);
      await pool.query("DELETE FROM workflow_runs WHERE tracked_season_id = $1", [S_ID]);
      await pool.query("DELETE FROM tracked_seasons WHERE id = $1", [S_ID]);
      await pool.query("DELETE FROM connected_storages WHERE id = $1", [DRIVE]);
      await pool.query(
        "INSERT INTO connected_storages (id, account_id, provider, provider_uid, payload, created_at) " +
          "VALUES ($1,'acct_wds','pan115','wds_uidX','{}'::jsonb,'2026-06-13T00:00:00Z') ON CONFLICT DO NOTHING",
        [DRIVE],
      );

      const title = movieTitle();
      await queueMovieAcquisition({
        title,
        keyword: "奥本海默 4K",
        repository,
        accountId: "acct_wds",
        connectedStorageId: DRIVE,
        createWorkflowRunId: () => "run_wds_movie",
        now: fixedNow,
      });

      // Film already present so the run is a succeeded no-op (agent marks from evidence).
      const storage = new FakeStorageExecutor();
      const movieDir = await storage.createDirectory({ name: `${title.title} (${title.year})`, parentId: "movies_root" });
      storage.seedDirectoryFiles(movieDir, [
        { id: "oppen_v", storageDirectoryId: movieDir, name: "Oppenheimer.2023.mkv", sizeBytes: 8_000_000_000, episodeCode: null, providerFileId: "oppen_v" },
      ]);

      const result = await runQueuedMovieAcquisition({
        repository,
        resourceProvider: new FakeResourceProvider({ keywordResults: {} }),
        storage,
        model: inspectAndMarkModel(),
        moviesParentDirectoryId: "movies_root",
        now: fixedNow,
      });
      expect(result.status).toBe("ran");

      // The obtained mark must be on DRIVE, obtained=true...
      const onDrive = await pool.query(
        "SELECT (payload->>'obtained') AS obtained FROM episode_states WHERE tracked_season_id=$1 AND connected_storage_id=$2",
        [S_ID, DRIVE],
      );
      expect(onDrive.rows.length).toBeGreaterThan(0);
      expect(onDrive.rows.every((r) => r.obtained === "true")).toBe(true);

      // ...and NO phantom __unscoped__ row leaked.
      const unscoped = await pool.query(
        "SELECT count(*)::int AS n FROM episode_states WHERE tracked_season_id=$1 AND connected_storage_id='__unscoped__'",
        [S_ID],
      );
      expect(unscoped.rows[0]?.n).toBe(0);
      const seasonBuckets = await pool.query(
        "SELECT connected_storage_id FROM tracked_seasons WHERE id=$1 ORDER BY connected_storage_id",
        [S_ID],
      );
      expect(seasonBuckets.rows.map((r) => r.connected_storage_id)).toEqual([DRIVE]);

      // cleanup
      await pool.query("DELETE FROM episode_states WHERE tracked_season_id = $1", [S_ID]);
      await pool.query("DELETE FROM workflow_runs WHERE tracked_season_id = $1", [S_ID]);
      await pool.query("DELETE FROM tracked_seasons WHERE id = $1", [S_ID]);
      await pool.query("DELETE FROM connected_storages WHERE id = $1", [DRIVE]);
    } finally {
      await pool.end();
    }
  });
});
