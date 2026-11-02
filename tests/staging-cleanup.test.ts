import { describe, expect, it } from "vitest";
import { withStagingCleanup } from "../src/index.js";

function recordingExecutor(behavior?: () => Promise<void>) {
  const removed: string[] = [];
  return {
    removed,
    executor: {
      async removeDirectory(id: string) {
        removed.push(id);
        if (behavior) await behavior();
        return { removed: true };
      },
    },
  };
}

describe("withStagingCleanup", () => {
  it("removes the run's staging dir after the body succeeds", async () => {
    const { executor, removed } = recordingExecutor();
    const result = await withStagingCleanup(
      { executor, stagingDirectoryId: "stg" },
      async () => "coverage-result",
    );
    expect(result).toBe("coverage-result");
    expect(removed).toEqual(["stg"]);
  });

  it("removes staging EVEN WHEN the body throws — the harness-level leak guard", async () => {
    // This is the 斗破苍穹 fix: the agent reportNoCoverage'd / the loop blew up and
    // never discardStaging'd, leaking 335 files. The finally cleans it regardless.
    const { executor, removed } = recordingExecutor();
    await expect(
      withStagingCleanup({ executor, stagingDirectoryId: "stg" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(removed).toEqual(["stg"]);
  });

  it("is idempotent — a removeDirectory failure (agent already discarded) is swallowed", async () => {
    const { executor } = recordingExecutor(async () => {
      throw new Error("PAN115_DIRECTORY_NOT_FOUND: already gone");
    });
    const result = await withStagingCleanup({ executor, stagingDirectoryId: "stg" }, async () => "ok");
    expect(result).toBe("ok"); // cleanup error must not mask the real result
  });
});
