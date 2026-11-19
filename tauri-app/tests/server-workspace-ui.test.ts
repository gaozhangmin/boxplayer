import MediaDetailPage from '@/components/media-detail/MediaDetailPage.vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import ServerWorkspace from '@/features/servers/ServerWorkspace.vue'
import ServerArtwork from '@/features/servers/ServerArtwork.vue'
import { browseServer, normalizeItem, collectPlayable, serverDetail, similarServerItems, serverFacets, setWatched } from '@/features/servers/workspace'
import { serverArtwork } from '@/features/sources/serverMetadata'
import { nativeCall } from '@/platform/native'
import { preferenceKey, readPreferences } from '@/features/servers/preferences'
const { playMany } = vi.hoisted(() => ({ playMany: vi.fn(async () => {}) }))
vi.mock('@/features/library/catalog', () => ({ useVideoCatalog: () => ({ playMany }) }))
vi.mock('@/platform/native', () => ({ nativeCall: vi.fn() }))
vi.mock('@/features/sources/serverMetadata', () => ({ serverArtwork: vi.fn() }))
vi.mock('@/features/sources/mediaServer', () => ({ serverFavorite: vi.fn() }))
vi.mock('@/features/sources/playlists', () => ({ createServerPlaylist: vi.fn(), deleteServerPlaylist: vi.fn(), deleteServerMedia: vi.fn(), listServerPlaylists: vi.fn(), serverPlaylistMembership: vi.fn(), setServerPlaylistMembership: vi.fn() }))
vi.mock('@/features/servers/workspace', async original => ({ ...await original<typeof import('@/features/servers/workspace')>(), browseServer: vi.fn(), collectPlayable: vi.fn(), serverDetail: vi.fn(), similarServerItems: vi.fn(), serverFacets: vi.fn(), setWatched: vi.fn() }))
const account = { id: 'synthetic-a', providerId: 'jellyfin' as const, userId: 'u', name: 'Synthetic', baseUrl: 'https://synthetic.test', authOrigins: ['https://synthetic.test'] }
const film = normalizeItem({ Id: 'film', Name: 'Film', Type: 'Movie' }, false), library = normalizeItem({ Id: 'lib', Name: 'Films', Type: 'CollectionFolder' }, false, true)
const button = (wrapper: ReturnType<typeof mount>, label: string) => { const value = wrapper.findAll('button').find(b => b.text() === label); if (!value) throw new Error('Missing button: '+label); return value }
const stubs = { AnchoredMenu: defineComponent({props:['label'],template:'<div role="menu" :aria-label="label"><slot/></div>'}), ServerArtwork: defineComponent({ template: '<span class="art" />' }), Teleport: true }
beforeEach(() => {
 vi.clearAllMocks(); const entries = new Map<string,string>(); vi.stubGlobal('localStorage', { getItem: (key:string) => entries.get(key) ?? null, setItem: (key:string,value:string) => entries.set(key,value) })
 vi.mocked(serverDetail).mockRejectedValue(new Error('Virtual folder')); vi.mocked(similarServerItems).mockResolvedValue([]); vi.mocked(serverFacets).mockResolvedValue([]); vi.mocked(browseServer).mockResolvedValue({ items: [library] }); vi.mocked(collectPlayable).mockResolvedValue([film]); vi.mocked(nativeCall).mockResolvedValue(true)
})
it('defaults to library-root, emits title/back state, disables favoriteSelected and password until selection', async () => {
 const wrapper = mount(ServerWorkspace, { props: { account }, global: { stubs } }); await flushPromises()
 expect(vi.mocked(browseServer).mock.calls[0]?.[1]).toMatchObject({ kind: 'root', title: '媒体库' }); expect(wrapper.emitted('title')?.at(-1)).toEqual([account.name])
 await wrapper.get('[aria-label="更多媒体操作"]').trigger('click'); expect(button(wrapper,'添加到收藏夹').attributes('disabled')).toBeDefined(); expect(button(wrapper,'启用密码锁').attributes('disabled')).toBeDefined()
 await button(wrapper,'选择').trigger('click'); await wrapper.get('.library-card').trigger('click'); await wrapper.get('[aria-label="更多媒体操作"]').trigger('click'); expect(button(wrapper,'添加到收藏夹').attributes('disabled')).toBeUndefined()
 await button(wrapper,'添加到收藏夹').trigger('click'); await wrapper.find('[role=dialog] input').setValue('My library'); await wrapper.find('[role=dialog]').trigger('submit'); await flushPromises()
 expect(readPreferences(account.id).favorites[0]?.title).toBe('My library'); expect(readPreferences(account.id).home).toEqual(['resume','nextup','latest']); wrapper.unmount()
})
it('shows a server-specific empty state after a successful empty response', async () => {
 vi.mocked(browseServer).mockResolvedValueOnce({ items: [] })
 const wrapper = mount(ServerWorkspace, { props: { account: { ...account, id: 'empty-server' } }, global: { stubs } })
 expect(wrapper.find('.server-empty').exists()).toBe(false)
 expect(wrapper.get('.server-load-indicator [role="status"]').attributes('aria-label')).toBeTruthy()
 expect(wrapper.get('.server-load-indicator').text()).toBe('')
 await flushPromises()
 expect(wrapper.find('.server-load-indicator').exists()).toBe(false)
 expect(wrapper.get('.server-empty').text()).toBe('此服务器暂无可浏览的媒体库')
 expect(wrapper.text()).not.toContain('新增文件来源')
 expect(wrapper.find('[role="alert"]').exists()).toBe(false)
 wrapper.unmount()
})
it('shows a top error banner and retries the same server route', async () => {
 vi.mocked(browseServer).mockRejectedValueOnce(new Error('Synthetic transport failure'))
 const wrapper = mount(ServerWorkspace, { props: { account: { ...account, id: 'offline' } }, global: { stubs } })
 await flushPromises()
 expect(wrapper.get('.server-load-error[role="alert"]').text()).toContain('Synthetic transport failure')
 expect(wrapper.find('.server-empty').exists()).toBe(false)
 expect(wrapper.find('.library-card').exists()).toBe(false)

 await button(wrapper, '重试').trigger('click')
 await flushPromises()
 expect(vi.mocked(browseServer).mock.calls[1]).toEqual(vi.mocked(browseServer).mock.calls[0])
 expect(wrapper.find('[role="alert"]').exists()).toBe(false)
 expect(wrapper.get('.library-card h4').text()).toBe(library.name)
 wrapper.unmount()
})
it('keeps cached libraries visible after a failed reload and opens the selected music library', async () => {
 const owner = { ...account, id: 'emby-music', providerId: 'emby' as const }
 const music = normalizeItem({ Id: 'music', Name: '音乐', CollectionType: 'music' }, false, true)
 const track = normalizeItem({ Id: 'track', Name: '测试歌曲', Type: 'Audio' }, false)
 vi.mocked(browseServer).mockResolvedValueOnce({ items: [music] })
 const first = mount(ServerWorkspace, { props: { account: owner }, global: { stubs } })
 await flushPromises()
 first.unmount()

 vi.mocked(browseServer).mockRejectedValueOnce(new Error('离线')).mockResolvedValueOnce({ items: [track] })
 const wrapper = mount(ServerWorkspace, { props: { account: owner }, global: { stubs } })
 await flushPromises()
 expect(wrapper.get('.server-load-error').text()).toContain('离线')
 expect(wrapper.get('.library-card h4').text()).toBe('音乐')
 await wrapper.get('.library-card').trigger('click')
 await flushPromises()
 expect(vi.mocked(browseServer).mock.lastCall?.[1]).toMatchObject({ kind: 'category', category: 'music', id: 'music' })
 expect(wrapper.get('.server-music-tracks').text()).toContain('测试歌曲')
 wrapper.unmount()
})
it('initialRoute enters season children, account changes invalidate previous responses', async () => {
 let resolve!: (value: { items: typeof film[] }) => void
 vi.mocked(browseServer).mockImplementationOnce(() => new Promise(r => { resolve = r }))
 const wrapper = mount(ServerWorkspace, { props: { account, initialRoute: { kind: 'children', id: 'season', title: 'Season 2' } }, global: { stubs } })
 await wrapper.setProps({ account: { ...account, id: 'synthetic-b' } }); await flushPromises(); resolve({ items: [film] }); await flushPromises()
 expect(wrapper.findAll('.library-card h4').map(v=>v.text())).toEqual(['Films']); expect(vi.mocked(browseServer).mock.calls[1]?.[0].id).toBe('synthetic-b'); wrapper.unmount()
})
it('keeps the selected library when the parent replaces equivalent account and route props', async () => {
 const initialRoute = { kind: 'root' as const, title: '媒体库' }
 vi.mocked(browseServer).mockImplementation(async (_account, route) => ({ items: route.kind === 'root' ? [library] : [film] }))
 const wrapper = mount(ServerWorkspace, { props: { account, initialRoute }, global: { stubs } })
 await flushPromises()
 await wrapper.get('.library-card').trigger('click')
 await flushPromises()
 const callCount = vi.mocked(browseServer).mock.calls.length
 await wrapper.setProps({ account: { ...account }, initialRoute: { ...initialRoute } })
 await flushPromises()
 expect(vi.mocked(browseServer).mock.calls.length).toBe(callCount)
 expect(wrapper.get('.library-card h4').text()).toBe(film.name)
 wrapper.unmount()
})
it('category menus offer Favorites only and queue loop calls the shared playMany mode', async () => {
 const wrapper = mount(ServerWorkspace, { props: { account, initialRoute: { kind: 'category', category: 'movies', title: 'Movies' } }, global: { stubs } }); await flushPromises()
 await wrapper.get('.library-card').trigger('contextmenu'); const menu = wrapper.find('[role=menu]'); expect(menu.text()).toContain('添加到收藏夹'); expect(menu.text()).not.toContain('添加到主页')
 await button(wrapper,'循环播放').trigger('click'); await flushPromises(); expect(playMany).toHaveBeenCalledWith([expect.objectContaining({ sourceId: account.id, fileId: film.id, local: false })], 'loop'); wrapper.unmount()
})
it('video download uses the owning account native save command and handles cancel without completion', async () => {
 vi.mocked(browseServer).mockResolvedValue({ items: [film] }); vi.mocked(nativeCall).mockResolvedValue(false)
 const wrapper = mount(ServerWorkspace, { props: { account }, global: { stubs } }); await flushPromises()
 await wrapper.get('.library-card').trigger('contextmenu'); await button(wrapper,'下载').trigger('click'); await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('source_download', { accountId: account.id, fileId: film.id, name: film.name }); expect(wrapper.emitted('download-complete')).toBeUndefined(); wrapper.unmount()
})
it('searchRevision repeats an identical scoped search and initialRoute changes navigate without touching other files', async () => {
 const wrapper = mount(ServerWorkspace, { props: { account, searchQuery: 'Film', searchRevision: 1 }, global: { stubs } }); await flushPromises()
 expect(vi.mocked(browseServer).mock.calls[0]?.[1]).toMatchObject({ kind: 'search', query: 'Film' })
 await wrapper.setProps({ searchRevision: 2 }); await flushPromises(); expect(vi.mocked(browseServer).mock.calls.at(-1)?.[1].query).toBe('Film')
 await wrapper.setProps({ searchQuery: '', initialRoute: { kind: 'children', id: 'show', title: 'Show' } }); await flushPromises(); expect(vi.mocked(browseServer).mock.calls.at(-1)?.[1].id).toBe('show'); wrapper.unmount()
})
it('keeps endpoint editing in the source menu rather than adding it to media details', async () => {
 vi.mocked(serverDetail).mockResolvedValue(film)
 const wrapper = mount(ServerWorkspace, {props:{account,initialRoute:{kind:'detail',id:film.id,title:film.name}},global:{stubs}});await flushPromises()
 expect(wrapper.findAll('button').some(button=>button.text()==='服务器线路')).toBe(false)
 expect(vi.mocked(nativeCall).mock.calls.some(call=>call[0]==='account_update_metadata')).toBe(false)
 wrapper.unmount()
})

