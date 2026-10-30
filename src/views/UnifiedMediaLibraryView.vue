<script setup lang="ts">
import { serverFolderFavorites, serverFolderFavoriteKey } from '../media-server/folderFavorites'
import { seriesPreferences, movieVersionItems, generalPreferences, displayScopeAllows } from '../utils/seriesVersionPreferences'
import { mediaWatchProgressPercent } from '../utils/mediaWatchProgress'
import { homeRequests } from '../utils/homeRequestCoordinator'
import UserDAL from '../user/userdal'
import AddFileSourceModal from '../components/AddFileSourceModal.vue'
import { useUserStore } from '../store'
import SidebarProBadge from '../components/SidebarProBadge.vue'
import type { ITokenInfo } from '../user/userstore'
import { makeScanFolder, tokenRootScanFolders, type ScanSourceTarget } from '../utils/fileSourceRoots'
import { getWebDavConnections, saveWebDavConnection, removeWebDavConnection, type WebDavConnectionConfig } from '../utils/webdavClient'
import { MediaScanner } from '../utils/mediaScanner'
import { getDriveProviderById, getDriveProviderIcon } from '../utils/driveProvider'
import { libraryCategoryIcon, librarySidebarCategoryIcon } from '../utils/libraryCategoryIcon'

type ConnectedFileRoot = ScanSourceTarget & { drives?: ScanSourceTarget[]; providerIcon?: string }
const connectedFileRoots = ref<ConnectedFileRoot[]>([])
async function loadConnectedFileRoots() {
  const users = await UserDAL.GetUserListFromDB()
  const roots: ConnectedFileRoot[] = users.flatMap(token => {
    const accountRoots = tokenRootScanFolders(token)
    const providerIcon = getDriveProviderIcon(token.tokenfrom)
    if (token.tokenfrom === 'google' && accountRoots.length) {
      const root = accountRoots[0]
      return [{ ...root, providerIcon, drives: [
        { ...root, label: '我的云端硬盘', folder: makeScanFolder(token, 'google', 'google_root', '我的云端硬盘', '/') },
        { ...root, value: root.value + ':shared', label: '共享云端硬盘', folder: makeScanFolder(token, 'google', 'google_shared', '共享云端硬盘', '/') }
      ] }]
    }
    if (token.tokenfrom !== 'aliyun' || !accountRoots.length) return accountRoots.map(root => ({ ...root, providerIcon }))
    const firstLabel = accountRoots[0].label
    const preferred = accountRoots.filter(root => [token.backup_drive_id, token.resource_drive_id].filter(Boolean).includes(root.folder.drive_id))
    const drives = [...new Map((preferred.length ? preferred : accountRoots).map(root => [root.folder.drive_id, root])).values()]
      .map(root => ({ ...root, label: root.folder.name }))
    return [{ value: `account:${token.user_id}:aliyun`, label: token.source_name?.trim() || firstLabel.slice(0, firstLabel.lastIndexOf(' · ')),
      folder: makeScanFolder(token, drives[0].folder.drive_id, 'root', firstLabel),
      driveServerId: 'aliyun', drives, providerIcon }]
  })
  for (const connection of getWebDavConnections()) {
    roots.push({ value: `webdav:${connection.id}`, label: connection.name, driveServerId: 'webdav',
      folder: makeScanFolder({ user_id: connection.id } as ITokenInfo, `webdav:${connection.id}`, '/', connection.name, '/') })
  }
  connectedFileRoots.value = [...new Map(roots.map(root => [root.value, root])).values()]
}
function rootUserID(root: ScanSourceTarget): string { return (root.folder as typeof root.folder & { user_id: string }).user_id }
function rootFolderMatches(root: ConnectedFileRoot, folder: MediaLibraryFolder) {
  const drives = root.drives?.length ? root.drives : [root]
  const rootIds = ['/', '0', 'root', 'quark_root', 'baidu_root']
  return folder.userId === rootUserID(root) && drives.some(drive => folder.driveId === drive.folder.drive_id && (folder.fileId === drive.folder.file_id || (rootIds.includes(folder.fileId) && rootIds.includes(drive.folder.file_id))))
}
/** Tells several "All Files" favorites apart in the list view. */
function rootFavoriteDriveName(folder: MediaLibraryFolder) {
  const root = connectedFileRoots.value.find(root => rootFolderMatches(root, folder))
  return root ? sourceOverrides.value[`root:${root.value}`]?.name || root.label : ''
}
function rootFolderMatchesAny(root: ConnectedFileRoot, folder: MediaLibraryFolder) {
  return folder.userId === rootUserID(root) && (root.drives?.length ? root.drives : [root]).some(drive => drive.folder.drive_id === folder.driveId)
}
function isConnectedRootFolder(folder: MediaLibraryFolder) { return connectedFileRoots.value.some(root => rootFolderMatches(root, folder)) }
function rootIsFavorite(root: ConnectedFileRoot) {
  return !!sourceOverrides.value[`root:${root.value}`]?.favorite || media.folders.some(folder => folder.isDriveRootFavorite && rootFolderMatches(root, folder))
}
const pendingRootFavorite = ref<ScanSourceTarget>()
const rootFavoriteName = ref('')
async function favoriteFileRoot(root: ScanSourceTarget) {
  pendingRootFavorite.value = root
  rootFavoriteName.value = t('unified.allFiles')
}
function saveRootFavorite() {
  const root = pendingRootFavorite.value, name = rootFavoriteName.value.trim() || t('unified.allFiles')
  if (!root) return
  pendingRootFavorite.value = undefined
  const drives = (root as ConnectedFileRoot).drives
  const targets = drives?.length ? drives : [root]
  for (const target of targets) {
    void MediaScanner.getInstance().favoriteFolder(target.folder, target.driveServerId, name, true)
      .catch(error => message.error(String(error)))
  }
}
async function openConnectedFileRoot(root: ConnectedFileRoot) {
  if (root.drives && root.drives.length > 1) {
    app.mediaLibrarySection = 'video'
    selectedFolder.value = root.value
    await nextTick()
    videoView.value?.selectDriveRoots(root.label, root.value, rootUserID(root), root.drives.map(drive => drive.folder))
    return
  }
  const target = root.drives?.[0] || root
  await showFolder({ id: root.value, fileId: target.folder.file_id, name: root.label,
    path: target.folder.path || '/', userId: rootUserID(root), driveId: target.folder.drive_id,
    driveServerId: target.driveServerId, scanDate: new Date(), itemCount: 0 })
}
import { useLibraryBrowseMode } from '../store/libraryBrowseMode'
import MediaShareModal from '../components/MediaShareModal.vue'
import { libraryObjectCover } from '../utils/libraryObjectCover'
import LibraryObjectActions from '../components/LibraryObjectActions.vue'
import UnifiedLibraryBrowser from '../components/UnifiedLibraryBrowser.vue'
import useLibraryBookmarks from '../store/unifiedLibraryBookmarks'
import useCategoryPlacement from '../store/categoryPlacement'
import { categoryRouteForHomeId, isIndependentCategoryRoute } from '../utils/categoryPlacement'
import { reorderFileSourceIds, applyFileSourceOrder } from '../utils/fileSourceOrder'
import { LIBRARY_CATEGORY_IDS, LIBRARY_SIDEBAR_ROUTES, MOVIE_CATEGORY_IDS, TV_CATEGORY_IDS, libraryHomeId, libraryGroupRoute, libraryGroupLabel, libraryCategoryGroups, filterLibraryCategory, libraryPlaylistMembers, libraryMovieSeries } from '../utils/unifiedLibraryCategories'
import MediaLoadingIndicator from '../components/MediaLoadingIndicator.vue'
import WatchingUpdateModal from '../components/WatchingUpdateModal.vue'
import { isContinueWatchingMember, toggleContinueWatching } from '../utils/continueWatchingAction'
import { X, ChevronRight, Eye, ListPlus } from 'lucide-vue-next'
import { FilePlay } from 'lucide-vue-next'
import LimitReachedModal from '../setting/LimitReachedModal.vue'
import { openMediaShare } from '../utils/mediaShare'
import MediaPersonalRatingModal from '../components/MediaPersonalRatingModal.vue'
import TraktAccountModal from '../components/TraktAccountModal.vue'
import TraktAvatar from '../components/TraktAvatar.vue'
import traktLogo from '../assets/media/trakt-logo.svg'
import { traktStatus, traktAccount, loadTraktStatus, loadTraktAccount, traktSyncEnabled, syncTraktPlaybackProgress } from '../services/trakt/client'
const showTraktAccount = ref(false)
import { openPersonalRating, openServerPersonalRating } from '../utils/mediaPersonalRating'
import CustomMediaSeriesModal from '../components/CustomMediaSeriesModal.vue'
import MediaEmptyFolder from '../components/MediaEmptyFolder.vue'
import SourceEmptyState from '../components/SourceEmptyState.vue'
import { compareMediaBrowseValues, nextMediaBrowseSort, type MediaBrowseSort } from '../utils/mediaBrowseSort'
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { Modal } from '@arco-design/web-vue'
import { History, EyeOff, CalendarDays, Drama, Move, Image, Trash2, ArrowDown, ArrowUp, Check, Clapperboard, GalleryVerticalEnd, FileImage, TvMinimal, BookOpen, Calendar, ChevronDown, ChevronLeft, Ellipsis, Film, Folder, Grid2X2, House, LockKeyhole, Library, List, ListFilter, Music, Network, Pencil, Play, Plus, RefreshCw, Search, Shuffle, SquareCheck, Star, Tv } from 'lucide-vue-next'
import { useAppStore } from '../store'
import { useMediaLibraryStore } from '../store/medialibrary'
import useMusicLibraryStore from '../store/musiclibrary'
import useBookLibraryStore from '../store/booklibrary'
import useMediaServerRegistryStore from '../store/mediaServerRegistry'
import useMediaServerContentStore from '../store/mediaServerContent'
import useMediaServerNavigationStore from '../store/mediaServerNavigation'
import useMediaServerHomePreferencesStore from '../store/mediaServerHomePreferences'
import { resolveMediaServerImage } from '../media-server/imageSources'
import { toMsCacheUrl } from '../media-server/imageCache'
import type { MediaServerType, MediaServerRoute } from '../types/mediaServer'
import type { MediaLibraryFolder, MediaLibraryItem } from '../types/media'
import type { MediaServerCardItem } from '../types/mediaServerContent'
import type { IMusicTrack } from '../types/music'
import type { IBookItem } from '../types/book'
import type { BookManagerView } from '../types/bookShelf'
import type { UnifiedLibraryCard as Card, UnifiedLibraryRow as Row } from '../types/unifiedMediaLibrary'
import { t } from '../i18n'
import UnifiedMediaRow from '../components/UnifiedMediaRow.vue'
import HomeShelfViewport from '../components/HomeShelfViewport.vue'
import UnifiedHomeManagement from '../components/UnifiedHomeManagement.vue'
import useUnifiedHomePreferences from '../store/unifiedHomePreferences'
import { undiscoveredHomeIDs, newlyVisibleServerFavoriteIDs, homeMenuTitle, visibleHomeItems, visibleHomeSections, withFixedHomeMenus, type HomeManagementItem, type HomeManagementNode, type HomeManagementGroup } from '../utils/unifiedHomeManagement'
import { mediaServerSortOptions, type MediaServerBrowseSort, type MediaServerSortDirection } from '../utils/mediaServerBrowseSort'
import { isMediaWatched, setMediaWatched } from '../utils/localWatchedState'
import DB from '../utils/db'
import type { IAliGetFileModel } from '../aliapi/alimodels'
import { getLibraryRankings } from '../utils/tmdb'
import { matchDailyLibraryRanking, matchLibraryRanking, type TmdbRankedEntry } from '../utils/tmdbLibraryRecommendations'
import { saveCustomSeries, loadCustomSeries, type CustomMediaSeries } from '../utils/customMediaSeries'
import { openCustomSeries } from '../utils/customMediaSeries'
import { updateMediaServerPlayedState, updateMediaServerFavoriteState } from '../media-server/contentGateway'
import message from '../utils/message'
import type { PosterAction } from '../utils/mediaPosterMenu'
import { hasLocalMedia } from '../utils/unifiedMediaScope'
import { detailSeriesId } from '../utils/detailResume'
import { serverFavoriteID, serverFavoriteTypes } from '../media-server/favoriteCategories'

