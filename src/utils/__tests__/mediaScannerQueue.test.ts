import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as nodePath from 'node:path'

const mediaStore = {
  mediaItems: [] as any[],
  folders: [] as any[],
  addFolder: vi.fn(),
  pruneOrphanDuplicateFolders: vi.fn(),
  beginPersistenceBatch: vi.fn(),
  checkpointPersistenceBatch: vi.fn(),
  endPersistenceBatch: vi.fn(),
  reconcileFolderSource: vi.fn(),
  removeFolder: vi.fn(),
  setScanning: vi.fn(),
  setScanProgress: vi.fn()
}

const storage = new Map<string, string>()
const settingStore = {
  mediaLibrarySubtitleScope: 'same-folder' as const,
  apiAIMediaScrapeEnabled: false
}
const mediaDb = {
  getIndexedMediaFileIds: vi.fn().mockResolvedValue(new Set()),
  getMediaLibraryFolderFileIds: vi.fn().mockResolvedValue([]),
  reconcileMediaLibraryFolder: vi.fn().mockResolvedValue(undefined)
}

vi.mock('../../store/medialibrary', () => ({ useMediaLibraryStore: () => mediaStore }))
vi.mock('../../store', () => ({ usePanTreeStore: () => ({ drive_id: 'quark', user_id: 'quark_user' }) }))
vi.mock('../../setting/settingstore', () => ({ default: () => settingStore }))
vi.mock('../message', () => ({ default: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('../libraryScanRateLimiter', () => ({
  libraryScanRateLimitScope: vi.fn(() => 'test-scope'),
  rateLimitSingleScanPage: async function* (_scope: string, fetchPage: () => Promise<any[]>) { yield await fetchPage() }
}))
vi.mock('../../user/userdal', () => ({
  default: {
    GetUserToken: vi.fn().mockReturnValue({ user_id: 'quark_user', tokenfrom: 'quark' }),
    GetUserListFromDB: vi.fn().mockResolvedValue([])
  }
}))
class MockTmdbTransientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TmdbTransientError'
  }
}

vi.mock('../tmdb', () => ({
  TmdbService: { getInstance: () => ({}) },
  TmdbTransientError: MockTmdbTransientError,
  tmdbImageUrl: vi.fn()
}))
vi.mock('../db', () => ({ default: mediaDb }))

let MediaScanner: typeof import('../mediaScanner').MediaScanner

beforeAll(async () => {
  vi.stubGlobal('self', globalThis)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  })
  MediaScanner = (await import('../mediaScanner')).MediaScanner
})

const folder = (id: string) => ({
  drive_id: 'quark',
  file_id: id,
  parent_file_id: 'quark_root',
  name: id,
  path: `/${id}`,
  isDir: true
}) as any