it('revokes replaced, stale and unmounted artwork blobs while preserving owning-account requests', async () => {
 let resolve!: (value: string) => void; vi.mocked(serverArtwork).mockImplementationOnce(() => new Promise(r=>{resolve=r})).mockResolvedValueOnce('blob:new')
 const revoke = vi.fn(); vi.stubGlobal('URL', Object.assign(URL, { revokeObjectURL: revoke }))
 const wrapper = mount(ServerArtwork, { props: { account, path: 'Items/old/Images/Primary' } }); await wrapper.setProps({ path: 'Items/new/Images/Primary' }); await flushPromises(); resolve('blob:old'); await flushPromises()
 expect(revoke).toHaveBeenCalledWith('blob:old'); expect(wrapper.find('img').attributes('src')).toBe('blob:new'); expect(vi.mocked(serverArtwork).mock.calls[1]?.[0].id).toBe(account.id); wrapper.unmount(); expect(revoke).toHaveBeenCalledWith('blob:new')
})

it('series and seasons open detail synopses and episode panels, then expose exact cast pages', async () => {
 const show = normalizeItem({ Id:'show',Name:'Show',Type:'Series',Overview:'Show synopsis',People:[{Id:'actor',Name:'Actor',Role:'Lead'}] },false)
 const season = normalizeItem({ Id:'season',Name:'Season 1',Type:'Season',Overview:'Season synopsis' },false)
 const episode = normalizeItem({ Id:'episode',Name:'Episode 1',Type:'Episode',Overview:'Episode synopsis',ParentId:'season' },false)
 vi.mocked(browseServer).mockImplementation(async (_account,route) => ({items:route.id==='show'?[season]:route.id==='season'?[episode]:[show]}))
 vi.mocked(serverDetail).mockImplementation(async (_account,id) => id==='show'?show:id==='season'?season:episode)
 const wrapper=mount(ServerWorkspace,{props:{account,initialRoute:{kind:'category',category:'shows',id:'library',libraryId:'library',title:'TV'}},global:{stubs}});await flushPromises()
 await wrapper.get('.library-card').trigger('click');await flushPromises();expect(wrapper.getComponent(MediaDetailPage).get('.hero-title').text()).toBe('Show');expect(wrapper.text()).toContain('Episode synopsis');expect(wrapper.text()).toContain('Season 1');expect(wrapper.text()).toContain('演职员');expect(wrapper.getComponent(MediaDetailPage).get('.detail-header').text()).toBe('Show')
 await wrapper.get('.cast-card').trigger('click');await flushPromises();expect(vi.mocked(browseServer).mock.calls.at(-1)?.[1]).toMatchObject({personId:'actor',id:'library',category:'all'})
 ;(wrapper.vm as unknown as {navigate:(route:unknown)=>void}).navigate({kind:'detail',id:'season',title:'Season 1',libraryId:'library'});await flushPromises();expect(wrapper.getComponent(MediaDetailPage).get('.hero-title').text()).toBe('Season 1');expect(wrapper.text()).toContain('Episode synopsis');expect(wrapper.text()).toContain('Episode 1');expect(wrapper.get('[title="评分"]').attributes('disabled')).toBeUndefined();wrapper.unmount()
})
it('server facet index opens exact child route within the same library', async () => {
 vi.mocked(serverFacets).mockResolvedValue([{value:'科幻',label:'科幻',count:3}])
 const wrapper=mount(ServerWorkspace,{props:{account,initialRoute:{kind:'category',category:'movies',id:'library',libraryId:'library',facet:'genre',title:'类型'}},global:{stubs}});await flushPromises()
 expect(serverFacets).toHaveBeenCalledWith(expect.objectContaining({id:account.id}),expect.objectContaining({id:'library',category:'movies',facet:'genre'}));await button(wrapper,'科幻 (3)').trigger('click');await flushPromises();expect(vi.mocked(browseServer).mock.calls.at(-1)?.[1]).toMatchObject({id:'library',libraryId:'library',category:'movies',facet:'genre',value:'科幻'});wrapper.unmount()
})
it('layout uses the global key/event across accounts while portrait remains independent', async () => {
 localStorage.setItem('MediaLibrary_BrowseMode','list'); const wrapper=mount(ServerWorkspace,{props:{account},global:{stubs}});await flushPromises();expect(wrapper.find('.library-shell').classes()).toContain('library-shell-list')
 const events:Event[]=[];const listener=(event:Event)=>events.push(event);window.addEventListener('boxplayer:browse-mode-changed',listener)
 await wrapper.get('[aria-label="网格视图"]').trigger('click');expect(localStorage.getItem('MediaLibrary_BrowseMode')).toBe('grid');expect(events).toHaveLength(1)
 localStorage.setItem('MediaLibrary_BrowseMode','list');window.dispatchEvent(new Event('boxplayer:browse-mode-changed'));await flushPromises();expect(wrapper.find('.library-shell').classes()).toContain('library-shell-list')
 await wrapper.setProps({account:{...account,id:'another'}});await flushPromises();expect(wrapper.find('.library-shell').classes()).toContain('library-shell-list');window.removeEventListener('boxplayer:browse-mode-changed',listener);wrapper.unmount()
})
it('saving favorites broadcasts the account-specific Home change event', async () => {
 const events:CustomEvent[]=[];const listener=(event:Event)=>events.push(event as CustomEvent);window.addEventListener('boxplayer:server-home-changed',listener)
 const wrapper=mount(ServerWorkspace,{props:{account,initialRoute:{kind:'category',category:'movies',title:'Movies'}},global:{stubs}});await flushPromises();await wrapper.get('[aria-label="更多媒体操作"]').trigger('click');await button(wrapper,'添加到收藏夹').trigger('click');await wrapper.find('[role=dialog]').trigger('submit');await flushPromises();expect(events.at(-1)?.detail).toBe(account.id);window.removeEventListener('boxplayer:server-home-changed',listener);wrapper.unmount()
})
it('file management hides delete while keeping real share and personal rating actions available', async () => {
 const {generalPreferences}=await import('@/features/library/displayPreferences');generalPreferences.fileManagement=false
 vi.mocked(browseServer).mockResolvedValue({items:[film]});const wrapper=mount(ServerWorkspace,{props:{account},global:{stubs}});await flushPromises();await wrapper.get('.library-card').trigger('contextmenu');expect(wrapper.find('[role=menu]').text()).not.toContain('删除');expect(button(wrapper,'分享').attributes('disabled')).toBeUndefined();expect(button(wrapper,'个人评分').attributes('disabled')).toBeUndefined();generalPreferences.fileManagement=true;wrapper.unmount()
})

