<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { Star, ListVideo, Play, RefreshCw, Shuffle, House, Folder, Pencil } from 'lucide-vue-next'
import { t } from '../i18n'
import { libraryCategoryIcon } from '../utils/libraryCategoryIcon'
import DB from '../utils/db'
import type { MediaLibraryItem } from '../types/media'
import type { UnifiedLibraryCard, UnifiedLibraryRow } from '../types/unifiedMediaLibrary'
import { LIBRARY_CATEGORY_IDS, MOVIE_CATEGORY_IDS, TV_CATEGORY_IDS, libraryHomeId, libraryGroupRoute, libraryGroupLabel, filterLibraryCategory, libraryCategoryGroups, libraryMovieSeries, libraryPlaylistMembers } from '../utils/unifiedLibraryCategories'
import { isMediaWatched } from '../utils/localWatchedState'
import { hasLocalMedia } from '../utils/unifiedMediaScope'
import { seriesPreferences, movieVersionItems, expandedMovieCollections } from '../utils/seriesVersionPreferences'
import { loadCustomSeries } from '../utils/customMediaSeries'
import { compareMediaBrowseValues, type MediaBrowseSort } from '../utils/mediaBrowseSort'
import { useMediaLibraryStore } from '../store/medialibrary'
import useHomePreferences from '../store/unifiedHomePreferences'
import UnifiedMediaRow from './UnifiedMediaRow.vue'
import { libraryObjectCover } from '../utils/libraryObjectCover'
import LibraryObjectActions from './LibraryObjectActions.vue'
import MediaLoadingIndicator from './MediaLoadingIndicator.vue'

