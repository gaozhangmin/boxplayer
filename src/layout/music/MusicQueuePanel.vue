<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Shuffle, Repeat, Repeat1, Infinity, Blend, Clock, Heart, ListMusic, Music, SkipForward, Trash2, X } from 'lucide-vue-next'
import type { IPageMusicTrack } from '../../store/appstore'
import { musicTrackKey } from '../../utils/musicPlayerStorage'
import { t as tt } from '../../i18n'

type PanelTab = 'queue' | 'fav' | 'recent'

const props = defineProps<{
  automaticContinuation?: boolean
  crossfade?: boolean
  crossfadeAvailable?: boolean
  shuffled?: boolean
  repeatOne?: boolean
  visible: boolean
  panelTab: PanelTab
  playlist: IPageMusicTrack[]
  favs: IPageMusicTrack[]
  recents: IPageMusicTrack[]
  currentKey: string
  favKeys: string[]
  filter: string
}>()

const emit = defineEmits<{
  (e: 'automatic-continuation'): void
  (e: 'crossfade'): void
  (e: 'shuffle'): void
  (e: 'repeat'): void
  (e: 'close'): void
  (e: 'update:panelTab', tab: PanelTab): void
  (e: 'update:filter', value: string): void
  (e: 'play', track: IPageMusicTrack): void
  (e: 'toggle-fav', track: IPageMusicTrack): void
  (e: 'remove-fav', track: IPageMusicTrack): void
  (e: 'next-play', index: number): void
  (e: 'remove-queue', index: number): void
  (e: 'clear-recents'): void
}>()

const renderLimit = ref(80)
const favSet = computed(() => new Set(props.favKeys))
const source = computed(() => props.panelTab === 'fav' ? props.favs : props.panelTab === 'recent' ? props.recents : props.playlist)
const filteredRows = computed(() => {
  const q = props.filter.trim().toLowerCase()
  const rows = source.value.map((track, sourceIndex) => ({ track, sourceIndex }))
  const list = q ? rows.filter(({ track }) => (track.file_name || '').toLowerCase().includes(q)) : rows
  return list.slice(0, renderLimit.value)
})
const totalFiltered = computed(() => {
  const q = props.filter.trim().toLowerCase()
  return q ? source.value.filter((t) => (t.file_name || '').toLowerCase().includes(q)).length : source.value.length
})

watch(() => [props.panelTab, props.filter, props.visible], () => {
  renderLimit.value = 80
})

function stripExt(name: string) {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}
</script>

