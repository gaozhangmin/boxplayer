<script setup lang="ts">
/**
 * Desktop floating lyric window.
 * Receives lyric/playback data from the main window via IPC.
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { lyricAppearance, normalizeLyricPayload, flowingAppearance } from '../utils/desktopLyricPayload'
import MusicFlowingLyrics from '../layout/music/MusicFlowingLyrics.vue'
import { t } from '../i18n'

interface LyricLineData {
  time: number
  text: string
}

const lines = ref<LyricLineData[]>([])
const activeIndex = ref(-1)
const scrollContainer = ref<HTMLElement | null>(null)
const currentTrack = reactive({
  title: '',
  artist: '',
  isPlaying: false,
})

const opacity = ref(0.85)
const fontSize = ref(28)
const isLocked = ref(false)
const hovered = ref(false)
const appearance = ref(lyricAppearance({}))
const flowing = ref(false)
const flowingColors = ref(flowingAppearance({}).colors)
const flowingText = computed(() => lines.value[activeIndex.value]?.text || currentTrack.title)
let ownerPresentation = ''
let ownerLocked: boolean | undefined
function applyFlowing(data: Record<string, unknown>) {
  const value = flowingAppearance(data)
  if (data.presentation !== undefined && value.presentation !== ownerPresentation) {
    ownerPresentation = value.presentation
    flowing.value = value.presentation === 'flowing'
  }
  if (data.flowingColors !== undefined) flowingColors.value = value.colors
}
const appearanceStyle=computed(()=>({'--lyric-font-family':appearance.value.fontFamily,'--lyric-weight':String(appearance.value.fontWeight),'--lyric-spacing':appearance.value.letterSpacing+'px','--lyric-line-height':String(appearance.value.lineHeight),'--lyric-primary':appearance.value.highlightFollow?appearance.value.primaryColor:appearance.value.secondaryColor,'--lyric-secondary':appearance.value.secondaryColor,'--lyric-scale':String(appearance.value.scale),'--lyric-y':((appearance.value.y-.5)*70)+'vh','--lyric-shake':appearance.value.shake+'px',backgroundColor:`rgba(0,0,0,${appearance.value.backgroundOpacity})`}))

// ---- IPC listeners ----

onMounted(() => {
  // Listen for lyric data from main window
  window.Electron?.ipcRenderer.on('lyricData', (_event: any, input: any) => {
    const data = normalizeLyricPayload(input)
    applyFlowing(data)
    if (data.lines) {
      lines.value = data.lines
    }
    if (data.activeIndex !== undefined) {
      activeIndex.value = data.activeIndex
      scrollToActiveLine()
    }
    if (data.title !== undefined) currentTrack.title = data.title
    if (data.artist !== undefined) currentTrack.artist = data.artist
    if (data.isPlaying !== undefined) currentTrack.isPlaying = data.isPlaying
  })

  // Handle config (settings from main)
  window.Electron?.ipcRenderer.on('lyricConfig', (_event: any, data: any) => {
    applyFlowing(data)
    appearance.value=lyricAppearance({...appearance.value,...data})
    if (data.fontSize !== undefined) fontSize.value = appearance.value.fontSize
    if (data.opacity !== undefined) opacity.value = appearance.value.opacity
    if (typeof data.isLocked === 'boolean' && data.isLocked !== ownerLocked) {
      ownerLocked = data.isLocked
      isLocked.value = data.isLocked
    }
  })
  window.Electron?.ipcRenderer.send('WebLyricReady', {})
})

// ---- Scrolling ----

let lastScrollIndex = -1
function scrollToActiveLine() {
  if (activeIndex.value === lastScrollIndex) return
  lastScrollIndex = activeIndex.value
  const container = scrollContainer.value
  if (!container) return
  const target = container.querySelector(`[data-li="${activeIndex.value}"]`) as HTMLElement | null
  if (!target) {
    container.scrollLeft = 0
    return
  }
  const containerW = container.clientWidth
  const left = target.offsetLeft - containerW / 2 + target.clientWidth / 2
  container.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
}

// ---- Controls ----

function closeLyric() {
  window.WebCloseLyric?.()
}

function toggleLock() {
  isLocked.value = !isLocked.value
}

function incFontSize() {
  fontSize.value = Math.min(60, fontSize.value + 2)
}

function decFontSize() {
  fontSize.value = Math.max(12, fontSize.value - 2)
}

function incOpacity() {
  opacity.value = Math.min(1, opacity.value + 0.1)
}

function decOpacity() {
  opacity.value = Math.max(0.15, opacity.value - 0.1)
}

// ---- Drag support ----

let isDragging = false
let dragStartX = 0
let dragStartY = 0

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0 || (e.target instanceof Element && e.target.closest('button, input, select, textarea, label'))) return
  if(isLocked.value)return
  isDragging = true
  dragStartX = e.screenX
  dragStartY = e.screenY
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('blur', onMouseUp)
  e.preventDefault()
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging) return
  const dx = e.screenX - dragStartX
  const dy = e.screenY - dragStartY
  dragStartX = e.screenX
  dragStartY = e.screenY
  window.Electron?.ipcRenderer.send('WebToWindow', {
    cmd: 'move',
    dx,
    dy,
  })
}

function onMouseUp() {
  isDragging = false
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('blur', onMouseUp)
}

function onDblClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('button')) return
  toggleLock()
}

// Cleanup
onBeforeUnmount(() => {
  onMouseUp()
  window.Electron?.ipcRenderer.removeAllListeners('lyricData')
  window.Electron?.ipcRenderer.removeAllListeners('lyricConfig')
})
</script>

<template>
  <div
    class="lyric-window"
    :class="{'lyric-shaking':currentTrack.isPlaying&&appearance.shake>0}"
    :style="{
      ...appearanceStyle,
      backgroundColor: hovered ? 'rgba(24,24,32,.88)' : 'transparent',
      opacity: opacity,
      cursor: isLocked ? 'none' : 'default',
      '--lyric-font-size': fontSize + 'px',
      '--lyric-active-size': (fontSize * 1.4) + 'px',
    }"
    @mousedown="onMouseDown"
    @dblclick="onDblClick"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <!-- Control bar (hover to show when unlocked) -->
    <transition name="ctrl-fade">
      <div v-if="hovered" class="lyric-controls">
        <button class="lyric-ctrl-btn" @click="closeLyric" title="关闭">✕</button>
        <span class="lyric-ctrl-spacer"></span>
        <span class="lyric-ctrl-label" v-if="currentTrack.title">{{ currentTrack.title }}</span>
        <span class="lyric-ctrl-spacer"></span>
        <button class="lyric-ctrl-btn" @click="flowing = !flowing" :title="t('music.lyricMode')">{{ flowing ? t('music.standardLyrics') : t('music.flowingLyrics') }}</button>
        <button class="lyric-ctrl-btn" @click="decFontSize" title="缩小字体">A-</button>
        <button class="lyric-ctrl-btn" @click="incFontSize" title="增大字体">A+</button>
        <button class="lyric-ctrl-btn" @click="decOpacity" title="降低透明度">◐</button>
        <button class="lyric-ctrl-btn" @click="incOpacity" title="增加透明度">◑</button>
        <button class="lyric-ctrl-btn" @click="toggleLock" title="锁定">🔒</button>
      </div>
    </transition>

    <!-- Lyric content -->
    <MusicFlowingLyrics v-if="flowing" :text="flowingText" :playing="currentTrack.isPlaying" :colors="flowingColors" :transparent="!hovered"
      @exit="toggleLock" @standard="flowing = false" @settings="isLocked = false" />
    <div v-else ref="scrollContainer" class="lyric-scroll">
      <div class="lyric-inner">
        <div v-if="lines.length === 0" class="lyric-placeholder">
          暂无歌词
        </div>
        <template v-else>
          <div class="lyric-spacer"></div>
          <div
            v-for="(line, i) in lines"
            :key="i"
            :data-li="i"
            :class="[
              'lyric-line',
              i === activeIndex ? 'active' : '',
              i < activeIndex ? 'past' : '',
            ]"
          >
            {{ line.text }}
          </div>
          <div class="lyric-spacer"></div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lyric-window {
  width: 100vw;
  height: 100vh;
  background: transparent;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  -webkit-app-region: no-drag;
}

.lyric-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 0 0 8px 8px;
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
}

.ctrl-fade-enter-active,
.ctrl-fade-leave-active {
  transition: opacity 0.2s;
}
.ctrl-fade-enter-from,
.ctrl-fade-leave-to {
  opacity: 0;
}

.lyric-ctrl-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.75);
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  line-height: 1;
}
.lyric-ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.lyric-ctrl-spacer {
  flex: 1;
}

.lyric-ctrl-label {
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.lyric-scroll {
  flex: 1;
  overflow-x: scroll;
  overflow-y: hidden;
  display: flex;
  align-items: center;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.lyric-scroll::-webkit-scrollbar {
  display: none;
}

.lyric-inner {
  display: flex;
  align-items: center;
  white-space: nowrap;
  transform:translateY(var(--lyric-y,0)) scale(var(--lyric-scale,1));
  transform-origin:center;
  padding: 0 40px;
  min-width: 100%;
}

.lyric-spacer {
  width: 45vw;
  flex-shrink: 0;
}

.lyric-line {
  padding: 8px 20px;
  font-size: var(--lyric-font-size);
  font-weight:var(--lyric-weight,500);
  font-family:var(--lyric-font-family,system-ui);
  letter-spacing:var(--lyric-spacing,0);
  line-height:var(--lyric-line-height,1.4);
  color:var(--lyric-secondary,#aaa);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
  white-space: nowrap;
  cursor: default;
  transition: all 0.25s ease;
  flex-shrink: 0;
}

.lyric-line.active {
  color:var(--lyric-primary,#fff);
  font-size: var(--lyric-active-size);
  font-weight:var(--lyric-weight,700);
  text-shadow: 0 0 20px rgba(120, 115, 245, 0.7), 0 2px 8px rgba(0, 0, 0, 0.5);
}

.lyric-line.past {
  color: rgba(255, 255, 255, 0.25);
}

.lyric-placeholder {
  font-size: 20px;
  color: rgba(255, 255, 255, 0.4);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  padding: 20px;
  white-space: nowrap;
}
@keyframes lyric-pulse { from { translate:0 calc(var(--lyric-shake,0px) * -1); } to { translate:0 var(--lyric-shake,0px); } }
.lyric-shaking .lyric-line.active {animation:lyric-pulse .12s ease-in-out infinite alternate}
@media(prefers-reduced-motion:reduce){.lyric-shaking .lyric-line.active{animation:none}}
</style>