const props = defineProps<{ route: string; mode: 'grid' | 'list'; sort: MediaBrowseSort; localOnly: boolean; dailyItems: MediaLibraryItem[]; selection?: string[]; card: (item: MediaLibraryItem, landscape?: boolean, playlistName?: string, seriesID?: string) => UnifiedLibraryCard }>()
const emit = defineEmits<{ navigate: [route: string]; play: [items: MediaLibraryItem[], mode: 'play' | 'loop' | 'shuffle', title: string]; title: [title: string]; customSeries: [id: string]; toggleHome: [route: string]; placement: [route: string, action: 'home' | 'favorite' | 'rename' | 'remove' | 'removeFavorite'] }>()
const media = useMediaLibraryStore()
const home = useHomePreferences()
const library = shallowRef<MediaLibraryItem[]>([])
const coverRevision = ref(0)
const updateCovers = () => { coverRevision.value++ }
onMounted(() => window.addEventListener('boxplayer:library-cover-changed', updateCovers))
onUnmounted(() => window.removeEventListener('boxplayer:library-cover-changed', updateCovers))
const loading = ref(false)
const error = ref('')
let generation = 0
async function reload() {
  const current = ++generation
  loading.value = true
  error.value = ''
  try { const items = await DB.getHomeMediaLibrary(); if (current === generation) library.value = items }
  catch (reason) { if (current === generation) error.value = String(reason) }
  finally { if (current === generation) loading.value = false }
}
onMounted(reload)
watch(() => media.catalogRevision, reload)
const items = computed(() => expandedMovieCollections(props.localOnly ? library.value.filter(hasLocalMedia) : library.value))
const parts = computed(() => props.route.split('/'))
const root = computed(() => parts.value[0])
const category = computed(() => parts.value[1] || '')
function label(route: string): string {
  const savedTitle = home.titles[libraryHomeId(route)]
  if (savedTitle && !(route === 'tv/genres' && savedTitle === t('unified.movieGenres'))) return savedTitle
  const [root, sub, value] = route.split('/')
  if (value) return libraryGroupLabel(sub, decodeURIComponent(value))
  if (root === 'playlist' && sub) return decodeURIComponent(sub)
  if (root === 'series' && sub) return libraryMovieSeries(items.value).find(group => group.id === sub)?.title || t('unified.series')
  if (root === 'custom-series' && sub) return loadCustomSeries().find(group => group.id === sub)?.title || t('unified.series')
  if (sub === 'all') return root === 'movies' ? t('unified.allMovies') : t('unified.allTv')
  if (sub === 'recent') return t('media.recentlyAdded')
  if (sub === 'unwatched') return t('media.unwatched')
  if (sub === 'movies') return t('media.movie')
  if (sub) return t(('libraryBrowse.' + sub) as Parameters<typeof t>[0])
  const labels: Record<string, string> = { library: t('media.library'), playlist: t('media.playlist'), series: t('unified.series'), recent: t('media.recentlyAdded'), unwatched: t('media.unwatched'), daily: t('unified.dailyPicks'), movies: t('media.movie'), tv: t('media.tv'), other: t('unified.other'), music: t('nav.music'), books: t('nav.books'), favorites: t('unified.sources') }
  return labels[root] || root
}
const title = computed(() => label(props.route))
watch(title, value => emit('title', value), { immediate: true })
const filtered = computed(() => filterLibraryCategory(items.value, props.route, item => isMediaWatched(item, media.watchedItems)))
const playlists = computed(() => Object.entries(media.playlists).map(([name, ids]) => ({ name, members: libraryPlaylistMembers(items.value, ids) })))
const series = computed(() => libraryMovieSeries(items.value))
const inlineSeries = computed(() => {
  const enabled = root.value === 'movies' ? seriesPreferences.showMovies : root.value === 'tv' && seriesPreferences.showTV
  if (!enabled || parts.value.length !== 2 || category.value !== 'all') return []
  const allowed = new Set(filtered.value.map(item => item.id))
  const automatic = root.value === 'movies' ? series.value.filter(group => group.members.some(item => allowed.has(item.id))) : []
  const custom = seriesPreferences.useCustom ? loadCustomSeries().map(group => ({ id: 'custom:' + group.id, title: group.title,
    members: libraryPlaylistMembers(items.value, group.members.filter(member => !member.serverId).map(member => member.id)).filter(item => item.type === (root.value === 'movies' ? 'movie' : 'tv')) })).filter(group => group.members.length) : []
  const customIDs = new Set(custom.flatMap(group => group.members.map(item => item.id)))
  return [...custom, ...automatic.map(group => ({ ...group, members: group.members.filter(item => !customIDs.has(item.id)) })).filter(group => group.members.length)]
})
function openCollection(id: string, members: MediaLibraryItem[]) {
  if (seriesPreferences.openDetail && members[0]) { props.card(members[0]).action(); return }
  if (id.startsWith('custom:')) emit('customSeries', id.slice(7))
  else emit('navigate', 'series/' + id)
}
const selectedMembers = computed(() => {
  const name = decodeURIComponent(category.value)
  if (root.value === 'playlist') return playlists.value.find(group => group.name === name)?.members || []
  if (root.value === 'series') return series.value.find(group => group.id === name)?.members || []
  if (root.value === 'daily') return props.localOnly ? props.dailyItems.filter(hasLocalMedia) : props.dailyItems
  return filtered.value
})
const tiles = computed(() => {
  if (props.route === 'library') return LIBRARY_CATEGORY_IDS.map(id => ({ key: id, title: label(id) }))
  if (props.route === 'movies' || props.route === 'tv') return (root.value === 'movies' ? MOVIE_CATEGORY_IDS : TV_CATEGORY_IDS).map(id => ({ key: root.value + '/' + id, title: label(root.value + '/' + id) }))
  if (['genres', 'ratings', 'years', 'resolution', 'certification', 'networks'].includes(category.value) && parts.value.length === 2) return libraryCategoryGroups(filtered.value, category.value).map(group => ({ key: libraryGroupRoute(props.route, group.name), title: group.name }))
  return []
})
const tilePage = computed(() => ['library', 'movies', 'tv'].includes(props.route) || (['genres', 'ratings', 'years', 'resolution', 'certification', 'networks'].includes(category.value) && parts.value.length === 2))
const facetPage = computed(() => ['genres', 'ratings', 'years', 'resolution', 'certification', 'networks'].includes(category.value) && parts.value.length === 2)
const groupCards = computed<UnifiedLibraryCard[]>(() => {
  void coverRevision.value
  if (facetPage.value) return libraryCategoryGroups(filtered.value, category.value).map(group => ({ key: libraryGroupRoute(props.route, group.name), title: group.name, image: libraryObjectCover(libraryGroupRoute(props.route, group.name), group.members), subtitle: t('customSeries.memberCount', { count: group.members.length }), contextMenu: event => openMenu(event, libraryGroupRoute(props.route, group.name)), action: () => emit('navigate', libraryGroupRoute(props.route, group.name)) }))
  if (props.route === 'playlist') return playlists.value.map(group => ({ key: 'playlist/' + encodeURIComponent(group.name), title: group.name, image: libraryObjectCover('playlist/' + encodeURIComponent(group.name), group.members), subtitle: t('customSeries.memberCount', { count: group.members.length }), contextMenu: event => openMenu(event, 'playlist/' + encodeURIComponent(group.name)), action: () => emit('navigate', 'playlist/' + encodeURIComponent(group.name)) }))
  if (props.route === 'series') return [
    ...series.value.map(group => ({ key: 'series/' + group.id, title: group.title, image: group.members[0]?.posterUrl, subtitle: t('customSeries.memberCount', { count: group.members.length }), contextMenu: (event: MouseEvent) => openMenu(event, 'series/' + group.id), action: () => openCollection(group.id, group.members) })),
    ...(seriesPreferences.useCustom ? loadCustomSeries() : []).map(group => {
      const members = libraryPlaylistMembers(items.value, group.members.filter(member => !member.serverId).map(member => member.id))
      return { key: 'custom-series/' + group.id, title: group.title, image: members.find(item => item.posterUrl)?.posterUrl, subtitle: t('customSeries.memberCount', { count: group.members.length }), contextMenu: (event: MouseEvent) => openMenu(event, 'custom-series/' + group.id), action: () => openCollection('custom:' + group.id, members) }
    })
  ]
  return []
})
const sortedMembers = computed(() => {
  return root.value === 'playlist' && props.sort === 'addedAt' ? selectedMembers.value
    : [...selectedMembers.value].sort((a, b) => compareMediaBrowseValues(
      { title: a.name, fileName: a.driveFiles[0]?.name, addedAt: a.addedAt, premiereDate: a.releaseDate },
      { title: b.name, fileName: b.driveFiles[0]?.name, addedAt: b.addedAt, premiereDate: b.releaseDate },
      props.sort))
})
const row = computed<UnifiedLibraryRow>(() => {
  const grouped = facetPage.value || props.route === 'playlist'
  const inline = inlineSeries.value
  const cards = [...groupCards.value, ...inline.map(group => ({ key: 'inline-series:' + group.id, title: group.title,
    image: group.members[0]?.posterUrl, subtitle: t('customSeries.memberCount', { count: group.members.length }),
    action: () => openCollection(group.id, group.members) }))]
  const memberPage = !tilePage.value && !['playlist', 'series'].includes(props.route)
  const groupedIDs = new Set(inline.flatMap(group => group.members.map(item => item.id)))
  const members = memberPage ? movieVersionItems(sortedMembers.value.filter(item => !groupedIDs.has(item.id))) : []
  void coverRevision.value
  return { key: props.route, title: title.value, cards, grouped, landscape: grouped,
    count: cards.length + members.length,
    cardAt: !memberPage ? undefined : index => { if (index < cards.length) return cards[index]; const item = members[index - cards.length]; const card = props.card(item, false, root.value === 'playlist' ? decodeURIComponent(category.value) : undefined); return seriesPreferences.mergeVersions ? card : { ...card, key: card.key + ':file:' + item.driveFiles[0]?.id } },
    more: () => {} }
})
const reordering = ref(false)
function beginReorder() { reordering.value = true }
function reorder(source: string, target: string) {
  if (root.value !== 'playlist') return
  const name = decodeURIComponent(category.value), ids = [...(media.playlists[name] || [])]
  const from = ids.indexOf(source.replace(/^local:/, '')), to = ids.indexOf(target.replace(/^local:/, ''))
  if (from < 0 || to < 0 || from === to) return
  ids.splice(to, 0, ...ids.splice(from, 1)); media.playlists = { ...media.playlists, [name]: ids }
}
const menu = ref<{ route: string; x: number; y: number }>()
function closeMenuOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') menu.value = undefined }
onMounted(() => document.addEventListener('keydown', closeMenuOnEscape))
onUnmounted(() => { generation++; document.removeEventListener('keydown', closeMenuOnEscape) })
function openMenu(event: MouseEvent, route: string) { event.preventDefault(); menu.value = { route, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 240)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 280)) } }
function play(mode: 'play' | 'loop' | 'shuffle') {
  const route = menu.value?.route || props.route
  const members = route === 'daily' ? props.dailyItems.filter(item => !props.localOnly || hasLocalMedia(item)) : route.startsWith('playlist/') ? playlists.value.find(group => group.name === decodeURIComponent(route.slice(9)))?.members || [] : route.startsWith('series/') ? series.value.find(group => group.id === route.slice(7))?.members || [] : route.startsWith('custom-series/') ? libraryPlaylistMembers(items.value, loadCustomSeries().find(group => group.id === route.slice('custom-series/'.length))?.members.filter(member => !member.serverId).map(member => member.id) || []) : filterLibraryCategory(items.value, route, item => isMediaWatched(item, media.watchedItems))
  emit('play', members, mode, label(route))
  menu.value = undefined
}
defineExpose({ openMenu, play, beginReorder, finishReorder: () => { reordering.value = false } })
</script>

