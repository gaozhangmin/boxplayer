<script setup lang="ts">
import { computed, nextTick, ref, onMounted, onUnmounted } from 'vue'
import { ArrowLeft, Disc3, Heart, Music, Play, Plus, Search, UserRound, ListMusic, Pencil, Pause, SkipBack, SkipForward, Repeat, Repeat1, Shuffle, Volume2, MoreHorizontal, Share, ArrowDown, CircleArrowDown, Star, Pin, PinOff, ListPlus, ListStart, Info, Trash2, ListMinus, ChevronRight, FolderInput, Download, Library } from 'lucide-vue-next'
import type { IMusicTrack } from '../../types/music'
import type { IPageMusicTrack } from '../../store/appstore'
import { createPlaylist, loadPlaylists, savePlaylists, addTracksToList, type LocalPlaylist } from '../../utils/radio/LocalPlaylistManager'
import { musicTrackKey, loadMusicTrackList, saveMusicTrackList } from '../../utils/musicPlayerStorage'
import { albumPinKey, loadMusicPins, playlistPinKey, saveMusicPins, toggleMusicPin, trackPinKey, type MusicPin } from '../../utils/musicPins'
import { planMusicDownload } from '../../utils/musicDownload'
import useMusicPlayerStore from '../../store/musicplayerstore'
import { useAppStore } from '../../store'
import useMusicLibraryStore from '../../store/musiclibrary'
import useSettingStore from '../../setting/settingstore'
import DownDAL from '../../down/DownDAL'
import message from '../../utils/message'
import { t as tt } from '../../i18n'
import MusicActionMenu, { type MusicMenuItem } from './MusicActionMenu.vue'
import { recentlyAddedMusicTracks } from '../../utils/musicTrackMerge'

const props = defineProps<{ tracks: IMusicTrack[]; loading: boolean; hasMore: boolean; total: number }>()
const emit = defineEmits<{ (e: 'load-all'): void; (e: 'load-more'): void; (e: 'sources'): void; (e: 'import-local'): void; (e: 'play', tracks: IPageMusicTrack[], target?: IPageMusicTrack): void }>()
const player = useMusicPlayerStore()
const library = useMusicLibraryStore()
type Tab = 'home' | 'songs' | 'artists' | 'albums' | 'playlists'
const tab = ref<Tab>('home')
const tabs: { key: Tab; title: string }[] = [{ key: 'home', title: '音乐库' }, { key: 'songs', title: '歌曲' }, { key: 'artists', title: '歌手' }, { key: 'albums', title: '专辑' }, { key: 'playlists', title: '我的歌单' }]
const query = ref('')
const collectionTitle = ref('')
const group = ref<{ title: string; ids: string[] } | null>(null)
const playlists = ref(loadPlaylists())
const selected = ref('favorites')
const favorites = ref(loadMusicTrackList('pm.favs', { legacyKeys: ['pageMusic.favorites'] }))
const pins = ref<MusicPin[]>(loadMusicPins())
const form = ref<'create' | 'rename' | 'add' | 'assign' | 'delete' | 'credits' | null>(null)
const name = ref('')
const chosen = ref<string[]>([])
const assignTrack = ref<IPageMusicTrack | null>(null)
const assignCollection = ref(false)
const creditsTrack = ref<IMusicTrack | null>(null)
const addQuery = ref('')
const downloading = ref(false)
const menu = ref<{ kind: 'collection' | 'track' | 'home'; track?: IMusicTrack; anchor: DOMRect } | null>(null)
const searchOpen = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)
const appStore = useAppStore()
function openSearch() { searchOpen.value = true; void nextTick(() => searchInput.value?.focus()) }
function closeSearch() { query.value = ''; searchOpen.value = false }
/** Drop a leading track number baked into the file name ("01 - Song") so detail rows don't show it twice. */
const rowTitle = (t: IMusicTrack) => t.title || title(t).replace(/^\d{1,3}(?:\s*[-._)]\s*|\s+)(?=\S)/, '')
const selectedList = computed(() => playlists.value.find(p => p.id === selected.value))
const title = (t: IMusicTrack) => t.title || t.file_name.replace(/\.[^.]+$/, '')
const cover = (t: IMusicTrack) => t.cover_url || t.thumbnail || ''
const failedCovers = ref(new Set<string>())
const favoriteKeys = computed(() => new Set(favorites.value.map(musicTrackKey)))
const pinKeys = computed(() => new Set(pins.value.map(pin => pin.key)))
function playbackTrack(t: IMusicTrack): IPageMusicTrack {
  return { ...t, thumbnail: cover(t), password: '', icon: '' }
}
const metadata = computed(() => new Map(props.tracks.map(t => [musicTrackKey(t), t])))
function resolveTrack(t: IPageMusicTrack): IMusicTrack {
  return metadata.value.get(musicTrackKey(t)) || { ...t, id: musicTrackKey(t), ext: '', size: 0, category: 'audio', scanned_at: 0 }
}
const listTracks = computed(() => selected.value === 'favorites' ? favorites.value : selectedList.value?.tracks || [])
const displayed = computed(() => {
  let items = tab.value === 'playlists' ? listTracks.value.map(resolveTrack) : tab.value === 'songs' && collectionTitle.value === '最近收录' ? recentlyAddedMusicTracks(props.tracks) : props.tracks
  if (group.value) items = items.filter(t => group.value!.ids.includes(t.id))
  if (group.value && tab.value === 'albums') items = [...items].sort((a,b) =>
    (a.disc_number || 0) - (b.disc_number || 0) || (a.track_number || Number.MAX_SAFE_INTEGER) - (b.track_number || Number.MAX_SAFE_INTEGER))
  const q = query.value.trim().toLocaleLowerCase()
  return q ? items.filter(t => `${title(t)} ${t.artist || ''} ${t.album || ''}`.toLocaleLowerCase().includes(q)) : items
})
const groups = computed(() => {
  const result = new Map<string, { title: string; artist: string; tracks: IMusicTrack[] }>()
  for (const track of displayed.value) {
    const artist = track.artist || '未知歌手'
    const label = tab.value === 'artists' ? artist : track.album || '未知专辑'
    const key = tab.value === 'artists' ? label : `${artist}\u0000${label}`
    const item = result.get(key) || { title: label, artist, tracks: [] }
    item.tracks.push(track)
    result.set(key, item)
  }
  return Array.from(result.entries())
})
const homeSections = computed(() => {
  const albums = new Map<string, IMusicTrack>()
  for (const track of props.tracks) {
    const key = `${track.artist || ''}\u0000${track.album || title(track)}`
    if (!albums.has(key)) albums.set(key, track)
  }
  return [
    { title: '最近收录', tracks: recentlyAddedMusicTracks(props.tracks), destination: 'songs' as Tab },
    { title: '专辑', tracks: [...albums.values()], destination: 'albums' as Tab },
    { title: '我喜欢的', tracks: props.tracks.filter(t => favoriteKeys.value.has(musicTrackKey(t))), destination: 'playlists' as Tab }
  ].filter(section => section.tracks.length)
})
const candidates = computed(() => props.tracks.filter(t => `${title(t)} ${t.artist || ''} ${t.album || ''}`.toLowerCase().includes(addQuery.value.trim().toLowerCase())))