import VideoLibrary from './MediaLibraryView.vue'
import MusicLibrary from '../layout/PageMusicLibrary.vue'
import BookLibrary from '../layout/PageBookLibrary.vue'
import ServerRegistry from '../components/media-server/MediaServerRegistryPanel.vue'
import MediaServerIcon from '../components/media-server/MediaServerIcon.vue'
import MediaServerEndpointsModal from '../components/media-server/MediaServerEndpointsModal.vue'
import ServerWorkspace from './MediaServerWorkspace.vue'
defineProps<{ navVisible?: boolean }>()
const app = useAppStore()
const media = useMediaLibraryStore()
const music = useMusicLibraryStore()
const books = useBookLibraryStore()
const registry = useMediaServerRegistryStore()
const content = useMediaServerContentStore()
const navigation = useMediaServerNavigationStore()
const preferences = useMediaServerHomePreferencesStore()
const homePreferences = useUnifiedHomePreferences()
const libraryBookmarks = useLibraryBookmarks()
const placement = useCategoryPlacement()
placement.ensureLoaded()
const libraryBrowser = ref<InstanceType<typeof UnifiedLibraryBrowser>>()
const catalogTitle = ref('')
const categoryMenu = ref<{ route: string; x: number; y: number; favoriteCard?: boolean }>()
function openCategoryMenu(event: MouseEvent, route: string, favoriteCard = false) { if (route.startsWith('source:')) { openSourceMenu(event, route.slice(7)); return }; event.preventDefault(); categoryMenu.value = { route, favoriteCard, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 240)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 280)) } }
async function playCategoryMenu(mode: 'play' | 'loop' | 'shuffle') {
 const route = categoryMenu.value?.route
 categoryMenu.value = undefined
 if (!route) return
 try {
  const library = await DB.getMediaLibrary()
  const items = localOnly.value ? library.items.filter(hasLocalMedia) : library.items
  const members = route.startsWith('playlist/') ? libraryPlaylistMembers(items, media.playlists[decodeURIComponent(route.slice('playlist/'.length))] || []) : route === 'playlist' ? libraryPlaylistMembers(items, [...new Set(Object.values(media.playlists).flat())]) : route.startsWith('custom-series/') ? libraryPlaylistMembers(items, loadCustomSeries().find(group => group.id === route.slice('custom-series/'.length))?.members.filter(member => !member.serverId).map(member => member.id) || []) : route.startsWith('series/') ? libraryMovieSeries(items).find(group => group.id === route.slice('series/'.length))?.members || [] : route === 'series' ? libraryMovieSeries(items).flatMap(group => group.members) : route === 'daily' ? dailyRecommendations.value : filterLibraryCategory(items, route, item => isMediaWatched(item, media.watchedItems))
  await playCatalog(members, mode, categoryBookmarkTitle(route))
 } catch (error) { message.error(String(error)) }
}
const selectedObjectItems = ref<MediaLibraryItem[]>([])
const selectedObjectKeys = computed(() => selectedObjectItems.value.map(item => 'local:' + item.id))
const playlistAssignment = ref<{ items: MediaLibraryItem[]; selected: string[] }>()
const playlistCreateName = ref('')
function toggleObjectSelection(item: MediaLibraryItem) {
 if (selectedObjectItems.value.some(value => value.id === item.id)) selectedObjectItems.value = selectedObjectItems.value.filter(value => value.id !== item.id)
 else selectedObjectItems.value.push(item)
}
function savePlaylistAssignment() {
 const assignment = playlistAssignment.value; if (!assignment) return
 const created = playlistCreateName.value.trim()
 if (created) { media.addPlaylist(created); assignment.selected.push(created) }
 for (const name of assignment.selected) {
  for (const item of assignment.items) if (!media.isInPlaylist(name, item.id)) media.togglePlaylistItem(name, item.id)
 }
 playlistAssignment.value = undefined; playlistCreateName.value = ''
}
const coverRevision = ref(0)
const updateObjectCovers = () => { coverRevision.value++ }
function objectCover(route: string, items: MediaLibraryItem[]) { void coverRevision.value; return libraryObjectCover(route, items) }
onMounted(() => window.addEventListener('boxplayer:library-cover-changed', updateObjectCovers))
onUnmounted(() => window.removeEventListener('boxplayer:library-cover-changed', updateObjectCovers))
const objectPrompt = ref<{ route: string; action: 'rename' | 'delete'; value: string }>()
async function libraryObjectAction(event: Event) {
 const { route, action } = (event as CustomEvent<{ route: string; action: string }>).detail
 if (action === 'home' || action === 'favorite') { promptCatalogPlacement(route, action); return }
 if (action === 'remove') { removeCatalogPlacement(route); return }
 if (action === 'removeFavorite') { removeFavoriteCard(route); return }
 if (action === 'hideFavorite' || action === 'showFavorite') {
  sourceOverrides.value[route] = { ...sourceOverrides.value[route], hiddenOnHome: action === 'hideFavorite' }
  persistSources(); categoryMenu.value = undefined; return
 }
 if (action === 'favoriteCover') { categoryMenu.value = undefined; openFavoriteCoverDialog(route); return }
 if (action === 'renameFavorite') { promptCatalogPlacement(route, 'rename'); return }
 if (['play', 'loop', 'shuffle'].includes(action) && isIndependentCategoryRoute(route)) {
  await playServerCategory(route, action as 'play' | 'loop' | 'shuffle'); return
 }
 if (['play', 'loop', 'shuffle'].includes(action)) {
  categoryMenu.value = { route, x: 0, y: 0 }; await playCategoryMenu(action as 'play' | 'loop' | 'shuffle'); return
 }
 if (action === 'rename' || action === 'delete') { objectPrompt.value = { route, action, value: categoryBookmarkTitle(route) }; return }
 if (action === 'cover') { const key = 'library-cover:' + route; localStorage.setItem(key, String(Number(localStorage.getItem(key) || 0) + 1)); window.dispatchEvent(new Event('boxplayer:library-cover-changed')); return }
 if (action === 'reorder') { if (route.startsWith('playlist/')) { showCatalog(route); await nextTick(); libraryBrowser.value?.beginReorder() } else { await showCustomSeries(route.slice('custom-series/'.length)); playlistReordering.value = true }; return }
 const library = await DB.getMediaLibrary()
 const group = loadCustomSeries().find(group => 'custom-series/' + group.id === route)
 const members = group ? libraryPlaylistMembers(library.items, group.members.filter(member => !member.serverId).map(member => member.id)) : []
 if (action === 'watched' || action === 'unwatched') { members.forEach(item => setMediaWatched(item, action === 'watched', media)); return }
 if (action === 'playlist') { playlistAssignment.value = { items: members, selected: [] }; return }
 if (action === 'select' && group) { await showCustomSeries(group.id); browseSelection.value = true; selectedObjectItems.value = members }
}
function saveObjectPrompt() {
 const prompt = objectPrompt.value; if (!prompt) return
 const name = prompt.value.trim(); if (prompt.action === 'rename' && !name) return
 if (prompt.route.startsWith('playlist/')) {
  const old = decodeURIComponent(prompt.route.slice(9))
  if (prompt.action === 'delete') media.removePlaylist(old)
  else { if (name !== old && media.playlists[name]) return; media.renamePlaylist(old, name)
   }
 } else {
  const id = prompt.route.slice('custom-series/'.length), groups = loadCustomSeries()
  if (prompt.action === 'rename' && groups.some(group => group.id !== id && group.title === name)) return
  saveCustomSeries(prompt.action === 'delete' ? groups.filter(group => group.id !== id) : groups.map(group => group.id === id ? { ...group, title: name } : group))
 }
 if (prompt.action === 'delete') { removeCatalogPlacement(prompt.route); showCatalog(prompt.route.startsWith('playlist/') ? 'playlist' : 'series') }
 else if (prompt.route.startsWith('playlist/')) showCatalog('playlist/' + encodeURIComponent(name))
 objectPrompt.value = undefined
}
onMounted(() => window.addEventListener('boxplayer:library-object-action', libraryObjectAction))
onUnmounted(() => window.removeEventListener('boxplayer:library-object-action', libraryObjectAction))
function closeCategoryMenu(event: KeyboardEvent) {
 if (event.key !== 'Escape') return
 categoryMenu.value = undefined
 if (favoriteReordering.value) finishFavoriteReordering()
}
onMounted(() => document.addEventListener('keydown', closeCategoryMenu))
onUnmounted(() => document.removeEventListener('keydown', closeCategoryMenu))
const catalogPlacement = ref<{ route: string; action: 'home' | 'favorite' | 'rename'; name: string }>()
const categoryFavoriteQueue = ref<string[]>([])
function favoriteServerCategories(routes: string[]) {
  categoryFavoriteQueue.value = routes.filter(route => !placement.state(route).favorite)
  nextServerCategoryFavorite()
}
function nextServerCategoryFavorite() {
  const route = categoryFavoriteQueue.value.shift()
  if (route) promptCatalogPlacement(route, 'favorite')
}
function promptCatalogPlacement(route: string, action: 'home' | 'favorite' | 'rename') {
  const current = placement.state(route)
  const occupied = isIndependentCategoryRoute(route) ? (action === 'home' ? current.home : current.favorite) : current.placed
  if (action !== 'rename' && occupied) { categoryMenu.value = undefined; return }
  const fallback = categoryPlacementTitle(route)
  catalogPlacement.value = { route, action, name: action === 'rename' ? libraryBookmarks.titles[route] || fallback : fallback }
  categoryMenu.value = undefined
}
function removeCatalogPlacement(route: string) {
  placement.change(route, 'remove')
  categoryMenu.value = undefined
}
function removeFavoriteCard(route: string) {
  if (!isIndependentCategoryRoute(route)) { removeCatalogPlacement(route); return }
  placement.change(route, 'removeFavorite')
  categoryMenu.value = undefined
}
/** Plays a media server category like a folder favorite: its first (or a random) title. */
async function playServerCategory(route: string, mode: 'play' | 'loop' | 'shuffle') {
  categoryMenu.value = undefined
  const id = decodeURIComponent(route.slice('home-entry/'.length))
  const server = registry.servers.find(server => id.startsWith(server.id + ':'))
  if (!server) return
  if (!serverWorkspace.value) { showServer(server.id); await nextTick() }
  await serverWorkspace.value?.playServerCategory(server.id, id.slice(server.id.length + 1), mode)
}
async function saveCatalogPlacement() {
  const entry = catalogPlacement.value
  if (!entry?.name.trim()) return
  await placement.change(entry.route, entry.action, entry.name)
  catalogPlacement.value = undefined
  nextServerCategoryFavorite()
}
function handleCatalogPlacement(route: string, action: 'home' | 'favorite' | 'rename' | 'remove' | 'removeFavorite') {
  if (action === 'remove') removeCatalogPlacement(route)
  else if (action === 'removeFavorite') removeFavoriteCard(route)
  else promptCatalogPlacement(route, action)
}
const isCatalogPage = computed(() => section.value === 'collection' && selectedHomeRowKey.value.startsWith('catalog:'))
const isCatalogMediaPage = computed(() => {
  if (!isCatalogPage.value) return false
  const route = selectedHomeRowKey.value.slice(8)
  const parts = route.split('/')
  if (['library', 'movies', 'tv', 'playlist', 'series', 'favorites'].includes(route)) return false
  return !(parts.length === 2 && ['genres', 'ratings', 'years', 'resolution', 'certification', 'networks'].includes(parts[1]))
})
const catalogHistory = ref<string[]>([])
function showCatalog(route = 'library', pushHistory = true) {
  if (route.startsWith('home-entry/')) { showHomeRow(decodeURIComponent(route.slice('home-entry/'.length))); return }
  if (route.startsWith('custom-series/')) { void showCustomSeries(route.slice('custom-series/'.length)); return }
  if (pushHistory) {
    if (!isCatalogPage.value) catalogHistory.value = []
    else if (selectedHomeRowKey.value !== 'catalog:' + route) catalogHistory.value.push(selectedHomeRowKey.value.slice(8))
  }
  if (route.startsWith('source:')) { sourceCards.value.find(card => card.key === route)?.action(); return }
  if (route === 'music' || route === 'books') { app.mediaLibrarySection = route === 'books' ? 'book' : 'music'; return }
  catalogTitle.value = t('media.library')
  showHomeRow('catalog:' + route)
}
function catalogBack() {
  const previous = catalogHistory.value.pop()
  if (previous) showCatalog(previous, false)
  else showHome()
}
async function playCatalog(items: MediaLibraryItem[], mode: 'play' | 'loop' | 'shuffle', label: string) {
  if (!items.length) { message.warning(t('mediaLibrary.noPlayableVideo')); return }
  await showCategory('all')
  await nextTick()
  await videoView.value?.playItems(items, mode, label)
}
const showHomeManagement = ref(false)
const videoView = ref<InstanceType<typeof import('./MediaLibraryView.vue')['default']>>()
const musicView = ref<InstanceType<typeof import('../layout/PageMusicLibrary.vue')['default']>>()
const bookView = ref<InstanceType<typeof import('../layout/PageBookLibrary.vue')['default']>>()
const registryView = ref<InstanceType<typeof import('../components/media-server/MediaServerRegistryPanel.vue')['default']>>()
const addRegistryView = ref<InstanceType<typeof ServerRegistry>>()
const showRegistry = ref(false)
const endpointServerId = ref('')
const toolsVisible = ref(false)
const query = ref('')
const searchScope = ref('')
const searchLibrary = ref<MediaLibraryItem[]>([])
const searchLoading = ref(false)
const searchError = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchGeneration = 0
const isSearchPage = computed(() => section.value === 'collection' && selectedHomeRowKey.value === 'search-results')
const searchScopes = computed(() => [...registry.servers.map(server => ({ id: server.id, title: server.name })), { id: 'library', title: t('media.library') }, { id: 'local', title: t('unified.localFiles') }])
function openSidebarSearch() {
  if (!searchScope.value) searchScope.value = registry.currentServer?.id || registry.servers[0]?.id || 'library'
  selectedHomeRowKey.value = 'search-results'
  app.mediaLibrarySection = 'collection'
}
async function runSidebarSearch() {
  const generation = ++searchGeneration
  const keyword = query.value.trim()
  searchError.value = ''
  if (!keyword) { searchLoading.value = false; return }
  searchLoading.value = true
  try {
    const server = registry.servers.find(server => server.id === searchScope.value)
    if (server) await content.loadSearch(server, keyword)
    else { const library = await DB.getMediaLibrary(); if (generation === searchGeneration) searchLibrary.value = library.items }
  } catch (error) { if (generation === searchGeneration) searchError.value = error instanceof Error ? error.message : String(error) }
  finally { if (generation === searchGeneration) searchLoading.value = false }
}
watch([query, searchScope], () => {
  clearTimeout(searchTimer)
  ++searchGeneration
  searchLoading.value = !!query.value.trim()
  searchTimer = setTimeout(() => { void runSidebarSearch() }, 300)
})
const refreshing = ref(false)
const homeLibrary = shallowRef<MediaLibraryItem[]>([])
let homeLibraryRevision = -1
let homeLibraryRequest: Promise<void> | undefined
function loadHomeLibrary(): Promise<void> {
  if (homeLibraryRequest) return homeLibraryRequest
  homeLibraryRequest = (async () => {
    // Retry if a scraper batch commits during the keyset read; never publish a mixed snapshot.
    do {
      const revision = media.catalogRevision
      if (revision === homeLibraryRevision) return
      const items = await DB.getHomeMediaLibrary()
      if (disposed) return
      if (revision !== media.catalogRevision) continue
      homeLibrary.value = items
      homeLibraryRevision = revision
      return
    } while (!disposed)
  })().finally(() => { homeLibraryRequest = undefined })
  return homeLibraryRequest
}
watch(() => media.catalogRevision, () => { void loadHomeLibrary().catch(() => undefined) })
const recommendationLibrary = homeLibrary
const recommendationRanks = ref<{ daily: TmdbRankedEntry[]; topMovies: TmdbRankedEntry[] }>({ daily: [], topMovies: [] })
const recommendationError = ref(false)
const recommendationLoading = ref(false)
const dailyRecommendations = computed(() => matchDailyLibraryRanking(recommendationLibrary.value, recommendationRanks.value.daily).filter(item => displayScopeAllows(generalPreferences.dailyPicks, item.type === 'movie')))
const topMovieRecommendations = computed(() => matchLibraryRanking(recommendationLibrary.value, recommendationRanks.value.topMovies))
async function loadLibraryRecommendations() {
  if (recommendationLoading.value) return
  recommendationLoading.value = true
  recommendationError.value = false
  try {
    const ranks = await getLibraryRankings()
    if (disposed) return
    recommendationRanks.value = ranks
  } catch { recommendationError.value = true }
  finally { recommendationLoading.value = false }
}
const errors = ref<Record<string, string>>({})
watch(showHomeManagement, async visible => {
  if (!visible) return
  await loadBounded(registry.servers, 2, async server => {
    try {
      await content.loadHomeShell({ ...server, baseUrl: server.backupAddresses?.[server.selectedLineName || ''] || server.baseUrl }, true)
    } catch { /* Keep cached categories editable while offline. */ }
  })
})
const selectedCategory = ref('home')
const detailTagTitle = ref('')
const selectedFolder = ref('')
const folderSelection = ref(false)
const folderDescending = ref(false)
const isFolderPage = computed(() => section.value === 'video' && !!selectedFolder.value)
function renameFolder() { renameText.value = title.value || ''; renameVisible.value = true }
function saveCollectionName() {
  if (isCatalogPage.value && selectedHomeRowKey.value === 'catalog:favorites') {
    void placement.renameHome('sources', renameText.value)
  } else if (isFolderPage.value) {
    const folder = media.folders.find(item => item.id === selectedFolder.value)
    if (folder && renameText.value.trim()) media.addFolder({ ...folder, name: renameText.value.trim() })
  } else placement.change(categoryRouteForHomeId(activeHomeMenuId.value), 'rename', renameText.value)
}
async function removeFolderFavorite() {
  const folder = media.folders.find(item => item.id === selectedFolder.value)
  if (folder) await removeFolder(folder)
}
const selectedHomeRowKey = ref('resume')
const playlistReordering = ref(false)
function reorderSelectedPlaylist(sourceKey: string, targetKey: string) {
  if (selectedHomeRowKey.value.startsWith('custom-series:')) { const id = selectedHomeRowKey.value.slice('custom-series:'.length); saveCustomSeries(loadCustomSeries().map(group => { if (group.id !== id) return group; const members = [...group.members], from = members.findIndex(member => 'local:' + member.id === sourceKey || member.serverId + ':' + member.id === sourceKey), to = members.findIndex(member => 'local:' + member.id === targetKey || member.serverId + ':' + member.id === targetKey); if (from < 0 || to < 0 || from === to) return group; members.splice(to, 0, ...members.splice(from, 1)); return { ...group, members } })); return }
  if (!selectedHomeRowKey.value.startsWith('local:playlist:group:')) return
  const name = decodeURIComponent(selectedHomeRowKey.value.slice('local:playlist:group:'.length))
  const ids = [...(media.playlists[name] || [])]
  const source = ids.indexOf(sourceKey.replace(/^local:/, ''))
  const target = ids.indexOf(targetKey.replace(/^local:/, ''))
  if (source < 0 || target < 0 || source === target) return
  const [id] = ids.splice(source, 1)
  ids.splice(target, 0, id)
  media.playlists = { ...media.playlists, [name]: ids }
}
const customSeriesGroups = ref<CustomMediaSeries[]>(loadCustomSeries())
const customSeriesCards = ref<Card[]>([])
let seriesLoadVersion = 0
async function showCustomSeries(id = '') {
 if (!seriesPreferences.useCustom) return
 if (!id) { showCatalog('series'); return }
 const version = ++seriesLoadVersion
 customSeriesGroups.value = loadCustomSeries()
 customSeriesCards.value = []
 selectedHomeRowKey.value = id ? 'custom-series:' + id : 'custom-series'
 app.mediaLibrarySection = 'collection'
 if (!id) return
 const group = customSeriesGroups.value.find(group => group.id === id)
 if (!group) return
 try {
  const local = await DB.getMediaLibraryItemsByIds([...new Set(group.members.filter(member => !member.serverId).flatMap(member => [member.id, member.parentId || detailSeriesId(member.id)]))])
  if (version !== seriesLoadVersion) return
  if (seriesPreferences.openDetail) {
   const first = group.members[0]
   if (first?.serverId) { showServer(first.serverId, { kind: 'item-detail', itemId: first.id, title: first.title }); return }
   const item = first && libraryPlaylistMembers(local, [first.id])[0]
   if (item) { await openVideo(item); return }
  }
  customSeriesCards.value = group.members.flatMap(member => {
   if (member.serverId) return [{ key: member.serverId + ':' + member.id, title: member.title, action: () => showServer(member.serverId!, { kind: 'item-detail', itemId: member.id, title: member.title }) }]
   const item = libraryPlaylistMembers(local, [member.id])[0]
   return item ? [localCard(item, false, undefined, id)] : [{ key: member.id, title: member.title, action: () => message.warning(t('customSeries.missingMember')) }]
  })
 } catch (error) { message.error(error instanceof Error ? error.message : String(error)) }
}
function syncCustomSeries() {
 customSeriesGroups.value = loadCustomSeries()
 if (section.value === 'collection' && selectedHomeRowKey.value.startsWith('custom-series')) {
  const id = selectedHomeRowKey.value === 'custom-series' ? '' : selectedHomeRowKey.value.slice('custom-series:'.length)
  void showCustomSeries(id)
 }
}

const collectionMode = useLibraryBrowseMode()
const localOnly = ref(false)
const browseSort = ref<MediaBrowseSort>(generalPreferences.sort as MediaBrowseSort)
const browseSortDescending = ref(['addedAt', 'premiereDate'].includes(browseSort.value))
watch(browseSort, sort => { browseSortDescending.value = ['addedAt', 'premiereDate'].includes(sort) })
function selectBrowseSort(sort: MediaBrowseSort) {
  if (sort === browseSort.value) browseSortDescending.value = !browseSortDescending.value
  else browseSort.value = sort
}
watch(() => generalPreferences.sort, value => { browseSort.value = value as MediaBrowseSort })
const serverSort = ref<MediaServerBrowseSort>('sortName')
const serverSortDirection = ref<MediaServerSortDirection>('ascending')
const serverSortSeed = ref(Date.now())
const serverSortMenuVisible = ref(false)
function selectServerSort(sort: MediaServerBrowseSort) {
  if (serverSort.value === sort) serverSortDirection.value = serverSortDirection.value === 'ascending' ? 'descending' : 'ascending'
  serverSort.value = sort
  if (sort === 'random') serverSortSeed.value = Date.now()
  serverSortMenuVisible.value = false
}
const isGenreIndexPage = computed(() => section.value === 'video' && !selectedFolder.value && (videoView.value?.activeCategory || selectedCategory.value) === 'genres')
const isServerCategoryPage = computed(() => section.value === 'server' && isCategoryPage.value)
const serverCategorySubtitle = computed(() => {
  const item = isServerCategoryPage.value && activeHomeMenuId.value ? homeItems.value.find(item => item.id === activeHomeMenuId.value) : undefined
  return item ? homeMenuTitle(item, homePreferences) : ''
})
const isServerRootPage = computed(() => section.value === 'server' && navigation.currentRoute.kind === 'library-root')
const fileSourceSelection = ref(false)
const fileSourceReordering = ref(false)
const sourceDragKey = ref('')
const sourceDropKey = ref('')
const sourceDragOffset = ref({ x: 0, y: 0 })
let sourceRowBounds: { key: string; top: number; height: number }[] = []
let sourceDragSuppressClick = false
let sourceDragClickTimer: ReturnType<typeof setTimeout> | undefined
let sourcePointer: { key: string; x: number; y: number; id: number } | undefined
function startSourcePointer(event: PointerEvent, key: string) {
  if (event.button !== 0) return
  event.preventDefault()
  sourcePointer = { key, x: event.clientX, y: event.clientY, id: event.pointerId }
  sourceRowBounds = Array.from((event.target as HTMLElement).closest('.file-source-browser')?.querySelectorAll<HTMLElement>('.file-source-card') || []).map(row => {
    const bounds = row.getBoundingClientRect()
    return { key: row.dataset.sourceKey || '', top: bounds.top, height: bounds.height }
  })
  sourceDragOffset.value = { x: 0, y: 0 }
  document.addEventListener('pointermove', moveSourcePointer)
  document.addEventListener('pointerup', finishSourcePointer)
  document.addEventListener('pointercancel', cancelSourcePointer)
}
function moveSourcePointer(event: PointerEvent) {
  if (!sourcePointer || event.pointerId !== sourcePointer.id) return
  if (!sourceDragKey.value && Math.hypot(event.clientX - sourcePointer.x, event.clientY - sourcePointer.y) < 5) return
  clearTimeout(sourceDragClickTimer)
  sourceDragSuppressClick = true
  sourceDragKey.value = sourcePointer.key
  sourceDragOffset.value = { x: collectionMode.value === 'list' ? 0 : event.clientX - sourcePointer.x, y: event.clientY - sourcePointer.y }
  if (collectionMode.value === 'list') {
    const dragged = sourceRowBounds.find(row => row.key === sourcePointer?.key)
    const center = (dragged?.top || 0) + (dragged?.height || 0) / 2 + sourceDragOffset.value.y
    sourceDropKey.value = sourceRowBounds.reduce((nearest, row) => Math.abs(row.top + row.height / 2 - center) < Math.abs(nearest.top + nearest.height / 2 - center) ? row : nearest, sourceRowBounds[0])?.key || ''
  } else sourceDropKey.value = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.file-source-card')?.dataset.sourceKey || ''
  event.preventDefault()
}
function finishSourcePointer(event: PointerEvent) {
  if (!sourcePointer || event.pointerId !== sourcePointer.id) return
  if (sourceDragKey.value && sourceDropKey.value) commitSourceOrder(reorderFileSourceIds(fileSourceCards.value.map(card => card.key), sourceDragKey.value, sourceDropKey.value))
  cancelSourcePointer()
}
function cancelSourcePointer() {
  sourcePointer = undefined
  document.removeEventListener('pointermove', moveSourcePointer)
  document.removeEventListener('pointerup', finishSourcePointer)
  document.removeEventListener('pointercancel', cancelSourcePointer)
  if (sourceDragKey.value) endSourceDrag()
  sourceRowBounds = []
}
function sourceDragStyle(key: string) {
  if (!sourceDragKey.value) return undefined
  if (key === sourceDragKey.value) return { transform: `translate3d(${sourceDragOffset.value.x}px, ${sourceDragOffset.value.y}px, 0)` }
  if (collectionMode.value !== 'list') return undefined
  const from = sourceRowBounds.findIndex(row => row.key === sourceDragKey.value)
  const to = sourceRowBounds.findIndex(row => row.key === sourceDropKey.value)
  const index = sourceRowBounds.findIndex(row => row.key === key)
  if (from < 0 || to < 0) return undefined
  const distance = sourceRowBounds[from].height
  const offset = from < to && index > from && index <= to ? -distance : from > to && index >= to && index < from ? distance : 0
  return { transform: `translateY(${offset}px)` }
}
function startSourceReordering() { fileSourceReordering.value = true; fileSourceSelection.value = false; selectedFileSources.value = []; sourceDialog.value = '' }
function finishSourceReordering() { cancelSourcePointer(); fileSourceReordering.value = false; sourceDragKey.value = ''; sourceDropKey.value = '' }
function commitSourceOrder(ids: string[]) {
  const next = applyFileSourceOrder(sourceOverrides.value, ids)
  try { localStorage.setItem('UnifiedSourceOverrides', JSON.stringify(next)); sourceOverrides.value = next }
  catch (error) { message.error(String(error)) }
}
function endSourceDrag() {
  sourceDragKey.value = ''; sourceDropKey.value = ''
  clearTimeout(sourceDragClickTimer)
  sourceDragClickTimer = setTimeout(() => { sourceDragSuppressClick = false }, 150)
}
function sourceReorderKeydown(event: KeyboardEvent, key: string) {
  const previous = ['ArrowUp', 'ArrowLeft'].includes(event.key)
  const next = ['ArrowDown', 'ArrowRight'].includes(event.key)
  if (!previous && !next) return
  event.preventDefault(); event.stopPropagation(); moveSource(key, previous ? -1 : 1)
}
function sourceReorderEscape(event: KeyboardEvent) { if (event.key === 'Escape') finishSourceReordering() }
onMounted(() => document.addEventListener('keydown', sourceReorderEscape))
onUnmounted(() => { cancelSourcePointer(); clearTimeout(sourceDragClickTimer); document.removeEventListener('keydown', sourceReorderEscape) })
watch([() => app.mediaLibrarySection, collectionMode], finishSourceReordering)
const selectedFileSources = ref<string[]>([])
const allFileSourcesSelected = computed(() => fileSourceCards.value.length > 0 && fileSourceCards.value.every(card => selectedFileSources.value.includes(card.key)))
function toggleFileSourceSelection() { fileSourceSelection.value = !fileSourceSelection.value; selectedFileSources.value = [] }
function toggleAllFileSources() { selectedFileSources.value = allFileSourcesSelected.value ? [] : fileSourceCards.value.map(card => card.key) }
async function deleteSelectedFileSource() {
  if (!selectedFileSources.value.length) return
  const shortcutKeys = selectedFileSources.value.filter(key => key.startsWith('server-folder:') || key.startsWith('server-category:'))
  if (shortcutKeys.length) {
    for (const key of shortcutKeys) {
      const card = folderFavoriteCards.value.find(card => card.key === key)
      if (card) await serverPosterAction(card.item, 'favorite')
      else removeCatalogPlacement(key.slice('server-category:'.length))
    }
    selectedFileSources.value = selectedFileSources.value.filter(key => !shortcutKeys.includes(key))
    if (!selectedFileSources.value.length) return
  }
  // Bare connection deletion remains in its existing account-management UI.
  if (selectedFileSources.value.some(key => key.startsWith('root:'))) return
  if (selectedFileSources.value.length > 1) {
    const keys = [...selectedFileSources.value]
    const names = fileSourceCards.value.filter(card => keys.includes(card.key)).map(card => card.title)
    Modal.confirm({
      title: t('common.delete'),
      content: `${t('posterMenu.selectedCount', { count: names.length })}: ${names.join('、')}`,
      okText: t('file.delete'),
      okButtonProps: { status: 'danger' },
      cancelText: t('common.cancel'),
      onOk: () => {
        const removedFolderIds = new Set<string>()
        for (const key of keys) {
          if (key.startsWith('server:')) {
            const id = key.slice(7)
            if (registry.servers.some(server => server.id === id)) registry.removeServer(id)
          } else if (key.startsWith('folder:')) {
            const id = key.slice(7)
            if (media.folders.some(folder => folder.id === id)) {
              media.removeFolder(id)
              removedFolderIds.add(id)
            }
          }
        }
        if (removedFolderIds.has(selectedFolder.value)) selectedFolder.value = ''
        if (!registry.currentServer) navigation.openRegistry()
        selectedFileSources.value = []
        fileSourceSelection.value = false
      }
    })
    return
  }
  const key = selectedFileSources.value[0]
  sourceMenu.value = { key, x: 0, y: 0 }
  await sourceAction(key.startsWith('server:') ? 'delete' : 'removeFavoriteFolder')
}
const fileSourceDescending = ref(false)
function readSourceOverrides(): Record<string, { name?: string; cover?: string; order?: number; hiddenOnHome?: boolean; favorite?: boolean }> {
  try { const value = JSON.parse(localStorage.getItem('UnifiedSourceOverrides') || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} }
}
const sourceOverrides = ref(readSourceOverrides())
const sourceMenu = ref<{ key: string; x: number; y: number } | null>(null)
const favoriteSourceMenu = ref(false)
const sourceDialog = ref<'rename' | 'cover' | ''>('')
const sourceTarget = ref('')
const sourceText = ref('')
const rootEditor = ref<{ key: string; name: string; connection?: WebDavConnectionConfig }>()
async function saveRootEditor() {
  const editor = rootEditor.value
  if (!editor || !editor.name.trim()) return
  if (editor.connection) {
    try {
      const url = new URL(editor.connection.url)
      if (!['http:', 'https:'].includes(url.protocol)) return
    } catch { return }
    saveWebDavConnection({ ...editor.connection, name: editor.name.trim() })
  }
  sourceOverrides.value[editor.key] = { ...sourceOverrides.value[editor.key], name: editor.name.trim() }
  persistSources()
  await loadConnectedFileRoots()
  rootEditor.value = undefined
}
const contextOptions = computed(() => sourceMenu.value?.key.startsWith('root:')
  ? [{ id: connectedFileRoots.value.some(root => `root:${root.value}` === sourceMenu.value?.key && rootIsFavorite(root)) ? 'removeRootFavorite' : 'addToFavorites', icon: Star }, { id: 'reorder', icon: Move }, { id: 'editShare', icon: Pencil }, { id: 'delete', icon: Trash2 }]
  : sourceMenu.value?.key.startsWith('server:')
  ? [{ id: 'reorder', icon: Move }, { id: 'editShare', icon: Pencil }, { id: 'cover', icon: Image }, { id: 'endpoint', icon: RefreshCw }, { id: 'delete', icon: Trash2 }]
  : [{ id: 'play', icon: Play }, { id: 'loopPlay', icon: RefreshCw }, { id: 'shufflePlay', icon: Shuffle }, { id: 'removeFavoriteFolder', icon: Star }, { id: 'renameCollection', icon: Pencil }, { id: sourceOverrides.value[sourceMenu.value?.key || '']?.hiddenOnHome ? 'showFavoriteOnHome' : 'hideFavoriteOnHome', icon: Eye }, { id: 'reorder', icon: Move }, { id: 'cover', icon: Image }])