<template>
  <div class="library-browser" data-testid="library-category-browser">
    <div v-if="loading" class="loading"><MediaLoadingIndicator /></div>
    <div v-else-if="error" role="alert">{{ error }} <button @click="reload">{{ t('common.retry') }}</button></div>
    <div v-else-if="tilePage && !facetPage && tiles.length" class="category-grid" :class="{ 'category-list': mode === 'list' }">
      <button v-for="tile in tiles" :key="tile.key" class="category-tile" :data-category="tile.key" @click="emit('navigate', tile.key)" @contextmenu="openMenu($event, tile.key)"><div class="category-art"><component :is="libraryCategoryIcon(tile.key)" :size="60" :stroke-width="1.6" /></div><strong>{{ tile.title }}</strong></button>
    </div>
    <div v-else-if="route === 'playlist' && !groupCards.length" class="empty-state"><ListVideo :size="100" /><h2>{{ t('media.playlist') }}</h2><p>{{ t('libraryBrowse.playlistHelp') }}</p></div>
    <UnifiedMediaRow v-else-if="row.count && (!tilePage || facetPage)" :row="row" :mode="facetPage || route === 'playlist' ? 'list' : mode" :show-more="false" :selection="selection" :reordering="reordering" @reorder="reorder" />
    <div v-else class="empty-state"><Folder :size="72" /><h2>{{ title }}</h2><p>{{ category === 'certification' ? t('libraryBrowse.unknown') : t('libraryBrowse.empty') }}</p></div>
    <Teleport to="body"><div v-if="menu" class="category-menu-dismiss" @pointerdown="menu = undefined" @contextmenu.prevent="menu = undefined" @keydown.esc="menu = undefined"><div class="category-menu" role="menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @pointerdown.stop>
      <LibraryObjectActions :route="menu.route" @action="menu = undefined" />
    </div></div></Teleport>
  </div>
