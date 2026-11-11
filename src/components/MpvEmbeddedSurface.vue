<script setup lang="ts">
import { SeekThumbnailPreview } from '../utils/seekThumbnailPreview'
import { computed, h, onBeforeUnmount, onMounted, ref, watch, shallowRef } from 'vue'
import { Button, Input, Modal, Option as AOption, Select } from '@arco-design/web-vue'
import {
  formatSubtitleDownloadCount,
  getSubtitleDownload,
  searchSubtitles
} from '../utils/subtitleApi'
import type { SubtitleSearchResult } from '../utils/subtitleApi'
import message from '../utils/message'
import { toSimplified, toTraditional } from 'chinese-simple2traditional'
import type { CSSProperties } from 'vue'
import PlaybackDanmakuSettings from './PlaybackDanmakuSettings.vue'
import MpvSkipIntroOutroDialog from './MpvSkipIntroOutroDialog.vue'
import { formatDanmakuText, danmakuMatchTitle } from '../utils/danmakuPreferences'
import PlaybackSubtitleNumberRow from './PlaybackSubtitleNumberRow.vue'
import useSettingStore from '../setting/settingstore'
import { autoMatchDanmaku, loadDanmakuComments, createDanmakuFilter } from '../utils/danmakuApi'
import type { Danmu } from 'artplayer-plugin-danmuku'
import { MpvPlaybackSession } from '../utils/mpvPlaybackSession'
import { getAutoSubtitleTrackId, subtitleSelectionCommands } from '../utils/mpvSubtitleTrack'
import { Captions, MessageSquare, Search, Flag, ListVideo, Pause, Play, Settings, Volume2, VolumeX, RotateCcw, RotateCw, Maximize2, PictureInPicture2, Check, ChevronRight, Gauge, RectangleHorizontal, SkipBack, SkipForward } from 'lucide-vue-next'

const props = defineProps<{
  url: string
  headers?: Record<string, string>
  title?: string
  startPosition?: number
  qualityLabel?: string
  qualities?: Array<{ html?: string; quality?: string; name?: string; label?: string; value?: string }>
  currentQuality?: string
  subtitleSources?: Array<{ url: string; title?: string }>
  subtitleFiles?: Array<{ id: string; title: string }>
  resolveSubtitleFile?: (id: string) => Promise<{ url: string; title?: string } | undefined>
  playlist?: Array<{ file_id?: string; html?: string; name?: string; default?: boolean }>
  chapters?: Array<{ start: number; end: number; title?: string }>
  currentFileId?: string
}>()

const emit = defineEmits<{
  error: [message: string]
  status: [status: any]
  qualitySelect: [quality: string]
  playlistSelect: [fileId: string]
  playlistNext: []
  playlistPrev: []
}>()