function persistSources() { localStorage.setItem('UnifiedSourceOverrides', JSON.stringify(sourceOverrides.value)) }
async function openSourceMenu(event: MouseEvent, key: string, fromFavorite = false) {
  event.preventDefault()
  favoriteSourceMenu.value = fromFavorite
  sourceMenu.value = { key, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 170)), y: event.clientY }
  await nextTick()
  const menu = document.querySelector<HTMLElement>('.source-context-menu')
  if (sourceMenu.value && menu) sourceMenu.value.y = Math.max(8, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8))
  document.querySelector<HTMLButtonElement>('.source-context-menu button')?.focus()
}
async function sourceAction(id: string) {
  const key = sourceMenu.value?.key
  const fromFavorite = favoriteSourceMenu.value
  sourceMenu.value = null
  favoriteSourceMenu.value = false
  if (!key) return
  if (id === 'reorder' && fromFavorite) { await startFavoriteReordering(); return }
  sourceTarget.value = key
  const root = connectedFileRoots.value.find(root => `root:${root.value}` === key)
  if (root && id === 'addToFavorites') { await favoriteFileRoot(root); return }
  if (root && id === 'removeRootFavorite') {
    await confirmRemoveFavorite(() => {
      sourceOverrides.value[key] = { ...sourceOverrides.value[key], favorite: false }
      persistSources()
      for (const folder of media.folders.filter(folder => folder.isDriveRootFavorite && rootFolderMatches(root, folder))) media.removeFolder(folder.id)
    })
    return
  }
  if (root && id === 'editShare') {
    const connection = getWebDavConnections().find(item => root.value === `webdav:${item.id}`)
    rootEditor.value = { key, name: sourceOverrides.value[key]?.name || root.label, connection: connection ? { ...connection } : undefined }
    return
  }
  if (root && id === 'delete') {
    Modal.confirm({
      title: t('unified.delete'), content: t('unified.deleteRootConfirmation'),
      okText: t('file.delete'), okButtonProps: { status: 'danger' },
      onOk: async () => {
        const userId = rootUserID(root)
        if (root.value.startsWith('webdav:')) removeWebDavConnection(userId)
        else await UserDAL.UserLogOff(userId)
        media.removeMediaSourceByUserId(userId)
        await loadConnectedFileRoots()
      }
    })
    return
  }
  const folder = media.folders.find(item => 'folder:' + item.id === key)
  if (['play', 'loopPlay', 'shufflePlay'].includes(id) && folder) {
    await showFolder(folder)
    await nextTick()
    videoView.value?.playFolder(folder.id, id === 'loopPlay' ? 'loop' : id === 'shufflePlay' ? 'shuffle' : 'play')
  } else if (id === 'removeFavoriteFolder' && folder) await removeFolder(folder)
  else if (id === 'renameCollection' && folder) { sourceText.value = folder.name; sourceDialog.value = 'rename' }
  else if ((id === 'showFavoriteOnHome' || id === 'hideFavoriteOnHome') && folder) {
    sourceOverrides.value[key] = { ...sourceOverrides.value[key], hiddenOnHome: id === 'hideFavoriteOnHome' }
    persistSources()
  }
  else if (id === 'cover' && folder) { sourceText.value = sourceOverrides.value[key]?.cover || ''; sourceDialog.value = 'cover' }
  else if (id === 'cover' && key.startsWith('server:')) addRegistryView.value?.openIconManager(key.slice(7))
  else if (id === 'endpoint' && key.startsWith('server:')) endpointServerId.value = key.slice(7)
  else if (id === 'reorder') { app.mediaLibrarySection = 'files'; await nextTick(); startSourceReordering() }
  else if (key.startsWith('server:')) {
    if (id === 'delete') addRegistryView.value?.deleteServer(key.slice(7))
    else addRegistryView.value?.editServer(key.slice(7))
  }
}
/** Cover of a media server card in Favorites; Home and Files read the same override. */
function openFavoriteCoverDialog(key: string) {
  sourceTarget.value = key
  sourceText.value = sourceOverrides.value[key]?.cover || ''
  sourceDialog.value = 'cover'
}
function favoriteCover(key: string) {
  return sourceOverrides.value[key.startsWith('server-category:') ? key.slice('server-category:'.length) : key]?.cover
}
function saveSourceDialog() {
  if (sourceDialog.value === 'cover') {
    const cover = sourceText.value.trim()
    if (cover && !/^https?:\/\//i.test(cover)) return
    sourceOverrides.value[sourceTarget.value] = { ...sourceOverrides.value[sourceTarget.value], cover: cover || undefined }
    persistSources()
  }
  if (sourceDialog.value === 'rename') {
    const folder = media.folders.find(item => 'folder:' + item.id === sourceTarget.value)
    if (folder && sourceText.value.trim()) media.addFolder({ ...folder, name: sourceText.value.trim() })
  }
  sourceDialog.value = ''
}
function moveSource(key: string, offset: number) {
  const cards = [...fileSourceCards.value]
  const index = cards.findIndex(card => card.key === key), target = index + offset
  if (index < 0 || target < 0 || target >= cards.length) return
  ;[cards[index], cards[target]] = [cards[target], cards[index]]
  commitSourceOrder(cards.map(card => card.key))
}
const failedProviderIcons = ref(new Set<string>())
function markProviderIconFailed(key: string) { failedProviderIcons.value = new Set([...failedProviderIcons.value, key]) }
const serverFolderMenu = ref<{ item: MediaServerCardItem; x: number; y: number }>()
const folderFavoriteCards = computed(() => serverFolderFavorites.value.filter(entry =>
 registry.servers.some(server => server.id === entry.item.serverId && (server.userId || '') === entry.userId)
).map(entry => ({ key: serverFolderFavoriteKey(entry.item), title: entry.item.title, item: entry.item,
 action: () => entry.item.id === '__all__' ? showServer(entry.item.serverId) : entry.item.kind === 'folder' ? showServer(entry.item.serverId, { kind: 'library-page', libraryId: entry.item.id, title: entry.item.title }) : showServer(entry.item.serverId, { kind: 'item-detail', itemId: entry.item.id, title: entry.item.title }) })))
const fileSourceCards = computed(() => [
 ...folderFavoriteCards.value.map(card => ({ ...card, server: null, providerIcon: '', icon: Folder })),
 ...libraryBookmarks.favorites.filter(route => route.startsWith('home-entry/')).map(route => ({ key: 'server-category:' + route, title: libraryBookmarks.titles[route] || categoryBookmarkTitle(route), server: null, providerIcon: '', icon: Folder, action: () => showCatalog(route) })),...connectedFileRoots.value.filter(root => !media.folders.some(folder => folder.isFavorite !== false && rootFolderMatchesAny(root, folder))).map(root => ({ key: `root:${root.value}`, title: sourceOverrides.value[`root:${root.value}`]?.name || root.label, server: null, providerIcon: root.providerIcon || '', icon: root.driveServerId === 'webdav' ? Network : Folder, action: () => { void openConnectedFileRoot(root) } })), ...registry.servers.map(server => ({ key: 'server:' + server.id, title: server.name, server, providerIcon: '', icon: Star, action: () => showServer(server.id) })), ...media.folders.filter(folder => (!isConnectedRootFolder(folder) || folder.isDriveRootFavorite) && folder.isFavorite !== false).map(folder => ({ key: 'folder:' + folder.id, title: folder.name, subtitle: folder.isDriveRootFavorite ? rootFavoriteDriveName(folder) : '', server: null, providerIcon: folder.isDriveRootFavorite || ['/', '0', 'root', 'quark_root', 'baidu_root'].includes(folder.fileId) ? getDriveProviderIcon(getDriveProviderById(folder.driveId || folder.driveServerId)) : '', icon: Star, action: () => { void showFolder(folder) } }))].sort((a,b) => ((sourceOverrides.value[a.key]?.order ?? 9999) - (sourceOverrides.value[b.key]?.order ?? 9999)) || a.title.localeCompare(b.title) * (fileSourceDescending.value ? -1 : 1)))
function sourceServer(key: string) { return registry.servers.find(server => key === 'source:server:' + server.id) }
function openFileSource(card: typeof fileSourceCards.value[number]) { if (fileSourceReordering.value || sourceDragKey.value || sourceDragSuppressClick) return; if (!fileSourceSelection.value) { card.action(); return }; selectedFileSources.value = selectedFileSources.value.includes(card.key) ? selectedFileSources.value.filter(key => key !== card.key) : [...selectedFileSources.value, card.key] }
const serverRootSelection = ref(false)
const serverWorkspace = ref<InstanceType<typeof import('./MediaServerWorkspace.vue')['default']>>()
const browseSelection = ref(false)
const localDetailVisible = ref(false)
const detailPageVisible = computed(() => (section.value === 'video' && localDetailVisible.value) || (section.value === 'server' && ['item-detail', 'person-page'].includes(navigation.currentRoute.kind)))
const renameVisible = ref(false)
const renameText = ref('')
const activeHomeMenuId = computed(() => {
  if (section.value === 'server') {
    const route = navigation.currentRoute
    const serverId = registry.currentServer?.id || ''
    if (route.kind === 'library-page') return `${serverId}:${route.libraryId}`
    if (route.kind === 'collection-page') return `${serverId}:${route.collectionId === 'home:nextup' ? 'next' : 'latest'}`
    return ''
  }
  return section.value === 'collection' ? selectedHomeRowKey.value : selectedCategory.value === 'recently-added' ? 'recent' : `local:${selectedCategory.value}`
})
function hideCurrentHomeMenu() {
  if (!activeHomeMenuId.value) return
  removeCatalogPlacement(categoryRouteForHomeId(activeHomeMenuId.value))
}
function renameCurrentHomeMenu() { renameText.value = title.value || ''; renameVisible.value = true }
const isCategoryPage = computed(() => section.value === 'collection' || (section.value === 'video' && !selectedFolder.value) || (section.value === 'server' && ['library-page', 'genre-page', 'studio-page', 'collection-page'].includes(navigation.currentRoute.kind)))
const expanded = ref({ home: true, library: true, files: true })
const sidebarCollapsed = ref(false)
const showAddFileSource = ref(false)
watch(() => useUserStore().userShowLogin, visible => { if (!visible) void loadConnectedFileRoots().catch(() => undefined) })
function togglePickerRootFavorite(id: string) {
  const root = connectedFileRoots.value.find(r => r.value === id)
  if (!root) return
  if (!rootIsFavorite(root)) { void favoriteFileRoot(root).catch(e => message.error(String(e))); return }
  // Unfavoriting "All Files" clears the drive's scraped media, so it confirms first like every other entry.
  void confirmRemoveFavorite(() => {
    sourceOverrides.value[`root:${root.value}`] = { ...sourceOverrides.value[`root:${root.value}`], favorite: false }
    for (const folder of [...media.folders]) if (folder.isDriveRootFavorite && rootFolderMatches(root, folder)) media.removeFolder(folder.id)
    persistSources()
  })
}
async function fileSourceConnected() {
  await loadConnectedFileRoots().catch(() => undefined)
}
const showProPurchase = ref(false)
const section = computed(() => app.mediaLibrarySection)
watch([section, selectedCategory, selectedFolder], () => { detailTagTitle.value = '' })
registry.ensureLoaded()
preferences.ensureLoaded()
const categories = computed(() => [
  { key: 'recently-added', title: t('media.recentlyAdded'), icon: Folder },
  { key: 'unwatched', title: t('media.unwatched'), icon: Folder },
  { key: 'movies', title: t('media.movie'), icon: Film },
  { key: 'tv', title: t('media.tv'), icon: Tv },
  { key: 'genres', title: t('unified.movieGenres'), icon: Library },
  { key: 'unmatched', title: t('unified.other'), icon: Folder },
  { key: 'favorites', title: t('pan.favorite'), icon: Star },
  { key: 'playlist', title: t('media.playlist'), icon: List }
])
const title = computed(() => {
  if (section.value === 'video' && detailTagTitle.value) return detailTagTitle.value
  if (isCatalogPage.value && selectedHomeRowKey.value === 'catalog:favorites') return homePreferences.titles.sources || t('pan.favorite')
  if (isCatalogPage.value) return resolvedCatalogTitle.value
  if (isSearchPage.value) return t('video.searchResults')
  if (section.value === 'home') return t('unified.home')
  if (section.value === 'video' && !selectedFolder.value && homePreferences.titles[activeHomeMenuId.value]) return homePreferences.titles[activeHomeMenuId.value]
  if (section.value === 'files') return t('unified.files')
  if (section.value === 'music') return t('nav.music')
  if (section.value === 'book') return t('nav.books')
  if (section.value === 'collection' && selectedHomeRowKey.value === 'sources') return homePreferences.titles.sources || t('unified.sources')
  if (section.value === 'collection' && selectedHomeRowKey.value === 'library-index') return t('media.library')
  if (section.value === 'collection') return selectedHomeRow.value?.title || t('media.library')
  if (section.value === 'server') return homePreferences.titles[activeHomeMenuId.value] || ('title' in navigation.currentRoute ? navigation.currentRoute.title : registry.currentServer?.name || t('nav.mediaServer'))
  return media.folders.find(folder => folder.id === selectedFolder.value)?.name || categories.value.find(item => item.key === selectedCategory.value)?.title || t('nav.video')
})
const bookTabs = computed(() => [
  { key: 'home' as const, title: t('book.allBooks') },
  { key: 'recent' as const, title: t('book.recent') },
  { key: 'favorites' as const, title: t('book.favorites') },
  { key: 'shelves' as const, title: t('book.shelves') },
  { key: 'notes' as const, title: t('book.notes') },
  { key: 'highlights' as const, title: t('book.highlights') },
  { key: 'bookmarks' as const, title: t('book.bookmarks') },
  { key: 'trash' as const, title: t('book.deleted') },
  { key: 'folders' as const, title: t('book.folders') },
  { key: 'formats' as const, title: t('book.formats') },
  { key: 'stats' as const, title: t('book.stats') }
])
async function selectBookTab(tab: BookManagerView) {
  app.mediaLibrarySection = 'book'
  await nextTick()
  await bookView.value?.selectView(tab)
}
function showHome() { app.mediaLibrarySection = 'home'; selectedCategory.value = 'home'; selectedFolder.value = '' }
function showHomeRow(key: string) { selectedHomeRowKey.value = key.includes(':group:') || key.startsWith('catalog:') ? 'catalog:' + categoryRouteForHomeId(key) : key; app.mediaLibrarySection = 'collection' }
async function showCategory(category: string) {
  if (category === 'home') { showHome(); return }
  app.mediaLibrarySection = 'video'
  selectedCategory.value = category
  if (category === 'genres') browseSort.value = 'title'
  selectedFolder.value = ''
  await nextTick()
  videoView.value?.selectCategory(category)
}
async function showFolder(folder: MediaLibraryFolder) {
  app.mediaLibrarySection = 'video'
  selectedFolder.value = folder.id
  await nextTick()
  await videoView.value?.selectFolder(folder)
}
function showServer(id: string, route: MediaServerRoute = { kind: 'library-root' }) {
  registry.setCurrentServer(id)
  navigation.goLibraryRoot()
  if (route.kind !== 'library-root') navigation.push(route)
  app.mediaLibrarySection = 'server'
}
async function openVideo(item: MediaLibraryItem) {
  await showCategory(item.type === 'tv' ? 'tv' : item.type === 'movie' ? 'movies' : 'unmatched')
  videoView.value?.openItem(item)
}
async function openMusic(item: IMusicTrack) {
  app.mediaLibrarySection = 'music'
  await nextTick()
  musicView.value?.playFromList(music.recentlyAdded, item)
}
async function openBook(item: IBookItem) {
  app.mediaLibrarySection = 'book'
  await nextTick()
  await bookView.value?.openBook(item)
}
async function localPosterAction(item: MediaLibraryItem, action: PosterAction) {
 if (action === 'play' || action === 'loop' || action === 'shuffle') { await playCatalog([item], action, item.name); return }
 if (action === 'share') { openMediaShare({ id: item.id, title: item.name, year: item.year, overview: item.overview, files: item.driveFiles }); return }
 if (action === 'rating') { openPersonalRating(item); return }
 if (action === 'watched') { setMediaWatched(item, !isMediaWatched(item, media.watchedItems), media); return }
 if (action === 'select') { if (section.value !== 'collection') showCatalog(item.type === 'tv' ? 'tv' : 'movies'); browseSelection.value = true; toggleObjectSelection(item); return }
 if (action === 'playlist') { playlistAssignment.value = { items: [item], selected: Object.keys(media.playlists).filter(name => media.isInPlaylist(name, item.id)) }; return }
 if (action === 'series') { openCustomSeries({ id: item.id, title: item.name }); return }
 if (action === 'continue') { try { await toggleContinueWatching(media, item) } catch (error) { message.error(error instanceof Error ? error.message : '更新观看列表失败') }; return }
 await nextTick(); videoView.value?.posterAction(item, action) }
const homeActionPending = new Set<string>()
async function serverPosterAction(item: MediaServerCardItem, action: PosterAction) {
 if (action === 'rating') {
  const config = registry.servers.find(server => server.id === item.serverId)
  if (!config) return
  try { openServerPersonalRating(await content.loadItemDetail(config, item.id)) }
  catch (error) { message.error(error instanceof Error ? error.message : String(error)) }
  return
 }
 if (action === 'share') { openMediaShare({ id: item.id, title: item.title, year: item.year }); return }
 if (action === 'watched' || action === 'favorite' || action === 'refresh') {
  const config = registry.servers.find(server => server.id === item.serverId)
  const key = item.serverId + ':' + item.id
  if (!config || homeActionPending.has(key)) return
  homeActionPending.add(key)
  try {
   if (action === 'watched') { await updateMediaServerPlayedState(config, item.id, item.isPlayed === true); item.isPlayed = !item.isPlayed }
   if (action === 'favorite') { await updateMediaServerFavoriteState(config, item.id, item.isFavorite === true, item); item.isFavorite = !item.isFavorite }
   // Refresh only shelves containing the changed item, plus its dependent collections.
   const data = content.currentHomeData(config.id)
   const affected = data.libraries.filter(library => library.items.some(entry => entry.id === item.id))
   await Promise.allSettled([
    ...affected.map(library => requestHomeRow(`${config.id}:${library.id}`, true)),
    ...(action === 'watched' ? [content.loadHomeResume(config, true), content.loadHomeNextUp(config, preferences, true)] : []),
    ...(action === 'favorite' ? serverFavoriteTypes(config).map(type => requestHomeRow(`${config.id}:${serverFavoriteID(type)}`, true)) : [])
   ])
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)) }
  finally { homeActionPending.delete(key) }
  return
 }
 await nextTick(); await serverWorkspace.value?.posterAction(item, action) }
