<script setup lang="ts">
import {Grid2X2,List,ArrowUp,ArrowDown,MoreHorizontal,ChevronDown,Check,SquareCheck,ListFilter,Play,Repeat,Shuffle,Star} from 'lucide-vue-next'
import ServerPlaylistPicker from './ServerPlaylistPicker.vue'
import ElectronModal from '@/components/dialog/ElectronModal.vue'
import ServerHomeManager from './electron/ServerHomeManager.vue'
import ServerStatsRow from './electron/ServerStatsRow.vue'
import ServerResumeRow from './electron/ServerResumeRow.vue'
import ServerSwitcher from './ServerSwitcher.vue'
import ServerPosterRow from './electron/ServerPosterRow.vue'
import ServerPersonPage from './electron/ServerPerson.vue'
import MediaPosterMenu from './electron/MediaPosterMenu.vue'
import ServerDetail from './electron/ServerDetail.vue'
import {posterMenu as videoPosterMenu} from '../library/workspaceMenus'
import ServerListing from './electron/ServerListing.vue'
import SourceEmptyState from '../files/SourceEmptyState.vue'
import AnchoredMenu from '../library/AnchoredMenu.vue'
import WorkspaceContextMenu from '../library/WorkspaceContextMenu.vue'
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { Account } from '../sources/contracts'
import {getServerPlaybackSource} from '../sources/serverVersions'
import { serverFavorite } from '../sources/mediaServer'
import { nativeCall } from '@/platform/native'
import { useVideoCatalog, type VideoItem } from '../library/catalog'
import { createServerPlaylist, deleteServerPlaylist, deleteServerMedia, listServerPlaylists, serverPlaylistMembership, setServerPlaylistMembership, type ServerPlaylist } from '../sources/playlists'
import { browseServer, serverHomeStatistics, serverDetail, setWatched, collectPlayable, categories, favoriteTypes, sortFields, facetNames, serverFacets, similarServerItems, needsLocalSort, compareItems, allServerItems, type BrowseRoute, type BrowseOptions, type ServerItem, type Category, type FacetEntry, type ServerPerson } from './workspace'
import { readPreferences, writePreferences, putFavorite, routeKey, type ServerPreferences, type Favorite } from './preferences'
import { isLocalCoverData, validServerCover } from './cover'
import ServerArtwork from './ServerArtwork.vue'
import ServerRating from './ServerRating.vue'
import ServerShare from './ServerShare.vue'
import { useServerBrowseMode } from './layout'
import { generalPreferences } from '../library/displayPreferences'
import { preferenceKey } from './preferences'
const props = defineProps<{ account: Account; searchQuery?: string; searchRevision?: number; toolbarTarget?: string; initialRoute?: BrowseRoute }>()
const toolbarReady=ref(!props.toolbarTarget)
onMounted(()=>{toolbarReady.value=true})
const emit = defineEmits<{ title: [title: string]; 'can-go-back': [value: boolean]; 'go-back': []; navigate: [route: BrowseRoute]; 'preferences-change': [accountId: string, preferences: ServerPreferences]; 'account-updated': [account: Account]; 'download-complete': [itemId: string]; 'switch-account':[id:string] }>()
const toolbarBrowseSort=ref<'title'|'addedAt'|'premiereDate'>('title')
function cycleToolbarSort(){toolbarBrowseSort.value=toolbarBrowseSort.value==='title'?'addedAt':toolbarBrowseSort.value==='addedAt'?'premiereDate':'title';options.value.sort=toolbarBrowseSort.value;menu.value=undefined;changeSort()}
const sortMenu=ref<{x:number;y:number}>()
function openSort(event:MouseEvent){const box=(event.currentTarget as HTMLElement).getBoundingClientRect();sortMenu.value={x:box.right-220,y:box.bottom+6}}
function chooseSort(value:string){if(value==='ascending'||value==='descending')options.value.descending=value==='descending';else if(options.value.sort===value)options.value.descending=!options.value.descending;else options.value.sort=value as BrowseOptions['sort'];sortMenu.value=undefined;changeSort()}
const route = ref<BrowseRoute>(props.initialRoute || { kind: 'root', title: '媒体库' }), history = ref<BrowseRoute[]>([])
const preferences = ref(readPreferences(props.account.id)), items = ref<ServerItem[]>([]), libraries = ref<ServerItem[]>([])
const homeRows = ref<{ key: string; title: string; route: BrowseRoute; items: ServerItem[]; error?: string }[]>([])
const homeStatistics=ref<Awaited<ReturnType<typeof serverHomeStatistics>>>()
const seasonEpisodes=ref<ServerItem[]>(),selectedSeasonId=ref('')
const facets = ref<FacetEntry[]>([]), detailChildren = ref<ServerItem[]>([]), similar = ref<ServerItem[]>([]), childrenOffset = ref<number>(), detailError = ref('')
const detail = ref<ServerItem>(), nextOffset = ref<number>(), total = ref<number>(), loading = ref(false), working = ref(false), error = ref(''), status = ref('')
const options = ref<BrowseOptions>({ sort: 'sortName', descending: false }), seed = ref(Date.now()), selecting = ref(false), selected = ref<string[]>([]), manager = ref(false)
const menuAnchor=ref({x:0,y:0})
function captureMenu(event:MouseEvent){const box=(event.target as HTMLElement).closest('button')?.getBoundingClientRect();menuAnchor.value=event.type==='contextmenu'?{x:event.clientX,y:event.clientY}:box?{x:box.right-220,y:box.bottom+4}:{x:event.clientX,y:event.clientY}}
const menu = ref<{ item?: ServerItem; target: BrowseRoute; favorite?: Favorite;toolbar?:boolean }>()
const prompt = ref<{ kind: 'favorite' | 'rename' | 'cover' | 'delete'; route: BrowseRoute; value: string; item?: ServerItem; favorite?: Favorite;toolbar?:boolean }>()
const favoriteQueue = ref<BrowseRoute[]>([]), playlistDialog = ref(false), playlistItem = ref<ServerItem>(), playlists = ref<ServerPlaylist[]>([]), membership = ref<Record<string, boolean>>({}), originalMembership = ref<Record<string, boolean>>({}), playlistName = ref('')
const { layout, setLayout } = useServerBrowseMode()
const coverChoices = ref<{ path: string; title: string }[]>([])
const ratingItem = ref<ServerItem>(), shareItem = ref<ServerItem>()
let generation = 0, operation = 0, alive = true
function isCurrentAccount(account: Account) { return alive && account.id === props.account.id && account.baseUrl === props.account.baseUrl && account.userId === props.account.userId }
const title = computed(() => route.value.kind === 'home' ? props.account.name : route.value.title)
const choices = computed(() => [...categories.map(c => ({ key: c.id, title: c.title, route: categoryRoute(c.id, c.title) })), ...libraries.value.map(item => ({ key: `library:${item.id}`, title: item.name, route: childRoute(item) }))])
const visibleItems = computed(() => route.value.kind === 'root' || needsLocalSort(props.account, options.value.sort) ? [...items.value].sort((a, b) => compareItems(a, b, options.value.sort || 'sortName', options.value.descending, seed.value)) : items.value)

