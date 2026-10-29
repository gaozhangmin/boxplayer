<script setup lang="ts">
import { computed, ref } from 'vue'
import { FileText, Heart, List, LoaderCircle, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Volume2, VolumeX } from 'lucide-vue-next'
import SoundEffectBtn from '../../components/SoundEffectBtn.vue'
import { t as tt } from '../../i18n'

type PlayMode = 'list' | 'loop-list' | 'loop-one' | 'shuffle'

const props = defineProps<{
  title: string
  artist: string
  album: string
  coverUrl: string
  ext: string
  index: number
  total: number
  playing: boolean
  loading: boolean
  metaLoad: boolean
  errMsg: string
  showLyrics: boolean
  showPanel: boolean
  showFxPanel: boolean
  isFav: boolean
  muted: boolean
  vol: number
  progressPercent: number
  displayTime: string
  durationText: string
  mode: PlayMode
  modeLabel: string
  modeOn: boolean
  lyricDebugText: string
  lyricDebugTitle: string
}>()

const emit = defineEmits<{
  (e: 'toggle-play'): void
  (e: 'prev'): void
  (e: 'next'): void
  (e: 'cycle-mode'): void
  (e: 'toggle-fav'): void
  (e: 'toggle-mute'): void
  (e: 'toggle-lyrics'): void
  (e: 'toggle-panel'): void
  (e: 'toggle-fx'): void
  (e: 'progress-down', event: MouseEvent): void
  (e: 'volume-down', event: MouseEvent): void
}>()

const qualityOpen = ref(false)
const statusText = computed(() => {
  if (props.errMsg) return props.errMsg
  if (props.metaLoad) return tt('music.fetchingLyrics')
  return ''
})

const sourceLabel = computed(() => props.ext || tt('music.cloudMusic'))
const qualityOptions = [
  { key: 'jymaster', label: tt('music.qualityMaster'), meta: tt('music.externalSourceDisabled'), locked: true },
  { key: 'hires', label: tt('music.qualityHiRes'), meta: tt('music.externalSourceDisabled'), locked: true },
  { key: 'lossless', label: tt('music.qualityLossless'), meta: tt('music.cloudOriginal'), locked: false },
  { key: 'exhigh', label: tt('music.qualityHigh'), meta: tt('music.externalSourceDisabled'), locked: true },
  { key: 'standard', label: tt('music.qualityStandard'), meta: tt('music.externalSourceDisabled'), locked: true }
]
</script>

