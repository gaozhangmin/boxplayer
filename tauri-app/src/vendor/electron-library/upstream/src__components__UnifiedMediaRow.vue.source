<script setup lang="ts">
import { generalPreferences } from '../utils/seriesVersionPreferences'
import MediaPosterPlaceholder from './MediaPosterPlaceholder.vue'
import PosterRatingBadge from './PosterRatingBadge.vue'
import { Star, RefreshCw, Ban, ChevronRight } from 'lucide-vue-next'
import { computed, nextTick, ref, onMounted, onUnmounted, watch } from 'vue'
import { virtualCardRange } from '../utils/virtualCardRange'
import WatchedIndicator from './WatchedIndicator.vue'
import MediaPosterMenu from './MediaPosterMenu.vue'
import type { UnifiedLibraryCard } from '../types/unifiedMediaLibrary'
import type { UnifiedLibraryRow } from '../types/unifiedMediaLibrary'
import { t } from '../i18n'
import { detailBackdropUrl } from '../utils/mediaArtwork'
import { categoryBannerStyle, categoryNetworkLogo } from '../utils/categoryBannerTheme'

const props = withDefaults(defineProps<{ row: UnifiedLibraryRow; mode?: 'horizontal' | 'grid' | 'list'; showMore?: boolean; selection?: string[]; reordering?: boolean }>(), { mode: 'horizontal', showMore: true, reordering: false })
const cardsElement = ref<HTMLElement>()
const itemCount = computed(() => props.row.cardAt ? props.row.count || 0 : props.row.cards.length)
const virtual = computed(() => props.mode !== 'horizontal' && itemCount.value > 80)
const geometry = ref({ columns: 1, stride: 210, top: 0, height: 800, gap: 0 })
const range = computed(() => virtual.value
  ? virtualCardRange(itemCount.value, geometry.value.columns, geometry.value.stride, geometry.value.top, geometry.value.height)
  : { start: 0, end: itemCount.value, top: 0, bottom: 0 })
const visibleCards = computed(() => Array.from({ length: range.value.end - range.value.start }, (_, offset) => {
  const index = range.value.start + offset
  return { index, card: props.row.cardAt ? props.row.cardAt(index) : props.row.cards[index] }
}))
let frame = 0
let resizeObserver: ResizeObserver | undefined
function measureWindow() {
  frame = 0
  const element = cardsElement.value
  if (!virtual.value || !element || !element.clientWidth) return
  let parent = element.parentElement
  while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement
  const bounds = element.getBoundingClientRect()
  const viewport = parent?.getBoundingClientRect()
  const style = getComputedStyle(element)
  const columns = props.mode === 'grid' ? style.gridTemplateColumns.split(' ').filter(Boolean).length : 1
  const gap = parseFloat(style.rowGap) || 0
  const card = element.querySelector<HTMLElement>('.media-card')
  const next = { columns, stride: (card?.getBoundingClientRect().height || 210) + gap,
    top: Math.max(0, (viewport?.top || 0) - bounds.top), height: parent?.clientHeight || window.innerHeight, gap }
  if (Object.keys(next).some(key => next[key as keyof typeof next] !== geometry.value[key as keyof typeof next])) geometry.value = next
}
function scheduleMeasure() { if (!frame) frame = requestAnimationFrame(measureWindow) }
onMounted(() => {
  resizeObserver = new ResizeObserver(scheduleMeasure)
  if (cardsElement.value) resizeObserver.observe(cardsElement.value)
  window.addEventListener('scroll', scheduleMeasure, true)
  window.addEventListener('resize', scheduleMeasure)
  scheduleMeasure()
})
watch(() => props.row.key, () => {
  if (props.mode === 'horizontal') return
  void nextTick(() => {
    let parent = cardsElement.value?.parentElement
    while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement
    if (parent) parent.scrollTop = 0
    scheduleMeasure()
  })
})
watch(() => [props.row.key, props.mode, itemCount.value, props.row.landscape, props.row.grouped], () => { void nextTick(scheduleMeasure) }, { flush: 'post' })
onUnmounted(() => {
  resizeObserver?.disconnect()
  cancelAnimationFrame(frame)
  window.removeEventListener('scroll', scheduleMeasure, true)
  window.removeEventListener('resize', scheduleMeasure)
})
const emit = defineEmits<{ reorder: [source: string, target: string] }>()
const menuCard = ref<UnifiedLibraryCard>()
const position = ref({ x: 0, y: 0 })
let clickTimer: ReturnType<typeof setTimeout> | undefined
function toggleWatched(card: UnifiedLibraryCard) { clearTimeout(clickTimer); card.posterMenu?.action('watched') }
function clickCard(card: UnifiedLibraryCard) { if (!card.posterMenu) { card.action(); return } clearTimeout(clickTimer); clickTimer = setTimeout(() => { clickTimer = undefined; card.action() }, 300) }
function dragStart(event: DragEvent, card: UnifiedLibraryCard) { event.dataTransfer?.setData('text/plain', card.key); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move' }
function dropCard(event: DragEvent, card: UnifiedLibraryCard) { const source = event.dataTransfer?.getData('text/plain'); if (source && source !== card.key) emit('reorder', source, card.key) }
function openMenu(event: MouseEvent, card: UnifiedLibraryCard) { if (card.contextMenu) { card.contextMenu(event); return }; if (!card.posterMenu) return; event.preventDefault(); clearTimeout(clickTimer); menuCard.value = card; position.value = { x: Math.max(8, Math.min(event.clientX, window.innerWidth - 205)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 350)) } }
function closeMenu() { menuCard.value = undefined }
function keyMenu(event: KeyboardEvent) { if (event.key === 'Escape') closeMenu() }
onMounted(() => { document.addEventListener('click', closeMenu); document.addEventListener('keydown', keyMenu) })
onUnmounted(() => { clearTimeout(clickTimer); document.removeEventListener('click', closeMenu); document.removeEventListener('keydown', keyMenu) })
const failedImages = ref(new Set<string>())
</script>