const selectedItems = computed(() => items.value.filter(item => selected.value.includes(item.id)))
function categoryRoute(category: Category, title: string, favoriteType?: string): BrowseRoute { return { kind: 'category', category, title, favoriteType } }
function childRoute(item: ServerItem): BrowseRoute { return item.libraryType ? { kind: 'category', category: 'all', id: item.id, libraryId: item.id, title: item.name } : { kind: 'children', id: item.id, libraryId: route.value.libraryId, title: item.name } }
function message(e: unknown) { return e instanceof Error ? e.message : (e as { message?: string })?.message || String(e) }
async function safely(action: () => Promise<void>) { if (working.value) return; const current = ++operation; working.value = true; error.value = ''; try { await action() } catch (e) { if (current === operation) error.value = message(e) } finally { if (current === operation) working.value = false } }
function save(value: ServerPreferences) { writePreferences(props.account.id, value); preferences.value = value; emit('preferences-change', props.account.id, JSON.parse(JSON.stringify(value))); window.dispatchEvent(new CustomEvent('boxplayer:server-home-changed', { detail: props.account.id })) }
function changePreference(patch: Partial<ServerPreferences>) { try { save({ ...preferences.value, ...patch }) } catch (e) { error.value = message(e) } }
function navigate(target: BrowseRoute,browseOptions:BrowseOptions={}) { history.value.push({ ...route.value }); route.value = { ...target }; selected.value = []; selecting.value = false; menu.value = undefined; options.value = { sort: target.category === 'latest' ? 'addedAt' : 'sortName', descending: target.category === 'latest',...browseOptions }; void load() }
function goBack() { const target = history.value.pop(); if (!target) { emit('go-back'); return false } route.value = target; selected.value = []; selecting.value = false; menu.value = undefined; void load(); return true }
function openPersonSection(kind:string){navigate({...route.value,kind:'category',category:kind==='movie'?'movies':kind==='series'?'shows':'all',title:route.value.title+' - '+(kind==='movie'?'电影':kind==='episode'?'剧集':'电视剧')},{type:kind==='movie'?'Movie':kind==='episode'?'Episode':'Series'})}
async function load(append = false) {
  if (append && (loading.value || nextOffset.value === undefined)) return
  const current = ++generation, account = { ...props.account }, target = { ...route.value }, offset = append ? nextOffset.value! : 0
  loading.value = true; error.value = ''
  if (!append) {homeStatistics.value=undefined; items.value = []; detail.value = undefined; nextOffset.value = undefined; total.value = undefined; homeRows.value = []; facets.value = []; detailChildren.value = []; similar.value = [];seasonEpisodes.value=undefined;selectedSeasonId.value=''; childrenOffset.value = undefined; detailError.value = '' }
  try {
    // Global Home cards can pass a raw server directory route. Resolve its actual
    // kind once so shows/seasons retain their server synopsis and detail actions.
    if (target.kind === 'children' && target.id && !target.id.startsWith('section:') && !target.id.startsWith('playlist:')) {
      try {
        const node = await serverDetail(account, target.id)
        if (current !== generation) return
        if (['series','show','season'].includes(node.kind)) { route.value = { ...target, kind: 'detail' }; void load(); return }
        if (['folder','collectionfolder','userview'].includes(node.kind)) { target.kind = 'category'; target.category = 'all'; target.libraryId = target.id; route.value = { ...target } }
      } catch { /* Some server virtual folders have no detail endpoint; retain directory browsing. */ }
    }
    if (target.kind === 'home') {
      const root = await browseServer(account, { kind: 'root', title: '媒体库' }); if (current !== generation) return
      libraries.value = root.items
      void serverHomeStatistics(account,root.items).then(value=>{if(current===generation)homeStatistics.value=value}).catch(()=>{if(current===generation)homeStatistics.value=undefined})
      const rows = preferences.value.home.map(key => choices.value.find(c => c.key === key)).filter((v): v is typeof choices.value[number] => !!v)
      const results = await Promise.all(rows.map(async row => { try { return { ...row, items: (await browseServer(account, row.route, { limit: 20 })).items } } catch (e) { return { ...row, items: [], error: message(e) } } }))
      if (current === generation) homeRows.value = results
    } else if(target.kind==='search'&&!target.query?.trim()){const page=await browseServer(account,{kind:'category',category:'nextup',title:'推荐剧集'},{limit:20});if(current===generation){items.value=page.items;total.value=page.total}} else if (target.kind === 'detail') {
      const value = await serverDetail(account, target.id!); if (current !== generation) return; detail.value = value
      if (value.isDirectory) {
        try { const page = await browseServer(account, { kind: 'children', id: value.id, title: value.name, libraryId: target.libraryId }); if (current === generation) { detailChildren.value = page.items; childrenOffset.value = page.nextOffset;const first=page.items.find(item=>item.kind==='season');if(first)void loadSeason(first) } } catch (e) { if (current === generation) detailError.value = message(e) }
      }
      try { const rows = await similarServerItems(account, value.id); if (current === generation) similar.value = rows } catch (e) { if (current === generation) detailError.value = message(e) }
    } else if (target.facet && !target.value) { const groups = await serverFacets(account, target); if (current === generation) facets.value = groups }
    else if (target.kind === 'person') {
      try{const person=await serverDetail(account,target.personId!);if(current===generation)detail.value=person}catch{if(current===generation)detail.value={id:target.personId!,name:target.title,kind:'person',isDirectory:false,playable:false,size:0,overview:'',watched:false,genres:[],studios:[]}}
      const page = await browseServer(account, { ...target, kind: 'category', category: 'all', id: target.libraryId }, { ...options.value, offset }); if (current === generation) { items.value = page.items; nextOffset.value = page.nextOffset; total.value = page.total }
    }
    else {
      const result = needsLocalSort(account, options.value.sort) ? { items: await allServerItems(account, target, options.value), nextOffset: undefined, total: undefined } : await browseServer(account, target, { ...options.value, offset })
      if (current !== generation) return
      const existing = new Set(items.value.map(item => item.id)), fresh = result.items.filter(item => !existing.has(item.id))
      if (append && result.nextOffset !== undefined && !fresh.length) throw new Error('服务器未推进分页，请重试')
      items.value = append ? [...items.value, ...fresh] : result.items; nextOffset.value = result.nextOffset; total.value = result.total
      if (target.kind === 'root') libraries.value = result.items
    }
  } catch (e) { if (current === generation) error.value = message(e) } finally { if (current === generation) loading.value = false }
}
function itemRoute(item: ServerItem): BrowseRoute {
 if (item.kind === 'person') return { kind: 'person', personId: item.id, title: item.name, libraryId: route.value.libraryId }
 if (['series','show','season','episode','movie','video','clip','musicvideo'].includes(item.kind)) return { kind: 'detail', id: item.id, title: item.name, libraryId: route.value.libraryId }
 return childRoute(item)
}
function select(item: ServerItem) { if (selecting.value) { selected.value = selected.value.includes(item.id) ? selected.value.filter(id => id !== item.id) : [...selected.value, item.id]; return } navigate(itemRoute(item)) }
function openPerson(person: ServerPerson) { navigate({ kind: 'person', personId: person.id, title: person.name, libraryId: route.value.libraryId }) }
async function loadSeason(item:ServerItem){const current=generation,account={...props.account};selectedSeasonId.value=item.id;try{const page=await browseServer(account,{kind:'children',id:item.id,title:item.name,libraryId:route.value.libraryId});if(current===generation&&selectedSeasonId.value===item.id)seasonEpisodes.value=page.items}catch(cause){if(current===generation)detailError.value=message(cause)}}
async function moreDetailChildren() { const item = detail.value, offset = childrenOffset.value, account = { ...props.account }, current = generation; if (!item || offset == null || loading.value) return; loading.value = true; try { const page = await browseServer(account, { kind: 'children', id: item.id, title: item.name }, { offset }); if (current !== generation) return; const ids = new Set(detailChildren.value.map(i=>i.id)), fresh = page.items.filter(i=>!ids.has(i.id)); if (page.nextOffset != null && !fresh.length) throw new Error('服务器未推进分页'); detailChildren.value.push(...fresh); childrenOffset.value = page.nextOffset } catch(e) { if (current === generation) detailError.value = message(e) } finally { if (current === generation) loading.value = false } }

