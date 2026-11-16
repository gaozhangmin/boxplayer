import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const db = vi.hoisted(() => ({
  countMusicTracks: vi.fn(),
  getLibrarySources: vi.fn(),
  getMusicTrackPage: vi.fn(),
  getMusicTrackById: vi.fn(),
  getMusicTracksByIds: vi.fn(),
  saveMusicTracks: vi.fn()
}))

vi.mock('../db', () => ({ default: db }))
vi.mock('../musicPlayerStorage', () => ({ loadMusicTrackList: vi.fn(() => []) }))

describe('music library persisted enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.getLibrarySources.mockResolvedValue([])
    db.saveMusicTracks.mockResolvedValue(undefined)
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    })
  })

  it('updates a persisted track that is not part of the visible page', async () => {
    const persisted = {
      id: 'track-500',
      user_id: 'user',
      drive_id: 'drive',
      file_id: 'file',
      parent_file_id: 'folder',
      file_name: 'Artist - Song.mp3',
      ext: 'mp3',
      size: 1,
      category: 'audio',
      artist: 'Artist',
      title: 'Song',
      scanned_at: 1
    }
    db.getMusicTrackById.mockResolvedValue(persisted)
    const { default: useMusicLibraryStore } = await import('../../store/musiclibrary')
    const store = useMusicLibraryStore()

    await store.updateTrackEnrichment(persisted.id, { cover_url: 'https://cover.example/song.jpg', album: 'Album' })

    expect(db.saveMusicTracks).toHaveBeenCalledWith([
      expect.objectContaining({ id: persisted.id, cover_url: 'https://cover.example/song.jpg', album: 'Album', enriched_at: expect.any(Number) })
    ])
  })

  it('does not report a scanned track as stored when the database read fails', async () => {
    db.getMusicTracksByIds.mockRejectedValue(new Error('IndexedDB unavailable'))
    const { default: useMusicLibraryStore } = await import('../../store/musiclibrary')
    const store = useMusicLibraryStore()
    const track = {
      id: 'failed-track',
      user_id: 'user',
      drive_id: 'drive',
      file_id: 'file',
      parent_file_id: 'folder',
      file_name: 'Artist - Song.mp3',
      ext: 'mp3',
      size: 1,
      category: 'audio',
      scanned_at: 1
    }

    await expect(store.appendTracks([track])).rejects.toThrow('IndexedDB unavailable')
    expect(db.saveMusicTracks).not.toHaveBeenCalled()
    expect(store.tracks).toEqual([])
  })

  it('loads every persisted page before building artist and album groups', async () => {
    const first = {
      id: 'track-1', user_id: 'user', drive_id: 'drive', file_id: 'file-1', parent_file_id: 'folder',
      file_name: 'Artist A - Song A.mp3', ext: 'mp3', size: 1, category: 'audio', artist: 'Artist A', title: 'Song A', album: 'Album A', scanned_at: 1
    }
    const second = {
      id: 'track-2', user_id: 'user', drive_id: 'drive', file_id: 'file-2', parent_file_id: 'folder',
      file_name: 'Artist B - Song B.mp3', ext: 'mp3', size: 1, category: 'audio', artist: 'Artist B', title: 'Song B', album: 'Album B', scanned_at: 1
    }
    db.countMusicTracks.mockResolvedValue(2)
    db.getMusicTrackPage.mockResolvedValueOnce([first]).mockResolvedValueOnce([second])
    const { default: useMusicLibraryStore } = await import('../../store/musiclibrary')
    const store = useMusicLibraryStore()

    await store.loadFromDB()
    await store.loadAllTracks()

    expect(db.getMusicTrackPage).toHaveBeenNthCalledWith(2, { offset: 1, limit: 100, query: '' })
    expect(store.byArtist.map((group) => group.artist)).toEqual(['Artist A', 'Artist B'])
    expect(store.byAlbum.map((group) => group.album)).toEqual(['Album A', 'Album B'])
  })
  it('late online results do not overwrite tags written by the background head parser', async () => {
    db.getMusicTrackById.mockResolvedValue({ id:'race', title:'Embedded', artist:'Local Artist', metadata_source:'embedded', head_tag_version:1, cover_url:'data:image/png;base64,AA==', artwork_origin:'embedded', scanned_at:1 })
    const { default: useMusicLibraryStore } = await import('../../store/musiclibrary')
    await useMusicLibraryStore().updateTrackEnrichment('race', { title:'Online',artist:'Online Artist',metadata_source:'online',cover_url:'https://img/online' })
    expect(db.saveMusicTracks).toHaveBeenCalledWith([expect.objectContaining({ title:'Embedded',artist:'Local Artist',metadata_source:'embedded',head_tag_version:1,cover_url:'data:image/png;base64,AA==' })])
  })

})
