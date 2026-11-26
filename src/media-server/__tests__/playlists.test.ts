import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MediaServerConfig } from '../../types/mediaServer'
import { getMediaServerHome, getMediaServerHomeShell, getMediaServerHomeWithPreferences, getMediaServerLibraryPagedItems, getMediaServerSearch } from '../contentGateway'
import { createServerPlaylist, deleteServerPlaylist, listServerPlaylists, setServerPlaylistMembership } from '../playlists'

const config = (type: MediaServerConfig['type']): MediaServerConfig => ({ id: type, type, name: type, baseUrl: 'https://example.test/emby', accessToken: 'test-token', userId: 'user', createdAt: 0, updatedAt: 0 })
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
afterEach(() => vi.unstubAllGlobals())
describe('server playlist API', () => {
  it.each(['emby', 'jellyfin'] as const)('removes %s playlist entry IDs, not media IDs', async type => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ Items: [{ Id: 'media', PlaylistItemId: 'entry' }], TotalRecordCount: 1 })).mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    await setServerPlaylistMembership(config(type), 'playlist', 'media', false)
    expect(String(fetch.mock.calls[1][0])).toContain('EntryIds=entry')
    expect(fetch.mock.calls[1][1].method).toBe('DELETE')
  })
  it('removes Plex playlistItemID rather than ratingKey', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ MediaContainer: { Metadata: [{ ratingKey: 'media', playlistItemID: 91 }] } })).mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    await setServerPlaylistMembership(config('plex'), 'playlist', 'media', false)
    expect(String(fetch.mock.calls[1][0])).toContain('/playlists/playlist/items/91')
  })
  it('does not claim success when entry ID is missing', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ Items: [{ Id: 'media' }] }))
    vi.stubGlobal('fetch', fetch)
    await expect(setServerPlaylistMembership(config('emby'), 'playlist', 'media', false)).rejects.toThrow('条目 ID')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('creates Jellyfin playlists with a JSON body', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    await createServerPlaylist(config('jellyfin'), ' test ', 'media')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ Name: 'test', Ids: ['media'], UserId: 'user', IsPublic: false })
  })
  it('creates Plex playlists using the actual machine identifier', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ MediaContainer: { machineIdentifier: 'machine' } })).mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    await createServerPlaylist(config('plex'), 'test', 'media')
    const url = new URL(fetch.mock.calls[1][0])
    expect(url.searchParams.get('uri')).toBe('server://machine/com.plexapp.plugins.library/library/metadata/media')
  })
  it('propagates permission failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })))
    await expect(deleteServerPlaylist(config('emby'), 'playlist')).rejects.toThrow('403')
  })
  it('reads user-owned playlists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ Items: [{ Id: 'playlist', Name: 'test', ChildCount: 2 }], TotalRecordCount: 1 })))
    expect(await listServerPlaylists(config('emby'))).toEqual([{ id: 'playlist', title: 'test', count: 2 }])
  })
})