/* Album / playlist detail (Apple Music style hero + numbered track list). */
const isAlbumDetail = computed(() => !!group.value && tab.value === 'albums')
const isDetail = computed(() => isAlbumDetail.value || tab.value === 'playlists')
const detailTitle = computed(() => isAlbumDetail.value ? group.value?.title || '' : selectedList.value?.name || '我喜欢的')
const detailArtist = computed(() => displayed.value[0]?.album_artist || displayed.value[0]?.artist || '未知歌手')
const detailMeta = computed(() => {
  if (!isAlbumDetail.value) return ''
  const first = displayed.value.find(t => t.genre || t.release_date)
  const year = (first?.release_date || '').match(/\d{4}/)?.[0] || ''
  return [first?.genre, year].filter(Boolean).join(' · ')
})
const detailSummary = computed(() => {
  const minutes = Math.round(displayed.value.reduce((sum, t) => sum + (t.duration_ms || 0), 0) / 60000)
  return tt('music.lib.songsSummary', { count: displayed.value.length, minutes })
})
const detailPinKey = computed(() => isAlbumDetail.value ? albumPinKey(displayed.value[0]?.artist, displayed.value[0]?.album || group.value?.title) : playlistPinKey(selected.value))
function playbackFor(t: IMusicTrack): IPageMusicTrack {
  return tab.value === 'playlists' ? listTracks.value.find(p => musicTrackKey(p) === musicTrackKey(t)) || playbackTrack(t) : playbackTrack(t)
}
const detailTracks = computed(() => displayed.value.map(playbackFor))
const detailAllFavorite = computed(() => !!detailTracks.value.length && detailTracks.value.every(t => favoriteKeys.value.has(musicTrackKey(t))))

