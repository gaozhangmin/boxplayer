<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button, Input, Modal, Option as AOption, Select } from '@arco-design/web-vue'
import {
  formatSubtitleDownloadCount,
  getSubtitleDownload,
  searchSubtitles
} from '../utils/subtitleApi'
import type { SubtitleSearchResult } from '../utils/subtitleApi'
import message from '../utils/message'
import { getAutoSubtitleTrackId } from '../utils/mpvSubtitleTrack'
import { Captions, Flag, ListVideo, Pause, Play, Settings2, SkipBack, SkipForward } from 'lucide-vue-next'

const props = defineProps<{
  url: string
  headers?: Record<string, string>
  title?: string
  startPosition?: number
  qualityLabel?: string
  qualities?: Array<{ html?: string; quality?: string; name?: string; label?: string; value?: string }>
  currentQuality?: string
  subtitleSources?: Array<{ url: string; title?: string }>
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

const canvasRef = ref<HTMLCanvasElement | null>(null)
const fallbackCanvasRef = ref<HTMLCanvasElement | null>(null)
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
const seeking = ref(false)
const controlsVisible = ref(true)
const controlsHover = ref(false)
const settingsOpen = ref(false)
const playlistOpen = ref(false)
const playlistTab = ref<'playlist' | 'chapters'>('playlist')
const noticeText = ref('')
const audioTrackId = ref(-1)
const subtitleTrackId = ref(-1)
let autoSelectedSubtitleTrackId: number | undefined
let resumeGuardTarget = 0
let resumeGuardUntil = 0
let resumeGuardLastSeekAt = 0
const secondarySubtitleTrackId = ref(-1)
const subtitleDelay = ref(0)
const subtitleScale = ref(1)
const subtitleBorderSize = ref(3)
const subtitleBorderColor = ref('#000000')
const subtitleBackgroundColor = ref('#000000')
const audioDelay = ref(0)
const equalizerBands = ref([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
const equalizerFrequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
const subtitleFontSize = ref(44)
const subtitleColor = ref('#ffffff')
const subtitlePosition = ref(96)
const subtitleBold = ref(false)
const subtitleItalic = ref(false)
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
const isBuffering = computed(() => loading.value || (!errorText.value && frameCount.value === 0))
const shouldShowControls = computed(() => controlsVisible.value || controlsHover.value || paused.value || loading.value || Boolean(errorText.value) || seeking.value || settingsOpen.value || playlistOpen.value)

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
let statusTimer: number | null = null
let controlsHideTimer: number | null = null
let noticeTimer: number | null = null
let lastPointerY: number | null = null
let pendingResumePosition = 0
let loadSequence = 0
const CONTROLS_REVEAL_ZONE = 180
const CONTROLS_HIDE_ZONE = 220
const CONTROLS_DIRECTION_THRESHOLD = 2

const isAvailable = computed(() => {
  return Boolean(window.WebMpvSharedTexture?.isAvailable?.() && window.WebMpvEmbeddedLoad)
})

const audioTracks = computed(() => tracks.value.filter((track) => track.type === 'audio'))
const subtitleTracks = computed(() => tracks.value.filter((track) => track.type === 'sub'))
const videoTracks = computed(() => tracks.value.filter((track) => track.type === 'video'))
const speedOptions = [0.5, 1, 1.25, 1.5, 2, 3]
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
const progressPercent = computed(() => duration.value > 0 ? `${Math.max(0, Math.min(100, (position.value / duration.value) * 100))}%` : '0%')
const volumePercent = computed(() => `${Math.max(0, Math.min(100, volume.value))}%`)
const subtitleSelectValue = computed(() => `track:${subtitleTrackId.value}`)
const secondarySubtitleSelectValue = computed(() => `track:${secondarySubtitleTrackId.value}`)
const settingsTab = ref<'video' | 'audio' | 'subtitle'>('video')

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

const drawSoftwareFrame = (pixels: Uint8Array, width: number, height: number, index: number) => {
  const canvas = fallbackCanvasRef.value
  if (!canvas || width < 1 || height < 1 || pixels.length !== width * height * 4) return
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  fallbackContext = fallbackContext || canvas.getContext('2d', { alpha: false })
  if (!fallbackContext) return
  fallbackContext.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0)
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

const isControlsPinned = () => paused.value || loading.value || Boolean(errorText.value) || seeking.value || controlsHover.value || settingsOpen.value || playlistOpen.value

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

const toggleSettings = () => {
  revealControls()
  settingsOpen.value = !settingsOpen.value
  if (settingsOpen.value) playlistOpen.value = false
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

const updateStatus = async () => {
  const result = await window.WebMpvEmbeddedStatus?.()
  if (!result?.ok) return
  const status = { ...result.status, __loading: !loaded.value }
  emit('status', status)
  applyStatusResult(result)
  if (
    loaded.value
    && resumeGuardTarget > 0
    && Date.now() < resumeGuardUntil
    && typeof position.value === 'number'
    && position.value < resumeGuardTarget - 2
    && Date.now() - resumeGuardLastSeekAt > 300
  ) {
    resumeGuardLastSeekAt = Date.now()
    void control('seek', resumeGuardTarget)
  }
}

const applyStatusResult = (result: any) => {
  paused.value = Boolean(result.status?.paused)
  if (!seeking.value) position.value = typeof result.status?.position === 'number' ? result.status.position : 0
  duration.value = typeof result.status?.duration === 'number' ? result.status.duration : 0
  volume.value = typeof result.status?.volume === 'number' ? result.status.volume : volume.value
  speed.value = typeof result.status?.speed === 'number' ? result.status.speed : speed.value
  if (Array.isArray(result.trackStatus?.tracks)) tracks.value = result.trackStatus.tracks
  if (typeof result.trackStatus?.audioId === 'number') audioTrackId.value = result.trackStatus.audioId
  if (typeof result.trackStatus?.subtitleId === 'number') subtitleTrackId.value = result.trackStatus.subtitleId
  const autoSubtitleTrackId = getAutoSubtitleTrackId(tracks.value, subtitleTrackId.value, Boolean(props.subtitleSources?.length))
  if (autoSubtitleTrackId != null && autoSubtitleTrackId !== autoSelectedSubtitleTrackId) {
    autoSelectedSubtitleTrackId = autoSubtitleTrackId
    void control('setSubtitleTrack', autoSubtitleTrackId)
  }
  statusText.value = duration.value > 0 ? `${formatTime(position.value)} / ${formatTime(duration.value)}` : ''
  if (result.status?.playing || position.value > 0 || frameCount.value > 0) errorText.value = ''
  handleIntroOutroSkip()
}

const restorePendingResumePosition = async (sequence: number) => {
  const target = pendingResumePosition
  if (target <= 0) return

  // MPV accepts the seek command asynchronously. Do not clear the pending
  // position until a later status confirms that the seek actually landed.
  for (let attempt = 0; attempt < 8 && sequence === loadSequence; attempt++) {
    await control('seek', target)
    await new Promise(resolve => window.setTimeout(resolve, 100))
    await updateStatus()
    if (position.value >= Math.max(0, target - 2)) {
      pendingResumePosition = 0
      resumeGuardTarget = target
      resumeGuardUntil = Date.now() + 6000
      resumeGuardLastSeekAt = Date.now()
      return
    }
  }
}

const load = async () => {
  if (!props.url) return
  const sequence = ++loadSequence
  if (!isAvailable.value) {
    const message = 'macOS 内嵌 MPV surface 尚不可用。'
    errorText.value = message
    emit('error', message)
    return
  }

  loading.value = true
  loaded.value = false
  resumeGuardTarget = 0
  resumeGuardUntil = 0
  resumeGuardLastSeekAt = 0
  autoSelectedSubtitleTrackId = undefined
  pendingResumePosition = props.startPosition && props.startPosition > 0 ? Math.floor(props.startPosition) : 0
  introSkipped.value = false
  outroTriggered.value = false
  errorText.value = ''
  const headers = Object.fromEntries(Object.entries(props.headers || {}).map(([key, value]) => [key, String(value)]))
  console.info('[播放][MPV] 提交播放链接', {
    url: props.url,
    position: props.startPosition || 0,
    hasAuthorization: Object.keys(headers).some((key) => key.toLowerCase() === 'authorization'),
    userAgent: Object.entries(headers).find(([key]) => key.toLowerCase() === 'user-agent')?.[1] || ''
  })
  const result = await window.WebMpvEmbeddedLoad({
    url: props.url,
    headers,
    title: props.title || '',
    startPosition: props.startPosition || 0
  })
  if (sequence !== loadSequence) return
  loading.value = false

  if (!result?.ok) {
    const message = result?.error || result?.capability?.reason || 'macOS 内嵌 MPV 加载失败。'
    errorText.value = message
    emit('error', message)
    return
  }

  await updateStatus()
  if (sequence !== loadSequence) return
  loaded.value = true
  await applySubtitleStyle()
  for (const subtitle of props.subtitleSources || []) {
    if (subtitle.url) await control('addSubtitle', undefined, { url: subtitle.url, title: subtitle.title || '自动字幕' })
  }
  await updateStatus()
  // Subtitle setup may reload/reset the native stream. It must happen before
  // the final seek; otherwise a successful resume can be overwritten by 0.
  await control('play')
  await restorePendingResumePosition(sequence)
}

const control = async (action: 'play' | 'pause' | 'stop' | 'seek' | 'setVolume' | 'setSpeed' | 'setAudioTrack' | 'setSubtitleTrack' | 'setSubtitleStyle' | 'setVideoProperty' | 'addAudio' | 'addSubtitle', value?: number, extra?: { url?: string; title?: string; property?: string; propertyValue?: string | number | boolean; style?: { fontSize?: number; color?: string; position?: number; bold?: boolean; italic?: boolean } }) => {
  revealControls()
  const result = await window.WebMpvEmbeddedControl?.({ action, value, ...(extra || {}) })
  if (!result?.ok) {
    const message = result?.error || 'macOS 内嵌 MPV 控制失败。'
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
}

const formatTime = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0))
  const hour = Math.floor(safeSeconds / 3600)
  const minute = Math.floor((safeSeconds % 3600) / 60)
  const second = safeSeconds % 60
  return hour > 0
    ? `${hour}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
    : `${minute}:${String(second).padStart(2, '0')}`
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
  await setVideoProperty(property, enabled ? enabledValue : disabledValue)
}

const handleVideoFilterChange = async (event: Event, property: string, target: string) => {
  const value = Number((event.target as HTMLInputElement).value || 0)
  if (target === 'brightness') brightness.value = value
  if (target === 'contrast') contrast.value = value
  if (target === 'saturation') saturation.value = value
  if (target === 'gamma') gamma.value = value
  if (target === 'hue') hue.value = value
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

const handleEqualizerChange = async (event: Event, index: number) => {
  equalizerBands.value[index] = Number((event.target as HTMLInputElement).value || 0)
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

const handleSubtitleTrackChange = async (event: Event) => {
  revealControls()
  const selectedValue = String((event.target as HTMLSelectElement).value || 'track:-1')
  const nextTrackId = Number(selectedValue.replace(/^track:/, ''))
  subtitleTrackId.value = nextTrackId
  await control('setSubtitleTrack', nextTrackId)
}

const handleSecondarySubtitleTrackChange = async (event: Event) => {
  const nextTrackId = Number(String((event.target as HTMLSelectElement).value || 'track:-1').replace(/^track:/, ''))
  secondarySubtitleTrackId.value = nextTrackId
  await setVideoProperty('secondary-sid', nextTrackId < 0 ? 'no' : nextTrackId)
}

const handleSubtitleDelayChange = async (event: Event) => {
  subtitleDelay.value = Number((event.target as HTMLInputElement).value || 0)
  await setVideoProperty('sub-delay', subtitleDelay.value)
}

const handleSubtitleScaleChange = async (event: Event) => {
  subtitleScale.value = Number((event.target as HTMLInputElement).value || 1)
  await setVideoProperty('sub-scale', subtitleScale.value)
}

const handleSubtitleBorderSizeChange = async (event: Event) => {
  subtitleBorderSize.value = Number((event.target as HTMLInputElement).value || 0)
  await setVideoProperty('sub-border-size', subtitleBorderSize.value)
}

const handleSubtitleBorderColorChange = async (event: Event) => {
  subtitleBorderColor.value = String((event.target as HTMLInputElement).value || '#000000')
  await setVideoProperty('sub-border-color', subtitleBorderColor.value)
}

const handleSubtitleBackgroundColorChange = async (event: Event) => {
  subtitleBackgroundColor.value = String((event.target as HTMLInputElement).value || '#000000')
  await setVideoProperty('sub-back-color', `${subtitleBackgroundColor.value}00`)
}

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

const applySubtitleStyle = async () => {
  await control('setSubtitleStyle', undefined, {
    style: {
      fontSize: subtitleFontSize.value,
      color: subtitleColor.value,
      position: subtitlePosition.value,
      bold: subtitleBold.value,
      italic: subtitleItalic.value
    }
  })
}

const handleSubtitleSizeChange = async (event: Event) => {
  revealControls()
  subtitleFontSize.value = Number((event.target as HTMLInputElement).value || 44)
  await applySubtitleStyle()
}

const handleSubtitleColorChange = async (event: Event) => {
  revealControls()
  subtitleColor.value = String((event.target as HTMLInputElement).value || '#ffffff')
  await applySubtitleStyle()
}

const handleSubtitlePositionChange = async (event: Event) => {
  revealControls()
  subtitlePosition.value = Number((event.target as HTMLInputElement).value || 96)
  await applySubtitleStyle()
}

const handleSubtitleBoldChange = async (event: Event) => {
  revealControls()
  subtitleBold.value = Boolean((event.target as HTMLInputElement).checked)
  await applySubtitleStyle()
}

const handleSubtitleItalicChange = async (event: Event) => {
  revealControls()
  subtitleItalic.value = Boolean((event.target as HTMLInputElement).checked)
  await applySubtitleStyle()
}

const handleIntroSkipToggle = () => {
  revealControls()
  if (introSkipSeconds.value > 0) {
    introSkipSeconds.value = 0
    showNotice('取消设置片头')
  } else {
    introSkipSeconds.value = Math.max(0, Math.floor(position.value || 0))
    showNotice(`设置片头：${formatTime(introSkipSeconds.value)}`)
  }
  introSkipped.value = false
}

const handleOutroSkipToggle = () => {
  revealControls()
  if (outroSkipSeconds.value > 0) {
    outroSkipSeconds.value = 0
    showNotice('取消设置片尾')
  } else {
    outroSkipSeconds.value = Math.max(0, Math.floor(position.value || 0))
    showNotice(`设置片尾：${formatTime(outroSkipSeconds.value)}`)
  }
  outroTriggered.value = false
}

const handleIntroOutroSkip = () => {
  if (!loaded.value || paused.value || seeking.value) return
  if (introSkipSeconds.value > 0 && !introSkipped.value && position.value >= 0 && position.value < Math.min(introSkipSeconds.value, Math.max(1, duration.value - 1))) {
    introSkipped.value = true
    void control('seek', introSkipSeconds.value)
    return
  }
  if (outroSkipSeconds.value > 0 && !outroTriggered.value && position.value >= outroSkipSeconds.value) {
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
  window.WebMpvSharedTexture?.onFrame?.(drawFrame)
  window.WebMpvSharedTexture?.onSoftwareFrame?.(drawSoftwareFrame)
  window.WebMpvSharedTexture?.onClear?.(clearFrame)
  await load()
  statusTimer = window.setInterval(() => {
    void updateStatus()
  }, 1000)
})

onBeforeUnmount(() => {
  loadSequence++
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
})

watch(() => props.url, () => {
  revealControls()
  void load()
})

watch([paused, loading, errorText, seeking], () => {
  if (isControlsPinned()) controlsVisible.value = true
})

watch(() => props.subtitleSources, async (sources) => {
  if (!props.url || !loaded.value) return
  for (const subtitle of sources || []) {
    if (subtitle.url) await control('addSubtitle', undefined, { url: subtitle.url, title: subtitle.title || '自动字幕' })
  }
  await updateStatus()
}, { deep: true })

watch(chapters, (nextChapters) => {
  if (!nextChapters.length && playlistTab.value === 'chapters') playlistTab.value = 'playlist'
})
</script>

<template>
  <div class="mpv-embedded-surface" :class="{ 'controls-hidden': !shouldShowControls, 'panel-open': playlistOpen || settingsOpen }" tabindex="0" @keydown="revealControls" @mousedown="revealControls" @mouseleave="handleSurfacePointerLeave" @mousemove="handleSurfacePointerMove" @touchstart="revealControls">
    <canvas ref="canvasRef" class="mpv-embedded-canvas" :class="{ 'mpv-render-hidden': renderMode === 'fallback' }" />
    <canvas ref="fallbackCanvasRef" class="mpv-embedded-canvas mpv-fallback-canvas" :class="{ 'mpv-render-visible': renderMode === 'fallback' }" />
    <div v-if="isBuffering || errorText" class="mpv-embedded-overlay">
      <div v-if="isBuffering" class="mpv-embedded-loading">
        <span class="mpv-embedded-spinner"></span>
        <span>正在加载视频</span>
      </div>
      <div v-else-if="errorText" class="mpv-embedded-error">{{ errorText }}</div>
    </div>
    <div v-if="noticeText" class="mpv-embedded-notice">{{ noticeText }}</div>
    <div class="mpv-embedded-gradient"></div>
    <div class="mpv-embedded-controls" @mouseenter="handleControlsEnter" @mouseleave="handleControlsLeave">
      <div class="mpv-control-panel">
        <div class="mpv-control-row">
          <div class="mpv-transport-buttons">
            <button class="mpv-icon-btn" :disabled="!canPlayPrevious" title="上一曲" aria-label="上一曲" type="button" @click="emit('playlistPrev')"><SkipBack :size="21" /></button>
            <button class="mpv-icon-btn mpv-play-btn" :title="playButtonLabel" :aria-label="playButtonLabel" type="button" @click="control(paused ? 'play' : 'pause')">
              <Pause v-if="!paused" :size="18" fill="currentColor" />
              <Play v-else :size="18" fill="currentColor" />
            </button>
            <button class="mpv-icon-btn" :disabled="!canPlayNext" title="下一曲" aria-label="下一曲" type="button" @click="emit('playlistNext')"><SkipForward :size="21" /></button>
            <button class="mpv-icon-btn" :class="{ active: playlistOpen }" title="播放列表" aria-label="播放列表" type="button" @click="togglePlaylist"><ListVideo :size="19" /></button>
            <button class="mpv-icon-btn" :class="{ active: settingsOpen }" title="设置" aria-label="设置" type="button" @click="toggleSettings"><Settings2 :size="19" /></button>
            <button class="mpv-icon-btn mpv-marker-btn" :class="{ active: introSkipSeconds > 0 }" title="设置片头" aria-label="设置片头" type="button" @click="handleIntroSkipToggle"><Flag :size="18" /></button>
            <button class="mpv-icon-btn mpv-marker-btn" :class="{ active: outroSkipSeconds > 0 }" title="设置片尾" aria-label="设置片尾" type="button" @click="handleOutroSkipToggle"><Flag :size="18" /></button>
          </div>
          <label class="mpv-volume-control mpv-inline-volume">
            <span>音量 {{ Math.round(volume) }}%</span>
            <input aria-label="音量" max="100" min="0" step="1" type="range" :style="{ '--mpv-volume': volumePercent }" :value="volume" @change="handleVolumeChange" />
          </label>
        </div>

        <div class="mpv-progress-row">
          <span class="mpv-time mpv-time-current">{{ formatTime(position) }}</span>
          <input class="mpv-embedded-progress" aria-label="播放进度" type="range" min="0" :max="Math.max(duration, 1)" step="0.1" :style="{ '--mpv-progress': progressPercent }" :value="position" @change="handleSeekChange" @input="handleSeekInput" />
          <span class="mpv-time">{{ formatTime(duration) }}</span>
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
              <strong>播放设置</strong>
            </div>
            <button class="mpv-side-close" type="button" aria-label="关闭设置" @click="settingsOpen = false">×</button>
          </div>
          <div class="mpv-settings-tabs">
            <button :class="{ active: settingsTab === 'video' }" type="button" @click="settingsTab = 'video'">视频</button>
            <button :class="{ active: settingsTab === 'audio' }" type="button" @click="settingsTab = 'audio'">音频</button>
            <button :class="{ active: settingsTab === 'subtitle' }" type="button" @click="settingsTab = 'subtitle'">字幕</button>
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
              <div class="mpv-option-grid">
                <button v-for="option in aspectOptions" :key="`aspect-${option.value}`" :class="{ active: aspectRatio === option.value }" type="button" @click="handleAspectRatioChange(option.value)">{{ option.label }}</button>
              </div>
            </section>
            <section class="mpv-side-section">
              <span class="mpv-side-label">裁剪</span>
              <div class="mpv-option-grid">
                <button v-for="option in cropOptions" :key="`crop-${option.value}`" :class="{ active: cropRatio === option.value }" type="button" @click="handleCropRatioChange(option.value)">{{ option.label }}</button>
              </div>
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
              <label class="mpv-side-select-row"><span>清晰度</span><select v-if="qualityOptions.length > 1" :value="props.currentQuality" aria-label="清晰度" @change="handleQualityChange"><option v-for="item in qualityOptions" :key="item.quality || item.html || item.name" :value="item.quality">{{ item.html || item.name || item.label || item.quality }}</option></select><b v-else>{{ qualityLabel }}</b></label>
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
                <input :value="item.state === 'brightness' ? brightness : item.state === 'contrast' ? contrast : item.state === 'saturation' ? saturation : item.state === 'gamma' ? gamma : hue" max="100" min="-100" step="1" type="range" @change="handleVideoFilterChange($event, item.property, item.state)" />
              </label>
            </section>
            <section class="mpv-side-section">
              <span class="mpv-side-label">片头 / 片尾</span>
              <div class="mpv-side-skip-grid">
                <button class="mpv-side-skip" :class="{ active: introSkipSeconds > 0 }" type="button" @click="handleIntroSkipToggle"><span>片头</span><b>{{ introSkipSeconds > 0 ? formatTime(introSkipSeconds) : '设置' }}</b></button>
                <button class="mpv-side-skip" :class="{ active: outroSkipSeconds > 0 }" type="button" @click="handleOutroSkipToggle"><span>片尾</span><b>{{ outroSkipSeconds > 0 ? formatTime(outroSkipSeconds) : '设置' }}</b></button>
              </div>
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
                  <input :value="equalizerBands[index]" max="12" min="-12" step="1" type="range" @change="handleEqualizerChange($event, index)" />
                  <span>{{ frequency >= 1000 ? `${frequency / 1000}k` : frequency }}</span>
                </label>
              </div>
            </section>
          </div>

          <div v-else class="mpv-side-settings-content">
            <section class="mpv-side-section">
              <span class="mpv-side-label">字幕轨道</span>
              <label class="mpv-side-select-row"><span>字幕</span><select :value="subtitleSelectValue" title="字幕" @change="handleSubtitleTrackChange"><option value="track:-1">关闭字幕</option><option v-for="track in subtitleTracks" :key="`sub-${track.id}`" :value="`track:${track.id}`">{{ formatTrackLabel(track) }}</option></select></label>
              <label class="mpv-side-select-row"><span>副字幕</span><select :value="secondarySubtitleSelectValue" title="副字幕" @change="handleSecondarySubtitleTrackChange"><option value="track:-1">关闭副字幕</option><option v-for="track in subtitleTracks" :key="`secondary-sub-${track.id}`" :value="`track:${track.id}`">{{ formatTrackLabel(track) }}</option></select></label>
              <div class="mpv-side-action-row"><button class="mpv-side-action" type="button" @click="handleAddExternalSubtitle">加载字幕…</button><button class="mpv-side-action" type="button" @click="openSubtitleSearchModal"><Captions :size="15" /> 在线查找</button></div>
            </section>
            <section class="mpv-side-section">
              <div class="mpv-subtitle-mode-tabs"><button class="active" type="button">主字幕</button><button type="button">二级字幕</button></div>
              <label class="mpv-side-slider"><span>字幕延迟 <b>{{ subtitleDelay.toFixed(1) }}s</b></span><input :value="subtitleDelay" max="5" min="-5" step="0.1" type="range" @change="handleSubtitleDelayChange" /></label>
              <label class="mpv-side-slider"><span>位置 <b>{{ subtitlePosition }}</b></span><input :value="subtitlePosition" max="100" min="0" step="1" type="range" @change="handleSubtitlePositionChange" /></label>
              <label class="mpv-side-slider"><span>缩放 <b>{{ subtitleScale.toFixed(2) }}</b></span><input :value="subtitleScale" max="3" min="0.25" step="0.05" type="range" @change="handleSubtitleScaleChange" /></label>
            </section>
            <section class="mpv-side-section">
              <span class="mpv-side-label">文字样式</span>
              <label class="mpv-side-slider"><span>字号 <b>{{ subtitleFontSize }}</b></span><input :value="subtitleFontSize" max="80" min="20" step="1" type="range" @change="handleSubtitleSizeChange" /></label>
              <label class="mpv-side-slider"><span>描边 <b>{{ subtitleBorderSize }}</b></span><input :value="subtitleBorderSize" max="10" min="0" step="1" type="range" @change="handleSubtitleBorderSizeChange" /></label>
              <div class="mpv-side-style-row"><label><input :checked="subtitleBold" type="checkbox" @change="handleSubtitleBoldChange" /> 粗体</label><label><input :checked="subtitleItalic" type="checkbox" @change="handleSubtitleItalicChange" /> 斜体</label><label>颜色 <input :value="subtitleColor" type="color" aria-label="字幕颜色" @change="handleSubtitleColorChange" /></label></div>
              <div class="mpv-side-style-row"><label>描边色 <input :value="subtitleBorderColor" type="color" aria-label="描边颜色" @change="handleSubtitleBorderColorChange" /></label><label>背景 <input :value="subtitleBackgroundColor" type="color" aria-label="背景颜色" @change="handleSubtitleBackgroundColorChange" /></label></div>
            </section>
          </div>
        </template>
      </aside>
  </div>
</template>

<style scoped lang="less">
.mpv-embedded-surface {
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
  background: linear-gradient(to right, rgba(113, 255, 161, .92) var(--mpv-progress, 0%), rgba(255, 255, 255, .16) var(--mpv-progress, 0%));
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
  background:
    radial-gradient(circle at 12% 0, rgba(122, 255, 170, .12), transparent 36%),
    linear-gradient(180deg, rgba(22, 27, 34, .98), rgba(8, 10, 14, .96));
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
  background: rgba(22, 27, 34, .98);
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
  background: rgba(11, 13, 18, .96);
  box-shadow: 0 28px 80px rgba(0, 0, 0, .56);
  overflow: hidden;
}

:global(.mpv-subtitle-search-modal-body) {
  padding: 0;
  background: #0b0d12;
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
  background: radial-gradient(circle at 18% 0, rgba(63, 131, 255, .14), transparent 42%), linear-gradient(180deg, rgba(255, 255, 255, .07), rgba(255, 255, 255, .02));
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
  height: 132px;
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
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.mpv-equalizer-band input {
  width: 112px;
  height: 18px;
  accent-color: #b6dff2;
  cursor: pointer;
  transform: rotate(-90deg);
  transform-origin: center center;
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