describe('MediaScanner scan queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
    mediaStore.mediaItems = []
    mediaStore.folders = []
    settingStore.apiAIMediaScrapeEnabled = false
    mediaDb.getMediaLibraryFolderFileIds.mockResolvedValue([])
  })

  it('runs an Agent silent scan after an existing media-library scan finishes', async () => {
    let releaseFirst!: () => void
    const firstItems = new Promise<any[]>((resolve) => {
      releaseFirst = () => resolve([])
    })
    const scanner = new MediaScanner()
    const getFolderItems = vi.fn()
      .mockImplementationOnce(() => firstItems)
      .mockResolvedValueOnce([])
    ;(scanner as any).getFolderItemsWithRetry = getFolderItems

    const firstScan = scanner.scanFolder(folder('background-folder'), 'quark', { incremental: true, silent: true })
    await vi.waitFor(() => expect(getFolderItems).toHaveBeenCalledTimes(1))

    const agentScan = scanner.scanFolder(folder('agent-import-folder'), 'quark', { incremental: true, silent: true })
    releaseFirst()
    await Promise.all([firstScan, agentScan])

    expect(getFolderItems).toHaveBeenCalledTimes(2)
    expect(getFolderItems.mock.calls[1][0].file_id).toBe('agent-import-folder')
  })

  it('does not expose an in-flight Agent scan as a resumable manual scrape', async () => {
    let finishScan!: () => void
    const items = new Promise<any[]>((resolve) => {
      finishScan = () => resolve([])
    })
    const scanner = new MediaScanner()
    ;(scanner as any).getFolderItemsWithRetry = vi.fn().mockReturnValue(items)

    const scan = scanner.scanFolder(folder('agent-import-folder'), 'quark', { incremental: false, silent: true })
    await vi.waitFor(() => expect((scanner as any).getFolderItemsWithRetry).toHaveBeenCalled())

    expect(storage.has('media_scan_checkpoint')).toBe(false)
    finishScan()
    await scan
  })

  it('does not add a video source when the folder contains no videos', async () => {
    const scanner = new MediaScanner()
    ;(scanner as any).getFolderItemsWithRetry = vi.fn().mockResolvedValue([])

    await scanner.scanFolder(folder('book-only-folder'), 'quark', { silent: true })

    expect(mediaStore.addFolder).not.toHaveBeenCalled()
  })

  it('rejects a silent Agent scan when provider traversal fails', async () => {
    const scanner = new MediaScanner()
    ;(scanner as any).getFolderItemsWithRetry = vi.fn().mockRejectedValue(new Error('provider list failed'))

    await expect(scanner.scanFolder(folder('agent-import-folder'), 'quark', { silent: true })).rejects.toThrow('provider list failed')
    expect(mediaStore.setScanning).toHaveBeenLastCalledWith(false)
    expect(mediaStore.beginPersistenceBatch).toHaveBeenCalledTimes(1)
    expect(mediaStore.endPersistenceBatch).toHaveBeenCalledTimes(1)
  })

  it('uses drive file IDs when deciding which files an incremental scan can skip', () => {
    mediaStore.mediaItems = [{
      id: 'tmdb-movie-id',
      driveFiles: [{ id: 'movie-file-id' }],
      seasons: [{ episodes: [{ driveFiles: [{ id: 'episode-file-id' }] }] }]
    }]
    const scanner = new MediaScanner()

    expect(Array.from((scanner as any).getIndexedDriveFileIds()).sort()).toEqual([':::episode-file-id', ':::movie-file-id'])
  })

  it('scopes media-source and file keys by provider, account, and drive', () => {
    const scanner = new MediaScanner()
    const first = (scanner as any).getScopedFolderKey({ driveServerId: 'quark', userId: 'quark_a', driveId: 'quark' }, '0')
    const second = (scanner as any).getScopedFolderKey({ driveServerId: 'drive115', userId: 'drive115_b', driveId: 'drive115' }, '0')
    const firstFile = (scanner as any).getScopedDriveFileKey({ driveServerId: 'quark', userId: 'quark_a', driveId: 'quark', id: '1' })
    const secondFile = (scanner as any).getScopedDriveFileKey({ driveServerId: 'quark', userId: 'quark_b', driveId: 'quark', id: '1' })

    expect(first).not.toBe(second)
    expect(firstFile).not.toBe(secondFile)
  })

  it('checkpoints a scan after 100 processed items', () => {
    const scanner = new MediaScanner()
    ;(scanner as any).resetPersistenceCheckpoint()
    ;(scanner as any).checkpointScanPersistence(99)
    expect(mediaStore.checkpointPersistenceBatch).not.toHaveBeenCalled()

    ;(scanner as any).checkpointScanPersistence(1)
    expect(mediaStore.checkpointPersistenceBatch).toHaveBeenCalledTimes(1)
  })

  it('leaves a final request-layer transient failure pending for the next incremental scan', async () => {
    vi.useFakeTimers()
    try {
      const scanner = new MediaScanner()
      const file = { id: 'retry-file', name: 'Retry.Movie.2026.mkv', path: '/Retry.Movie.2026.mkv', driveId: 'quark', driveServerId: 'quark', fileSize: 1 } as any
      const processFile = vi.spyOn(scanner as any, 'processVideoFileWithoutAI')
        .mockRejectedValue(new MockTmdbTransientError('429'))

      const result = (scanner as any).processVideoBatchWithTransientRetry([file], 'folder', 'folder-id')
      await vi.runAllTimersAsync()

      await expect(result).resolves.toEqual({ unmatched: [], completed: [], unresolved: [file] })
      expect(processFile).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps cloud scan progress below 100 percent until traversal completes', async () => {
    const scanner = new MediaScanner()
    const video = { drive_id: 'quark', file_id: 'video-file', parent_file_id: 'movie-folder', name: 'Movie.2026.mkv', path: '/Movie.2026.mkv', isDir: false, size: 1 } as any
    ;(scanner as any).getFolderItemsWithRetry = vi.fn().mockResolvedValue([video])
    vi.spyOn(scanner as any, 'processVideoFileWithoutAI').mockResolvedValue(null)

    await scanner.scanFolder(folder('movie-folder'), 'quark', { silent: true })

    expect(mediaStore.setScanProgress).toHaveBeenCalledWith(1, 2)
    expect(mediaStore.setScanProgress).toHaveBeenLastCalledWith(1, 1)
  })

  it('sends unmatched videos to AI only after regular scraping has finished', async () => {
    settingStore.apiAIMediaScrapeEnabled = true
    const scanner = new MediaScanner()
    const rootVideo = { drive_id: 'quark', file_id: 'root-video', parent_file_id: 'root-folder', name: 'Root.Movie.2026.mkv', path: '/Root.Movie.2026.mkv', isDir: false, size: 1 } as any
    const childFolder = { drive_id: 'quark', file_id: 'child-folder', parent_file_id: 'root-folder', name: 'Child', path: '/Child', isDir: true } as any
    const childVideo = { drive_id: 'quark', file_id: 'child-video', parent_file_id: 'child-folder', name: 'Child.Movie.2026.mkv', path: '/Child/Child.Movie.2026.mkv', isDir: false, size: 1 } as any
    const events: string[] = []

    ;(scanner as any).getFolderItemsWithRetry = vi.fn()
      .mockResolvedValueOnce([rootVideo, childFolder])
      .mockResolvedValueOnce([childVideo])
    vi.spyOn(scanner as any, 'canRunInternalAIScrape').mockResolvedValue(true)
    vi.spyOn(scanner as any, 'processVideoFileWithoutAI').mockImplementation(async (file: any) => {
      events.push(`tmdb:${file.id}`)
      return file
    })
    const applyAI = vi.spyOn(scanner as any, 'applyBatchAIScrapeResults').mockImplementation(async (...args: unknown[]) => {
      const files = args[0] as any[]
      events.push(`ai:${files.map(file => file.id).join(',')}`)
      return 0
    })

    await scanner.scanFolder(folder('root-folder'), 'quark', { silent: true })

    expect(events).toEqual(['tmdb:root-video', 'tmdb:child-video', 'ai:root-video,child-video'])
    expect(applyAI).toHaveBeenCalledTimes(1)
  })

  it('uses the shared scrape result pipeline for local video files', async () => {
    vi.stubGlobal('window', { require: (name: string) => name === 'path' ? nodePath : {} })
    try {
      const scanner = new MediaScanner()
      const file = { id: '/movies/Movie.2026.mkv', name: 'Movie.2026.mkv', path: '/movies/Movie.2026.mkv', userId: 'local', driveId: 'local', driveServerId: 'local', fileSize: 1 } as any
      vi.spyOn(scanner as any, 'iterateLocalVideoFiles').mockImplementation(async function* () { yield file })
      const sharedPipeline = vi.spyOn(scanner as any, 'processVideoBatchWithTransientRetry').mockResolvedValue({ unmatched: [file], completed: [file], unresolved: [] })
      const addUnmatched = vi.spyOn(scanner as any, 'addUnmatchedMediaItem').mockImplementation(() => undefined)
      const legacyPipeline = vi.spyOn(scanner as any, 'processVideoFile').mockResolvedValue(undefined)

      await scanner.scanLocalFolder('/movies')

      expect(sharedPipeline).toHaveBeenCalledWith([file], 'movies', 'local_/movies')
      expect(addUnmatched).toHaveBeenCalledWith(file, 'movies', 'local_/movies')
      expect(legacyPipeline).not.toHaveBeenCalled()
    } finally {
      delete (globalThis as any).window
    }
  })

  it('restores the previous local source membership when traversal fails', async () => {
    vi.stubGlobal('window', { require: (name: string) => name === 'path' ? nodePath : {} })
    try {
      const scanner = new MediaScanner()
      mediaStore.folders = [{ id: 'local_/movies' }]
      mediaDb.getMediaLibraryFolderFileIds.mockResolvedValueOnce(['local:::local:::existing-file'])
      vi.spyOn(scanner as any, 'iterateLocalVideoFiles').mockImplementation(async function* () { throw new Error('local traversal failed') })

      await scanner.scanLocalFolder('/movies')

      expect(mediaDb.reconcileMediaLibraryFolder).toHaveBeenCalledWith('local_/movies', ['local:::local:::existing-file'])
      expect(mediaStore.reconcileFolderSource).toHaveBeenCalledWith('local_/movies', ['local:::local:::existing-file'])
      expect(mediaStore.removeFolder).not.toHaveBeenCalled()
    } finally {
      delete (globalThis as any).window
    }
  })
})
