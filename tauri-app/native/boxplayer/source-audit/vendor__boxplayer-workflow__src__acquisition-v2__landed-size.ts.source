import type { StorageExecutor } from "../ports.js";

export interface LandedSize {
  fileCount: number;
  totalBytes: number;
}

/**
 * Best-effort sum of the landed video files across the given storage dirs, so a
 * notification can show the TRUE per-episode size (总字节 / 文件数) instead of a
 * claimed quality tag.
 *
 * Returns undefined on ANY read failure — most importantly the per-run 115 call
 * budget being exhausted on a heavy run (`Pan115RiskControlError`): the
 * size is a notification nicety read AFTER the acquisition already succeeded, so
 * it must never throw and fail an otherwise-good run. Also undefined when no
 * videos are found (omit the line rather than report 0 bytes).
 */
export async function readLandedSize(
  executor: Pick<StorageExecutor, "listVideoFiles">,
  directoryIds: string[],
): Promise<LandedSize | undefined> {
  try {
    let fileCount = 0;
    let totalBytes = 0;
    for (const directoryId of directoryIds) {
      if (!directoryId) {
        continue;
      }
      const files = await executor.listVideoFiles(directoryId);
      for (const file of files) {
        fileCount += 1;
        totalBytes += file.sizeBytes;
      }
    }
    return fileCount > 0 ? { fileCount, totalBytes } : undefined;
  } catch {
    return undefined;
  }
}