function openMenu(target: BrowseRoute, item?: ServerItem, favorite?: Favorite,toolbar=false) { menu.value = { target, item,toolbar, favorite: favorite || preferences.value.favorites.find(f => f.key === routeKey(target)) } }
const serverSearch=ref(props.searchQuery||'')
watch(()=>props.searchQuery,value=>serverSearch.value=value||'')
const searchSections=computed(()=>!route.value.query?.trim()?[{key:'suggestions',title:'推荐剧集',items:visibleItems.value}]:[{key:'series',title:'电视剧',items:visibleItems.value.filter(i=>['series','show'].includes(i.kind))},{key:'movie',title:'电影',items:visibleItems.value.filter(i=>i.kind==='movie')},{key:'episode',title:'剧集',items:visibleItems.value.filter(i=>i.kind==='episode')},{key:'person',title:'演职人员',items:visibleItems.value.filter(i=>i.kind==='person')},{key:'other',title:'其他',items:visibleItems.value.filter(i=>!['series','show','movie','episode','person'].includes(i.kind))}].filter(s=>s.items.length))
const detailMenuEntries=computed(()=>detail.value?videoPosterMenu(toVideo(detail.value,props.account),true,false,true):[])
function detailAction(action:string,item:ServerItem){if(action==='download-season'||action==='download-series'){void downloadCollection(action==='download-season'?'season':'series');return}if(action==='menu'){openMenu(itemRoute(item),item);return}if(action==='watched'||action==='favorite'){void updateItem(item,action);return}if(action==='rating'){ratingItem.value=item;return}if(action==='share'){shareItem.value=item;return}if(action==='download'){void download(item);return}if(action==='playlist'){void openPlaylists(item);return}if(['play','loop','shuffle'].includes(action)){void play(itemRoute(item),action as 'play'|'loop'|'shuffle',item);return}if(action==='refresh'){void load();return}if(action==='delete')prompt.value={kind:'delete',route:itemRoute(item),item,value:item.name}}
function toVideo(item: ServerItem, account: Account): VideoItem { return { id: JSON.stringify([account.id, item.id]), sourceId: account.id, fileId: item.id, fileName: item.name, name: item.name, type: item.kind === 'movie' ? 'movie' : 'tv', local: false, addedAt: '', genres: item.genres, size: item.size, year: item.year, watched: item.watched, favorite: item.favorite } }
async function play(target: BrowseRoute, mode: 'play' | 'loop' | 'shuffle' = 'play', item?: ServerItem) {
  const account = { ...props.account }, scope = generation
  await safely(async () => {
    let queue = item?.playable ? [item] : await collectPlayable(account, item?.isDirectory ? { kind: 'children', id: item.id, title: item.name } : target.kind === 'detail' ? { ...target, kind: 'children' } : target.kind === 'person' ? { ...target, kind: 'category', category: 'all', id: target.libraryId } : target, options.value)
    if (item?.kind === 'episode' && item.parentId) {
      const siblings = await collectPlayable(account, { kind: 'children', id: item.parentId, title: item.name }, { sort: 'sortName' })
      const index = siblings.findIndex(row => row.id === item.id)
      if (index >= 0) queue = mode === 'play' ? siblings.slice(index) : [...siblings.slice(index), ...siblings.slice(0,index)]
    }
    if (scope !== generation || !isCurrentAccount(account)) return
    await useVideoCatalog().playMany(queue.map(row => toVideo(row, account)), mode)
  })
}
async function playServerCategory(accountId: string, category: string, mode: 'play' | 'loop' | 'shuffle' = 'play') { if (accountId !== props.account.id) throw new Error('请先切换到所属服务器'); const match = categories.find(c => c.id === category); if (!match) throw new Error('未知服务器分类'); await play(categoryRoute(match.id, match.title), mode) }
function askFavorite(target: BrowseRoute, item?: ServerItem) { menu.value = undefined; prompt.value = { kind: 'favorite', route: target.kind === 'detail' && item ? childRoute(item) : target, item, value: target.title } }
function favoriteSelectedLibraries() { favoriteQueue.value = selectedItems.value.map(childRoute); nextFavorite() }
function nextFavorite() { const next = favoriteQueue.value.shift(); if (next) askFavorite(next); else prompt.value = undefined }
function mutateFavorite(favorite: Favorite, patch?: Partial<Favorite>) { save({ ...preferences.value, favorites: patch ? preferences.value.favorites.map(f => f.key === favorite.key ? { ...f, ...patch } : f) : preferences.value.favorites.filter(f => f.key !== favorite.key) }); menu.value = undefined }
function openCover(favorite: Favorite) {
  menu.value = undefined
  prompt.value = { kind: 'cover', route: favorite.route, favorite, value: favorite.cover || '' }
  const rows = [...items.value, ...detailChildren.value, ...homeRows.value.flatMap(row => row.items), ...(detail.value ? [detail.value] : [])]
  coverChoices.value = [...new Map(rows.filter((row): row is ServerItem & { imagePath: string } => !!row.imagePath).map(row => [row.imagePath, { path: row.imagePath, title: row.name }])).values()]
}