it('local raster data renders without gateway requests and is never revoked as a Blob', async () => {
 const data='data:image/png;base64,iVBORw0KGgo=', revoke=vi.fn();vi.stubGlobal('URL',Object.assign(URL,{revokeObjectURL:revoke}))
 const wrapper=mount(ServerArtwork,{props:{account,path:data}});await flushPromises();expect(wrapper.find('img').attributes('src')).toBe(data);expect(serverArtwork).not.toHaveBeenCalled()
 await wrapper.setProps({path:'data:image/svg+xml;base64,PHN2Zz4='});await flushPromises();expect(wrapper.find('img').exists()).toBe(false);expect(serverArtwork).not.toHaveBeenCalled();wrapper.unmount();expect(revoke).not.toHaveBeenCalled()
})
it('native cover selection previews and persists bounded data; cancel preserves the saved cover', async () => {
 const data='data:image/png;base64,iVBORw0KGgo='
 const route={kind:'category' as const,category:'movies' as const,title:'Movies'}, {putFavorite,writePreferences}=await import('@/features/servers/preferences')
 writePreferences(account.id,putFavorite(readPreferences(account.id),route,'My movies'))
 const wrapper=mount(ServerWorkspace,{props:{account,initialRoute:route},global:{stubs}});await flushPromises();await wrapper.get('[aria-label="更多媒体操作"]').trigger('click');await button(wrapper,'选择封面').trigger('click')
 vi.mocked(nativeCall).mockResolvedValueOnce(data);await button(wrapper,'选择图片').trigger('click');await flushPromises();expect(nativeCall).toHaveBeenLastCalledWith('choose_cover_image');await wrapper.find('[role=dialog]').trigger('submit');await flushPromises();expect(readPreferences(account.id).favorites[0]?.cover).toBe(data)
 await wrapper.get('[aria-label="更多媒体操作"]').trigger('click');await button(wrapper,'选择封面').trigger('click');vi.mocked(nativeCall).mockResolvedValueOnce(null);await button(wrapper,'选择图片').trigger('click');await flushPromises();await wrapper.find('[role=dialog]').trigger('submit');await flushPromises();expect(readPreferences(account.id).favorites[0]?.cover).toBe(data);wrapper.unmount()
})