<template>
  <button class="bottom-handle mineradio-bottom-handle" type="button" :aria-label="tt('music.playerConsole')"><span></span></button>
  <div class="bottom-bar mineradio-bottom-bar visible">
    <div class="progress-bar" @mousedown="emit('progress-down', $event)">
      <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
      <div class="progress-thumb" :style="{ left: progressPercent + '%' }" aria-hidden="true"></div>
    </div>

    <div class="controls">
      <div class="control-cluster actions">
        <div class="control-track">
          <div :class="['control-cover', !coverUrl ? 'cover-empty' : '']" :style="coverUrl ? { backgroundImage: `url(${coverUrl})` } : {}"></div>
          <div class="control-meta">
            <div class="control-title" :title="title || tt('music.notPlaying')">{{ title || tt('music.notPlaying') }}</div>
            <div v-if="statusText" :class="['track-status', { error: !!errMsg }]" :title="statusText" :role="errMsg ? 'alert' : 'status'">{{ statusText }}</div>
            <div v-else class="control-artist" :title="artist || album || tt('music.unknownArtist')">
              {{ artist || (album || tt('music.unknownArtist')) }}<span v-if="artist && album"> · {{ album }}</span>
            </div>
          </div>
        </div>
        <div :class="['quality-control', 'source-control', qualityOpen ? 'open' : '']">
          <button id="quality-btn" class="ctrl-btn quality-pill" :title="tt('music.qualityCloudOriginalTitle')" @click="qualityOpen = !qualityOpen">
            <span id="quality-btn-label">{{ sourceLabel }}</span>
          </button>
          <div class="quality-popover">
            <button v-for="option in qualityOptions" :key="option.key" :class="['quality-option', option.key === 'lossless' ? 'active' : '', option.locked ? 'locked' : '']" type="button">
              <span>{{ option.label }}</span>
              <small>{{ option.meta }}</small>
            </button>
          </div>
        </div>
        <button :class="['ctrl-btn', 'heart-btn', isFav ? 'liked' : '']" :disabled="!total" :title="tt('music.like')" @click="emit('toggle-fav')">
          <Heart class="heart-svg" :size="21" :stroke-width="1.8" :fill="isFav ? 'currentColor' : 'none'" />
        </button>
        <button class="ctrl-btn lyrics-toggle-btn" :class="{ active: showLyrics }" :title="tt('music.lyrics')" @click="emit('toggle-lyrics')">
          <FileText :size="21" :stroke-width="1.8" />
        </button>
      </div>

      <div class="control-cluster transport">
        <button id="play-mode-btn" :class="['ctrl-btn', modeOn ? 'active' : '']" :data-mode="mode" :title="modeLabel" @click="emit('cycle-mode')">
          <Shuffle v-if="mode === 'shuffle'" id="play-mode-icon" :size="21" :stroke-width="1.9" />
          <Repeat1 v-else-if="mode === 'loop-one'" id="play-mode-icon" :size="21" :stroke-width="1.9" />
          <Repeat v-else-if="mode === 'loop-list'" id="play-mode-icon" :size="21" :stroke-width="1.9" />
          <List v-else id="play-mode-icon" :size="21" :stroke-width="1.9" />
        </button>
        <button class="ctrl-btn" :title="tt('music.previousTrack')" @click="emit('prev')">
          <SkipBack :size="22" :stroke-width="1.8" />
        </button>
        <button id="play-btn" class="ctrl-btn" :title="tt('music.playPause')" @click="emit('toggle-play')">
          <Pause v-if="playing" :size="24" fill="currentColor" :stroke-width="0" />
          <Play v-else :size="24" fill="currentColor" :stroke-width="0" style="margin-left:3px" />
        </button>
        <button class="ctrl-btn" :title="tt('music.nextTrack')" @click="emit('next')">
          <SkipForward :size="22" :stroke-width="1.8" />
        </button>
        <div id="time-display" :class="{ 'is-loading': loading && !errMsg }" :aria-live="loading && !errMsg ? 'polite' : 'off'">
          <template v-if="loading && !errMsg">
            <LoaderCircle class="playback-loading-spinner" :size="13" aria-hidden="true" />
            <span>{{ tt('common.loading') }}</span>
          </template>
          <template v-else>{{ displayTime }} / {{ durationText }}</template>
        </div>
      </div>

      <div class="control-cluster modes">
        <SoundEffectBtn class="sound-effect-btn" />
        <button id="visual-console-btn" :class="['ctrl-btn', showFxPanel ? 'active' : '']" :title="tt('music.visualConsole')" @click="emit('toggle-fx')">
          <SlidersHorizontal :size="21" :stroke-width="1.85" />
        </button>
        <button id="mini-queue-btn" :class="['ctrl-btn', showPanel ? 'active' : '']" :title="tt('music.playlist')" @click="emit('toggle-panel')">
          <List :size="21" :stroke-width="1.8" />
        </button>
        <div :class="['volume-control', muted || vol === 0 ? 'muted' : '']">
          <button class="ctrl-btn" :title="tt('music.volume')" @click="emit('toggle-mute')">
            <VolumeX v-if="muted || vol === 0" :size="21" :stroke-width="1.8" />
            <Volume2 v-else :size="21" :stroke-width="1.8" />
          </button>
          <div class="volume-popover">
            <div class="volume-slider-wrap" @mousedown="emit('volume-down', $event)">
              <div class="volume-slider-fill" :style="{ width: (muted ? 0 : vol * 100) + '%' }"></div>
            </div>
            <span id="volume-value">{{ Math.round((muted ? 0 : vol) * 100) }}%</span>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped lang="less">