function switchTab(value: Tab) { collectionTitle.value = ''; tab.value = value; group.value = null; if (value !== 'songs') emit('load-all') }
function openAlbum(track: IMusicTrack) {
  switchTab('albums')
  group.value = { title: track.album || '未知专辑', ids: props.tracks.filter(t => t.album === track.album && t.artist === track.artist).map(t => t.id) }
}
function openForm(value: typeof form.value) { if (form.value !== 'assign') { assignTrack.value = null; assignCollection.value = false } form.value = value; name.value = value === 'rename' ? selectedList.value?.name || '' : ''; chosen.value = []; addQuery.value = ''; if (value === 'add') emit('load-all') }
function persist(next: LocalPlaylist[]) {
  try { savePlaylists(next); playlists.value = next; return true } catch { message.error('歌单保存失败，请重试'); return false }
}
function saveName() {
  if (!name.value.trim()) return
  if (form.value === 'create') {
    const item = createPlaylist(name.value.trim(), assignTrack.value ? [assignTrack.value] : assignCollection.value ? detailTracks.value : [])
    if (!persist([item, ...playlists.value])) return
    switchTab('playlists'); selected.value = item.id
  } else if (!persist(playlists.value.map(p => p.id === selected.value ? { ...p, name: name.value.trim(), updatedAt: Date.now() } : p))) return
  form.value = null
}
function addTo(id: string, tracks: IPageMusicTrack[]) {
  if (persist(playlists.value.map(p => p.id === id ? addTracksToList(p, tracks) : p))) form.value = null
}
function removeTrack(track: IMusicTrack) {
  persist(playlists.value.map(p => p.id === selected.value ? { ...p, tracks: p.tracks.filter(t => musicTrackKey(t) !== musicTrackKey(track)), updatedAt: Date.now() } : p))
}
function deletePlaylist() {
  if (!persist(playlists.value.filter(p => p.id !== selected.value))) return
  setPins(pins.value.filter(pin => pin.key !== playlistPinKey(selected.value)))
  selected.value = 'favorites'
  form.value = null
}
function saveFavorites(next: IPageMusicTrack[]) {
  favorites.value = next
  saveMusicTrackList('pm.favs', favorites.value)
  // Complete the legacy migration so removed favorites do not reappear.
  localStorage.removeItem('pageMusic.favorites')
}
function toggleFavorite(track: IMusicTrack) {
  saveFavorites(favoriteKeys.value.has(musicTrackKey(track)) ? favorites.value.filter(t => musicTrackKey(t) !== musicTrackKey(track)) : [...favorites.value, playbackTrack(track)])
}
function toggleCollectionFavorite() {
  const keys = new Set(detailTracks.value.map(musicTrackKey))
  if (detailAllFavorite.value) {
    saveFavorites(favorites.value.filter(t => !keys.has(musicTrackKey(t))))
    message.success(tt('music.lib.unfavorited'))
  } else {
    saveFavorites([...favorites.value, ...detailTracks.value.filter(t => !favoriteKeys.value.has(musicTrackKey(t)))])
    message.success(tt('music.lib.favorited'))
  }
}
function play(track = displayed.value[0]) {
  if (track) emit('play', displayed.value.map(playbackFor), playbackFor(track))
}
/** Left detail button: play the whole list in random order. */
function shufflePlay() {
  const shuffled = detailTracks.value.slice()
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  if (shuffled.length) emit('play', shuffled, shuffled[0])
}
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); message.success(tt('music.lib.shareCopied')) }
  catch { message.error(tt('music.lib.copyFailed')) }
}
function shareCollection() {
  const head = isAlbumDetail.value ? `${detailTitle.value} — ${detailArtist.value}` : detailTitle.value
  void copyText([head, ...displayed.value.map((t, i) => `${i + 1}. ${title(t)} — ${t.artist || '未知歌手'}`)].join('\n'))
}
function shareTrack(track: IMusicTrack) {
  void copyText([title(track), track.artist, track.album].filter(Boolean).join(' — '))
}
async function downloadTracks(list: IPageMusicTrack[]) {
  if (downloading.value) return
  const { files, skipped } = planMusicDownload(list)
  if (!files.length) { message.warning(skipped ? tt('music.lib.downloadSkipped', { count: skipped }) : tt('music.lib.nothingToDownload')); return }
  const settings = useSettingStore()
  const savePath = settings.AriaIsLocal ? settings.downSavePath : settings.ariaSavePath
  if (!savePath?.trim()) { message.error(tt('music.lib.downloadPathRequired')); return }
  downloading.value = true
  try {
    await DownDAL.aAddDownload(files, savePath, false)
    message.success(tt('music.lib.downloadStarted', { count: files.length }))
    if (skipped) message.info(tt('music.lib.downloadSkipped', { count: skipped }))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    downloading.value = false
  }
}
function queueNext(list: IPageMusicTrack[]) {
  if (!list.length) return
  if (!player.pendingLoad) { emit('play', list, list[0]); return }
  player.queueNext(list)
  message.success(tt('music.lib.queuedNext'))
}
function setPins(next: MusicPin[]) { pins.value = next; saveMusicPins(next) }
function togglePin(pin: Omit<MusicPin, 'pinnedAt'>) {
  const wasPinned = pinKeys.value.has(pin.key)
  setPins(toggleMusicPin(pins.value, pin))
  message.success(tt(wasPinned ? 'music.lib.unpinnedToast' : 'music.lib.pinnedToast'))
}
function toggleCollectionPin() {
  const first = displayed.value[0]
  if (isAlbumDetail.value) togglePin({ key: detailPinKey.value, type: 'album', title: detailTitle.value, subtitle: detailArtist.value, album: first?.album || group.value?.title || '', artist: first?.artist || '', track: first ? playbackTrack(first) : undefined })
  else togglePin({ key: detailPinKey.value, type: 'playlist', title: detailTitle.value, subtitle: tt('music.lib.playlist'), playlistId: selected.value, track: detailTracks.value[0] })
}
function toggleTrackPin(track: IMusicTrack) {
  togglePin({ key: trackPinKey(musicTrackKey(track)), type: 'track', title: title(track), subtitle: track.artist || '未知歌手', track: playbackTrack(track) })
}
function openPin(pin: MusicPin) {
  if (pin.type === 'album') {
    switchTab('albums')
    group.value = { title: pin.album || pin.title, ids: props.tracks.filter(t => (t.album || '') === (pin.album || '') && (t.artist || '') === (pin.artist || '')).map(t => t.id) }
  } else if (pin.type === 'playlist') {
    switchTab('playlists')
    selected.value = pin.playlistId && (pin.playlistId === 'favorites' || playlists.value.some(p => p.id === pin.playlistId)) ? pin.playlistId : 'favorites'
  } else if (pin.track) {
    emit('play', [pin.track], pin.track)
  }
}
function pinCover(pin: MusicPin) {
  return pin.track ? cover(resolveTrack(pin.track)) || pin.track.thumbnail || '' : ''
}
async function deleteFromLibrary(list: IMusicTrack[]) {
  const ids = list.map(t => t.id).filter(id => library.tracks.some(t => t.id === id))
  if (!ids.length) { message.warning(tt('music.lib.notInLibrary')); return }
  if (!window.confirm(tt('music.lib.confirmDeleteTracks', { count: ids.length }))) return
  const deleted = await library.deleteTracksByIds(ids)
  const removedKeys = new Set(list.map(t => trackPinKey(musicTrackKey(t))))
  setPins(pins.value.filter(pin => !removedKeys.has(pin.key)))
  if (isAlbumDetail.value && group.value) {
    group.value = { ...group.value, ids: group.value.ids.filter(id => !ids.includes(id)) }
    if (!group.value.ids.length) group.value = null
  }
  message.success(tt('music.lib.deletedTracks', { count: deleted }))
}
function openMenu(event: MouseEvent, kind: 'collection' | 'track' | 'home', track?: IMusicTrack) {
  menu.value = { kind, track, anchor: (event.currentTarget as HTMLElement).getBoundingClientRect() }
}
const menuTop = computed<MusicMenuItem[]>(() => {
  const state = menu.value
  if (!state || state.kind === 'home') return []
  const track = state.track
  const favorite = track ? favoriteKeys.value.has(musicTrackKey(track)) : detailAllFavorite.value
  return [
    { key: 'download', label: tt('music.lib.download'), icon: CircleArrowDown, disabled: downloading.value },
    { key: 'favorite', label: tt(favorite ? 'music.lib.favorited' : 'music.lib.favorite'), icon: Star, active: favorite, disabled: !track && (!displayed.value.length || (!isAlbumDetail.value && selected.value === 'favorites')) },
    { key: 'share', label: tt('music.lib.share'), icon: Share }
  ]
})
const menuGroups = computed<MusicMenuItem[][]>(() => {
  const state = menu.value
  if (!state) return []
  if (state.kind === 'home') return [
    [{ key: 'import-local', label: tt('music.lib.importLocal'), icon: FolderInput }, { key: 'downloads', label: tt('music.lib.downloads'), icon: Download }],
    [{ key: 'new-playlist', label: tt('music.lib.newPlaylist'), icon: Plus }, { key: 'sources', label: tt('music.lib.sources'), icon: Library }]
  ]
  if (state.kind === 'track' && state.track) {
    const pinned = pinKeys.value.has(trackPinKey(musicTrackKey(state.track)))
    const inUserPlaylist = tab.value === 'playlists' && (!!selectedList.value || selected.value === 'favorites')
    return [
      [{ key: 'pin', label: tt(pinned ? 'music.lib.unpinSong' : 'music.lib.pinSong'), icon: pinned ? PinOff : Pin }, { key: 'add', label: tt('music.lib.addToPlaylist'), icon: ListPlus }],
      [{ key: 'next', label: tt('music.lib.playNext'), icon: ListStart }],
      [{ key: 'credits', label: tt('music.lib.viewCredits'), icon: Info }],
      [...(inUserPlaylist ? [{ key: 'remove', label: tt(selected.value === 'favorites' ? 'music.lib.unfavorite' : 'music.lib.removeFromPlaylist'), icon: ListMinus }] : []), { key: 'delete', label: tt('music.lib.deleteFromLibrary'), icon: Trash2, danger: true }]
    ]
  }
  const pinned = pinKeys.value.has(detailPinKey.value)
  const pinLabel = isAlbumDetail.value ? (pinned ? 'music.lib.unpinAlbum' : 'music.lib.pinAlbum') : (pinned ? 'music.lib.unpinPlaylist' : 'music.lib.pinPlaylist')
  const result: MusicMenuItem[][] = [
    [{ key: 'pin', label: tt(pinLabel), icon: pinned ? PinOff : Pin }, { key: 'add', label: tt('music.lib.addToPlaylist'), icon: ListPlus, disabled: !displayed.value.length }],
    [{ key: 'next', label: tt('music.lib.playNext'), icon: ListStart, disabled: !displayed.value.length }]
  ]
  if (selectedList.value && !isAlbumDetail.value) result.push([{ key: 'rename', label: tt('music.lib.editPlaylist'), icon: Pencil }, { key: 'add-songs', label: tt('music.lib.addSongs'), icon: Plus }])
  if (isAlbumDetail.value) result.push([{ key: 'delete', label: tt('music.lib.deleteFromLibrary'), icon: Trash2, danger: true }])
  else if (selectedList.value) result.push([{ key: 'delete', label: tt('music.lib.deletePlaylist'), icon: Trash2, danger: true }])
  return result
})
function onMenuSelect(key: string) {
  const state = menu.value
  if (!state) return
  const track = state.track
  if (state.kind === 'home') {
    if (key === 'import-local') emit('import-local')
    else if (key === 'downloads') appStore.toggleTab('down')
    else if (key === 'new-playlist') openForm('create')
    else if (key === 'sources') emit('sources')
    return
  }
  if (state.kind === 'track' && track) {
    const item = playbackFor(track)
    if (key === 'download') void downloadTracks([item])
    else if (key === 'favorite') toggleFavorite(track)
    else if (key === 'share') shareTrack(track)
    else if (key === 'pin') toggleTrackPin(track)
    else if (key === 'add') { assignCollection.value = false; assignTrack.value = item; form.value = 'assign' }
    else if (key === 'next') queueNext([item])
    else if (key === 'credits') { creditsTrack.value = track; form.value = 'credits' }
    else if (key === 'remove') selected.value === 'favorites' ? toggleFavorite(track) : removeTrack(track)
    else if (key === 'delete') void deleteFromLibrary([track])
    return
  }
  if (key === 'download') void downloadTracks(detailTracks.value)
  else if (key === 'favorite') toggleCollectionFavorite()
  else if (key === 'share') shareCollection()
  else if (key === 'pin') toggleCollectionPin()
  else if (key === 'add') { assignTrack.value = null; assignCollection.value = true; form.value = 'assign' }
  else if (key === 'next') queueNext(detailTracks.value)
  else if (key === 'rename') openForm('rename')
  else if (key === 'add-songs') openForm('add')
  else if (key === 'delete') isAlbumDetail.value ? void deleteFromLibrary(displayed.value) : openForm('delete')
}
const credits = computed(() => {
  const t = creditsTrack.value
  if (!t) return []
  return [
    [tt('music.lib.songTitle'), title(t)],
    [tt('music.artist'), t.artist],
    [tt('music.album'), t.album],
    [tt('music.lib.albumArtist'), t.album_artist],
    [tt('music.lib.genre'), t.genre],
    [tt('music.lib.trackNumber'), t.track_number ? (t.disc_number ? `${t.disc_number}-${t.track_number}` : String(t.track_number)) : ''],
    [tt('music.lib.releaseDate'), t.release_date],
    [tt('music.duration'), t.duration_ms ? time(t.duration_ms) : ''],
    [tt('music.format'), (t.ext || t.file_name.split('.').pop() || '').toUpperCase()],
    [tt('music.file'), t.parent_path ? `${t.parent_path}/${t.file_name}` : t.file_name]
  ].filter(([, value]) => !!value) as [string, string][]
})
const modalTitle = computed(() => ({ create: '新建歌单', rename: '编辑歌单', delete: '删除歌单', credits: tt('music.lib.credits'), assign: '添加歌曲', add: '添加歌曲' } as Record<string, string>)[form.value || 'add'])
function time(ms?: number) { if (!ms || !Number.isFinite(ms)) return '—'; const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
function sync() { playlists.value = loadPlaylists(); favorites.value = loadMusicTrackList('pm.favs'); pins.value = loadMusicPins() }
onMounted(() => { window.addEventListener('storage', sync); window.addEventListener('focus', sync) })
onUnmounted(() => { window.removeEventListener('storage', sync); window.removeEventListener('focus', sync) })
</script>

<template>
  <section class="music-browser" aria-label="音乐资料库">
    <header v-if="!isAlbumDetail" class="music-browser-toolbar">
      <nav aria-label="音乐分类">
        <button v-for="item in tabs" :key="item.key" :class="{ active: tab === item.key }" :aria-current="tab === item.key ? 'page' : undefined" @click="switchTab(item.key)">{{ item.title }}</button>
      </nav>
      <div class="toolbar-actions">
        <label v-if="searchOpen || query" class="music-search"><Search :size="16" /><input ref="searchInput" v-model="query" :placeholder="tt('music.lib.searchPlaceholder')" :aria-label="tt('music.lib.search')" @input="emit('load-all')" @keydown.esc="closeSearch" @blur="!query && (searchOpen = false)" /></label>
        <button v-else class="toolbar-round" :aria-label="tt('music.lib.search')" :title="tt('music.lib.search')" @click="openSearch"><Search :size="18" /></button>
        <button class="toolbar-round" :aria-label="tt('music.lib.more')" :title="tt('music.lib.more')" @click="openMenu($event, 'home')"><MoreHorizontal :size="20" /></button>
      </div>
    </header>
    <div class="music-browser-body">
      <aside v-if="tab === 'playlists'" class="music-playlists" aria-label="歌单">
        <button :class="{ selected: selected === 'favorites' }" @click="selected = 'favorites'"><Heart :size="24" /><span>我喜欢的<small>{{ favorites.length }} 首歌曲</small></span></button>
        <button v-for="item in playlists" :key="item.id" :class="{ selected: selected === item.id }" @click="selected = item.id"><ListMusic :size="24" /><span>{{ item.name }}<small>{{ item.tracks.length }} 首歌曲</small></span></button>
        <button @click="openForm('create')"><Plus :size="22" />新建歌单</button>
      </aside>
      <main class="music-results" :class="{ 'collection-detail': isDetail, 'album-detail': isAlbumDetail }">
        <template v-if="isDetail">
          <header class="detail-navigation">
            <button v-if="isAlbumDetail" class="detail-round" :aria-label="tt('music.lib.back')" @click="group = null"><ArrowLeft :size="20" /></button>
            <span></span>
            <div class="detail-capsule">
              <button :aria-label="tt('music.lib.share')" :disabled="!displayed.length" @click="shareCollection"><Share :size="18" /></button>
              <button :aria-label="tt('music.lib.more')" @click="openMenu($event, 'collection')"><MoreHorizontal :size="20" /></button>
            </div>
          </header>
          <div class="detail-hero">
            <div class="detail-cover"><img v-if="displayed[0] && cover(displayed[0]) && !failedCovers.has(cover(displayed[0]))" :src="cover(displayed[0])" alt="" @error="failedCovers.add(cover(displayed[0]))" /><Disc3 v-else-if="isAlbumDetail" :size="72" /><Heart v-else-if="selected === 'favorites'" :size="72" /><ListMusic v-else :size="72" /></div>
            <div class="detail-copy">
              <h1>{{ detailTitle }}</h1>
              <p class="detail-artist">{{ isAlbumDetail ? detailArtist : tt('music.lib.playlist') }}</p>
              <p class="detail-meta">{{ detailMeta || detailSummary }}</p>
              <div class="detail-actions">
                <button class="detail-round" :aria-label="tt('music.lib.shufflePlay')" :title="tt('music.lib.shufflePlay')" :disabled="!displayed.length" @click="shufflePlay"><Shuffle :size="20" /></button>
                <button class="detail-play" :disabled="!displayed.length" @click="play()"><Play :size="18" fill="currentColor" />{{ tt('music.play') }}</button>
                <button class="detail-round" :aria-label="tt('music.lib.downloadAll')" :title="tt('music.lib.downloadAll')" :disabled="!displayed.length || downloading" @click="downloadTracks(detailTracks)"><ArrowDown :size="20" /></button>
              </div>
            </div>
          </div>
          <ol class="detail-tracks" :aria-label="detailTitle">
            <li v-for="(track, index) in displayed" :key="track.id" class="detail-track" :class="{ current: player.state.hasTrack && player.state.title === title(track) }">
              <span class="detail-index">{{ isAlbumDetail ? track.track_number || index + 1 : index + 1 }}</span>
              <button class="detail-track-main" @click="play(track)">
                <span v-if="!isAlbumDetail" class="song-cover"><img v-if="cover(track) && !failedCovers.has(cover(track))" :src="cover(track)" alt="" loading="lazy" @error="failedCovers.add(cover(track))" /><Music v-else :size="18" /></span>
                <span class="detail-track-text">{{ rowTitle(track) }}<small v-if="!isAlbumDetail || track.artist !== displayed[0]?.artist">{{ track.artist || '未知歌手' }}</small></span>
              </button>
              <Star v-if="favoriteKeys.has(musicTrackKey(track))" class="detail-fav" :size="12" fill="currentColor" :aria-label="tt('music.lib.favorited')" />
              <span class="detail-duration">{{ time(track.duration_ms) }}</span>
              <button class="detail-more" :aria-label="tt('music.lib.songOptions')" @click="openMenu($event, 'track', track)"><MoreHorizontal :size="20" /></button>
            </li>
          </ol>
          <p v-if="displayed.length" class="detail-footer">{{ detailSummary }}</p>
        </template>
        <div v-else-if="group" class="music-collection-head">
          <button class="icon" aria-label="返回" @click="group = null"><ArrowLeft :size="22" /></button>
          <div><h2>{{ group.title }}</h2><p>{{ displayed.length }} 首歌曲</p></div>
        </div>
        <div v-if="tab === 'home' && !query" class="music-home">
          <section v-if="pins.length" class="music-home-section">
            <h2 class="music-section-title static">{{ tt('music.lib.pinned') }}</h2>
            <div class="music-home-rail">
              <button v-for="pin in pins" :key="pin.key" class="music-home-card" @click="openPin(pin)">
                <span class="music-art"><img v-if="pinCover(pin) && !failedCovers.has(pinCover(pin))" :src="pinCover(pin)" alt="" loading="lazy" @error="failedCovers.add(pinCover(pin))" /><ListMusic v-else-if="pin.type === 'playlist'" :size="44" /><Disc3 v-else :size="44" /><Pin class="pin-badge" :size="12" /></span>
                <strong>{{ pin.title }}</strong><small>{{ pin.subtitle }}</small>
              </button>
            </div>
          </section>
          <section v-for="section in homeSections" :key="section.title" class="music-home-section">
            <button class="music-section-title" @click="switchTab(section.destination); collectionTitle = section.title">{{ section.title }}<ChevronRight :size="20" aria-hidden="true" /></button>
            <div class="music-home-rail">
              <button v-for="track in section.tracks.slice(0, 12)" :key="track.id" class="music-home-card" @click="section.destination === 'albums' ? openAlbum(track) : emit('play', section.tracks.map(playbackTrack), playbackTrack(track))">
                <span class="music-art"><img v-if="cover(track) && !failedCovers.has(cover(track))" :src="cover(track)" alt="" loading="lazy" @error="failedCovers.add(cover(track))" /><Disc3 v-else :size="44" /></span>
                <strong>{{ section.destination === 'albums' ? track.album || '未知专辑' : title(track) }}</strong><small>{{ track.artist || '未知歌手' }}</small>
              </button>
            </div>
          </section>
        </div>
        <template v-else-if="collectionTitle && tab === 'songs'">
          <div class="music-collection-head"><button class="icon" aria-label="返回音乐库" @click="switchTab('home')"><ArrowLeft :size="22" /></button><h2>{{ collectionTitle }}</h2></div>
          <div class="music-collection-grid">
            <button v-for="track in displayed" :key="track.id" class="music-collection" @click="play(track)">
              <span class="music-art"><img v-if="cover(track) && !failedCovers.has(cover(track))" :src="cover(track)" alt="" loading="lazy" @error="failedCovers.add(cover(track))" /><Music v-else :size="44" /></span>
              <strong>{{ title(track) }}</strong><small>{{ track.artist || '未知歌手' }}</small>
            </button>
          </div>
        </template>
        <template v-else-if="(tab === 'artists' || tab === 'albums') && !group">
          <div class="music-collection-grid">
            <button v-for="[key, item] in groups" :key="key" class="music-collection" @click="group = { title: item.title, ids: item.tracks.map(t => t.id) }">
              <div class="music-art" :class="{ round: tab === 'artists' }"><img v-if="cover(item.tracks[0]) && !failedCovers.has(cover(item.tracks[0]))" :src="cover(item.tracks[0])" alt="" loading="lazy" @error="failedCovers.add(cover(item.tracks[0]))" /><UserRound v-else-if="tab === 'artists'" :size="44" /><Disc3 v-else :size="44" /></div>
              <strong>{{ item.title }}</strong><small>{{ tab === 'albums' ? item.artist : `${item.tracks.length} 首歌曲` }}</small>
            </button>
          </div>
        </template>
        <template v-else-if="!isDetail">
          <div class="music-list-actions"><span v-if="!group && tab === 'songs'">{{ total }} 首歌曲</span><button class="primary" :disabled="!displayed.length" @click="play()"><Play :size="16" />播放全部</button></div>
          <div class="music-table-head"><span>#</span><span>歌曲</span><span class="artist-column">歌手</span><span class="album-column">专辑</span><span>时长</span><span></span></div>
          <div v-for="(track, index) in displayed" :key="track.id" class="music-song">
            <span class="song-index">{{ index + 1 }}</span>
            <button class="song-name" @click="play(track)"><span class="song-cover"><img v-if="cover(track) && !failedCovers.has(cover(track))" :src="cover(track)" alt="" loading="lazy" @error="failedCovers.add(cover(track))" /><Music v-else :size="20" /></span><span>{{ title(track) }}<small class="compact-artist">{{ track.artist || '未知歌手' }}</small></span></button>
            <span class="artist-column">{{ track.artist || '未知歌手' }}</span><span class="album-column">{{ track.album || '—' }}</span><span class="song-duration">{{ time(track.duration_ms) }}</span>
            <div class="song-actions"><button class="icon" :class="{ liked: favoriteKeys.has(musicTrackKey(track)) }" :aria-label="favoriteKeys.has(musicTrackKey(track)) ? '取消喜欢' : '喜欢'" :aria-pressed="favoriteKeys.has(musicTrackKey(track))" @click="toggleFavorite(track)"><Heart :size="18" :fill="favoriteKeys.has(musicTrackKey(track)) ? 'currentColor' : 'none'" /></button><button class="icon" :aria-label="tt('music.lib.songOptions')" @click="openMenu($event, 'track', track)"><MoreHorizontal :size="20" /></button></div>
          </div>
        </template>
        <p v-if="loading" role="status" class="music-empty">正在加载音乐…</p>
        <p v-else-if="!displayed.length" class="music-empty">{{ query ? '没有找到匹配的音乐' : tab === 'playlists' ? '歌单还是空的，添加喜欢的歌曲吧' : '暂无音乐，可从音乐来源导入' }}</p>
        <button v-if="hasMore && tab === 'songs' && !group" class="load-more" :disabled="loading" @click="emit('load-more')">加载更多</button>
      </main>
    </div>
    <footer v-if="player.state.hasTrack" class="music-now-playing">
      <div class="now-capsule">
        <button class="now-track" @click="player.togglePanel()"><span class="now-art"><img v-if="player.state.coverUrl" :src="player.state.coverUrl" alt="" /><Music v-else :size="20" /></span><span class="now-text">{{ player.state.title }}<small>{{ player.state.artist }}</small></span></button>
        <div class="now-controls"><button class="icon now-secondary" aria-label="上一首" @click="player.sendCommand('prev')"><SkipBack :size="20" fill="currentColor" /></button><button class="icon now-toggle" :aria-label="player.state.isPlaying ? '暂停' : '播放'" @click="player.sendCommand('toggle')"><Pause v-if="player.state.isPlaying" :size="24" fill="currentColor" /><Play v-else :size="24" fill="currentColor" /></button><button class="icon" aria-label="下一首" @click="player.sendCommand('next')"><SkipForward :size="22" fill="currentColor" /></button></div>
      </div>
      <button class="icon playback-mode" :title="{ list: '顺序播放', 'loop-list': '列表循环', 'loop-one': '单曲循环', shuffle: '随机播放' }[player.state.mode]" aria-label="切换播放模式" @click="player.sendCommand('mode')"><Shuffle v-if="player.state.mode === 'shuffle'" :size="18" /><Repeat1 v-else-if="player.state.mode === 'loop-one'" :size="18" /><Repeat v-else :size="18" /></button>
      <span>{{ time(player.state.currentTime * 1000) }}</span><input class="playback-seek" type="range" min="0" :max="player.state.duration || 1" :value="player.state.currentTime" :disabled="!player.state.duration" aria-label="播放进度" @change="player.sendCommand('seek', Number(($event.target as HTMLInputElement).value))" /><span>{{ time(player.state.duration * 1000) }}</span><label class="playback-volume"><Volume2 :size="18" /><input type="range" min="0" max="1" step="0.01" :value="player.state.volume" aria-label="音量" @input="player.sendCommand('volume', Number(($event.target as HTMLInputElement).value))" /></label><button class="icon" aria-label="播放队列" @click="player.sendCommand('queue')"><ListMusic :size="22" /></button>
    </footer>
    <footer v-else class="music-now-playing music-idle-player">
      <div class="now-capsule">
        <div class="now-track"><span class="now-art"><Music :size="20" /></span><span class="now-text">选择一首音乐<small>从你的音乐资料库开始播放</small></span></div>
        <div class="now-controls"><button class="icon now-toggle" :disabled="!displayed.length" aria-label="播放音乐" @click="play()"><Play :size="24" fill="currentColor" /></button><button class="icon" disabled aria-label="下一首"><SkipForward :size="22" fill="currentColor" /></button></div>
      </div>
      <span class="idle-time">0:00</span><input class="playback-seek" type="range" min="0" max="1" value="0" disabled aria-label="尚未开始播放" /><span class="idle-time">0:00</span><Volume2 :size="18" />
    </footer>
    <MusicActionMenu :visible="!!menu" :anchor="menu?.anchor || null" :top="menuTop" :groups="menuGroups" :label="menu?.kind === 'track' ? tt('music.lib.songOptions') : tt('music.lib.more')" @select="onMenuSelect" @close="menu = null" />
    <a-modal :visible="form !== null" :title="modalTitle" :footer="false" @cancel="form = null">
      <form v-if="form === 'create' || form === 'rename'" class="music-form" @submit.prevent="saveName"><label>歌单名称<input v-model="name" autofocus maxlength="100" required /></label><button class="primary" :disabled="!name.trim()">保存</button></form>
      <div v-else-if="form === 'delete'" class="music-form"><p>删除“{{ selectedList?.name }}”？歌曲文件不会被删除。</p><button @click="deletePlaylist">删除歌单</button></div>
      <div v-else-if="form === 'assign'" class="music-form"><button v-for="item in playlists" :key="item.id" @click="addTo(item.id, assignTrack ? [assignTrack] : detailTracks)">{{ item.name }}</button><button @click="openForm('create')"><Plus :size="16" />新建歌单</button></div>
      <dl v-else-if="form === 'credits'" class="music-credits"><template v-for="[label, value] in credits" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></template></dl>
      <div v-else class="music-form"><input v-model="addQuery" placeholder="搜索要添加的歌曲" aria-label="搜索要添加的歌曲" /><div class="music-picker"><label v-for="track in candidates" :key="track.id"><input v-model="chosen" type="checkbox" :value="track.id" />{{ title(track) }} · {{ track.artist || '未知歌手' }}</label></div><button class="primary" :disabled="!chosen.length" @click="addTo(selected, tracks.filter(t => chosen.includes(t.id)).map(playbackTrack))">添加 {{ chosen.length }} 首歌曲</button></div>
    </a-modal>
  </section>
</template>

<style scoped>
/* Apple Music style album / playlist detail. */
.collection-detail { padding-top:0; }
.detail-navigation { display:flex; align-items:center; gap:12px; position:sticky; top:0; z-index:2; padding:16px 0 10px; background:var(--color-bg-1); }
.detail-navigation > span { flex:1; }
.detail-capsule { display:flex; align-items:center; gap:4px; height:44px; padding:0 6px; box-sizing:border-box; border-radius:22px; color:var(--color-text-1); background:var(--color-fill-1); }
.detail-capsule button { width:36px; height:36px; padding:0; border-radius:50%; color:inherit; }
.detail-capsule button:hover:not(:disabled) { background:var(--color-fill-2); }
.detail-round { width:44px; height:44px; padding:0; border-radius:50%; background:var(--color-fill-1); color:rgb(var(--primary-6)); flex-shrink:0; }
.detail-navigation .detail-round { color:var(--color-text-1); }
/* Home toolbar: neutral round Search / More buttons, matching the detail back button. */
.toolbar-actions { display:flex; align-items:center; gap:10px; margin-left:auto; }
.toolbar-round { width:40px; height:40px; padding:0; border-radius:50%; color:var(--color-text-1); background:var(--color-fill-1); flex-shrink:0; }
.toolbar-round:hover { background:var(--color-fill-2); }
.detail-round:hover { background:var(--color-fill-2); }
.detail-hero { display:flex; align-items:flex-end; gap:32px; margin:8px 0 28px; }
.detail-cover { width:clamp(180px, 24vw, 270px); aspect-ratio:1; flex-shrink:0; border-radius:10px; overflow:hidden; display:grid; place-items:center; color:var(--color-text-3); background:var(--color-fill-2); box-shadow:0 10px 30px rgba(0, 0, 0, .16); }
.detail-cover img { width:100%; height:100%; object-fit:cover; }
.detail-copy { min-width:0; flex:1; display:flex; flex-direction:column; }
.detail-copy h1 { margin:0; font-size:26px; line-height:1.2; font-weight:700; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.detail-artist { margin:4px 0 0; font-size:22px; line-height:1.25; color:rgb(var(--primary-6)); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.detail-meta { margin:6px 0 0; font-size:12px; font-weight:600; letter-spacing:.02em; text-transform:uppercase; color:var(--color-text-3); }
.detail-actions { display:flex; align-items:center; gap:14px; margin-top:20px; }
.detail-play { min-width:150px; height:44px; padding:0 26px; border-radius:22px; color:var(--color-white); background:rgb(var(--primary-6)); font-size:15px; font-weight:600; }
.detail-play:hover { background:rgb(var(--primary-5)); }
.detail-tracks { list-style:none; margin:0; padding:0; border-top:.5px solid var(--color-border-1); }
.detail-track { display:grid; grid-template-columns:36px minmax(0,1fr) auto 52px 40px; align-items:center; gap:10px; min-height:48px; border-radius:8px; }
.detail-track:hover { background:var(--color-fill-1); }
.detail-track + .detail-track { box-shadow:inset 0 .5px 0 var(--color-border-1); }
.detail-index { text-align:right; color:var(--color-text-3); font-size:14px; font-variant-numeric:tabular-nums; }
.detail-track-main { min-width:0; justify-content:flex-start; gap:12px; padding:8px 4px; font-size:15px; text-align:left; }
.detail-track-main:hover { background:transparent; }
.detail-track-text { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.detail-track-text small { margin-top:2px; font-size:12px; }
.detail-track.current .detail-track-text, .detail-track.current .detail-index { color:rgb(var(--primary-6)); }
.detail-fav { color:rgb(var(--primary-6)); }
.detail-duration { color:var(--color-text-3); font-size:13px; font-variant-numeric:tabular-nums; text-align:right; }
.detail-more { width:36px; height:36px; padding:0; border-radius:50%; color:rgb(var(--primary-6)); }
.detail-footer { margin:16px 0 0 46px; font-size:13px; color:var(--color-text-3); }
.music-credits { display:grid; grid-template-columns:max-content minmax(0,1fr); gap:10px 18px; margin:0; width:min(420px, calc(100vw - 80px)); color:var(--color-text-1); }
.music-credits dt { color:var(--color-text-3); }
.music-credits dd { margin:0; overflow-wrap:anywhere; }
@media(max-width:760px) {
  .detail-hero { flex-direction:column; align-items:center; text-align:center; }
  .detail-copy { align-items:center; }
  .detail-actions { width:100%; justify-content:center; }
  .detail-play { flex:1; max-width:260px; }
}


.music-browser { height:100%; min-height:0; display:flex; flex-direction:column; color:var(--color-text-1); background:var(--color-bg-1); font-size:14px; }
.music-browser nav button { box-shadow:none; filter:none; }
.playlist-art { display:grid; place-items:center; width:88px; height:88px; flex-shrink:0; border-radius:12px; background:var(--color-fill-2); color:rgb(var(--primary-6)); overflow:hidden; }
.music-form { width:min(380px, calc(100vw - 80px)); }
button { color:inherit; font:inherit; border:0; background:transparent; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:9px 14px; border-radius:8px; }
button:hover { background:var(--color-fill-2); } button:focus-visible, input:focus-visible { outline:2px solid rgb(var(--primary-6)); outline-offset:2px; } button:disabled { opacity:.45; cursor:default; }
.primary { color:var(--color-white); background:rgb(var(--primary-6)); } .primary:hover { background:rgb(var(--primary-5)); }
.icon { width:36px; height:36px; padding:0; flex-shrink:0; }
.music-browser-toolbar { display:flex; align-items:center; gap:12px; padding:20px 28px 16px; flex-wrap:wrap; }
nav { display:flex; gap:8px; margin-right:auto; } nav button { border:1px solid var(--color-border-1); border-radius:999px; padding:9px 16px; white-space:nowrap; color:var(--color-text-2); background:var(--color-fill-1); } nav .active { color:rgb(var(--primary-6)); border-color:rgba(var(--primary-6),.45); background:rgba(var(--primary-6),.14); font-weight:600; }
.music-search { display:flex; gap:8px; align-items:center; padding:8px 12px; border:1px solid var(--color-border-2); border-radius:20px; color:var(--color-text-3); } input { color:var(--color-text-1); background:transparent; border:0; outline:none; font:inherit; min-width:0; } .music-search input { width:190px; }
.music-browser-body { display:flex; flex:1; min-height:0; overflow:hidden; } .music-results { padding:0 28px 28px; flex:1; min-width:0; overflow:auto; }
.music-playlists { width:218px; flex-shrink:0; overflow:auto; padding:12px; border-right:1px solid var(--color-border-1); } .music-playlists button { display:flex; justify-content:flex-start; width:100%; gap:14px; text-align:left; margin-bottom:6px; } .music-playlists span { overflow:hidden; text-overflow:ellipsis; } .music-playlists .selected { color:rgb(var(--primary-6)); background:var(--color-fill-2); }
small { display:block; color:var(--color-text-3); font-size:12px; font-weight:400; margin-top:4px; }
.music-collection-head { display:flex; align-items:center; gap:12px; margin:20px 0; flex-wrap:wrap; } .music-collection-head h2 { font-size:24px; margin:0; } .music-collection-head p { color:var(--color-text-3); margin:6px 0; } .music-collection-head>div { margin-right:auto; }
.music-list-actions { display:flex; align-items:center; justify-content:flex-end; gap:16px; margin:8px 0 16px; color:var(--color-text-3); }
.music-song, .music-table-head { display:grid; grid-template-columns:32px minmax(150px,2.4fr) minmax(100px,1fr) minmax(100px,1fr) 52px 76px; align-items:center; gap:12px; border-bottom:1px solid var(--color-border-1); min-height:68px; } .music-table-head { min-height:34px; font-size:12px; color:var(--color-text-3); }
.music-song:hover { background:var(--color-fill-1); } .song-name { min-width:0; text-align:left; padding:8px 0; justify-content:flex-start; gap:14px; } .song-name>span:last-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .song-cover { width:44px; height:44px; display:grid; place-items:center; background:var(--color-fill-2); border-radius:6px; flex-shrink:0; } img { width:100%; height:100%; object-fit:cover; border-radius:inherit; } .artist-column, .album-column { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--color-text-2); } .song-duration, .song-index { color:var(--color-text-3); font-variant-numeric:tabular-nums; } .song-actions { display:flex; } .liked { color:rgb(var(--primary-6)); } .compact-artist { display:none; }
.music-collection-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:24px; padding-top:16px; } .music-collection { display:block; padding:0; text-align:left; min-width:0; } .music-art { width:100%; aspect-ratio:1; border-radius:8px; background:var(--color-fill-2); color:var(--color-text-3); display:grid; place-items:center; margin-bottom:12px; } .music-art.round { border-radius:50%; } .music-collection strong { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.music-empty { text-align:center; color:var(--color-text-3); padding:56px 12px; } .load-more { display:flex; margin:20px auto; }
.music-now-playing { display:flex; align-items:center; gap:16px; padding:12px 24px; border-top:1px solid var(--color-border-1); } .now-track { width:240px; justify-content:flex-start; min-width:0; text-align:left; padding:0; } .now-track img { width:44px; height:44px; border-radius:6px; } .now-track span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; } .now-controls { display:flex; gap:10px; } progress { flex:1; min-width:40px; height:4px; accent-color:rgb(var(--primary-6)); }
.music-form { display:flex; flex-direction:column; gap:16px; color:var(--color-text-1); } .music-form input:not([type=checkbox]) { border:1px solid var(--color-border-2); border-radius:8px; padding:10px; display:block; width:100%; box-sizing:border-box; margin-top:8px; } .music-form button { border:1px solid var(--color-border-2); } .music-picker { max-height:320px; overflow:auto; } .music-picker label { display:flex; align-items:center; padding:10px 0; gap:10px; }
.playback-seek { flex:1; min-width:50px; accent-color:rgb(var(--primary-6)); } .playback-volume { display:flex; align-items:center; gap:8px; } .playback-volume input { width:70px; accent-color:rgb(var(--primary-6)); }
@media(max-width:1100px) { .playback-volume { display:none; } }
@media(max-width:700px) { .playback-seek,.playback-mode { display:none; } }
@media(max-width:1000px) { .artist-column { display:none; } .compact-artist { display:block; } .music-song,.music-table-head { grid-template-columns:24px minmax(130px,2fr) minmax(80px,1fr) 44px 72px; } .music-playlists { width:180px; } .now-track { width:160px; } }
@media(max-width:700px) { .music-browser-toolbar { padding:12px; gap:8px; } nav { width:100%; gap:20px; } .music-search { flex:1; } .music-search input { width:100%; } .music-results { padding:0 12px 20px; } .music-playlists { width:130px; padding:6px; } .music-playlists button { padding:10px 6px; } .music-playlists svg { display:none; } .album-column { display:none; } .music-song,.music-table-head { grid-template-columns:20px minmax(100px,1fr) 42px 72px; gap:6px; } .music-now-playing { padding:10px; gap:8px; } .music-now-playing>span,.music-now-playing progress { display:none; } .now-track { flex:1; } }
</style>

<style scoped>

/* Local music tokens keep both themes neutral and match the library's orange accent. */
.music-browser {
  --primary-6: 244, 102, 34;
  --primary-5: 230, 86, 20;
  --color-bg-1: #fafbfc;
  --color-text-1: #20242c;
  --color-text-2: #626978;
  --color-text-3: #858c98;
  --color-border-1: #e9ecf0;
  --color-border-2: #e1e5ea;
  --color-fill-1: #f0f2f5;
  --color-fill-2: #e9edf1;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
:global(body[arco-theme='dark'] .music-browser) {
  --color-bg-1: #181c1f;
  --color-text-1: #edf0f2;
  --color-text-2: #b0b7c2;
  --color-text-3: #858e99;
  --color-border-1: #292e33;
  --color-border-2: #363d44;
  --color-fill-1: #22282d;
  --color-fill-2: #2b3239;
}
.music-browser-toolbar { width:100%; max-width:1280px; box-sizing:border-box; margin:0 auto; padding:24px 36px 16px; gap:20px; }
nav { gap:28px; } nav button { font-size:15px; padding:10px 8px; }
.music-search { background:var(--color-fill-1); padding:9px 14px; }
.primary { border-radius:11px; padding:10px 18px; font-weight:500; box-shadow:none; }
.music-browser-body { width:100%; max-width:1280px; margin:0 auto; }
.music-results { padding:0 36px 24px; }
.music-list-actions { margin:0 0 18px; min-height:38px; font-size:12px; }
.music-song,.music-table-head { grid-template-columns:32px minmax(190px,2.1fr) minmax(120px,1fr) minmax(120px,1fr) 58px 86px; gap:14px; min-height:59px; }
.music-table-head { min-height:32px; }
.song-name { border-radius:0; padding:5px 0; gap:16px; font-weight:600; }
.song-name:hover { background:transparent; }
.song-cover { width:44px; height:44px; border-radius:6px; }
.song-index { padding-left:8px; font-size:13px; }
.music-song { transition:background .15s; }
.song-actions { gap:6px; }
.music-collection-grid { grid-template-columns:repeat(auto-fill,minmax(145px,1fr)); gap:22px; padding:12px 0 24px; }
.music-art { border-radius:7px; margin-bottom:10px; }
.music-collection:hover { background:transparent; }
.music-collection:hover .music-art { outline:2px solid rgb(var(--primary-6)); outline-offset:3px; }
.music-collection strong { font-size:15px; font-weight:600; }
.music-playlists { width:220px; padding:12px 16px; }
.music-playlists .selected { border-left:3px solid rgb(var(--primary-6)); border-radius:6px; }
.music-collection-head { margin:12px 0 20px; gap:18px; }
.playlist-art { width:112px; height:112px; border-radius:8px; }
.music-now-playing { min-height:70px; box-sizing:border-box; padding:12px max(28px,calc((100% - 1208px) / 2)); gap:20px; background:var(--color-bg-1); flex-shrink:0; }
.now-track { width:230px; gap:12px; font-size:13px; }
.now-controls { gap:14px; }
.now-controls .primary { border-radius:50%; width:40px; height:40px; padding:0; }
.music-now-playing>span { font-size:11px; color:var(--color-text-2); font-variant-numeric:tabular-nums; }
.music-idle-player .now-track { display:flex; align-items:center; }
.music-idle-player .playback-seek { opacity:.4; }
@media(max-width:1100px) {
  .music-browser-toolbar { padding:18px 24px; gap:12px; } nav { gap:18px; }
  .music-results { padding:0 24px 20px; }
  .music-song,.music-table-head { grid-template-columns:24px minmax(140px,2fr) minmax(90px,1fr) 48px 78px; }
  .artist-column { display:none; } .compact-artist { display:block; }
  .music-now-playing { padding:12px 24px; gap:12px; } .now-track { width:180px; }
}
@media(max-width:700px) {
  .music-browser-toolbar { padding:12px; } nav { gap:18px; }
  .music-results { padding:0 12px 18px; }
  .music-song,.music-table-head { grid-template-columns:20px minmax(100px,1fr) 42px 72px; gap:6px; }
  .music-playlists { width:130px; padding:6px; } .playlist-art { width:64px;height:64px; }
  .music-now-playing { padding:10px 12px; } .now-track { flex:1; }
}
/* Apple Music library home: bold 22px section titles, square cards with 10px radius. */
.music-home { padding-top:4px; }
.music-home-section { margin:6px 0 30px; }
.music-section-title { gap:2px; padding:6px 0 12px; font-size:22px; font-weight:700; letter-spacing:-.01em; border-radius:6px; }
.music-section-title:hover { background:transparent; }
.music-section-title svg { color:var(--color-text-3); }
.music-section-title.static { margin:0; padding:6px 0 12px; }
.music-home-rail { display:flex; overflow-x:auto; gap:20px; padding:2px 2px 10px; scroll-snap-type:x proximity; scrollbar-width:none; }
.music-home-rail::-webkit-scrollbar { display:none; }
.music-home-card { display:block; flex:0 0 clamp(150px, 15vw, 196px); min-width:0; text-align:left; padding:0; border-radius:10px; scroll-snap-align:start; }
.music-home-card:hover { background:transparent; }
.music-home-card .music-art { position:relative; aspect-ratio:1; width:100%; margin-bottom:8px; border-radius:10px; overflow:hidden; display:grid; place-items:center; background:var(--color-fill-2); box-shadow:0 0 0 .5px var(--color-border-1); transition:filter .15s; }
.music-home-card:hover .music-art { filter:brightness(.92); }
.music-home-card img { width:100%; height:100%; object-fit:cover; }
.music-home-card strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; font-weight:400; line-height:1.3; }
.music-home-card small { margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; line-height:1.3; color:var(--color-text-3); }
.pin-badge { position:absolute; top:8px; right:8px; padding:4px; box-sizing:content-box; border-radius:50%; color:#fff; background:rgba(0, 0, 0, .45); }

/* Mini player: Apple Music style capsule with artwork, title/artist and play/next. */
.now-capsule { display:flex; align-items:center; gap:12px; width:360px; max-width:42%; min-width:0; flex-shrink:0; padding:6px 10px 6px 6px; border-radius:28px; background:var(--color-fill-1); box-shadow:0 0 0 .5px var(--color-border-1), 0 4px 16px rgba(0, 0, 0, .06); box-sizing:border-box; }
.now-capsule .now-track { flex:1; width:auto; min-width:0; display:flex; align-items:center; gap:10px; padding:0; border-radius:22px; }
.now-capsule .now-track:hover { background:transparent; }
.now-art { width:40px; height:40px; flex-shrink:0; border-radius:8px; overflow:hidden; display:grid; place-items:center; color:var(--color-text-3); background:var(--color-fill-2); }
.now-art img { width:100%; height:100%; border-radius:inherit; }
.now-text { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:14px; font-weight:600; }
.now-text small { margin-top:1px; font-size:13px; font-weight:400; overflow:hidden; text-overflow:ellipsis; }
.now-capsule .now-controls { gap:2px; }
.now-capsule .now-controls .icon { width:38px; height:38px; border-radius:50%; color:var(--color-text-1); background:transparent; }
.now-capsule .now-controls .icon:hover:not(:disabled) { background:var(--color-fill-2); }
@media(max-width:1100px) { .now-capsule { width:300px; } .now-secondary { display:none; } }
@media(max-width:700px) { .now-capsule { width:auto; max-width:none; flex:1; } }
</style>