it('returns a directly opened category to the library root before leaving the server', async () => {
 const initialRoute = { kind: 'category' as const, category: 'movies' as const, title: 'Movies' }
 const wrapper = mount(ServerWorkspace, { props: { account, initialRoute, navigationRevision: 1 }, global: { stubs } })
 await flushPromises()
 const workspace = wrapper.vm as unknown as { goBack: () => boolean }
 expect(wrapper.emitted('can-go-back')?.at(-1)).toEqual([true])
 expect(workspace.goBack()).toBe(true)
 await flushPromises()
 expect(vi.mocked(browseServer).mock.calls.at(-1)?.[1].kind).toBe('root')
 expect(wrapper.emitted('go-back')).toBeUndefined()
 await wrapper.setProps({ navigationRevision: 2 })
 await flushPromises()
 expect(vi.mocked(browseServer).mock.calls.at(-1)?.[1]).toEqual(initialRoute)
 wrapper.unmount()
})

it('replaces a scoped search so Back returns to the category', async () => {
 const initialRoute = { kind: 'category' as const, category: 'movies' as const, title: 'Movies' }
 const wrapper = mount(ServerWorkspace, { props: { account, initialRoute }, global: { stubs } })
 await wrapper.setProps({ searchQuery: 'first', searchRevision: 1 })
 await wrapper.setProps({ searchQuery: 'second', searchRevision: 2 })
 await flushPromises()
 expect(vi.mocked(browseServer).mock.calls.at(-1)?.[1].query).toBe('second')
 expect((wrapper.vm as unknown as { goBack: () => boolean }).goBack()).toBe(true)
 await flushPromises()
 expect(vi.mocked(browseServer).mock.calls.at(-1)?.[1]).toEqual(initialRoute)
 wrapper.unmount()
})

