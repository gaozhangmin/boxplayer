import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import {getDrivePane} from './ports'
import {previewScopeKey} from './folderPreviewScope'
const DebugLog={mSaveWarning:(_message:string)=>{}}
export interface FolderPreviewParams {
  user_id: string
  drive_id: string
  file_id: string
  name?: string
  path?: string
}

const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_PREVIEW_FILES = 12

interface CacheEntry {
  ts: number
  items: IAliGetFileModel[]
  promise?: Promise<IAliGetFileModel[]>
}

const previewCache = new Map<string, CacheEntry>()

const cacheKey = (p: FolderPreviewParams) => previewScopeKey(p)

async function fetchFolderItemsRaw(p:FolderPreviewParams):Promise<IAliGetFileModel[]>{return getDrivePane().action('folderPreview',[p])}

export async function fetchFolderPreview(p: FolderPreviewParams): Promise<IAliGetFileModel[]> {
  const key = cacheKey(p)
  const now = Date.now()
  const cached = previewCache.get(key)
  if (cached) {
    if (cached.promise) return cached.promise
    if (now - cached.ts < CACHE_TTL_MS) return cached.items
  }
  const promise = fetchFolderItemsRaw(p).then((items) => {
    previewCache.set(key, { ts: Date.now(), items })
    return items
  }).catch((e) => {
    previewCache.delete(key)
    DebugLog.mSaveWarning('folderPreview promise rejected: ' + (e as Error).message)
    return [] as IAliGetFileModel[]
  })
  previewCache.set(key, { ts: now, items: [], promise })
  return promise
}

export function clearFolderPreviewCache(): void {
  previewCache.clear()
}

export const FOLDER_PREVIEW_MAX = MAX_PREVIEW_FILES
