import { describe, expect, it } from "vitest";
import type { VerifiedFile } from "../src/index.js";
import { readLandedSize } from "../src/acquisition-v2/landed-size.js";

const MB = 1024 * 1024;

function file(id: string, sizeBytes: number): VerifiedFile {
  return { id, providerFileId: id, storageDirectoryId: "d", name: `${id}.mkv`, sizeBytes, episodeCode: null };
}

describe("readLandedSize", () => {
  it("sums video bytes and counts across all landing dirs", async () => {
    const byDir: Record<string, VerifiedFile[]> = {
      d1: [file("a", 410 * MB), file("b", 410 * MB)],
      d2: [file("c", 380 * MB)],
    };
    const executor = { listVideoFiles: async (dir: string) => byDir[dir] ?? [] };
    expect(await readLandedSize(executor, ["d1", "d2"])).toEqual({
      fileCount: 3,
      totalBytes: (410 + 410 + 380) * MB,
    });
  });

  it("skips empty directory ids", async () => {
    const executor = { listVideoFiles: async () => [file("a", 100 * MB)] };
    expect(await readLandedSize(executor, ["", "d1"])).toEqual({ fileCount: 1, totalBytes: 100 * MB });
  });

  it("returns undefined when no videos are found (omit, never a 0-byte line)", async () => {
    const executor = { listVideoFiles: async () => [] as VerifiedFile[] };
    expect(await readLandedSize(executor, ["d1"])).toBeUndefined();
  });

  it("returns undefined on ANY read failure — a heavy run's budget must not fail the size", async () => {
    const executor = {
      listVideoFiles: async () => {
        throw new Error("PAN115_RATE_LIMIT: API call budget exhausted before listItems");
      },
    };
    expect(await readLandedSize(executor, ["d1"])).toBeUndefined();
  });
});