<template>
  <section class="home-row" :class="[`mode-${mode}`, { 'playlist-reordering': reordering }]">
    <div v-if="showMore" class="row-heading">
      <h2>{{ row.title }}</h2>
      <button v-if="row.retry && (row.error || row.loading)" :disabled="row.loading" :aria-label="t('common.retry')" @click="row.retry"><RefreshCw :size="24" :class="{ 'shelf-refreshing': row.loading }" /></button>
      <button v-else @click="row.more">{{ t('mediaServer.seeAllPlain') }}</button>
    </div>
    <div v-if="row.loading && !itemCount" role="status" class="shelf-status"><a-spin /> {{ t('common.loading') }}</div>
    <div v-else-if="row.error && !itemCount" role="status" class="shelf-status shelf-error"><Ban :size="48" aria-hidden="true" /><strong>{{ t('mediaServer.sectionLoadFailed') }}</strong><span>{{ row.error }}</span></div>
    <div v-else-if="!itemCount" role="status" class="shelf-status">{{ t('libraryBrowse.empty') }}</div>
    <div ref="cardsElement" class="horizontal-row">
      <div v-if="range.top" class="virtual-spacer" aria-hidden="true" :style="{ height: Math.max(0, range.top - geometry.gap) + 'px' }" />
      <div v-for="{ card, index } in visibleCards" :data-card-index="index" :key="card.key" class="media-card" role="button" tabindex="0" :draggable="reordering" :class="{ landscape: row.landscape, grouped: row.grouped }" :style="row.grouped ? categoryBannerStyle(card.title) : undefined" @dragstart="dragStart($event, card)" @dragover="reordering && $event.preventDefault()" @drop.prevent="dropCard($event, card)" @keydown.enter.self.prevent="!reordering && clickCard(card)" @keydown.space.self.prevent="!reordering && clickCard(card)" @click="!reordering && clickCard(card)" @dblclick.stop="openMenu($event, card)" @contextmenu="openMenu($event, card)">
        <div class="artwork">
          <input v-if="selection" type="checkbox" :checked="selection.includes(card.key)" :aria-label="card.title" tabindex="-1" style="position:absolute;top:8px;left:8px;z-index:4" @click.stop="card.action()" />
          <MediaPosterPlaceholder v-if="!row.grouped" :kind="row.key === 'resume' ? 'resume' : row.key === 'music' ? 'music' : row.key === 'books' ? 'book' : 'film'" />
          <img v-if="card.image && !failedImages.has(card.image)" :src="row.grouped ? detailBackdropUrl(card.image) : card.image" :alt="card.title" loading="lazy" @error="failedImages.add(card.image!)" />
          <WatchedIndicator v-if="generalPreferences.watchIndicators && row.key !== 'resume' && card.posterMenu" corner :watched="card.posterMenu.watched" />
          <PosterRatingBadge :rating="card.rating" :is-movie="card.posterMenu ? !card.posterMenu.tv : undefined" />
          <span v-if="row.key === 'resume'" class="resume-play" aria-hidden="true">▶</span>
          <progress v-if="generalPreferences.watchIndicators && (row.key === 'resume' || (card.progress || 0) > 0)" :aria-label="card.title" :value="card.progress || 0" max="100" />
          <div v-if="row.grouped" class="group-copy"><img v-if="categoryNetworkLogo(card.title) && !failedImages.has(categoryNetworkLogo(card.title)!)" class="group-logo" :class="{ 'network-logo-original': card.title.trim().toLowerCase() === 'netflix' }" :src="categoryNetworkLogo(card.title)" :alt="card.title" @error="failedImages.add(categoryNetworkLogo(card.title)!)" /><strong v-else class="group-title">{{ card.title }}</strong><span v-if="card.subtitle" class="group-subtitle">{{ card.subtitle }}</span></div>
          <span v-if="row.grouped" class="group-arrow" aria-hidden="true"><ChevronRight :size="22" /></span>
        </div>
        <div v-if="mode === 'list' && !row.grouped && card.posterMenu" class="list-information">
          <strong :title="card.title">{{ card.title }}</strong>
          <div class="list-metadata">
            <span v-if="card.rating != null" class="list-rating"><Star :size="13" fill="currentColor" />{{ card.rating.toFixed(1) }}</span>
            <span v-if="card.subtitle">{{ card.subtitle }}</span>
            <span v-if="card.certification" class="classification">{{ card.certification }}</span>
          </div>
          <p class="list-overview">{{ card.overview || t('mediaServer.noOverview') }}</p>
          <div @click.stop @dblclick.stop @keydown.stop>
            <WatchedIndicator :watched="card.posterMenu.watched" @toggle="toggleWatched(card)" />
          </div>
        </div>
        <template v-else>
          <strong v-if="!row.grouped && generalPreferences.posterTitles" :title="card.title">{{ card.title }}</strong>
          <small v-if="card.subtitle">{{ card.subtitle }}</small>
        </template>
      </div>
      <div v-if="range.bottom" class="virtual-spacer" aria-hidden="true" :style="{ height: Math.max(0, range.bottom - geometry.gap) + 'px' }" />
    </div>
    <Teleport to="body"><div v-if="menuCard?.posterMenu" class="home-poster-popup" :style="{ left: position.x + 'px', top: position.y + 'px' }" @click.stop><MediaPosterMenu :server="menuCard.posterMenu.server" :tv="menuCard.posterMenu.tv" :home-playlist-item="menuCard.posterMenu.homePlaylistItem" :series-item="menuCard.posterMenu.seriesItem" :continuing="menuCard.posterMenu.continuing" :watched="menuCard.posterMenu.watched" :favorite="menuCard.posterMenu.favorite" :disabled="menuCard.posterMenu.disabled" @action="action => { menuCard?.posterMenu?.action(action); closeMenu() }" /></div></Teleport>
  </section>
