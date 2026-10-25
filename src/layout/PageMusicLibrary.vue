<script setup lang='ts'>
import MediaEmptyFolder from '../components/MediaEmptyFolder.vue'
import { computed, onMounted, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { ArrowLeft, ListMusic, Mic2, Disc3, Folder, Heart, Music, Play, User, RefreshCw, Search, Sparkles, Radio } from 'lucide-vue-next'
import { useAppStore } from '../store'
import useMusicLibraryStore, { type MusicSubTab } from '../store/musiclibrary'
import { IMusicTrack } from '../types/music'
import { IPageMusic, IPageMusicTrack } from '../store/appstore'
import MusicScanner from '../utils/musicScanner'
import { enrichMusicLibrary } from '../utils/musicEnrichment'
import message from '../utils/message'
import TrialBanner from '../components/radio/TrialBanner.vue'
import PodcastPanel, { type ExternalPodcastFeed } from '../components/radio/PodcastPanel.vue'
import PlaylistManagerPanel from '../components/radio/PlaylistManagerPanel.vue'
import { fetchWeather, getWeatherRadioMood, type WeatherData } from '../utils/radio/WeatherService'
import type { LocalPlaylist } from '../utils/radio/LocalPlaylistManager'
import MusicLibraryRail from './music/MusicLibraryRail.vue'
import UserDAL from '../user/userdal'
import type { ITokenInfo } from '../user/userstore'
import useMediaServerRegistryStore from '../store/mediaServerRegistry'
import { getMediaServerMusicTracks } from '../media-server/contentGateway'
import type { MediaServerMusicTrack } from '../types/mediaServerContent'
import { t as tt } from '../i18n'
import useSettingStore from '../setting/settingstore'
import MusicLibraryBrowser from './music/MusicLibraryBrowser.vue'
import useMusicPlayerStore from '../store/musicplayerstore'

withDefaults(defineProps<{ sidebarVisible?: boolean }>(), { sidebarVisible: true })

const musicStore = useMusicLibraryStore()
const musicPlayerStore = useMusicPlayerStore()
const showSources = ref(false)
const settingStore = useSettingStore()
const appStore = useAppStore()
const mediaServerRegistry = useMediaServerRegistryStore()

const searchQuery = ref('')
const groupDetail = ref<{ type: 'artist' | 'album' | 'folder'; title: string; items: IMusicTrack[] } | null>(null)
const weather = ref<WeatherData | null>(null)
const weatherMood = computed(() => getWeatherRadioMood(weather.value))
const userLabelMap = ref<Record<string, string>>({})
const scanAccounts = ref<ITokenInfo[]>([])
const selectedScanUserIds = ref<string[]>([])
type MusicFolderGroup = ReturnType<typeof useMusicLibraryStore>['byFolder'][number]
type PodcastFolder = {
  key: string
  name: string
  trackCount: number
  lastPlayedAt: number
}
const selectedFolderKeys = ref<string[]>([])
const podcastProgressMap = ref<Record<string, number>>({})
const podcastHiddenKeys = ref<string[]>([])
const podcastManualKeys = ref<string[]>([])
const externalPodcastFeeds = ref<ExternalPodcastFeed[]>([])
const folderContextVisible = ref(false)
const folderContextPosition = ref({ x: 0, y: 0 })
const folderContextGroup = ref<MusicFolderGroup | null>(null)
const mediaServerTracks = ref<MediaServerMusicTrack[]>([])
const mediaServerLoading = ref(false)
const mediaServerError = ref('')

const lastScanText = computed(() => musicStore.lastScanAt ? formatTime(musicStore.lastScanAt) : tt('music.notScannedYet'))
const heroTracks = computed(() => musicStore.recentlyAdded.slice(0, 5))
const heroTrack = computed(() => heroTracks.value[0] || musicStore.tracks[0])
const homeSubtitle = computed(() => {
  const total = tt('music.cloudMusicCount', { count: musicStore.totalCount })
  if (musicStore.hasMoreTracks) return total
  return `${total} · ${tt('music.artistCount', { count: musicStore.byArtist.length })} · ${tt('music.albumCount', { count: musicStore.byAlbum.length })}`
})
const mediaServerSubtitle = computed(() => `${tt('music.serverMusicCount', { count: mediaServerTracks.value.length })} · ${tt('music.mediaServerCount', { count: mediaServerRegistry.servers.length })}`)

const filteredAll = computed<IMusicTrack[]>(() => {
  return musicStore.tracks
})

let trackSearchTimer: number | undefined
watch(searchQuery, (query) => {
  if (trackSearchTimer) window.clearTimeout(trackSearchTimer)
  trackSearchTimer = window.setTimeout(() => {
    void musicStore.loadTrackPage({ reset: true, query }).then((loaded) => {
      if (loaded) scheduleEnrich()
    })
  }, 220)
})

const loadMoreTracks = () => void musicStore.loadTrackPage().then((loaded) => {
  if (loaded) scheduleEnrich()
})
const filteredMediaServerTracks = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return mediaServerTracks.value
  return mediaServerTracks.value.filter((track) => `${track.title} ${track.artist || ''} ${track.album || ''} ${track.serverName}`.toLowerCase().includes(q))
})

const folderContextStyle = computed<CSSProperties>(() => ({
  position: 'fixed',
  left: `${folderContextPosition.value.x}px`,
  top: `${folderContextPosition.value.y}px`,
  zIndex: 9999,
  opacity: folderContextVisible.value ? 1 : 0
}))

const folderContextSelected = computed(() => {
  const group = folderContextGroup.value
  return !!group && selectedFolderKeys.value.includes(group.key)
})

const selectedFolderGroups = computed(() => {
  const keys = new Set(selectedFolderKeys.value)
  return musicStore.byFolder.filter((g) => keys.has(g.key))
})
const musicWindowTheme = computed(() => appStore.appTheme === 'system' ? (appStore.appDark ? 'dark' : 'light') : appStore.appTheme)
const currentPanelTracks = computed<IPageMusicTrack[]>(() => {
  if (groupDetail.value) return groupDetail.value.items.map(trackToPlaylist)
  if (musicStore.subTab === 'server') return mediaServerTracks.value.map(mediaServerTrackToPlaylist)
  if (musicStore.subTab === 'fav') return musicStore.favoritesTracks.map(trackToPlaylist)
  if (musicStore.subTab === 'home') return musicStore.randomPicks.length ? musicStore.randomPicks.map(trackToPlaylist) : musicStore.tracks.slice(0, 20).map(trackToPlaylist)
  return filteredAll.value.slice(0, 80).map(trackToPlaylist)
})
const podcastFolders = computed<PodcastFolder[]>(() => {
  const hidden = new Set(podcastHiddenKeys.value)
  const manual = new Set(podcastManualKeys.value)
  return musicStore.byFolder
    .filter((g) => (g.count >= 3 || manual.has(g.key)) && !hidden.has(g.key))
    .slice(0, 12)
    .map((g) => ({
      key: g.key,
      name: g.name,
      trackCount: g.count,
      lastPlayedAt: Number(localStorage.getItem(`mr.podcast.${g.key}.last`) || 0)
    }))
})

const scanAccountOptions = computed(() => {
  return scanAccounts.value
    .filter((u) => !!u?.user_id && !!u?.access_token)
    .map((u) => ({ value: u.user_id, label: scanAccountLabel(u) }))
})

function formatTime(ts: number): string {
  if (!ts) return tt('music.neverScanned')
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function trackToPlaylist(t: IMusicTrack): IPageMusicTrack {
  return {
    user_id: t.user_id,
    drive_id: t.drive_id,
    file_id: t.file_id,
    parent_file_id: t.parent_file_id,
    file_name: t.file_name,
    ext: t.ext,
    size: t.size,
    category: t.category,
    icon: '',
    thumbnail: t.thumbnail,
    description: t.description,
    duration_ms: t.duration_ms,
    encType: t.encType,
    password: ''
  }
}

function mediaServerTrackToPlaylist(track: MediaServerMusicTrack): IPageMusicTrack {
  return {
    user_id: `media-server:${track.serverId}`,
    drive_id: `media-server:${track.serverId}`,
    file_id: track.id,
    parent_file_id: track.serverId,
    file_name: track.title,
    category: 'audio',
    icon: '',
    thumbnail: track.thumbnail,
    description: [track.artist, track.album, track.serverName].filter(Boolean).join(' · '),
    duration_ms: track.durationMs,
    encType: '',
    password: '',
    media_server_id: track.serverId,
    media_server_item_id: track.id,
    media_server_source_id: track.sourceId
  }
}

function playFromList(list: IMusicTrack[], target: IMusicTrack) {
  if (!list.length) return
  const playlist = list.map(trackToPlaylist)
  const idx = list.findIndex((x) => x.id === target.id)
  if (idx > 0) {
    const head = playlist.splice(idx, 1)[0]
    playlist.unshift(head)
  }
  const pageMusic: IPageMusic = {
    user_id: target.user_id,
    drive_id: target.drive_id,
    file_id: target.file_id,
    parent_file_id: target.parent_file_id,
    parent_file_name: target.parent_path || '',
    file_name: target.file_name,
    encType: target.encType || '',
    password: '',
    playlist
  }
  musicPlayerStore.loadMusic(pageMusic)
  musicPlayerStore.showPanel()
}

function playMediaServerList(list: MediaServerMusicTrack[], target: MediaServerMusicTrack) {
  const playlist = list.map(mediaServerTrackToPlaylist)
  const selected = mediaServerTrackToPlaylist(target)
  playPageTracks(playlist, selected)
}

function playPageTracks(tracks: IPageMusicTrack[], target: IPageMusicTrack = tracks[0]) {
  if (!tracks.length || !target) return
  const playlist = tracks.slice()
  const idx = playlist.findIndex((t) => t.file_id === target.file_id && t.drive_id === target.drive_id && t.user_id === target.user_id)
  if (idx > 0) {
    const head = playlist.splice(idx, 1)[0]
    playlist.unshift(head)
  }
  const pageMusic: IPageMusic = {
    user_id: target.user_id,
    drive_id: target.drive_id,
    file_id: target.file_id,
    parent_file_id: target.parent_file_id,
    parent_file_name: '',
    file_name: target.file_name,
    encType: target.encType || '',
    password: '',
    playlist
  }
  musicPlayerStore.loadMusic(pageMusic)
  musicPlayerStore.showPanel()
}

function shuffleTracks<T>(items: T[]): T[] {
  const next = items.slice()
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = next[i]
    next[i] = next[j]
    next[j] = t
  }
  return next
}

function playWeatherRadio() {
  if (!musicStore.tracks.length) {
    message.warning(tt('music.libraryEmptyScanFirst'))
    return
  }
  const mood = getWeatherRadioMood(weather.value)
  const pool = musicStore.tracks.filter((t) => {
    const name = `${t.title || ''} ${t.file_name || ''} ${t.artist || ''} ${t.album || ''}`.toLowerCase()
    return mood.keywords.test(name)
  })
  const picks = shuffleTracks(pool.length ? pool : musicStore.tracks).slice(0, 30)
  message.success(weather.value ? `${mood.label} · ${weather.value.city} ${weather.value.condition}` : mood.label)
  playPageTracks(picks.map(trackToPlaylist))
}

