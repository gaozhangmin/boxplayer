import { beforeEach, expect, it, vi } from 'vitest'
import { allServerItems, browseServer, collectPlayable, compareItems, normalizeItem, randomRank, serverFacets, similarServerItems, serverDetail, setWatched, sortFields } from '@/features/servers/workspace'
import type { Account } from '@/features/sources/contracts'
import { json, request } from '@/features/sources/transport'
vi.mock('@/features/sources/transport', async original => ({ ...await original<typeof import('@/features/sources/transport')>(), json: vi.fn(), request: vi.fn() }))
const account = (providerId: Account['providerId'] = 'jellyfin'): Account => ({ id: providerId + '-account', providerId, name: 'Synthetic', baseUrl: 'https://synthetic.test/prefix', authOrigins: ['https://synthetic.test'], userId: 'u/a' })
beforeEach(() => vi.clearAllMocks())
it('exports exactly the Electron 19 sorting keys', () => {
 expect(Object.keys(sortFields)).toEqual(['premiereDate','title','createdAt','rating','criticRating','runtimeMinutes','year','playCount','sortName','addedAt','random','videoBitrate','airTime','studio','artist','officialRating','seriesTitle','seriesDatePlayed','airOrder'])
})
it.each(['jellyfin', 'emby'] as const)('%s applies account-bound category, type, sort and all filters before pagination', async provider => {
 const owner = account(provider); vi.mocked(json).mockResolvedValue({ Items: [{ Id: 'm', Type: 'Movie', Name: 'Film', UserData: { Played: true } }], TotalRecordCount: 2 })
 const result = await browseServer(owner, { kind: 'category', category: 'movies', title: 'Movies' }, { offset: 1, sort: 'runtimeMinutes', descending: true, genre: '科幻', year: '2026', watched: 'yes' })
 const [actual, method, path] = vi.mocked(json).mock.calls[0]!; expect(actual).toBe(owner); expect(method).toBe('GET'); const url = new URL(path)
 expect(url.pathname).toBe('/prefix/Users/u%2Fa/Items'); expect(Object.fromEntries(url.searchParams)).toMatchObject({ IncludeItemTypes: 'Movie', Recursive: 'true', StartIndex: '1', Genres: '科幻', Years: '2026', IsPlayed: 'true', SortBy: 'Runtime,SortName', SortOrder: 'Descending' }); expect(result.items[0]?.watched).toBe(true); expect(result.nextOffset).toBeUndefined()
})
it('library roots omit music/books/photos and preserve Plex section IDs', async () => {
 vi.mocked(json).mockResolvedValueOnce({ Items: [{ Id: 'films', Name: 'Films', Type: 'CollectionFolder', CollectionType: 'movies' }, { Id: 'music', CollectionType: 'music' }, { Id: 'books', CollectionType: 'books' }] })
 expect((await browseServer(account(), { kind: 'root', title: '' })).items.map(i => i.id)).toEqual(['films'])
 vi.mocked(json).mockResolvedValueOnce({ MediaContainer: { Directory: [{ key: '1', title: 'Films', type: 'movie' }, { key: '2', title: 'Music', type: 'artist' }] } })
 expect((await browseServer(account('plex'), { kind: 'root', title: '' })).items[0]).toMatchObject({ id: 'section:1', kind: 'folder', isDirectory: true })
})
it('Plex playlist and section browsing use separate paths, with stable pagination', async () => {
 vi.mocked(json).mockResolvedValue({ MediaContainer: { Metadata: [{ ratingKey: 'm', title: 'Film', type: 'movie' }], totalSize: 3 } })
 const owner = account('plex'); expect((await browseServer(owner, { kind: 'children', id: 'playlist:a/b', title: '' }, { offset: 1, sort: 'year', descending: true })).nextOffset).toBe(2)
 let url = new URL(vi.mocked(json).mock.calls[0]![2]); expect(url.pathname).toBe('/prefix/playlists/a%2Fb/items'); expect(url.searchParams.get('sort')).toBe('year:desc')
 await browseServer(owner, { kind: 'children', id: 'section:1', title: '' }); expect(new URL(vi.mocked(json).mock.calls[1]![2]).pathname).toBe('/prefix/library/sections/1/all')
 await expect(browseServer(owner, { kind: 'category', category: 'favorites', title: '' })).rejects.toThrow('Plex')
})
it('favorite Person category uses Persons, not IncludeItemTypes=Person', async () => {
 vi.mocked(json).mockResolvedValue({ Items: [], TotalRecordCount: 0 }); await browseServer(account(), { kind: 'category', category: 'favorites', favoriteType: 'Person', title: '' })
 const url = new URL(vi.mocked(json).mock.calls[0]![2]); expect(url.pathname).toBe('/prefix/Persons'); expect(url.searchParams.get('IsFavorite')).toBe('true'); expect(url.searchParams.has('IncludeItemTypes')).toBe(false)
})
it('walks series → season → episodes and continues all category pages without duplicate queue entries', async () => {
 vi.mocked(json).mockResolvedValueOnce({ Items: [{ Id: 'show', Type: 'Series', Name: 'Show' }], TotalRecordCount: 2 })
 .mockResolvedValueOnce({ Items: [{ Id: 'season', Type: 'Season', Name: 'Season' }], TotalRecordCount: 1 })
 .mockResolvedValueOnce({ Items: [{ Id: 'ep', Type: 'Episode', Name: 'Ep' }], TotalRecordCount: 1 })
 .mockResolvedValueOnce({ Items: [{ Id: 'ep', Type: 'Episode', Name: 'Ep' }], TotalRecordCount: 2 })
 expect((await collectPlayable(account(), { kind: 'category', category: 'shows', title: '' })).map(i => i.id)).toEqual(['ep'])
 expect(new URL(vi.mocked(json).mock.calls[3]![2]).searchParams.get('StartIndex')).toBe('1')
})
it('fails closed for repeated pages, invalid pagination, malformed responses and unsupported accounts', async () => {
 vi.mocked(json).mockResolvedValue({ Items: [{ Id: 'film', Type: 'Movie', Name: 'Film' }], TotalRecordCount: 20 })
 await expect(allServerItems(account(), { kind: 'category', title: '' })).rejects.toThrow('未推进分页')
 await expect(browseServer(account(), { kind: 'root', title: '' }, { offset: -1 })).rejects.toThrow('分页')
 await expect(browseServer(account('webdav'), { kind: 'root', title: '' })).rejects.toThrow('媒体服务器')
 vi.mocked(json).mockResolvedValue({ Items: 'invalid' }); await expect(browseServer(account(), { kind: 'root', title: '' })).rejects.toThrow('响应无效')
})
it('requests details and watched changes with owning account and escaped IDs', async () => {
 const owner = account('emby'); vi.mocked(json).mockResolvedValue({ Id: 'a/b', Name: 'Episode', Type: 'Episode', ParentIndexNumber: 2, IndexNumber: 3, ImageTags: { Primary: 'tag' } })
 expect(await serverDetail(owner, 'a/b')).toMatchObject({ season: 2, episode: 3, imagePath: 'Items/a%2Fb/Images/Primary?maxWidth=400&tag=tag' })
 await setWatched(owner, 'a/b', true); await setWatched(owner, 'a/b', false)
 expect(vi.mocked(request).mock.calls.map(call => [call[0], call[1], new URL(call[2]).pathname])).toEqual([[owner, 'POST', '/prefix/Users/u%2Fa/PlayedItems/a%2Fb'], [owner, 'DELETE', '/prefix/Users/u%2Fa/PlayedItems/a%2Fb']])
 await setWatched(account('plex'), 'a/b', false); const url = new URL(vi.mocked(request).mock.calls[2]![2]); expect(url.pathname).toBe('/prefix/:/unscrobble'); expect(url.searchParams.get('key')).toBe('a/b')
})
it('orders complete Plex fallback data, keeps missing fields last and random order stable', async () => {
 vi.mocked(json).mockResolvedValueOnce({ MediaContainer: { Metadata: [{ ratingKey: 'a', title: 'A', type: 'movie', Media: [{ bitrate: 100 }] }], totalSize: 2 } }).mockResolvedValueOnce({ MediaContainer: { Metadata: [{ ratingKey: 'b', title: 'B', type: 'movie', Media: [{ bitrate: 200 }] }], totalSize: 2 } })
 const items = await allServerItems(account('plex'), { kind: 'category', id: 'section:1', title: '' }); expect(items.sort((a,b) => compareItems(a,b,'videoBitrate',true)).map(i=>i.id)).toEqual(['b','a'])
 const missing = normalizeItem({ Id: 'm', Name: 'Missing', Type: 'Movie' }, false); expect(compareItems(missing, items[0]!, 'videoBitrate', true)).toBeGreaterThan(0)
 expect(randomRank('same', 123)).toBe(randomRank('same', 123)); expect(randomRank('same', 123)).not.toBe(randomRank('same', 124))
})