it('appends near the bottom and retries failed pages without resetting the list', async () => {
 const callbacks: IntersectionObserverCallback[] = []
 vi.stubGlobal('IntersectionObserver', class {
  constructor(callback: IntersectionObserverCallback) { callbacks.push(callback) }
  observe() {}
  disconnect() {}
 })
 const browse = vi.mocked(browseServer)
 const second = { ...film, id: 'second', name: 'Second' }
 browse.mockResolvedValueOnce({items:[film],nextOffset:1})
  .mockRejectedValueOnce(new Error('page timeout'))
  .mockResolvedValueOnce({items:[film,second]})
 const wrapper = mount(ServerWorkspace,{props:{account,initialRoute:{kind:'category',category:'movies',title:'Movies'}},global:{stubs}})
 try {
  await flushPromises()
  expect(wrapper.text()).not.toContain('加载更多')
  const observer = callbacks.at(-1)!
  observer([{isIntersecting:false} as IntersectionObserverEntry],{} as IntersectionObserver)
  expect(browse).toHaveBeenCalledTimes(1)
  observer([{isIntersecting:true} as IntersectionObserverEntry],{} as IntersectionObserver)
  observer([{isIntersecting:true} as IntersectionObserverEntry],{} as IntersectionObserver)
  await flushPromises()
  expect(browse).toHaveBeenCalledTimes(2)
  expect(wrapper.get('.server-page-end [role="alert"]').text()).toContain('page timeout')
  expect(wrapper.findAll('.library-card')).toHaveLength(1)
  await wrapper.get('.server-page-end button').trigger('click')
  await flushPromises()
  expect(browse.mock.calls.at(-1)?.[2]).toMatchObject({offset:1})
  expect(wrapper.findAll('.library-card')).toHaveLength(2)
  expect(wrapper.find('.server-page-end').exists()).toBe(false)
 } finally {
  wrapper.unmount()
  vi.unstubAllGlobals()
 }
})