async function chooseCoverImage() {
  const target = prompt.value, account = { ...props.account }
  if (target?.kind !== 'cover') return
  await safely(async () => {
    const image = await nativeCall<string | null>('choose_cover_image')
    if (image === null || !isCurrentAccount(account) || prompt.value !== target) return
    if (!isLocalCoverData(image)) throw new Error('请选择不超过 8 MB 的 PNG、JPEG 或 WebP 图片')
    target.value = image
  })
}
async function submitPrompt() {
  const value = prompt.value; if (!value) return
  const account = { ...props.account }
  await safely(async () => {
    if (value.kind === 'favorite') { save(putFavorite(preferences.value, value.route, value.value, !!value.item && !['folder', 'collectionfolder', 'userview'].includes(value.item.kind))); nextFavorite(); return }
    if (value.kind === 'rename' && value.favorite) { if (!value.value.trim()) throw new Error('请输入名称'); mutateFavorite(value.favorite, { title: value.value.trim() }) }
    if (value.kind === 'cover' && value.favorite) { if (!validServerCover(value.value)) throw new Error('封面必须是本地 PNG/JPEG/WebP 图片或无凭据的服务器相对路径'); mutateFavorite(value.favorite, { cover: value.value || undefined }) }
    if (value.kind === 'delete' && value.item) { if (!generalPreferences.fileManagement) throw new Error('文件管理已关闭'); if (value.item.kind === 'playlist') await deleteServerPlaylist(account, value.item.id); else await deleteServerMedia(account, value.item); if (isCurrentAccount(account)) { save({ ...preferences.value, favorites: preferences.value.favorites.filter(f => f.route.id !== value.item!.id) }); window.dispatchEvent(new CustomEvent('boxplayer:server-media-deleted', { detail: { accountId: account.id, itemId: value.item.id } })); if (route.value.kind === 'detail' && route.value.id === value.item.id) goBack(); else await load() } }
    if (isCurrentAccount(account)) { prompt.value = undefined; menu.value = undefined }
  })
}
async function updateItem(item: ServerItem, action: 'watched' | 'favorite', watched?: boolean) {
  const account = { ...props.account }
  await safely(async () => { if (action === 'favorite') await serverFavorite(account, item.id, !item.favorite); else await setWatched(account, item.id, watched ?? !item.watched); if (isCurrentAccount(account)) { menu.value = undefined; await load() } })
}
async function toggleContentFavorite() { const target = menu.value; if (!target) return; if (target.item) { await updateItem(target.item, 'favorite'); return } const account = { ...props.account }; await safely(async () => { const item = await serverDetail(account, target.target.id!); await serverFavorite(account, item.id, !item.favorite); if (isCurrentAccount(account)) menu.value = undefined }) }
async function download(item: ServerItem) { const account = { ...props.account }; await safely(async () => { const result = await nativeCall<boolean>('source_download', { accountId: account.id, fileId: item.id, name:item.versions?.find(version=>version.id===getServerPlaybackSource(account.id,item.id))?.fileLabel||item.name,...(getServerPlaybackSource(account.id,item.id)?{preferredSourceId:getServerPlaybackSource(account.id,item.id)}:{}) }); if (result && isCurrentAccount(account)) { status.value = '下载完成'; emit('download-complete', item.id) } }) }
async function downloadCollection(scope:'season'|'series'){const id=scope==='series'?detail.value?.id:selectedSeasonId.value||detail.value?.id;if(!id)return;const account={...props.account};await safely(async()=>{const rows=await collectPlayable(account,{kind:'children',id,title:detail.value?.name||''});const count=await nativeCall<number>('server_download_collection',{accountId:account.id,files:rows.map(item=>({fileId:item.id,name:item.versions?.[0]?.fileLabel||item.name+'.mkv'}))});if(isCurrentAccount(account))status.value=count?'已下载 '+count+' 个文件':'已取消下载'})}
function openPlaylists(item:ServerItem){playlistItem.value=item;playlistDialog.value=true;menu.value=undefined}
function setHome(key: string, visible: boolean) { changePreference({ home: visible ? [...new Set([...preferences.value.home, key])] : preferences.value.home.filter(k => k !== key) }); if (route.value.kind === 'home') void load() }
function moveHome(key: string, delta: number) { const keys = [...preferences.value.home], index = keys.indexOf(key), to = index + delta; if (index < 0 || to < 0 || to >= keys.length) return; [keys[index], keys[to]] = [keys[to]!, keys[index]!]; changePreference({ home: keys }); if (route.value.kind === 'home') void load() }
function changeLayout() { try { setLayout(layout.value === 'grid' ? 'list' : 'grid') } catch(e) { error.value = message(e) } }
function changeSort() { seed.value = Date.now(); void load() }
async function batchWatched(value: boolean) { const rows = [...selectedItems.value], account = { ...props.account }; await safely(async () => { for (const item of rows) await setWatched(account, item.id, value); if (isCurrentAccount(account)) await load() }) }