.bottom-handle {
  position: absolute;
  z-index: 8;
  left: 50%;
  bottom: 13px;
  width: 236px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  box-shadow: none;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%) translateY(10px) scale(.78);
}
.bottom-handle span {
  display: block;
  width: 168px;
  height: 4px;
  border-radius: 999px;
  background: rgba(255,255,255,.72);
  box-shadow: 0 0 16px rgba(255,255,255,.15), inset 0 1px 0 rgba(255,255,255,.70);
}
.bottom-bar {
  position: absolute;
  z-index: 8;
  bottom: 16px;
  left: 50%;
  box-sizing: border-box;
  width: min(1120px, calc(100vw - clamp(20px, 5vw, 72px)));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: clamp(8px, 1.2vw, 11px) clamp(12px, 2.2vw, 24px) clamp(10px, 1.35vw, 14px);
  border: 0;
  border-radius: 50px;
  color: rgba(255,255,255,.92);
  background: rgba(0,0,0,.10);
  box-shadow: inset 0 0 2px 1px rgba(255,255,255,.35), inset 0 0 10px 4px rgba(255,255,255,.15), 0 4px 16px rgba(17,17,26,.05), 0 8px 24px rgba(17,17,26,.05), 0 16px 56px rgba(17,17,26,.05), inset 0 4px 16px rgba(17,17,26,.05), inset 0 8px 24px rgba(17,17,26,.05), inset 0 16px 56px rgba(17,17,26,.05);
  backdrop-filter: blur(12px) saturate(1.8) brightness(1.16);
  transform: translateX(-50%) translateY(0) scale(1);
  opacity: .91;
  pointer-events: auto;
  transition: opacity .34s cubic-bezier(.16,1,.3,1), bottom .34s cubic-bezier(.16,1,.3,1), width .34s, transform .46s cubic-bezier(.16,1,.3,1), filter .38s cubic-bezier(.16,1,.3,1);
}
.progress-bar {
  position: relative;
  z-index: 1;
  align-self: center;
  width: calc(100% - clamp(86px,10vw,156px));
  height: 4px;
  margin: 4px auto 1px;
  overflow: visible;
  border-radius: 999px;
  background: rgba(255,255,255,.095);
  box-shadow: inset 0 1px 1px rgba(255,255,255,.12), inset 0 -1px 1px rgba(0,0,0,.20);
  cursor: pointer;
  transition: height .2s, background .2s, box-shadow .2s, width .2s;
}
.progress-bar:hover {
  height: 5px;
  background: rgba(255,255,255,.14);
  box-shadow: 0 0 18px rgba(0,245,212,.10), inset 0 1px 1px rgba(255,255,255,.18);
}
.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(255,255,255,.92), rgba(0,245,212,.74));
  box-shadow: 0 0 16px rgba(0,245,212,.18);
  transition: width .12s linear;
}
.progress-thumb {
  position: absolute;
  top: 50%;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: radial-gradient(circle at 34% 28%, #fff 0, #fff 28%, rgba(194,235,255,.86) 74%);
  box-shadow: 0 0 0 1px rgba(255,255,255,.34), 0 0 18px rgba(178,229,255,.28);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -50%) scale(.72);
  transition: opacity .16s, transform .16s;
}
.progress-bar:hover .progress-thumb {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}
.progress-thumb::before,
.progress-thumb::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(255,255,255,.9);
  box-shadow: 0 0 10px rgba(255,68,88,.42);
  opacity: 0;
  transform: translate(-50%, -50%);
}
.progress-bar:hover .progress-thumb::before {
  animation: thumb-particle-a .62s ease-out infinite;
}
.progress-bar:hover .progress-thumb::after {
  animation: thumb-particle-b .72s ease-out infinite;
}
.controls {
  position: relative;
  z-index: 1;
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content minmax(0, 1fr);
  align-items: center;
  gap: clamp(8px, 1.7vw, 18px);
}
.control-cluster {
  display: flex;
  align-items: center;
  gap: 13px;
  min-width: 0;
  height: 62px;
}
.control-cluster.actions {
  grid-column: 1;
  justify-content: flex-start;
  overflow: visible;
}
.control-cluster.transport {
  grid-column: 2;
  justify-self: center;
  justify-content: center;
  width: max-content;
  gap: clamp(8px, 1.1vw, 13px);
}
.control-cluster.modes {
  grid-column: 3;
  justify-content: flex-end;
  overflow: visible;
}
.control-track {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
}
.control-cover {
  width: 52px;
  height: 52px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 12px;
  background-color: rgba(255,255,255,.070);
  background-position: center;
  background-size: cover;
  box-shadow: 0 10px 28px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.20), inset 0 0 0 1px rgba(255,255,255,.08);
}
.control-cover.cover-empty {
  background-image: radial-gradient(circle at 35% 28%, rgba(255,255,255,.18), transparent 24%), linear-gradient(135deg, rgba(255,255,255,.10), rgba(255,255,255,.025));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.055), 0 8px 22px rgba(0,0,0,.22);
}
.control-meta {
  min-width: 0;
  max-width: min(320px, 100%);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.control-title,
.control-artist {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color .2s, text-shadow .2s;
}
.control-title {
  color: rgba(255,255,255,.92);
  font-size: 13.5px;
  font-weight: 700;
  line-height: 1.2;
}
.control-artist {
  color: rgba(255,255,255,.48);
  font-size: 11.5px;
  line-height: 1.15;
}
.control-title:hover,
.control-artist:hover {
  color: #fff;
  text-shadow: 0 0 16px rgba(0,245,212,.20);
}
.ctrl-btn {
  position: relative;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 11px;
  color: rgba(255,255,255,.70);
  background: transparent;
  cursor: pointer;
  transition: color .18s, transform .18s, text-shadow .18s, background .18s, box-shadow .18s;
}
.ctrl-btn:hover {
  color: #fff;
  background: rgba(255,255,255,.045);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.045);
  text-shadow: 0 0 10px rgba(0,245,212,.12);
  transform: translateY(-1px);
}
.ctrl-btn:active {
  transform: translateY(0) scale(.96);
}
.ctrl-btn.active {
  color: rgba(210,244,241,.90);
  text-shadow: 0 0 12px rgba(0,245,212,.16);
}
.ctrl-btn.liked {
  color: #ff7a90;
  text-shadow: 0 0 18px rgba(255,122,144,.36);
}
.ctrl-btn:disabled {
  opacity: .38;
  pointer-events: none;
}
.sound-effect-btn {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
}
.sound-effect-btn :deep(.se-trigger) {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 11px;
  color: rgba(255,255,255,.70);
  background: transparent;
  transition: color .18s, transform .18s, text-shadow .18s, background .18s, box-shadow .18s;
}
.sound-effect-btn :deep(.se-trigger:hover) {
  color: #fff;
  background: rgba(255,255,255,.045);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.045);
  text-shadow: 0 0 10px rgba(0,245,212,.12);
  transform: translateY(-1px);
}
.heart-svg {
  width: 21px;
  height: 21px;
  display: block;
  filter: drop-shadow(0 0 0 rgba(255,122,144,0));
}
.liked .heart-svg {
  filter: drop-shadow(0 0 10px rgba(255,122,144,.34));
}
#play-mode-btn[data-mode="shuffle"],
#play-mode-btn[data-mode="loop-one"] {
  color: rgba(210,244,241,.90);
  text-shadow: 0 0 12px rgba(0,245,212,.15);
}
#play-btn {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  color: rgba(255,255,255,.96);
  background: rgba(0,0,0,.10);
  box-shadow: inset 0 0 2px 1px rgba(255,255,255,.34), inset 0 0 10px 4px rgba(255,255,255,.13), 0 10px 30px rgba(0,0,0,.18);
  backdrop-filter: blur(12px) saturate(1.8) brightness(1.16);
}
#play-btn:hover {
  background: rgba(255,255,255,.055);
  box-shadow: inset 0 0 2px 1px rgba(255,255,255,.42), inset 0 0 12px 5px rgba(255,255,255,.17), 0 12px 34px rgba(0,0,0,.22), 0 0 18px rgba(0,245,212,.10);
  transform: translateY(-1px) scale(1.012);
}
#time-display {
  flex: 0 0 auto;
  min-width: 86px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 2px;
  color: rgba(255,255,255,.50);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  letter-spacing: .35px;
  text-align: center;
}
#time-display.is-loading {
  gap: 6px;
  letter-spacing: 0;
}
.playback-loading-spinner {
  flex-shrink: 0;
  animation: playback-loading-spin 1s linear infinite;
}
@keyframes playback-loading-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .playback-loading-spinner { animation: none; }
}
.quality-control,
.volume-control {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
#quality-btn.quality-pill {
  width: auto;
  min-width: 56px;
  padding: 0 11px;
  border-radius: 13px;
  color: rgba(237,245,255,.82);
  background: rgba(255,255,255,.038);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .2px;
}
#quality-btn-label {
  display: block;
  min-width: 30px;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quality-popover {
  position: absolute;
  z-index: 8;
  left: 50%;
  bottom: 46px;
  width: 228px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
  padding: 8px;
  border: 1px solid rgba(157,184,207,.24);
  border-radius: 14px;
  background: var(--app-overlay-bg);
  box-shadow: 0 18px 48px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.08);
  backdrop-filter: none;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%) translateY(8px);
  transition: opacity .2s, transform .2s;
}
.quality-control.open .quality-popover,
.quality-control:hover .quality-popover,
.quality-control:focus-within .quality-popover {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0);
}
.quality-option {
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 9px;
  color: rgba(255,255,255,.70);
  background: rgba(255,255,255,.045);
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .1px;
  text-align: left;
  cursor: pointer;
  transition: background .2s, border-color .2s, color .2s, transform .2s;
}
.quality-option span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quality-option small {
  color: rgba(255,255,255,.42);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0;
  white-space: nowrap;
}
.quality-option:hover {
  color: #fff;
  background: rgba(255,255,255,.09);
  transform: translateY(-1px);
}
.quality-option.active {
  color: #eaf2ff;
  border-color: rgba(157,184,207,.46);
  background: rgba(157,184,207,.16);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
}
.quality-option.locked {
  opacity: .42;
  cursor: not-allowed;
  transform: none !important;
}
.volume-control.muted .ctrl-btn {
  color: rgba(255,255,255,.38);
}
.quality-control::before,
.volume-control::before {
  content: '';
  position: absolute;
  left: -34px;
  right: -34px;
  bottom: 18px;
  z-index: 0;
  height: 70px;
  display: none;
}
.quality-control.open::before,
.quality-control:hover::before,
.quality-control:focus-within::before,
.volume-control:hover::before,
.volume-control:focus-within::before {
  display: block;
}
.volume-popover {
  position: absolute;
  z-index: 8;
  left: 50%;
  bottom: 46px;
  width: 154px;
  height: 42px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 12px;
  border: 1px solid rgba(255,255,255,.09);
  border-radius: 14px;
  background: var(--app-overlay-bg);
  box-shadow: 0 18px 48px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.07);
  backdrop-filter: none;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%) translateY(8px);
  transition: opacity .2s, transform .2s;
}
.volume-control:hover .volume-popover,
.volume-control:focus-within .volume-popover {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0);
}
.volume-slider-wrap {
  position: relative;
  flex: 1;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255,255,255,.12);
  cursor: pointer;
}
.volume-slider-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(255,255,255,.92), rgba(0,245,212,.74));
}
#volume-value {
  width: 34px;
  color: rgba(255,255,255,.52);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.track-status {
  overflow: hidden;
  color: rgba(255,255,255,.52);
  font-size: 11px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track-status.error {
  color: #ff9aa8;
}
@keyframes thumb-particle-a {
  0% { opacity: .8; transform: translate(-50%,-50%) scale(1); }
  100% { opacity: 0; transform: translate(-18px,-17px) scale(.2); }
}
@keyframes thumb-particle-b {
  0% { opacity: .7; transform: translate(-50%,-50%) scale(1); }
  100% { opacity: 0; transform: translate(16px,13px) scale(.22); }
}
@media (max-width: 1180px) {
  .bottom-bar {
    width: calc(100vw - clamp(28px, 8vw, 142px));
  }
  .controls {
    grid-template-columns: minmax(0, 1fr) max-content minmax(0, 1fr);
  }
  .control-cluster {
    gap: 8px;
  }
  .control-cover {
    width: 44px;
    height: 44px;
  }
  .control-meta {
    max-width: min(220px, 100%);
  }
  .ctrl-btn {
    width: 34px;
    height: 34px;
  }
  #play-btn {
    width: 54px;
    height: 54px;
  }
}
@media (max-width: 920px) {
  .bottom-bar {
    width: calc(100vw - 28px);
  }
  .controls {
    grid-template-columns: minmax(0, 1fr) max-content minmax(0, 1fr);
  }
  .control-cluster {
    height: 56px;
  }
  .control-title {
    font-size: 12.5px;
  }
  .control-meta {
    max-width: min(170px, 100%);
  }
  .control-artist {
    font-size: 11px;
  }
  #time-display,
  .source-control {
    display: none;
  }
}
@media (max-width: 620px) {
  .bottom-bar {
    width: calc(100vw - 20px);
    border-radius: 28px;
  }
  .controls {
    grid-template-columns: 1fr;
  }
  .control-cluster {
    grid-column: 1 !important;
    justify-content: center;
  }
  .control-cluster.transport {
    order: 1;
  }
  .control-cluster.actions {
    order: 2;
  }
  .control-cluster.modes {
    order: 3;
  }
  .control-track {
    display: none;
  }
}
@media (max-height: 520px) {
  .bottom-bar {
    bottom: 8px;
    width: min(780px, calc(100vw - 42px));
    gap: 5px;
    padding: 6px 14px 8px;
    border-radius: 28px;
  }
  .progress-bar {
    width: calc(100% - 78px);
    height: 3px;
    margin-top: 1px;
  }
  .controls {
    gap: 8px;
  }
  .control-cluster {
    height: 40px;
    gap: 6px;
  }
  .control-cover {
    width: 34px;
    height: 34px;
    border-radius: 9px;
  }
  .control-meta {
    max-width: 150px;
  }
  .control-title {
    font-size: 11px;
  }
  .control-artist,
  #time-display,
  .source-control {
    display: none;
  }
  .ctrl-btn {
    width: 30px;
    height: 30px;
  }
  #play-btn {
    width: 42px;
    height: 42px;
  }
}
@media (max-height: 420px) {
  .bottom-bar {
    width: min(620px, calc(100vw - 36px));
  }
  .control-cluster.actions .lyrics-toggle-btn,
  .control-cluster.actions .heart-btn,
  .control-cluster.modes .volume-control {
    display: none;
  }
}
</style>