</template>

<style scoped>
.virtual-spacer { grid-column: 1 / -1; width: 100%; flex-shrink: 0; pointer-events: none; }
.shelf-refreshing { animation: shelf-spin 1s linear infinite; }
@keyframes shelf-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .shelf-refreshing { animation: none; } }
.home-poster-popup{position:fixed;z-index:1100;border:1px solid var(--color-border-3);border-radius:12px;box-shadow:0 8px 24px #0003;overflow:hidden}
.home-row { margin-bottom: 26px; }
.resume-play { position: absolute; inset: 0; margin: auto; width: 52px; height: 52px; border: 3px solid white; border-radius: 50%; display: grid; place-items: center; padding-left: 3px; box-sizing: border-box; color: white; font-size: 26px; background: #0002; filter: drop-shadow(0 2px 4px #0008); pointer-events: none; }
.row-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 14px; }
.shelf-status { min-height: 165px; display: flex; align-items: center; justify-content: center; gap: 12px; color: var(--color-text-3); }
.shelf-error { align-items: flex-start; flex-direction: column; padding: 28px; border-radius: 20px; background: var(--color-fill-2); overflow-wrap: anywhere; }
h2 { font-size: 19px; font-weight: 600; margin: 0; }
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible { outline: 2px solid #ff8b25; outline-offset: 2px; }
.row-heading button { flex-shrink: 0; border: 0; background: transparent; color: #ff8b25; font-size: 13px; }
.horizontal-row { display: flex; align-items: flex-start; gap: 24px; overflow-x: auto; padding: 3px 0 10px; scrollbar-width: none; }
.horizontal-row::-webkit-scrollbar { display: none; }
.media-card { width: 110px; flex-shrink: 0; text-align: left; border: 0; background: transparent; padding: 0; }
.media-card { cursor: pointer; color: inherit; font: inherit; }
.media-card:focus-visible { outline: 2px solid #ff8b25; outline-offset: 2px; }
.list-information { grid-row: 1 / 3; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.list-information strong { margin: 0; font-size: 15px; max-width: 100%; }
.list-metadata { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--color-text-3); font-size: 12px; }
.list-rating { display: inline-flex; align-items: center; gap: 5px; }
.classification { border: 1px solid currentColor; border-radius: 3px; padding: 0 3px; }
.list-overview { margin: 0; font-size: 13px; line-height: 1.4; color: var(--color-text-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.media-card.landscape { width: 280px; }
.artwork { height: 165px; position: relative; display: grid; place-items: center; border-radius: 16px; overflow: hidden; background: var(--color-fill-2); color: var(--color-text-4); }
.landscape .artwork { height: 158px; }
.artwork img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.artwork progress { position: absolute; z-index: 3; left: 0; bottom: 0; width: 100%; height: 5px; margin: 0; border: 0; appearance: none; -webkit-appearance: none; background: #ffffff50; pointer-events: none; }
.artwork progress::-webkit-progress-bar { background: #ffffff50; }
.artwork progress::-webkit-progress-value { background: #ff8b25; }
.artwork progress::-moz-progress-bar { background: #ff8b25; }
.media-card strong, .media-card small { display: block; margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 16px; }
.media-card small { margin-top: 2px; color: var(--color-text-3); font-size: 11px; }
.mode-grid .horizontal-row { display: grid; grid-template-columns: repeat(auto-fill, 110px); gap: 24px; overflow: visible; }
.mode-grid .media-card { width: 100%; }
.mode-grid .artwork { height: auto; aspect-ratio: 2 / 3; }
.mode-grid .landscape .artwork { aspect-ratio: 16 / 9; }
.mode-list .horizontal-row { flex-direction: column; gap: 0; overflow: visible; }
.mode-list .media-card { width: 100%; display: grid; grid-template-columns: 160px minmax(0, 1fr); grid-template-rows: auto auto; align-items: center; gap: 8px 18px; padding: 16px 0; border-bottom: 1px solid var(--color-border-2); }
.mode-list .artwork { grid-row: 1 / 3; width: 110px; height: 165px; }
.mode-list .landscape .artwork { width: 160px; height: 90px; }
.mode-list strong { align-self: end; }
.mode-list .list-information strong { align-self: auto; }
.mode-list small { align-self: start; }
.mode-grid:has(.landscape) .horizontal-row { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.mode-list .media-card:not(.landscape) { grid-template-columns: 110px minmax(0, 1fr); }
.playlist-reordering .media-card { cursor: grab; animation: playlist-card-jiggle .18s ease-in-out infinite alternate; }
.playlist-reordering .media-card:nth-child(even) { animation-direction: alternate-reverse; }
.playlist-reordering .media-card:active { cursor: grabbing; }
@keyframes playlist-card-jiggle { from { transform: rotate(-1.5deg); } to { transform: rotate(1.5deg); } }
@media (prefers-reduced-motion: reduce) { .playlist-reordering .media-card { animation: none; } }
.grouped .artwork { background: linear-gradient(110deg, var(--banner-start), var(--banner-end)); border: 1px solid #ffffff35; border-radius: 18px; }
.grouped .artwork img { object-position: 75% center; mask-image: linear-gradient(90deg, transparent, #000 60%); }
.grouped .artwork::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, var(--banner-start) 0%, transparent 78%); pointer-events: none; }
.grouped .group-copy { position: absolute; z-index: 2; left: 28px; right: 84px; top: 50%; transform: translateY(-50%); color: white; }
.media-card .group-title { margin: 0; font-size: clamp(24px, 3vw, 38px); font-weight: 750; line-height: 1.2; text-align: left; white-space: normal; text-wrap: balance; text-shadow: 0 2px 8px #0005; }
.group-subtitle { display: block; margin-top: 10px; font-size: 14px; line-height: 1.4; color: #ffffffd9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-arrow { position: absolute; z-index: 2; right: 24px; top: 50%; transform: translateY(-50%); display: grid; place-items: center; width: 38px; height: 38px; color: white; background: #ffffff26; border: 1px solid #ffffff35; border-radius: 50%; }
.media-card.grouped:focus-visible { outline: 3px solid var(--color-primary-light-4, #88baff); outline-offset: 4px; border-radius: 18px; }
.grouped:hover .group-arrow { background: #ffffff40; }
.mode-list .media-card.grouped { display: block; padding: 0; border: 0; }
.mode-list .grouped .artwork { width: 100%; height: clamp(132px, 17vw, 164px); aspect-ratio: auto; }
.mode-list:has(.grouped) .horizontal-row { gap: 14px; }
@media (max-width: 700px) {
  .mode-list .grouped .artwork { height: 145px; }
  .media-card .group-title { font-size: 20px; }
}
@media (max-width: 600px) {
  .grouped .group-copy { left: 18px; right: 64px; }
  .grouped .group-arrow { right: 16px; width: 32px; height: 32px; }
  .group-subtitle { font-size: 12px; }
}
</style>

<style scoped>
.media-card .group-copy .group-logo { position: static; width: min(230px, 48vw); max-width: 100%; height: 64px; object-fit: contain; object-position: left center; filter: brightness(0) invert(1); mask-image: none; }
</style>

<style scoped>
.network-logo-original { filter: none !important; }
</style>

<style scoped>
@media (max-width: 600px) {
  .media-card .group-copy .group-logo { width: 120px; height: 40px; }
}
</style>