const posterYearAndSeasons = (year: string | number | undefined, count?: number) => [
  year ? String(year) : '', count && count > 0 ? t('mediaLibrary.seasonsCount', { count }) : ''
].filter(Boolean).join(' · ')
const localCard = (item: MediaLibraryItem, landscape = false, playlistName?: string, seriesID?: string): Card => ({ overview: item.overview, certification: item.certification, rating: item.rating, posterMenu: { server: false, tv: item.type === 'tv', homePlaylistItem: !!playlistName, seriesItem: !!seriesID, continuing: media.continueWatching.some(entry => isContinueWatchingMember(entry, item)), watched: isMediaWatched(item, media.watchedItems), disabled: (item.type === 'tv' ? item.seasons?.flatMap(season => season.episodes || []).flatMap(episode => episode.driveFiles || []) || [] : item.driveFiles).some(file => file.driveId !== 'local' && file.userId && file.userId !== 'local') ? [] : ['download'], action: action => {
  if (seriesID && action === 'removeSeriesItem') { saveCustomSeries(loadCustomSeries().map(group => group.id === seriesID ? { ...group, members: group.members.filter(member => member.serverId || member.id !== item.id) } : group)); return }
  if (seriesID && action === 'reorderSeriesItem') { void showCustomSeries(seriesID).then(() => { playlistReordering.value = true }); return }
  if (playlistName && action === 'removePlaylistItem') { media.togglePlaylistItem(playlistName, item.id); return }
  if (playlistName && action === 'reorderPlaylistItem') { showHomeRow('local:playlist:group:' + encodeURIComponent(playlistName)); playlistReordering.value = true; return }
  void localPosterAction(item, action)
} }, key: `local:${item.id}${!seriesPreferences.mergeVersions ? ':file:' + item.driveFiles[0]?.id : ''}`, title: generalPreferences.showFileNames ? item.driveFiles[0]?.name || item.name : item.name, sortValues: { title: item.name, fileName: item.driveFiles[0]?.name, addedAt: item.addedAt, premiereDate: item.releaseDate }, image: landscape ? item.backdropUrl || item.posterUrl : item.posterUrl || item.backdropUrl, subtitle: posterYearAndSeasons(item.year, item.type === 'tv' ? item.seasons?.filter(season => season.seasonNumber > 0).length : undefined), progress: mediaWatchProgressPercent(item), action: () => { if (browseSelection.value && section.value === 'collection') toggleObjectSelection(item); else void openVideo(item) } })
const serverCard = (item: MediaServerCardItem, landscape = false): Card => ({ overview: item.overview, certification: item.officialRating, rating: item.rating, posterMenu: { server: true, tv: item.kind === 'series' || item.kind === 'season', watched: item.isPlayed === true, favorite: item.isFavorite, disabled: item.kind === 'season' ? ['rating', 'playlist'] : ['playlist'], action: action => { void serverPosterAction(item, action) } }, key: `${item.serverId}:${item.id}`, title: item.title, sortValues: item, image: toMsCacheUrl(item.serverId, resolveMediaServerImage(item, landscape ? 'landscape' : 'portrait')), subtitle: item.kind === 'series' ? posterYearAndSeasons(item.year, item.seasonCount) : item.parentTitle || String(item.year || ''), progress: item.progress, action: () => showServer(item.serverId, { kind: 'item-detail', itemId: item.id, title: item.title }) })
const searchRows = computed<Row[]>(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  if (!keyword) return []
  const server = registry.servers.find(server => server.id === searchScope.value)
  if (server) {
    const items = content.currentSearchData(server.id + ':' + query.value.trim()).items
    return [{ key: 'search-movies', title: t('media.movie'), cards: items.filter(item => item.kind === 'movie').map(item => serverCard(item)), more: () => {} }, { key: 'search-tv', title: t('media.tv'), cards: items.filter(item => item.kind === 'series').map(item => serverCard(item)), more: () => {} }].filter(row => row.cards.length)
  }
  const items = searchLibrary.value.filter(item => item.name.toLocaleLowerCase().includes(keyword) && (searchScope.value !== 'local' || hasLocalMedia(item)))
  return [{ key: 'search-movies', title: t('media.movie'), cards: items.filter(item => item.type === 'movie').map(item => localCard(item)), more: () => {} }, { key: 'search-tv', title: t('media.tv'), cards: items.filter(item => item.type === 'tv').map(item => localCard(item)), more: () => {} }, { key: 'search-other', title: t('unified.other'), cards: items.filter(item => item.type !== 'movie' && item.type !== 'tv').map(item => localCard(item)), more: () => {} }].filter(row => row.cards.length)
})
function catalogHomeTitle(root: string, category: string, value = '') {
 const prefix = root === 'tv' ? t('unified.television') : t('media.movie')
 if (value) value = libraryGroupLabel(category, value)
 if (value) return `${prefix} - ${category === 'ratings' && /^\d+$/.test(value) ? t('home.ratingStars', { count: value }) : value}`
 if (category === 'all') return prefix
 if (category === 'recent') return t(root === 'tv' ? 'home.recentTv' : 'home.recentMovies')
 if (category === 'unwatched') return t(root === 'tv' ? 'home.unwatchedTv' : 'home.unwatchedMovies')
 if (root === 'movies' && category === 'genres') return t('unified.movieGenres')
 const label = t(('libraryBrowse.' + category) as Parameters<typeof t>[0])
 return ['mini', 'concerts', 'shorts'].includes(category) ? label : `${prefix} - ${label}`
}
function localRow(items: MediaLibraryItem[], row: Omit<Row, 'cards'>, card: (item: MediaLibraryItem) => Card = localCard): Row {
  const movieList = row.key === libraryHomeId('movies/all')
  const tvList = row.key === libraryHomeId('tv/all')
  const groups: { id: string; title: string; members: MediaLibraryItem[] }[] = []
  if ((movieList && seriesPreferences.showMovies) || (tvList && seriesPreferences.showTV)) {
    if (seriesPreferences.useCustom) for (const group of customSeriesGroups.value) {
      const members = libraryPlaylistMembers(homeLibrary.value, group.members.filter(member => !member.serverId).map(member => member.id))
        .filter(item => item.type === (tvList ? 'tv' : 'movie'))
      if (members.length) groups.push({ id: 'custom:' + group.id, title: group.title, members })
    }
    const customIDs = new Set(groups.flatMap(group => group.members.map(item => item.id)))
    if (movieList) groups.push(...libraryMovieSeries(items).map(group => ({ ...group, members: group.members.filter(item => !customIDs.has(item.id)) })).filter(group => group.members.length))
  }
  const groupedIDs = new Set(groups.flatMap(group => group.members.map(item => item.id)))
  const members = movieVersionItems(items.filter(item => !groupedIDs.has(item.id)))
  const groupCards: Card[] = groups.map(group => ({ key: 'series:' + group.id, title: group.title, image: group.members[0]?.posterUrl,
    subtitle: t('customSeries.memberCount', { count: group.members.length }), action: () => {
      if (seriesPreferences.openDetail) void openVideo(group.members[0])
      else if (group.id.startsWith('custom:')) void showCustomSeries(group.id.slice(7))
      else showCatalog('series/' + group.id)
    } }))
  return { ...row, count: groupCards.length + members.length, get cards() { return [...groupCards, ...members.map(card)] }, preview: () => [...groupCards, ...members.slice(0, 24).map(card)].slice(0, 24) }
}
const localItemsById = computed(() => new Map(homeLibrary.value.map(item => ['local:' + item.id, item])))
type HomeCategoryData = { root: string; category: string; route: string; id: string; members: MediaLibraryItem[]; groups: ReturnType<typeof libraryCategoryGroups>; grouped: boolean }
const homeCategoryData = shallowRef<HomeCategoryData[]>([])
watch([homeLibrary, () => media.watchedItems.slice()], async ([library, watched], _, onCleanup) => {
  let cancelled = false
  onCleanup(() => { cancelled = true })
  const catalog: HomeCategoryData[] = []
  for (const root of ['movies', 'tv']) {
    const items = library.filter(item => root === 'movies' ? item.type === 'movie' : item.type === 'tv')
    for (const category of root === 'movies' ? MOVIE_CATEGORY_IDS : TV_CATEGORY_IDS) {
      // Yield between independent category projections so a large library cannot monopolize input.
      if (items.length) await new Promise<void>(resolve => setTimeout(resolve, 0))
      if (cancelled) return
      const route = `${root}/${category}`, id = libraryHomeId(route)
      const grouped = ['genres', 'ratings', 'years', 'certification', 'resolution', 'networks'].includes(category)
      const members = grouped ? [] : filterLibraryCategory(items, route, item => isMediaWatched(item, watched))
      const groups = grouped ? libraryCategoryGroups(items, category) : []
      catalog.push({ root, category, route, id, members, groups, grouped })
    }
  }
  if (!cancelled) homeCategoryData.value = catalog
}, { immediate: true })
const managedCatalog = computed(() => homeCategoryData.value.map(({ root, category, route, id, members, groups, grouped }) => {
  const title = categoryBookmarkTitle(route)
  const children = groups.map(group => ({ route: libraryGroupRoute(route, group.name), name: group.name,
    row: localRow(group.members, { key: libraryHomeId(libraryGroupRoute(route, group.name)), title: catalogHomeTitle(root, category, group.name),
      more: () => showHomeRow(libraryHomeId(libraryGroupRoute(route, group.name))) }) }))
  const row = grouped ? { key: id, count: children.length, title: catalogHomeTitle(root, category), grouped, landscape: true,
    get cards() { return children.map((child, index) => ({ key: child.row.key, title: child.name, image: groups[index].members.find(item => item.backdropUrl)?.backdropUrl || groups[index].members[0]?.posterUrl, action: () => showCatalog(child.route), contextMenu: (event: MouseEvent) => openCategoryMenu(event, child.route) })) },
    more: () => showCatalog(route) } as Row : localRow(members, { key: id, title: catalogHomeTitle(root, category), more: () => showCatalog(route) })
  return { id, route, title, children, row, grouped }
}))
const localRows = computed<Row[]>(() => {
  const result: Row[] = []
  for (const [route, children] of [['library', LIBRARY_CATEGORY_IDS], ['movies', MOVIE_CATEGORY_IDS.map(id => 'movies/' + id)], ['tv', TV_CATEGORY_IDS.map(id => 'tv/' + id)]] as [string, readonly string[]][]) {
    result.push({ key: libraryHomeId(route), title: categoryBookmarkTitle(route), grouped: true, cards: children.map(child => ({ key: child, title: categoryBookmarkTitle(child), action: () => showCatalog(child), contextMenu: event => openCategoryMenu(event, child) })), more: () => showCatalog(route) })
  }
  result.push({ key: 'recent', title: t('media.recentlyAdded'), cards: media.recentlyAdded.slice(0, 24).map(item => localCard(item)), more: () => { void showCategory('recently-added') } })
  result.push(localRow(dailyRecommendations.value, { key: 'local:daily', title: t('unified.dailyPicks'), more: () => showHomeRow('local:daily') }))
  const replacedIDs = new Set(managedCatalog.value.map(item => item.id))
  const obsoleteIDs = new Set(['local:top-rated', 'local:animation', 'local:documentary', 'local:favorites'])
  for (const category of categories.value.filter(item => item.key !== 'recently-added' && !replacedIDs.has('local:' + item.key) && !obsoleteIDs.has('local:' + item.key))) {
    const grouped = category.key === 'genres' ? media.genreCategories : category.key === 'ratings' ? media.ratingCategories : category.key === 'years' ? media.yearGroups
      : category.key === 'playlist' ? Object.entries(media.playlists).map(([name, ids]) => ({ name, items: libraryPlaylistMembers(homeLibrary.value, ids) })) : undefined
    if (grouped) {
      const cards: Card[] = grouped.map(group => {
        const key = `local:${category.key}:group:${encodeURIComponent(group.name)}`
        result.push({ key, title: group.name, count: group.items.length, get cards() { return group.items.map(item => {
          const card = localCard(item, false, category.key === 'playlist' ? group.name : undefined)
          const episode = item.seasons?.[0]?.episodes?.[0]
          return episode ? { ...card, title: item.name, subtitle: `第 ${episode.seasonNumber} 季 · 第 ${episode.episodeNumber} 集` } : card
        }) }, preview: () => group.items.slice(0, 24).map(item => localCard(item, false, category.key === 'playlist' ? group.name : undefined)), more: () => showHomeRow(key) })
        const route = `${category.key}/${encodeURIComponent(group.name)}`
        return { key, title: homePreferences.titles[key] || group.name, image: objectCover(route, group.items), subtitle: t('customSeries.memberCount', { count: group.items.length }), action: () => showHomeRow(key), contextMenu: (event: MouseEvent) => openCategoryMenu(event, route) }
      }).filter(card => !homePreferences.hidden.includes(card.key))
      result.push({ key: `local:${category.key}`, title: category.title, cards, grouped: true, landscape: true, more: () => category.key === 'playlist' ? showCatalog('playlist') : void showCategory(category.key) })
      continue
    }
    const items = category.key === 'movies' ? homeLibrary.value.filter(item => item.type === 'movie') : category.key === 'tv' ? homeLibrary.value.filter(item => item.type === 'tv') : category.key === 'unmatched' ? homeLibrary.value.filter(item => item.type === 'unmatched')
      : category.key === 'unwatched' ? homeLibrary.value.filter(item => !isMediaWatched(item, media.watchedItems))
      : category.key === 'favorites' ? homeLibrary.value.filter(item => media.isFavorite(item.id))
      : category.key === 'animation' ? homeLibrary.value.filter(item => item.genres.some(genre => /动画|动漫|Animation|^16$/i.test(genre)))
      : category.key === 'documentary' ? homeLibrary.value.filter(item => item.genres.some(genre => /纪录|Documentary|^99$/i.test(genre)))
      : category.key === 'ratings' ? media.topRated : homeLibrary.value.filter(item => item.type === 'movie')
    result.push({ key: `local:${category.key}`, title: category.title, cards: items.slice(0, 24).map(item => localCard(item)), more: () => { void showCategory(category.key) } })
  }
  result.push({ key: 'music', title: t('nav.music'), cards: music.recentlyAdded.slice(0, 20).map(item => ({ key: item.id, title: item.title || item.file_name, image: item.cover_url || item.thumbnail, subtitle: item.artist, action: () => { void openMusic(item) } })), more: () => { app.mediaLibrarySection = 'music' } })
  result.push({ key: 'books', title: t('nav.books'), cards: books.recentlyAdded.slice(0, 20).map(item => ({ key: item.id, title: item.title || item.file_name, image: item.cover_url || item.thumbnail, subtitle: item.author, action: () => { void openBook(item) } })), more: () => { app.mediaLibrarySection = 'book' } })
  const seriesCards: Card[] = []
  for (const group of libraryMovieSeries(homeLibrary.value)) {
    const key = 'catalog:series/' + group.id
    result.push({ key, title: group.title, count: group.members.length, get cards() { return group.members.map(item => localCard(item)) }, preview: () => group.members.slice(0, 24).map(item => localCard(item)), more: () => showCatalog('series/' + group.id) })
    seriesCards.push({ key, title: group.title, image: group.members[0]?.posterUrl, subtitle: t('customSeries.memberCount', { count: group.members.length }), action: () => { if (seriesPreferences.openDetail && group.members[0]) void openVideo(group.members[0]); else showCatalog('series/' + group.id) }, contextMenu: (event: MouseEvent) => openCategoryMenu(event, 'series/' + group.id) })
  }
  for (const group of (seriesPreferences.useCustom ? customSeriesGroups.value : [])) {
    const members = libraryPlaylistMembers(homeLibrary.value, group.members.filter(member => !member.serverId).map(member => member.id))
    const key = 'custom-series:' + group.id
    result.push({ key, title: group.title, count: members.length, get cards() { return members.map(item => localCard(item)) }, preview: () => members.slice(0, 24).map(item => localCard(item)), more: () => { void showCustomSeries(group.id) } })
    seriesCards.push({ key, title: group.title, image: members[0]?.posterUrl, subtitle: t('customSeries.memberCount', { count: group.members.length }), action: () => { void showCustomSeries(group.id) }, contextMenu: (event: MouseEvent) => openCategoryMenu(event, 'custom-series/' + group.id) })
  }
  result.push({ key: 'custom-series', title: t('unified.series'), cards: seriesCards, more: () => showCatalog('series') })
  const replaced = new Set(managedCatalog.value.map(item => item.id))
  const obsolete = new Set(['local:top-rated', 'local:animation', 'local:documentary', 'local:favorites'])
  return [...result.filter(row => !replaced.has(row.key) && !obsolete.has(row.key) && ![...replaced].some(id => row.key.startsWith(id + ':group:'))), ...managedCatalog.value.flatMap(item => [item.row, ...item.children.map(child => child.row)])]
})
const remoteRows = computed<Row[]>(() => {
  const result: Row[] = []
  for (const server of registry.servers) {
    const data = content.currentHomeData(server.id)
    for (const type of serverFavoriteTypes(server)) {
      const libraryId = serverFavoriteID(type)
      const key = `${server.id}:${libraryId}`
      const title = `${t(`serverFavorites.${type}`)} - ${server.name}`
      result.push({ key, title, loading: !!content.homeSectionLoading[key] || (!(key in content.homeFavoriteItems) && !content.homeSectionError[key]), error: content.homeSectionError[key], retry: () => { void requestHomeRow(key, true) }, cards: (content.homeFavoriteItems[key] || []).slice(0, 24).map(item => ({ ...serverCard(item),
        action: () => showServer(server.id, ['BoxSet', 'Playlist'].includes(item.rawType || '')
          ? { kind: 'library-page', libraryId: `server-container:${item.id}`, title: item.title }
          : { kind: 'item-detail', itemId: item.id, title: item.title }) })),
        more: () => showServer(server.id, { kind: 'library-page', libraryId, title: homePreferences.titles[key] ? `${homePreferences.titles[key]} - ${server.name}` : title }) })
    }
    result.push({ key: `${server.id}:next`, loading: !!content.homeSectionLoading[`${server.id}:nextup`] || (!content.homeSectionLoaded[`${server.id}:nextup`] && !content.homeSectionError[`${server.id}:nextup`]), error: content.homeSectionError[`${server.id}:nextup`], retry: () => { void requestHomeRow(`${server.id}:next`, true) }, title: `${t('unified.nextUp')} · ${server.name}`, cards: data.nextUp.map(item => serverCard(item)), more: () => showServer(server.id, { kind: 'collection-page', collectionId: 'home:nextup', title: t('unified.nextUp') }) })
    for (const library of data.libraries) {
      const sectionKey = `${server.id}:library:${library.id}`
      const loading = !!content.homeLibrarySectionLoading[sectionKey] || (!library.attempted && !errors.value[server.id] && !content.homeSectionError[sectionKey])
      const error = content.homeSectionError[sectionKey] || (!library.attempted ? errors.value[server.id] : undefined)
      result.push({ key: `${server.id}:${library.id}`, loading, error, retry: () => retryHomeLibrary(server.id, library.id), title: `${t('media.recentlyAdded')} ${library.title} · ${server.name}`, cards: library.items.map(item => serverCard(item)), more: () => showServer(server.id, { kind: 'library-page', libraryId: library.id, title: library.title }) })
    }
    if (!data.libraries.length) result.push({ key: `${server.id}:directory`, title: server.name, cards: [], loading: !!content.homeSectionLoading[`${server.id}:catalog`] || (!content.homeCatalogLoaded[server.id] && !errors.value[server.id]), error: errors.value[server.id], retry: () => retryHomeDirectory(server.id), more: () => showServer(server.id, { kind: 'home' }) })
  }
  return result
})
const resumeRows = computed<Row[]>(() => {
  const resume = (generalPreferences.recentlyPlayed ? media.continueWatching : []).filter(item => mediaWatchProgressPercent(item) < 100).map(item => ({ ...localCard(item, true), action: () => { void videoView.value?.resumeMedia(item) } }))
  for (const server of registry.servers.filter(server => !homePreferences.hidden.includes('source:server:' + server.id))) resume.push(...content.currentHomeData(server.id).resume.map(item => ({ ...serverCard(item, true), action: () => { void serverPosterAction(item, 'play') } })))
  if (resume.length) return [{ key: 'resume', title: t('media.continueWatching'), cards: resume, landscape: true, more: () => showHomeRow('resume') }]
  return []
})
const rawRows = computed<Row[]>(() => [...resumeRows.value, ...localRows.value, ...remoteRows.value])
const homeItems = computed<HomeManagementItem[]>(() => withFixedHomeMenus([
  { id: 'sources', title: t('unified.sources'), sourceId: 'local', available: true },
  { id: 'custom-series', title: t('unified.series'), sourceId: 'local', available: true },
  ...rawRows.value.filter(row => row.key !== 'resume').map(row => {
    const server = registry.servers.find(server => row.key.startsWith(`${server.id}:`))
    const fixedTitle = undefined
    return { id: row.key, title: fixedTitle || (server ? row.title.replace(` · ${server.name}`, '').replace(` - ${server.name}`, '') : row.title), sourceId: server?.id || 'local', sourceTitle: server?.name, available: true, child: row.key.includes(':group:'), optIn: row.key.includes(':server-favorites:') || row.key.startsWith('catalog:') || row.key.startsWith('custom-series:') || row.key.startsWith('local:playlist:group:') }
  }),
  ...undiscoveredHomeIDs(homePreferences.order, rawRows.value.map(row => row.key)).map(id => {
    const route = categoryRouteForHomeId(id)
    return { id, title: homePreferences.titles[id] || (route.startsWith('home-entry/') ? id : categoryBookmarkTitle(route)), sourceId: 'local', available: true, optIn: true }
  }),
  ...sourceCards.value.map(card => ({ id: card.key, title: card.title, sourceId: 'local', available: true, child: true }))
]))
const sourceCards = computed<Card[]>(() => [
  { key: 'source:video', title: t('nav.video'), action: () => showCatalog('library') },
  { key: 'source:music', title: t('nav.music'), action: () => { app.mediaLibrarySection = 'music' } },
  { key: 'source:book', title: t('nav.books'), action: () => { app.mediaLibrarySection = 'book' } },
  ...registry.servers.map(server => ({ key: `source:server:${server.id}`, title: server.name, action: () => showServer(server.id) })),
  ...media.folders.filter(folder => (!isConnectedRootFolder(folder) || folder.isDriveRootFavorite) && folder.isFavorite !== false).map(folder => ({ key: `source:folder:${folder.id}`, title: folder.name, action: () => { void showFolder(folder) } }))
])
const favoriteShortcuts = computed(() => [
  { key: 'library', title: t('media.library'), icon: GalleryVerticalEnd, action: () => showCatalog() },
  { key: 'movies', title: t('media.movie'), icon: Clapperboard, action: () => showCatalog('movies') },
  { key: 'tv', title: t('unified.television'), icon: Tv, action: () => showCatalog('tv') },
  { key: 'other', title: t('unified.other'), icon: FilePlay, action: () => showCatalog('other') },
  ...libraryBookmarks.favorites.filter(key => !['library', 'movies', 'tv', 'other', 'music', 'books'].includes(key)).map(key => ({ key, title: categoryBookmarkTitle(key), icon: Star, action: () => showCatalog(key) }))
].filter(card => libraryBookmarks.favorites.includes(card.key)).map(card => ({ ...card, title: libraryBookmarks.titles[card.key] || card.title })))
function categoryBookmarkTitle(route: string): string {
 const [root, sub, value] = route.split('/')
 if (root === 'home-entry') return homeItems.value.find(item => item.id === decodeURIComponent(sub))?.title || decodeURIComponent(sub)
 if (root === 'playlist' && sub) return decodeURIComponent(sub)
 if (root === 'series' && sub) return libraryMovieSeries(homeLibrary.value).find(group => group.id === sub)?.title || t('unified.series')
 if (root === 'custom-series' && sub) return customSeriesGroups.value.find(group => group.id === sub)?.title || t('unified.series')
 if (value) {
  const name = libraryGroupLabel(sub, decodeURIComponent(value))
  if (root === 'movies') return `${t('media.movie')} - ${name}`
  if (root === 'tv') return `${t('media.tv')} - ${name}`
  return name
 }
 if (sub === 'all') return root === 'movies' ? t('unified.allMovies') : t('unified.allTv')
 if (sub === 'recent' || root === 'recent') return t('media.recentlyAdded')
 if (sub === 'unwatched' || root === 'unwatched') return t('media.unwatched')
 if (sub && sub !== 'movies') return t(('libraryBrowse.' + sub) as Parameters<typeof t>[0])
 return ({ library: t('media.library'), playlist: t('media.playlist'), series: t('unified.series'), daily: t('unified.dailyPicks'), movies: t('media.movie'), tv: t('media.tv'), other: t('unified.other'), music: t('nav.music'), books: t('nav.books') } as Record<string, string>)[root] || root
}
function categoryPlacementTitle(route: string) {
 if (route.startsWith('home-entry/')) {
  const key = decodeURIComponent(route.slice('home-entry/'.length))
  return rawRows.value.find(row => row.key === key)?.title || homePreferences.titles[key] || key
 }
 const title = categoryBookmarkTitle(route)
 const [root, sub, value] = route.split('/')
 if ((root === 'movies' || root === 'tv') && sub) return catalogHomeTitle(root, sub, value ? decodeURIComponent(value) : '')
 if (root === 'recent' || root === 'unwatched') return catalogHomeTitle('movies', root)
 return title
}
function favoriteCardClasses(key: string) {
 const root = key.split('/')[0]
 return {
  'favorite-movies': root === 'movies' || root === 'series',
  'favorite-playlist': root === 'playlist',
  'favorite-tv': root === 'tv',
  'favorite-other': root === 'other',
  'favorite-server': key.startsWith('source:server:'),
  'favorite-folder': key.startsWith('source:folder:') || key.startsWith('root:'),
  'favorite-music': root === 'music',
  'favorite-book': root === 'books'
 }
}
const librarySidebarCards = computed(() => LIBRARY_SIDEBAR_ROUTES.map(key => ({
  key, icon: librarySidebarCategoryIcon(key), title: homePreferences.titles[libraryHomeId(key)] || categoryBookmarkTitle(key), action: () => showCatalog(key)
})))
const libraryShortcutCards = computed(() => LIBRARY_CATEGORY_IDS.map(key => ({
  key, icon: libraryCategoryIcon(key), title: categoryBookmarkTitle(key), action: () => showCatalog(key)
})))
const favoriteReordering = ref(false)
const draggedFavoriteKey = ref('')
const favoriteCards = computed(() => [
 ...folderFavoriteCards.value,
 ...libraryBookmarks.favorites.filter(key => !(isIndependentCategoryRoute(key) && sourceOverrides.value[key]?.hiddenOnHome)).map(key => ({ key, title: libraryBookmarks.titles[key] || categoryBookmarkTitle(key), action: () => showCatalog(key) })),
 ...connectedFileRoots.value.filter(root => rootIsFavorite(root) && !media.folders.some(folder => folder.isDriveRootFavorite && rootFolderMatches(root, folder))).map(root => ({ key: `root:${root.value}`, title: sourceOverrides.value[`root:${root.value}`]?.name || root.label, action: () => { void openConnectedFileRoot(root) } })),
 ...visibleSourceCards.value.filter(card => card.key.startsWith('source:server:') || (card.key.startsWith('source:folder:') && media.folders.some(folder => `source:folder:${folder.id}` === card.key && (folder.isFavorite || folder.isDriveRootFavorite || folder.id === `${folder.driveId}_${folder.fileId}`))))
])
const favoritesSortByTitle = ref(localStorage.getItem('boxplayer:favorite-cards-sort-title') === 'true')
watch(favoritesSortByTitle, value => localStorage.setItem('boxplayer:favorite-cards-sort-title', String(value)))
const favoritePageCards = computed(() => {
 const cards = placement.orderFavoriteCards(favoriteCards.value)
 return favoritesSortByTitle.value ? [...cards].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })) : cards
})
function hideFavoritesShelf() {
 void placement.applyHome({ order: [...homePreferences.order], hidden: [...new Set([...homePreferences.hidden, 'sources'])], titles: { ...homePreferences.titles } })
}
async function startFavoriteReordering() {
 categoryMenu.value = undefined
 if (!(isCatalogPage.value && selectedHomeRowKey.value === 'catalog:favorites')) {
  showCatalog('favorites')
  await nextTick()
 }
 favoritesSortByTitle.value = false
 favoriteReordering.value = true
}
function finishFavoriteReordering() { favoriteReordering.value = false; draggedFavoriteKey.value = '' }
function startFavoriteDrag(event: DragEvent, key: string) {
 if (!favoriteReordering.value) { event.preventDefault(); return }
 draggedFavoriteKey.value = key
 event.dataTransfer?.setData('text/plain', key)
 if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function reorderFavoriteCard(targetKey: string, finish = false) {
 const sourceKey = draggedFavoriteKey.value
 if (!sourceKey || sourceKey === targetKey) return
 const order = favoritePageCards.value.map(card => card.key)
 const from = order.indexOf(sourceKey); const to = order.indexOf(targetKey)
 if (from < 0 || to < 0) return
 order.splice(to, 0, order.splice(from, 1)[0])
 void placement.reorderFavorites(order)
 if (finish) draggedFavoriteKey.value = ''
}
function dropFavoriteCard(targetKey: string) { reorderFavoriteCard(targetKey, true) }
function startFavoritePointer(event: PointerEvent, key: string) {
 if (!favoriteReordering.value || event.button !== 0) return
 draggedFavoriteKey.value = key
 ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
 event.preventDefault()
}
function moveFavoritePointer(event: PointerEvent) {
 if (!favoriteReordering.value || !draggedFavoriteKey.value) return
 const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-favorite-key]')
 const targetKey = target?.dataset.favoriteKey
 if (targetKey) reorderFavoriteCard(targetKey)
}
function finishFavoritePointer(event: PointerEvent) {
 const element = event.currentTarget as HTMLElement
 if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
 draggedFavoriteKey.value = ''
}
function favoriteSourceMenuKey(key: string) { return key.startsWith('source:') ? key.slice('source:'.length) : key }
function openFolderFavoriteMenu(event: MouseEvent, key: string) {
 const card = folderFavoriteCards.value.find(card => card.key === key)
 if (!card) return
 serverFolderMenu.value = { item: card.item, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 240)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 450)) }
}
function openFileCardMenu(event: MouseEvent, key: string) {
 if (key.startsWith('server-folder:')) openFolderFavoriteMenu(event, key)
 else if (key.startsWith('server-category:')) openCategoryMenu(event, key.slice('server-category:'.length), true)
 else void openSourceMenu(event, key)
}
function openFavoriteCardMenu(event: MouseEvent, key: string) {
 if (key.startsWith('server-folder:')) { openFolderFavoriteMenu(event, key); return }
 if (key.startsWith('root:') || key.startsWith('source:server:') || key.startsWith('source:folder:')) openSourceMenu(event, favoriteSourceMenuKey(key), true)
 else openCategoryMenu(event, key, true)
}
const visibleSourceCards = computed(() => sourceCards.value.filter(card => !homePreferences.hidden.includes(card.key) && !sourceOverrides.value[card.key.replace(/^source:/, '')]?.hiddenOnHome))
const isLibrarySettingsPage = computed(() => section.value === 'collection' && selectedHomeRowKey.value === 'library-index')
const libraryStatistics = computed(() => {
 const serverStats = registry.servers.filter(server => server.libraryMode !== false).map(server => content.currentHomeData(server.id).statistics)
 return [{ label: t('media.movie'), count: media.mediaTypeCounts.movie + serverStats.reduce((sum, stat) => sum + (stat?.movieCount || 0), 0) }, { label: t('unified.television'), count: media.mediaTypeCounts.tv + serverStats.reduce((sum, stat) => sum + (stat?.seriesCount || 0), 0) }, { label: t('unified.other'), count: media.mediaTypeCounts.unmatched }]
})
const librarySourceGroups = computed(() => {
 const localFolders = media.folders.filter(folder => folder.driveId === 'local' || folder.userId === 'local')
 const cloudFolders = media.folders.filter(folder => !localFolders.includes(folder))
 return [
  ...(localFolders.length ? [{ key: 'local', title: t('librarySettings.localFolders'), sources: localFolders.map(folder => ({ key: 'source:folder:' + folder.id, title: folder.name })) }] : []),
  ...(cloudFolders.length ? [{ key: 'cloud', title: t('librarySettings.cloudFolders'), sources: cloudFolders.map(folder => ({ key: 'source:folder:' + folder.id, title: folder.name })) }] : []),
  ...registry.servers.map(server => ({ key: server.id, title: server.name, sources: [{ key: 'source:server:' + server.id, title: t('librarySettings.showOnHome') }] }))
 ]
})
function toggleLibrarySource(key: string, visible: boolean) {
 placement.applyHome({ order: [...homePreferences.order], titles: { ...homePreferences.titles }, hidden: visible ? homePreferences.hidden.filter(id => id !== key) : [...new Set([...homePreferences.hidden, key])] })
}
const libraryScanning = ref(false)
async function rescanLibraryFolders() {
 if (libraryScanning.value || metadataRefreshing.value || media.isScanning) return
 libraryScanning.value = true
 try {
  await media.flushPersistence()
  const { folders } = await DB.getMediaLibrary()
  const failures: string[] = []
  // Stored scan sources include older favorites without an explicit isFavorite flag.
  for (const folder of folders.filter(folder => folder.isFavorite !== false && folder.driveId !== 'local' && folder.userId !== 'local')) {
   try {
    await MediaScanner.getInstance().scanFolder({ drive_id: folder.driveId, file_id: folder.fileId,
     user_id: folder.userId, name: folder.name, path: folder.path, isDir: true,
     parent_file_id: '', size: 0 } as unknown as IAliGetFileModel,
     folder.driveServerId || folder.driveId, { incremental: false, silent: true })
   } catch (error) { failures.push(`${folder.name}: ${String(error)}`) }
  }
  await media.hydrate()
  await loadHomeLibrary()
  if (failures.length) message.error(failures.join('\n'))
 } catch (error) { message.error(String(error)) }
 finally { libraryScanning.value = false }
}
const metadataRefreshing = ref(false)
async function refreshLibraryMetadata() {
 if (metadataRefreshing.value || libraryScanning.value || media.isScanning) return
 metadataRefreshing.value = true
 try { await nextTick(); await videoView.value?.refreshMetadata(); await media.hydrate(); await loadHomeLibrary() }
 finally { metadataRefreshing.value = false }
}
const visibleHomeMenu = computed(() => visibleHomeItems(homeItems.value, homePreferences).map(item => ({ ...item, title: homeMenuTitle(item, homePreferences) })))
const resolvedCatalogTitle = computed(() => {
 const route = selectedHomeRowKey.value.slice('catalog:'.length)
 const [root, category, value] = route.split('/')
 const id = libraryHomeId(route)
 const item = homeItems.value.find(item => item.id === id)
 if (item) return homeMenuTitle(item, homePreferences)
 if (homePreferences.titles[id]) return homePreferences.titles[id]
 if (['movies', 'tv'].includes(root) && category) return catalogHomeTitle(root, category, value ? decodeURIComponent(value) : '')
 return catalogTitle.value
})
const managementGroups = computed<HomeManagementGroup[]>(() => {
  const byId = new Map(homeItems.value.map(item => [item.id, item]))
  const node = (id: string): HomeManagementNode | undefined => {
    const item = byId.get(id)
    return item ? { id, title: item.title, item, children: nodesForGroup(id) } : undefined
  }
  const nodesForGroup = (id: string): HomeManagementNode[] => homeItems.value.filter(item => id === 'custom-series'
    ? item.id.startsWith('custom-series:') || item.id.startsWith('catalog:series/')
    : item.id.startsWith(`${id}:group:`)).map(item => ({ id: item.id, title: item.title, item }))
  const nodes = (ids: string[]) => ids.map(node).filter((item): item is HomeManagementNode => !!item)
  const favorites = node('sources')!
  const localNodes: HomeManagementNode[] = [favorites, ...nodes(['local:playlist', 'custom-series', 'recent', 'local:unwatched', 'local:daily'])]
  for (const root of ['movies', 'tv']) localNodes.push({ id: 'management:' + root, title: root === 'movies' ? t('media.movie') : t('unified.television'), children: managedCatalog.value.filter(entry => entry.route.startsWith(root + '/')).flatMap(entry => {
   const item = byId.get(entry.id)
   return item ? [{ id: item.id, title: entry.title, item, expandable: entry.grouped, children: entry.children.flatMap(child => { const item = byId.get(child.row.key); return item ? [{ id: item.id, title: child.name, item }] : [] }) }] : []
  }) })
  localNodes.push(...nodes(['local:unmatched', 'music', 'books']))
  return [
    ...registry.servers.map(server => ({ id: server.id, title: server.name, nodes: [
      ...nodes(homeItems.value.filter(item => item.sourceId === server.id && !item.child && !item.id.includes(':server-favorites:')).map(item => item.id)),
      ...(serverFavoriteTypes(server).length ? [{ id: `${server.id}:favorite-menu`, title: t('unified.sources'), children: nodes(serverFavoriteTypes(server).map(type => `${server.id}:${serverFavoriteID(type)}`)) }] : [])
    ] })),
    { id: 'local', title: t('media.library'), nodes: localNodes }
  ]
})
const homeIsEmpty = computed(() => {
  const navigationRows = ['library', 'movies', 'tv'].map(libraryHomeId)
  if (rows.value.some(row => row.loading || row.error || (row.cards.length && !navigationRows.includes(row.key)))) return false
  const hasNoSourcesOrMedia = !registry.servers.length && !media.mediaItems.length
    && !media.folders.some(folder => folder.isFavorite !== false) && !serverFolderFavorites.value.length
  return !homeLayout.value.length || hasNoSourcesOrMedia
})
const homeLayout = computed(() => visibleHomeSections(homeItems.value, homePreferences).map(item => ({ item: { ...item, title: homeMenuTitle(item, homePreferences) }, row: rows.value.find(row => row.key === item.id) })).filter(entry => entry.item.id === 'sources' ? visibleSourceCards.value.length > 0 : !!entry.row && (!!(entry.row.count ?? entry.row.cards.length) || !!entry.row.loading || !!entry.row.error)))
const rows = computed<Row[]>(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  const menu = new Map(visibleHomeMenu.value.map(item => [item.id, item]))
  return rawRows.value.filter(row => (row.key === 'resume' || menu.has(row.key)) && !registry.servers.some(server => row.key.startsWith(server.id + ':') && homePreferences.hidden.includes('source:server:' + server.id))).map(row => {
    // Card conversion (including episode menus) runs only when the viewport slot renders.
    const preview = () => (row.preview ? row.preview() : row.cards.slice(0, 24)).filter(card => {
      const item = localItemsById.value.get(card.key)
      return (!item?.folderId || !homePreferences.hidden.includes('source:folder:' + item.folderId))
        && (!keyword || card.title.toLocaleLowerCase().includes(keyword))
    })
    const needsFilter = !!keyword || homePreferences.hidden.some(id => id.startsWith('source:folder:'))
    const count = needsFilter ? preview().length : Math.min(row.count ?? row.cards.length, 24)
    return { key: row.key, title: menu.get(row.key)?.title || row.title, count, get cards() { return preview() }, landscape: row.landscape,
      grouped: row.grouped, loading: row.loading, error: row.error, retry: row.retry, more: row.more }
  }).filter(row => row.count || row.loading || row.error)
})