it('displays stream metadata and forwards each selected stream to the playback queue', async () => {
 const item = normalizeItem({
  Id: 'tracks', Name: 'Track fixture', Type: 'Movie',
  MediaSources: [{ Id: 'version', MediaStreams: [
   { Type: 'Video', Index: 0, DisplayTitle: 'HDR video', VideoRange: 'HDR10', RealFrameRate: 24 },
   { Type: 'Audio', Index: 1, DisplayTitle: 'Stereo', IsDefault: true },
   { Type: 'Audio', Index: 2, DisplayTitle: 'Surround', SampleRate: 48000, ChannelLayout: '5.1' },
   { Type: 'Subtitle', Index: 3, DisplayTitle: 'English', IsForced: true }
  ] }]
 }, false)
 vi.mocked(serverDetail).mockResolvedValue(item)
 const wrapper = mount(ServerWorkspace, { props: { account, initialRoute: { kind: 'detail', id: item.id, title: item.name } }, global: { stubs } })
 await flushPromises()
 const cards = wrapper.findAll('.detail-media-card')
 expect(cards.map(card => card.text()).join(' ')).toContain('48000 Hz')
 expect(cards[0]?.text()).toContain('HDR10')
 await cards[0]!.trigger('click')
 await cards[2]!.trigger('click')
 await cards[3]!.trigger('keydown', { key: 'Enter' })
 expect(cards[1]?.attributes('aria-pressed')).toBe('false')
 expect(cards[2]?.attributes('aria-pressed')).toBe('true')
 await button(wrapper, '播放').trigger('click')
 await flushPromises()
 expect(playMany).toHaveBeenCalledWith([expect.objectContaining({
  fileId: item.id,
  tracks: { video: { index: 0, ordinal: 0 }, audio: { index: 2, ordinal: 1 }, subtitle: { index: 3, ordinal: 0 } }
 })], 'play')
 wrapper.unmount()
})
it('repeats the active server sort field to reverse direction without separate direction rows',async()=>{
 const wrapper=mount(ServerWorkspace,{props:{account,initialRoute:{kind:'category',category:'movies',title:'Movies'}},global:{stubs}});await flushPromises()
 await wrapper.get('.server-sort-button').trigger('click');await flushPromises()
 const options=wrapper.findAll('.server-sort-menu [role=menuitemradio]');expect(options.length).toBeGreaterThan(0);expect(options.some(row=>['升序','降序'].includes(row.text()))).toBe(false)
 await options.find(row=>row.attributes('aria-checked')==='true')!.trigger('click');await flushPromises();expect(vi.mocked(browseServer).mock.calls.at(-1)?.[2]?.descending).toBe(true);wrapper.unmount()
})