watch(title, value => emit('title', value), { immediate: true })
watch(() => history.value.length, value => emit('can-go-back', value > 0), { immediate: true })
watch(route, value => emit('navigate', { ...value }), { immediate: true })
watch(() => [props.searchQuery, props.searchRevision], () => { const query = props.searchQuery?.trim(); if (query) navigate({ kind: 'search', title: `搜索：${query}`, query }); else if (route.value.kind === 'search') goBack() })
watch(() => [props.account.id, props.account.baseUrl, props.account.userId, JSON.stringify(props.initialRoute)], () => {
  generation++; operation++; working.value = false; history.value = []; route.value = props.initialRoute ? { ...props.initialRoute } : { kind: 'root', title: '媒体库' }; preferences.value = readPreferences(props.account.id); options.value = { sort: 'sortName', descending: false }; selected.value = []; selecting.value = false; menu.value = undefined; prompt.value = undefined; manager.value = false; playlistDialog.value = false; ratingItem.value = undefined; shareItem.value = undefined; libraries.value = []; favoriteQueue.value = []; status.value = ''
  if (props.searchQuery?.trim()) route.value = { kind: 'search', title: `搜索：${props.searchQuery.trim()}`, query: props.searchQuery.trim() }
  void load()
}, { immediate: true })
function syncPreferences(event: Event) { if (event instanceof CustomEvent && event.detail !== props.account.id || event instanceof StorageEvent && event.key !== preferenceKey(props.account.id)) return; const value = readPreferences(props.account.id); if (JSON.stringify(value) === JSON.stringify(preferences.value)) return; preferences.value = value; if (route.value.kind === 'home') void load() }
window.addEventListener('boxplayer:server-home-changed', syncPreferences); window.addEventListener('storage', syncPreferences)
onBeforeUnmount(() => { alive = false; generation++; operation++; window.removeEventListener('boxplayer:server-home-changed', syncPreferences); window.removeEventListener('storage', syncPreferences) })
defineExpose({ goBack, navigate, refresh: load, openLibraryRoot: () => navigate({ kind: 'root', title: '媒体库' }), openCategory: (category: Category, title?: string) => navigate(categoryRoute(category, title || categories.find(c => c.id === category)?.title || category)), playServerCategory, favoriteSelectedLibraries, openFavorite: (favorite: Favorite) => navigate(favorite.content ? { ...favorite.route, kind: 'detail' } : favorite.route), getPreferences: () => JSON.parse(JSON.stringify(preferences.value)) as ServerPreferences })
</script>