const selectedHomeRow = computed(() => {
 if (selectedHomeRowKey.value.startsWith('custom-series:')) return { key: selectedHomeRowKey.value, title: customSeriesGroups.value.find(group => group.id === selectedHomeRowKey.value.slice('custom-series:'.length))?.title || t('unified.series'), cards: [...customSeriesCards.value].sort((a, b) => compareMediaBrowseValues(a.sortValues || a, b.sortValues || b, browseSort.value, browseSortDescending.value)), more: () => {} }

  const row = rawRows.value.find(row => row.key === selectedHomeRowKey.value)
  const localIds = new Set(homeLibrary.value.filter(hasLocalMedia).map(item => `local:${item.id}`))
  const cards = (localOnly.value ? row?.cards.filter(card => localIds.has(card.key)) : row?.cards) || []
  const sortedCards = ['local:daily', 'local:top-rated', 'local:playlist', 'custom-series'].includes(selectedHomeRowKey.value) || selectedHomeRowKey.value.startsWith('local:playlist:group:') ? cards : [...cards].sort((a, b) => compareMediaBrowseValues(a.sortValues || a, b.sortValues || b, browseSort.value, browseSortDescending.value))
  return row ? { ...row, cards: sortedCards, title: homePreferences.titles[row.key] || row.title } : undefined
})
function homeNavigationIcon(id: string) {
  if (id === 'recent' || id.includes(':recent') || id.includes(':next')) return History
  if (id === 'local:daily') return CalendarDays
  if (id === 'local:unwatched') return EyeOff
  if (id === 'local:top-rated' || id === 'sources' || id === 'local:favorites') return Star
  if (id === 'local:genres') return Drama
  if (id === 'local:movies' || id === 'local:animation' || id === 'local:documentary') return Film
  if (id === 'local:tv') return TvMinimal
  if (id === 'local:unmatched') return Play
  if (id === 'local:playlist') return List
  if (id.startsWith('custom-series')) return GalleryVerticalEnd
  if (id === 'music') return Music
  if (id === 'books') return BookOpen
  return Folder
}
function openHomeMenu(id: string) {
  if (id === 'custom-series') { showCatalog('series'); return }
  if (id === 'sources') { showCatalog('favorites'); return }
  rawRows.value.find(row => row.key === id)?.more()
}
function isHomeMenuSelected(id: string) {
  if (id === 'custom-series') return isCatalogPage.value && selectedHomeRowKey.value === 'catalog:series'
  if (id === 'sources') return isCatalogPage.value && selectedHomeRowKey.value === 'catalog:favorites'
  if (section.value === 'music') return id === 'music'
  if (section.value === 'collection') return id === selectedHomeRowKey.value
  if (section.value !== 'video' || selectedFolder.value) return false
  return id === (selectedCategory.value === 'recently-added' ? 'recent' : `local:${selectedCategory.value}`)
}

const homeShelfSnapshots = new Map<string, { height?: number; scrollLeft?: number }>()
function homeShelfSnapshot(id: string) {
  let snapshot = homeShelfSnapshots.get(id)
  if (!snapshot) { snapshot = {}; homeShelfSnapshots.set(id, snapshot) }
  return snapshot
}
const homeScrollTop = ref(0)
const homeElement = ref<HTMLElement>()
watch(section, async next => { if (next === 'home') { await nextTick(); if (homeElement.value) homeElement.value.scrollTop = homeScrollTop.value } })
let refreshQueued = false
let refreshQueuedForce = false
let disposed = false
let lastPlaybackSnapshot = ''
function syncPlayback() {
  void loadConnectedFileRoots().catch(() => undefined)
  try {
    const raw = localStorage.getItem('MediaLibrary_ContinueWatching') || '[]'
    if (raw === lastPlaybackSnapshot) return
    const items = JSON.parse(raw)
    if (!Array.isArray(items)) return
    lastPlaybackSnapshot = raw
    media.continueWatching = items.filter(item => item && typeof item.id === 'string').map(item => ({
      ...item,
      addedAt: new Date(item.addedAt),
      lastWatched: item.lastWatched ? new Date(item.lastWatched) : undefined,
      watchProgress: Number(item.watchProgress) || 0
    }))
  } catch { /* Keep the current library when a stored snapshot is unavailable. */ }
}
function handleStorage(event: StorageEvent) {
  if (event.key === 'MediaLibrary_ContinueWatching' || event.key === null) syncPlayback()
}
async function refresh(force = true) {
  homeRequests.reconcile(registry.servers.map(server => ({ ...server, baseUrl: server.backupAddresses?.[server.selectedLineName || ''] || server.baseUrl })))
  if (refreshing.value) { refreshQueued = true; refreshQueuedForce ||= force; return }
  refreshing.value = true
  // Hidden empty rows have no viewport observer. Revalidate their snapshots on refresh
  // without changing catalog membership or loading unvisited offscreen categories.
  const emptyRemoteRowIDs = remoteRows.value.filter(row => !row.cards.length && !row.loading && !row.error).map(row => row.key)
  errors.value = {}
  try {
    syncPlayback()
    if (force) await media.hydrate()
    void loadLibraryRecommendations()
    await Promise.allSettled([
      music.loadFromDB(), books.loadFromDB(), loadHomeLibrary(),
      loadBounded(registry.servers, 2, async server => {
      if (disposed || !registry.servers.includes(server)) return
      const config = { ...server, baseUrl: server.backupAddresses?.[server.selectedLineName || ''] || server.baseUrl }
      try {
        const [, directory] = await Promise.allSettled([content.loadHomeResume(config, force), content.loadHomeShell(config, force)])
        if (directory.status === 'rejected') throw directory.reason
        // Shelf requests are driven by the viewport, independently of discovery.
        const configuredIDs = new Set(visibleHomeSections(homeItems.value, homePreferences).map(item => item.id))
        for (const id of new Set([...visibleRemoteRows, ...emptyRemoteRowIDs])) {
          if (id.startsWith(server.id + ':') && configuredIDs.has(id)) void requestHomeRow(id, force)
        }

      } catch (error) { errors.value[server.id] = error instanceof Error ? error.message : String(error) }
    })])
  } finally {
    refreshing.value = false
    if (refreshQueued && !disposed) { const force = refreshQueuedForce; refreshQueued = false; refreshQueuedForce = false; void refresh(force) }
  }
}
async function retryHomeLibrary(serverId: string, libraryId: string) {
  const server = registry.servers.find(item => item.id === serverId)
  if (!server || content.homeLibrarySectionLoading[`${serverId}:library:${libraryId}`]) return
  try {
    await content.loadHomeLibrarySection({ ...server, baseUrl: server.backupAddresses?.[server.selectedLineName || ''] || server.baseUrl }, libraryId, true)
  } catch { /* The store retains the category error for retry. */ }
}
const visibleRemoteRows = new Set<string>()
const rowRequests = new Map<string, Promise<unknown>>()
function homeRowVisibility(id: string, visible: boolean) {
  if (!visible) { visibleRemoteRows.delete(id); return }
  visibleRemoteRows.add(id)
  void requestHomeRow(id, false)
}
async function retryHomeDirectory(serverId: string) {
  const server = registry.servers.find(item => item.id === serverId)
  if (!server) return
  try {
    await content.loadHomeShell({ ...server, baseUrl: server.backupAddresses?.[server.selectedLineName || ''] || server.baseUrl }, true)
    delete errors.value[serverId]
  } catch (error) { errors.value[serverId] = error instanceof Error ? error.message : String(error) }
}
function requestHomeRow(id: string, force: boolean): Promise<unknown> {
  const server = registry.servers.find(item => id.startsWith(item.id + ':'))
  if (!server || homePreferences.hidden.includes('source:server:' + server.id)) return Promise.resolve()
  const config = { ...server, baseUrl: server.backupAddresses?.[server.selectedLineName || ''] || server.baseUrl }
  const requestKey = JSON.stringify([id, config.type, config.baseUrl, config.userId, config.accessToken])
  if (rowRequests.has(requestKey)) return rowRequests.get(requestKey)!
  const libraryId = id.slice(server.id.length + 1)
  if (libraryId === 'directory') return Promise.resolve()
  const library = content.currentHomeData(server.id).libraries.find(item => item.id === libraryId)
  const errorKey = library ? `${server.id}:library:${libraryId}` : libraryId === 'next' ? `${server.id}:nextup` : id
  if (!force && content.homeSectionError[errorKey]) return Promise.resolve()
  const request = library ? content.loadHomeLibrarySection(config, libraryId, force)
    : libraryId === 'next' ? content.loadHomeNextUp(config, preferences, force)
    : libraryId.startsWith('server-favorites:') ? content.loadHomeFavorites(config, libraryId, force) : Promise.resolve()
  rowRequests.set(requestKey, request)
  void request.catch(() => undefined).finally(() => rowRequests.delete(requestKey))
  return request.catch(() => undefined)
}
// Fill a freed slot immediately instead of waiting for the slowest request in a batch.
async function loadBounded<T>(items: readonly T[], limit: number, load: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!disposed && next < items.length) {
      const item = items[next++]
      await load(item)
    }
  }))
}
async function addFolder() {
  await showCategory('home')
  videoView.value?.showAddFolder()
}
async function openLocalDevice() {
  await showCategory('home')
  await nextTick()
  videoView.value?.showLocalDevice()
}
const localDeviceName = /mac/i.test(navigator.platform) ? 'Mac' : t('unified.myComputer')
/** Removing a favorite (a subfolder or a whole drive) also clears the media scraped from it. */
function confirmRemoveFavorite(remove: () => void) {
  return new Promise<void>(resolve => Modal.confirm({
    title: t('unified.removeFavoriteFolder'), content: t('unified.removeFavoriteConfirmation'),
    okText: t('unified.removeFavoriteFolder'), cancelText: t('common.cancel'), okButtonProps: { status: 'danger' },
    onOk: () => { remove(); resolve() }, onCancel: () => resolve()
  }))
}
async function removeFolder(folder: MediaLibraryFolder) {
  await confirmRemoveFavorite(() => media.removeFolder(folder.id))
}

