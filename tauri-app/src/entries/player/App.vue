<script setup lang="ts">
import ContentLoading from '@/features/files/electron/ContentLoading.vue'
import { computed, watch, onMounted, onUnmounted, onErrorCaptured, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Monitor } from 'lucide-vue-next'
import AppFrame from '@/components/AppFrame.vue'
import PlayerHeader from '@/vendor/soia/components/PlayerHeader.vue'
import PlayerControls from '@/vendor/soia/components/PlayerControls.vue'
import CastDevicePopover from '@/vendor/soia/components/CastDevicePopover.vue'
import PlaylistDrawer from '@/vendor/soia/components/PlaylistDrawer.vue'
import { formatTime } from '@/features/player/formatTime'
import { usePlaybackQuality } from '@/features/player/usePlaybackQuality'
import { usePlayer } from '@/features/player/usePlayer'
import { useI18n } from '@/lib/i18n'
import { asAppError, isNative, openFile, playFile } from '@/platform/native'
import type { BoxPlayer } from '@/vendor/soia/types/media'
import type { MediaInfo } from '@/vendor/soia/mock/mediaInfo'
import '@/vendor/soia/styles/app-theme.css'
import '@/vendor/soia/styles/app-shell.css'
import '@/vendor/soia/styles/player.css'
import '@/features/player/framePlayback.css'
const { t } = useI18n()
const { snapshot, error, control } = usePlayer()
const active = computed(() => snapshot.value && !['idle', 'error'].includes(snapshot.value.state))
const videoReady = computed(() => {
  const media = snapshot.value
  return Boolean(media && active.value && media.embedded && media.state !== 'loading' && media.videoWidth > 0 && media.videoHeight > 0)
})
const paused = computed(() => snapshot.value?.state !== 'playing')
const tracks = computed<BoxPlayer[]>(() => snapshot.value?.tracks.map(track => ({ ...track, track_type: track.kind, lang: track.language })) ?? [])
const audio = computed(() => tracks.value.filter(track => track.track_type === 'audio'))
const subtitles = computed(() => [{ id: 0, track_type: 'sub', title: 'Off', selected: !tracks.value.some(track => track.track_type === 'sub' && track.selected) }, ...tracks.value.filter(track => track.track_type === 'sub')])
const queueEntries = computed(() => snapshot.value?.queue?.map(item => ({ coreEntryId: item.itemId, path: item.title, title: item.title, addedAt: 0 })) ?? [])
const video = computed<BoxPlayer[]>(() => [{ id: 1, track_type: 'video', title: '', selected: true, w: snapshot.value?.videoWidth, h: snapshot.value?.videoHeight }])
const info = computed<MediaInfo | null>(() => snapshot.value ? { title: snapshot.value.title, path: snapshot.value.title, container: '', size: '', duration: formatTime(snapshot.value.duration), badges: [], video: { codec: '', resolution: `${snapshot.value.videoWidth} × ${snapshot.value.videoHeight}`, fps: '', bitRate: '', color: '', aspect: '' }, audio: { codec: '', channels: '', sampleRate: '', language: '' }, subtitles: subtitles.value.map(track => track.title) } : null)
const isMac = /mac|darwin/i.test(navigator.userAgent)
const hasLinuxSystemControls = /Linux/i.test(navigator.platform)
const fullscreen = ref(false)
const infoOpen = ref(false)
const playlistOpen = ref(false)
const menu = ref('')
const { qualities, loading: qualityLoading, changing: qualityChanging, error: qualityError, selected: selectedQuality, select: selectQuality } =
  usePlaybackQuality(computed(() => menu.value === 'quality'), snapshot)
watch(() => snapshot.value?.sessionId, () => { if (menu.value === 'quality') menu.value = '' })
const castOpen = ref(false)
function togglePlaylist() {
  menu.value = ''
  playlistOpen.value = !playlistOpen.value
  wake()
}
function toggleCast(open: boolean) {
  castOpen.value = open
  if (open) menu.value = ''
  wake()
}
watch(active, value => { if (!value) castOpen.value = false })