it('server facet indexes preserve library scope and video type; child routes filter that same scope', async () => {
 const owner = account(); vi.mocked(json).mockResolvedValueOnce({ Items: [{ Name: '科幻', ChildCount: 3 }], TotalRecordCount: 1 })
 expect(await serverFacets(owner, { kind: 'category', category: 'movies', id: 'library/a', title: '类型', facet: 'genre' })).toEqual([{ value: '科幻', label: '科幻', count: 3 }])
 let url = new URL(vi.mocked(json).mock.calls[0]![2]); expect(url.pathname).toBe('/prefix/Genres'); expect(url.searchParams.get('ParentId')).toBe('library/a'); expect(url.searchParams.get('IncludeItemTypes')).toBe('Movie')
 vi.mocked(json).mockResolvedValueOnce({ Items: [], TotalRecordCount: 0 }); await browseServer(owner, { kind: 'category', category: 'movies', id: 'library/a', facet: 'genre', value: '科幻', title: '科幻' }); url = new URL(vi.mocked(json).mock.calls[1]![2]); expect(url.searchParams.get('ParentId')).toBe('library/a'); expect(url.searchParams.get('Genres')).toBe('科幻')
 vi.mocked(json).mockResolvedValueOnce({ Years: [2026, 2025] }); expect((await serverFacets(owner, { kind: 'category', id: 'library/a', title: '', facet: 'year' })).map(f=>f.value)).toEqual(['2026','2025'])
})
it('Plex global movies merge only movie sections; named genres resolve to the owning section filter key', async () => {
 const owner = account('plex'); vi.mocked(json).mockResolvedValueOnce({ MediaContainer: { Directory: [{ key:'1',title:'Films',type:'movie' },{key:'2',title:'TV',type:'show'},{key:'3',title:'Music',type:'artist'}] } })
 .mockResolvedValueOnce({MediaContainer:{Directory:[{key:'42',title:'科幻'}]}})
 .mockResolvedValueOnce({MediaContainer:{Metadata:[{ratingKey:'film',title:'Film',type:'movie'}],totalSize:1}})
 expect((await browseServer(owner,{kind:'category',category:'movies',title:'Films',facet:'genre',value:'科幻'})).items.map(i=>i.id)).toEqual(['film'])
 const paths=vi.mocked(json).mock.calls.map(c=>new URL(c[2]));expect(paths.map(url=>url.pathname)).toEqual(['/prefix/library/sections','/prefix/library/sections/1/genre','/prefix/library/sections/1/all']);expect(paths[2]!.searchParams.get('genre')).toBe('42')
})
it('person bibliography uses the provider person endpoint and preserves a Jellyfin parent library', async () => {
 vi.mocked(json).mockResolvedValueOnce({Items:[],TotalRecordCount:0}); await browseServer(account(),{kind:'category',category:'all',id:'library/a',personId:'actor/a',title:'Actor'})
 let url=new URL(vi.mocked(json).mock.calls[0]![2]);expect(url.searchParams.get('PersonIds')).toBe('actor/a');expect(url.searchParams.get('ParentId')).toBe('library/a')
 vi.mocked(json).mockResolvedValueOnce({MediaContainer:{Metadata:[],totalSize:0}}); await browseServer(account('plex'),{kind:'category',personId:'actor/a',title:'Actor'});url=new URL(vi.mocked(json).mock.calls[1]![2]);expect(url.pathname).toBe('/prefix/library/people/actor%2Fa/media')
})
it('normalizes server cast and never requests TMDB for metadata, people or similar media', async () => {
 vi.mocked(json).mockResolvedValueOnce({Id:'series',Type:'Series',Name:'Show',Overview:'Server synopsis',People:[{Id:'actor',Name:'Actor',Role:'Lead',PrimaryImageTag:'tag'}]})
 expect(await serverDetail(account(),'series')).toMatchObject({overview:'Server synopsis',people:[{id:'actor',name:'Actor',role:'Lead',imagePath:'Items/actor/Images/Primary?maxWidth=180&tag=tag'}]})
 vi.mocked(json).mockResolvedValueOnce({Items:[{Id:'similar',Name:'Similar',Type:'Movie'},{Id:'audio',Name:'Audio',Type:'Audio'}]});expect((await similarServerItems(account(),'series')).map(i=>i.id)).toEqual(['similar'])
 expect(vi.mocked(json).mock.calls.every(c=>c[0].id===account().id&&new URL(c[2]).origin==='https://synthetic.test')).toBe(true)
})