<template>
  <aside :class="['music-queue-panel', 'playlist-panel', visible ? 'show' : '']" :aria-hidden="!visible" :inert="!visible">
    <div class="music-queue-head">
      <div class="music-queue-tabs">
        <button :class="['panel-tab', { on: panelTab === 'queue' }]" @click="emit('update:panelTab', 'queue')"><ListMusic :size="14" /> {{ tt('music.upNext') }} {{ playlist.length }}</button>
        <button :class="['panel-tab', { on: panelTab === 'fav' }]" @click="emit('update:panelTab', 'fav')"><Heart :size="14" /> {{ tt('music.favorites') }} {{ favs.length }}</button>
        <button :class="['panel-tab', { on: panelTab === 'recent' }]" @click="emit('update:panelTab', 'recent')"><Clock :size="14" /> {{ tt('music.recent') }} {{ recents.length }}</button>
      </div>
      <button class="music-queue-close" @click="emit('close')"><X :size="16" /></button>
    </div>
    <div class="music-queue-controls">
      <button :aria-label="tt('music.modeShuffle')" :aria-pressed="!!shuffled" :class="{ active: shuffled }" @click="emit('shuffle')"><Shuffle :size="20" /></button>
      <button :aria-label="tt(repeatOne ? 'music.modeLoopOne' : 'music.modeLoopList')" :aria-pressed="!!repeatOne" @click="emit('repeat')"><Repeat1 v-if="repeatOne" :size="20" /><Repeat v-else :size="20" /></button>
      <button :aria-label="tt('music.automaticContinuation')" :aria-pressed="!!automaticContinuation" :class="{ active: automaticContinuation }" @click="emit('automatic-continuation')"><Infinity :size="20" /></button>
      <button :title="tt(crossfadeAvailable ? 'music.crossfadeThreeSeconds' : 'music.crossfadeRequiresUpdatedCore')" :aria-label="tt('music.crossfadeThreeSeconds')" :aria-pressed="!!crossfade" :class="{ active: crossfade }" :disabled="!crossfadeAvailable" @click="emit('crossfade')"><Blend :size="20" /></button>
    </div>
    <div class="music-queue-search">
      <input :value="filter" :placeholder="tt('music.searchQueue')" @input="emit('update:filter', ($event.target as HTMLInputElement).value)" />
      <button v-if="filter" @click="emit('update:filter', '')"><X :size="13" /></button>
    </div>
    <div class="music-queue-list queue-list">
      <div
        v-for="(row, i) in filteredRows"
        :key="`${musicTrackKey(row.track)}-${row.sourceIndex}`"
        :class="['music-queue-row', 'queue-item', currentKey === musicTrackKey(row.track) ? 'cur' : '']"
        role="button"
        tabindex="0"
        @click="emit('play', row.track)"
        @keydown.enter.prevent="emit('play', row.track)"
      >
        <span class="music-queue-num">{{ panelTab === 'fav' ? '♥' : panelTab === 'recent' ? '•' : i + 1 }}</span>
        <img v-if="row.track.thumbnail" :src="row.track.thumbnail" class="music-queue-cover" @error="(e:any) => { e.currentTarget.style.display = 'none' }" />
        <span v-else class="music-queue-cover empty"><Music :size="15" :stroke-width="1.5" /></span>
        <span class="music-queue-meta">
          <span class="music-queue-title">{{ stripExt(row.track.file_name || '') }}</span>
          <span class="music-queue-sub">{{ row.track.ext ? String(row.track.ext).replace(/^\./, '').toUpperCase() : tt('music.cloudMusic') }}</span>
        </span>
        <button v-if="panelTab === 'queue'" class="music-queue-action qi-act" :title="tt('music.playNext')" @click.stop="emit('next-play', row.sourceIndex)"><SkipForward :size="13" /></button>
        <button v-if="panelTab === 'queue'" class="music-queue-action qi-act" :title="tt('music.removeFromQueue')" @click.stop="emit('remove-queue', row.sourceIndex)"><Trash2 :size="13" /></button>
        <button v-else-if="panelTab === 'fav'" class="music-queue-action qi-act liked" :title="tt('music.removeFavorite')" @click.stop="emit('remove-fav', row.track)"><X :size="13" /></button>
        <button v-else :class="['music-queue-action', 'qi-act', favSet.has(musicTrackKey(row.track)) ? 'liked' : '']" :title="tt('music.favorites')" @click.stop="emit('toggle-fav', row.track)">
          <Heart :size="14" :fill="favSet.has(musicTrackKey(row.track)) ? 'currentColor' : 'none'" />
        </button>
      </div>
      <div v-if="!totalFiltered" class="music-queue-empty">{{ tt('music.noContent') }}</div>
      <button v-if="totalFiltered > filteredRows.length" class="music-queue-more" @click="renderLimit += 80">{{ tt('music.showMore') }}</button>
      <button v-if="panelTab === 'recent' && recents.length" class="music-queue-clear" @click="emit('clear-recents')">{{ tt('music.clearRecentPlays') }}</button>
    </div>
  </aside>
</template>