it('updates detail membership after persistence without reloading the detail or losing its scroll',async()=>{
 const {serverFavorite}=await import('@/features/sources/mediaServer')
 vi.mocked(serverDetail).mockResolvedValue({...film,watched:false,favorite:false})
 const wrapper=mount(ServerWorkspace,{props:{account,initialRoute:{kind:'detail',id:film.id,title:film.name}},global:{stubs}});await flushPromises()
 const before=vi.mocked(serverDetail).mock.calls.length,detail=wrapper.getComponent({name:'ServerDetail'}),page=wrapper.get('.detail-content').element as HTMLElement
 page.scrollTop=250
 detail.vm.$emit('action','favorite',detail.props('item'));await flushPromises()
 expect(serverFavorite).toHaveBeenCalledWith(account,film.id,true);expect(detail.props('item').favorite).toBe(true)
 detail.vm.$emit('action','watched',detail.props('item'));await flushPromises()
 expect(setWatched).toHaveBeenCalledWith(account,film.id,true);expect(detail.props('item').watched).toBe(true)
 expect(vi.mocked(serverDetail)).toHaveBeenCalledTimes(before);expect(wrapper.get('.detail-content').element).toBe(page);expect(page.scrollTop).toBe(250)
 vi.mocked(serverFavorite).mockRejectedValueOnce(new Error('save failed'));detail.vm.$emit('action','favorite',detail.props('item'));await flushPromises()
 expect(detail.props('item').favorite).toBe(true);expect(wrapper.get('[role=alert]').text()).toContain('save failed');wrapper.unmount()
})