describe('Emby/Jellyfin playlists library discovery, browsing, search, and container navigation', () => {
  const viewsPayload = {
    Items: [
      { Id: 'lib-movies', Name: 'Movies', CollectionType: 'movies', Type: 'CollectionFolder' },
      { Id: 'lib-playlists', Name: 'Playlists', CollectionType: 'playlists', Type: 'PlaylistsFolder', ChildCount: 2 },
      { Id: 'lib-playlists-no-collection', Name: 'Shared Playlists', Type: 'PlaylistsFolder', ChildCount: 1 },
      { Id: 'lib-boxsets', Name: 'Collections', CollectionType: 'boxsets', Type: 'CollectionFolder', ChildCount: 3 },
      { Id: 'lib-music', Name: 'Music', CollectionType: 'music', Type: 'CollectionFolder' }
    ]
  }

  it.each(['emby', 'jellyfin'] as const)('%s: discovers playlists and boxsets libraries in Views shell and home queries', async (type) => {
    const requestedUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (rawUrl: string) => {
      requestedUrls.push(rawUrl)
      const url = new URL(rawUrl)
      if (url.pathname.endsWith('/Views')) return json(viewsPayload)
      if (url.pathname.endsWith('/Items')) {
        const parentId = url.searchParams.get('ParentId')
        if (parentId === 'lib-playlists' || parentId === 'lib-playlists-no-collection') {
          return json({ Items: [{ Id: `pl-${parentId}`, Name: 'My Playlist', Type: 'Playlist' }], TotalRecordCount: 1 })
        }
        if (parentId === 'lib-boxsets') {
          return json({ Items: [{ Id: 'bs-1', Name: 'Saga Collection', Type: 'BoxSet' }], TotalRecordCount: 1 })
        }
        return json({ Items: [{ Id: 'm-1', Name: 'Film', Type: 'Movie' }], TotalRecordCount: 1 })
      }
      if (url.pathname.endsWith('/Counts')) return json({ MovieCount: 1, SeriesCount: 0, EpisodeCount: 0 })
      if (url.pathname.endsWith('/Users/user')) return json({ Configuration: { LatestItemsExcludes: [] } })
      return json({ Items: [], TotalRecordCount: 0 })
    }))

    const server = config(type)
    const shell = await getMediaServerHomeShell(server)
    expect(shell.libraries.map((lib) => lib.id)).toEqual(['lib-movies', 'lib-playlists', 'lib-playlists-no-collection', 'lib-boxsets'])
    expect(shell.libraries.find((lib) => lib.id === 'lib-playlists-no-collection')?.collectionType).toBe('playlists')

    const home = await getMediaServerHome(server)
    expect(home.libraries.map((lib) => lib.id)).toEqual(['lib-movies', 'lib-playlists', 'lib-playlists-no-collection', 'lib-boxsets'])
    expect(home.libraries.find((lib) => lib.id === 'lib-playlists')?.items[0]).toMatchObject({ id: 'pl-lib-playlists', kind: 'folder', rawType: 'Playlist' })

    const homeWithPrefs = await getMediaServerHomeWithPreferences(server, {
      showRecentlyAdded: true,
      resumeNextUp: true,
      maxNextUpDays: 0,
      showPosterLabels: true,
      nextUpPosterType: 'landscape',
      recentlyAddedPosterType: 'portrait',
      latestInLibraryPosterType: 'portrait',
      latestInLibraryBrowseMode: 'grid',
      collectionBrowseMode: 'grid',
      homeLibraryOrder: [],
      hiddenHomeLibraryIds: [],
      homeSectionOrder: [],
      hiddenHomeSectionIds: []
    })
    expect(homeWithPrefs.libraries.map((lib) => lib.id)).toEqual(['lib-movies', 'lib-playlists', 'lib-playlists-no-collection', 'lib-boxsets'])

    const playlistQueryUrls = requestedUrls
      .map((item) => new URL(item))
      .filter((url) => url.pathname.endsWith('/Items') && url.searchParams.get('ParentId') === 'lib-playlists')
    expect(playlistQueryUrls.length).toBeGreaterThanOrEqual(2)
    expect(playlistQueryUrls.every((url) => url.searchParams.get('IncludeItemTypes') === 'Playlist')).toBe(true)

    const boxsetQueryUrls = requestedUrls
      .map((item) => new URL(item))
      .filter((url) => url.pathname.endsWith('/Items') && url.searchParams.get('ParentId') === 'lib-boxsets')
    expect(boxsetQueryUrls.every((url) => url.searchParams.get('IncludeItemTypes') === 'BoxSet')).toBe(true)
  })

  it('lists playlists with IncludeItemTypes=Playlist and lists container contents without type filtering', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({
        Items: [
          { Id: 'pl-1', Name: 'Sci-Fi Mix', Type: 'Playlist', ChildCount: 2 },
          { Id: 'pl-folder', Name: 'Playlists', Type: 'PlaylistsFolder' },
          { Id: 'bs-1', Name: 'Trilogy', Type: 'BoxSet' }
        ],
        TotalRecordCount: 3
      }))
      .mockResolvedValueOnce(json({
        Items: [
          { Id: 'mov-1', Name: 'Arrival', Type: 'Movie' },
          { Id: 'ep-1', Name: 'Pilot', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 1 }
        ],
        TotalRecordCount: 2
      }))
    vi.stubGlobal('fetch', fetchMock)

    const listed = await getMediaServerLibraryPagedItems(config('emby'), 'lib-playlists', 0, {
      recursiveMedia: true,
      collectionType: 'playlists'
    })
    const listUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(listUrl.searchParams.get('Recursive')).toBe('true')
    expect(listUrl.searchParams.get('IncludeItemTypes')).toBe('Playlist')
    expect(listed.items.map((item) => ({ id: item.id, kind: item.kind, rawType: item.rawType }))).toEqual([
      { id: 'pl-1', kind: 'folder', rawType: 'Playlist' },
      { id: 'pl-folder', kind: 'folder', rawType: 'PlaylistsFolder' },
      { id: 'bs-1', kind: 'folder', rawType: 'BoxSet' }
    ])

    const contents = await getMediaServerLibraryPagedItems(config('emby'), 'server-container:pl-1', 0, {
      recursiveMedia: true,
      collectionType: 'playlists'
    })
    const containerUrl = new URL(String(fetchMock.mock.calls[1][0]))
    expect(containerUrl.searchParams.get('ParentId')).toBe('pl-1')
    expect(containerUrl.searchParams.get('Recursive')).toBe('false')
    expect(containerUrl.searchParams.has('IncludeItemTypes')).toBe(false)
    expect(contents.items.map((item) => item.id)).toEqual(['mov-1', 'ep-1'])
  })

  it('includes Playlist in search IncludeItemTypes and maps Playlist results cleanly', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({
      Items: [{ Id: 'pl-9', Name: 'Weekend Watch', Type: 'Playlist', ChildCount: 4 }],
      TotalRecordCount: 1
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await getMediaServerSearch(config('emby'), 'Weekend')
    const searchUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(searchUrl.searchParams.get('IncludeItemTypes')?.split(',')).toContain('Playlist')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ id: 'pl-9', kind: 'folder', rawType: 'Playlist', title: 'Weekend Watch' })
  })

  it('navigates Playlist and BoxSet cards through server-container while keeping root folders direct', () => {
    const workspace = readFileSync(new URL('../../views/MediaServerWorkspace.vue', import.meta.url), 'utf8')
    const isDetailCandidateSrc = workspace.slice(workspace.indexOf('const isDetailCandidate ='), workspace.indexOf('const handleCardClick ='))
    const handleClickSrc = workspace.slice(workspace.indexOf('const handleLibraryItemClick ='), workspace.indexOf('const handleSearchItemSelect ='))
    const script = ts.transpile(`${isDetailCandidateSrc}\n${handleClickSrc}\nreturn handleLibraryItemClick`)
    const push = vi.fn()
    const handleLibraryItemClick = new Function('navigation', script)({ push })

    handleLibraryItemClick('lib-playlists', 'Playlists', { id: 'lib-playlists', title: 'Playlists', kind: 'folder', rawType: 'PlaylistsFolder' })
    handleLibraryItemClick('pl-1', 'Weekend Watch', { id: 'pl-1', title: 'Weekend Watch', kind: 'folder', rawType: 'Playlist' })
    handleLibraryItemClick('bs-1', 'Trilogy', { id: 'bs-1', title: 'Trilogy', kind: 'folder', rawType: 'BoxSet' })
    handleLibraryItemClick('mov-1', 'Arrival', { id: 'mov-1', title: 'Arrival', kind: 'movie', rawType: 'Movie' })

    expect(push.mock.calls).toEqual([
      [{ kind: 'library-page', libraryId: 'lib-playlists', title: 'Playlists' }],
      [{ kind: 'library-page', libraryId: 'server-container:pl-1', title: 'Weekend Watch' }],
      [{ kind: 'library-page', libraryId: 'server-container:bs-1', title: 'Trilogy' }],
      [{ kind: 'item-detail', itemId: 'mov-1', title: 'Arrival' }]
    ])
  })
})