function manageSources() { showRegistry.value = true }
function useManagedServer(id: string) { showRegistry.value = false; showServer(id) }
async function addServer(type?: MediaServerType) {
  await nextTick()
  if (typeof type === 'string') addRegistryView.value?.openProvider(type)
  else addRegistryView.value?.openAddServer()
}
const refreshAfterServerDelete = () => { void refresh(true) }
onMounted(() => {
  void loadConnectedFileRoots().catch(() => undefined)
  void loadTraktStatus().then(status => { if (!status.connected) return; if (traktSyncEnabled.value) void syncTraktPlaybackProgress().catch(() => undefined); return loadTraktAccount() }).catch(() => undefined)
  window.addEventListener('boxplayer:server-media-deleted', refreshAfterServerDelete)
  window.addEventListener('storage', handleStorage)
  window.addEventListener('boxplayer:custom-series-changed', syncCustomSeries)
  window.addEventListener('focus', syncPlayback)
  void refresh(false)
})
onUnmounted(() => {
  clearTimeout(searchTimer)
  ++searchGeneration
  window.removeEventListener('boxplayer:server-media-deleted', refreshAfterServerDelete)
  disposed = true
  window.removeEventListener('storage', handleStorage)
  window.removeEventListener('boxplayer:custom-series-changed', syncCustomSeries)
  window.removeEventListener('focus', syncPlayback)
})
watch(() => registry.servers.map(server => `${server.id}:${server.baseUrl}:${server.accessToken}:${server.selectedLineName}:${JSON.stringify(server.backupAddresses)}`).join('|'), () => { void refresh(false) })
watch(homeItems, items => placement.setCatalog(items), { immediate: true })
watch(() => favoriteCards.value.map(card => card.key), keys => { void placement.setFavoriteCatalog(keys) }, { immediate: true })
</script>

<template>
  <div class="unified-library" data-testid="unified-media-library">
    <aside v-show="navVisible !== false" class="unified-sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="sidebar-navigation">
      <label class="sidebar-search" @click="sidebarCollapsed = false; openSidebarSearch()"><Search :size="16" /><input v-model="query" :placeholder="t('unified.searchHome')" :aria-label="t('unified.searchHome')" @input="openSidebarSearch" /><button v-if="query" class="search-clear" :aria-label="t('common.close')" @click.stop="query = ''"><X :size="14" /></button></label>
      <div class="group-header"><button class="group-heading" :class="{ selected: section === 'home' }" @click="showHome"><Play :size="20" /><span>{{ t('unified.home') }}</span></button><button class="group-toggle" :aria-expanded="expanded.home" :aria-label="t('unified.expandGroup', { name: t('unified.home') })" @click="expanded.home = !expanded.home"><ChevronDown :size="14" /></button></div>
      <div v-show="expanded.home" class="nav-children">
        <button v-for="item in visibleHomeMenu" :key="item.id" :class="{ selected: isHomeMenuSelected(item.id) }" @click="openHomeMenu(item.id)"><component :is="homeNavigationIcon(item.id)" :size="18" /><span :title="item.title">{{ item.title }}</span></button>
      </div>
      <div class="group-header"><button class="group-heading" :class="{ selected: isLibrarySettingsPage }" @click="showHomeRow('library-index')"><Library :size="20" /><span>{{ t('media.library') }}</span></button><button class="group-toggle" :aria-expanded="expanded.library" :aria-label="t('unified.expandGroup', { name: t('media.library') })" @click="expanded.library = !expanded.library"><ChevronDown :size="14" /></button></div>
      <div v-show="expanded.library" class="nav-children">
        <button v-for="item in librarySidebarCards" :key="item.key" :class="{ selected: selectedHomeRowKey === 'catalog:' + item.key && isCatalogPage || item.key === 'music' && section === 'music' || item.key === 'books' && section === 'book' }" :data-testid="item.key === 'music' ? 'unified-nav-music' : item.key === 'books' ? 'unified-nav-book' : undefined" @click="item.action()"><component :is="item.icon" :size="18" /><span>{{ item.title }}</span></button>

      </div>
      <div class="group-header"><button class="group-heading" :class="{ selected: section === 'files' }" @click="app.mediaLibrarySection = 'files'"><Folder :size="20" /><span>{{ t('unified.files') }}</span></button><button class="group-toggle" :aria-expanded="expanded.files" :aria-label="t('unified.expandGroup', { name: t('unified.files') })" @click="expanded.files = !expanded.files"><ChevronDown :size="14" /></button></div>
      <div v-show="expanded.files" class="nav-children">
        <button v-for="card in fileSourceCards" :key="card.key" :class="{ selected: card.key.startsWith('server:') ? section === 'server' && registry.currentServer?.id === card.key.slice(7) : section === 'video' && selectedFolder === (card.key.startsWith('root:') ? card.key.slice(5) : card.key.slice(7)) }" @click="card.action()"><img v-if="card.providerIcon && !failedProviderIcons.has(card.key)" class="file-sidebar-provider-icon" :src="card.providerIcon" :alt="card.title" @error="markProviderIconFailed(card.key)" /><MediaServerIcon v-else-if="card.server" :server="card.server" :size="18" /><component v-else :is="card.icon" :size="18" /><span>{{ card.title }}</span></button>
      </div>
      </div>
      <div class="sidebar-footer">
        <button class="sidebar-footer-toggle" :aria-label="t(sidebarCollapsed ? 'book.expandSidebar' : 'book.collapseSidebar')" @click="sidebarCollapsed = !sidebarCollapsed"><Ellipsis :size="20" /></button>
        <SidebarProBadge :collapsed="sidebarCollapsed" @upgrade="showProPurchase = true" />
      </div>
    </aside>
    <main class="unified-pane" :class="{ 'search-pane': isSearchPage, 'music-pane': section === 'music' }">
      <header v-if="!detailPageVisible && !isLibrarySettingsPage" class="unified-toolbar">
        <button v-if="section !== 'home' && !isSearchPage" class="round-button back-button" :aria-label="t('unified.back')" @click="videoView?.returnToTagDetail() || (isCatalogPage ? catalogBack() : isFolderPage ? (videoView?.goFolderBack() || (app.mediaLibrarySection = 'files')) : showHome())"><ChevronLeft :size="20" /></button>
        <h1>{{ isFolderPage ? (videoView?.folderTitle || title) : (serverCategorySubtitle || title) }}</h1>
        <div v-if="isSearchPage" class="source-scope search-scopes" role="group" :aria-label="t('unified.sourceScope')"><button v-for="scope in searchScopes" :key="scope.id" :class="{ active: searchScope === scope.id }" @click="searchScope = scope.id">{{ scope.title }}</button></div>
        <button v-if="isSearchPage" class="round-button" :aria-label="collectionMode === 'grid' ? t('mediaServer.listView') : t('mediaServer.gridView')" @click="collectionMode = collectionMode === 'grid' ? 'list' : 'grid'"><Grid2X2 v-if="collectionMode === 'grid'" :size="18" /><List v-else :size="18" /></button>
        <div v-if="isCategoryPage && !isSearchPage && !isLibrarySettingsPage && !isServerCategoryPage && !isGenreIndexPage" class="source-scope" role="group" :aria-label="t('unified.sourceScope')">
          <button :class="{ active: !localOnly }" :aria-pressed="!localOnly" @click="localOnly = false">{{ t('unified.allSources') }}</button>
          <button :class="{ active: localOnly }" :aria-pressed="localOnly" @click="localOnly = true">{{ t('unified.localFiles') }}</button>
        </div>
        <button v-if="section === 'home'" class="round-button" :disabled="refreshing" :aria-label="t('common.refresh')" @click="refresh()"><MediaLoadingIndicator v-if="refreshing" :size="18" /><RefreshCw v-else :size="18" /></button>
        <button v-if="section === 'home'" class="round-button" data-testid="unified-manage-home" :aria-label="t('media.manager')" @click="showHomeManagement = true"><List :size="18" /></button>
        <button v-if="section === 'home'" class="round-button" aria-label="Trakt" title="Trakt" @click="showTraktAccount = true"><TraktAvatar v-if="traktStatus.connected" :src="traktAccount?.avatar" :size="32" /><img v-else :src="traktLogo" alt="Trakt" width="26" height="26" /></button>
        <button v-if="(isCategoryPage || isServerRootPage || isFolderPage || section === 'files') && !isGenreIndexPage && !isLibrarySettingsPage && !isSearchPage" class="round-button" :aria-label="collectionMode === 'grid' ? t('mediaServer.listView') : t('mediaServer.gridView')" @click="collectionMode = collectionMode === 'grid' ? 'list' : 'grid'"><Grid2X2 v-if="collectionMode === 'grid'" :size="18" /><List v-else :size="18" /></button>
        <button v-if="section === 'collection' && (browseSelection || playlistReordering)" class="round-button" @click="browseSelection = false; selectedObjectItems = []; playlistReordering = false; libraryBrowser?.finishReorder()">{{ t('unified.reorderDone') }}</button>
        <a-dropdown v-if="isCategoryPage && !isServerCategoryPage && !isGenreIndexPage && !isLibrarySettingsPage && !isSearchPage && (isCatalogPage ? isCatalogMediaPage : !['local:daily', 'local:top-rated', 'local:playlist', 'custom-series'].includes(selectedHomeRowKey) && !selectedHomeRowKey.startsWith('local:playlist:group:'))" trigger="click" position="br">
          <button class="round-button more-button server-sort-button" :aria-label="t('unified.sortLabel')"><span>{{ t(`unified.sort.${browseSort}`) }}</span><ArrowDown v-if="browseSortDescending" :size="16" /><ArrowUp v-else :size="16" /></button>
          <template #content>
            <div class="server-sort-menu" role="menu">
              <button v-for="sort in (['title', 'fileName', 'addedAt', 'premiereDate'] as MediaBrowseSort[])" :key="sort" role="menuitemradio" :aria-checked="browseSort === sort" @click="selectBrowseSort(sort)"><ArrowDown v-if="browseSort === sort && browseSortDescending" :size="13" /><ArrowUp v-else-if="browseSort === sort" :size="13" /><span v-else class="sort-menu-spacer" /><span>{{ t(`unified.sort.${sort}`) }}</span></button>
            </div>
          </template>
        </a-dropdown>
        <button v-if="section === 'files' || isFolderPage || isServerRootPage" class="round-button" :aria-label="t('unified.sortLabel')" @click="section === 'files' ? (fileSourceDescending = !fileSourceDescending) : isFolderPage ? (folderDescending = !folderDescending) : (serverSort = 'title', serverSortDirection = serverSortDirection === 'ascending' ? 'descending' : 'ascending')"><ArrowDown v-if="section === 'files' ? fileSourceDescending : isFolderPage ? folderDescending : serverSortDirection === 'descending'" :size="16" /><ArrowUp v-else :size="16" /></button>
        <a-dropdown v-if="isServerCategoryPage" v-model:popup-visible="serverSortMenuVisible" trigger="click" position="br">
          <button class="round-button more-button server-sort-button" :aria-label="t('unified.sortLabel')" data-testid="server-category-sort"><span>{{ t(`unified.serverSort.${serverSort}`) }}</span><ArrowUp v-if="serverSortDirection === 'ascending'" :size="16" /><ArrowDown v-else :size="16" /></button>
          <template #content>
            <div class="server-sort-menu" role="menu">
              <button v-for="sort in mediaServerSortOptions" :key="sort" role="menuitemradio" :aria-checked="serverSort === sort" @click="selectServerSort(sort)"><ArrowUp v-if="serverSort === sort && serverSortDirection === 'ascending'" :size="13" /><ArrowDown v-else-if="serverSort === sort" :size="13" /><span v-else class="sort-menu-spacer" /><span>{{ t(`unified.serverSort.${sort}`) }}</span></button>
              <div class="server-sort-divider" role="separator"></div>
              <button role="menuitemradio" :aria-checked="serverSortDirection === 'ascending'" @click="serverSortDirection = 'ascending'; serverSortMenuVisible = false"><Check :size="13" :class="{ invisible: serverSortDirection !== 'ascending' }" /><span>{{ t('unified.serverSort.ascending') }}</span></button>
              <button role="menuitemradio" :aria-checked="serverSortDirection === 'descending'" @click="serverSortDirection = 'descending'; serverSortMenuVisible = false"><Check v-if="serverSortDirection === 'descending'" :size="13" /><ArrowDown v-else :size="13" /><span>{{ t('unified.serverSort.descending') }}</span></button>
            </div>
          </template>
        </a-dropdown>
        <a-dropdown v-else-if="!['home', 'music', 'book'].includes(section) && !isLibrarySettingsPage" trigger="click" position="br">
          <button class="round-button more-button" :aria-label="t('media.manager')"><Ellipsis :size="18" /><ChevronDown :size="10" /></button>
          <template #content>
            <template v-if="section === 'files'">
              <a-doption class="unified-action-option server-root-option" @click="startSourceReordering"><template #icon><Move :size="14" /></template>{{ t('unified.sourceReorder') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="toggleFileSourceSelection"><template #icon><SquareCheck :size="14" /></template>{{ t('unified.selectItems') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="fileSourceDescending = !fileSourceDescending"><template #icon><ListFilter :size="14" /></template>{{ t('unified.sortLabel') }}: {{ t('unified.sort.title') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" disabled><template #icon><Star :size="14" /></template>{{ t('unified.addToFavorites') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" disabled><template #icon><LockKeyhole :size="14" /></template>{{ t('unified.enablePasswordLock') }}</a-doption>
            </template>
            <template v-else-if="isFolderPage">
              <a-doption data-folder-option class="unified-action-option server-root-option" @click="folderSelection = !folderSelection"><template #icon><SquareCheck :size="14" /></template>{{ t('unified.selectItems') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="folderDescending = !folderDescending"><template #icon><ListFilter :size="14" /></template>{{ t('unified.folderSort') }}: {{ t('unified.sort.title') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="videoView?.playBrowse('play')"><template #icon><Play :size="14" /></template>{{ t('unified.play') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="videoView?.playBrowse('loop')"><template #icon><RefreshCw :size="14" /></template>{{ t('unified.loopPlay') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="videoView?.playBrowse('shuffle')"><template #icon><Shuffle :size="14" /></template>{{ t('unified.shufflePlay') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="removeFolderFavorite"><template #icon><Star :size="14" /></template>{{ t('unified.removeFavoriteFolder') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="renameFolder"><template #icon><Pencil :size="14" /></template>{{ t('unified.renameCollection') }}</a-doption>
            </template>
            <template v-else-if="isServerRootPage">
              <a-doption class="unified-action-option server-root-option" @click="serverRootSelection = !serverRootSelection"><template #icon><SquareCheck :size="14" /></template>{{ t('unified.selectItems') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="serverSort = 'title'; serverSortDirection = serverSortDirection === 'ascending' ? 'descending' : 'ascending'"><template #icon><ListFilter :size="14" /></template>{{ t('unified.sortLabel') }}: {{ t('unified.serverSort.title') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" :disabled="!serverRootSelection" @click="serverWorkspace?.favoriteSelectedLibraries()"><template #icon><Star :size="14" /></template>{{ t('unified.addToFavorites') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" disabled><template #icon><LockKeyhole :size="14" /></template>{{ t('unified.enablePasswordLock') }}</a-doption>
            </template>
            <template v-else-if="isCatalogPage && selectedHomeRowKey === 'catalog:favorites'">
              <a-doption class="unified-action-option server-root-option" @click="favoritesSortByTitle = !favoritesSortByTitle"><template #icon><ListFilter :size="14" /></template>{{ t('unified.sortLabel') }}: {{ t('unified.sort.title') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="hideFavoritesShelf"><template #icon><House :size="14" /></template>{{ t('unified.removeHome') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="renameCurrentHomeMenu"><template #icon><Pencil :size="14" /></template>{{ t('unified.renameCollection') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="startFavoriteReordering"><template #icon><Move :size="14" /></template>{{ t('unified.sourceReorder') }}</a-doption>
            </template>
            <template v-else-if="isCatalogPage">
              <a-doption v-if="isCatalogMediaPage" class="unified-action-option browse-sort-option" @click="browseSort = nextMediaBrowseSort(browseSort)"><template #icon><ListFilter :size="14" /></template>{{ t('unified.sortLabel') }}: {{ t(`unified.sort.${browseSort}`) }}</a-doption>
              <LibraryObjectActions :route="selectedHomeRowKey.slice(8)" toolbar />
            </template>
            <template v-else-if="selectedHomeRowKey.startsWith('custom-series:') && section === 'collection'">
              <a-doption class="unified-action-option browse-sort-option" @click="browseSort = nextMediaBrowseSort(browseSort)"><template #icon><ListFilter :size="14" /></template>{{ t('unified.sortLabel') }}: {{ t(`unified.sort.${browseSort}`) }}</a-doption>
              <LibraryObjectActions :route="'custom-series/' + selectedHomeRowKey.slice('custom-series:'.length)" toolbar />
            </template>
            <template v-else-if="isCategoryPage">
              <a-doption v-if="!isGenreIndexPage" class="unified-action-option" :disabled="section !== 'video'" @click="browseSelection = !browseSelection"><template #icon><SquareCheck :size="14" /></template>{{ t('unified.selectItems') }}</a-doption>
              <a-doption v-if="section !== 'collection' || !['local:playlist', 'custom-series'].includes(selectedHomeRowKey) && !isGenreIndexPage" class="unified-action-option browse-sort-option" @click="browseSort = nextMediaBrowseSort(browseSort)"><template #icon><ListFilter :size="14" /></template>{{ t('unified.sortLabel') }}: {{ t(`unified.sort.${browseSort}`) }}</a-doption>
              <a-doption v-if="!isGenreIndexPage" class="unified-action-option" :disabled="section !== 'video'" @click="videoView?.playBrowse('play')"><template #icon><Play :size="14" /></template>{{ t('unified.play') }}</a-doption>
              <a-doption v-if="!isGenreIndexPage" class="unified-action-option" :disabled="section !== 'video'" @click="videoView?.playBrowse('loop')"><template #icon><RefreshCw :size="14" /></template>{{ t('unified.loopPlay') }}</a-doption>
              <a-doption v-if="!isGenreIndexPage" class="unified-action-option" :disabled="section !== 'video'" @click="videoView?.playBrowse('shuffle')"><template #icon><Shuffle :size="14" /></template>{{ t('unified.shufflePlay') }}</a-doption>
              <LibraryObjectActions v-if="activeHomeMenuId" :route="categoryRouteForHomeId(activeHomeMenuId)" toolbar />
            </template>
            <template v-else>
            <a-doption @click="addServer()">{{ t('unified.addServer') }}</a-doption>
            <a-doption @click="addFolder">{{ t('media.importLocalFolder') }}</a-doption>
            <a-doption @click="manageSources">{{ t('unified.manageSources') }}</a-doption>
            <a-doption v-if="section === 'video'" @click="videoView?.manageLibrary()">{{ t('media.manager') }}</a-doption>
            <a-doption v-if="section === 'music' || section === 'book'" @click="toolsVisible = !toolsVisible">{{ t('media.manager') }}</a-doption>
            <a-doption v-if="section === 'server'" @click="navigation.goSearch()">{{ t('common.search') }}</a-doption>
            </template>
          </template>
        </a-dropdown>
        <button v-if="section === 'files'" class="add-source file-source-add" @click="showAddFileSource = true"><Plus :size="16" />{{ t('unified.addSource') }}</button>
      </header>
      <div v-if="media.isScanning" class="library-scan-status" role="status" aria-live="polite" aria-atomic="true" data-testid="library-scan-status">
        <MediaLoadingIndicator :size="18" aria-hidden="true" />
        <span>{{ t('footer.scanningMedia') }}</span>
        <span v-if="media.scanProgress > 0" class="library-scan-count">{{ t('unified.scanProcessed', { count: media.scanProgress }) }}</span>
      </div>
      <div v-show="section === 'home' || (section === 'collection' && selectedHomeRowKey === 'sources')" class="unified-home" :class="{ 'source-screen-empty': section === 'home' && homeIsEmpty }" ref="homeElement" @scroll="section === 'home' && (homeScrollTop = ($event.target as HTMLElement).scrollTop)">
        <UnifiedMediaRow v-for="row in rows.filter(item => item.key === 'resume')" v-show="!(section === 'collection' && selectedHomeRowKey === 'sources')" :key="row.key" :row="row" />
        <template v-for="entry in (section === 'home' && homeIsEmpty ? [] : homeLayout)" :key="entry.item.id">
        <section v-if="entry.item.id === 'sources'" class="home-row source-shortcuts">
          <div class="row-heading"><h2>{{ entry.item.title }}</h2><button @click="openHomeMenu('sources')">{{ t('mediaServer.seeAllPlain') }}</button></div>
          <div class="horizontal-row">
            <button v-for="card in favoritePageCards" :key="card.key" class="favorite-shortcut favorite-library" :class="favoriteCardClasses(card.key)" @click="card.action" @contextmenu.prevent="openFavoriteCardMenu($event, card.key)">
              <div class="favorite-shortcut-art"><img v-if="favoriteCover(card.key)" class="favorite-shortcut-cover" :src="favoriteCover(card.key)" alt="" draggable="false" /><MediaServerIcon v-else-if="sourceServer(card.key)" :server="sourceServer(card.key)!" :size="70" /><component :is="libraryCategoryIcon(card.key)" v-else :size="70" :stroke-width="2.8" aria-hidden="true" /></div>
              <strong>{{ card.title }}</strong>
            </button>
          </div>
        </section>
        <HomeShelfViewport v-else-if="entry.row" v-show="!(section === 'collection' && selectedHomeRowKey === 'sources')" :snapshot="homeShelfSnapshot(entry.item.id)" :landscape="entry.row.landscape" @visible="visible => homeRowVisibility(entry.item.id, visible)"><UnifiedMediaRow :row="entry.row" /></HomeShelfViewport>
        </template>
        <div v-if="section === 'home' && homeIsEmpty && refreshing" class="unified-loading-state"><MediaLoadingIndicator /></div>
        <SourceEmptyState v-if="section === 'home' && homeIsEmpty && !refreshing" home @add="showAddFileSource = true" />
      </div>
      <div v-if="section === 'collection' && selectedHomeRowKey !== 'sources'" class="unified-home category-collection" :class="{ 'library-settings-page': isLibrarySettingsPage }" :style="isLibrarySettingsPage ? { background: '#1e1e1e !important' } : undefined">
        <div v-if="isCatalogPage && selectedHomeRowKey === 'catalog:favorites'" class="favorite-page-wrap" :class="{ 'is-reordering': favoriteReordering }">
          <div v-if="favoriteReordering" class="source-reorder-hint" role="status"><span>{{ t('unified.dragSourceHint') }}</span><button @click="finishFavoriteReordering">{{ t('unified.reorderDone') }}</button></div>
          <div class="favorite-page-grid" data-testid="library-favorites">
          <button v-for="card in favoritePageCards" :key="card.key" :data-favorite-key="card.key" class="favorite-shortcut favorite-library" :class="[favoriteCardClasses(card.key), { 'source-dragging': draggedFavoriteKey === card.key }]" :draggable="favoriteReordering ? 'true' : 'false'" @dragstart="startFavoriteDrag($event, card.key)" @dragenter.prevent @dragover.prevent="$event.dataTransfer && ($event.dataTransfer.dropEffect = 'move')" @drop.prevent="dropFavoriteCard(card.key)" @dragend="draggedFavoriteKey = ''" @pointerdown="startFavoritePointer($event, card.key)" @pointermove="moveFavoritePointer" @pointerup="finishFavoritePointer" @pointercancel="finishFavoritePointer" @click="favoriteReordering ? undefined : card.action()" @contextmenu.prevent="!favoriteReordering && openFavoriteCardMenu($event, card.key)"><div class="favorite-shortcut-art"><img v-if="favoriteCover(card.key)" class="favorite-shortcut-cover" :src="favoriteCover(card.key)" alt="" draggable="false" /><MediaServerIcon v-else-if="sourceServer(card.key)" :server="sourceServer(card.key)!" :size="70" /><component :is="libraryCategoryIcon(card.key)" v-else :size="70" :stroke-width="2.8" aria-hidden="true" /></div><strong>{{ card.title }}</strong></button>
          </div>
        </div>
        <div v-else-if="isCatalogPage && selectedHomeRowKey === 'catalog:daily' && recommendationLoading" class="unified-loading-state"><MediaLoadingIndicator /></div>
        <div v-else-if="isCatalogPage && selectedHomeRowKey === 'catalog:daily' && recommendationError && !dailyRecommendations.length" role="alert">{{ t('unified.rankingFailed') }} <button @click="loadLibraryRecommendations()">{{ t('common.retry') }}</button></div>
        <UnifiedLibraryBrowser v-else-if="isCatalogPage" ref="libraryBrowser" :route="selectedHomeRowKey.slice(8)" :mode="collectionMode" :sort="browseSort" :sort-descending="browseSortDescending" :local-only="localOnly" :daily-items="dailyRecommendations" :card="localCard" :selection="browseSelection ? selectedObjectKeys : undefined" @navigate="showCatalog" @title="catalogTitle = $event" @play="playCatalog" @custom-series="showCustomSeries" @placement="handleCatalogPlacement" />
        <div v-else-if="isSearchPage" class="sidebar-search-results">
          <div v-if="searchLoading" class="unified-loading-state"><MediaLoadingIndicator /></div>
          <div v-else-if="searchError" role="alert">{{ searchError }} <button @click="runSidebarSearch()">{{ t('common.retry') }}</button></div>
          <template v-else-if="searchRows.length"><section v-for="row in searchRows" :key="row.key" class="search-result-group"><h2>{{ row.title }}</h2><UnifiedMediaRow :row="row" :mode="collectionMode" :show-more="false" /></section></template>
          <MediaEmptyFolder v-else class="collection-empty-folder" />
        </div>
        <div v-else-if="selectedHomeRowKey === 'library-shortcuts'" class="library-index" :class="{ 'library-index-list': collectionMode === 'list' }">
          <button v-for="card in libraryShortcutCards" :key="card.key" class="library-index-card" @click="card.action()" @contextmenu="openCategoryMenu($event, card.key)"><div class="library-index-art"><component :is="libraryCategoryIcon(card.key)" :size="60" :stroke-width="1.6" /></div><strong>{{ card.title }}</strong></button>
        </div>
        <section v-else-if="selectedHomeRowKey === 'library-index'" class="library-settings" data-testid="library-settings">
          <button class="library-settings-option" @click="showTraktAccount = true">Trakt · {{ t('trakt.account') }}</button>
          <div class="library-statistics"><div v-for="stat in libraryStatistics" :key="stat.label"><strong>{{ stat.count }}</strong><span>{{ stat.label }}</span></div></div>
          <div v-for="group in librarySourceGroups" :key="group.key" class="library-source-group"><h2>{{ group.title }}</h2><label v-for="source in group.sources" :key="source.key" class="library-settings-option"><input type="checkbox" :checked="!homePreferences.hidden.includes(source.key)" @change="toggleLibrarySource(source.key, ($event.target as HTMLInputElement).checked)" /><span>{{ source.title }}</span></label></div>
          <label class="library-settings-option library-visibility"><input type="checkbox" :checked="!homePreferences.hidden.includes('library')" @change="toggleLibrarySource('library', ($event.target as HTMLInputElement).checked)" /><span>{{ t('librarySettings.showLibrary') }}</span></label>
          <div class="library-refresh-actions"><button :disabled="libraryScanning || metadataRefreshing || media.isScanning" @click="rescanLibraryFolders"><Search :size="16" />{{ t('librarySettings.refreshLibrary') }}</button><button :disabled="metadataRefreshing || libraryScanning || media.isScanning" @click="refreshLibraryMetadata"><RefreshCw :size="16" :class="{ spinning: metadataRefreshing }" />{{ t('librarySettings.refreshMetadata') }}</button></div>
        </section>
        <div v-else-if="['local:daily', 'local:top-rated'].includes(selectedHomeRowKey) && recommendationLoading" class="unified-loading-state"><MediaLoadingIndicator /></div>
        <div v-else-if="['local:daily', 'local:top-rated'].includes(selectedHomeRowKey) && recommendationError && (selectedHomeRowKey !== 'local:daily' || !dailyRecommendations.length)" role="alert">{{ t('unified.rankingFailed') }} <button @click="loadLibraryRecommendations()">{{ t('common.retry') }}</button></div>
        <div v-else-if="selectedHomeRow?.cards.length">
          <button v-if="playlistReordering && selectedHomeRowKey.startsWith('local:playlist:group:')" type="button" @click="playlistReordering = false">{{ t('music.done') }}</button>
          <UnifiedMediaRow :row="selectedHomeRow" :mode="collectionMode" :show-more="false" :selection="browseSelection ? selectedObjectKeys : undefined" :reordering="playlistReordering" @reorder="reorderSelectedPlaylist" />
        </div>
        <MediaEmptyFolder v-else class="collection-empty-folder" />
      </div>
      <div v-else-if="section === 'files'" class="file-source-browser" :class="{ 'file-source-list': collectionMode === 'list', 'is-reordering': fileSourceReordering, 'file-sources-empty': !fileSourceCards.length }">
        <div v-if="fileSourceReordering" class="source-reorder-hint" role="status"><span>{{ t('unified.dragSourceHint') }}</span><button @click="finishSourceReordering">{{ t('unified.reorderDone') }}</button></div>
        <SourceEmptyState v-if="!fileSourceCards.length" @add="showAddFileSource = true" />
        <button v-for="card in fileSourceCards" :key="card.key" :data-source-key="card.key" class="file-source-card" :style="sourceDragStyle(card.key)" :class="{ 'source-selected': fileSourceSelection && selectedFileSources.includes(card.key), 'source-dragging': sourceDragKey === card.key, 'source-drop-target': sourceDropKey === card.key && sourceDragKey !== card.key }" :aria-pressed="fileSourceSelection ? selectedFileSources.includes(card.key) : undefined" @pointerdown="collectionMode === 'grid' && fileSourceReordering && startSourcePointer($event, card.key)" @keydown="fileSourceReordering && sourceReorderKeydown($event, card.key)" @click="openFileSource(card)" @contextmenu.prevent="openFileCardMenu($event, card.key)">