const canvasRef = shallowRef<HTMLCanvasElement | null>(null)
const fallbackCanvasRef = shallowRef<HTMLCanvasElement | null>(null)
const loading = ref(false)
const loaded = ref(false)
const errorText = ref('')
const statusText = ref('')
const frameCount = ref(0)
const renderMode = ref<'webgl' | 'fallback'>('webgl')
const paused = ref(false)
const position = ref(0)
const duration = ref(0)
const volume = ref(100)
const speed = ref(1)
const bufferedPosition = ref(0)
const seeking = ref(false)
const seekProgress = shallowRef<HTMLInputElement | null>(null)
let seekPreview: SeekThumbnailPreview | undefined
const controlsVisible = ref(true)
const controlsHover = ref(false)
const toggleFullscreen = () => window.WebToWindow?.({ cmd: 'fullscreen' })
const optionsOpen = ref(false)
const volumeOpen = ref(false)
const quickMenu = ref<'speed' | 'aspect' | null>(null)
const settingsOpen = ref(false)
const openSettingsTab = (tab: 'video' | 'audio' | 'subtitle' | 'danmaku') => {
  settingsTab.value = tab
  settingsOpen.value = true
  playlistOpen.value = false
  optionsOpen.value = false
}
let pipVideo: HTMLVideoElement | null = null
const closePictureInPicture = () => {
  const stream = pipVideo?.srcObject as MediaStream | null
  stream?.getTracks().forEach(track => track.stop())
  if (pipVideo) pipVideo.srcObject = null
  pipVideo?.remove()
  pipVideo = null
}
const togglePictureInPicture = async () => {
  try {
    if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return }
    const canvas = renderMode.value === 'fallback' ? fallbackCanvasRef.value : canvasRef.value
    if (!canvas || !document.pictureInPictureEnabled) { showNotice('当前环境不支持画中画'); return }
    pipVideo = document.createElement('video')
    pipVideo.muted = true
    pipVideo.srcObject = canvas.captureStream(30)
    await pipVideo.play()
    pipVideo.addEventListener('leavepictureinpicture', closePictureInPicture, { once: true })
    await pipVideo.requestPictureInPicture()
  } catch { closePictureInPicture(); showNotice('无法打开画中画') }
}
const playlistOpen = ref(false)
const playlistTab = ref<'playlist' | 'chapters'>('playlist')
const noticeText = ref('')
const audioTrackId = ref(-1)
const subtitleTrackId = ref(-1)
const subtitleFileLoading = ref(false)
let manualSubtitleSelection = false
let autoSelectedSubtitleTrackId: number | undefined
const secondarySubtitleTrackId = ref(-1)
const secondarySubtitleLines = ref(0)
const dualSubtitles = computed(() => subtitleTrackId.value >= 0 && secondarySubtitleTrackId.value >= 0)
type SubtitleStyle = {
  delay: number; scale: number; opacity: number; custom: boolean; font: string;
  fontSize: number; color: string; background: string; border: string; borderSize: number;
  shadow: string; shadowSize: number; bold: boolean; italic: boolean; position: number; conversion: number
}
const defaultSubtitleStyle = (secondary = false): SubtitleStyle => ({
  delay: 0, scale: 1, opacity: 1, custom: false, font: 'sans-serif', fontSize: 44,
  color: '#ffffff', background: '#00000000', border: '#000000', borderSize: 1,
  shadow: '#000000', shadowSize: 0, bold: false, italic: false, position: secondary ? 84 : 96, conversion: 0
})
const loadSubtitleStyles = (): SubtitleStyle[] => {
  try {
    const raw = JSON.parse(localStorage.getItem('playbackSubtitleStyles') || 'null')
    if (Array.isArray(raw) && raw.length === 2) return raw.map((value, index) => ({ ...defaultSubtitleStyle(index === 1), ...value }))
  } catch { /* Use defaults when an older preference cannot be decoded. */ }
  return [defaultSubtitleStyle(), defaultSubtitleStyle(true)]
}
const subtitleStyles = ref(loadSubtitleStyles())
subtitleStyles.value[1].custom = subtitleStyles.value[0].custom
const subtitleStyleIndex = ref(0)
const selectedSubtitleStyle = computed(() => subtitleStyles.value[subtitleStyleIndex.value])
const primarySubtitleStyle = computed(() => subtitleStyles.value[0])
const customSubtitleEnabled = computed({
  get: () => subtitleStyles.value[0].custom,
  set: (enabled: boolean) => { for (const style of subtitleStyles.value) style.custom = enabled }
})
const subtitleText = ref('')
const secondarySubtitleText = ref('')
const pgsAspectCorrection = ref(localStorage.getItem('playbackPgsAspectCorrection') !== 'false')
const styleField = <K extends keyof SubtitleStyle>(key: K, primary = false) => computed({
  get: () => subtitleStyles.value[primary ? 0 : subtitleStyleIndex.value][key],
  set: (value: SubtitleStyle[K]) => { subtitleStyles.value[primary ? 0 : subtitleStyleIndex.value][key] = value }
})
const subtitleDelay = styleField('delay', true)
const subtitleScale = styleField('scale', true)
const subtitleBackgroundColor = styleField('background')
const audioDelay = ref(0)
const equalizerBands = ref([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
const equalizerFrequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
const subtitlePosition = styleField('position', true)
const isBitmapSubtitle = (index: number) => {
  const id = index === 0 ? subtitleTrackId.value : secondarySubtitleTrackId.value
  const codec = subtitleTracks.value.find(track => track.id === id)?.codec || ''
  return /pgs|dvd|dvb|vobsub/i.test(codec)
}
const usesTextOverlay = (index: number) => !isBitmapSubtitle(index) &&
  (subtitleStyles.value[index].custom || subtitleStyles.value[index].conversion !== 0 || subtitleStyles.value[index].opacity !== 1)
const displaySubtitleText = (index: number) => {
  if ((index === 0 ? subtitleTrackId.value : secondarySubtitleTrackId.value) < 0) return ''
  const text = index === 0 ? subtitleText.value : secondarySubtitleText.value
  const mode = subtitleStyles.value[index].conversion
  return mode === 1 ? toSimplified(text) : mode === 2 ? toTraditional(text) : text
}
const overlaySubtitleStyle = (index: number): CSSProperties => {
  const style = subtitleStyles.value[index]
  const outline = style.custom ? style.borderSize : 1
  return {
    bottom: `${100 - style.position}%`, opacity: style.opacity,
    fontFamily: style.custom ? style.font : 'sans-serif',
    fontSize: `clamp(12px, ${style.fontSize * style.scale / 10.8}cqh, 160px)`,
    fontWeight: style.custom && style.bold ? 'bold' : 'normal',
    fontStyle: style.custom && style.italic ? 'italic' : 'normal',
    color: style.custom ? style.color : '#ffffff',
    backgroundColor: style.custom ? style.background : 'transparent',
    WebkitTextStroke: `${outline}px ${style.custom ? style.border : '#000000'}`,
    paintOrder: 'stroke fill',
    textShadow: style.custom && style.shadowSize > 0 ? `${style.shadowSize}px ${style.shadowSize}px ${style.shadowSize}px ${style.shadow}` : 'none'
  }
}
const skipDialogOpen = ref(false)
const introSkipEnabled = ref(false)
const outroSkipEnabled = ref(false)
const openSkipDialog = () => {
  optionsOpen.value = false
  quickMenu.value = null
  skipDialogOpen.value = true
}
const introSkipSeconds = ref(0)
const outroSkipSeconds = ref(0)
const aspectRatio = ref('no')
const cropRatio = ref('no')
const rotation = ref(0)
const hardwareDecode = ref(true)
const deinterlace = ref(false)
const hdrToneMapping = ref(true)
const brightness = ref(0)
const contrast = ref(0)
const saturation = ref(0)
const gamma = ref(0)
const hue = ref(0)
const introSkipped = ref(false)
const outroTriggered = ref(false)
const tracks = ref<Array<{ id: number; type: string; title?: string; language?: string; codec?: string; selected?: boolean; external?: boolean }>>([])
const nativeBuffering = ref(false)
const isBuffering = computed(() => !errorText.value && (loading.value || nativeBuffering.value || frameCount.value === 0))
const shouldShowControls = computed(() => controlsVisible.value || controlsHover.value || paused.value || loading.value || Boolean(errorText.value) || seeking.value || settingsOpen.value || playlistOpen.value || optionsOpen.value || volumeOpen.value || skipDialogOpen.value)

const danmakuPreferences = useSettingStore()
const danmakuComments = shallowRef<Danmu[]>([])
const danmakuLoading = ref(false)
const danmakuTime = ref(0)
let danmakuFrame = 0
let nativeClockPosition = 0
let nativeClockTimestamp = performance.now()
const tickDanmaku = () => {
  if (danmakuComments.value.length && danmakuPreferences.danmakuVisible) danmakuTime.value = nativeClockPosition + (paused.value || loading.value || nativeBuffering.value ? 0 : (performance.now() - nativeClockTimestamp) / 1000 * speed.value)
  danmakuFrame = requestAnimationFrame(tickDanmaku)
}
const matchPlaybackDanmaku = async () => {
  const sequence = loadSequence
  danmakuLoading.value = true
  try {
    if (!danmakuPreferences.danmakuEnabled) return
    const apis = danmakuPreferences.danmakuApis.filter(api => api.url.trim() && api.name.trim())
    const match = await autoMatchDanmaku(danmakuMatchTitle(props.title || '', danmakuPreferences.danmakuMatchYear), apis)
    const episode = match?.response.matches?.[0]
    if (!match || !episode) { showNotice('未找到匹配弹幕'); return }
    const comments = await loadDanmakuComments(episode.episodeId, match.api)
    if (sequence !== loadSequence) return
    danmakuComments.value = comments.sort((a, b) => (a.time || 0) - (b.time || 0))
    danmakuPreferences.updateStore({ danmakuVisible: true })
  } catch { showNotice('弹幕加载失败') }
  finally { danmakuLoading.value = false }
}
const activeDanmaku = computed(() => {
  if (!danmakuPreferences.danmakuEnabled || !danmakuPreferences.danmakuVisible) return []
  const comments = danmakuComments.value
  const time = danmakuTime.value - danmakuPreferences.danmakuDelay
  const lifetime = danmakuPreferences.danmakuSpeed
  // Binary search keeps the per-frame work bounded for large comment files.
  const lowerBound = (target: number) => {
    let low = 0, high = comments.length
    while (low < high) { const middle = (low + high) >>> 1; if ((comments[middle].time || 0) < target) low = middle + 1; else high = middle }
    return low
  }
  const start = lowerBound(time - lifetime)
  const end = lowerBound(time + 0.001)
  const rows = Math.max(1, Math.floor((100 - parseFloat(danmakuPreferences.danmakuMarginBottom || '0')) / 6))
  return comments.slice(start, Math.min(end, start + 60)).filter(createDanmakuFilter(danmakuPreferences.danmakuFilterText)).map((comment, offset) => {
    const progress = Math.min(1, Math.max(0, (time - (comment.time || 0)) / lifetime))
    const mode = danmakuPreferences.danmakuFixedToScroll ? 0 : comment.mode || 0
    return {
      id: start + offset, text: formatDanmakuText(comment.text, danmakuPreferences),
      style: {
        color: comment.color || danmakuPreferences.danmakuColor,
        fontFamily: danmakuPreferences.danmakuFontFamily, fontSize: `${danmakuPreferences.danmakuFontSize}px`, opacity: danmakuPreferences.danmakuOpacity,
        top: mode === 2 ? `${(rows - 1 - (start + offset) % rows) * 6}%` : `${(start + offset) % rows * 6}%`,
        left: mode ? '50%' : '0',
        transform: mode ? 'translateX(-50%)' : `translateX(calc((100cqw + 100%) * ${1 - progress} - 100%))`,
        WebkitTextStroke: `${danmakuPreferences.danmakuBorderSize}px #000`, paintOrder: 'stroke fill'
      } as CSSProperties
    }
  })
})

type WebGLVideoState = {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  texture: WebGLTexture
  vao: WebGLVertexArrayObject
  flipYLocation: WebGLUniformLocation
  flipXLocation: WebGLUniformLocation
}

const vertexShaderSource = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
uniform bool u_flipY;
uniform bool u_flipX;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  float u = u_flipX ? 1.0 - a_texCoord.x : a_texCoord.x;
  float v = u_flipY ? 1.0 - a_texCoord.y : a_texCoord.y;
  v_texCoord = vec2(u, v);
}
`

const fragmentShaderSource = `#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_texture;

void main() {
  fragColor = texture(u_texture, v_texCoord);
}
`

let glState: WebGLVideoState | null = null
let fallbackContext: CanvasRenderingContext2D | null = null
let softwareSourceCanvas: HTMLCanvasElement | null = null
let softwareSourceContext: CanvasRenderingContext2D | null = null
let statusTimer: number | null = null
let controlsHideTimer: number | null = null
let noticeTimer: number | null = null
let lastPointerY: number | null = null
let loadSequence = 0
let sessionId = ''
let disposed = false
let statusInFlight = false
let loadStartedAt = 0
const playbackSession = new MpvPlaybackSession()
const CONTROLS_REVEAL_ZONE = 180
const CONTROLS_HIDE_ZONE = 220
const CONTROLS_DIRECTION_THRESHOLD = 2

const isAvailable = computed(() => {
  return Boolean(window.WebMpvSharedTexture?.isAvailable?.() && window.WebMpvEmbeddedLoad)
})

const audioTracks = computed(() => tracks.value.filter((track) => track.type === 'audio'))
const subtitleTracks = computed(() => tracks.value.filter((track) => track.type === 'sub'))
const unloadedSubtitleFiles = computed(() => (props.subtitleFiles || []).filter(file => !subtitleTracks.value.some(track => track.external && track.title === file.title)))
const videoTracks = computed(() => tracks.value.filter((track) => track.type === 'video'))
const speedOptions = Array.from({ length: 39 }, (_, index) => 0.5 + index * 0.25)
const aspectOptions = [{ label: '默认', value: 'no' }, { label: '4:3', value: '1.3333' }, { label: '16:9', value: '1.7778' }, { label: '16:10', value: '1.6' }, { label: '21:9', value: '2.3333' }, { label: '5:4', value: '1.25' }]
const cropOptions = [{ label: '无', value: 'no' }, { label: '4:3', value: '4:3' }, { label: '16:9', value: '16:9' }, { label: '16:10', value: '16:10' }, { label: '21:9', value: '21:9' }, { label: '5:4', value: '5:4' }]
const rotationOptions = [0, 90, 180, 270]
const optionalControlActions = new Set(['setSpeed', 'setAudioTrack', 'setSubtitleTrack', 'setSubtitleStyle', 'setVideoProperty', 'addAudio', 'addSubtitle'])
const qualityOptions = computed(() => props.qualities || [])
const currentPlaylistIndex = computed(() => {
  const list = props.playlist || []
  return list.findIndex((item) => item.file_id === props.currentFileId)
})
const canUsePlaylist = computed(() => Boolean(props.playlist && props.playlist.length > 1))
const canPlayPrevious = computed(() => canUsePlaylist.value && currentPlaylistIndex.value > 0)
const canPlayNext = computed(() => canUsePlaylist.value && currentPlaylistIndex.value >= 0 && currentPlaylistIndex.value < (props.playlist?.length || 0) - 1)
const chapters = computed(() => (props.chapters || [])
  .map((chapter) => ({
    start: Number(chapter.start),
    end: Number(chapter.end),
    title: String(chapter.title || '')
  }))
  .filter((chapter) => Number.isFinite(chapter.start) && chapter.start >= 0)
  .sort((left, right) => left.start - right.start))
const currentChapterIndex = computed(() => {
  const currentPosition = position.value
  return chapters.value.findIndex((chapter, index) => {
    const nextStart = chapters.value[index + 1]?.start ?? Infinity
    const end = Number.isFinite(chapter.end) && chapter.end > chapter.start ? chapter.end : nextStart
    return currentPosition >= chapter.start && currentPosition < end
  })
})
const playButtonLabel = computed(() => paused.value ? '播放' : '暂停')
const qualityLabel = computed(() => props.qualityLabel || '自动')
const bufferedPercent = computed(() => duration.value > 0 ? `${Math.max(0, Math.min(100, Math.max(position.value, bufferedPosition.value) / duration.value * 100))}%` : '0%')
const progressPercent = computed(() => duration.value > 0 ? `${Math.max(0, Math.min(100, (position.value / duration.value) * 100))}%` : '0%')
const volumePercent = computed(() => `${Math.max(0, Math.min(100, volume.value))}%`)
const subtitleSelectValue = computed(() => `track:${subtitleTrackId.value}`)
const secondarySubtitleSelectValue = computed(() => `track:${secondarySubtitleTrackId.value}`)
const settingsTab = ref<'video' | 'audio' | 'subtitle' | 'danmaku'>('video')

const createShader = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[mpv] WebGL shader compile failed:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

const initWebGL = (canvas: HTMLCanvasElement): WebGLVideoState | null => {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    desynchronized: true,
    powerPreference: 'high-performance'
  })
  if (!gl) return null

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)
  if (!vertexShader || !fragmentShader) return null

  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[mpv] WebGL program link failed:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }

  const flipYLocation = gl.getUniformLocation(program, 'u_flipY')
  const flipXLocation = gl.getUniformLocation(program, 'u_flipX')
  if (!flipYLocation || !flipXLocation) return null

  const vertices = new Float32Array([
    -1, -1, 0, 0,
    1, -1, 1, 0,
    -1, 1, 0, 1,
    1, 1, 1, 1
  ])
  const vao = gl.createVertexArray()
  const vbo = gl.createBuffer()
  const texture = gl.createTexture()
  if (!vao || !vbo || !texture) return null

  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)

  const positionLocation = gl.getAttribLocation(program, 'a_position')
  const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord')
  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0)
  gl.enableVertexAttribArray(texCoordLocation)
  gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 16, 8)

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  return { gl, program, texture, vao, flipYLocation, flipXLocation }
}

const destroyWebGL = () => {
  if (!glState) return
  const { gl, program, texture, vao } = glState
  gl.deleteTexture(texture)
  gl.deleteVertexArray(vao)
  gl.deleteProgram(program)
  glState = null
}

const drawFallbackFrame = (videoFrame: VideoFrame, width: number, height: number) => {
  const canvas = fallbackCanvasRef.value
  if (!canvas) return false
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  fallbackContext = fallbackContext || canvas.getContext('2d', { alpha: false })
  if (!fallbackContext) return false
  // The native MPV renderer exports an OpenGL texture with a bottom-left
  // origin. Canvas 2D interprets the VideoFrame with a top-left origin, so
  // the fallback path needs one vertical flip to match the WebGL path.
  fallbackContext.save()
  fallbackContext.translate(0, height)
  fallbackContext.scale(1, -1)
  fallbackContext.drawImage(videoFrame, 0, 0, width, height)
  fallbackContext.restore()
  renderMode.value = 'fallback'
  return true
}

const drawFrame = (videoFrame: VideoFrame, index: number) => {
  const canvas = canvasRef.value
  if (!canvas || !fallbackCanvasRef.value) {
    videoFrame.close?.()
    return
  }

  const width = videoFrame.displayWidth || videoFrame.codedWidth || canvas.width || 1
  const height = videoFrame.displayHeight || videoFrame.codedHeight || canvas.height || 1
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  let rendered = false
  try {
    rendered = drawFallbackFrame(videoFrame, width, height)
  } catch (error) {
    console.warn('[mpv] Canvas 2D frame render failed, trying WebGL:', error)
  }

  try {
    if (!rendered && !glState) glState = initWebGL(canvas)
    if (!rendered && glState) {
      const { gl, program, texture, vao, flipYLocation, flipXLocation } = glState
      gl.viewport(0, 0, width, height)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoFrame)
      gl.useProgram(program)
      gl.uniform1i(flipYLocation, 0)
      gl.uniform1i(flipXLocation, 0)
      gl.bindVertexArray(vao)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      renderMode.value = 'webgl'
      rendered = true
    }
  } catch (error) {
    console.warn('[mpv] WebGL frame render failed, switching to 2D fallback:', error)
    destroyWebGL()
  }

  if (!rendered) {
    try {
      rendered = drawFallbackFrame(videoFrame, width, height)
    } catch (error) {
      console.error('[mpv] 2D frame render failed:', error)
      errorText.value = '视频画面渲染失败，请重试。'
    }
  }

  videoFrame.close?.()
  if (rendered) {
    frameCount.value = index + 1
    loading.value = false
    errorText.value = ''
  }
}

const drawSoftwareFrame = (pixels: Uint8Array, width: number, height: number, index: number, transformed = false) => {
  const canvas = fallbackCanvasRef.value
  if (!canvas || width < 1 || height < 1 || pixels.length !== width * height * 4) return
  // IPC already gave us an owned byte buffer. Reinterpret it as clamped RGBA
  // instead of copying the complete frame before handing it to ImageData.
  const rgba = pixels.buffer instanceof ArrayBuffer
    ? new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength)
    : new Uint8ClampedArray(pixels)
  const image = new ImageData(rgba, width, height)
  const normalizedRotation = transformed ? 0 : ((rotation.value % 360) + 360) % 360
  if ((transformed || cropRatio.value === 'no') && normalizedRotation === 0) {
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    fallbackContext = fallbackContext || canvas.getContext('2d', { alpha: false })
    if (!fallbackContext) return
    fallbackContext.putImageData(image, 0, 0)
    renderMode.value = 'fallback'
    frameCount.value = index + 1
    loading.value = false
    errorText.value = ''
    return
  }
  softwareSourceCanvas = softwareSourceCanvas || document.createElement('canvas')
  if (softwareSourceCanvas.width !== width) softwareSourceCanvas.width = width
  if (softwareSourceCanvas.height !== height) softwareSourceCanvas.height = height
  softwareSourceContext = softwareSourceContext || softwareSourceCanvas.getContext('2d', { alpha: false })
  if (!softwareSourceContext) return
  softwareSourceContext.putImageData(image, 0, 0)

  let sourceX = 0
  let sourceY = 0
  let sourceWidth = width
  let sourceHeight = height
  if (cropRatio.value !== 'no') {
    const [ratioWidth, ratioHeight] = cropRatio.value.split(':').map(Number)
    const targetRatio = ratioWidth > 0 && ratioHeight > 0 ? ratioWidth / ratioHeight : 0
    if (targetRatio > 0 && width / height > targetRatio) {
      sourceWidth = Math.max(1, Math.round(height * targetRatio))
      sourceX = Math.floor((width - sourceWidth) / 2)
    } else if (targetRatio > 0) {
      sourceHeight = Math.max(1, Math.round(width / targetRatio))
      sourceY = Math.floor((height - sourceHeight) / 2)
    }
  }

  const swapsAxes = normalizedRotation === 90 || normalizedRotation === 270
  const outputWidth = swapsAxes ? sourceHeight : sourceWidth
  const outputHeight = swapsAxes ? sourceWidth : sourceHeight
  if (canvas.width !== outputWidth) canvas.width = outputWidth
  if (canvas.height !== outputHeight) canvas.height = outputHeight
  fallbackContext = fallbackContext || canvas.getContext('2d', { alpha: false })
  if (!fallbackContext) return
  fallbackContext.save()
  fallbackContext.clearRect(0, 0, outputWidth, outputHeight)
  if (normalizedRotation === 90) {
    fallbackContext.translate(outputWidth, 0)
    fallbackContext.rotate(Math.PI / 2)
  } else if (normalizedRotation === 180) {
    fallbackContext.translate(outputWidth, outputHeight)
    fallbackContext.rotate(Math.PI)
  } else if (normalizedRotation === 270) {
    fallbackContext.translate(0, outputHeight)
    fallbackContext.rotate(-Math.PI / 2)
  }
  fallbackContext.drawImage(softwareSourceCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight)
  fallbackContext.restore()
  renderMode.value = 'fallback'
  frameCount.value = index + 1
  loading.value = false
  errorText.value = ''
}

const clearFrame = () => {
  if (glState) {
    glState.gl.clearColor(0, 0, 0, 1)
    glState.gl.clear(glState.gl.COLOR_BUFFER_BIT)
  }
  fallbackContext?.clearRect(0, 0, fallbackCanvasRef.value?.width || 0, fallbackCanvasRef.value?.height || 0)
  frameCount.value = 0
}

const clearControlsHideTimer = () => {
  if (controlsHideTimer != null) window.clearTimeout(controlsHideTimer)
  controlsHideTimer = null
}

const isControlsPinned = () => paused.value || loading.value || Boolean(errorText.value) || seeking.value || controlsHover.value || settingsOpen.value || playlistOpen.value || optionsOpen.value || volumeOpen.value || skipDialogOpen.value

const scheduleControlsAutoHide = () => {
  clearControlsHideTimer()
}

const revealControls = () => {
  controlsVisible.value = true
}

const handleControlsEnter = () => {
  controlsHover.value = true
  controlsVisible.value = true
  clearControlsHideTimer()
}

const handleControlsLeave = () => {
  controlsHover.value = false
}

const togglePlaylist = () => {
  revealControls()
  playlistOpen.value = !playlistOpen.value
  if (playlistOpen.value) settingsOpen.value = false
}

const selectChapter = async (start: number) => {
  position.value = start
  seeking.value = false
  await control('seek', start)
}

const showNotice = (text: string) => {
  noticeText.value = text
  if (noticeTimer != null) window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    noticeText.value = ''
    noticeTimer = null
  }, 1800)
}

const hideControlsIfAllowed = () => {
  if (!isControlsPinned()) controlsVisible.value = false
}

const handleSurfacePointerMove = (event: MouseEvent) => {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const pointerY = event.clientY - rect.top
  const distanceToBottom = rect.height - pointerY
  const deltaY = lastPointerY == null ? 0 : pointerY - lastPointerY
  lastPointerY = pointerY

  if (distanceToBottom <= CONTROLS_REVEAL_ZONE || deltaY > CONTROLS_DIRECTION_THRESHOLD) {
    revealControls()
    return
  }

  if (deltaY < -CONTROLS_DIRECTION_THRESHOLD && distanceToBottom > CONTROLS_HIDE_ZONE) {
    hideControlsIfAllowed()
  }
}

const handleSurfacePointerLeave = () => {
  lastPointerY = null
  hideControlsIfAllowed()
}

const acceptStatus = (result: any) => {
  if (disposed || (result.sessionId && result.sessionId !== sessionId)) return
  if (result.error) {
    errorText.value = result.error
    loading.value = false
    emit('error', result.error)
    return
  }
  if (!result.ok) return
  if (result.status?.loading === false) loaded.value = true
  emit('status', { ...result.status, __loading: !loaded.value })
  applyStatusResult(result)
  if (loaded.value) void addAutomaticSubtitles(loadSequence)
}

const updateStatus = async () => {
  if (statusInFlight || disposed || !props.url) return
  const sequence = loadSequence
  statusInFlight = true
  try {
    const result = await window.WebMpvEmbeddedStatus?.()
    if (sequence !== loadSequence || disposed) return
    if (result) acceptStatus(result)
    if (!frameCount.value && !errorText.value && Date.now() - loadStartedAt > 30000) {
      errorText.value = '视频加载超时，请重试或检查网络连接。'
      loading.value = false
      emit('error', errorText.value)
    }
  } finally {
    statusInFlight = false
  }
}

const addAutomaticSubtitles = async (sequence: number) => {
  if (manualSubtitleSelection) return
  await playbackSession.addSubtitles(props.subtitleSources || [], sequence, async (subtitle) => {
    await control('addSubtitle', undefined, { url: subtitle.url, title: subtitle.title || '自动字幕' })
  })
}

const applyStatusResult = (result: any) => {
  bufferedPosition.value = Number.isFinite(result.status?.bufferedPosition) ? Number(result.status?.bufferedPosition) : 0
  nativeClockPosition = Number(result.status?.position || 0)
  nativeClockTimestamp = performance.now()
  nativeBuffering.value = Boolean(result.status?.buffering)
  paused.value = Boolean(result.status?.paused)
  if (!seeking.value) position.value = typeof result.status?.position === 'number' ? result.status.position : 0
  duration.value = typeof result.status?.duration === 'number' ? result.status.duration : 0
  volume.value = typeof result.status?.volume === 'number' ? result.status.volume : volume.value
  speed.value = typeof result.status?.speed === 'number' ? result.status.speed : speed.value
  subtitleText.value = result.trackStatus?.subtitleText || ''
  secondarySubtitleText.value = result.trackStatus?.secondarySubtitleText || ''
  if (Array.isArray(result.trackStatus?.tracks)) tracks.value = result.trackStatus.tracks
  if (typeof result.trackStatus?.audioId === 'number') audioTrackId.value = result.trackStatus.audioId
  if (typeof result.trackStatus?.subtitleId === 'number') subtitleTrackId.value = result.trackStatus.subtitleId
  if (typeof result.trackStatus?.secondarySubtitleId === 'number') secondarySubtitleTrackId.value = result.trackStatus.secondarySubtitleId
  if (typeof result.trackStatus?.secondarySubtitleLines === 'number') secondarySubtitleLines.value = result.trackStatus.secondarySubtitleLines
  const autoSubtitleTrackId = getAutoSubtitleTrackId(tracks.value, subtitleTrackId.value, Boolean(props.subtitleSources?.length))
  if (!manualSubtitleSelection && autoSubtitleTrackId != null && autoSubtitleTrackId !== autoSelectedSubtitleTrackId) {
    autoSelectedSubtitleTrackId = autoSubtitleTrackId
    void control('setSubtitleTrack', autoSubtitleTrackId)
  }
  statusText.value = duration.value > 0 ? `${formatTime(position.value)} / ${formatTime(duration.value)}` : ''

  handleIntroOutroSkip()
}

const load = async () => {
  seekPreview?.hide()
  if (!props.url) return
  const sequence = playbackSession.begin()
  loadSequence = sequence
  sessionId = crypto.randomUUID()
  manualSubtitleSelection = false
  secondarySubtitleTrackId.value = -1
  secondarySubtitleLines.value = 0
  subtitleFileLoading.value = false
  loadStartedAt = Date.now()
  clearFrame()
  if (!isAvailable.value) {
    const message = '内嵌 MPV surface 尚不可用。'
    errorText.value = message
    emit('error', message)
    return
  }

  loading.value = true
  nativeBuffering.value = false
  loaded.value = false
  autoSelectedSubtitleTrackId = undefined
  danmakuComments.value = []
  subtitleText.value = ''
  secondarySubtitleText.value = ''
  introSkipped.value = false
  outroTriggered.value = false
  errorText.value = ''
  const headers = Object.fromEntries(Object.entries(props.headers || {}).map(([key, value]) => [key, String(value)]))
  console.info('[播放][MPV] 提交播放链接', {
    source: /^https?:/.test(props.url) ? 'remote' : 'local',
    position: props.startPosition || 0,
    hasAuthorization: Object.keys(headers).some((key) => key.toLowerCase() === 'authorization'),
    userAgent: Object.entries(headers).find(([key]) => key.toLowerCase() === 'user-agent')?.[1] || ''
  })
  const result = await window.WebMpvEmbeddedLoad({
    sessionId,
    url: props.url,
    headers,
    title: props.title || '',
    startPosition: props.startPosition || 0
  })
  if (sequence !== loadSequence) return
  loading.value = false

  if (!result?.ok) {
    const message = result?.error || result?.capability?.reason || '内嵌 MPV 加载失败。'
    errorText.value = message
    emit('error', message)
    return
  }

  await control('play')
  if (sequence !== loadSequence) return
  await updateStatus()
  if (sequence !== loadSequence) return
  // loadfile carries start=...; do not replay seeks after subtitle completion.
  // Subtitle discovery is triggered by FILE_LOADED status independently.
  void applySubtitleStyle()

}

const control = async (action: 'play' | 'pause' | 'stop' | 'seek' | 'setVolume' | 'setSpeed' | 'setAudioTrack' | 'setSubtitleTrack' | 'setSubtitleStyle' | 'setVideoProperty' | 'addAudio' | 'addSubtitle', value?: number, extra?: { url?: string; title?: string; property?: string; propertyValue?: string | number | boolean; style?: { fontSize?: number; color?: string; position?: number; bold?: boolean; italic?: boolean } }) => {
  revealControls()
  if (disposed && action !== 'stop') return
  const sequence = loadSequence
  const result = await window.WebMpvEmbeddedControl?.({ action, value, sessionId, ...(extra || {}) })
  if (sequence !== loadSequence || disposed) return
  if (!result?.ok) {
    const message = result?.error || '内嵌 MPV 控制失败。'
    if (optionalControlActions.has(action)) {
      showNotice(message)
    } else {
      errorText.value = message
      emit('error', message)
    }
    return
  }
  const status = { ...result.status, __loading: !loaded.value }
  emit('status', status)
  applyStatusResult(result)
  // Keep the transport button deterministic immediately after an accepted
  // command. Native property-change delivery is asynchronous and can briefly
  // return the previous pause state, especially through the Linux host.
  if (action === 'pause') paused.value = true
  else if (action === 'play') paused.value = false
  if (action === 'stop') clearFrame()
  return result
}

const formatTime = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0))
  const hour = Math.floor(safeSeconds / 3600)
  const minute = Math.floor((safeSeconds % 3600) / 60)
  const second = safeSeconds % 60
  return hour > 0
    ? `${hour}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
    : `${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
}

const handleSeekInput = (event: Event) => {
  revealControls()
  seeking.value = true
  position.value = Number((event.target as HTMLInputElement).value || 0)
}

const handleSeekChange = async (event: Event) => {
  const nextPosition = Number((event.target as HTMLInputElement).value || 0)
  position.value = nextPosition
  seeking.value = false
  await control('seek', nextPosition)
  scheduleControlsAutoHide()
}

const handleVolumeChange = async (event: Event) => {
  revealControls()
  const nextVolume = Number((event.target as HTMLInputElement).value || 0)
  volume.value = nextVolume
  await control('setVolume', nextVolume)
}

const handleSpeedChange = async (event: Event) => {
  revealControls()
  const nextSpeed = Number((event.target as HTMLSelectElement).value || 1)
  speed.value = nextSpeed
  await control('setSpeed', nextSpeed)
}

const setVideoProperty = async (property: string, value: string | number | boolean) => {
  await control('setVideoProperty', undefined, { property, propertyValue: value })
}

const handleAspectRatioChange = async (value: string) => {
  aspectRatio.value = value
  await setVideoProperty('video-aspect-override', value)
}

const handleCropRatioChange = async (value: string) => {
  cropRatio.value = value
  await setVideoProperty('video-crop', value)
}

const handleRotationChange = async (value: number) => {
  rotation.value = value
  await setVideoProperty('video-rotate', value)
}

const handleVideoToggle = async (event: Event, property: string, enabledValue: string, disabledValue: string) => {
  const enabled = (event.target as HTMLInputElement).checked
  if (property === 'hwdec') hardwareDecode.value = enabled
  if (property === 'deinterlace') deinterlace.value = enabled
  if (property === 'tone-mapping') hdrToneMapping.value = enabled
  let value = enabled ? enabledValue : disabledValue
  await setVideoProperty(property, value)
}

const updateVideoFilterValue = (event: Event, target: string) => {
  const value = Number((event.target as HTMLInputElement).value || 0)
  if (target === 'brightness') brightness.value = value
  if (target === 'contrast') contrast.value = value
  if (target === 'saturation') saturation.value = value
  if (target === 'gamma') gamma.value = value
  if (target === 'hue') hue.value = value
  return value
}

const handleVideoFilterChange = async (event: Event, property: string, target: string) => {
  const value = updateVideoFilterValue(event, target)
  await setVideoProperty(property, value)
}

const formatTrackLabel = (track: { id: number; title?: string; language?: string; codec?: string; external?: boolean }) => {
  return [track.title || track.language || `轨道 ${track.id}`, track.codec, track.external ? '外挂' : ''].filter(Boolean).join(' · ')
}

const handleAudioTrackChange = async (event: Event) => {
  revealControls()
  const nextTrackId = Number((event.target as HTMLSelectElement).value)
  audioTrackId.value = nextTrackId
  await control('setAudioTrack', nextTrackId)
}

const handleAudioDelayChange = async (event: Event) => {
  audioDelay.value = Number((event.target as HTMLInputElement).value || 0)
  await setVideoProperty('audio-delay', audioDelay.value)
}

const buildEqualizerFilter = () => equalizerBands.value
  .map((gain, index) => `equalizer=f=${equalizerFrequencies[index]}:g=${gain}`)
  .join(',')

const updateEqualizerBand = (event: Event, index: number) => {
  equalizerBands.value[index] = Number((event.target as HTMLInputElement).value || 0)
}

const handleEqualizerChange = async (event: Event, index: number) => {
  updateEqualizerBand(event, index)
  await setVideoProperty('af', buildEqualizerFilter())
}

const handleAddExternalAudio = () => {
  window.WebShowOpenDialogSync?.({
    title: '加载外置音频',
    buttonLabel: '加载',
    properties: ['openFile'],
    filters: [{ name: '音频文件', extensions: ['aac', 'ac3', 'flac', 'm4a', 'mka', 'mp3', 'ogg', 'wav', 'wma'] }]
  }, async (paths: string[] | undefined) => {
    const audioPath = paths?.[0]
    if (audioPath) await control('addAudio', undefined, { url: audioPath, title: audioPath.split('/').pop() || '外置音频' })
  })
}

const selectSubtitleTrack = async (nextId: number, secondary: boolean, primaryId = subtitleTrackId.value) => {
  const sequence = loadSequence
  manualSubtitleSelection = true
  for (const command of subtitleSelectionCommands(secondary, nextId, primaryId, secondarySubtitleTrackId.value)) {
    const result = command.secondary
      ? await control('setVideoProperty', undefined, { property: 'secondary-sid', propertyValue: command.id < 0 ? 'no' : command.id })
      : await control('setSubtitleTrack', command.id)
    if (!result?.ok || disposed || sequence !== loadSequence) return
    if (command.secondary) secondarySubtitleTrackId.value = command.id
    else subtitleTrackId.value = command.id
  }
}

const loadSubtitleFile = async (id: string, secondary: boolean) => {
  if (subtitleFileLoading.value || !props.resolveSubtitleFile) return
  const sequence = loadSequence
  subtitleFileLoading.value = true
  manualSubtitleSelection = true
  const primaryTrackId = subtitleTrackId.value
  try {
    const source = await props.resolveSubtitleFile(id)
    if (disposed || sequence !== loadSequence) return
    if (!source) throw new Error('未能获取字幕地址，请重试')
    // Reuse a track already loaded by automatic matching or an earlier selection.
    let track = subtitleTracks.value.find(item => item.external && item.title === source.title)
    if (!track) {
      const added = await control('addSubtitle', undefined, source)
      if (!added?.ok || disposed || sequence !== loadSequence) return
      const deadline = Date.now() + 3000
      while (!track && Date.now() < deadline) {
        await updateStatus()
        if (disposed || sequence !== loadSequence) return
        track = subtitleTracks.value.find(item => item.external && item.title === source.title)
        if (!track) await new Promise(resolve => window.setTimeout(resolve, 100))
      }
    }
    if (!track) throw new Error('字幕轨道尚未就绪，请重试')
    await selectSubtitleTrack(track.id, secondary, primaryTrackId)
  } catch (error) {
    if (!disposed && sequence === loadSequence) showNotice(error instanceof Error ? error.message : '加载字幕失败')
  } finally {
    if (sequence === loadSequence) subtitleFileLoading.value = false
  }
}

const handleSubtitleSelection = async (event: Event, secondary: boolean) => {
  if (subtitleFileLoading.value) return
  revealControls()
  manualSubtitleSelection = true
  const selectedValue = String((event.target as HTMLSelectElement).value || 'track:-1')
  if (selectedValue.startsWith('file:')) return loadSubtitleFile(selectedValue.slice(5), secondary)
  const sequence = loadSequence
  subtitleFileLoading.value = true
  try {
    await selectSubtitleTrack(Number(selectedValue.replace(/^track:/, '')), secondary)
  } finally {
    if (sequence === loadSequence) subtitleFileLoading.value = false
  }
}

const handleSubtitleTrackChange = (event: Event) => handleSubtitleSelection(event, false)
const handleSecondarySubtitleTrackChange = (event: Event) => handleSubtitleSelection(event, true)

const handleSubtitleBackgroundColorChange = (event: Event) => { subtitleBackgroundColor.value = (event.target as HTMLInputElement).value }

const handleAddExternalSubtitle = () => {
  window.WebShowOpenDialogSync?.({
    title: '加载外置字幕',
    buttonLabel: '加载',
    properties: ['openFile'],
    filters: [{ name: '字幕文件', extensions: ['ass', 'srt', 'ssa', 'sub', 'vtt'] }]
  }, async (paths: string[] | undefined) => {
    const subtitlePath = paths?.[0]
    if (subtitlePath) await control('addSubtitle', undefined, { url: subtitlePath, title: subtitlePath.split('/').pop() || '外置字幕' })
  })
}

const subtitlePositions = () => ({ primary: subtitleStyles.value[0].position, secondary: subtitleStyles.value[1].position })

const applySubtitleLayout = async () => {
  const sequence = loadSequence
  const positions = subtitlePositions()
  await setVideoProperty('secondary-sub-pos', positions.secondary)
  if (disposed || sequence !== loadSequence) return
  await setVideoProperty('sub-pos', positions.primary)
}

const applySubtitleStyle = async () => {
  for (const index of [0, 1]) {
    const style = subtitleStyles.value[index]
    const prefix = index === 0 ? 'sub' : 'secondary-sub'
    await setVideoProperty(`${prefix}-delay`, style.delay)
    await setVideoProperty(`${prefix}-pos`, style.position)
    await setVideoProperty(`${prefix}-scale`, style.scale)
    await setVideoProperty(`${prefix}-visibility`, usesTextOverlay(index) ? 'no' : 'yes')
  }
  await setVideoProperty('stretch-image-subs-to-screen', pgsAspectCorrection.value ? 'no' : 'yes')
}

watch([introSkipSeconds, introSkipEnabled], () => { introSkipped.value = false })
watch([outroSkipSeconds, outroSkipEnabled], () => { outroTriggered.value = false })

const handleIntroOutroSkip = () => {
  if (!loaded.value || paused.value || seeking.value) return
  if (introSkipEnabled.value && introSkipSeconds.value > 0 && !introSkipped.value && position.value >= 0 && position.value < Math.min(introSkipSeconds.value, Math.max(1, duration.value - 1))) {
    introSkipped.value = true
    void control('seek', introSkipSeconds.value)
    return
  }
  if (outroSkipEnabled.value && outroSkipSeconds.value > 0 && duration.value > 0 && !outroTriggered.value && position.value >= Math.max(0, duration.value - outroSkipSeconds.value)) {
    outroTriggered.value = true
    if (canPlayNext.value) emit('playlistNext')
    else void control('stop')
  }
}

const subtitleLanguages = [
  { code: 'zh-cn', name: '简体中文' },
  { code: 'en', name: 'English' },
  { code: 'zh-tw', name: '繁體中文' }
]

const toStringValue = (value: unknown) => typeof value === 'string' ? value : String(value ?? '')

const openSubtitleSearchModal = () => {
  const keyword = ref(props.title || '')
  const language = ref('zh-cn')
  const loadingResults = ref(false)
  const downloadingFileId = ref<number>()
  const error = ref('')
  const results = ref<SubtitleSearchResult[]>([])
  let modal: any

  const runSearch = async () => {
    if (!keyword.value.trim()) {
      results.value = []
      return
    }
    loadingResults.value = true
    error.value = ''
    try {
      results.value = await searchSubtitles(keyword.value, language.value)
      if (!results.value.length) message.warning('未找到相关字幕')
    } catch (err: any) {
      error.value = err?.message || '搜索字幕失败'
    } finally {
      loadingResults.value = false
    }
  }

  const loadSubtitle = async (subtitle: SubtitleSearchResult) => {
    loadingResults.value = true
    downloadingFileId.value = subtitle.fileId
    error.value = ''
    try {
      const detail = await getSubtitleDownload(subtitle.fileId)
      await control('addSubtitle', undefined, { url: detail.link, title: detail.fileName })
      modal?.close?.()
      message.success('字幕已加载')
    } catch (err: any) {
      error.value = err?.message || '下载字幕失败'
    } finally {
      loadingResults.value = false
      downloadingFileId.value = undefined
    }
  }

  const renderSubtitleRow = (subtitle: SubtitleSearchResult) => h('button', {
    class: 'mpv-subtitle-result-row',
    type: 'button',
    disabled: loadingResults.value,
    onClick: () => loadSubtitle(subtitle)
  }, [
    h('span', { class: 'mpv-subtitle-result-icon' }, '字幕'),
    h('span', { class: 'mpv-subtitle-result-copy' }, [
      h('span', { class: 'mpv-subtitle-result-title' }, subtitle.name),
      h('span', { class: 'mpv-subtitle-result-meta' }, `${subtitle.language} · 下载 ${formatSubtitleDownloadCount(subtitle.downloadCount)}`)
    ]),
    h('span', { class: 'mpv-subtitle-result-arrow' }, downloadingFileId.value === subtitle.fileId ? '加载中' : '加载')
  ])

  const renderContent = () => {
    if (loadingResults.value && !results.value.length) return h('div', { class: 'mpv-subtitle-empty' }, '搜索中...')
    if (error.value) return h('div', { class: 'mpv-subtitle-empty' }, error.value)
    if (!results.value.length) return h('div', { class: 'mpv-subtitle-empty' }, keyword.value.trim() ? '未找到相关字幕' : '请输入搜索关键词')
    return results.value.map(renderSubtitleRow)
  }

  modal = Modal.open({
    title: '',
    width: 860,
    hideTitle: true,
    closable: false,
    footer: false,
    maskClosable: true,
    modalClass: 'mpv-subtitle-search-modal',
    bodyClass: 'mpv-subtitle-search-modal-body',
    onOpen: runSearch,
    content: () => h('div', { class: 'mpv-subtitle-modal' }, [
      h('div', { class: 'mpv-subtitle-modal-header' }, [
        h('button', { class: 'mpv-subtitle-modal-close', type: 'button', onClick: () => modal?.close?.() }, '×'),
        h('div', { class: 'mpv-subtitle-modal-heading' }, [
          h('div', { class: 'mpv-subtitle-modal-title' }, '在线字幕搜索'),
          h('div', { class: 'mpv-subtitle-modal-subtitle' }, '按片名或 TMDB ID 查找并加载字幕')
        ])
      ]),
      h('div', { class: 'mpv-subtitle-modal-searchbar' }, [
        h(Select, {
          class: 'mpv-subtitle-language-select',
          modelValue: language.value,
          triggerProps: { autoFitPopupMinWidth: true },
          'onUpdate:modelValue': (value: unknown) => {
            language.value = toStringValue(value)
            if (keyword.value.trim()) void runSearch()
          }
        }, () => subtitleLanguages.map((item) => h(AOption, { value: item.code }, () => item.name))),
        h(Input, {
          class: 'mpv-subtitle-search-input',
          modelValue: keyword.value,
          placeholder: '搜索字幕或输入 TMDB ID',
          onInput: (value: string) => { keyword.value = value },
          'onUpdate:modelValue': (value: string) => { keyword.value = value },
          onPressEnter: runSearch
        }),
        h(Button, {
          class: 'mpv-subtitle-search-button',
          disabled: loadingResults.value,
          loading: loadingResults.value,
          type: 'primary',
          onClick: runSearch
        }, () => '搜索')
      ]),
      h('div', { class: 'mpv-subtitle-result-shell' }, [
        h('div', { class: 'mpv-subtitle-result-toolbar' }, [
          h('span', {}, loadingResults.value ? '正在搜索' : results.value.length ? `找到 ${results.value.length} 个字幕` : '搜索结果'),
          h('span', {}, subtitleLanguages.find(item => item.code === language.value)?.name || '')
        ]),
        h('div', { class: 'mpv-subtitle-result-list' }, renderContent())
      ])
    ])
  })
}

const handleQualityChange = (event: Event) => {
  revealControls()
  const quality = String((event.target as HTMLSelectElement).value || '')
  if (quality) emit('qualitySelect', quality)
}

onMounted(async () => {
  if (seekProgress.value) seekPreview = new SeekThumbnailPreview(seekProgress.value,
    () => ({ url: props.url, headers: props.headers, duration: duration.value }))
  danmakuFrame = requestAnimationFrame(tickDanmaku)
  window.WebMpvSharedTexture?.onFrame?.(drawFrame)
  window.WebMpvSharedTexture?.onSoftwareFrame?.(drawSoftwareFrame)
  window.WebMpvSharedTexture?.onClear?.(clearFrame)
  window.WebMpvSharedTexture?.onStatus?.(acceptStatus)
  statusTimer = window.setInterval(() => {
    void updateStatus()
  }, 1000)
  await load()
})

onBeforeUnmount(() => {
  closePictureInPicture()
  seekPreview?.dispose()
  cancelAnimationFrame(danmakuFrame)
  disposed = true
  loadSequence = playbackSession.begin()
  window.WebMpvSharedTexture?.removeStatusListener?.()
  if (statusTimer != null) window.clearInterval(statusTimer)
  statusTimer = null
  if (noticeTimer != null) window.clearTimeout(noticeTimer)
  noticeTimer = null
  clearControlsHideTimer()
  window.WebMpvSharedTexture?.removeFrameListener?.()
  window.WebMpvSharedTexture?.removeSoftwareFrameListener?.()
  window.WebMpvSharedTexture?.removeClearListener?.()
  void control('stop')
  destroyWebGL()
  softwareSourceCanvas = null
  softwareSourceContext = null
})

watch(() => props.url, () => {
  revealControls()
  void load()
})

watch([paused, loading, errorText, seeking], () => {
  if (isControlsPinned()) controlsVisible.value = true
})

watch([dualSubtitles, secondarySubtitleLines, subtitlePosition, subtitleScale], () => {
  if (props.url && !disposed) void applySubtitleLayout()
})

watch([subtitleStyles, pgsAspectCorrection], () => {
  localStorage.setItem('playbackSubtitleStyles', JSON.stringify(subtitleStyles.value))
  localStorage.setItem('playbackPgsAspectCorrection', String(pgsAspectCorrection.value))
  void applySubtitleStyle()
}, { deep: true })
watch([subtitleTrackId, secondarySubtitleTrackId], () => { void applySubtitleStyle() })

watch(() => props.subtitleSources, () => {
  if (!props.url || !loaded.value || disposed) return
  void addAutomaticSubtitles(loadSequence)
}, { deep: true })

watch(chapters, (nextChapters) => {
  if (!nextChapters.length && playlistTab.value === 'chapters') playlistTab.value = 'playlist'
})
</script>

<template>
  <div class="mpv-embedded-surface" :class="{ 'controls-hidden': !shouldShowControls, 'panel-open': playlistOpen || settingsOpen }" tabindex="0" @keydown="revealControls" @mousedown="revealControls" @mouseleave="handleSurfacePointerLeave" @mousemove="handleSurfacePointerMove" @touchstart="revealControls">
    <canvas ref="canvasRef" class="mpv-embedded-canvas" :class="{ 'mpv-render-hidden': renderMode === 'fallback' }" />
    <canvas ref="fallbackCanvasRef" class="mpv-embedded-canvas mpv-fallback-canvas" :class="{ 'mpv-render-visible': renderMode === 'fallback' }" />
    <div class="mpv-live-danmaku" aria-hidden="true"><span v-for="comment in activeDanmaku" :key="comment.id" :style="comment.style">{{ comment.text }}</span></div>
    <div v-for="index in [0, 1]" v-show="usesTextOverlay(index) && displaySubtitleText(index)" :key="`text-sub-${index}`" class="mpv-live-subtitle" :style="overlaySubtitleStyle(index)">{{ displaySubtitleText(index) }}</div>
    <div v-if="isBuffering || errorText" class="mpv-embedded-overlay">
      <div v-if="isBuffering" class="mpv-embedded-loading">
        <span class="mpv-embedded-spinner"></span>
        <span>正在加载视频</span>
      </div>
      <div v-else-if="errorText" class="mpv-embedded-error">{{ errorText }}</div>
    </div>
    <div v-if="noticeText" class="mpv-embedded-notice">{{ noticeText }}</div>
    <MpvSkipIntroOutroDialog v-if="skipDialogOpen" v-model:intro-enabled="introSkipEnabled" v-model:outro-enabled="outroSkipEnabled" v-model:intro-seconds="introSkipSeconds" v-model:outro-seconds="outroSkipSeconds" :position="position" :duration="duration" @close="skipDialogOpen = false" />
    <div class="mpv-embedded-gradient"></div>
    <div v-if="optionsOpen || volumeOpen" class="mpv-menu-dismiss" @click="optionsOpen = false; volumeOpen = false"></div>
    <div class="mpv-embedded-controls" @mouseenter="handleControlsEnter" @mouseleave="handleControlsLeave">
      <div class="mpv-control-panel">
        <div class="mpv-control-row">
          <div class="mpv-volume-anchor">
            <button class="mpv-icon-btn" aria-label="音量" title="音量" :aria-expanded="volumeOpen" type="button" @click="volumeOpen = !volumeOpen"><VolumeX v-if="volume === 0" :size="21" /><Volume2 v-else :size="21" /></button>
            <label v-if="volumeOpen" class="mpv-volume-popover">
              <span>音量 {{ Math.round(volume) }}%</span>
              <input aria-label="音量" max="100" min="0" step="1" type="range" :value="volume" @input="handleVolumeChange" />
            </label>
          </div>
          <div class="mpv-transport-buttons">
            <button class="mpv-icon-btn" :disabled="!canPlayPrevious" title="上一个" aria-label="上一个" type="button" @click="emit('playlistPrev')"><SkipBack :size="21" fill="currentColor" /></button>
            <button class="mpv-icon-btn" :disabled="duration <= 0" title="后退 10 秒" aria-label="后退 10 秒" type="button" @click="control('seek', Math.max(0, position - 10))"><RotateCcw :size="23" /></button>
            <button class="mpv-icon-btn mpv-play-btn" :title="playButtonLabel" :aria-label="playButtonLabel" type="button" @click="control(paused ? 'play' : 'pause')">
              <Pause v-if="!paused" :size="22" fill="currentColor" /><Play v-else :size="22" fill="currentColor" />
            </button>
            <button class="mpv-icon-btn" :disabled="duration <= 0" title="快进 10 秒" aria-label="快进 10 秒" type="button" @click="control('seek', Math.min(duration, position + 10))"><RotateCw :size="23" /></button>
            <button class="mpv-icon-btn" :disabled="!canPlayNext" title="下一个" aria-label="下一个" type="button" @click="emit('playlistNext')"><SkipForward :size="21" fill="currentColor" /></button>
          </div>
          <div class="mpv-window-actions">
            <button class="mpv-icon-btn" :class="{ active: optionsOpen }" title="播放选项" aria-label="播放选项" :aria-expanded="optionsOpen" type="button" @click="optionsOpen = !optionsOpen; quickMenu = null; volumeOpen = false"><Settings :size="21" /></button>
            <button class="mpv-icon-btn" title="画中画" aria-label="画中画" type="button" @click="togglePictureInPicture"><PictureInPicture2 :size="23" /></button>
            <button class="mpv-icon-btn" title="全屏" aria-label="全屏" type="button" @click="toggleFullscreen"><Maximize2 :size="23" /></button>
          </div>
          <div v-if="optionsOpen" class="mpv-options-menu" @keydown.esc.stop="quickMenu ? quickMenu = null : optionsOpen = false">
            <template v-if="quickMenu === 'speed' || quickMenu === 'aspect'">
              <button class="mpv-menu-back" type="button" @click="quickMenu = null"><ChevronRight class="mpv-back-chevron" :size="17" /><span>{{ quickMenu === 'speed' ? '播放速度' : '画面比例' }}</span></button>
              <div class="mpv-choice-menu" :class="{ 'mpv-speed-menu': quickMenu === 'speed' }" role="menu" :aria-label="quickMenu === 'speed' ? '播放速度' : '画面比例'">
                <template v-if="quickMenu === 'speed'">
                  <button v-for="option in speedOptions" :key="option" role="menuitemradio" :aria-checked="speed === option" :class="{ active: speed === option }" type="button" @click="speed = option; control('setSpeed', option); optionsOpen = false; quickMenu = null"><span>{{ option }}×</span><Check v-if="speed === option" :size="16" /></button>
                </template>
                <template v-else>
                  <button v-for="option in aspectOptions" :key="option.value" role="menuitemradio" :aria-checked="aspectRatio === option.value" :class="{ active: aspectRatio === option.value }" type="button" @click="handleAspectRatioChange(option.value); optionsOpen = false; quickMenu = null"><span>{{ option.label }}</span><Check v-if="aspectRatio === option.value" :size="16" /></button>
                </template>
              </div>
            </template>
            <template v-else>
            <button type="button" @click="openSettingsTab('video')"><Settings :size="17" /><span>播放设置</span></button>
            <button type="button" @click="openSettingsTab('subtitle')"><Captions :size="17" /><span>字幕</span><ChevronRight :size="17" /></button>
            <button v-if="danmakuPreferences.danmakuEnabled" type="button" @click="openSettingsTab('danmaku')"><MessageSquare :size="17" /><span>弹幕</span><ChevronRight :size="17" /></button>
            <button type="button" @click="quickMenu = 'speed'"><Gauge :size="17" /><span>播放速度</span><ChevronRight :size="17" /></button>

            <button type="button" @click="quickMenu = 'aspect'"><RectangleHorizontal :size="17" /><span>画面比例</span><ChevronRight :size="17" /></button>

            <button type="button" @click="openSkipDialog"><Flag :size="17" /><span>跳过片头片尾</span></button>
            <button v-if="(props.playlist || []).length > 0 || chapters.length" type="button" @click="optionsOpen = false; togglePlaylist()"><ListVideo :size="17" /><span>播放列表与章节</span><ChevronRight :size="17" /></button>
            </template>
          </div>
        </div>

        <div class="mpv-progress-row">
          <span class="mpv-time mpv-time-current">{{ formatTime(position) }}</span>
          <input ref="seekProgress" class="mpv-embedded-progress" aria-label="播放进度" type="range" min="0" :max="Math.max(duration, 1)" step="0.1" :style="{ '--mpv-progress': progressPercent, '--mpv-buffered': bufferedPercent }" :value="position" @change="handleSeekChange" @input="handleSeekInput" />
          <span class="mpv-time">−{{ formatTime(Math.max(0, duration - position)) }}</span>
        </div>
      </div>
    </div>

      <aside v-if="playlistOpen || settingsOpen" :class="['mpv-side-panel', playlistOpen ? 'mpv-playlist-panel' : '']">
        <template v-if="playlistOpen">
          <div class="mpv-playlist-tabs">
            <button :class="{ active: playlistTab === 'playlist' }" type="button" @click="playlistTab = 'playlist'">播放列表</button>
            <button :class="{ active: playlistTab === 'chapters' }" type="button" @click="playlistTab = 'chapters'">章节</button>
          </div>
          <div v-if="playlistTab === 'playlist'" class="mpv-playlist-menu mpv-side-panel-list">
            <button
              v-for="(item, index) in props.playlist"
              :key="item.file_id || index"
              class="mpv-playlist-menu-item"
              :class="{ active: item.file_id === props.currentFileId }"
              type="button"
              @click="item.file_id && emit('playlistSelect', item.file_id)"
            >
              <span class="mpv-playlist-index">{{ item.file_id === props.currentFileId ? '▶' : String(index + 1).padStart(2, '0') }}</span>
              <strong>{{ item.html || item.name || item.file_id }}</strong>
              <small></small>
            </button>
            <div v-if="!(props.playlist || []).length" class="mpv-side-empty">暂无播放列表</div>
          </div>
          <div v-else class="mpv-playlist-menu mpv-side-panel-list mpv-chapter-list">
            <button
              v-for="(chapter, index) in chapters"
              :key="`${chapter.start}-${index}`"
              class="mpv-playlist-menu-item mpv-chapter-menu-item"
              :class="{ active: currentChapterIndex === index }"
              type="button"
              @click="selectChapter(chapter.start)"
            >
              <span class="mpv-playlist-index">{{ formatTime(chapter.start) }}</span>
              <strong>{{ chapter.title || `章节 ${index + 1}` }}</strong>
              <small>{{ Number.isFinite(chapter.end) && chapter.end > chapter.start ? formatTime(chapter.end) : '' }}</small>
            </button>
            <div v-if="!chapters.length" class="mpv-side-empty">此媒体没有章节信息</div>
          </div>
          <div v-if="playlistTab === 'playlist'" class="mpv-playlist-footer">
            <span>↻</span>
            <span>⤨</span>
            <span>↕</span>
            <small>总计 {{ (props.playlist || []).length }} 项</small>
            <span class="mpv-playlist-footer-spacer"></span>
            <span>＋</span>
            <span>−</span>
            <span>⌫</span>
          </div>
        </template>

        <template v-else>
          <div class="mpv-side-panel-header">
            <div>
              <span class="mpv-side-panel-kicker">VIDEO SETTINGS</span>
              <strong>{{ settingsTab === 'danmaku' ? '弹幕设置' : settingsTab === 'subtitle' ? '字幕设置' : '播放设置' }}</strong>
            </div>
            <button class="mpv-side-close" type="button" aria-label="关闭设置" @click="settingsOpen = false">×</button>
          </div>
          <div class="mpv-settings-tabs">
            <button :class="{ active: settingsTab === 'video' }" type="button" @click="settingsTab = 'video'">视频</button>
            <button :class="{ active: settingsTab === 'audio' }" type="button" @click="settingsTab = 'audio'">音频</button>
            <button :class="{ active: settingsTab === 'subtitle' }" type="button" @click="settingsTab = 'subtitle'">字幕</button>
            <button v-if="danmakuPreferences.danmakuEnabled" :class="{ active: settingsTab === 'danmaku' }" type="button" @click="settingsTab = 'danmaku'">弹幕</button>
          </div>

          <div v-if="settingsTab === 'video'" class="mpv-side-settings-content">
            <section class="mpv-side-section">
              <span class="mpv-side-label">视频轨道</span>
              <div v-if="videoTracks.length" class="mpv-track-list">
                <div v-for="track in videoTracks" :key="`video-${track.id}`" class="mpv-track-row">
                  <span class="mpv-track-dot"></span>
                  <strong>{{ formatTrackLabel(track) }}</strong>
                </div>
              </div>
              <div v-else class="mpv-side-empty">由 MPV 自动选择最佳视频轨道</div>
            </section>
            <section class="mpv-side-section">
              <span class="mpv-side-label">宽高比</span>
              <select class="mpv-side-choice" aria-label="画面比例" :value="aspectRatio" @change="handleAspectRatioChange(($event.target as HTMLSelectElement).value)"><option v-for="option in aspectOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select>
            </section>
            <section class="mpv-side-section">
              <span class="mpv-side-label">裁剪</span>
              <select class="mpv-side-choice" aria-label="裁剪" :value="cropRatio" @change="handleCropRatioChange(($event.target as HTMLSelectElement).value)"><option v-for="option in cropOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select>
            </section>
            <section class="mpv-side-section">
              <span class="mpv-side-label">旋转</span>
              <div class="mpv-option-grid mpv-rotation-grid">
                <button v-for="option in rotationOptions" :key="`rotate-${option}`" :class="{ active: rotation === option }" type="button" @click="handleRotationChange(option)">{{ option }}°</button>
              </div>
            </section>
            <section class="mpv-side-section">
              <span class="mpv-side-label">播放</span>
              <label class="mpv-side-select-row"><span>速度</span><select :value="speed" aria-label="倍速" @change="handleSpeedChange"><option v-for="option in speedOptions" :key="option" :value="option">{{ option }}x</option></select></label>
              <label v-if="qualityOptions.length > 1" class="mpv-side-select-row"><span>清晰度</span><select v-if="qualityOptions.length > 1" :value="props.currentQuality" aria-label="清晰度" @change="handleQualityChange"><option v-for="item in qualityOptions" :key="item.quality || item.html || item.name" :value="item.quality">{{ item.html || item.name || item.label || item.quality }}</option></select><b v-else>{{ qualityLabel }}</b></label>
            </section>
            <section class="mpv-side-section">
              <span class="mpv-side-label">视频处理</span>
              <label class="mpv-side-toggle-row"><span>硬件解码</span><input :checked="hardwareDecode" type="checkbox" @change="handleVideoToggle($event, 'hwdec', 'auto', 'no')" /></label>
              <label class="mpv-side-toggle-row"><span>反交错</span><input :checked="deinterlace" type="checkbox" @change="handleVideoToggle($event, 'deinterlace', 'yes', 'no')" /></label>
              <label class="mpv-side-toggle-row"><span>HDR 色调映射</span><input :checked="hdrToneMapping" type="checkbox" @change="handleVideoToggle($event, 'tone-mapping', 'auto', 'clip')" /></label>
            </section>
            <section class="mpv-side-section">
              <span class="mpv-side-label">均衡器</span>
              <label v-for="item in [{ label: '亮度', property: 'brightness', state: 'brightness' }, { label: '对比度', property: 'contrast', state: 'contrast' }, { label: '饱和度', property: 'saturation', state: 'saturation' }, { label: '伽马', property: 'gamma', state: 'gamma' }, { label: '色调', property: 'hue', state: 'hue' }]" :key="item.property" class="mpv-side-slider mpv-video-filter-row">
                <span>{{ item.label }} <b>{{ item.state === 'brightness' ? brightness : item.state === 'contrast' ? contrast : item.state === 'saturation' ? saturation : item.state === 'gamma' ? gamma : hue }}</b></span>
                <input :aria-label="item.label" :value="item.state === 'brightness' ? brightness : item.state === 'contrast' ? contrast : item.state === 'saturation' ? saturation : item.state === 'gamma' ? gamma : hue" max="100" min="-100" step="1" type="range" @input="updateVideoFilterValue($event, item.state)" @change="handleVideoFilterChange($event, item.property, item.state)" />
              </label>
            </section>
            <section class="mpv-side-section">
              <span class="mpv-side-label">片头 / 片尾</span>
              <button class="mpv-side-action" type="button" @click="openSkipDialog"><Flag :size="15" />跳过片头片尾设置</button>
            </section>
          </div>

          <div v-else-if="settingsTab === 'audio'" class="mpv-side-settings-content">
            <section class="mpv-side-section">
              <span class="mpv-side-label">音频轨道</span>
              <label class="mpv-side-select-row"><span>音轨</span><select :value="audioTrackId" title="音轨" @change="handleAudioTrackChange"><option value="-1">关闭音频</option><option v-for="track in audioTracks" :key="`audio-${track.id}`" :value="track.id">{{ formatTrackLabel(track) }}</option></select></label>
              <button class="mpv-side-action" type="button" @click="handleAddExternalAudio">加载外置音频…</button>
            </section>
            <section class="mpv-side-section">
              <span class="mpv-side-label">音频延迟</span>
              <label class="mpv-side-slider"><span><b>{{ audioDelay.toFixed(1) }}s</b><b>-5s　0s　+5s</b></span><input :value="audioDelay" max="5" min="-5" step="0.1" type="range" @change="handleAudioDelayChange" /></label>
            </section>
            <section class="mpv-side-section mpv-equalizer-section">
              <div class="mpv-equalizer-heading"><span class="mpv-side-label">均衡器</span><b>+12 dB　0 dB　-12 dB</b></div>
              <div class="mpv-equalizer-grid">
                <label v-for="(frequency, index) in equalizerFrequencies" :key="frequency" class="mpv-equalizer-band">
                  <input :aria-label="`${frequency} Hz 增益`" :aria-valuetext="`${equalizerBands[index]} dB`" :value="equalizerBands[index]" max="12" min="-12" step="1" type="range" @input="updateEqualizerBand($event, index)" @change="handleEqualizerChange($event, index)" />
                  <span>{{ frequency >= 1000 ? `${frequency / 1000}k` : frequency }}</span>
                </label>
              </div>
            </section>
          </div>

          <div v-else-if="settingsTab === 'subtitle'" class="mpv-side-settings-content">
            <section class="mpv-side-section">
              <span class="mpv-side-label">播放调整</span>
              <PlaybackSubtitleNumberRow label="延迟显示[主]" :value="subtitleDelay" :min="-100" :max="100" :step="0.1" :digits="1" unit="s" editable @change="subtitleDelay = $event" />
              <PlaybackSubtitleNumberRow label="垂直偏移" :value="100 - subtitlePosition" :min="0" :max="100" :step="1" @change="subtitlePosition = 100 - $event" />
              <PlaybackSubtitleNumberRow label="大小缩放[主]" :value="subtitleScale * 100" :min="25" :max="300" :step="5" unit="%" @change="subtitleScale = $event / 100" />
              <PlaybackSubtitleNumberRow label="不透明度" :disabled="isBitmapSubtitle(0)" :value="primarySubtitleStyle.opacity * 100" :min="0" :max="100" :step="5" unit="%" @change="primarySubtitleStyle.opacity = $event / 100" />
              <label class="mpv-side-select-row"><span>简繁中文转换</span><select :disabled="isBitmapSubtitle(0)" v-model.number="primarySubtitleStyle.conversion" aria-label="简繁中文转换"><option :value="0">禁用</option><option :value="1">转为简体</option><option :value="2">转为繁体</option></select></label>
              <label class="mpv-side-select-row"><span>PGS 字幕比例修正</span><input v-model="pgsAspectCorrection" type="checkbox" /></label>
            </section>
            <section class="mpv-side-section">
              <span class="mpv-side-label">自定义样式</span>
              <label class="mpv-side-select-row"><span>使用自定义样式</span><input v-model="customSubtitleEnabled" type="checkbox" /></label>
              <template v-if="customSubtitleEnabled">
                <div class="mpv-subtitle-mode-tabs"><button :class="{ active: subtitleStyleIndex === 0 }" type="button" @click="subtitleStyleIndex = 0">主字幕</button><button :class="{ active: subtitleStyleIndex === 1 }" type="button" @click="subtitleStyleIndex = 1">副字幕</button></div>
                <fieldset :disabled="isBitmapSubtitle(subtitleStyleIndex)" class="mpv-subtitle-custom-fields">
                  <label class="mpv-side-select-row"><span>字体</span><select v-model="selectedSubtitleStyle.font" aria-label="字体"><option value="sans-serif">系统字体</option><option value="serif">衬线</option><option value="monospace">等宽</option></select></label>
                  <label class="mpv-side-select-row"><span>加粗</span><input v-model="selectedSubtitleStyle.bold" type="checkbox" /></label>
                  <label class="mpv-side-select-row"><span>斜体</span><input v-model="selectedSubtitleStyle.italic" type="checkbox" /></label>
                  <label class="mpv-side-select-row"><span>字体颜色</span><input v-model="selectedSubtitleStyle.color" type="color" /></label>
                  <label class="mpv-side-select-row"><span>背景颜色</span><input :value="selectedSubtitleStyle.background.slice(0, 7)" type="color" @change="handleSubtitleBackgroundColorChange" /></label>
                  <label class="mpv-side-select-row"><span>描边颜色</span><input v-model="selectedSubtitleStyle.border" type="color" /></label>
                  <PlaybackSubtitleNumberRow label="描边大小" :value="selectedSubtitleStyle.borderSize" :min="0" :max="10" :step="0.1" :digits="1" @change="selectedSubtitleStyle.borderSize = $event" />
                  <label class="mpv-side-select-row"><span>阴影颜色</span><input v-model="selectedSubtitleStyle.shadow" type="color" /></label>
                  <PlaybackSubtitleNumberRow label="阴影大小" :value="selectedSubtitleStyle.shadowSize" :min="0" :max="10" :step="0.1" :digits="1" @change="selectedSubtitleStyle.shadowSize = $event" />
                </fieldset>
                <p v-if="isBitmapSubtitle(subtitleStyleIndex)" class="mpv-side-empty">位图字幕保留原始图像，无法更改文字样式。</p>
                <button class="mpv-side-action" type="button" @click="subtitleStyles[subtitleStyleIndex] = { ...defaultSubtitleStyle(subtitleStyleIndex === 1), custom: true, delay: selectedSubtitleStyle.delay, position: selectedSubtitleStyle.position, scale: selectedSubtitleStyle.scale, opacity: selectedSubtitleStyle.opacity, conversion: selectedSubtitleStyle.conversion }">恢复默认样式</button>
              </template>
            </section>
            <section class="mpv-side-section">
              <span class="mpv-side-label">字幕轨道</span>
              <label class="mpv-side-select-row"><span>字幕</span><select :disabled="subtitleFileLoading" :value="subtitleSelectValue" title="字幕" @change="handleSubtitleTrackChange"><option value="track:-1">关闭字幕</option><option v-for="track in subtitleTracks" :key="`sub-${track.id}`" :value="`track:${track.id}`">{{ formatTrackLabel(track) }}</option><optgroup v-if="unloadedSubtitleFiles.length" label="网盘字幕"><option v-for="file in unloadedSubtitleFiles" :key="file.id" :value="`file:${file.id}`">{{ file.title }}</option></optgroup></select></label>
              <label class="mpv-side-select-row"><span>副字幕</span><select :disabled="subtitleFileLoading" :value="secondarySubtitleSelectValue" title="副字幕" @change="handleSecondarySubtitleTrackChange"><option value="track:-1">关闭副字幕</option><option v-for="track in subtitleTracks" :key="`secondary-sub-${track.id}`" :value="`track:${track.id}`">{{ formatTrackLabel(track) }}</option><optgroup v-if="unloadedSubtitleFiles.length" label="网盘字幕"><option v-for="file in unloadedSubtitleFiles" :key="file.id" :value="`file:${file.id}`">{{ file.title }}</option></optgroup></select></label>
              <div v-if="subtitleFileLoading" class="mpv-side-empty" role="status">正在加载字幕…</div>
              <div class="mpv-side-action-row"><button class="mpv-side-action" type="button" @click="handleAddExternalSubtitle">加载字幕…</button><button class="mpv-side-action" type="button" @click="openSubtitleSearchModal"><Captions :size="15" /> 在线查找</button></div>
            </section>

          </div>
          <div v-else class="mpv-side-section">
            <button class="mpv-side-action" type="button" :disabled="danmakuLoading" @click="matchPlaybackDanmaku"><Search :size="15" />{{ danmakuLoading ? '正在匹配弹幕…' : '匹配当前视频弹幕' }}</button>
            <PlaybackDanmakuSettings />

          </div>
        </template>
      </aside>
  </div>
</template>

<style scoped lang="less">
.mpv-live-danmaku { position: absolute; inset: 0; z-index: 2; overflow: hidden; pointer-events: none; }
.mpv-live-danmaku span { position: absolute; white-space: nowrap; line-height: 1.4; font-weight: 600; }

.mpv-subtitle-custom-fields { border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: 12px; }
.mpv-live-subtitle {
  position: absolute; left: 5%; width: 90%; z-index: 3;
  white-space: pre-wrap; text-align: center; pointer-events: none; line-height: 1.25;
}

.mpv-embedded-surface {
  container-type: size;
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
  outline: none;
  cursor: default;
}

.mpv-embedded-surface.controls-hidden {
  cursor: none;
}

.mpv-embedded-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.mpv-render-hidden {
  visibility: hidden;
}

.mpv-fallback-canvas {
  visibility: hidden;
}

.mpv-fallback-canvas.mpv-render-visible {
  visibility: visible;
}

.mpv-embedded-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 2;
}

.mpv-embedded-loading,
.mpv-embedded-error {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(255, 255, 255, .12);
  border-radius: 999px;
  padding: 10px 16px;
  background: rgba(12, 15, 22, .72);
  box-shadow: 0 18px 50px rgba(0, 0, 0, .38);
  color: rgba(255, 255, 255, .82);
  font-size: 13px;
  font-weight: 600;
  backdrop-filter: blur(18px);
}

.mpv-embedded-error {
  max-width: min(760px, 80vw);
  border-color: rgba(255, 104, 104, .28);
  color: rgba(255, 210, 210, .92);
}

.mpv-embedded-notice {
  position: absolute;
  left: 50%;
  top: 68px;
  z-index: 4;
  border: 1px solid rgba(122, 255, 170, .22);
  border-radius: 999px;
  padding: 10px 18px;
  background: rgba(12, 16, 22, .88);
  box-shadow: 0 14px 36px rgba(0, 0, 0, .36), inset 0 1px 0 rgba(255, 255, 255, .08);
  color: rgba(232, 255, 239, .96);
  font-size: 13px;
  font-weight: 900;
  transform: translateX(-50%);
}

.mpv-embedded-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, .18);
  border-top-color: rgba(130, 190, 255, .96);
  border-radius: 50%;
  animation: mpv-spin .8s linear infinite;
}

.mpv-embedded-gradient {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 210px;
  background: linear-gradient(to top, rgba(0, 0, 0, .86), rgba(0, 0, 0, .48) 48%, rgba(0, 0, 0, .08) 82%, transparent);
  pointer-events: none;
  z-index: 1;
  opacity: 1;
  transition: opacity .24s ease;
}

.mpv-embedded-controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 22px 18px;
  color: rgba(255, 255, 255, .82);
  z-index: 3;
  opacity: 1;
  transform: translateY(0);
  transition: opacity .24s ease, transform .24s ease;
  will-change: opacity, transform;
}

.mpv-embedded-surface.controls-hidden .mpv-embedded-gradient {
  opacity: 0;
}

.mpv-embedded-surface.controls-hidden .mpv-embedded-controls {
  opacity: 0;
  transform: translateY(22px);
  pointer-events: none;
}

.mpv-control-bar {
  display: grid;
  grid-template-columns: 188px minmax(260px, 1fr) 138px;
  gap: 12px;
  align-items: stretch;
  border: 1px solid rgba(255, 255, 255, .16);
  border-radius: 20px;
  padding: 12px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, .12), rgba(255, 255, 255, 0) 32%),
    repeating-linear-gradient(90deg, rgba(255, 255, 255, .024) 0, rgba(255, 255, 255, .024) 1px, transparent 1px, transparent 5px),
    linear-gradient(180deg, rgba(31, 35, 41, .95), rgba(9, 11, 15, .94));
  box-shadow:
    0 26px 70px rgba(0, 0, 0, .58),
    inset 0 1px 0 rgba(255, 255, 255, .16),
    inset 0 -1px 0 rgba(0, 0, 0, .7);
  backdrop-filter: blur(18px);
}

.mpv-hardware-rail,
.mpv-display-module,
.mpv-volume-deck,
.mpv-transport-deck {
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(16, 18, 22, .82), rgba(4, 5, 7, .72));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .08), inset 0 -10px 28px rgba(0, 0, 0, .28);
}

.mpv-hardware-rail {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 14px;
  padding: 14px;
}

.mpv-brand-block {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mpv-brand-block strong {
  display: block;
  color: rgba(255, 255, 255, .9);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  letter-spacing: .08em;
}

.mpv-brand-block small {
  display: block;
  margin-top: 3px;
  color: rgba(255, 255, 255, .38);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  letter-spacing: .11em;
}

.mpv-brand-dot {
  width: 12px;
  height: 12px;
  border: 1px solid rgba(255, 255, 255, .25);
  border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, rgba(255, 255, 255, .7), rgba(82, 90, 101, .85) 38%, rgba(16, 18, 22, .9) 70%);
  box-shadow: inset 0 -1px 4px rgba(0, 0, 0, .8);
}

.mpv-brand-dot.active {
  border-color: rgba(135, 244, 172, .42);
  background: radial-gradient(circle at 40% 35%, #e9ffe8, #7cf89b 34%, #18713a 72%);
  box-shadow: 0 0 16px rgba(104, 255, 147, .5), inset 0 -1px 4px rgba(0, 0, 0, .5);
}

.mpv-signal-bank {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.mpv-signal-bank span {
  display: inline-flex;
  height: 20px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 5px;
  background: rgba(255, 255, 255, .045);
  color: rgba(255, 255, 255, .34);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .09em;
}

.mpv-signal-bank span.active {
  border-color: rgba(125, 238, 159, .32);
  background: rgba(72, 255, 136, .11);
  color: rgba(176, 255, 188, .96);
  text-shadow: 0 0 9px rgba(106, 255, 142, .58);
}

.mpv-display-module {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  padding: 12px;
}

.mpv-display-readout {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: center;
  min-height: 42px;
  border: 1px solid rgba(104, 255, 178, .14);
  border-radius: 9px;
  padding: 9px 12px;
  background:
    linear-gradient(rgba(139, 255, 190, .035) 50%, rgba(0, 0, 0, 0) 50%),
    radial-gradient(circle at top left, rgba(98, 255, 166, .12), transparent 36%),
    #07100c;
  background-size: 100% 4px, auto, auto;
  color: rgba(175, 255, 202, .9);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  box-shadow: inset 0 0 24px rgba(10, 0, 0, .58), 0 0 18px rgba(77, 255, 146, .08);
}

.mpv-display-readout strong {
  justify-self: center;
  color: rgba(184, 255, 207, .98);
  font-size: 20px;
  font-weight: 800;
  letter-spacing: .06em;
  text-shadow: 0 0 12px rgba(107, 255, 155, .38);
  white-space: nowrap;
}

.mpv-display-readout span {
  color: rgba(161, 255, 197, .58);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .08em;
  white-space: nowrap;
}

.mpv-display-label {
  color: rgba(161, 255, 197, .44) !important;
}

.mpv-progress-strip {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mpv-time {
  min-width: 38px;
  color: rgba(255, 255, 255, .56);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

.mpv-time-current {
  color: rgba(190, 255, 214, .88);
}

.mpv-embedded-progress,
.mpv-volume-control input {
  height: 18px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  appearance: none;
}

.mpv-embedded-progress {
  flex: 1;
  min-width: 140px;
}

.mpv-embedded-progress::-webkit-slider-runnable-track,
.mpv-volume-control input::-webkit-slider-runnable-track {
  height: 6px;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 999px;
  background: linear-gradient(to right, #fff 0 var(--mpv-progress, 0%), #8d8d8d var(--mpv-progress, 0%) var(--mpv-buffered, 0%), rgba(57,57,57,.8) var(--mpv-buffered, 0%) 100%);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, .8);
}

.mpv-volume-control input::-webkit-slider-runnable-track {
  background: linear-gradient(to right, rgba(113, 255, 161, .9) var(--mpv-volume, 0%), rgba(255, 255, 255, .14) var(--mpv-volume, 0%));
}

.mpv-embedded-progress::-webkit-slider-thumb,
.mpv-volume-control input::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border: 1px solid rgba(255, 255, 255, .5);
  border-radius: 3px;
  background: linear-gradient(180deg, #e6edf2, #7b8790);
  box-shadow: 0 3px 8px rgba(0, 0, 0, .52), inset 0 1px 0 rgba(255, 255, 255, .8);
  appearance: none;
}

.mpv-volume-deck {
  display: grid;
  grid-template-columns: 1fr 48px;
  gap: 10px;
  align-items: center;
  padding: 10px;
}

.mpv-volume-control {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}

.mpv-volume-control > span {
  color: rgba(255, 255, 255, .46);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .12em;
}

.mpv-volume-control input {
  width: 100%;
}

.mpv-volume-knob {
  position: relative;
  width: 48px;
  height: 48px;
  border: 1px solid rgba(255, 255, 255, .18);
  border-radius: 50%;
  background:
    radial-gradient(circle at 40% 32%, rgba(255, 255, 255, .32), transparent 18%),
    repeating-conic-gradient(from -30deg, rgba(255, 255, 255, .12) 0deg 5deg, transparent 5deg 14deg),
    radial-gradient(circle, #394049 0 34%, #12161b 36% 100%);
  box-shadow: inset 0 2px 4px rgba(255, 255, 255, .12), inset 0 -8px 16px rgba(0, 0, 0, .58), 0 9px 22px rgba(0, 0, 0, .38);
}

.mpv-volume-knob span {
  position: absolute;
  left: 50%;
  top: 5px;
  width: 3px;
  height: 13px;
  border-radius: 999px;
  background: rgba(122, 255, 165, .92);
  box-shadow: 0 0 10px rgba(122, 255, 165, .5);
  transform: translateX(-50%) rotate(var(--mpv-volume-angle, -135deg));
  transform-origin: 50% 19px;
}

.mpv-transport-deck {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  padding: 10px;
}

.mpv-transport-buttons {
  display: flex;
  gap: 8px;
}

.mpv-hardware-btn {
  cursor: pointer;
  transition: transform .1s ease, filter .16s ease, opacity .16s ease;
}

.mpv-hardware-btn {
  display: grid;
  min-width: 54px;
  height: 46px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, .16);
  border-radius: 9px;
  padding: 5px 9px;
  background: linear-gradient(180deg, #373d45, #15191f 56%, #090b0e);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .22), inset 0 -4px 0 rgba(0, 0, 0, .32), 0 8px 18px rgba(0, 0, 0, .34);
  color: rgba(255, 255, 255, .86);
  font-size: 12px;
}

.mpv-hardware-btn span {
  font-size: 15px;
  font-weight: 900;
  line-height: 1;
}

.mpv-hardware-btn small {
  color: rgba(255, 255, 255, .45);
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
}

.mpv-play-btn {
  border-color: rgba(114, 255, 166, .32);
  background: linear-gradient(180deg, #2b6f48, #16492f 54%, #082112);
  color: rgba(232, 255, 237, .98);
  text-shadow: 0 0 10px rgba(105, 255, 145, .28);
}

.mpv-hardware-btn:hover:not(:disabled) {
  filter: brightness(1.12);
}

.mpv-hardware-btn:active:not(:disabled) {
  transform: translateY(2px);
}

.mpv-hardware-btn:disabled {
  cursor: default;
  opacity: .34;
}

.mpv-settings-btn.active,
.mpv-list-btn.active {
  border-color: rgba(122, 255, 170, .34);
  background: linear-gradient(180deg, #31533f, #182a20 56%, #08120c);
  color: rgba(210, 255, 224, .98);
}

.mpv-settings-popover,
.mpv-playlist-popover {
  position: relative;
  grid-column: 1 / -1;
  border: 1px solid rgba(122, 255, 170, .16);
  border-radius: 14px;
  padding: 12px;
  background: var(--app-overlay-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .08), 0 16px 42px rgba(0, 0, 0, .42);
}

.mpv-settings-popover::before,
.mpv-playlist-popover::before {
  position: absolute;
  left: 28px;
  top: -7px;
  width: 12px;
  height: 12px;
  border-left: 1px solid rgba(122, 255, 170, .16);
  border-top: 1px solid rgba(122, 255, 170, .16);
  background: var(--app-overlay-bg);
  content: '';
  transform: rotate(45deg);
}

.mpv-playlist-menu {
  display: grid;
  gap: 6px;
  max-height: 240px;
  overflow: auto;
}

.mpv-playlist-menu-item {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-height: 38px;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 9px;
  padding: 0 10px;
  background: rgba(255, 255, 255, .035);
  color: rgba(255, 255, 255, .72);
  cursor: pointer;
  text-align: left;
}

.mpv-playlist-menu-item:hover,
.mpv-playlist-menu-item.active {
  border-color: rgba(122, 255, 170, .28);
  background: rgba(122, 255, 170, .08);
  color: rgba(232, 255, 239, .96);
}

.mpv-playlist-menu-item span {
  color: rgba(122, 255, 170, .62);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 900;
}

.mpv-playlist-menu-item strong {
  overflow: hidden;
  font-size: 12px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mpv-settings-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
}

.mpv-settings-header strong {
  color: rgba(235, 255, 241, .95);
  font-size: 13px;
  font-weight: 900;
}

.mpv-settings-header span {
  color: rgba(255, 255, 255, .42);
  font-size: 11px;
  font-weight: 700;
}

.mpv-selector-grid {
  display: grid;
  grid-template-columns: minmax(160px, 1.35fr) repeat(5, minmax(104px, .72fr));
  gap: 8px;
  min-width: 0;
}

.mpv-settings-grid {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) 116px minmax(150px, 1fr) 92px 92px minmax(96px, .6fr) minmax(96px, .6fr);
  gap: 8px;
  min-width: 0;
}

.mpv-field,
.mpv-quality-pill {
  display: flex;
  min-width: 0;
  height: 46px;
  align-items: stretch;
  border: 1px solid rgba(255, 255, 255, .12);
  border-radius: 9px;
  background: linear-gradient(180deg, rgba(255, 255, 255, .075), rgba(255, 255, 255, .028));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .08), inset 0 -8px 18px rgba(0, 0, 0, .22);
  overflow: hidden;
}

.mpv-field > span {
  display: inline-flex;
  width: 72px;
  align-items: center;
  justify-content: center;
  border-right: 1px solid rgba(255, 255, 255, .1);
  color: rgba(255, 255, 255, .44);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .1em;
  white-space: nowrap;
}

.mpv-field select {
  min-width: 0;
  flex: 1;
  border: 0;
  padding: 0 10px;
  background: rgba(0, 0, 0, .12);
  color: rgba(255, 255, 255, .84);
  font-size: 12px;
  font-weight: 700;
  outline: none;
}

.mpv-field select {
  max-width: 100%;
}

.mpv-subtitle-search-trigger {
  cursor: pointer;
  color: rgba(255, 255, 255, .86);
}

.mpv-subtitle-search-trigger strong {
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, .12);
  color: rgba(183, 255, 207, .94);
  font-size: 12px;
  font-weight: 900;
}

.mpv-subtitle-style-field,
.mpv-subtitle-toggle {
  display: flex;
  min-width: 0;
  height: 36px;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(255, 255, 255, .06), rgba(255, 255, 255, .024));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06), inset 0 -8px 16px rgba(0, 0, 0, .18);
  overflow: hidden;
}

.mpv-subtitle-style-field > span,
.mpv-subtitle-toggle > span {
  display: inline-flex;
  width: 58px;
  height: 100%;
  align-items: center;
  justify-content: center;
  border-right: 1px solid rgba(255, 255, 255, .08);
  color: rgba(255, 255, 255, .44);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .08em;
}

.mpv-subtitle-style-field input[type='range'] {
  min-width: 0;
  flex: 1;
  accent-color: #a8d2ff;
}

.mpv-subtitle-style-field input[type='number'] {
  min-width: 0;
  flex: 1;
  border: 0;
  padding: 0 6px;
  background: rgba(0, 0, 0, .16);
  color: rgba(255, 255, 255, .88);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 800;
  outline: none;
}

.mpv-subtitle-style-field strong {
  width: 34px;
  color: rgba(183, 255, 207, .9);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  text-align: center;
}

.mpv-subtitle-color-field input[type='color'] {
  width: 100%;
  height: 100%;
  flex: 1;
  border: 0;
  padding: 4px 8px;
  background: transparent;
}

.mpv-subtitle-toggle {
  justify-content: center;
  gap: 7px;
  padding: 0 10px;
}

.mpv-subtitle-toggle > span {
  width: auto;
  border-right: 0;
}

.mpv-subtitle-toggle input {
  accent-color: #7affaa;
}

.mpv-skip-marker-btn {
  display: grid;
  min-width: 0;
  height: 36px;
  grid-template-columns: 58px minmax(0, 1fr);
  align-items: center;
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: 8px;
  padding: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, .06), rgba(255, 255, 255, .024));
  color: rgba(255, 255, 255, .72);
  cursor: pointer;
  overflow: hidden;
}

.mpv-skip-marker-btn.active {
  border-color: rgba(122, 255, 170, .28);
  color: rgba(232, 255, 239, .95);
}

.mpv-skip-marker-btn span {
  display: inline-flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  border-right: 1px solid rgba(255, 255, 255, .08);
  color: rgba(255, 255, 255, .44);
  font-size: 11px;
  font-weight: 900;
}

.mpv-skip-marker-btn strong {
  overflow: hidden;
  padding: 0 10px;
  color: rgba(183, 255, 207, .9);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.mpv-subtitle-search-modal .arco-modal) {
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: 18px;
  background: var(--app-overlay-bg);
  box-shadow: 0 28px 80px rgba(0, 0, 0, .56);
  overflow: hidden;
}

:global(.mpv-subtitle-search-modal-body) {
  padding: 0;
  background: var(--app-overlay-bg);
}

:global(.mpv-subtitle-modal) {
  min-height: 560px;
  color: rgba(255, 255, 255, .9);
}

:global(.mpv-subtitle-modal-header) {
  display: flex;
  height: 68px;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  border-bottom: 1px solid rgba(255, 255, 255, .08);
  background: var(--app-overlay-bg);
}

:global(.mpv-subtitle-modal-close) {
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, .14);
  border-radius: 999px;
  background: rgba(255, 255, 255, .06);
  color: rgba(255, 255, 255, .8);
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
}

:global(.mpv-subtitle-modal-title) {
  font-size: 18px;
  font-weight: 800;
}

:global(.mpv-subtitle-modal-heading) {
  display: grid;
  gap: 3px;
}

:global(.mpv-subtitle-modal-subtitle) {
  color: rgba(255, 255, 255, .46);
  font-size: 12px;
  font-weight: 600;
}

:global(.mpv-subtitle-modal-searchbar) {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) 110px;
  gap: 12px;
  padding: 16px 20px 12px;
}

:global(.mpv-subtitle-result-shell) {
  margin: 0 20px 20px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 14px;
  background: rgba(0, 0, 0, .12);
}

:global(.mpv-subtitle-result-toolbar) {
  display: flex;
  height: 42px;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, .07);
  color: rgba(255, 255, 255, .48);
  font-size: 12px;
  font-weight: 700;
}

:global(.mpv-subtitle-result-list) {
  display: grid;
  gap: 10px;
  max-height: 390px;
  padding: 10px;
  overflow: auto;
}

:global(.mpv-subtitle-result-row) {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) 52px;
  align-items: center;
  gap: 14px;
  min-height: 66px;
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: 10px;
  background: rgba(255, 255, 255, .045);
  color: inherit;
  cursor: pointer;
  text-align: left;
}

:global(.mpv-subtitle-result-row:hover:not(:disabled)) {
  border-color: rgba(63, 131, 255, .36);
  background: rgba(63, 131, 255, .09);
}

:global(.mpv-subtitle-result-icon) {
  justify-self: end;
  border-radius: 999px;
  padding: 6px 8px;
  background: rgba(63, 131, 255, .14);
  color: rgba(153, 191, 255, .96);
  font-size: 11px;
  font-weight: 900;
}

:global(.mpv-subtitle-result-copy) {
  display: grid;
  min-width: 0;
  gap: 4px;
}

:global(.mpv-subtitle-result-title) {
  overflow: hidden;
  font-size: 14px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.mpv-subtitle-result-meta),
:global(.mpv-subtitle-empty) {
  color: rgba(255, 255, 255, .48);
  font-size: 12px;
}

:global(.mpv-subtitle-result-arrow) {
  color: rgba(153, 191, 255, .96);
  font-size: 12px;
  font-weight: 700;
}

:global(.mpv-subtitle-empty) {
  display: grid;
  min-height: 220px;
  place-items: center;
}

.mpv-field-compact > span {
  width: 66px;
}

.mpv-field-track > span {
  width: 54px;
}

.mpv-quality-pill {
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  color: rgba(183, 255, 207, .94);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 900;
}

@keyframes mpv-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 900px) {
  .mpv-embedded-controls {
    padding: 0 10px 10px;
  }

  .mpv-control-bar {
    grid-template-columns: 1fr;
    gap: 10px;
    border-radius: 16px;
  }

  .mpv-hardware-rail {
    flex-direction: row;
    align-items: center;
  }

  .mpv-display-readout {
    grid-template-columns: 1fr;
    gap: 5px;
    text-align: center;
  }

  .mpv-volume-deck {
    grid-template-columns: minmax(0, 1fr) 48px;
  }

  .mpv-transport-deck {
    grid-template-columns: 1fr;
  }

  .mpv-transport-buttons {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .mpv-selector-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mpv-settings-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mpv-field,
  .mpv-quality-pill {
    width: 100%;
  }

  .mpv-field-playlist {
    grid-column: 1 / -1;
  }

  .mpv-field > span {
    width: 68px;
  }

  .mpv-hardware-btn {
    min-width: 0;
  }
}

/* Cinematic transport redesign: the picture stays dominant while the controls read as one calm instrument. */
.mpv-embedded-controls {
  gap: 0;
  padding: 0 22px 18px;
}

.mpv-control-panel {
  border: 1px solid rgba(255, 255, 255, .14);
  border-radius: 18px;
  padding: 8px 10px 10px;
  background: rgba(11, 14, 19, .78);
  box-shadow: 0 18px 52px rgba(0, 0, 0, .46), inset 0 1px 0 rgba(255, 255, 255, .08);
  backdrop-filter: blur(24px) saturate(125%);
}

.mpv-progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 4px 7px;
}

.mpv-progress-row .mpv-embedded-progress {
  min-width: 80px;
}

.mpv-control-row {
  display: grid;
  grid-template-columns: auto minmax(100px, 150px) minmax(150px, 1fr) auto;
  gap: 16px;
  align-items: center;
  min-height: 46px;
}

.mpv-transport-buttons,
.mpv-quick-controls {
  display: flex;
  align-items: center;
  gap: 5px;
}

.mpv-icon-btn {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: rgba(255, 255, 255, .7);
  cursor: pointer;
  transition: background .16s ease, border-color .16s ease, color .16s ease, transform .12s ease;
}

.mpv-icon-btn:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, .12);
  background: rgba(255, 255, 255, .09);
  color: #fff;
}

.mpv-icon-btn:active:not(:disabled) {
  transform: scale(.94);
}

.mpv-icon-btn:disabled {
  cursor: default;
  opacity: .25;
}

.mpv-icon-btn.active {
  border-color: rgba(126, 255, 172, .32);
  background: rgba(126, 255, 172, .12);
  color: #baffd0;
}

.mpv-play-btn {
  width: 38px;
  height: 38px;
  border-color: rgba(141, 255, 181, .4);
  border-radius: 12px;
  background: #a9f7c1;
  color: #07130c;
  box-shadow: 0 5px 16px rgba(89, 255, 146, .2);
}

.mpv-play-btn:hover:not(:disabled) {
  border-color: #d8ffe4;
  background: #d0ffdc;
  color: #07130c;
}

.mpv-stop-btn {
  color: rgba(255, 255, 255, .42);
}

.mpv-volume-control {
  display: flex;
  min-width: 0;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.mpv-volume-icon {
  flex: 0 0 auto;
  color: rgba(255, 255, 255, .52);
}

.mpv-volume-control input {
  width: 100%;
  min-width: 70px;
}

.mpv-now-playing {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
}

.mpv-now-playing-kicker {
  color: rgba(169, 247, 193, .65);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .12em;
  white-space: nowrap;
}

.mpv-now-playing strong {
  overflow: hidden;
  color: rgba(255, 255, 255, .9);
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mpv-now-playing > span:last-child {
  color: rgba(255, 255, 255, .48);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.mpv-quick-controls {
  justify-content: flex-end;
}

.mpv-quick-select {
  display: inline-flex;
  height: 34px;
  min-width: 62px;
  flex-direction: column;
  justify-content: center;
  border-right: 1px solid rgba(255, 255, 255, .1);
  padding: 0 11px 0 3px;
  color: rgba(255, 255, 255, .48);
  font-size: 9px;
  line-height: 1.2;
}

.mpv-quick-select select,
.mpv-quick-select b {
  min-width: 0;
  border: 0;
  padding: 0;
  background: transparent;
  color: rgba(255, 255, 255, .82);
  font-size: 11px;
  font-weight: 800;
  outline: none;
}

.mpv-quick-select select {
  max-width: 92px;
}

.mpv-quick-select b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mpv-settings-popover-secondary {
  margin-top: 8px;
}

@media (max-width: 900px) {
  .mpv-embedded-controls {
    padding: 0 10px 10px;
  }

  .mpv-control-panel {
    border-radius: 16px;
    padding: 8px;
  }

  .mpv-control-row {
    grid-template-columns: auto minmax(90px, 1fr) auto;
    gap: 8px;
  }

  .mpv-now-playing {
    display: none;
  }

  .mpv-quick-select {
    padding-right: 7px;
  }

  .mpv-quick-select select {
    max-width: 64px;
  }
}

@media (max-width: 560px) {
  .mpv-control-row {
    grid-template-columns: 1fr auto;
  }

  .mpv-volume-control {
    display: none;
  }

  .mpv-quick-controls {
    justify-content: flex-end;
  }

  .mpv-quick-select {
    display: none;
  }
}

.mpv-side-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  display: flex;
  width: min(310px, 32vw);
  flex-direction: column;
  color-scheme: dark;
  border-left: 1px solid rgba(255, 255, 255, .1);
  background: rgba(28, 29, 31, .96);
  box-shadow: -20px 0 55px rgba(0, 0, 0, .26);
  backdrop-filter: blur(22px);
}

.mpv-side-panel-header {
  display: flex;
  min-height: 60px;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, .08);
  color: rgba(255, 255, 255, .45);
  font-size: 11px;
}

.mpv-side-panel-header > div {
  display: grid;
  gap: 4px;
}

.mpv-side-panel-header strong {
  color: rgba(255, 255, 255, .9);
  font-size: 14px;
  font-weight: 750;
}

.mpv-side-panel-kicker,
.mpv-side-label {
  color: rgba(255, 255, 255, .42);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.mpv-side-close {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 7px;
  background: rgba(255, 255, 255, .06);
  color: rgba(255, 255, 255, .55);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}

.mpv-side-close:hover {
  background: rgba(255, 255, 255, .12);
  color: #fff;
}

.mpv-side-panel-list {
  display: grid;
  gap: 0;
  overflow: auto;
}

.mpv-playlist-menu-item {
  display: grid;
  min-height: 43px;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, .055);
  border-radius: 0;
  padding: 0 14px;
  background: transparent;
  color: rgba(255, 255, 255, .62);
}

.mpv-playlist-menu-item:hover,
.mpv-playlist-menu-item.active {
  border-color: rgba(255, 255, 255, .055);
  background: rgba(255, 255, 255, .08);
  color: #fff;
}

.mpv-playlist-menu-item.active::before {
  position: absolute;
  right: 0;
  width: 2px;
  height: 24px;
  border-radius: 2px 0 0 2px;
  background: #65d9ff;
  content: '';
}

.mpv-playlist-menu-item > span {
  color: rgba(255, 255, 255, .32);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
}

.mpv-playlist-menu-item.active > span {
  color: #9ce6ff;
}

.mpv-playlist-menu-item strong {
  overflow: hidden;
  font-size: 12px;
  font-weight: 620;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mpv-playlist-menu-item small {
  color: #82d8f6;
  font-size: 9px;
  white-space: nowrap;
}

.mpv-side-panel-footer {
  margin-top: auto;
  padding: 12px 14px;
  border-top: 1px solid rgba(255, 255, 255, .08);
  color: rgba(255, 255, 255, .38);
  font-size: 11px;
  text-align: right;
}

.mpv-settings-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-bottom: 1px solid rgba(255, 255, 255, .08);
}

.mpv-settings-tabs button {
  height: 42px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: rgba(255, 255, 255, .48);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.mpv-settings-tabs button.active {
  border-bottom-color: #55cfff;
  color: #fff;
}

.mpv-side-settings-content {
  display: grid;
  flex: 1;
  min-height: 0;
  align-content: start;
  gap: 22px;
  overflow: auto;
  padding: 18px 16px 24px;
}

.mpv-side-section {
  display: grid;
  gap: 10px;
}

.mpv-side-label {
  display: block;
  margin-bottom: 1px;
}

.mpv-track-list {
  display: grid;
  gap: 6px;
}

.mpv-track-row {
  display: flex;
  min-height: 38px;
  align-items: center;
  gap: 9px;
  border-radius: 8px;
  padding: 0 10px;
  background: rgba(255, 255, 255, .075);
  color: rgba(255, 255, 255, .8);
  font-size: 11px;
}

.mpv-track-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #62d7ff;
  box-shadow: 0 0 9px rgba(98, 215, 255, .65);
}

.mpv-side-empty {
  color: rgba(255, 255, 255, .42);
  font-size: 11px;
  line-height: 1.5;
}

.mpv-side-select-row {
  display: grid;
  min-height: 36px;
  grid-template-columns: 52px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, .07);
  color: rgba(255, 255, 255, .56);
  font-size: 11px;
}

.mpv-side-select-row select,
.mpv-side-select-row b {
  min-width: 0;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, .84);
  font-size: 11px;
  font-weight: 700;
  outline: none;
}

.mpv-side-select-row input[type='range'] {
  width: 100%;
  accent-color: #63d5ff;
}

.mpv-side-select-row select {
  color-scheme: dark;
  background-color: #1c1d1f;
  color: #f1f1f1;
}

.mpv-side-select-row select option,
.mpv-side-select-row select optgroup {
  background-color: #1c1d1f;
  color: #f1f1f1;
}

.mpv-option-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 3px;
}

.mpv-option-grid button {
  min-width: 0;
  height: 25px;
  border: 0;
  border-radius: 4px;
  background: rgba(255, 255, 255, .08);
  color: rgba(255, 255, 255, .6);
  cursor: pointer;
  font-size: 9px;
}

.mpv-option-grid button:hover,
.mpv-option-grid button.active {
  background: #168be0;
  color: #fff;
}

.mpv-rotation-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.mpv-side-toggle-row {
  display: flex;
  min-height: 36px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, .07);
  color: rgba(255, 255, 255, .68);
  font-size: 11px;
}

.mpv-side-toggle-row input {
  width: 28px;
  height: 16px;
  accent-color: #238fe0;
}

.mpv-video-filter-row {
  gap: 5px;
}

.mpv-video-filter-row input[type='range'] {
  accent-color: #d7d7d7;
}

.mpv-equalizer-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.mpv-equalizer-heading b {
  color: rgba(255, 255, 255, .4);
  font-size: 9px;
  font-weight: 500;
  white-space: nowrap;
}

.mpv-equalizer-grid {
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  align-items: end;
  gap: 5px;
  padding: 10px 8px 5px;
  border-radius: 8px;
  background: rgba(255, 255, 255, .055);
}

.mpv-equalizer-band {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.mpv-equalizer-band input {
  width: 18px;
  height: 112px;
  flex: 0 0 112px;
  margin: 0;
  accent-color: #b6dff2;
  cursor: pointer;
  writing-mode: vertical-lr;
  direction: rtl;
}

.mpv-equalizer-band span {
  color: rgba(255, 255, 255, .46);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 8px;
  white-space: nowrap;
}

.mpv-side-skip-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.mpv-side-skip,
.mpv-side-action {
  display: flex;
  min-height: 38px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: 8px;
  padding: 0 10px;
  background: rgba(255, 255, 255, .045);
  color: rgba(255, 255, 255, .62);
  cursor: pointer;
  font-size: 11px;
}

.mpv-side-action-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.mpv-subtitle-mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 2px;
  border-radius: 6px;
  background: rgba(255, 255, 255, .08);
}

.mpv-subtitle-mode-tabs button {
  height: 26px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, .48);
  cursor: pointer;
  font-size: 10px;
}

.mpv-subtitle-mode-tabs button.active {
  background: #168be0;
  color: #fff;
}

.mpv-side-skip.active,
.mpv-side-action:hover {
  border-color: rgba(98, 215, 255, .32);
  background: rgba(98, 215, 255, .1);
  color: #d7f6ff;
}

.mpv-side-skip b {
  color: rgba(255, 255, 255, .84);
  font-size: 10px;
}

.mpv-side-action {
  justify-content: center;
}

.mpv-side-slider {
  display: grid;
  gap: 6px;
  color: rgba(255, 255, 255, .56);
  font-size: 11px;
}

.mpv-side-slider span {
  display: flex;
  justify-content: space-between;
}

.mpv-side-slider b {
  color: rgba(255, 255, 255, .82);
}

.mpv-side-slider input[type='range'] {
  width: 100%;
  accent-color: #63d5ff;
}

.mpv-side-style-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: rgba(255, 255, 255, .62);
  font-size: 11px;
}

.mpv-side-style-row input[type='checkbox'] {
  accent-color: #63d5ff;
}

.mpv-side-style-row input[type='color'] {
  width: 28px;
  height: 24px;
  border: 0;
  padding: 0;
  background: transparent;
}

@media (max-width: 700px) {
  .mpv-side-panel {
    width: min(310px, 82vw);
  }

  .mpv-playlist-panel {
    width: min(310px, 82vw);
  }
}

.mpv-playlist-panel {
  width: min(310px, 32vw);
  border-left-color: rgba(255, 255, 255, .08);
  background: rgba(54, 54, 54, .98);
  box-shadow: -14px 0 30px rgba(0, 0, 0, .18);
}

.mpv-playlist-tabs {
  display: grid;
  height: 34px;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid rgba(255, 255, 255, .1);
  background: rgba(40, 40, 40, .92);
}

.mpv-playlist-tabs button {
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: rgba(255, 255, 255, .44);
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
}

.mpv-playlist-tabs button.active {
  border-bottom-color: rgba(114, 211, 241, .82);
  color: rgba(255, 255, 255, .92);
}

.mpv-playlist-tabs button:disabled {
  cursor: default;
}

.mpv-playlist-panel .mpv-side-panel-list {
  gap: 0;
}

.mpv-playlist-panel .mpv-playlist-menu-item {
  position: relative;
  min-height: 22px;
  grid-template-columns: 13px minmax(0, 1fr) 30px;
  gap: 3px;
  padding: 0 6px;
  border-bottom: 1px solid rgba(255, 255, 255, .055);
  background: transparent;
  color: rgba(255, 255, 255, .7);
  font-size: 10px;
}

.mpv-playlist-panel .mpv-playlist-menu-item:hover,
.mpv-playlist-panel .mpv-playlist-menu-item.active {
  background: rgba(255, 255, 255, .11);
  color: rgba(255, 255, 255, .95);
}

.mpv-playlist-panel .mpv-playlist-menu-item.active::before {
  right: 0;
  width: 2px;
  height: 18px;
  background: #8fd9f2;
}

.mpv-playlist-panel .mpv-playlist-menu-item > span.mpv-playlist-index {
  color: rgba(255, 255, 255, .48);
  font-family: inherit;
  font-size: 9px;
  text-align: center;
}

.mpv-playlist-panel .mpv-playlist-menu-item.active > span.mpv-playlist-index {
  color: rgba(255, 255, 255, .9);
}

.mpv-playlist-panel .mpv-playlist-menu-item strong {
  font-size: 10px;
  font-weight: 550;
}

.mpv-playlist-panel .mpv-playlist-menu-item small {
  overflow: hidden;
  color: rgba(255, 255, 255, .4);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mpv-playlist-panel .mpv-chapter-menu-item {
  grid-template-columns: 42px minmax(0, 1fr) 34px;
}

.mpv-playlist-panel .mpv-chapter-menu-item > span.mpv-playlist-index {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  text-align: left;
}

.mpv-playlist-footer {
  display: flex;
  min-height: 28px;
  align-items: center;
  gap: 9px;
  margin-top: auto;
  padding: 0 7px;
  border-top: 1px solid rgba(255, 255, 255, .1);
  background: rgba(43, 43, 43, .94);
  color: rgba(255, 255, 255, .52);
  font-size: 12px;
}

.mpv-playlist-footer small {
  color: rgba(255, 255, 255, .55);
  font-size: 9px;
  white-space: nowrap;
}

.mpv-playlist-footer-spacer {
  flex: 1;
}

/* Keep the transport aligned to the visible video area, like IINA. */
.mpv-embedded-surface.panel-open .mpv-embedded-controls {
  right: min(310px, 32vw);
}

.mpv-embedded-controls {
  align-items: center;
}

.mpv-control-panel {
  width: min(430px, calc(100% - 28px));
}

.mpv-control-row {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.mpv-volume-control {
  width: 88px;
}

.mpv-now-playing {
  display: none;
}

.mpv-quick-select {
  display: none;
}

@media (max-width: 700px) {
  .mpv-embedded-surface.panel-open .mpv-embedded-controls {
    right: 0;
  }

  .mpv-control-panel {
    width: min(430px, calc(100% - 12px));
  }
}
</style>

<style scoped>
.mpv-embedded-progress::-webkit-slider-runnable-track {
  height: 8px;
  border: 1px solid rgba(255,255,255,.35);
  background: linear-gradient(180deg, rgba(255,255,255,.22), transparent 45%, rgba(0,0,0,.12)), linear-gradient(to right, #fff 0 var(--mpv-progress), #8d8d8d var(--mpv-progress) var(--mpv-buffered), rgba(57,57,57,.8) var(--mpv-buffered) 100%);
  box-shadow: inset 0 1px 2px rgba(255,255,255,.3), 0 1px 4px rgba(0,0,0,.3);
  backdrop-filter: blur(16px) saturate(150%);
}
.mpv-embedded-progress::-webkit-slider-thumb {
  width: 4px;
  height: 8px;
  margin-top: -1px;
  border-radius: 6px;
  background: rgba(245,245,245,.95);
}
</style>

<style scoped>
/* Match the compact macOS transport, keeping secondary actions in the gear menu. */
.mpv-embedded-controls { padding: 0 16px 28px; }
.mpv-control-panel { position: relative; box-sizing: border-box; width: min(600px, calc(100% - 32px)); padding: 10px 16px; border-radius: 12px; background: rgba(100, 89, 99, .72); backdrop-filter: blur(28px) saturate(115%); box-shadow: 0 8px 24px rgba(0,0,0,.2); }
.mpv-control-row { position: relative; display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; min-height: 30px; margin-bottom: 8px; }
.mpv-transport-buttons { gap: 8px; }
.mpv-window-actions { display: flex; justify-content: flex-end; gap: 8px; }
.mpv-control-panel .mpv-icon-btn { width: 28px; height: 28px; padding: 2px; border: 0; border-radius: 5px; color: #fff; background: transparent; box-shadow: none; }
.mpv-control-panel .mpv-icon-btn:hover:not(:disabled), .mpv-control-panel .mpv-icon-btn.active { color: #fff; background: rgba(255,255,255,.16); }
.mpv-control-panel .mpv-icon-btn:focus-visible, .mpv-options-menu button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.mpv-progress-row { gap: 8px; padding: 0; min-height: 24px; }
.mpv-progress-row .mpv-time { color: rgba(255,255,255,.94); font: 500 12px/1.3 -apple-system, BlinkMacSystemFont, sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mpv-progress-row .mpv-embedded-progress { flex: 1; width: 0; height: 20px; margin: 0; }
.mpv-embedded-progress::-webkit-slider-runnable-track { height: 8px; border: 1px solid rgba(255,255,255,.55); border-radius: 8px; background: linear-gradient(to right, #f4f4f4 0 var(--mpv-progress), rgba(255,255,255,.4) var(--mpv-progress) var(--mpv-buffered), rgba(255,255,255,.08) var(--mpv-buffered) 100%); box-shadow: none; }
.mpv-embedded-progress::-webkit-slider-thumb { width: 16px; height: 16px; margin-top: -5px; border: 0; border-radius: 50%; background: #fff; box-shadow: none; }
.mpv-menu-dismiss { position: absolute; inset: 0; z-index: 3; }
.mpv-volume-anchor { position: relative; justify-self: start; }
.mpv-volume-popover, .mpv-options-menu { position: absolute; bottom: calc(100% + 14px); z-index: 12; border: 1px solid rgba(255,255,255,.3); border-radius: 12px; background: rgba(65,53,63,.9); backdrop-filter: blur(28px); box-shadow: 0 8px 24px rgba(0,0,0,.3); }
.mpv-volume-popover { left: -8px; display: grid; gap: 10px; padding: 14px; width: 150px; font-size: 12px; color: white; }
.mpv-volume-popover input { width: 100%; accent-color: white; }
.mpv-options-menu { right: -12px; width: 192px; max-height: min(60vh, 460px); overflow-y: auto; padding: 6px; }
.mpv-options-menu > button { display: flex; width: 100%; min-height: 30px; align-items: center; gap: 10px; padding: 5px 10px; border: 0; border-radius: 5px; background: transparent; color: rgba(255,255,255,.92); font: 600 14px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; text-align: left; cursor: pointer; }
.mpv-options-menu > button span { flex: 1; }
.mpv-options-menu button:hover { background: rgba(255,255,255,.16); }
.mpv-back-chevron { transform: rotate(180deg); }
.mpv-menu-back { border-bottom: 1px solid rgba(255,255,255,.12) !important; border-radius: 0 !important; margin-bottom: 4px; }
.mpv-choice-menu { display: grid; gap: 2px; }
.mpv-speed-menu { max-height: min(320px, 42vh); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.4) transparent; }
.mpv-choice-menu button { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 30px; padding: 5px 10px; border: 0; border-radius: 5px; background: transparent; color: white; font-size: 14px; text-align: left; cursor: pointer; }
.mpv-side-choice { width: 100%; padding: 6px 8px; border: 1px solid rgba(255,255,255,.18); border-radius: 5px; background: #363636; color: white; }
@media (max-width: 700px) { .mpv-control-panel { width: calc(100% - 12px); } }
@media (max-width: 440px) { .mpv-control-panel { padding: 8px; } .mpv-control-row, .mpv-transport-buttons, .mpv-window-actions { gap: 2px; } .mpv-control-panel .mpv-icon-btn { width: 25px; } }
</style>