<template>
<section class="server-workspace" :aria-busy="loading || working" @click.capture="captureMenu" @contextmenu.capture="captureMenu">
  <AnchoredMenu v-if="sortMenu" compact :x="sortMenu.x" :y="sortMenu.y" label="服务器排序" @close="sortMenu=undefined"><div class="server-sort-menu"><button v-for="(value,id) in sortFields" :key="id" role="menuitemradio" :aria-checked="options.sort===id" @click="chooseSort(id)"><ArrowUp v-if="options.sort===id&&!options.descending" :size="13"/><ArrowDown v-else-if="options.sort===id" :size="13"/><span v-else class="sort-menu-spacer"/><span>{{value[0]}}</span></button><div class="server-sort-divider"/><button role="menuitemradio" :aria-checked="!options.descending" @click="chooseSort('ascending')"><Check :size="13" :style="{visibility:options.descending?'hidden':'visible'}"/>升序</button><button role="menuitemradio" :aria-checked="options.descending" @click="chooseSort('descending')"><Check v-if="options.descending" :size="13"/><ArrowDown v-else :size="13"/>降序</button></div></AnchoredMenu>
  <Teleport v-if="toolbarReady" :disabled="!toolbarTarget" :to="toolbarTarget || 'body'"><div v-if="!['detail','person'].includes(route.kind)" class="server-toolbar" @click.capture="captureMenu">
    <template v-if="route.kind==='home'"><button class="round-button" aria-label="媒体管理" @click="manager=true"><List :size="18"/></button><button class="round-button" aria-label="横版海报" @click="changePreference({portrait:false})"><Grid2X2 :size="18"/></button><button class="round-button" aria-label="竖版海报" @click="changePreference({portrait:true})"><List :size="18"/></button><ServerSwitcher :account="account" @select="emit('switch-account',$event)"/></template>
    <template v-else>
    <button class="round-button" :aria-label="layout==='grid'?'列表视图':'网格视图'" @click="changeLayout()"><Grid2X2 v-if="layout==='grid'" :size="18"/><List v-else :size="18"/></button>
    <button v-if="route.kind==='root'" class="round-button" aria-label="排序" @click="options.sort='title';options.descending=!options.descending;changeSort()"><ArrowDown v-if="options.descending" :size="16"/><ArrowUp v-else :size="16"/></button>
    <button v-else class="round-button sort-button server-sort-button" aria-label="排序" @click="openSort"><span>{{sortFields[options.sort || 'sortName']?.[0] || '标题'}}</span><ArrowDown v-if="options.descending" :size="16"/><ArrowUp v-else :size="16"/></button>
    <button class="round-button more-button" aria-label="更多媒体操作" @click="openMenu(route,undefined,undefined,true)"><MoreHorizontal :size="18"/><ChevronDown :size="10"/></button>
    </template>
  </div></Teleport>
  <h1 v-if="!toolbarTarget">{{ title }}</h1><p v-if="error" role="alert">{{ error }} <button :disabled="loading" @click="load()">重试</button></p><p v-if="status" role="status">{{ status }}</p>
  <div v-if="route.kind === 'home'" class="server-home">
    <nav class="workspace-tabs"><button :class="{active:route.kind==='home'}" @click="navigate({kind:'home',title:account.name})">主屏幕</button><button @click="navigate({kind:'search',title:'搜索',query:''})">搜索</button><button @click="navigate({kind:'root',title:'媒体库'})">媒体库</button></nav>
    <section v-if="preferences.favorites.some(f => !f.hiddenOnHome)"><h2>收藏夹</h2><div class="category-grid"><article v-for="favorite in preferences.favorites.filter(f => !f.hiddenOnHome)" :key="favorite.key"><button @click="navigate(favorite.content ? { ...favorite.route, kind: 'detail' } : favorite.route)" @contextmenu.prevent="openMenu(favorite.route, undefined, favorite)"><span v-if="favorite.cover" class="favorite-art"><ServerArtwork :account="account" :path="favorite.cover" :alt="favorite.title" /></span>{{ favorite.title }}</button><button :aria-label="favorite.title + '菜单'" @click="openMenu(favorite.route, undefined, favorite)">⋯</button></article></div></section>
    <template v-for="row in homeRows" :key="row.key"><ServerResumeRow v-if="row.key==='resume'" :title="row.title" :account="account" :items="row.items" @play="item=>play(itemRoute(item),'play',item)" @context="(event,item)=>{captureMenu(event);openMenu(itemRoute(item),item)}"/><ServerPosterRow v-else :title="row.title" :items="row.items" :account="account" :landscape="!preferences.portrait||row.key==='resume'" :error="row.error" more @select="select" @more="navigate(row.route)" @retry="load()" @context="(event,item)=>{captureMenu(event);openMenu(itemRoute(item),item)}"/></template>
    <ServerStatsRow v-if="homeStatistics" :statistics="homeStatistics"/>
  </div>
  <template v-else-if="route.kind==='detail'&&detail"><ServerDetail :item="detail" :account="account" :children="detailChildren" :episodes="seasonEpisodes" :selected-season-id="selectedSeasonId" :similar="similar" :busy="working" :menu-entries="detailMenuEntries" @back="goBack" @play="item=>play(itemRoute(item),'play',item)" @action="detailAction" @select="select" @person="openPerson" @season="loadSeason" @facet="(facet,value)=>navigate({kind:'category',category:'all',id:route.libraryId,libraryId:route.libraryId,facet,value,title:value})"/><button v-if="childrenOffset!=null" :disabled="loading" @click="moreDetailChildren">加载更多剧集</button><p v-if="detailError" role="alert">{{detailError}}<button @click="load()">重试</button></p></template>
  <template v-else>
    <ServerPersonPage v-if="route.kind==='person'&&detail" :person="detail" :account="account" :items="visibleItems" @back="goBack" @select="select" @favorite="updateItem(detail,'favorite')" @more="openPersonSection"/><p v-if="route.kind==='person'&&detailError" role="alert">{{detailError}}</p>
    <div v-if="route.facet && !route.value" class="category-grid"><div v-for="group in facets" :key="group.value"><button @click="navigate({ ...route, value: group.value, title: group.label })" @contextmenu.prevent="openMenu({ ...route, value: group.value, title: group.label })">{{ group.label }} <span v-if="group.count != null">({{ group.count }})</span></button><button :aria-label="group.value + '菜单'" @click="openMenu({ ...route, value: group.value, title: group.label })">⋯</button></div></div>
    <div v-if="route.kind==='search'" class="search-shell search-shell-media-server"><form @submit.prevent="navigate({...route,query:serverSearch})"><input v-model="serverSearch" class="search-input search-input-hero" aria-label="搜索服务器" placeholder="搜索电影、电视剧和演职人员" type="search"/></form><ServerPosterRow v-for="section in searchSections" :key="section.key" :title="section.title" :items="section.items" :account="account" :landscape="section.key==='episode'" @select="select" @context="(event,item)=>{captureMenu(event);openMenu(itemRoute(item),item)}"/></div>
    <ServerListing v-if="route.kind!=='person'&&route.kind!=='search'&&(!route.facet||route.value)" :items="visibleItems" :account="account" :mode="layout" :root="route.kind==='root'" :landscape="!preferences.portrait" :selection="selecting?selected:undefined" :busy="working" @select="select" @context="(event,item)=>{captureMenu(event);openMenu(itemRoute(item),item)}" @watched="item=>updateItem(item,'watched')" @download="download"/>
    <div v-if="selecting&&route.kind!=='root'" class="selection-bar"><span>已选择 {{ selected.length }} 项</span><button @click="selected = selected.length === items.length ? [] : items.map(i => i.id)">全选／取消全选</button><template><button :disabled="!selected.length || working" @click="batchWatched(true)">标记为已观看</button><button :disabled="!selected.length || working" @click="batchWatched(false)">标记为未观看</button></template></div><button v-if="nextOffset !== undefined" :disabled="loading" @click="load(true)">加载更多</button><SourceEmptyState v-if="!loading&&!items.length&&!error&&(!route.facet||route.value)"/>
  </template><p v-if="loading" role="status">正在加载…</p>
  <AnchoredMenu v-if="menu" :x="menuAnchor.x" :y="menuAnchor.y" :label="menu.target.title+'菜单'" @close="menu=undefined">
    <template v-if="menu.target.kind === 'root'"><button role="menuitem" @click="selecting = !selecting; selected = []; menu = undefined">{{ selecting ? '完成选择' : '选择' }}</button><button role="menuitem" @click="options.sort = 'title'; options.descending = !options.descending; menu = undefined; load()">排序方式: 名称</button><button role="menuitem" :disabled="!selecting" @click="favoriteSelectedLibraries(); menu = undefined">添加到收藏夹</button><button role="menuitem" disabled>启用密码锁</button></template>
    <template v-else-if="menu.toolbar&&!menu.item"><button role="menuitem" disabled><SquareCheck :size="14"/>选择</button><button role="menuitem" @click="cycleToolbarSort"><ListFilter :size="14"/>排序方式: {{{title:'片名',addedAt:'添加日期',premiereDate:'上映日期'}[toolbarBrowseSort]}}</button><button v-for="id in ['play','loop','shuffle']" :key="id" role="menuitem" disabled><component :is="id==='play'?Play:id==='loop'?Repeat:Shuffle" :size="14"/>{{{play:'播放',loop:'循环播放',shuffle:'随机播放'}[id]}}</button><template v-if="menu.favorite"><button role="menuitem" @click="mutateFavorite(menu!.favorite!)">从收藏夹中移除</button><button role="menuitem" @click="prompt={kind:'rename',route:menu!.target,favorite:menu!.favorite,value:menu!.favorite!.title};menu=undefined">重命名收藏夹</button><button role="menuitem" @click="safely(async()=>mutateFavorite(menu!.favorite!,{hiddenOnHome:!menu!.favorite!.hiddenOnHome}))">{{menu.favorite.hiddenOnHome?'在主屏幕显示':'在主屏幕隐藏'}}</button><button role="menuitem" @click="openCover(menu.favorite)">选择封面</button></template><button v-else role="menuitem" @click="askFavorite(menu!.target)"><Star :size="14"/>添加到收藏夹</button></template>
    <template v-else-if="menu.item&&!['folder','collectionfolder','userview'].includes(menu.item.kind)"><MediaPosterMenu server :tv="['series','show','season'].includes(menu.item.kind)" :watched="menu.item.watched" :favorite="menu.item.favorite" :disabled="menu.item.kind==='season'?['rating','playlist']:['playlist']" @action="action=>{const item=menu!.item!;menu=undefined;detailAction(action,item)}"/></template>
    <template v-else><button v-for="mode in (['play','loop','shuffle'] as const)" :key="mode" role="menuitem" :disabled="working" @click="play(menu.target,mode,menu.item);menu=undefined">{{{play:'播放',loop:'循环播放',shuffle:'随机播放'}[mode]}}</button><template v-if="menu.favorite?.content"><button role="menuitem" @click="toggleContentFavorite">收藏</button><button role="menuitem" @click="openCover(menu.favorite)">选择封面</button></template><template v-else-if="menu.favorite"><button role="menuitem" @click="safely(async()=>mutateFavorite(menu!.favorite!))">从收藏夹中移除</button><button role="menuitem" @click="prompt={kind:'rename',route:menu.target,favorite:menu.favorite,value:menu.favorite.title};menu=undefined">重命名收藏夹</button><button role="menuitem" @click="safely(async()=>mutateFavorite(menu!.favorite!,{hiddenOnHome:!menu!.favorite!.hiddenOnHome}))">{{menu.favorite.hiddenOnHome?'在主屏幕显示':'在主屏幕隐藏'}}</button><button role="menuitem" @click="openCover(menu.favorite)">选择封面</button></template><button v-else role="menuitem" @click="askFavorite(menu.target,menu.item)">添加到收藏夹</button></template>

  </AnchoredMenu>
  <ServerHomeManager v-if="manager" :choices="choices" :visible="preferences.home" @close="manager=false" @save="keys=>{changePreference({home:keys});manager=false;if(route.kind==='home')void load()}"/>
  <ElectronModal v-if="prompt" :title="prompt.kind==='delete'?'确认删除':prompt.kind==='cover'?'选择封面':prompt.kind==='rename'?'重命名收藏夹':'添加到收藏夹'" :busy="working" @close="prompt=undefined;favoriteQueue=[]" @submit.prevent="submitPrompt"><form class="server-prompt-form" :aria-label="prompt.kind === 'delete' ? '确认删除' : '收藏夹设置'"><p v-if="prompt.kind === 'delete'">{{ prompt.value }}：此操作会删除服务器中的内容。</p><div v-if="prompt.kind === 'cover'"><button type="button" :disabled="working" @click="chooseCoverImage">选择图片</button><button type="button" :disabled="working" @click="prompt.value = ''">恢复默认封面</button><span v-if="prompt.value" class="cover-choice"><ServerArtwork :account="account" :path="prompt.value" alt="封面预览" /></span></div><label v-if="prompt.kind !== 'delete' && !isLocalCoverData(prompt.value)">{{ prompt.kind === 'cover' ? '或使用服务器图片相对路径' : '名称' }}<input v-model="prompt.value" :required="prompt.kind !== 'cover'" /></label><div v-if="prompt.kind === 'cover'" class="cover-grid"><button v-for="cover in coverChoices" :key="cover.path" type="button" :aria-pressed="prompt.value === cover.path" @click="prompt.value = cover.path"><span class="cover-choice"><ServerArtwork :account="account" :path="cover.path" :alt="cover.title" /></span>{{ cover.title }}</button></div><div class="server-prompt-footer"><button type="button" @click="prompt=undefined;favoriteQueue=[]">取消</button><button :disabled="working" class="primary">保存</button></div></form></ElectronModal>
  <ServerPlaylistPicker v-if="playlistDialog&&playlistItem" :account="account" :item="playlistItem" @close="playlistDialog=false"/>
  <ServerRating v-if="ratingItem" :item="ratingItem" :account-id="account.id" @close="ratingItem = undefined" @rated="status = '个人评分已保存'" /><ServerShare v-if="shareItem" :item="shareItem" @close="shareItem = undefined" />