<div class="file-source-art"><img v-if="card.providerIcon && !failedProviderIcons.has(card.key)" class="file-source-provider-icon" :src="card.providerIcon" :alt="card.title" draggable="false" @error="markProviderIconFailed(card.key)" /><img v-else-if="!card.server && favoriteCover(card.key)" :src="favoriteCover(card.key)" alt="" draggable="false" /><MediaServerIcon v-else-if="card.server" :server="card.server" :size="collectionMode === 'grid' ? 56 : 28" /><component v-else :is="card.icon" :size="collectionMode === 'grid' ? 56 : 28" /><input v-if="fileSourceSelection" type="checkbox" :checked="selectedFileSources.includes(card.key)" tabindex="-1" :aria-label="card.title" /></div><strong>{{ card.title }}<small v-if="collectionMode === 'list' && 'subtitle' in card && card.subtitle" class="file-source-subtitle">{{ card.subtitle }}</small></strong><span v-if="collectionMode === 'list'" class="file-source-handle" role="button" tabindex="0" :aria-label="t('unified.reorder', { name: card.title })" @click.stop @pointerdown.stop="startSourcePointer($event, card.key)" @keydown="sourceReorderKeydown($event, card.key)"><List :size="22" /></span>
        </button>
      </div>
      <div v-if="section === 'files' && fileSourceSelection" class="file-source-selection-bar">
        <span>{{ t('posterMenu.selectedCount', { count: selectedFileSources.length }) }}</span>
        <button @click="toggleAllFileSources"><SquareCheck :size="17" />{{ t(allFileSourcesSelected ? 'book.unselectAll' : 'scan.selectAll') }}</button>
        <button :disabled="!selectedFileSources.length" @click="startSourceReordering"><Move :size="17" />{{ t('unified.sourceReorder') }}</button>
        <button disabled :title="t('pan.unsupportedFeature')"><Eye :size="17" />{{ t('mediaServer.markWatched') }}</button>
        <button disabled :title="t('pan.unsupportedFeature')"><EyeOff :size="17" />{{ t('mediaServer.markUnwatched') }}</button>
        <button disabled :title="t('pan.unsupportedFeature')"><ListPlus :size="17" />{{ t('media.playlist') }}</button>
        <button disabled :title="t('pan.unsupportedFeature')"><GalleryVerticalEnd :size="17" />{{ t('unified.series') }}</button>
        <button :disabled="!selectedFileSources.length || selectedFileSources.some(key => key.startsWith('root:'))" class="danger" @click="deleteSelectedFileSource"><Trash2 :size="17" />{{ t('common.delete') }}</button>
        <button @click="toggleFileSourceSelection">{{ t('music.done') }}</button>
      </div>
      <div v-show="!['home', 'files', 'collection'].includes(section)" class="embedded-workspace">
        <KeepAlive>
          <VideoLibrary v-if="section === 'video' || section === 'home' || section === 'collection'" v-show="section === 'video'" ref="videoView" @tag-title-change="detailTagTitle = $event" @detail-visibility-change="localDetailVisible = $event" @browse-context-change="selectedFolder = $event.folderId; selectedCategory = $event.category || selectedCategory" :nav-visible="false" :unified-browse="true" :unified-files="isFolderPage" :folder-descending="folderDescending" :browse-mode="collectionMode" :local-only="localOnly" :browse-sort="isCategoryPage ? browseSort : undefined" :browse-sort-descending="isCategoryPage ? browseSortDescending : undefined" :browse-selection="isFolderPage ? folderSelection : browseSelection" />
        </KeepAlive>
        <KeepAlive>
          <ServerWorkspace @category-favorites="favoriteServerCategories" @category-context="openCategoryMenu" ref="serverWorkspace" v-if="section === 'server' || section === 'home'" v-show="section === 'server'" :unified-root="isServerRootPage" :root-selection="serverRootSelection" :unified-browse="isCategoryPage" :browse-mode="collectionMode" :server-sort="serverSort" :server-sort-direction="serverSortDirection" :server-sort-seed="serverSortSeed" />
          <MusicLibrary v-else-if="section === 'music'" ref="musicView" data-testid="unified-section-music" :sidebar-visible="toolsVisible" />
          <BookLibrary v-else-if="section === 'book'" ref="bookView" data-testid="unified-section-book" :sidebar-visible="toolsVisible" />
        </KeepAlive>
      </div>
    </main>
    <Teleport to="body">
      <div v-if="serverFolderMenu" class="source-context-dismiss" @pointerdown="serverFolderMenu = undefined" @contextmenu.prevent="serverFolderMenu = undefined" @keydown.esc="serverFolderMenu = undefined">
        <div class="source-context-menu" :style="{ left: serverFolderMenu.x + 'px', top: serverFolderMenu.y + 'px' }" @pointerdown.stop>
          <!-- A series card in Favorites: play like a folder, toggle the account's favorite, choose a cover. -->
          <button role="menuitem" @click="serverPosterAction(serverFolderMenu.item, 'play'); serverFolderMenu = undefined"><Play :size="17" />{{ t('unified.play') }}</button>
          <button role="menuitem" @click="serverPosterAction(serverFolderMenu.item, 'loop'); serverFolderMenu = undefined"><RefreshCw :size="17" />{{ t('unified.loopPlay') }}</button>
          <button role="menuitem" @click="serverPosterAction(serverFolderMenu.item, 'shuffle'); serverFolderMenu = undefined"><Shuffle :size="17" />{{ t('unified.shufflePlay') }}</button>
          <button role="menuitem" @click="serverPosterAction(serverFolderMenu.item, 'favorite'); serverFolderMenu = undefined"><Star :size="17" />{{ t(serverFolderMenu.item.isFavorite === false ? 'mediaServer.addFavorite' : 'mediaServer.removeFavorite') }}</button>
          <button role="menuitem" @click="openFavoriteCoverDialog(serverFolderFavoriteKey(serverFolderMenu.item)); serverFolderMenu = undefined"><Image :size="17" />{{ t('unified.cover') }}</button>
        </div>
      </div>
      <div v-if="categoryMenu" class="source-context-dismiss" @pointerdown="categoryMenu = undefined" @contextmenu.prevent="categoryMenu = undefined" @keydown.esc="categoryMenu = undefined"><div class="source-context-menu" role="menu" :style="{ left: categoryMenu.x + 'px', top: categoryMenu.y + 'px' }" @pointerdown.stop>
        <template v-if="categoryMenu.favoriteCard && categoryMenu.route === 'library'">
          <button role="menuitem" @click="startFavoriteReordering"><Move :size="17" />{{ t('unified.sourceReorder') }}</button>
        </template>
        <LibraryObjectActions :route="categoryMenu.route" :hidden-on-home="!!sourceOverrides[categoryMenu.route]?.hiddenOnHome" @action="categoryMenu = undefined" />
      </div></div>
      <div v-if="sourceMenu" class="source-context-dismiss" @pointerdown="sourceMenu = null" @contextmenu.prevent="sourceMenu = null" @keydown.esc="sourceMenu = null">
        <div class="source-context-menu" role="menu" :style="{ left: sourceMenu.x + 'px', top: sourceMenu.y + 'px' }" @pointerdown.stop>
          <button v-for="option in contextOptions" :key="option.id" role="menuitem" @click="sourceAction(option.id)"><component :is="option.icon" :size="17" />{{ t(('unified.' + (option.id === 'reorder' ? 'sourceReorder' : option.id === 'removeRootFavorite' ? 'removeFavoriteFolder' : option.id)) as Parameters<typeof t>[0]) }}</button>
        </div>
      </div>
    </Teleport>
    <a-modal :visible="!!pendingRootFavorite" :title="t('unified.addToFavorites')" @cancel="pendingRootFavorite = undefined" @ok="saveRootFavorite"><a-input v-model="rootFavoriteName" :placeholder="t('mediaLibrary.folderName')" @press-enter="saveRootFavorite" /></a-modal>
    <a-modal :visible="!!sourceDialog" :title="t(('unified.' + (sourceDialog === 'rename' ? 'renameCollection' : sourceDialog)) as Parameters<typeof t>[0])" @cancel="sourceDialog = ''" @ok="saveSourceDialog">
      <a-input v-model="sourceText" />
    </a-modal>
    <a-modal :visible="!!rootEditor" :title="t('unified.editShare')" :footer="false" @cancel="rootEditor = undefined">
      <a-form v-if="rootEditor" :model="rootEditor" layout="vertical" @submit-success="saveRootEditor">
        <a-form-item :label="t('unified.sourceLocalName')"><a-input v-model="rootEditor.name" /></a-form-item>
        <template v-if="rootEditor.connection">
          <a-form-item :label="t('unified.sourceUrl')"><a-input v-model="rootEditor.connection.url" /></a-form-item>
          <a-form-item :label="t('settings.webdav.username')"><a-input v-model="rootEditor.connection.username" /></a-form-item>
          <a-form-item :label="t('settings.webdav.password')"><a-input-password v-model="rootEditor.connection.password" /></a-form-item>
          <a-form-item :label="t('settings.webdav.mountPath')"><a-input v-model="rootEditor.connection.rootPath" /></a-form-item>
        </template>
        <a-button html-type="submit" type="primary">{{ t('unified.saveSource') }}</a-button>
      </a-form>
    </a-modal>
    <a-modal :visible="!!playlistAssignment" :title="t('media.playlist')" @cancel="playlistAssignment = undefined" @ok="savePlaylistAssignment"><a-checkbox-group v-if="playlistAssignment" v-model="playlistAssignment.selected" :options="Object.keys(media.playlists)" /><a-input v-model="playlistCreateName" :placeholder="t('libraryObject.newPlaylist')" /></a-modal>
    <a-modal :visible="!!objectPrompt" :title="objectPrompt?.action === 'delete' ? t(objectPrompt.route.startsWith('playlist/') ? 'libraryObject.deletePlaylist' : 'libraryObject.deleteSeries') : t(objectPrompt?.route.startsWith('playlist/') ? 'libraryObject.renamePlaylist' : 'customSeries.rename')" @cancel="objectPrompt = undefined" @ok="saveObjectPrompt"><a-input v-if="objectPrompt?.action === 'rename'" v-model="objectPrompt.value" @press-enter="saveObjectPrompt" /><p v-else>{{ objectPrompt?.value }}</p></a-modal>
    <a-modal :visible="!!catalogPlacement" :title="catalogPlacement?.action === 'home' ? t('libraryBrowse.addHome') : catalogPlacement?.action === 'favorite' ? t('unified.addToFavorites') : t('unified.renameCollection')" @cancel="catalogPlacement = undefined; categoryFavoriteQueue = []" @ok="saveCatalogPlacement"><a-input v-if="catalogPlacement" v-model="catalogPlacement.name" @press-enter="saveCatalogPlacement" /></a-modal>
    <a-modal v-model:visible="renameVisible" :title="t('unified.renameCollection')" @ok="saveCollectionName"><a-input v-model="renameText" /></a-modal>
    <ServerRegistry ref="addRegistryView" form-only @open-server="useManagedServer" />
    <MediaServerEndpointsModal :server-id="endpointServerId" @close="endpointServerId = ''" />
    <a-modal v-model:visible="showRegistry" :title="t('nav.mediaServer')" :width="960" :footer="false" unmount-on-close>
      <ServerRegistry ref="registryView" @open-server="useManagedServer" />
    </a-modal>
    <a-modal v-model:visible="showHomeManagement" modal-class="unified-home-management-modal" :width="660" :footer="false" :closable="false" :hide-title="true" unmount-on-close :body-style="{ padding: '0' }">
      <UnifiedHomeManagement :items="homeItems" :groups="managementGroups" :settings="homePreferences" :placement-state="id => id === 'library' ? { home: false, favorite: false } : placement.state(categoryRouteForHomeId(id))" @save="placement.applyHome" @reset="placement.restoreOrder" @rename="placement.renameHome" @remove-placement="id => placement.change(categoryRouteForHomeId(id), 'remove')" @close="showHomeManagement = false" />
    </a-modal>
  </div>
