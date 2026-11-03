import { describe, expect, it } from "vitest";
import { Storage115Simulator } from "../src/acquisition-v2/storage-115-simulator.js";

/**
 * Subtitles are first-class (§1.14): the inspect tools surface an `isSubtitle`
 * hint (by extension) so the agent moves a subtitle alongside its video and
 * never deletes a pack's subtitles as residue. VobSub ships as `.sub`+`.idx`.
 */
describe("Storage115Simulator.listTree — isSubtitle hint", () => {
  it("flags subtitle files by extension, distinct from video", async () => {
    const storage = new Storage115Simulator({
      packs: {
        cand: {
          files: [
            { path: "[Group] Show/Show - 01.mkv", sizeBytes: 100 },
            { path: "[Group] Show/Show - 01.ass", sizeBytes: 3 },
            { path: "[Group] Show/Show - 01.srt", sizeBytes: 2 },
            { path: "[Group] Show/Show - 01.idx", sizeBytes: 1 },
          ],
        },
      },
    });
    const staging = await storage.createDirectory({ name: "staging", parentId: "root" });
    await storage.transferCandidate({ candidateId: "cand", intoDirectoryId: staging });
    const tree = await storage.listTree({ directoryId: staging });

    const byExt = (ext: string) => tree.find((f) => f.path.endsWith(ext))!;
    expect(byExt(".mkv").isVideo).toBe(true);
    expect(byExt(".mkv").isSubtitle).toBe(false);
    expect(byExt(".ass").isSubtitle).toBe(true);
    expect(byExt(".ass").isVideo).toBe(false);
    expect(byExt(".srt").isSubtitle).toBe(true);
    expect(byExt(".idx").isSubtitle).toBe(true); // VobSub
  });
});