function playLocalPlaylist(list: LocalPlaylist) {
  if (!list.tracks.length) {
    message.warning(tt('music.playlistEmpty'))
    return
  }
  playPageTracks(list.tracks)
}

function addLocalPlaylistToQueue(tracks: IPageMusicTrack[]) {
  if (!tracks.length) {
    message.warning(tt('music.playlistEmpty'))
    return
  }
  playPageTracks(tracks)
}

function importLocalSongs() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'audio/*,.mp3,.flac,.wav,.m4a,.aac,.ogg,.opus'
  input.multiple = true
  input.onchange = () => {
    const files = Array.from(input.files || []).filter((file) => file.type.startsWith('audio/') || /\.(mp3|flac|wav|m4a|aac|ogg|opus)$/i.test(file.name))
    if (!files.length) {
      message.warning(tt('music.selectAudioFiles'))
      return
    }
    const tracks: IPageMusicTrack[] = files.map((file, index) => ({
      user_id: 'local',
      drive_id: 'local',
      file_id: `local-${Date.now()}-${index}-${file.name}`,
      parent_file_id: 'local',
      file_name: file.name,
      ext: file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1) : '',
      size: file.size,
      category: 'audio',
      icon: '',
      thumbnail: '',
      description: tt('music.localTempSong'),
      encType: '',
      password: '',
      local_url: window.WebGetPathForFile?.(file) || URL.createObjectURL(file)
    }))
    message.success(tt('music.importLocalSuccess', { count: tracks.length }))
    playPageTracks(tracks)
  }
  input.click()
}

function playHeroTrack() {
  const track = heroTrack.value
  if (!track) return
  playFromList(musicStore.tracks, track)
}

async function refreshMediaServerMusic() {
  mediaServerRegistry.ensureLoaded()
  const servers = mediaServerRegistry.servers.filter((server) => !!server.accessToken && !!server.baseUrl)
  if (!servers.length) {
    mediaServerTracks.value = []
    mediaServerError.value = tt('music.noMediaServer')
    return
  }
  mediaServerLoading.value = true
  mediaServerError.value = ''
  try {
    const results = await Promise.allSettled(servers.map((server) => getMediaServerMusicTracks(server)))
    const tracks: MediaServerMusicTrack[] = []
    const failures: string[] = []
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') tracks.push(...result.value)
      else failures.push(servers[index].name)
    })
    mediaServerTracks.value = tracks.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    if (failures.length) mediaServerError.value = tt('music.mediaServerReadFailed', { names: failures.join(', ') })
  } finally {
    mediaServerLoading.value = false
  }
}

function openGroupDetail(type: 'artist' | 'album' | 'folder', title: string, items: IMusicTrack[]) {
  groupDetail.value = { type, title, items }
}

function groupTypeLabel(type: 'artist' | 'album' | 'folder'): string {
  if (type === 'artist') return tt('music.artist')
  if (type === 'album') return tt('music.album')
  return tt('common.folder')
}

function driveLabel(driveId: string, userId = ''): string {
  if (driveId === 'cloud123') return tt('drive.cloud123')
  if (driveId === 'drive115') return tt('drive.drive115')
  if (driveId === 'cloud139') return tt('drive.cloud139')
  if (driveId === 'cloud189') return tt('drive.cloud189')
  if (driveId === 'baidu') return tt('drive.baiduFull')
  if (driveId === 'pikpak') return 'PikPak'
  if (driveId === 'quark') return tt('drive.quarkFull')
  if (driveId === 'dropbox') return 'Dropbox'
  if (driveId === 'onedrive') return 'OneDrive'
  if (driveId === 'box') return 'Box'
  if (driveId.includes('resource')) return `${tt('drive.aliyun')} ${tt('drive.resource')}`
  if (driveId.includes('backup')) return `${tt('drive.aliyun')} ${tt('drive.backup')}`
  if (userId.startsWith('aliyun_') || driveId) return tt('drive.aliyun')
  return tt('music.unknownDrive')
}

function driveLabelFromToken(token: ITokenInfo): string {
  if (token.tokenfrom === 'cloud123') return tt('drive.cloud123')
  if (token.tokenfrom === '115') return tt('drive.drive115')
  if (token.tokenfrom === '139') return tt('drive.cloud139')
  if (token.tokenfrom === '189') return tt('drive.cloud189')
  if (token.tokenfrom === 'baidu') return tt('drive.baiduFull')
  if (token.tokenfrom === 'pikpak') return 'PikPak'
  if (token.tokenfrom === 'quark') return tt('drive.quarkFull')
  if (token.tokenfrom === 'dropbox') return 'Dropbox'
  if (token.tokenfrom === 'onedrive') return 'OneDrive'
  if (token.tokenfrom === 'box') return 'Box'
  return tt('drive.aliyun')
}

function scanAccountLabel(token: ITokenInfo): string {
  return `${driveLabelFromToken(token)} · ${token.nick_name || token.user_name || token.name || token.user_id}`
}

function userLabel(userId: string): string {
  return userLabelMap.value[userId] || userId || tt('music.unknownAccount')
}

function sourceLabel(t?: IMusicTrack): string {
  if (!t) return ''
  return `${driveLabel(t.drive_id, t.user_id)} · ${userLabel(t.user_id)}`
}

function folderSourceLabel(g: { user_id?: string; drive_id?: string }): string {
  return `${driveLabel(g.drive_id || '', g.user_id || '')} · ${userLabel(g.user_id || '')}`
}

function toggleFolderSelected(g: MusicFolderGroup) {
  const set = new Set(selectedFolderKeys.value)
  if (set.has(g.key)) set.delete(g.key)
  else set.add(g.key)
  selectedFolderKeys.value = Array.from(set)
}

function openFolderCard(g: MusicFolderGroup) {
  if (selectedFolderKeys.value.length > 0) {
    toggleFolderSelected(g)
    return
  }
  openGroupDetail('folder', g.name, g.items)
}

function playPodcastFolder(folder: PodcastFolder) {
  const group = musicStore.byFolder.find((g) => g.key === folder.key)
  if (!group?.items.length) return
  updatePodcastProgress(folder.key, group.items.length, 0)
  playFromList(group.items, group.items[0])
}

function continuePodcastFolder(folder: PodcastFolder) {
  const group = musicStore.byFolder.find((g) => g.key === folder.key)
  if (!group?.items.length) return
  const progress = Math.max(0, Math.min(0.98, podcastProgressMap.value[folder.key] || 0))
  const index = Math.min(group.items.length - 1, Math.floor(progress * group.items.length))
  updatePodcastProgress(folder.key, group.items.length, index)
  playFromList(group.items, group.items[index])
}

function updatePodcastProgress(folderKey: string, total: number, index: number) {
  const next = total > 0 ? Math.min(0.98, Math.max((index + 1) / total, podcastProgressMap.value[folderKey] || 0)) : 0
  localStorage.setItem(`mr.podcast.${folderKey}.last`, String(Date.now()))
  podcastProgressMap.value = { ...podcastProgressMap.value, [folderKey]: next }
  localStorage.setItem('mr.podcast.progress', JSON.stringify(podcastProgressMap.value))
}

function togglePodcastFolder(folder: PodcastFolder) {
  const hidden = new Set(podcastHiddenKeys.value)
  hidden.add(folder.key)
  podcastHiddenKeys.value = Array.from(hidden)
  localStorage.setItem('mr.podcast.hidden', JSON.stringify(podcastHiddenKeys.value))
  message.success(tt('music.hiddenFromPodcast', { name: folder.name }))
}

function toggleContextFolderPodcast() {
  const g = folderContextGroup.value
  closeFolderContextMenu()
  if (!g) return
  const manual = new Set(podcastManualKeys.value)
  const hidden = new Set(podcastHiddenKeys.value)
  if (manual.has(g.key)) {
    manual.delete(g.key)
    message.success(tt('music.unmarkedPodcast', { name: g.name }))
  } else {
    manual.add(g.key)
    hidden.delete(g.key)
    message.success(tt('music.markedPodcast', { name: g.name }))
  }
  podcastManualKeys.value = Array.from(manual)
  podcastHiddenKeys.value = Array.from(hidden)
  localStorage.setItem('mr.podcast.manual', JSON.stringify(podcastManualKeys.value))
  localStorage.setItem('mr.podcast.hidden', JSON.stringify(podcastHiddenKeys.value))
}

function restoreHiddenPodcasts() {
  if (!podcastHiddenKeys.value.length) return
  podcastHiddenKeys.value = []
  localStorage.setItem('mr.podcast.hidden', JSON.stringify([]))
  message.success(tt('music.restoredPodcastCandidates'))
}

