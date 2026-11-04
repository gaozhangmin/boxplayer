export interface QuarkSearchLocation {
  fileId: string
  parentFileId?: string
  isDir: boolean
}

/** A search result's file ID must never be used as a directory for a regular file. */
export async function resolveQuarkSearchDirectory(
  result: QuarkSearchLocation,
  readParent: () => Promise<string | undefined>
): Promise<string> {
  let directory = result.isDir ? result.fileId : result.parentFileId
  if (!directory && !result.isDir) directory = await readParent()
  if (!directory) throw new Error('Quark search result has no directory')
  return ['0', '/', 'root', 'quark_root'].includes(directory) ? 'quark_root' : directory
}