<style scoped lang="less">
.music-queue-panel {
  position: absolute;
  z-index: 17;
  top: 78px;
  right: 24px;
  left: auto;
  bottom: var(--music-queue-bottom, 144px);
  width: 340px;
  max-width: calc(100% - 48px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 24px;
  border: 1px solid rgba(255,255,255,.11);
  background: rgba(12,14,18,.72);
  color: #fff;
  box-shadow: 0 28px 80px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.08);
  backdrop-filter: blur(34px) saturate(1.18);
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transform: translateX(calc(100% + 24px));
  transition: opacity .22s ease, transform .28s cubic-bezier(.2,.8,.2,1);
}
.music-queue-panel.show {
  right: 24px;
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
}
.music-queue-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 14px 8px;
}
.music-queue-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  flex: 1;
}
.music-queue-tabs button,
.music-queue-close,
.music-queue-action,
.music-queue-more,
.music-queue-clear {
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.music-queue-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.055);
  background: rgba(255,255,255,.045);
  color: rgba(255,255,255,.58);
  font-size: 12px;
}
.music-queue-tabs button.on {
  color: #fff;
  background: rgba(0,245,212,.12);
}
.music-queue-close {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: rgba(255,255,255,.045);
}
.music-queue-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 14px 10px;
  padding: 0 10px;
  height: 34px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.065);
  background: rgba(255,255,255,.055);
}
.music-queue-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: #fff;
  font: inherit;
  font-size: 12px;
}
.music-queue-search button {
  border: 0;
  background: transparent;
  color: rgba(255,255,255,.48);
}
.music-queue-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 8px 12px;
  overscroll-behavior: contain;
}
.music-queue-list::-webkit-scrollbar {
  width: 3px;
}
.music-queue-list::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: rgba(255,255,255,.20);
}
.music-queue-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 5px 0;
  padding: 8px;
  border: 1px solid rgba(255,255,255,.055);
  border-radius: 11px;
  background: rgba(255,255,255,.035);
  color: rgba(255,255,255,.82);
  text-align: left;
  cursor: pointer;
  transition: background .18s, border-color .18s, transform .18s;
}
.music-queue-row:hover,
.music-queue-row.cur {
  background: rgba(0,245,212,.075);
  border-color: rgba(0,245,212,.36);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 10px 28px rgba(0,245,212,.06);
}
.music-queue-num {
  width: 22px;
  text-align: center;
  color: rgba(255,255,255,.36);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.music-queue-cover {
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border-radius: 8px;
  object-fit: cover;
  background: rgba(255,255,255,.07);
}
.music-queue-cover.empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,.34);
}
.music-queue-meta {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.music-queue-title,
.music-queue-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.music-queue-title {
  font-size: 12.5px;
  font-weight: 700;
}
.music-queue-sub {
  color: rgba(255,255,255,.40);
  font-size: 10.5px;
}
.music-queue-action {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: transparent;
  color: rgba(255,255,255,.35);
}
.music-queue-action + .music-queue-action {
  margin-left: -4px;
}
.music-queue-action:hover,
.music-queue-action.liked {
  color: #8ff5ea;
  background: rgba(255,255,255,.055);
}
.music-queue-empty {
  padding: 42px 12px;
  text-align: center;
  color: rgba(255,255,255,.32);
  font-size: 12px;
}
.music-queue-more,
.music-queue-clear {
  display: block;
  width: calc(100% - 12px);
  margin: 8px 6px 0;
  height: 32px;
  border-radius: 10px;
  background: rgba(255,255,255,.05);
  color: rgba(255,255,255,.62);
}
</style>

<style scoped>
.music-queue-controls { display:flex;gap:10px;padding:12px 16px; }
.music-queue-controls button { flex:1;display:flex;justify-content:center;border:0;border-radius:22px;padding:10px;color:inherit;background:#ffffff18;cursor:pointer; }
.music-queue-controls button:disabled { opacity:.4;cursor:not-allowed; }
.music-queue-controls button.active { background:#ffffff60;color:#202020; }
</style>