const advanced = ref(false)
const controlsVisible = ref(true)
const url = ref('')
const lastVolume = ref(70)
const adjustments = ref({ zoom: 1, audioDelay: 0, subDelay: 0, brightness: 0, contrast: 0, saturation: 0, gamma: 0, hue: 0, globalColor: true, globalCrop: true, loop: false })
let hideTimer: ReturnType<typeof setTimeout> | undefined
let unresize: (() => void) | undefined
function wake() { controlsVisible.value = true; if (hideTimer) clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (!paused.value && !menu.value && !infoOpen.value && !playlistOpen.value && !castOpen.value) controlsVisible.value = false }, 2500) }
function unsupported(feature: string) { error.value = `${feature} 尚未接入；当前操作未执行。` }
async function choose() { try { const path = await openFile(); if (path) await playFile(path) } catch (e) { error.value = asAppError(e).message } }
async function toggleFullscreen() { try { const win = getCurrentWindow(); await win.setFullscreen(!await win.isFullscreen()); fullscreen.value = await win.isFullscreen() } catch (e) { error.value = asAppError(e).message } }
async function toggleMute() { const v = snapshot.value?.volume ?? 70; if (v) lastVolume.value = v; await control('volume', v ? 0 : lastVolume.value) }
function toggleMenu(next: string) { menu.value = menu.value === next ? '' : next; wake() }
async function setting(key: keyof typeof adjustments.value, value: number | boolean) { const action = key === 'zoom' ? 'zoom' : key; await control(action, key === 'zoom' ? Math.log2(Number(value)) : typeof value === 'boolean' ? Number(value) : value); if (!error.value) (adjustments.value as Record<string, number | boolean>)[key] = value }
function key(event: KeyboardEvent) {
  if ((event.target as HTMLElement).closest('input,select,textarea,[contenteditable="true"]')) return
  if (event.code === 'Space') { event.preventDefault(); void control('pause', paused.value ? 0 : 1) }
  if (event.code === 'ArrowRight') { event.preventDefault(); void control('seek', (snapshot.value?.position ?? 0) + 5) }
  if (event.code === 'ArrowLeft') { event.preventDefault(); void control('seek', Math.max(0, (snapshot.value?.position ?? 0) - 5)) }
  if (event.code === 'Escape') { menu.value = ''; playlistOpen.value = false; infoOpen.value = false; error.value = '' }
  if (event.code === 'KeyI') infoOpen.value = !infoOpen.value
  if (event.code === 'KeyF') void toggleFullscreen()
  wake()
}
onErrorCaptured(e => { error.value = asAppError(e).message; return false })
onMounted(async () => { window.addEventListener('keydown', key); wake(); if (isNative()) { fullscreen.value = await getCurrentWindow().isFullscreen(); unresize = await getCurrentWindow().onResized(async () => { fullscreen.value = await getCurrentWindow().isFullscreen() }) } })
onUnmounted(() => { window.removeEventListener('keydown', key); if (hideTimer) clearTimeout(hideTimer); unresize?.() })
</script>
<template>
  <AppFrame>
    <div class="soia-container" :class="{ 'video-mode': videoReady, 'video-background': !videoReady, 'frame-playback': active, 'frame-playback-macos': isMac && !fullscreen, 'cursor-hidden': !controlsVisible, 'system-window-controls': hasLinuxSystemControls }" @mousemove="wake" @mouseleave="wake" @click.self="menu = ''; wake()">
      <PlayerHeader v-show="controlsVisible" :playback-actions-in-footer="!!active" :is-mac-os="isMac" :url="url || snapshot?.displayPath || snapshot?.title || ''" :media-title="snapshot?.title || ''" :is-url-modified="!!url" :is-file-loaded="!!active" :is-info-open="infoOpen" :is-playlist-open="playlistOpen" :is-loading="snapshot?.state === 'loading'" playback-title-mode="Show" :compact-mode-enabled="true" :is-fullscreen="fullscreen" :info="info" :current-time="snapshot?.position || 0" :duration="snapshot?.duration || 0" :is-playing="!paused" :video-bitrate="0" hwdec-current="" :playback-speed="snapshot?.speed || 1" :video-tracks="video" :audio-tracks="audio" :sub-tracks="subtitles" @update:url="url = $event" @open-file-picker="choose" @load-file="choose" @toggle-info="infoOpen = !infoOpen" @toggle-playlist="togglePlaylist">
        <template #playback-brand>
          <span v-if="active" class="playback-brand">BoxPlayer <img src="/app-icon.png" alt="" /></span>
        </template>
      </PlayerHeader>
      <ContentLoading v-if="snapshot?.state === 'loading'" class="soia-loading" :label="t('loadingVideo')" />
      <p v-else-if="snapshot?.state === 'error' && snapshot.error" class="soia-playback-error" role="alert">{{ snapshot.error }}</p>
      <p v-if="error" class="soia-notice" role="alert" @click="error = ''">{{ error }}</p>
      <PlaylistDrawer :open="playlistOpen" :playlists="[]" active-playlist-id="current" active-playlist-name="当前播放队列" :width-ratio="null" :scroll-state="{ list: 0, playlists: {} }" :entries="queueEntries" :current-url="snapshot?.title || ''" :is-ready="!!snapshot" loop-mode="list" sort-mode="name" :is-loop-one="adjustments.loop" @close="playlistOpen = false" @play="control('queue', queueEntries.findIndex(entry => entry.coreEntryId === $event.coreEntryId))" @add="choose" @toggle-loop="unsupported('队列循环方式')" @back="unsupported('播放列表管理')" @toggle-sort="unsupported('队列排序')" @clear="unsupported('清空队列')" @remove="unsupported('移除队列项目')" @rename-playlist="unsupported('重命名播放列表')" @delete-playlist="unsupported('删除播放列表')" @move-playlist="unsupported('移动播放列表')" />
      <PlayerControls v-if="snapshot?.sessionId" :frame-layout="!!active" :is-playing="!paused" :current-time="snapshot.position" :duration="snapshot.duration" :is-live-playback="false" :progress-percent="snapshot.duration ? snapshot.position / snapshot.duration * 100 : 0" :buffered-percent="snapshot.duration ? (snapshot.bufferedPosition ?? snapshot.position) / snapshot.duration * 100 : 0" :volume="snapshot.volume" :format-time="formatTime" :controls-visible="controlsVisible" :is-hidden="!controlsVisible" :status-badges="[]" :audio-passthrough-active="false" :current-speed="snapshot.speed" :current-zoom="adjustments.zoom" :playback-rates="[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]" :show-speed-menu="menu === 'speed'" :show-settings-menu="menu === 'settings'" :audio-delay="adjustments.audioDelay" :sub-delay="adjustments.subDelay" :secondary-sub-delay="0" :brightness="adjustments.brightness" :contrast="adjustments.contrast" :saturation="adjustments.saturation" :gamma="adjustments.gamma" :hue="adjustments.hue" :global-color-adjustments-enabled="adjustments.globalColor" :global-crop-zoom-enabled="adjustments.globalCrop" :is-loop-one="adjustments.loop" :audio-tracks="audio" :video-tracks="video" :show-audio-menu="menu === 'audio'" :sub-tracks="subtitles" :dual-sub-enabled="false" :secondary-sub-id="0" active-sub-target="primary" primary-sub-font-family="" secondary-sub-font-family="" :primary-sub-font-size="55" :secondary-sub-font-size="55" primary-sub-font-color="#FFFFFF" secondary-sub-font-color="#FFFFFF" :primary-sub-pos="100" :secondary-sub-pos="100" :show-sub-menu="menu === 'sub'" :show-subtitle-advanced-settings="advanced" :has-audio-tracks="!!audio.length" :has-sub-tracks="subtitles.length > 1" :is-fullscreen="fullscreen"
      @seek="control('seek', $event)" @prev-track="control('previous')" @next-track="control('next')" @toggle-play-pause="control('pause', paused ? 0 : 1)" @stop-playback="control('pause', 1)" @set-volume="control('volume', $event)" @toggle-muted="toggleMute" @toggle-menu="toggleMenu" @set-speed="control('speed', $event)" @set-speed-continuously="control('speed', $event)" @select-audio="control('audio', undefined, Number($event.id))" @select-sub-track="control('subtitle', undefined, Number($event.track.id) === 0 ? -1 : Number($event.track.id))" @toggle-fullscreen="toggleFullscreen" @set-zoom="setting('zoom', $event)" @set-audio-delay="setting('audioDelay', $event)" @set-sub-delay-for-target="setting('subDelay', $event.value)" @set-brightness="setting('brightness', $event)" @set-contrast="setting('contrast', $event)" @set-saturation="setting('saturation', $event)" @set-gamma="setting('gamma', $event)" @set-hue="setting('hue', $event)" @toggle-loop-one="setting('loop', !adjustments.loop)" @set-global-color-adjustments-enabled="unsupported('全局画面设置')" @set-global-crop-zoom-enabled="unsupported('全局裁剪设置')" @toggle-dual-sub="unsupported('双字幕')" @add-external-audio="unsupported('外挂音轨')" @add-external-sub="unsupported('外挂字幕选择')" @find-online-sub="unsupported('在线字幕')" @set-sub-font-family="unsupported('字幕字体')" @set-sub-font-size="unsupported('字幕字号')" @set-sub-font-color="unsupported('字幕颜色')" @set-sub-position="unsupported('字幕位置')" @reset-sub-appearance="unsupported('字幕外观重置')" @update:show-subtitle-advanced-settings="advanced = $event">
        <template #after-repeat>
          <button v-if="active" class="icon-button icon-button--player playback-queue"
            type="button" title="Playlist" aria-label="Playlist" :aria-pressed="playlistOpen"
            @click.stop="togglePlaylist">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M2.4 3.6h19.2v2.4H2.4zM2.4 10.8h19.2v2.4H2.4zM2.4 18h13.2v2.4H2.4zM16.8 16.4v5.6l4.8-2.8z" />
            </svg>
          </button>
        </template>
        <template #before-fullscreen>
          <div v-if="active && snapshot.videoHeight > 0" class="playback-quality">
            <button class="icon-button icon-button--player" type="button" title="画质" aria-label="画质"
              :aria-expanded="menu === 'quality'" @click.stop="toggleMenu('quality')">
              <Monitor :size="21" />
            </button>
            <div v-if="menu === 'quality'" class="playback-quality__options" aria-label="画质选项" @click.stop>
              <p>当前画质 · {{ snapshot.videoWidth }} × {{ snapshot.videoHeight }}</p>
              <p v-if="qualityLoading || qualityChanging" role="status">{{ qualityChanging ? '正在切换画质' : '正在获取画质' }}</p>
              <p v-if="qualityError" role="alert">{{ qualityError }}</p>
              <button v-for="quality in qualities" :key="quality.id" type="button" :aria-pressed="quality.id === selectedQuality"
                :disabled="qualityChanging || snapshot.state === 'loading'" @click="selectQuality(quality.id)">{{ quality.label }}</button>
              <p v-if="!qualities.length && !qualityLoading && !qualityError">此来源仅提供当前画质</p>
            </div>
          </div>
          <CastDevicePopover v-if="active" :is-file-loaded="true" @update:open="toggleCast" />
        </template>
      </PlayerControls>
    </div>
  </AppFrame>
