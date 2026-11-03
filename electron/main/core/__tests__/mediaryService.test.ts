// Runs under Electron's Node (better-sqlite3 is built for it):
// ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run electron/main/core/__tests__/mediaryService.test.ts
import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const { userData } = vi.hoisted(() => ({ userData: { dir: '' } }))
userData.dir = mkdtempSync(join(tmpdir(), 'boxplayer-mediary-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData.dir, getAppPath: () => process.cwd() },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { on: () => {}, handle: () => {} }
}))
vi.mock('../../mediary/runtimeConfig', () => ({
  requestMediaryRuntimeConfig: async () => ({ model: { baseURL: 'https://ai.test/v1', apiKey: 'key', modelId: 'model', providerName: 'boxplayer-cloud' }, boxplayerApiBaseURL: 'https://api.test' })
}))
// The test drives commands and views only; the worker loop has its own vendor tests.
vi.mock('../../mediary/MediaryHost', async importOriginal => ({
  ...(await importOriginal<typeof import('../../mediary/MediaryHost')>()),
  wakeMediaryHost: () => {}
}))
vi.mock('../../mediary/resources', async importOriginal => ({
  ...(await importOriginal<typeof import('../../mediary/resources')>()),
  createMediaryMetadataProvider: () => ({
    getMovieDetails: async (id: number) => ({ id, title: '沙丘：第二部', original_title: 'Dune: Part Two', release_date: '2024-02-27', overview: '', poster_path: null, backdrop_path: null, genres: [], origin_country: ['US'] }),
    getTvDetails: async (id: number) => ({ id, name: '三体', original_name: '三体', first_air_date: '2023-01-15', number_of_episodes: 30, overview: '', poster_path: null, backdrop_path: null, last_episode_to_air: { season_number: 1, episode_number: 30 }, seasons: [{ season_number: 1, episode_count: 30 }], genres: [], origin_country: ['CN'] }),
    getTvSeason: async (_id: number, seasonNumber: number) => ({ season_number: seasonNumber, episodes: Array.from({ length: 30 }, (_, index) => ({ episode_number: index + 1, air_date: '2023-01-15' })) })
  })
}))

const { cancelMediaryRun, createMediaryRun, listMediaryRunViews, listMediaryStates, listMediaryTracking } = await import('../../mediary/MediaryService')
const { createAccountContextResolver, driveTargetId, nextSweepAt, stopMediaryHost, vendorLanguage, vendorQuality } = await import('../../mediary/MediaryHost')

const target = { targetUserId: 'user-1', targetDriveId: 'drive-1', targetPlatform: 'aliyun', targetParentFileId: 'folder-1' }

afterAll(() => {
  stopMediaryHost()
  rmSync(userData.dir, { recursive: true, force: true })
})

describe('MediaryService on the vendored SQLite repository', () => {
  it('queues a movie on the chosen folder and shows it in the task list', async () => {
    const run = await createMediaryRun({ kind: 'movie', tmdbId: 693134, mediaType: 'movie', title: '沙丘2', ...target, preferredQuality: '4K' })
    expect(run).toMatchObject({ kind: 'movie', status: 'queued', target: { title: '沙丘：第二部', tmdbId: 693134, targetPlatform: 'aliyun', targetParentFileId: 'folder-1', mediaKey: 'movie:tmdb:693134' } })
    expect((await listMediaryRunViews()).map(item => item.id)).toContain(run.id)
    expect(await listMediaryStates()).toContainEqual(expect.objectContaining({ mediaKey: 'movie:tmdb:693134', status: 'queued', targetUserId: 'user-1' }))

    await expect(createMediaryRun({ kind: 'movie', tmdbId: 693134, mediaType: 'movie', title: '沙丘2', ...target })).resolves.toMatchObject({ id: run.id })
    await cancelMediaryRun(run.id)
    expect((await listMediaryRunViews()).map(item => item.id)).not.toContain(run.id)
  })

  it('tracks a season and reports its aired episodes as missing until they land', async () => {
    await createMediaryRun({ kind: 'season', tmdbId: 108545, mediaType: 'tv', title: '三体', seasonNumber: 1, ...target, targetPlatform: '115', targetParentFileId: 'drive115_root' })
    const [season] = await listMediaryTracking()
    expect(season).toMatchObject({ tmdbId: 108545, seasonNumber: 1, totalEpisodes: 30, latestAiredEpisode: 30, obtainedEpisodes: 0, status: 'tracking' })
    expect(season.missingEpisodes).toHaveLength(30)
    expect(season.nextCheckAt).toBeGreaterThan(Date.now())

    // Asking again while the season is still queued returns the same task rather than a second one.
    const queued = (await listMediaryRunViews()).find(run => run.target.tmdbId === 108545)!
    await expect(createMediaryRun({ kind: 'season', tmdbId: 108545, mediaType: 'tv', title: '三体', seasonNumber: 1, ...target, targetPlatform: '115', targetParentFileId: 'drive115_root' })).resolves.toMatchObject({ id: queued.id })
  })

  it('resolves each run to its drive, landing folder and preferences', async () => {
    const resolve = createAccountContextResolver({ model: null, boxplayerApiBaseURL: 'https://api.test' })
    const context = await resolve('acct_default', driveTargetId({ platform: '115', userId: 'user-1', driveId: 'drive-1', folderId: 'drive115_root' }))
    expect(context).toMatchObject({ storageProvider: 'pan115', storageParentDirectoryId: '0', moviesParentDirectoryId: '0' })
    expect(driveTargetId({ platform: 'drive115', userId: 'u', driveId: 'd', folderId: 'root' })).toBe(driveTargetId({ platform: '115', userId: 'u', driveId: 'd', folderId: 'drive115_root' }))
  })
})

describe('mediary host helpers', () => {
  it('maps BoxPlayer preferences onto mediary settings', () => {
    expect(vendorLanguage('zh-CN')).toBe('中文字幕')
    expect(vendorLanguage('auto')).toBeUndefined()
    expect(vendorQuality('4K')).toBe('high')
    expect(vendorQuality('1080p')).toBe('medium')
  })

  it('finds the next Beijing-time patrol slot', () => {
    const now = new Date('2026-11-02T23:30:00Z') // 07:30 in Beijing
    expect(new Date(nextSweepAt(['06:00', '20:00'], now)).toISOString()).toBe('2026-11-03T12:00:00.000Z')
    expect(new Date(nextSweepAt(['06:00'], now)).toISOString()).toBe('2026-11-03T22:00:00.000Z')
  })
})