</template>

<style scoped>
.loading{display:grid;place-items:center;min-height:56vh}
.category-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:28px 22px}
.category-tile{padding:0;border:0;background:transparent;color:var(--color-text-1);text-align:left;cursor:pointer;font:inherit}
.category-art{aspect-ratio:2/3;border-radius:20px;border:1px solid var(--color-border-3);background:#242626;display:grid;place-items:center;color:#ff8000}
.category-tile strong{display:block;margin-top:10px;font-size:16px;font-weight:500}
.category-list{display:flex;flex-direction:column;gap:0}
.category-list .category-tile{display:flex;align-items:center;gap:22px;padding:16px 0;border-bottom:1px solid var(--color-border-2)}
.category-list .category-art{width:100px;flex-shrink:0}
.empty-state{min-height:56vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--color-text-3)}
.empty-state h2{color:var(--color-text-1);font-size:30px;margin:24px 0 12px}
.empty-state p{max-width:540px;line-height:1.6;font-size:17px}
.category-menu-dismiss{position:fixed;inset:0;z-index:1200}
.category-menu{position:fixed;width:240px;padding:10px;border-radius:20px;background:var(--color-bg-3);border:1px solid var(--color-border-3);box-shadow:0 12px 36px #0005}
.category-menu button{display:flex;align-items:center;gap:14px;width:100%;border:0;border-radius:8px;background:transparent;color:var(--color-text-1);font:inherit;padding:12px;cursor:pointer}
.category-menu button svg{color:#ff8000}
.category-menu button:hover{background:var(--color-fill-2)}
button:focus-visible{outline:2px solid #ff8000;outline-offset:3px}
</style>