</section>
</template>

<style scoped>
.cover-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.cover-choice{display:block;width:100%;aspect-ratio:2/3;overflow:hidden}.cover-grid button[aria-pressed=true]{outline:2px solid var(--primary)}.server-workspace{padding:20px;min-height:100%;color:var(--foreground,#eee)}button,input,select{font:inherit;color:inherit;background:var(--secondary,#29292e);border:1px solid #7774;border-radius:7px;padding:7px 11px}button{cursor:pointer}button:disabled{opacity:.4;cursor:default}button:hover:not(:disabled){border-color:var(--primary,#34a86f)}h1{font-size:25px}h2{font-size:19px}.server-toolbar,.server-filters,header,.selection-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.server-toolbar{margin-bottom:12px}.server-filters{margin:14px 0}.server-filters input{width:120px}header h2{margin-right:auto}.category-grid{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}.server-home{display:grid;gap:20px}.server-shelf{display:flex;gap:16px;overflow-x:auto;padding:8px 0}.server-shelf article{flex:0 0 150px;min-width:0}.poster{display:block;width:100%;aspect-ratio:2/3;padding:0;overflow:hidden;position:relative;border:0;background:#25252a}.landscape .poster{aspect-ratio:16/9}.landscape article{flex-basis:240px}.server-items.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:22px 16px}.server-items article{min-width:0}.server-items .item-title{background:transparent;border:0;padding-left:0;text-align:left}.server-items.list{display:flex;flex-direction:column;gap:12px}.list article{display:flex;gap:18px;border-bottom:1px solid #7773;padding-bottom:12px;align-items:center}.list .poster{width:90px;flex-shrink:0}.list article>div{flex:1}.selected{outline:2px solid var(--primary,#34a86f);outline-offset:4px}.selected-indicator{position:absolute;top:8px;left:8px;color:var(--primary,#34a86f);background:#111b;font-size:24px}.server-detail{display:flex;gap:28px}.detail-art{width:230px;aspect-ratio:2/3;flex-shrink:0}.server-detail>div:last-child{max-width:850px}.server-detail button{margin:5px}.dialog-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:#0008;padding:24px}.server-dialog,.server-menu{display:flex;flex-direction:column;gap:10px;background:var(--background,#202025);padding:24px;border:1px solid #7775;border-radius:14px;max-height:85vh;overflow:auto;min-width:290px;max-width:650px}.server-menu button{text-align:left}.server-dialog label{display:flex;gap:8px;align-items:center}.server-dialog input:not([type=checkbox]){min-width:220px}.favorite-art{display:block;width:160px;aspect-ratio:16/9}.selection-bar{position:sticky;bottom:10px;background:var(--background,#202025);padding:14px}.server-items p{opacity:.7;font-size:13px}@media(max-width:640px){.server-detail{flex-direction:column}.server-items.grid{grid-template-columns:repeat(auto-fill,minmax(115px,1fr))}}
.server-toolbar{margin:0;flex-wrap:nowrap}.server-toolbar .round-button{display:flex;align-items:center;justify-content:center;gap:6px;height:36px;min-width:36px;width:36px;padding:0;border:1px solid var(--control-border);border-radius:22px;background:var(--control-surface)}.server-toolbar .more-button{gap:2px;width:48px}</style>

<style scoped>.server-prompt-form{display:grid;gap:12px}.server-prompt-form label{display:grid;gap:8px}.server-prompt-form input{height:32px;border:0;background:var(--secondary)}.server-prompt-footer{display:flex;justify-content:flex-end;gap:12px;margin:24px -20px -24px;padding:16px 20px;border-top:1px solid var(--border)}.server-prompt-footer .primary{background:var(--primary);color:white}.workspace-tabs{display:flex;justify-content:center;gap:20px}.workspace-tabs button{border:0;background:transparent}.workspace-tabs .active{color:var(--primary)}.search-shell input{width:100%;height:44px;border-radius:24px;padding:0 18px}.server-workspace:has(.detail-page){padding:0}</style>
<style scoped>.server-toolbar{gap:12px}.server-toolbar .server-sort-button{width:auto;min-width:72px;max-width:240px;gap:7px;padding:0 12px;background:var(--secondary);color:var(--primary)}.server-sort-menu{min-width:132px;padding:4px;max-height:calc(100vh - 90px);overflow-y:auto}.server-sort-menu button{display:flex;align-items:center;gap:7px;min-height:25px;padding:3px 7px;font-size:13px}.sort-menu-spacer{width:13px;flex-shrink:0}.server-sort-divider{height:1px;margin:5px 3px;background:var(--border)}.server-workspace{padding:22px 36px}</style>