function normalizeExternalPodcastUrl(url: string): string {
  const trimmed = url.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function addExternalPodcastFeed(feed: { title: string; url: string }) {
  const url = normalizeExternalPodcastUrl(feed.url)
  if (!/^https?:\/\/[^/\s]+/i.test(url)) {
    message.warning(tt('music.enterValidPodcastLink'))
    return
  }
  if (externalPodcastFeeds.value.some((item) => item.url === url)) {
    message.warning(tt('music.podcastLinkImported'))
    return
  }
  const title = feed.title.trim() || new URL(url).hostname
  const next: ExternalPodcastFeed = {
    id: `podcast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    url,
    addedAt: Date.now()
  }
  externalPodcastFeeds.value = [next, ...externalPodcastFeeds.value].slice(0, 24)
  localStorage.setItem('mr.podcast.externalFeeds', JSON.stringify(externalPodcastFeeds.value))
  message.success(tt('music.importedPodcastLink', { title }))
}

function removeExternalPodcastFeed(feed: ExternalPodcastFeed) {
  externalPodcastFeeds.value = externalPodcastFeeds.value.filter((item) => item.id !== feed.id)
  localStorage.setItem('mr.podcast.externalFeeds', JSON.stringify(externalPodcastFeeds.value))
  message.success(tt('music.deletedPodcastLink', { title: feed.title || feed.url }))
}

function openExternalPodcastFeed(feed: ExternalPodcastFeed) {
  window.open(feed.url, '_blank', 'noopener,noreferrer')
}

function openFolderContextMenu(event: MouseEvent, g: MusicFolderGroup) {
  event.preventDefault()
  event.stopPropagation()
  folderContextGroup.value = g
  folderContextPosition.value = { x: event.clientX, y: event.clientY }
  folderContextVisible.value = true
}

function closeFolderContextMenu() {
  folderContextVisible.value = false
  folderContextGroup.value = null
}

async function deleteFolderGroups(groups: MusicFolderGroup[]) {
  const uniq = new Set<string>()
  let trackCount = 0
  for (const g of groups) {
    trackCount += g.items.length
    for (const t of g.items) uniq.add(t.id)
  }
  if (!groups.length) return
  const groupCount = groups.length
  const ok = window.confirm(tt('music.confirmDeleteFolderRecords', { groupCount, trackCount }))
  if (!ok) return
  for (const group of groups) {
    if (group.source_id) {
      await musicStore.deleteSource(group.source_id)
      const next = (settingStore.uiMusicAutoScanFolders || []).filter(folder =>
        `${folder.user_id}|${folder.drive_id}|${folder.file_id}` !== `${group.user_id}|${group.drive_id}|${group.folder_id || ''}`
      )
      if (next.length !== (settingStore.uiMusicAutoScanFolders || []).length) {
        await settingStore.updateStore({ uiMusicAutoScanFolders: next })
      }
    }
  }
  const legacyIds = groups.filter(group => !group.source_id).flatMap(group => group.items.map(track => track.id))
  if (legacyIds.length) await musicStore.deleteTracksByIds(legacyIds)
  selectedFolderKeys.value = selectedFolderKeys.value.filter((key) => musicStore.byFolder.some((g) => g.key === key))
  if (groupDetail.value?.type === 'folder' && groups.some((g) => g.items.some((t) => groupDetail.value?.items.some((gt) => gt.id === t.id)))) {
    groupDetail.value = null
  }
  message.success(tt('music.deletedLibraryRecords', { count: trackCount }))
}

function deleteCurrentFolderFromMenu() {
  const g = folderContextGroup.value
  closeFolderContextMenu()
  if (!g) return
  deleteFolderGroups([g])
}

function deleteSelectedFoldersFromMenu() {
  const groups = selectedFolderGroups.value
  closeFolderContextMenu()
  if (!groups.length) return
  deleteFolderGroups(groups)
}

function toggleContextFolderSelected() {
  const g = folderContextGroup.value
  if (g) toggleFolderSelected(g)
  closeFolderContextMenu()
}

function closeGroupDetail() {
  groupDetail.value = null
}

async function startScan() {
  if (musicStore.isScanning) {
    message.info(tt('music.scanInProgress'))
    return
  }
  if (!selectedScanUserIds.value.length) {
    message.warning(tt('music.selectDriveToScan'))
    return
  }
  message.info(tt('music.scanStarted'))
  try {
    await MusicScanner.getInstance().scanAllUsers({
      force: false,
      userIdAllowList: new Set(selectedScanUserIds.value)
    })
    message.success(tt('music.scanCompleted', { count: musicStore.totalCount }))
    scheduleEnrich(800)
  } catch (e) {
    message.error(tt('music.scanFailed', { message: (e as Error).message }))
  }
}

function stopScan() {
  MusicScanner.getInstance().stopScan()
}

async function clearLibrary() {
  await musicStore.clearAll()
  message.success(tt('music.libraryCleared'))
}

async function selectTab(t: MusicSubTab) {
  musicStore.setSubTab(t)
  if (t === 'artists' || t === 'albums' || t === 'folders') await musicStore.loadAllTracks()
  scheduleEnrich()
}

function artistCover(g: { items: IMusicTrack[] }): string {
  return coverSource(artistCoverTrack(g))
}

function artistCoverTrack(g: { items: IMusicTrack[] }): IMusicTrack | undefined {
  for (const t of g.items) {
    if (coverSource(t)) return t
  }
  return undefined
}

const coverDebugSeen = new Set<string>()
const COVER_DEBUG_LIMIT = 20

function coverSource(t?: IMusicTrack): string {
  if (!t) return ''
  return t.cover_url || t.thumbnail || ''
}

function coverSourceType(t?: IMusicTrack): 'cover_url' | 'thumbnail' | 'empty' {
  if (!t) return 'empty'
  if (t.cover_url) return 'cover_url'
  if (t.thumbnail) return 'thumbnail'
  return 'empty'
}

function debugCoverLoad(t: IMusicTrack, area: string, event: Event) {
  const img = event.target as HTMLImageElement | null
  if (!img) return
  const key = `${area}:${t.id}:${img.currentSrc || img.src}`
  if (coverDebugSeen.has(key) || coverDebugSeen.size >= COVER_DEBUG_LIMIT) return
  coverDebugSeen.add(key)
  const rect = img.getBoundingClientRect()
  const style = window.getComputedStyle(img)
}

function debugCoverError(t: IMusicTrack, area: string, event: Event) {
  
}

let enrichTimer: number | undefined
let enrichLoopActive = false
async function runEnrichLoop() {
  if (enrichLoopActive) return
  enrichLoopActive = true
  try {
    while (musicStore.totalCount > 0) {
      const got = await enrichMusicLibrary(40)
      if (got <= 0) break
      await new Promise((r) => setTimeout(r, 1500))
    }
  } catch { /* ignore */ }
  finally {
    enrichLoopActive = false
  }
}
function scheduleEnrich(delayMs: number = 600) {
  if (enrichTimer) {
    window.clearTimeout(enrichTimer)
  }
  enrichTimer = window.setTimeout(() => {
    enrichTimer = undefined
    if (!musicStore.totalCount) return
    runEnrichLoop()
  }, delayMs) as unknown as number
}

function stripExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

function homeTone(i: number): string {
  return ['mix', 'local', 'library', 'search', 'playlist'][i % 5]
}

onMounted(async () => {
  await musicStore.loadFromDB()
  if (musicStore.subTab === 'artists' || musicStore.subTab === 'albums' || musicStore.subTab === 'folders') await musicStore.loadAllTracks()
  const users = await UserDAL.GetUserListFromDB().catch(() => [])
  scanAccounts.value = users.filter((u) => !!u?.user_id && !!u?.access_token)
  selectedScanUserIds.value = scanAccounts.value.map((u) => u.user_id)
  const map: Record<string, string> = {}
  for (const u of users) {
    if (!u?.user_id) continue
    map[u.user_id] = u.nick_name || u.user_name || u.name || u.user_id
  }
  userLabelMap.value = map
  await refreshMediaServerMusic()
  try {
    podcastProgressMap.value = JSON.parse(localStorage.getItem('mr.podcast.progress') || '{}')
  } catch {
    podcastProgressMap.value = {}
  }
  try {
    podcastHiddenKeys.value = JSON.parse(localStorage.getItem('mr.podcast.hidden') || '[]')
    podcastManualKeys.value = JSON.parse(localStorage.getItem('mr.podcast.manual') || '[]')
    externalPodcastFeeds.value = JSON.parse(localStorage.getItem('mr.podcast.externalFeeds') || '[]')
  } catch {
    podcastHiddenKeys.value = []
    podcastManualKeys.value = []
    externalPodcastFeeds.value = []
  }
  scheduleEnrich(1500)
  fetchWeather().then(w => { weather.value = w }).catch(() => {})
})
defineExpose({ playFromList, selectTab })
</script>

<template>
  <div class="aml">
    <MusicLibraryBrowser v-if="!showSources" :tracks="musicStore.tracks" :total="musicStore.totalCount" :loading="musicStore.isLoadingPage" :has-more="musicStore.hasMoreTracks" @load-all="musicStore.loadAllTracks()" @load-more="loadMoreTracks" @play="playPageTracks" @sources="showSources = true" />
    <button v-if="showSources" class="music-source-back" @click="showSources = false"><ArrowLeft :size="18" /> 返回音乐</button>
    <div v-if="showSources" class="aml-main-row">
      <MusicLibraryRail
        v-show="sidebarVisible"
        v-model:selected-scan-user-ids="selectedScanUserIds"
        :last-scan-text="lastScanText"
        :scan-account-options="scanAccountOptions"
        @clear-library="clearLibrary"
        @select-tab="selectTab"
        @start-scan="startScan"
        @stop-scan="stopScan"
        @import-local-songs="importLocalSongs"
      />

      <!-- Content Area -->
      <div class="aml-content-area">
        <!-- Header -->
        <TrialBanner v-if="musicStore.totalCount > 0" :track-count="musicStore.totalCount" :is-scanning="musicStore.isScanning" :last-scan-at="musicStore.lastScanAt" @import-local-songs="importLocalSongs" @start-scan="startScan" />
        <button v-if="weather && musicStore.subTab === 'home'" class="aml-weather-chip" :title="tt('music.playWeatherRadio')" @click="playWeatherRadio">
          <span class="aml-weather-icon">{{ weather.icon }}</span>
          <span class="aml-weather-temp">{{ weather.temperature }}°</span>
          <span class="aml-weather-city">{{ weather.city }}</span>
          <span class="aml-weather-mood">{{ weatherMood.label }}</span>
          <Radio :size="13" :stroke-width="1.7" />
        </button>
        <div class="aml-header">
          <div class="aml-header-left">
            <Music :size="22" :stroke-width="1.5" class="aml-header-icon" />
            <span v-if="groupDetail" class="aml-back" @click="closeGroupDetail">
              <ArrowLeft :size="18" :stroke-width="1.5" />
            </span>
            <h2 class="aml-title">{{ groupDetail ? groupDetail.title : musicStore.subTab === 'server' ? tt('music.serverMusic') : tt('music.music') }}</h2>
            <span v-if="groupDetail" class="aml-title-sub">{{ groupTypeLabel(groupDetail.type) }} · {{ groupDetail.items.length }} {{ tt('music.tracksUnit') }}</span>
          </div>
          <div class="aml-header-right">
            <div class="aml-search-box">
              <Search :size="14" :stroke-width="1.5" class="aml-search-icon" />
              <input v-model="searchQuery" :placeholder="tt('music.searchLibrary')" class="aml-search-input" />
              <button v-if="searchQuery" class="aml-search-clear" @click="searchQuery = ''">✕</button>
            </div>
            <a-button v-if="groupDetail" type="primary" size="small" @click="playFromList(groupDetail.items, groupDetail.items[0])">
              <Play :size="14" :stroke-width="2" /> {{ tt('music.play') }}
            </a-button>
            <a-button v-else-if="musicStore.subTab === 'server'" size="small" :loading="mediaServerLoading" @click="refreshMediaServerMusic">
              <RefreshCw :size="14" :stroke-width="2" /> {{ tt('common.refresh') }}
            </a-button>
          </div>
        </div>

        <!-- Scanning progress -->
        <div v-if="musicStore.isScanning" class="aml-scan-bar">
          <div class="aml-scan-track">
            <div class="aml-scan-fill"></div>
          </div>
          <span class="aml-scan-text">
            {{ musicStore.scanLabel || tt('music.scanning') }} · {{ musicStore.scanScanned }} {{ tt('music.filesUnit') }} · {{ tt('music.indexed') }} {{ musicStore.scanFound }} {{ tt('music.tracksUnit') }}
          </span>
        </div>

        <!-- Content scroll -->
        <div class="aml-scroll-area">

          <!-- Group detail view -->
          <div v-if="groupDetail" class="aml-group-detail">
            <div class="aml-tracklist">
              <div
                v-for="(t, i) in groupDetail.items"
                :key="t.id"
                class="aml-track"
                @click="playFromList(groupDetail.items, t)"
              >
                <span class="aml-track-idx">{{ i + 1 }}</span>
                <div class="aml-track-cover">
                  <img v-if="t.cover_url || t.thumbnail" :src="coverSource(t)" alt="" @load="debugCoverLoad(t, 'group-detail', $event)" @error="debugCoverError(t, 'group-detail', $event)" />
                  <Music v-else :size="16" :stroke-width="1.5" />
                </div>
                <div class="aml-track-meta">
                  <div class="aml-track-title">{{ t.title || stripExt(t.file_name) }}</div>
                  <div class="aml-track-artist">{{ t.artist || tt('music.unknownArtist') }}<span v-if="t.album"> — {{ t.album }}</span></div>
                </div>
                <div class="aml-track-source">{{ sourceLabel(t) }}</div>
              </div>
            </div>
          </div>

          <!-- Home page -->
          <div v-else-if="musicStore.subTab === 'home'" class="aml-home">
            <MediaEmptyFolder v-if="!musicStore.totalCount" />
            <template v-else>
              <section class="aml-home-hero mineradio-library">
                <div class="aml-home-copy">
                  <div class="aml-home-kicker">
                    <Sparkles :size="15" :stroke-width="1.7" />
                    BoxPlayer
                  </div>
                  <h1>{{ heroTrack?.title || stripExt(heroTrack?.file_name || tt('music.cloudMusic')) }}</h1>
                  <p>{{ heroTrack?.artist || heroTrack?.album || homeSubtitle }}</p>
                  <div class="aml-home-actions">
                    <button class="aml-home-play" @click="playHeroTrack">
                      <Play :size="18" :stroke-width="2" fill="currentColor" /> {{ tt('music.play') }}
                    </button>
                    <button class="aml-home-ghost" @click="musicStore.rerollRandom()">
                      <RefreshCw :size="16" :stroke-width="1.6" /> {{ tt('music.shuffleGroup') }}
                    </button>
                    <button v-if="weather" class="aml-home-ghost" @click="playWeatherRadio">
                      <Radio :size="16" :stroke-width="1.6" /> {{ weatherMood.label }}
                    </button>
                  </div>
                  <div class="aml-home-stats">{{ homeSubtitle }}</div>
                </div>
                <div class="aml-home-wall" aria-hidden="true">
                  <div
                    v-for="(t, i) in heroTracks"
                    :key="t.id"
                    class="aml-home-wall-card"
                    :style="{ '--i': i }"
                  >
                    <img v-if="t.cover_url || t.thumbnail" :src="coverSource(t)" alt="" />
                    <Music v-else :size="34" :stroke-width="1.3" />
                  </div>
                </div>
              </section>

              <section class="aml-hscroll-section aml-home-section-panel aml-home-tile-panel">
                <div class="aml-home-section-head">
                  <div class="aml-section-label">{{ tt('media.recentlyAdded') }}</div>
                  <div class="aml-home-section-note">RECENT CLOUD TRACKS</div>
                </div>
                <div class="aml-home-tile-row">
                  <button
                    v-for="(t, i) in musicStore.recentlyAdded.slice(0, 10)"
                    :key="t.id"
                    class="aml-home-tile"
                    :data-home-tone="homeTone(i)"
                    @click="playFromList(musicStore.recentlyAdded, t)"
                  >
                    <span :class="['aml-home-tile-cover', coverSource(t) ? 'has-cover' : '']">
                      <img v-if="t.cover_url || t.thumbnail" :src="coverSource(t)" alt="" @load="debugCoverLoad(t, 'recently-added', $event)" @error="debugCoverError(t, 'recently-added', $event)" />
                    </span>
                    <span class="aml-home-tile-title">{{ t.title || stripExt(t.file_name) }}</span>
                    <span class="aml-home-tile-sub">{{ t.artist || t.album || sourceLabel(t) || tt('music.unknownArtist') }}</span>
                  </button>
                </div>
              </section>

              <section class="aml-section aml-home-section-panel aml-home-card-panel">
                <div class="aml-home-section-head">
                  <div class="aml-section-label">
                    {{ tt('music.recommended') }}
                    <button class="aml-reroll-btn" @click="musicStore.rerollRandom()">
                      <RefreshCw :size="13" :stroke-width="1.5" />
                    </button>
                  </div>
                  <div class="aml-home-section-note">FOR YOUR DRIVE LIBRARY</div>
                </div>
                <div class="aml-home-card-grid">
                  <button
                    v-for="(t, i) in musicStore.randomPicks.slice(0, 6)"
                    :key="t.id"
                    class="aml-home-card"
                    :data-home-tone="homeTone(i + 2)"
                    @click="playFromList(musicStore.randomPicks, t)"
                  >
                    <span class="aml-home-card-label">{{ (t.ext || coverSourceType(t)).replace('.', '').toUpperCase() }}</span>
                    <span class="aml-home-card-title">{{ t.title || stripExt(t.file_name) }}</span>
                    <span class="aml-home-card-sub">{{ t.artist || t.album || sourceLabel(t) || tt('music.unknownArtist') }}</span>
                    <span :class="['aml-home-card-art', coverSource(t) ? 'has-cover' : '']">
                      <img v-if="t.cover_url || t.thumbnail" :src="coverSource(t)" alt="" @load="debugCoverLoad(t, 'random-picks', $event)" @error="debugCoverError(t, 'random-picks', $event)" />
                    </span>
                  </button>
                </div>
              </section>

              <section class="aml-section aml-home-section-panel aml-home-track-panel">
                <div class="aml-home-section-head">
                  <div class="aml-section-label">
                    {{ tt('music.songs') }}
                  <button class="aml-reroll-btn" @click="musicStore.rerollRandom()">
                    <RefreshCw :size="13" :stroke-width="1.5" />
                  </button>
                  </div>
                  <div class="aml-home-section-note">BOXPLAYER RADIO LIST</div>
                </div>
                <div class="aml-home-song-list">
                  <button
                    v-for="(t, i) in musicStore.randomPicks.slice(0, 12)"
                    :key="t.id"
                    class="aml-home-song-item"
                    @click="playFromList(musicStore.randomPicks, t)"
                  >
                    <span class="aml-home-song-index">{{ String(i + 1).padStart(2, '0') }}</span>
                    <span class="aml-home-song-cover">
                      <img v-if="t.cover_url || t.thumbnail" :src="coverSource(t)" alt="" @load="debugCoverLoad(t, 'random-picks', $event)" @error="debugCoverError(t, 'random-picks', $event)" />
                      <Music v-else :size="32" :stroke-width="1.5" />
                    </span>
                    <span class="aml-home-song-main">
                      <span class="aml-home-song-title">{{ t.title || stripExt(t.file_name) }}</span>
                      <span class="aml-home-song-sub">{{ t.artist || tt('music.unknownArtist') }}<span v-if="t.album"> · {{ t.album }}</span></span>
                    </span>
                    <span class="aml-home-song-source">{{ sourceLabel(t) }}</span>
                  </button>
                </div>
              </section>
            </template>
          </div>

          <div v-else-if="musicStore.subTab === 'server'" class="aml-all-songs">
            <div class="aml-server-note">{{ mediaServerSubtitle }}</div>
            <div v-if="mediaServerError" class="aml-server-error">{{ mediaServerError }}</div>
            <div v-if="mediaServerLoading" class="aml-empty-state">
              <RefreshCw :size="38" :stroke-width="1.2" class="aml-empty-icon" />
              <div class="aml-empty-title">{{ tt('music.loadingServerMusic') }}</div>
            </div>
            <MediaEmptyFolder v-else-if="!filteredMediaServerTracks.length" />
            <div v-else class="aml-tracklist">
              <div v-for="(t, i) in filteredMediaServerTracks" :key="`${t.serverId}:${t.id}`" class="aml-track" @click="playMediaServerList(filteredMediaServerTracks, t)">
                <span class="aml-track-idx">{{ i + 1 }}</span>
                <div class="aml-track-cover">
                  <img v-if="t.thumbnail" :src="t.thumbnail" alt="" />
                  <Music v-else :size="16" :stroke-width="1.5" />
                </div>
                <div class="aml-track-meta">
                  <div class="aml-track-title">{{ t.title }}</div>
                  <div class="aml-track-artist">{{ t.artist || tt('music.unknownArtist') }}<span v-if="t.album"> — {{ t.album }}</span></div>
                </div>
                <div class="aml-track-source">{{ t.serverName }} · {{ t.provider === 'plex' ? 'Plex' : t.provider === 'emby' ? 'Emby' : 'Jellyfin' }}</div>
              </div>
            </div>
          </div>

          <!-- All songs -->
          <div v-else-if="musicStore.subTab === 'all'" class="aml-all-songs">
            <MediaEmptyFolder v-if="!filteredAll.length" />
            <div v-else class="aml-tracklist">
              <div
                v-for="(t, i) in filteredAll"
                :key="t.id"
                class="aml-track"
                @click="playFromList(filteredAll, t)"
              >
                <span class="aml-track-idx">{{ i + 1 }}</span>
                <div class="aml-track-cover">
                  <img v-if="t.cover_url || t.thumbnail" :src="coverSource(t)" alt="" @load="debugCoverLoad(t, 'all-songs', $event)" @error="debugCoverError(t, 'all-songs', $event)" />
                  <Music v-else :size="16" :stroke-width="1.5" />
                </div>
                <div class="aml-track-meta">
                  <div class="aml-track-title">{{ t.title || stripExt(t.file_name) }}</div>
                  <div class="aml-track-artist">{{ t.artist || tt('music.unknownArtist') }}</div>
                </div>
                <div class="aml-track-album">{{ t.album || '' }}</div>
              </div>
            </div>
            <div v-if="musicStore.hasMoreTracks" class="aml-load-more">
              <a-button :loading="musicStore.isLoadingPage" @click="loadMoreTracks">加载更多</a-button>
            </div>
          </div>

          <!-- Artists -->
          <div v-else-if="musicStore.subTab === 'artists'" class="aml-grid-view">
            <MediaEmptyFolder v-if="!musicStore.byArtist.length" />
            <div v-else class="aml-grid">
              <div
                v-for="g in musicStore.byArtist"
                :key="g.artist"
                class="aml-card"
                @click="openGroupDetail('artist', g.artist, g.items)"
              >
                <div class="aml-card-cover circle">
                  <img v-if="artistCoverTrack(g)" :src="artistCover(g)" alt="" @load="debugCoverLoad(artistCoverTrack(g)!, 'artist', $event)" @error="debugCoverError(artistCoverTrack(g)!, 'artist', $event)" />
                  <User v-else :size="32" :stroke-width="1.5" />
                </div>
                <div class="aml-card-title">{{ g.artist }}</div>
                <div class="aml-card-sub">{{ g.count }} {{ tt('music.tracksUnit') }}</div>
              </div>
            </div>
          </div>

          <!-- Albums -->
          <div v-else-if="musicStore.subTab === 'albums'" class="aml-grid-view">
            <MediaEmptyFolder v-if="!musicStore.byAlbum.length" />
            <div v-else class="aml-grid">
              <div
                v-for="g in musicStore.byAlbum"
                :key="g.album"
                class="aml-card"
                @click="openGroupDetail('album', g.album, g.items)"
              >
                <div class="aml-card-cover">
                  <img v-if="g.items[0]?.cover_url || g.items[0]?.thumbnail" :src="coverSource(g.items[0])" alt="" @load="debugCoverLoad(g.items[0], 'album', $event)" @error="debugCoverError(g.items[0], 'album', $event)" />
                  <Disc3 v-else :size="32" :stroke-width="1.5" />
                </div>
                <div class="aml-card-title">{{ g.album }}</div>
                <div class="aml-card-sub">{{ g.count }} {{ tt('music.tracksUnit') }}</div>
              </div>
            </div>
          </div>

          <!-- Folders -->
          <div v-else-if="musicStore.subTab === 'folders'" class="aml-grid-view">
            <MediaEmptyFolder v-if="!musicStore.byFolder.length" />
            <div v-else class="aml-grid">
              <div
                v-for="g in musicStore.byFolder"
                :key="g.key"
                :class="['aml-card', selectedFolderKeys.includes(g.key) ? 'selected' : '']"
                @click="openFolderCard(g)"
                @contextmenu.prevent="openFolderContextMenu($event, g)"
              >
                <div class="aml-card-cover folder">
                  <div class="aml-folder-check" :class="{ checked: selectedFolderKeys.includes(g.key) }" @click.stop="toggleFolderSelected(g)">
                    <span v-if="selectedFolderKeys.includes(g.key)">✓</span>
                  </div>
                  <Folder :size="36" :stroke-width="1.5" />
                </div>
                <div class="aml-card-title">{{ g.name }}</div>
                <div class="aml-card-sub">{{ g.count }} {{ tt('music.tracksUnit') }} · {{ folderSourceLabel(g) }}</div>
              </div>
            </div>
          </div>

          <!-- Favorites -->
          <div v-else-if="musicStore.subTab === 'fav'" class="aml-fav-songs">
            <MediaEmptyFolder v-if="!musicStore.favoritesTracks.length" />
            <div v-else class="aml-tracklist">
              <div
                v-for="(t, i) in musicStore.favoritesTracks"
                :key="t.id"
                class="aml-track"
                @click="playFromList(musicStore.favoritesTracks, t)"
              >
                <span class="aml-track-idx">{{ i + 1 }}</span>
                <div class="aml-track-cover">
                  <img v-if="t.cover_url || t.thumbnail" :src="coverSource(t)" alt="" @load="debugCoverLoad(t, 'favorites', $event)" @error="debugCoverError(t, 'favorites', $event)" />
                  <Music v-else :size="16" :stroke-width="1.5" />
                </div>
                <div class="aml-track-meta">
                  <div class="aml-track-title">{{ t.title || stripExt(t.file_name) }}</div>
                  <div class="aml-track-artist">{{ t.artist || tt('music.unknownArtist') }}</div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <aside class="aml-right-panel">
        <PlaylistManagerPanel
          :current-tracks="currentPanelTracks"
          @add-to-queue="addLocalPlaylistToQueue"
          @play="playLocalPlaylist"
        />
        <PodcastPanel
          :external-feeds="externalPodcastFeeds"
          :folders="podcastFolders"
          :hidden-count="podcastHiddenKeys.length"
          :progress-map="podcastProgressMap"
          @add-external="addExternalPodcastFeed"
          @continue="continuePodcastFolder"
          @open-external="openExternalPodcastFeed"
          @play="playPodcastFolder"
          @remove-external="removeExternalPodcastFeed"
          @restore-hidden="restoreHiddenPodcasts"
          @toggle-mark="togglePodcastFolder"
        />
      </aside>

      <!-- Folder context menu -->
      <a-dropdown
        :popup-visible="folderContextVisible"
        :style="folderContextStyle"
        @popup-visible-change="closeFolderContextMenu"
      >
        <div style="width:1px;height:1px;visibility:hidden" />
        <template #content>
          <div class="aml-folder-menu">
            <button class="aml-folder-menu-item" @click="toggleContextFolderSelected">
              {{ folderContextSelected ? tt('transfer.cancelSelection') : tt('music.selectFolder') }}
            </button>
            <button class="aml-folder-menu-item" @click="toggleContextFolderPodcast">
              {{ folderContextGroup && podcastManualKeys.includes(folderContextGroup.key) ? tt('music.unmarkPodcast') : tt('music.markAsPodcast') }}
            </button>
            <button class="aml-folder-menu-item danger" @click="deleteCurrentFolderFromMenu">{{ tt('music.deleteFolderRecord') }}</button>
            <button class="aml-folder-menu-item danger" :disabled="!selectedFolderGroups.length" @click="deleteSelectedFoldersFromMenu">
              {{ tt('music.deleteSelectedFolders') }}（{{ selectedFolderGroups.length }}）
            </button>
          </div>
        </template>
      </a-dropdown>
    </div>
  </div>
</template>

<style scoped>
.music-source-back { display:flex; align-items:center; gap:8px; color:var(--color-text-1); background:var(--color-bg-1); border:0; padding:10px 20px; cursor:pointer; }
/* ===== Mineradio Music Library ===== */

.aml {
  --music-ui-text: #fff;
  --music-ui-muted: rgba(255,255,255,.78);
  --fc-bg: #08090b;
  --fc-paper: #0e1014;
  --fc-ink: #e8ecef;
  --fc-accent: #00f5d4;
  --fc-blue: #2442ff;
  --champagne: #f4d28a;
  --visual-tint: #9db8cf;
  height: 100%;
  position: relative;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  background:
    radial-gradient(circle at 72% 8%, rgba(0,245,212,.10), transparent 28%),
    radial-gradient(circle at 12% 72%, rgba(36,66,255,.12), transparent 34%),
    var(--fc-bg);
  color: var(--fc-ink);
  -webkit-font-smoothing: antialiased;
}

.aml::before,
.aml::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.aml::before {
  inset: -18%;
  background:
    radial-gradient(circle at 18% 14%, rgba(244,210,138,.10), transparent 22%),
    radial-gradient(circle at 80% 22%, rgba(0,245,212,.13), transparent 24%),
    radial-gradient(circle at 58% 88%, rgba(157,184,207,.10), transparent 32%);
  filter: blur(2px);
  opacity: .9;
}

.aml::after {
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.012) 1px, transparent 1px);
  background-size: 58px 58px;
  mask-image: radial-gradient(circle at 50% 20%, #000 0, transparent 64%);
  opacity: .55;
}

.aml-main-row {
  position: relative;
  z-index: 1;
  display: flex;
  height: 100%;
  overflow: hidden;
}

/* --- Content Area --- */

.aml-content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: calc(100% - 36px);
  margin: 18px 18px 18px 14px;
  overflow: hidden;
  position: relative;
  border: 1px solid rgba(255,255,255,.075);
  border-radius: 24px;
  background:
    linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.018)),
    rgba(8,10,14,.24);
  box-shadow: 0 20px 60px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.075);
}

.aml-right-panel {
  position: relative;
  z-index: 2;
  flex: 0 0 292px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: calc(100% - 32px);
  margin: 16px 16px 16px 0;
  padding: 12px;
  overflow: auto;
  border: 1px solid rgba(255,255,255,.075);
  border-radius: 22px;
  background:
    linear-gradient(180deg, rgba(255,255,255,.052), rgba(255,255,255,.018)),
    rgba(8,10,14,.34);
  box-shadow: 0 20px 60px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.09);
  backdrop-filter: blur(28px) saturate(1.18);
  scrollbar-width: thin;
  scrollbar-color: rgba(0,245,212,.24) transparent;
}

.aml-right-panel::-webkit-scrollbar {
  width: 3px;
}

.aml-right-panel::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: rgba(0,245,212,.24);
}

.aml-content-area::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(255,255,255,.045), transparent 24%),
    radial-gradient(circle at 48% 28%, rgba(255,255,255,.07), transparent 28%),
    radial-gradient(circle at 96% 96%, rgba(0,245,212,.075), transparent 28%);
  opacity: .85;
}

.aml-header {
  flex: 0 0 auto;
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22px 32px 0;
  gap: 16px;
}

.aml-weather-chip {
  position: absolute;
  z-index: 3;
  right: 32px;
  top: 74px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid rgba(255,255,255,.09);
  border-radius: 999px;
  font: inherit;
  color: rgba(255,255,255,.76);
  background: rgba(255,255,255,.052);
  box-shadow: 0 14px 36px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.08);
  backdrop-filter: blur(18px) saturate(1.16);
  cursor: pointer;
  transition: transform .18s, border-color .18s, background .18s, color .18s;
}

.aml-weather-chip:hover {
  color: rgba(255,255,255,.94);
  border-color: rgba(0,245,212,.28);
  background: rgba(0,245,212,.075);
  transform: translateY(-1px);
}

.aml-weather-icon {
  font-size: 14px;
  line-height: 1;
}

.aml-weather-temp {
  color: rgba(234,255,251,.92);
  font-size: 12px;
  font-weight: 820;
  font-variant-numeric: tabular-nums;
}

.aml-weather-city {
  max-width: 88px;
  overflow: hidden;
  color: rgba(255,255,255,.46);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.aml-weather-mood {
  max-width: 92px;
  overflow: hidden;
  color: rgba(244,210,138,.82);
  font-size: 10.5px;
  font-weight: 760;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.aml-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.aml-header-icon {
  color: var(--fc-accent);
  flex-shrink: 0;
}

.aml-back {
  display: flex;
  align-items: center;
  padding: 4px;
  border-radius: 6px;
  cursor: pointer;
  color: rgba(255,255,255,.45);
  transition: all 0.15s;

  &:hover {
    color: #fff;
    background: rgba(255,255,255,.07);
  }
}

.aml-title {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 0;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.aml-title-sub {
  font-size: 13px;
  color: rgba(255,255,255,.45);
  white-space: nowrap;
}

.aml-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.aml-search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(255,255,255,.055);
  border: 1px solid rgba(255,255,255,.075);
  border-radius: 16px;
  width: 200px;
  backdrop-filter: blur(18px) saturate(1.2);
  transition: background 0.15s, width 0.15s, border-color 0.15s;

  &:focus-within {
    background: rgba(255,255,255,.085);
    border-color: rgba(0,245,212,.22);
    width: 260px;
  }
}

.aml-search-icon {
  color: rgba(255,255,255,.42);
  flex-shrink: 0;
}

.aml-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #fff;
  font-size: 13px;
  font-family: inherit;
  min-width: 0;

  &::placeholder { color: rgba(255,255,255,.36); }
}

.aml-search-clear {
  background: transparent;
  border: none;
  color: rgba(255,255,255,.42);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  line-height: 1;

  &:hover { color: #fff; }
}

/* Scan progress bar */

.aml-scan-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 28px 0;
}

.aml-scan-track {
  flex: 0 0 180px;
  height: 3px;
  background: rgba(255,255,255,.09);
  border-radius: 2px;
  overflow: hidden;
}

.aml-scan-fill {
  height: 100%;
  width: 50%;
  background: linear-gradient(90deg, var(--fc-accent), var(--champagne));
  background-size: 200% 100%;
  animation: aml-scan-pulse 1.5s ease-in-out infinite;
}

@keyframes aml-scan-pulse {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

.aml-scan-text {
  font-size: 11px;
  color: rgba(255,255,255,.45);
  font-weight: 500;
}

/* Scroll area */

.aml-scroll-area {
  flex: 1;
  position: relative;
  z-index: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 22px 32px 32px;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,.18);
    border-radius: 3px;
  }
}

/* Sections */

.aml-home-hero {
  min-height: 286px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 38%);
  align-items: center;
  gap: 28px;
  margin-bottom: 34px;
  padding: 34px;
  border: 1px solid rgba(255,255,255,.075);
  border-radius: 28px;
  overflow: hidden;
  position: relative;
  background:
    radial-gradient(circle at 24% 4%, rgba(255,255,255,.13), transparent 30%),
    linear-gradient(135deg, rgba(255,255,255,.065), rgba(8,9,11,.72) 56%, rgba(2,4,7,.88));
  box-shadow: 0 28px 90px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.10);
  backdrop-filter: blur(30px) saturate(1.2);
}

.aml-home-hero::before {
  content: '';
  position: absolute;
  inset: -30%;
  pointer-events: none;
  background:
    radial-gradient(circle at 68% 22%, rgba(0,245,212,.18), transparent 20%),
    radial-gradient(circle at 86% 70%, rgba(244,210,138,.14), transparent 24%);
  mix-blend-mode: screen;
}

.aml-home-copy,
.aml-home-wall {
  position: relative;
  z-index: 1;
}

.aml-home-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: rgba(210,244,241,.92);
  font-size: 12px;
  font-weight: 800;
}

.aml-home-copy h1 {
  margin: 14px 0 0;
  max-width: 720px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #fff;
  font-size: clamp(32px, 4vw, 58px);
  font-weight: 860;
  line-height: 1.05;
  letter-spacing: 0;
  text-shadow: 0 22px 60px rgba(0,0,0,.55);
}

.aml-home-copy p {
  margin: 12px 0 0;
  max-width: 620px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255,255,255,.58);
  font-size: 15px;
}

.aml-home-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 26px;
}

.aml-home-play,
.aml-home-ghost {
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 16px;
  padding: 0 18px;
  color: #07110f;
  background: linear-gradient(135deg, var(--fc-accent), var(--champagne));
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 18px 42px rgba(0,245,212,.14);
}

.aml-home-ghost {
  color: rgba(255,255,255,.82);
  background: rgba(255,255,255,.060);
  border: 1px solid rgba(255,255,255,.09);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
}

.aml-home-stats {
  margin-top: 18px;
  color: rgba(255,255,255,.42);
  font-size: 12px;
}

.aml-home-wall {
  min-height: 250px;
}

.aml-home-wall-card {
  --offset: calc(var(--i) * 32px);
  position: absolute;
  right: calc(18px + var(--offset));
  top: calc(18px + var(--i) * 10px);
  width: 156px;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 22px;
  color: rgba(255,255,255,.45);
  background: rgba(255,255,255,.07);
  box-shadow: 0 28px 70px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.14);
  transform: rotate(calc((var(--i) - 2) * -5deg));
}

.aml-home-wall-card:first-child {
  z-index: 5;
  width: 188px;
  right: 96px;
  top: 26px;
}

.aml-home-wall-card img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.aml-section,
.aml-hscroll-section {
  margin-bottom: 28px;
}

.aml-home-section-panel {
  position: relative;
  overflow: hidden;
  padding: 20px;
  border: 1px solid rgba(255,255,255,.070);
  border-radius: 24px;
  background:
    radial-gradient(circle at 14% 0%, rgba(255,255,255,.085), transparent 24%),
    linear-gradient(145deg, rgba(255,255,255,.052), rgba(10,12,16,.58) 62%, rgba(5,6,8,.76));
  box-shadow: 0 22px 70px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.085);
  backdrop-filter: blur(28px) saturate(1.12);
}

.aml-home-section-panel::before {
  content: '';
  position: absolute;
  inset: -45%;
  pointer-events: none;
  background:
    radial-gradient(circle at 18% 32%, rgba(0,245,212,.10), transparent 18%),
    radial-gradient(circle at 82% 8%, rgba(244,210,138,.10), transparent 18%);
  mix-blend-mode: screen;
  opacity: .9;
}

.aml-home-section-panel > * {
  position: relative;
  z-index: 1;
}

.aml-section-label {
  font-size: 15px;
  font-weight: 800;
  color: rgba(255,255,255,.92);
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.aml-home-section-head {
  min-height: 38px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.aml-home-section-head .aml-section-label {
  margin-bottom: 0;
}

.aml-home-section-note {
  padding-top: 2px;
  color: rgba(255,255,255,.36);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .14em;
  white-space: nowrap;
}

.aml-home-tile-panel,
.aml-home-card-panel,
.aml-home-track-panel {
  --tone-a: #00f5d4;
  --tone-b: #2442ff;
  --tone-c: #f8f4ee;
}

.aml-home-tile-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.aml-home-tile {
  --tone-a: #00f5d4;
  --tone-b: #2442ff;
  --tone-c: #f8f4ee;
  position: relative;
  min-width: 0;
  min-height: 166px;
  padding: 10px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--tone-a) 12%, rgba(255,255,255,.075));
  border-radius: 20px;
  color: #fff;
  text-align: left;
  font: inherit;
  background: linear-gradient(145deg, rgba(255,255,255,.060), rgba(255,255,255,.025));
  box-shadow: 0 16px 50px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.052);
  backdrop-filter: blur(20px) saturate(1.10);
  cursor: pointer;
  transition: transform .2s, border-color .2s, background .2s, box-shadow .2s;
}

.aml-home-tile[data-home-tone="mix"] { --tone-a: #9db8cf; --tone-b: #00f5d4; --tone-c: #2442ff; }
.aml-home-tile[data-home-tone="local"] { --tone-a: #f8f4ee; --tone-b: #00f5d4; --tone-c: #2442ff; }
.aml-home-tile[data-home-tone="library"] { --tone-a: #00f5d4; --tone-b: #f8f4ee; --tone-c: #2442ff; }
.aml-home-tile[data-home-tone="search"] { --tone-a: #9db8cf; --tone-b: #00f5d4; --tone-c: #2442ff; }
.aml-home-tile[data-home-tone="playlist"] { --tone-a: #f4d28a; --tone-b: #2442ff; --tone-c: #00f5d4; }

.aml-home-tile::before {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  top: 10px;
  height: 92px;
  border-radius: 15px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--tone-a) 12%, transparent), transparent 48%, color-mix(in srgb, var(--tone-b) 10%, transparent));
  opacity: .9;
  pointer-events: none;
}

.aml-home-tile:hover {
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--tone-a) 36%, rgba(255,255,255,.18));
  background: rgba(255,255,255,.068);
  box-shadow: 0 22px 62px rgba(0,0,0,.28), 0 0 26px color-mix(in srgb, var(--tone-a) 12%, transparent);
}

.aml-home-tile-cover {
  position: relative;
  width: 100%;
  height: 92px;
  display: block;
  overflow: hidden;
  border-radius: 15px;
  margin-bottom: 10px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--tone-a) 74%, #16161b), color-mix(in srgb, var(--tone-b) 58%, #08090d));
  background-size: cover;
  background-position: center;
  box-shadow: 0 14px 34px rgba(0,0,0,.26), inset 0 1px 0 rgba(255,255,255,.14);
}

.aml-home-tile-cover:not(.has-cover)::before {
  content: '';
  position: absolute;
  left: 12px;
  bottom: 12px;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: repeating-radial-gradient(circle, rgba(255,255,255,.14) 0 1px, transparent 1px 7px), conic-gradient(from 180deg, var(--tone-a), var(--tone-b), var(--tone-c), var(--tone-a));
  box-shadow: inset 0 0 0 10px rgba(5,5,8,.42);
}

.aml-home-tile-cover:not(.has-cover)::after {
  content: '';
  position: absolute;
  right: 12px;
  top: 14px;
  width: 46px;
  height: 48px;
  border-radius: 999px;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,.72) 0 3px, transparent 3px 9px);
  opacity: .32;
}

.aml-home-tile-cover img,
.aml-home-card-art img,
.aml-home-song-cover img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  object-position: center;
}

.aml-home-tile-title {
  position: relative;
  display: -webkit-box;
  overflow: hidden;
  color: rgba(255,255,255,.90);
  font-size: 13px;
  font-weight: 720;
  line-height: 1.28;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.aml-home-tile-sub {
  position: relative;
  display: block;
  margin-top: 5px;
  overflow: hidden;
  color: rgba(255,255,255,.42);
  font-size: 10.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.aml-home-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.aml-home-card {
  --tone-a: #00f5d4;
  --tone-b: #2442ff;
  --tone-c: #f8f4ee;
  position: relative;
  min-height: 152px;
  padding: 17px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--tone-a) 10%, rgba(255,255,255,.085));
  border-radius: 22px;
  color: #fff;
  text-align: left;
  font: inherit;
  background: linear-gradient(142deg, rgba(18,21,26,.66), rgba(8,9,13,.76));
  box-shadow: 0 20px 64px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.060);
  backdrop-filter: blur(24px) saturate(1.12);
  cursor: pointer;
  transition: transform .22s cubic-bezier(.16,1,.3,1), border-color .22s, background .22s, box-shadow .22s;
}

.aml-home-card[data-home-tone="mix"] { --tone-a: #9db8cf; --tone-b: #00f5d4; --tone-c: #2442ff; }
.aml-home-card[data-home-tone="local"] { --tone-a: #f8f4ee; --tone-b: #00f5d4; --tone-c: #2442ff; }
.aml-home-card[data-home-tone="library"] { --tone-a: #00f5d4; --tone-b: #f8f4ee; --tone-c: #2442ff; }
.aml-home-card[data-home-tone="search"] { --tone-a: #9db8cf; --tone-b: #00f5d4; --tone-c: #2442ff; }
.aml-home-card[data-home-tone="playlist"] { --tone-a: #f4d28a; --tone-b: #2442ff; --tone-c: #00f5d4; }

.aml-home-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(118deg, color-mix(in srgb, var(--tone-a) 22%, transparent), transparent 38%, color-mix(in srgb, var(--tone-b) 16%, transparent) 74%, transparent), linear-gradient(90deg, rgba(255,255,255,.035) 0 1px, transparent 1px 38px);
  opacity: .86;
  pointer-events: none;
}

.aml-home-card::after {
  content: '';
  position: absolute;
  right: 114px;
  bottom: 18px;
  width: 38px;
  height: 70px;
  border-radius: 999px;
  background: repeating-linear-gradient(0deg, color-mix(in srgb, var(--tone-c) 64%, rgba(255,255,255,.26)) 0 4px, transparent 4px 10px);
  opacity: .20;
  transform: skewX(-10deg);
  pointer-events: none;
}

.aml-home-card:hover {
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--tone-a) 42%, rgba(255,255,255,.18));
  background: linear-gradient(142deg, rgba(36,33,39,.72), rgba(10,10,14,.84));
  box-shadow: 0 28px 84px rgba(0,0,0,.36), 0 0 34px color-mix(in srgb, var(--tone-a) 16%, transparent), inset 0 1px 0 rgba(255,255,255,.085);
}

.aml-home-card-label,
.aml-home-card-title,
.aml-home-card-sub {
  position: relative;
  z-index: 2;
  display: block;
  max-width: calc(100% - 124px);
}

.aml-home-card-label {
  margin-bottom: 8px;
  color: color-mix(in srgb, var(--tone-a) 70%, #fff);
  font-size: 10px;
  font-weight: 760;
  letter-spacing: .14em;
  text-transform: uppercase;
  text-shadow: 0 0 18px color-mix(in srgb, var(--tone-a) 22%, transparent);
}

.aml-home-card-title {
  color: rgba(255,255,255,.96);
  font-size: 19px;
  font-weight: 780;
  line-height: 1.16;
  letter-spacing: 0;
}

.aml-home-card-sub {
  margin-top: 8px;
  color: rgba(255,255,255,.55);
  font-size: 11.5px;
  line-height: 1.45;
}

.aml-home-card-art {
  position: absolute;
  z-index: 1;
  right: 13px;
  bottom: 13px;
  width: 108px;
  height: 108px;
  overflow: hidden;
  border-radius: 24px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--tone-a) 78%, #14141a), color-mix(in srgb, var(--tone-b) 68%, #09090d));
  box-shadow: 0 18px 50px rgba(0,0,0,.36), inset 0 1px 0 rgba(255,255,255,.16);
  transform: rotate(3deg);
}

.aml-home-card-art:not(.has-cover)::before {
  content: '';
  position: absolute;
  inset: 18px;
  border-radius: 50%;
  background: repeating-radial-gradient(circle, rgba(255,255,255,.16) 0 1px, transparent 1px 8px), conic-gradient(from 180deg, var(--tone-a), var(--tone-b), var(--tone-c), var(--tone-a));
  box-shadow: inset 0 0 0 14px rgba(5,5,8,.44), 0 12px 28px rgba(0,0,0,.26);
}

.aml-home-card-art::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(145deg, rgba(255,255,255,.12), transparent 42%, rgba(0,0,0,.28));
  pointer-events: none;
}

.aml-home-song-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.aml-home-song-item {
  display: grid;
  grid-template-columns: 34px 44px minmax(0, 1fr) minmax(84px, auto);
  align-items: center;
  gap: 11px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(255,255,255,.075);
  border-radius: 13px;
  color: rgba(255,255,255,.88);
  text-align: left;
  font: inherit;
  background: rgba(255,255,255,.045);
  cursor: pointer;
  transition: background .16s, border-color .16s, transform .16s;
}

.aml-home-song-item:hover {
  transform: translateY(-1px);
  border-color: rgba(0,245,212,.20);
  background: rgba(255,255,255,.068);
}

.aml-home-song-index {
  color: rgba(255,255,255,.34);
  font-size: 11px;
  font-weight: 760;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.aml-home-song-cover {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 12px;
  color: rgba(255,255,255,.38);
  background: linear-gradient(135deg, rgba(0,245,212,.15), rgba(36,66,255,.12));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.11);
}

.aml-home-song-main {
  min-width: 0;
}

.aml-home-song-title,
.aml-home-song-sub,
.aml-home-song-source {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.aml-home-song-title {
  color: rgba(255,255,255,.92);
  font-size: 13px;
  font-weight: 720;
}

.aml-home-song-sub,
.aml-home-song-source {
  color: rgba(255,255,255,.42);
  font-size: 10.5px;
}

.aml-home-song-source {
  text-align: right;
}

@media (max-width: 1180px) {
  .aml-right-panel {
    display: none;
  }
  .aml-home-tile-row {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .aml-home-song-list {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .aml-home-tile-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .aml-home-card-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .aml-home-tile-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .aml-home-song-item {
    grid-template-columns: 28px 40px minmax(0, 1fr);
  }
  .aml-home-song-source {
    display: none;
  }
}

.aml-reroll-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,.055);
  color: rgba(255,255,255,.55);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: rgba(255,255,255,.09);
    color: #fff;
  }
}

/* Horizontal scroll */

.aml-hscroll {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 2px 2px 10px;

  &::-webkit-scrollbar { height: 4px; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 2px; }
}

.aml-card-h {
  flex: 0 0 168px;
  cursor: pointer;
  user-select: none;

  &:hover .aml-card-h-cover { transform: translateY(-2px) scale(1.015); }
}

.aml-card-h-cover {
  width: 168px;
  height: 168px;
  border-radius: 22px;
  overflow: hidden;
  background:
    radial-gradient(circle at 34% 20%, rgba(255,255,255,.16), transparent 26%),
    rgba(255,255,255,.055);
  border: 1px solid rgba(255,255,255,.085);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,.34);
  box-shadow: 0 22px 58px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.11);
  transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    display: block;
    background: rgba(255,255,255,.035);
  }
}

.aml-card-h-cover > img,
.aml-card-cover > img,
.aml-track-cover > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
  background: rgba(255,255,255,.035);
}

.aml-card-h-title {
  font-size: 13.5px;
  font-weight: 750;
  color: rgba(255,255,255,.92);
  margin-top: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 168px;
}

.aml-card-h-sub {
  font-size: 11px;
  color: rgba(255,255,255,.42);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 168px;
}

/* Grid */

.aml-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(178px, 1fr));
  gap: 18px;
}

.aml-grid-view,
.aml-all-songs,
.aml-fav-songs,
.aml-group-detail {
  position: relative;
  overflow: hidden;
  padding: 20px;
  border: 1px solid rgba(255,255,255,.070);
  border-radius: 26px;
  background:
    radial-gradient(circle at 14% 0%, rgba(255,255,255,.075), transparent 24%),
    linear-gradient(145deg, rgba(255,255,255,.048), rgba(10,12,16,.58) 62%, rgba(5,6,8,.76));
  box-shadow: 0 22px 70px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.085);
  backdrop-filter: blur(28px) saturate(1.12);
}

.aml-grid-view::before,
.aml-all-songs::before,
.aml-fav-songs::before,
.aml-group-detail::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(90deg, rgba(255,255,255,.025) 0 1px, transparent 1px 48px),
    linear-gradient(0deg, rgba(255,255,255,.018) 0 1px, transparent 1px 44px),
    radial-gradient(circle at 86% 10%, rgba(0,245,212,.075), transparent 24%);
  opacity: .86;
}

.aml-grid-view > *,
.aml-all-songs > *,
.aml-fav-songs > *,
.aml-group-detail > * {
  position: relative;
  z-index: 1;
}

.aml-card {
  --tone-a: #00f5d4;
  --tone-b: #2442ff;
  --tone-c: #f8f4ee;
  position: relative;
  cursor: pointer;
  user-select: none;
  min-width: 0;
  min-height: 198px;
  padding: 12px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--tone-a) 10%, rgba(255,255,255,.085));
  border-radius: 22px;
  background: linear-gradient(142deg, rgba(18,21,26,.62), rgba(8,9,13,.72));
  box-shadow: 0 18px 56px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.058);
  transition: background .18s, border-color .18s, transform .18s, box-shadow .18s;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(118deg, color-mix(in srgb, var(--tone-a) 16%, transparent), transparent 42%, color-mix(in srgb, var(--tone-b) 12%, transparent) 74%, transparent);
    opacity: .76;
    pointer-events: none;
  }

  &:hover {
    transform: translateY(-3px);
    border-color: color-mix(in srgb, var(--tone-a) 38%, rgba(255,255,255,.16));
    background: linear-gradient(142deg, rgba(36,33,39,.70), rgba(10,10,14,.82));
    box-shadow: 0 26px 74px rgba(0,0,0,.30), 0 0 30px color-mix(in srgb, var(--tone-a) 12%, transparent);
  }

  &.selected .aml-card-cover {
    outline: 2px solid var(--fc-accent);
    outline-offset: 2px;
  }

  &:hover .aml-card-cover { transform: translateY(-2px) scale(1.015); }
}

.aml-card-cover {
  position: relative;
  z-index: 1;
  aspect-ratio: 1;
  border-radius: 18px;
  overflow: hidden;
  background:
    radial-gradient(circle at 34% 20%, rgba(255,255,255,.14), transparent 26%),
    rgba(255,255,255,.055);
  border: 1px solid rgba(255,255,255,.085);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,.34);
  box-shadow: 0 18px 44px rgba(0,0,0,.26), inset 0 1px 0 rgba(255,255,255,.10);
  transition: transform 0.2s, box-shadow 0.2s;
  position: relative;

  &.circle { border-radius: 50%; }
  &.folder { background: linear-gradient(135deg, rgba(0,245,212,.12), rgba(244,210,138,.08)); }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    display: block;
    background: rgba(255,255,255,.035);
  }
}

.aml-card-title {
  position: relative;
  z-index: 1;
  font-size: 14px;
  font-weight: 760;
  color: rgba(255,255,255,.92);
  margin-top: 9px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.aml-card-sub {
  position: relative;
  z-index: 1;
  font-size: 12px;
  color: rgba(255,255,255,.42);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.aml-folder-check {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,.18);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: transparent;
  cursor: pointer;
  transition: all 0.15s;
  z-index: 2;

  &.checked {
    border-color: var(--fc-accent);
    background: var(--fc-accent);
    color: #fff;
  }
}

/* Track list */

.aml-tracklist {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.aml-track {
  display: grid;
  grid-template-columns: 32px 44px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid rgba(255,255,255,.075);
  border-radius: 13px;
  background: rgba(255,255,255,.045);
  cursor: pointer;
  transition: background .18s, border-color .18s, transform .18s, box-shadow .18s;
  color: rgba(255,255,255,.88);

  &:hover {
    transform: translateY(-1px);
    background: rgba(255,255,255,.075);
    border-color: rgba(244,210,138,.25);
    box-shadow: 0 12px 32px rgba(0,0,0,.20);
  }
}

.aml-track-idx {
  font-size: 11px;
  color: rgba(244,210,138,.62);
  font-variant-numeric: tabular-nums;
  text-align: center;
  width: 32px;
  font-weight: 500;
}

.aml-track-cover {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(0,245,212,.15), rgba(36,66,255,.12));
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,.34);
  flex-shrink: 0;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: center;
    display: block;
    background: rgba(255,255,255,.035);
  }
}

.aml-track-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.aml-track-title {
  font-size: 14px;
  font-weight: 720;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.aml-track-artist {
  font-size: 12px;
  color: rgba(255,255,255,.42);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.aml-track-album,
.aml-track-source {
  font-size: 12px;
  color: rgba(255,255,255,.42);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
  text-align: right;
}

.aml-server-note,
.aml-server-error {
  margin-bottom: 12px;
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 12px;
}

.aml-server-note {
  color: rgba(232,236,239,.66);
  background: rgba(0,245,212,.07);
  border: 1px solid rgba(0,245,212,.16);
}

.aml-server-error {
  color: #ffb4b7;
  background: rgba(255,91,102,.09);
  border: 1px solid rgba(255,91,102,.18);
}

/* Empty state */

.aml-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  text-align: center;
}

.aml-empty-icon {
  color: rgba(255,255,255,.30);
  margin-bottom: 16px;
}

.aml-empty-title {
  font-size: 17px;
  font-weight: 600;
  color: rgba(255,255,255,.72);
}

.aml-empty-sub {
  font-size: 13px;
  color: rgba(255,255,255,.40);
  margin-top: 6px;
}

/* Folder context menu */

.aml-folder-menu {
  padding: 4px 0;
}

.aml-folder-menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 16px;
  border: none;
  background: transparent;
  font-size: 13px;
  color: rgba(255,255,255,.82);
  cursor: pointer;
  font-family: inherit;

  &:hover { background: rgba(255,255,255,.07); }
  &.danger { color: #ff8f9d; }
  &:disabled { opacity: 0.3; cursor: default; }
}

.aml-section-label,
.aml-card-title,
.aml-card-h-title,
.aml-track-title,
.aml-home-tile-title,
.aml-home-card-title,
.aml-home-song-title {
  color: var(--music-ui-text);
}

</style>

<style>
/* Share the media workspace surface tokens in both themes. */
body[arco-theme='dark'] .unified-library .aml {
  --music-ui-text: var(--color-text-1);
  --music-ui-muted: var(--color-text-3);
  --fc-bg: #000;
  --fc-paper: #000;
  --fc-ink: var(--color-text-1);
  background: #000 !important;
  color: var(--color-text-1);
}
body[arco-theme='dark'] .unified-library .aml::before,
body[arco-theme='dark'] .unified-library .aml::after,
body[arco-theme='dark'] .unified-library .aml-content-area::before,
body[arco-theme='dark'] .unified-library .aml-home-hero::before,
body[arco-theme='dark'] .unified-library .aml-home-section-panel::before,
body[arco-theme='dark'] .unified-library .aml-grid-view::before,
body[arco-theme='dark'] .unified-library .aml-all-songs::before,
body[arco-theme='dark'] .unified-library .aml-fav-songs::before,
body[arco-theme='dark'] .unified-library .aml-group-detail::before {
  display: none;
}
body[arco-theme='dark'] .unified-library .aml-content-area,
body[arco-theme='dark'] .unified-library .aml-right-panel,
body[arco-theme='dark'] .unified-library .aml-home-hero,
body[arco-theme='dark'] .unified-library .aml-home-section-panel,
body[arco-theme='dark'] .unified-library .aml-grid-view,
body[arco-theme='dark'] .unified-library .aml-all-songs,
body[arco-theme='dark'] .unified-library .aml-fav-songs,
body[arco-theme='dark'] .unified-library .aml-group-detail,
body[arco-theme='dark'] .unified-library .aml .plm-panel,
body[arco-theme='dark'] .unified-library .aml .podcast-panel {
  background: #000;
  border-color: var(--color-border-2);
  box-shadow: none;
  backdrop-filter: none;
}
body:not([arco-theme='dark']) .aml {
  --music-ui-text: #111827;
  --music-ui-muted: #374151;
  --fc-bg: var(--color-bg-1);
  --fc-paper: var(--color-bg-2);
  --fc-ink: var(--color-text-1);
  --fc-accent: rgb(var(--primary-6));
  --champagne: rgb(var(--primary-5));
  color: var(--music-ui-text);
  background: var(--color-bg-1);
}

body:not([arco-theme='dark']) .aml-content-area {
  border-color: var(--color-border-2);
  background: var(--color-bg-1);
  box-shadow: none;
}

body:not([arco-theme='dark']) .aml::before,
body:not([arco-theme='dark']) .aml::after,
body:not([arco-theme='dark']) .aml-content-area::before,
body:not([arco-theme='dark']) .aml-home-hero::before,
body:not([arco-theme='dark']) .aml-home-section-panel::before {
  display: none;
}

body:not([arco-theme='dark']) .aml-title,
body:not([arco-theme='dark']) .aml-home-copy h1,
body:not([arco-theme='dark']) .aml-section-label,
body:not([arco-theme='dark']) .aml-card-title,
body:not([arco-theme='dark']) .aml-card-h-title,
body:not([arco-theme='dark']) .aml-track-title,
body:not([arco-theme='dark']) .aml-empty-title {
  color: var(--music-ui-text);
}

body:not([arco-theme='dark']) .aml-title-sub,
body:not([arco-theme='dark']) .aml-back,
body:not([arco-theme='dark']) .aml-home-copy p,
body:not([arco-theme='dark']) .aml-home-stats,
body:not([arco-theme='dark']) .aml-card-sub,
body:not([arco-theme='dark']) .aml-card-h-sub,
body:not([arco-theme='dark']) .aml-track-idx,
body:not([arco-theme='dark']) .aml-track-artist,
body:not([arco-theme='dark']) .aml-track-album,
body:not([arco-theme='dark']) .aml-track-source,
body:not([arco-theme='dark']) .aml-empty-sub,
body:not([arco-theme='dark']) .aml-scan-text {
  color: var(--music-ui-muted);
}

body:not([arco-theme='dark']) .aml-server-note {
  color: var(--color-text-2);
  background: var(--color-primary-light-1);
}

body:not([arco-theme='dark']) .aml-server-error {
  color: rgb(var(--danger-6));
  background: var(--color-danger-light-1);
}

body:not([arco-theme='dark']) .aml-search-box,
body:not([arco-theme='dark']) .aml-weather-chip,
body:not([arco-theme='dark']) .aml-right-panel,
body:not([arco-theme='dark']) .aml-home-hero,
body:not([arco-theme='dark']) .aml-home-section-panel,
body:not([arco-theme='dark']) .aml-grid-view,
body:not([arco-theme='dark']) .aml-all-songs,
body:not([arco-theme='dark']) .aml-fav-songs,
body:not([arco-theme='dark']) .aml-group-detail,
body:not([arco-theme='dark']) .aml-card,
body:not([arco-theme='dark']) .aml-track,
body:not([arco-theme='dark']) .aml-card-cover,
body:not([arco-theme='dark']) .aml-card-h-cover,
body:not([arco-theme='dark']) .aml-track-cover,
body:not([arco-theme='dark']) .aml-home-tile,
body:not([arco-theme='dark']) .aml-home-card,
body:not([arco-theme='dark']) .aml-home-song-item {
  border-color: var(--color-border-2);
  background: var(--color-bg-1);
  box-shadow: none;
  backdrop-filter: none;
}

body:not([arco-theme='dark']) .aml-card:hover,
body:not([arco-theme='dark']) .aml-track:hover,
body:not([arco-theme='dark']) .aml-home-tile:hover,
body:not([arco-theme='dark']) .aml-home-card:hover,
body:not([arco-theme='dark']) .aml-home-song-item:hover,
body:not([arco-theme='dark']) .aml-reroll-btn:hover {
  background: var(--color-fill-2);
}

body:not([arco-theme='dark']) .aml-grid-view::before,
body:not([arco-theme='dark']) .aml-all-songs::before,
body:not([arco-theme='dark']) .aml-fav-songs::before,
body:not([arco-theme='dark']) .aml-group-detail::before,
body:not([arco-theme='dark']) .aml-card::before {
  display: none;
}

body:not([arco-theme='dark']) .aml-search-input {
  color: var(--color-text-1);
}

body:not([arco-theme='dark']) .aml-search-input::placeholder {
  color: var(--color-text-3);
}

body:not([arco-theme='dark']) .aml-home-kicker,
body:not([arco-theme='dark']) .aml-header-icon,
body:not([arco-theme='dark']) .aml-search-icon {
  color: rgb(var(--primary-6));
}

body:not([arco-theme='dark']) .aml-home-ghost,
body:not([arco-theme='dark']) .aml-reroll-btn,
body:not([arco-theme='dark']) .aml-folder-menu-item {
  color: var(--music-ui-text);
  background: var(--color-fill-2);
}

body:not([arco-theme='dark']) .aml-home-play {
  color: #fff;
  background: rgb(var(--primary-6));
}

body:not([arco-theme='dark']) .aml-home-section-note,
body:not([arco-theme='dark']) .aml-weather-city,
body:not([arco-theme='dark']) .aml-home-tile-sub,
body:not([arco-theme='dark']) .aml-home-card-sub,
body:not([arco-theme='dark']) .aml-home-song-sub,
body:not([arco-theme='dark']) .aml-home-song-source,
body:not([arco-theme='dark']) .aml-home-song-index {
  color: var(--color-text-2);
}

body:not([arco-theme='dark']) .aml-home-tile-title,
body:not([arco-theme='dark']) .aml-home-card-title,
body:not([arco-theme='dark']) .aml-home-song-title,
body:not([arco-theme='dark']) .aml-weather-temp {
  color: var(--music-ui-text);
}

body:not([arco-theme='dark']) .aml-home-tile-cover,
body:not([arco-theme='dark']) .aml-home-card-art,
body:not([arco-theme='dark']) .aml-home-song-cover {
  border-color: var(--color-border-2);
  background: var(--color-fill-2);
  box-shadow: none;
}

body:not([arco-theme='dark']) .aml .plm-panel,
body:not([arco-theme='dark']) .aml .podcast-panel,
body:not([arco-theme='dark']) .aml .plm-row,
body:not([arco-theme='dark']) .aml .podcast-row,
body:not([arco-theme='dark']) .aml .plm-input,
body:not([arco-theme='dark']) .aml .plm-btn,
body:not([arco-theme='dark']) .aml .plm-act,
body:not([arco-theme='dark']) .aml .podcast-btn,
body:not([arco-theme='dark']) .aml .podcast-rm {
  border-color: var(--color-border-2);
  background: var(--color-bg-1);
  color: var(--music-ui-text);
  box-shadow: none;
}

body:not([arco-theme='dark']) .aml .plm-title,
body:not([arco-theme='dark']) .aml .plm-name,
body:not([arco-theme='dark']) .aml .plm-detail-head,
body:not([arco-theme='dark']) .aml .podcast-title,
body:not([arco-theme='dark']) .aml .podcast-name {
  color: var(--color-text-1);
}

body:not([arco-theme='dark']) .aml .plm-count,
body:not([arco-theme='dark']) .aml .plm-track-name,
body:not([arco-theme='dark']) .aml .plm-empty,
body:not([arco-theme='dark']) .aml .podcast-count,
body:not([arco-theme='dark']) .aml .podcast-info,
body:not([arco-theme='dark']) .aml .podcast-empty {
  color: var(--music-ui-muted);
}

body:not([arco-theme='dark']) .aml .plm-row:hover,
body:not([arco-theme='dark']) .aml .plm-row.selected,
body:not([arco-theme='dark']) .aml .podcast-row:hover,
body:not([arco-theme='dark']) .aml .podcast-row.selected,
body:not([arco-theme='dark']) .aml .plm-btn:hover,
body:not([arco-theme='dark']) .aml .plm-act:hover,
body:not([arco-theme='dark']) .aml .podcast-btn:hover {
  border-color: rgba(var(--primary-6), .24);
  background: rgba(var(--primary-6), .08);
  color: var(--music-ui-text);
}
</style>