<MediaShareModal /><MediaPersonalRatingModal /><CustomMediaSeriesModal /><WatchingUpdateModal />
<AddFileSourceModal @toggle-root="togglePickerRootFavorite" :device-name="localDeviceName" :sources="connectedFileRoots.map(root => ({ id: root.value, name: root.label, icon: root.providerIcon, favorite: rootIsFavorite(root), folder: root.folder, driveServerId: root.driveServerId, drives: root.drives })).concat(registry.servers.map(server => ({ id: 'server:' + server.id, name: server.name, icon: '', favorite: false, server, folder: makeScanFolder({ user_id: server.userId || '' } as ITokenInfo, 'media_server', '__all__', server.name), driveServerId: 'media_server', drives: undefined })))"  :visible="showAddFileSource" @close="showAddFileSource = false" @connected="fileSourceConnected" />
<LimitReachedModal :visible="showProPurchase" @update:visible="showProPurchase = $event" />
<TraktAccountModal :visible="showTraktAccount" @close="showTraktAccount = false" />
</template>

<style scoped>
.source-reorder-hint{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:16px;color:var(--color-text-3);font-size:13px}
.source-reorder-hint button{background:transparent;border:0;color:#ff8700;font:inherit;cursor:pointer;padding:8px 12px}
.file-source-handle{display:flex;align-items:center;justify-content:center;min-width:40px;min-height:40px;cursor:grab;touch-action:none}
.file-source-handle:active,.is-reordering .file-source-card:active{cursor:grabbing}
.is-reordering:not(.file-source-list) .file-source-card{cursor:grab;animation:source-card-wiggle .24s ease-in-out infinite alternate;transform-origin:50% 55%}
.is-reordering:not(.file-source-list) .file-source-card:nth-child(even){animation-delay:-.12s}
.favorite-page-wrap.is-reordering .favorite-shortcut{cursor:grab;animation:source-card-wiggle .24s ease-in-out infinite alternate;transform-origin:50% 55%;-webkit-user-drag:element;user-select:none}
.favorite-page-wrap.is-reordering .favorite-shortcut:nth-child(even){animation-delay:-.12s}
.favorite-page-wrap.is-reordering .favorite-shortcut:active{cursor:grabbing}
.file-source-card.source-dragging{position:relative;z-index:10;opacity:1;animation:none!important;transition:none!important;pointer-events:none;cursor:grabbing;background:var(--color-bg-1);box-shadow:0 12px 32px #0006;border-radius:10px}
.file-source-list .file-source-card{transition:transform .16s ease;user-select:none}
.file-source-card.source-drop-target .file-source-art{outline:2px solid #ff8700;outline-offset:3px}
@keyframes source-card-wiggle{from{transform:rotate(-.7deg)}to{transform:rotate(.7deg)}}
@media(prefers-reduced-motion:reduce){.is-reordering:not(.file-source-list) .file-source-card,.favorite-page-wrap.is-reordering .favorite-shortcut{animation:none;outline:1px dashed #ff8700;outline-offset:4px}}
.favorite-page-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(172px,220px));gap:30px 24px}
.favorite-page-grid .favorite-shortcut{width:100%}
.source-shortcuts .row-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.source-shortcuts .row-heading h2{margin:0}
.source-shortcuts .row-heading button{border:0;background:transparent;color:#ff8000;cursor:pointer}
.unified-loading-state{display:flex;align-items:center;justify-content:center;min-height:56vh}
.unified-toolbar .round-button{padding:0;box-sizing:border-box;overflow:hidden;place-items:center}
.unified-library{display:flex;height:100%;min-height:0;background:var(--color-bg-1);color:var(--color-text-1)}
:global(#xbybody .unified-library .music-pane), :global(#xbybody .unified-library .music-pane .unified-toolbar){background:#000!important}
.unified-sidebar{display:flex;flex-direction:column;min-height:0;overflow:hidden!important}
.sidebar-navigation{flex:1;min-height:0;overflow-y:auto}
.sidebar-footer{flex-shrink:0;padding-top:12px}
.sidebar-footer-toggle{margin-bottom:24px;transform:rotate(90deg);color:var(--color-text-3)!important}
.unified-sidebar.collapsed{width:76px!important;padding:16px 10px}
.collapsed .nav-children,.collapsed .group-toggle,.collapsed .group-heading span,.collapsed .sidebar-search input{display:none!important}
.collapsed .group-header{justify-content:center;margin-top:20px}
.collapsed .group-heading{justify-content:center!important;padding:10px!important}
.collapsed .sidebar-search{justify-content:center;padding:10px;cursor:text}
.unified-sidebar{width:258px;flex-shrink:0;padding:18px 12px;overflow-y:auto;border-right:1px solid var(--color-border-2);background:var(--color-bg-2)}
.sidebar-search{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--color-border-2);border-radius:20px;margin-bottom:18px;color:var(--color-text-3)}
.sidebar-search input{width:100%;min-width:0;border:0;outline:none;background:transparent;color:var(--color-text-1)}
button{font:inherit;color:inherit;cursor:pointer}
.group-heading,.nav-children button{display:flex;align-items:center;gap:12px;border:0;background:transparent;width:100%;border-radius:9px;text-align:left;min-height:39px;padding:8px 12px}
.group-heading{font-weight:600;margin:12px 0 4px}.group-heading span{flex:1}.group-header{display:flex;align-items:center}.group-header .group-heading{flex:1}.group-toggle{background:transparent;border:0;border-radius:50%;padding:8px}.unified-sidebar svg{color:#ff8b25;flex-shrink:0}.nav-children{padding-left:14px}.nav-children span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.unified-sidebar button:hover,.unified-sidebar .selected{background:var(--color-fill-3)}
.library-scan-status{display:flex;align-items:center;gap:10px;flex-shrink:0;padding:10px 20px;border-bottom:1px solid var(--color-border-2);background:var(--color-bg-2);color:var(--color-text-1);font-size:13px}.library-scan-status>svg{color:#ff8800}.library-scan-count{color:var(--color-text-3)}
.unified-pane{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}.unified-toolbar{height:56px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-bottom:1px solid var(--color-border-2)}
.unified-toolbar h1{font-size:15px;font-weight:600;margin:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.unified-toolbar{gap:12px}.round-button{display:grid;place-items:center;border:1px solid var(--color-border-2);background:var(--color-fill-1);border-radius:50%;width:36px;height:36px;flex-shrink:0}.round-button:disabled{cursor:wait;opacity:.6}.add-source{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:20px;padding:10px 16px;background:#ff8b25;color:#fff}button:focus-visible{outline:2px solid #ff8b25;outline-offset:2px}
.unified-home{flex:1;overflow-y:auto;padding:24px 28px}.home-row{margin-bottom:26px}h2{font-size:19px;font-weight:600;margin:0 0 14px}
:global(body #xbybody .unified-library .music-pane > .unified-toolbar) { background:#fafbfc!important; color:#20242c; border-bottom-color:#e9ecf0; }
:global(body[arco-theme='dark'] #xbybody .unified-library .music-pane > .unified-toolbar) { background:#181c1f!important; color:#edf0f2; border-bottom-color:#292e33; }
:global(body[arco-theme='dark'] #xbybody .unified-library .unified-home:not(.category-collection)){background:#1e1e1e!important}
:global(body[arco-theme='dark'] .search-pane){background:#1e1e1e}.search-pane .unified-toolbar{border-bottom:0}.search-pane .sidebar-search-results{padding-top:0}
.sidebar-search-results{height:100%;min-height:0}.search-result-group{margin:0 12px 32px}.search-result-group>h2{font-size:22px;margin:0 0 14px}.search-scopes{max-width:60%;overflow-x:auto;white-space:nowrap}.search-clear{padding:0!important;min-width:20px}.search-result-group :deep(.mode-grid .horizontal-row){grid-template-columns:repeat(8,minmax(0,1fr));gap:22px 20px}@media(max-width:1400px){.search-result-group :deep(.mode-grid .horizontal-row){grid-template-columns:repeat(6,minmax(0,1fr))}}@media(max-width:1050px){.search-result-group :deep(.mode-grid .horizontal-row){grid-template-columns:repeat(4,minmax(0,1fr))}}
.collection-empty-folder{border:1px solid var(--color-border-1);border-radius:24px;background:#000;min-height:100%}
.sort-option{display:block;width:100%;text-align:left;padding:10px;border:0;background:transparent;color:var(--color-text-1)}.sort-option:hover{background:var(--color-fill-3)}
.unified-toolbar{position:relative}.source-scope{position:absolute;left:50%;transform:translateX(-50%);display:flex;padding:3px;border:1px solid var(--color-border-2);border-radius:22px;background:var(--color-fill-1)}.source-scope button{border:0;background:transparent;border-radius:18px;padding:5px 18px;font-size:13px;color:var(--color-text-3)}.source-scope button.active{background:var(--color-fill-4);color:var(--color-text-1)}.category-collection{padding:16px}.ranking-empty{padding:80px 24px;text-align:center;color:var(--color-text-3)}.more-button{display:flex;align-items:center;justify-content:center;gap:2px;width:48px;border-radius:22px}
.horizontal-row{display:flex;align-items:flex-start;gap:24px;overflow-x:auto;padding:3px 0 10px;scrollbar-width:none}
.horizontal-row::-webkit-scrollbar{display:none}
.favorite-shortcut{padding:0;border:0;background:transparent;color:var(--color-text-1);width:172px;flex-shrink:0;text-align:left;cursor:pointer}
.favorite-shortcut-art{aspect-ratio:1.8;height:auto;border-radius:10% / 18%;display:flex;align-items:center;justify-content:center;color:#ffffffb8;background:linear-gradient(90deg,#ff5b00,#ff9600)}
.favorite-shortcut-art :deep(svg),.favorite-shortcut-art :deep(.media-server-provider-icon){width:48px!important;height:48px!important}
.favorite-shortcut-art{position:relative;overflow:hidden}.favorite-shortcut-cover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.favorite-movies .favorite-shortcut-art{background:linear-gradient(90deg,#0075ff,#17c9e8)}
.favorite-tv .favorite-shortcut-art{background:linear-gradient(90deg,#ff1c61,#e434f1)}
.favorite-other .favorite-shortcut-art{background:linear-gradient(90deg,#20c866,#08dfc2)}
.favorite-music .favorite-shortcut-art{background:linear-gradient(90deg,#3288c8,#25c1df)}
.favorite-book .favorite-shortcut-art{background:linear-gradient(110deg,#777036,#b6a644)}
.favorite-server .favorite-shortcut-art{background:linear-gradient(90deg,#7229a7,#a32bf1)}
.favorite-folder .favorite-shortcut-art{background:linear-gradient(90deg,#ff8500,#ffc326)}
.favorite-shortcut strong{display:block;margin-top:8px;font-size:14px;line-height:20px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.source-shortcuts .horizontal-row{gap:24px}
:global(#xbybody .unified-home.library-settings-page){background:#1e1e1e!important;}
.library-settings-page{background:#1e1e1e;min-height:calc(100% - 60px)}.library-settings-page .library-settings-option,.library-settings-page .library-statistics>div{background:#2c2c2c;color:#ddd}.library-settings{width:min(660px,calc(100% - 48px));margin:18px auto 60px;padding:0;color:var(--color-text-1)}.library-statistics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:26px}.library-statistics>div{display:flex;flex-direction:column;gap:5px;border-radius:10px;background:var(--color-fill-2);padding:13px}.library-statistics strong{color:#ff8b25;font-size:18px}.library-statistics span,.library-source-group h2{color:var(--color-text-3);font-size:13px}.library-source-group{margin-bottom:26px}.library-source-group h2{font-weight:500;margin:0 0 9px}.library-settings-option{display:flex;align-items:center;gap:16px;background:var(--color-fill-2);padding:17px 18px;border-radius:10px;font-size:14px;margin-top:8px;cursor:pointer}.library-settings-option input{accent-color:#0099ff;width:13px;height:13px}.library-visibility{margin-top:46px}.library-refresh-actions{display:flex;gap:28px;margin-top:18px}.library-refresh-actions button{display:flex;align-items:center;gap:8px;color:var(--color-text-2);border:0;background:transparent;font-size:13px;cursor:pointer}.library-refresh-actions button:disabled{opacity:.4}:global(body[arco-theme="dark"]) .library-settings{color:#ddd}:global(body[arco-theme="dark"]) .library-settings-option,:global(body[arco-theme="dark"]) .library-statistics>div{background:#2c2c2c}
.library-index{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:24px 22px;padding:8px 16px}
.library-index-card{min-width:0;padding:0;border:0;background:transparent;color:var(--color-text-1);text-align:left}
.library-index-art{aspect-ratio:2/3;border-radius:14px;background:var(--color-fill-2);display:flex;align-items:center;justify-content:center;color:#ff8b25}
:global(body[arco-theme="dark"]) .library-index-art{background:#202424}
.library-index-card strong{display:block;margin-top:10px;font-size:13px;font-weight:600}
.library-index-list{grid-template-columns:1fr}
.library-index-list .library-index-card{display:flex;align-items:center;gap:22px;padding:12px 0;border-bottom:1px solid var(--color-border-2)}
.library-index-list .library-index-art{width:98px;height:147px;flex-shrink:0}
@media(max-width:1100px){.library-index{grid-template-columns:repeat(5,minmax(0,1fr))}.library-index-list{grid-template-columns:1fr}}
@media(max-width:800px){.library-index{grid-template-columns:repeat(3,minmax(0,1fr))}.library-index-list{grid-template-columns:1fr}.favorite-page-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}}
.source-card{width:180px;height:112px;flex-shrink:0;background:#a85332;border:0;border-radius:16px;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}.source-card span{max-width:calc(100% - 20px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.music-source{background:#345d8b}.book-source{background:#777036}.server-source{background:#704c89}.folder-source{background:#927123}
.source-list{overflow:auto;flex:1;padding:0 18px}.source-list>button{display:flex;align-items:center;gap:18px;padding:16px;width:100%;border:0;border-bottom:1px solid var(--color-border-2);background:transparent;text-align:left}.source-list strong{flex:1}.source-list span{color:var(--color-text-3)}.source-art{width:86px;height:125px;display:grid;place-items:center;border-radius:9px;background:var(--color-fill-2);color:#ff8b25}.source-chevron{transform:rotate(180deg)}
.source-item{display:flex;align-items:center;border-bottom:1px solid var(--color-border-2);padding-right:16px}.source-open{display:flex;align-items:center;gap:18px;padding:16px;flex:1;min-width:0;border:0;background:transparent;text-align:left}.source-open strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-art{flex-shrink:0}
.embedded-workspace{flex:1;min-height:0;overflow:hidden}.home-empty{display:flex;align-items:center;flex-direction:column;padding:40px;color:var(--color-text-3);gap:12px}.load-error{padding:12px;background:var(--color-fill-2);border-radius:8px;margin-bottom:14px}.load-error button{background:transparent;border:0;color:#ff8b25}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinning{animation:none}}@media(max-width:1050px){.unified-sidebar{width:220px}.unified-home{padding:20px}}
.server-category-subtitle{margin-left:14px}.unified-toolbar .server-sort-button{display:flex;width:auto;min-width:72px;max-width:240px;gap:7px;padding:0 12px;border-radius:20px;background:var(--color-fill-3);color:#ff8700;white-space:nowrap}.server-sort-button span{overflow:hidden;text-overflow:ellipsis}.sort-menu-spacer{width:13px;flex-shrink:0}.server-sort-menu{min-width:132px;padding:4px;color:var(--color-text-1);max-height:calc(100vh - 90px);overflow-y:auto}.server-sort-menu button{display:flex;align-items:center;gap:7px;width:100%;min-height:25px;padding:3px 7px;border:0;border-radius:4px;background:transparent;color:inherit;font-size:13px;text-align:left;white-space:nowrap;cursor:pointer}.server-sort-menu button:hover,.server-sort-menu button:focus-visible{background:var(--color-fill-3)}.server-sort-menu .invisible{visibility:hidden}.server-sort-divider{height:1px;margin:5px 3px;background:var(--color-border-2)}
:global(.arco-dropdown-option.unified-action-option){box-sizing:border-box;min-width:190px;width:max-content!important;max-width:calc(100vw - 48px);padding:0 12px!important;line-height:28px!important;margin:2px 4px!important;font-size:13px}:global(.unified-action-option .arco-dropdown-option-icon){display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:16px;margin-right:9px}:global(.unified-action-option .arco-dropdown-option-content){white-space:nowrap;line-height:28px}:global(.unified-action-option svg){display:block;flex-shrink:0}
:global(.arco-dropdown-option.server-root-option){min-width:132px;padding:0 8px!important;margin:1px 3px!important;line-height:25px!important}:global(.server-root-option .arco-dropdown-option-icon){color:#ff8b25!important}
:global(.arco-dropdown-option.browse-sort-option){color:#fff!important}:global(.browse-sort-option .arco-dropdown-option-icon){color:#ff8800!important}
.source-screen-empty{display:flex;flex-direction:column}.source-screen-empty>.source-empty-state{flex:1;min-height:0}
.file-source-browser.file-sources-empty{display:flex;align-items:stretch}.file-sources-empty>.source-empty-state{flex:1;min-height:0}
.file-source-browser{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,174px);align-content:start;gap:22px;padding:22px 36px}.file-source-card{padding:0;border:0;background:transparent;color:var(--color-text-1);text-align:left}.file-source-art{position:relative;aspect-ratio:2/3;border-radius:16px;background:var(--color-fill-2);display:grid;place-items:center;color:#ff8b25}.file-source-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit}.file-source-art input{position:absolute;top:8px;right:8px}.file-source-card strong{display:block;font-size:13px;margin-top:10px}.file-source-list{display:flex;flex-direction:column;padding:0 16px;gap:0}.file-source-list .file-source-card{display:flex;align-items:center;gap:16px;padding:16px;border-bottom:1px solid var(--color-border-2)}.file-source-list .file-source-art{width:86px;height:129px;flex-shrink:0;border-radius:8px}.file-source-list strong{margin:0;font-size:14px}.file-source-subtitle{display:block;margin-top:4px;font-size:12px;font-weight:400;color:var(--color-text-3)}.file-source-handle{margin-left:auto;color:var(--color-text-3)}.file-source-add{background:#ff8700!important;color:white!important;border-radius:22px}
.file-source-art :deep(img.media-server-provider-icon) { position: static; inset: auto; object-fit: contain; border-radius: 0 }
.file-source-art img.file-source-provider-icon{position:static;width:56px;height:56px;object-fit:contain;border-radius:0}
.file-source-list .file-source-art img.file-source-provider-icon{width:28px;height:28px}
.file-sidebar-provider-icon{width:18px;height:18px;flex-shrink:0;object-fit:contain}
:global(.arco-dropdown:has([data-folder-option])){border-radius:12px!important;border:1px solid var(--color-border-3)!important;padding:4px!important;box-shadow:0 12px 24px rgba(0,0,0,.2)}
</style>

<style>
.file-source-selection-bar{position:fixed;right:20px;bottom:36px;z-index:100;display:flex;align-items:center;gap:16px;max-width:calc(100vw - 300px);padding:10px 14px;border:1px solid var(--color-border-2);border-radius:24px;background:var(--color-bg-popup);color:var(--color-text-1);box-shadow:0 6px 20px #0003;overflow-x:auto;white-space:nowrap;font-size:12px}
.file-source-selection-bar button{display:flex;align-items:center;gap:6px;padding:0;border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px;white-space:nowrap}.file-source-selection-bar button svg{color:#ff8800}.file-source-selection-bar button:disabled{opacity:.4;cursor:not-allowed}.file-source-selection-bar .danger svg{color:#ff375f}.file-source-card.source-selected .file-source-art{background:#684220!important;outline:1px solid #ff8800}.file-source-card.source-selected input{accent-color:#ff8800}.file-source-browser:has(+ .file-source-selection-bar){padding-bottom:90px}
.source-context-dismiss{position:fixed;inset:0;z-index:2000}
.source-context-menu{position:absolute;min-width:145px;padding:5px;border:1px solid var(--color-border-3);border-radius:12px;background: var(--app-overlay-bg);box-shadow:0 10px 26px #0004;color:var(--color-text-1)}
.source-context-menu button{display:flex;align-items:center;gap:7px;width:100%;min-height:25px;padding:3px 8px;border:0;border-radius:5px;background:transparent;color:inherit;font-size:13px;cursor:pointer;text-align:left}
.source-context-menu button svg{color:#ff8700;flex-shrink:0}.source-context-menu button:hover,.source-context-menu button:focus-visible{background:var(--color-fill-3)}
body[arco-theme='dark'] .source-context-menu{background: var(--app-overlay-bg);color:#e5e5e5;border-color:#484848}
.source-reorder>div{display:flex;gap:8px;align-items:center;padding:8px}.source-reorder span{flex:1}.source-reorder button{border:0;background:var(--color-fill-2);color:var(--color-text-1);padding:6px;border-radius:5px}
</style>

<style scoped>
.favorite-playlist .favorite-shortcut-art { background:linear-gradient(90deg,#ff452c,#ff9f57); }
</style>
