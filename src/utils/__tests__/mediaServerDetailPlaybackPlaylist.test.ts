import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const workspace = readFileSync(new URL('../../views/MediaServerWorkspace.vue', import.meta.url), 'utf8')
const playback = workspace.slice(workspace.indexOf('const resolveDetailPlaybackPlaylist ='), workspace.indexOf('const handleDetailPlay ='))
const script = ts.transpile(`${playback}\nreturn resolveDetailPlaybackPlaylist`)

const server = { id: 'fixture-emby' }
const current = { id: 'episode-2', title: 'Episode 2', kind: 'episode' }
const neighbor = { id: 'episode-1', title: 'Episode 1' }
const playlist = [neighbor, { id: current.id, title: current.title }]

describe('Media server episode detail playback', () => {
  it('loads series siblings for a standalone episode', async () => {
    const lookup = vi.fn().mockResolvedValue({ episodePlaylist: playlist, playlistLabel: 'Series' })
    const resolve = new Function('resolveHomePlaybackTarget', script)(lookup)
    await expect(resolve(server, current, [])).resolves.toEqual({ playlistLabel: 'Series', episodePlaylist: playlist })
    expect(lookup).toHaveBeenCalledWith(server, current)
  })

  it('keeps the selected season without querying the full series', async () => {
    const lookup = vi.fn()
    const resolve = new Function('resolveHomePlaybackTarget', script)(lookup)
    await expect(resolve(server, current, playlist, 'Season 1')).resolves.toEqual({
      playlistLabel: 'Season 1', episodePlaylist: playlist,
    })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('keeps standalone playback available when the list is unavailable or does not include the current episode', async () => {
    const lookup = vi.fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ episodePlaylist: [neighbor], playlistLabel: 'Another season' })
    const log = { warn: vi.fn() }
    const resolve = new Function('resolveHomePlaybackTarget', 'console', script)(lookup, log)
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(resolve(server, current, [])).resolves.toMatchObject({ episodePlaylist: [] })
    }
    expect(log.warn).toHaveBeenCalledOnce()
  })
})