</template>
<style scoped>
.system-window-controls :deep(.top-bar__window-controls) { display: none; }
.soia-container.video-mode { transition: none; }
.soia-container.video-background { background: #000; transition: none; }
.soia-loading{position:absolute;inset:0;pointer-events:none}
.soia-playback-error { margin: auto; text-align: center; color: #fff; }
.soia-notice { position: absolute; top: 18%; left: 15%; right: 15%; padding: 16px; background: #161b22e8; color: white; border-radius: 10px; z-index: 2100; text-align: center; }
.playback-quality { position: relative; }
.playback-quality__options {
  position: absolute;
  z-index: 20;
  inset-inline-end: 0;
  bottom: calc(100% + 12px);
  width: max-content;
  min-width: 180px;
  max-width: min(300px, 80vw);
  max-height: min(320px, 55vh);
  overflow-y: auto;
  border: 1px solid #ffffff33;
  border-radius: 12px;
  padding: 6px;
  background: #191a1cf2;
  color: white;
}
.playback-quality__options p { margin: 6px 10px; font-size: 12px; }
.playback-quality__options button {
  display: block;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  border: 0;
  border-radius: 6px;
  color: inherit;
  text-align: start;
}
.playback-quality__options button:hover, .playback-quality__options button[aria-pressed='true'] { background: #ffffff26; }
</style>
