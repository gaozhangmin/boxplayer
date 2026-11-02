import { describe, expect, it } from "vitest";
import {
  FakeResourceProvider,
  FakeStorageExecutor,
  type VerifiedFile,
} from "../src/index.js";
import { runPan115ShareAdapterSmoke } from "../src/pan115-transfer-smoke.js";

describe("runPan115ShareAdapterSmoke", () => {
  it("records failed or duplicate 115 transfer surfaces until adapter verification materializes files", async () => {
    const resourceProvider = new FakeResourceProvider({
      keywordResults: {
        "Show 4K": [
          {
            title: "Show expired link",
            providerPayload: { url: "https://115.com/s/expired?password=bad" },
          },
          {
            title: "Show already transferred elsewhere",
            providerPayload: { url: "https://115.com/s/duplicate?password=dup" },
          },
          {
            title: "Show working link",
            providerPayload: { url: "https://115.com/s/working?password=ok" },
          },
        ],
      },
    });
    const storage = new FakeStorageExecutor({
      transferOutcomes: {
        snapshot_1_candidate_1: {
          status: "failed",
          providerMessage: "资源失效",
          files: [],
        },
        snapshot_1_candidate_2: {
          status: "no_target_change",
          providerMessage: "资源已转存过(可能在其他目录)，目标目录未新增文件",
          files: [],
        },
        snapshot_1_candidate_3: {
          status: "succeeded",
          providerMessage: "",
          files: [verifiedFile("smoke_dir", "file_S01E01", "S01E01")],
        },
      },
    });

    const result = await runPan115ShareAdapterSmoke({
      keyword: "Show 4K",
      workflowRunId: "smoke_run",
      directoryId: "smoke_dir",
      resourceProvider,
      storage,
    });

    expect(result.status).toBe("succeeded");
    expect(result.snapshot?.keyword).toBe("Show 4K");
    expect(result.transferAttempts.map((attempt) => attempt.status)).toEqual([
      "failed",
      "no_target_change",
      "succeeded",
    ]);
    expect(result.finalFiles).toEqual([verifiedFile("smoke_dir", "file_S01E01", "S01E01")]);
    expect(result.failureReasons).toEqual([
      "资源失效",
      "资源已转存过(可能在其他目录)，目标目录未新增文件",
    ]);
  });

  it("reports exhausted candidates when every 115 share produces no target file", async () => {
    const resourceProvider = new FakeResourceProvider({
      keywordResults: {
        "Show 4K": [
          {
            title: "Show expired link",
            providerPayload: { url: "https://115.com/s/expired?password=bad" },
          },
        ],
      },
    });
    const storage = new FakeStorageExecutor({
      transferOutcomes: {
        snapshot_1_candidate_1: {
          status: "failed",
          providerMessage: "资源失效",
          files: [],
        },
      },
    });

    const result = await runPan115ShareAdapterSmoke({
      keyword: "Show 4K",
      workflowRunId: "smoke_run",
      directoryId: "smoke_dir",
      resourceProvider,
      storage,
    });

    expect(result).toMatchObject({
      status: "exhausted",
      failureReasons: ["资源失效"],
      finalFiles: [],
    });
  });

  it("ignores non-115 candidates before attempting transfer", async () => {
    const resourceProvider = {
      async search() {
        return {
          id: "snapshot_custom",
          provider: "fake",
          keyword: "Show 4K",
          createdAt: "2026-01-01T00:00:00.000Z",
          candidates: [
            {
              id: "magnet_candidate",
              snapshotId: "snapshot_custom",
              index: 0,
              title: "Show magnet",
              type: "magnet" as const,
              source: "fake",
              providerPayload: { url: "magnet:?xt=urn:btih:abc" },
            },
          ],
        };
      },
    };

    const result = await runPan115ShareAdapterSmoke({
      keyword: "Show 4K",
      workflowRunId: "smoke_run",
      directoryId: "smoke_dir",
      resourceProvider,
      storage: new FakeStorageExecutor(),
    });

    expect(result).toMatchObject({
      status: "no_115_candidates",
      transferAttempts: [],
      finalFiles: [],
    });
  });
});

function verifiedFile(directoryId: string, id: string, episodeCode: string): VerifiedFile {
  return {
    id,
    storageDirectoryId: directoryId,
    name: `Show.${episodeCode}.mkv`,
    sizeBytes: 1_000_000_000,
    episodeCode,
    providerFileId: id,
  };
}
