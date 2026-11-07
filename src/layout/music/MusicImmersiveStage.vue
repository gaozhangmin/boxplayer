<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, shallowRef } from 'vue'
import { FileText } from 'lucide-vue-next'
import * as THREE from 'three'
import { RealtimeBeatEngine, type RealtimeBeatState } from '../../utils/radio'
import { BloomEffect } from '../../utils/radio/BloomEffect'
import { CinemaCamera } from '../../utils/radio/CinemaCamera'
import { extractCoverPalette } from '../../utils/radio/CoverColorExtractor'
import { ShelfManager, type ShelfCard } from '../../utils/radio/ShelfManager'
import { FreeCamera } from '../../utils/radio/FreeCamera'
import { StageLyrics } from '../../utils/radio/StageLyrics'
import { applySkullPointBuffer, createSkullPreset, SKULL_PRESET_ASSET } from '../../utils/radio/SkullPreset'
import { getParticleDensityScale, getRenderPixelRatio } from '../../utils/radio/RenderPerformanceManager'
import type { LyricLine } from '../../utils/musicMetadata'
import { getAudioAnalyser } from '../../module/audioplayer'
import { t as tt } from '../../i18n'

type OfflineBeatMap = {
  mode: 'mr' | 'dj'
  bpm: number
  peaks: number
  peakTimes: number[]
  beats?: OfflineBeatEvent[]
  pulseBeats?: OfflineBeatEvent[]
  cameraBeats?: OfflineBeatEvent[]
  duration: number
  updatedAt: number
}

type OfflineBeatEvent = {
  time: number
  strength?: number
  confidence?: number
  impact?: number
  combo?: 'downbeat' | 'push' | 'drop' | 'rebound' | 'accent'
  low?: number
  body?: number
  snap?: number
  mass?: number
  sharpness?: number
  pulse?: boolean
  camera?: boolean
  primary?: boolean
  index?: number
}

const props = defineProps<{
  coverUrl: string
  title: string
  artist: string
  playing: boolean
  showLyrics: boolean
  hasLyrics: boolean
  metaLoad: boolean
  lyricLines: LyricLine[]
  activeLine: number
  currentTime: number
  lyricDebugText: string
  lyricDebugTitle: string
  audioEl?: HTMLAudioElement | null
  beatMap?: OfflineBeatMap | null
  customBackgroundUrl?: string
  customBackgroundType?: 'image' | 'video'
  visualFx?: {
    intensity: number
    depth: number
    scatter: number
    twist: number
    point: number
    bloom: number
    speed?: number
    colorTension?: number
    bgFade?: number
    cinemaShake?: number
    lyricGlowStrength?: number
    coverResolution: number
    uiAccentColor?: string
    visualTintColor?: string
    backgroundColor?: string
    shelfMode?: 'off' | 'side' | 'stage'
    shelfCameraMode?: 'static' | 'dynamic'
    shelfPresence?: 'auto' | 'always'
    shelfSize?: number
    shelfOffsetX?: number
    shelfOffsetY?: number
    shelfOffsetZ?: number
    shelfAngleY?: number
    shelfOpacity?: number
    shelfBgOpacity?: number
    shelfAccentColor?: string
    backgroundOpacity?: number
    bloomEnabled?: boolean
    cinemaEnabled?: boolean
    floatLayerEnabled?: boolean
    edgeHighlightEnabled?: boolean
    backCoverEnabled?: boolean
    beatGlowEnabled?: boolean
    colorLabEnabled?: boolean
    lyricGlowParticlesEnabled?: boolean
    lyricCameraLockEnabled?: boolean
    wallpaperModeEnabled?: boolean
    glassChromaticOffset?: number
    skullPresetEnabled?: boolean
    performanceManagerEnabled?: boolean
    liveBackgroundKeep?: boolean
    gestureControlEnabled?: boolean
    lyricGlowEnabled?: boolean
    renderQuality?: 'auto' | 'keep' | 'release'
    lyricSourceMode?: 'original' | 'custom'
    lyricFontFamily?: 'system' | 'serif' | 'gothic' | 'mono'
    lyricSize?: number
    lyricLineHeight?: number
    lyricLetterSpacing?: number
    lyricWeight?: number
    lyricOffsetX?: number
    lyricOffsetY?: number
    lyricOffsetZ?: number
    lyricRotateX?: number
    lyricRotateY?: number
    lyricPrimaryColor?: string
    lyricActiveColor?: string
    lyricGlowColor?: string
  }
  shelfCards?: ShelfCard[]
  onShelfBoundaryScroll?: (direction: -1 | 1) => boolean
}>()


const beatEngine = new RealtimeBeatEngine()
const bloomFx = new BloomEffect()
const cinemaCam = new CinemaCamera()
const stageLyrics = new StageLyrics()
const freeCam = new FreeCamera()
const shelfMgr = new ShelfManager()
shelfMgr.onCardClick = (card) => emit('shelf-card-click', card)
shelfMgr.onTrackClick = (track) => emit('shelf-track-click', track)
shelfMgr.onTrackNext = (track) => emit('shelf-track-next', track)
shelfMgr.onTrackCollect = (track) => emit('shelf-track-collect', track)
shelfMgr.onBoundaryScroll = (direction) => props.onShelfBoundaryScroll?.(direction) || false
let beatState: RealtimeBeatState = { pulse: 0, rawOnset: 0, bass: 0, body: 0, snap: 0, hitCount: 0, msSinceLastHit: 9999, justHit: false, hitStrength: 0, cam: { thetaKick: 0, phiKick: 0, radiusKick: 0, rollKick: 0 } }

const emit = defineEmits<{
  (e: 'seek-lyric', time: number): void
  (e: 'shelf-card-click', card: ShelfCard): void
  (e: 'shelf-track-click', track: any): void
  (e: 'shelf-track-next', track: any): void
  (e: 'shelf-track-collect', track: any): void
}>()

const canvasRef = shallowRef<HTMLCanvasElement | null>(null)
const lyricRef = shallowRef<HTMLElement | null>(null)
const shelfCenterCard = ref<ShelfCard | null>(null)
const shelfCenterIndex = ref(-1)
const shelfDetailExpanded = ref(false)
const shelfContentVisible = ref(false)
const shelfCueVisible = ref(false)
const shouldShowShelfDetail = computed(() => fx.value.shelfMode !== 'off' && !!shelfCenterCard.value && !shelfContentVisible.value && (fx.value.shelfPresence === 'always' || shelfDetailExpanded.value))
let shelfDetailTimer = 0
shelfMgr.onCenterChange = (card, index) => {
  shelfCenterCard.value = card
  shelfCenterIndex.value = index
  revealShelfDetail(false)
}
let raf = 0
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let coverParticles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null
let bloomParticles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null
let backCoverParticles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null
let edgeParticles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null
let particleField: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null
let dustField: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null
let glowField: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null
let nearField: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null
let skullField: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null
let resizeObserver: ResizeObserver | null = null
let analyser: AnalyserNode | null = null
let frequencyData: Uint8Array<ArrayBuffer> | null = null
let reducedMotion = false
let lastParticleWidth = 0
let lastParticleHeight = 0
let smoothedEnergy = 0
let lastEnergy = 0
let beatPulse = 0
let offlineBeatPulse = 0
let offlineBeatIndex = 0
let offlineBeatSignature = ''
let lastOfflineBeatTime = 0
let lastOfflineHitIndex = -1
let coverLoadToken = 0
let lastStageLyricKey = ''
let lastScrolledLyric = -1
let shelfDetailLyricMix = 0
let dotTexture: THREE.CanvasTexture | null = null
let skullAssetLoaded = false
const pointer = new THREE.Vector2(0, 0)
const pointerTarget = new THREE.Vector2(0, 0)
const shelfRaycaster = new THREE.Raycaster()
const coverRotation = new THREE.Vector2(0, 0)
const coverRotationTarget = new THREE.Vector2(0, 0)
const coverScaleTarget = new THREE.Vector3(1, 1, 1)
const cameraLookTarget = new THREE.Vector3(0, 0, 0)
let dragActive = false
let dragLastX = 0
let dragLastY = 0

const stageStyle = computed(() => {
  const image = props.customBackgroundType === 'image' && props.customBackgroundUrl ? props.customBackgroundUrl : props.coverUrl
  return {
    backgroundColor: fx.value.backgroundColor,
    ...(image ? { backgroundImage: `url(${image})` } : {})
  }
})
const fx = computed(() => ({
  intensity: props.visualFx?.intensity ?? 0.92,
  depth: props.visualFx?.depth ?? 1,
  scatter: props.visualFx?.scatter ?? 0.32,
  twist: props.visualFx?.twist ?? 0.58,
  point: props.visualFx?.point ?? 1,
  bloom: props.visualFx?.bloom ?? 0.48,
  speed: props.visualFx?.speed ?? 1,
  colorTension: props.visualFx?.colorTension ?? 1,
  bgFade: props.visualFx?.bgFade ?? 0.42,
  cinemaShake: props.visualFx?.cinemaShake ?? 0.74,
  lyricGlowStrength: props.visualFx?.lyricGlowStrength ?? 0.44,
  coverResolution: props.visualFx?.coverResolution ?? 1.08,
  uiAccentColor: props.visualFx?.uiAccentColor ?? '#00f5d4',
  visualTintColor: props.visualFx?.visualTintColor ?? '#9db8cf',
  backgroundColor: props.visualFx?.backgroundColor ?? '#000000',
  shelfMode: props.visualFx?.shelfMode ?? 'side',
  shelfCameraMode: props.visualFx?.shelfCameraMode ?? 'static',
  shelfPresence: props.visualFx?.shelfPresence ?? 'always',
  shelfSize: props.visualFx?.shelfSize ?? 1,
  shelfOffsetX: props.visualFx?.shelfOffsetX ?? 0,
  shelfOffsetY: props.visualFx?.shelfOffsetY ?? 0,
  shelfOffsetZ: props.visualFx?.shelfOffsetZ ?? 0,
  shelfAngleY: props.visualFx?.shelfAngleY ?? -15,
  shelfOpacity: props.visualFx?.shelfOpacity ?? 0.88,
  shelfBgOpacity: props.visualFx?.shelfBgOpacity ?? 0.82,
  shelfAccentColor: props.visualFx?.shelfAccentColor ?? '#f4d28a',
  backgroundOpacity: props.visualFx?.backgroundOpacity ?? 0.84,
  bloomEnabled: props.visualFx?.bloomEnabled ?? true,
  cinemaEnabled: props.visualFx?.cinemaEnabled ?? true,
  floatLayerEnabled: props.visualFx?.floatLayerEnabled ?? true,
  edgeHighlightEnabled: props.visualFx?.edgeHighlightEnabled ?? false,
  backCoverEnabled: props.visualFx?.backCoverEnabled ?? false,
  beatGlowEnabled: props.visualFx?.beatGlowEnabled ?? true,
  colorLabEnabled: props.visualFx?.colorLabEnabled ?? false,
  lyricGlowParticlesEnabled: props.visualFx?.lyricGlowParticlesEnabled ?? false,
  lyricCameraLockEnabled: props.visualFx?.lyricCameraLockEnabled ?? false,
  wallpaperModeEnabled: props.visualFx?.wallpaperModeEnabled ?? false,
  glassChromaticOffset: props.visualFx?.glassChromaticOffset ?? 0.5,
  skullPresetEnabled: props.visualFx?.skullPresetEnabled ?? false,
  performanceManagerEnabled: props.visualFx?.performanceManagerEnabled ?? true,
  liveBackgroundKeep: props.visualFx?.liveBackgroundKeep ?? false,
  gestureControlEnabled: props.visualFx?.gestureControlEnabled ?? false,
  lyricGlowEnabled: props.visualFx?.lyricGlowEnabled ?? true,
  renderQuality: props.visualFx?.renderQuality ?? 'auto',
  lyricSourceMode: props.visualFx?.lyricSourceMode ?? 'original',
  lyricFontFamily: props.visualFx?.lyricFontFamily ?? 'system',
  lyricSize: props.visualFx?.lyricSize ?? 1,
  lyricLineHeight: props.visualFx?.lyricLineHeight ?? 1.18,
  lyricLetterSpacing: props.visualFx?.lyricLetterSpacing ?? 0,
  lyricWeight: props.visualFx?.lyricWeight ?? 760,
  lyricOffsetX: props.visualFx?.lyricOffsetX ?? 0,
  lyricOffsetY: props.visualFx?.lyricOffsetY ?? 0,
  lyricOffsetZ: props.visualFx?.lyricOffsetZ ?? 0,
  lyricRotateX: props.visualFx?.lyricRotateX ?? 0,
  lyricRotateY: props.visualFx?.lyricRotateY ?? 0,
  lyricPrimaryColor: props.visualFx?.lyricPrimaryColor ?? '#a9b8c8',
  lyricActiveColor: props.visualFx?.lyricActiveColor ?? '#fff9e8',
  lyricGlowColor: props.visualFx?.lyricGlowColor ?? '#00f5d4'
}))

const lyricStageStyle = computed(() => {
  const visual = fx.value
  return {
    '--music-lyric-size': `${visual.lyricSize}`,
    '--music-lyric-line-height': `${visual.lyricLineHeight}`,
    '--music-lyric-letter-spacing': `${visual.lyricLetterSpacing}em`,
    '--music-lyric-weight': `${visual.lyricWeight}`,
    '--music-lyric-font': visual.lyricFontFamily === 'serif' ? 'Georgia, "Songti SC", serif' : visual.lyricFontFamily === 'gothic' ? '"PingFang SC", "Microsoft YaHei", sans-serif' : visual.lyricFontFamily === 'mono' ? '"SFMono-Regular", Consolas, monospace' : 'inherit',
    '--music-lyric-idle': visual.lyricPrimaryColor,
    '--music-lyric-active': visual.lyricActiveColor,
    '--music-lyric-glow': visual.lyricGlowColor
  }
})

const stageBgFilter = computed(() => `blur(120px) brightness(${Math.max(0.12, 0.78 - fx.value.bgFade * 0.52).toFixed(2)}) saturate(${(1.2 + fx.value.colorTension * 0.32).toFixed(2)})`)

function syncStageLyricConfig() {
  const visual = fx.value
  stageLyrics.config.fontSize = Math.round(42 * visual.lyricSize)
  stageLyrics.config.fontWeight = String(Math.round(visual.lyricWeight))
  stageLyrics.config.primaryColor = visual.lyricPrimaryColor
  stageLyrics.config.highlightColor = visual.lyricActiveColor
  stageLyrics.config.glowColor = visual.lyricGlowColor
  stageLyrics.config.sparkColor = visual.lyricActiveColor
  stageLyrics.config.lineHeightFactor = visual.lyricLineHeight
  stageLyrics.config.letterSpacing = visual.lyricLetterSpacing
  stageLyrics.config.glowStrength = visual.lyricGlowEnabled ? Math.max(0.02, visual.lyricGlowStrength) : 0
  stageLyrics.config.beatGlowEnabled = visual.lyricGlowEnabled && visual.bloomEnabled && visual.beatGlowEnabled
  stageLyrics.config.glowParticles = visual.lyricGlowEnabled && visual.lyricGlowParticlesEnabled && visual.renderQuality !== 'release'
  stageLyrics.group.position.set(visual.lyricOffsetX, visual.lyricOffsetY, visual.lyricOffsetZ)
  stageLyrics.group.rotation.set(THREE.MathUtils.degToRad(visual.lyricRotateX), THREE.MathUtils.degToRad(visual.lyricRotateY), 0)
}

function createDotTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createRadialGradient(48, 48, 0, 48, 48, 48)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.34, 'rgba(255,255,255,.92)')
    gradient.addColorStop(0.72, 'rgba(255,255,255,.24)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 96, 96)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function createParticleField(width: number, height: number, density: number, spread: { x: number; y: number; z: number }, color: number, size: number, opacity: number) {
  const densityScale = fx.value.performanceManagerEnabled ? getParticleDensityScale(fx.value.renderQuality, fx.value.liveBackgroundKeep ? false : document.hidden) : 1
  const count = Math.max(160, Math.floor((width * height) / (density * densityScale)))
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * spread.x
    positions[i * 3 + 1] = (Math.random() - 0.5) * spread.y
    positions[i * 3 + 2] = -2 - Math.random() * spread.z
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color,
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  return new THREE.Points(geometry, material)
}

function coverParticleGridForSize(width: number, height: number) {
  const area = Math.max(320 * 240, width * height)
  const resolution = Math.max(0.72, Math.min(1.55, fx.value.coverResolution))
  const scale = Math.sqrt(resolution)
  if (reducedMotion) return 54
  if (area > 1500 * 850) return Math.round(118 * scale)
  if (area > 980 * 640) return Math.round(104 * scale)
  return Math.round(88 * scale)
}

function fallbackColorForParticle(i: number, rand: number) {
  const t = (Math.sin(i * 12.9898 + rand * 78.233) + 1) * 0.5
  const teal = new THREE.Color(0x8ff5ea)
  const amber = new THREE.Color(0xf4d28a)
  const blue = new THREE.Color(0x6077ff)
  const c = teal.clone().lerp(t > 0.55 ? amber : blue, t > 0.55 ? (t - 0.55) / 0.45 : t / 0.55)
  return c
}

function colorUniform(hex: string) {
  try {
    const c = new THREE.Color(hex)
    return new THREE.Vector3(c.r, c.g, c.b)
  } catch {
    return new THREE.Vector3(0.62, 0.72, 0.82)
  }
}

function buildCoverParticleGeometry(coverCanvas: HTMLCanvasElement | null, width: number, height: number) {
  const grid = coverParticleGridForSize(width, height)
  const count = grid * grid
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const luminosity = new Float32Array(count)
  const randoms = new Float32Array(count)
  const plane = Math.max(7.2, Math.min(10.2, Math.min(width, height) / 82))
  let pixels: Uint8ClampedArray | null = null
  let cw = 0
  let ch = 0

  if (coverCanvas) {
    try {
      const ctx = coverCanvas.getContext('2d', { willReadFrequently: true })
      const image = ctx?.getImageData(0, 0, coverCanvas.width, coverCanvas.height)
      pixels = image?.data || null
      cw = coverCanvas.width
      ch = coverCanvas.height
    } catch {
      pixels = null
    }
  }

  for (let i = 0; i < count; i += 1) {
    const gx = i % grid
    const gy = Math.floor(i / grid)
    const px = gx / Math.max(1, grid - 1)
    const py = gy / Math.max(1, grid - 1)
    const rand = Math.random()
    const x = (px - 0.5) * plane
    const y = (0.5 - py) * plane
    const d = Math.hypot(px - 0.5, py - 0.5)
    positions[i * 3] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = -0.3 - d * 1.4 + (rand - 0.5) * 0.18
    randoms[i] = rand

    let r = 0
    let g = 0
    let b = 0
    if (pixels && cw && ch) {
      const sx = Math.max(0, Math.min(cw - 1, Math.floor(px * cw)))
      const sy = Math.max(0, Math.min(ch - 1, Math.floor(py * ch)))
      const idx = (sy * cw + sx) * 4
      r = pixels[idx] / 255
      g = pixels[idx + 1] / 255
      b = pixels[idx + 2] / 255
    } else {
      const c = fallbackColorForParticle(i, rand)
      r = c.r
      g = c.g
      b = c.b
    }
    const lum = r * 0.299 + g * 0.587 + b * 0.114
    colors[i * 3] = Math.min(1.25, r * (0.76 + lum * 0.52))
    colors[i * 3 + 1] = Math.min(1.25, g * (0.76 + lum * 0.52))
    colors[i * 3 + 2] = Math.min(1.25, b * (0.76 + lum * 0.52))
    luminosity[i] = lum
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aLum', new THREE.BufferAttribute(luminosity, 1))
  geometry.setAttribute('aRand', new THREE.BufferAttribute(randoms, 1))
  return geometry
}

const coverVertexShader = `
  precision highp float;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uBeat;
  uniform float uPixel;
  uniform float uPointScale;
  uniform float uScatter;
  uniform float uTwist;
  uniform float uDepth;
  uniform vec2 uPointer;
  attribute vec3 aColor;
  attribute float aLum;
  attribute float aRand;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vLum;
  void main() {
    vec3 pos = position;
    float radial = length(pos.xy) / 5.2;
    float wave = sin(uTime * (0.56 + aRand * 0.52) + radial * 9.0 + aRand * 6.283);
    float pulse = uBeat * (0.35 + aRand * 0.95) + uEnergy * 0.18;
    float angle = (uTwist * 0.26 + uEnergy * 0.18 + uBeat * 0.14) * radial;
    float s = sin(angle);
    float c = cos(angle);
    pos.xy = mat2(c, -s, s, c) * pos.xy;
    vec2 dir = normalize(pos.xy + vec2(0.001));
    pos.xy += dir * (uScatter * radial * (0.12 + uEnergy * 0.72) + pulse * 0.32);
    pos.x += uPointer.x * (0.24 + radial * 0.20);
    pos.y += uPointer.y * (0.18 + radial * 0.16);
    pos.z += wave * uDepth * (0.25 + radial) + pulse * (0.62 + radial * 0.55);
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float dist = max(4.2, -mvPosition.z);
    float size = (3.6 + aLum * 6.2 + pulse * 8.6 + uEnergy * 2.4) * uPixel * uPointScale * (10.0 / dist);
    gl_PointSize = size;
    gl_Position = projectionMatrix * mvPosition;
    vColor = aColor;
    vLum = aLum;
    vAlpha = clamp(0.32 + aLum * 0.92 + uEnergy * 0.20 + uBeat * 0.34, 0.16, 1.38);
  }
`

const coverFragmentShader = `
  precision highp float;
  uniform sampler2D uDotTex;
  uniform float uAlpha;
  uniform float uEnergy;
  uniform float uColorTension;
  uniform vec3 uTint;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vLum;
  void main() {
    vec4 dotTex = texture2D(uDotTex, gl_PointCoord);
    if (dotTex.a < 0.015) discard;
    vec3 tuned = mix(vec3(dot(vColor, vec3(0.299, 0.587, 0.114))), vColor, uColorTension);
    vec3 color = mix(tuned, uTint, 0.16 * clamp(uColorTension, 0.0, 2.0)) * (0.72 + vLum * 0.62 + uEnergy * 0.30);
    color += vec3(0.05, 0.09, 0.10) * smoothstep(0.58, 1.0, vLum) * (0.55 + uEnergy);
    gl_FragColor = vec4(color, dotTex.a * vAlpha * uAlpha);
  }
`

function createCoverMaterial(bloom = false) {
  if (!dotTexture) dotTexture = createDotTexture()
  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uEnergy: { value: 0 },
    uBeat: { value: 0 },
    uPixel: { value: Math.min(window.devicePixelRatio || 1, 2) },
    uPointScale: { value: bloom ? 2.55 : 1.02 },
    uScatter: { value: bloom ? 0.34 : 0.18 },
    uTwist: { value: 0.58 },
    uDepth: { value: bloom ? 0.50 : 0.34 },
    uColorTension: { value: 1 },
    uTint: { value: colorUniform('#9db8cf') },
    uPointer: { value: pointer },
    uAlpha: { value: bloom ? 0.34 : 0.98 },
    uDotTex: { value: dotTexture }
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: coverVertexShader,
    fragmentShader: coverFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: !bloom,
    blending: bloom ? THREE.AdditiveBlending : THREE.NormalBlending
  })
  return material
}

function disposeCoverParticles() {
  if (coverParticles) {
    scene?.remove(coverParticles)
    coverParticles.geometry.dispose()
    coverParticles.material.dispose()
    coverParticles = null
  }
  if (bloomParticles) {
    scene?.remove(bloomParticles)
    bloomParticles.geometry.dispose()
    bloomParticles.material.dispose()
    bloomParticles = null
  }
  if (backCoverParticles) {
    scene?.remove(backCoverParticles)
    backCoverParticles.geometry.dispose()
    backCoverParticles.material.dispose()
    backCoverParticles = null
  }
  if (edgeParticles) {
    scene?.remove(edgeParticles)
    edgeParticles.geometry.dispose()
    edgeParticles.material.dispose()
    edgeParticles = null
  }
}

function installCoverParticles(coverCanvas: HTMLCanvasElement | null) {
  if (!scene) return
  const parent = canvasRef.value?.parentElement
  const rect = parent?.getBoundingClientRect()
  const geometry = buildCoverParticleGeometry(coverCanvas, rect?.width || lastParticleWidth || 960, rect?.height || lastParticleHeight || 540)
  disposeCoverParticles()
  backCoverParticles = new THREE.Points(geometry.clone(), createCoverMaterial(false))
  bloomParticles = new THREE.Points(geometry.clone(), createCoverMaterial(true))
  edgeParticles = new THREE.Points(geometry.clone(), createCoverMaterial(true))
  coverParticles = new THREE.Points(geometry, createCoverMaterial(false))
  backCoverParticles.frustumCulled = false
  bloomParticles.frustumCulled = false
  edgeParticles.frustumCulled = false
  coverParticles.frustumCulled = false
  backCoverParticles.renderOrder = 0
  bloomParticles.renderOrder = 1
  coverParticles.renderOrder = 2
  edgeParticles.renderOrder = 3
  backCoverParticles.visible = false
  edgeParticles.visible = false
  scene.add(backCoverParticles, bloomParticles, coverParticles, edgeParticles)
}

function drawImageToCoverCanvas(img: HTMLImageElement) {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.clearRect(0, 0, size, size)
  const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height)
  const sx = Math.max(0, ((img.naturalWidth || img.width) - side) / 2)
  const sy = Math.max(0, ((img.naturalHeight || img.height) - side) / 2)
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
  return canvas
}

function loadCoverParticleSource(url: string) {
  const token = ++coverLoadToken
  if (!url) {
    installCoverParticles(null)
    return
  }
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.decoding = 'async'
  img.onload = () => {
    if (token !== coverLoadToken) return
    installCoverParticles(drawImageToCoverCanvas(img))
  }
  img.onerror = () => {
    if (token !== coverLoadToken) return
    installCoverParticles(null)
  }
  img.src = url
}

function disposeParticle(field: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null) {
  if (!field) return
  scene?.remove(field)
  field.geometry.dispose()
  field.material.dispose()
}

function rebuildParticles(width: number, height: number) {
  disposeParticle(particleField)
  disposeParticle(dustField)
  disposeParticle(glowField)
  disposeParticle(nearField)
  particleField = createParticleField(width, height, 760, { x: 48, y: 30, z: 32 }, 0x8ff5ea, 0.20, props.playing ? 0.98 : 0.78)
  dustField = createParticleField(width, height, 1250, { x: 70, y: 42, z: 58 }, 0xb8c9dc, 0.105, props.playing ? 0.74 : 0.48)
  glowField = createParticleField(width, height, 5400, { x: 34, y: 22, z: 24 }, 0xf4d28a, 0.34, props.playing ? 0.82 : 0.54)
  nearField = createParticleField(width, height, 2600, { x: 26, y: 18, z: 12 }, 0xffffff, 0.18, props.playing ? 0.56 : 0.34)
  lastParticleWidth = width
  lastParticleHeight = height
  scene?.add(dustField, particleField, glowField, nearField)
}

function resizeScene() {
  const canvas = canvasRef.value
  const parent = canvas?.parentElement
  if (!canvas || !parent || !renderer || !camera || !scene) return
  const dpr = fx.value.performanceManagerEnabled ? getRenderPixelRatio(fx.value.renderQuality, fx.value.liveBackgroundKeep ? false : document.hidden) : Math.min(window.devicePixelRatio || 1, 2)
  const rect = parent.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  renderer.setPixelRatio(dpr)
  renderer.setSize(rect.width, rect.height, false)
  camera.aspect = rect.width / Math.max(1, rect.height)
  camera.updateProjectionMatrix()
  if (coverParticles || bloomParticles || backCoverParticles || edgeParticles) {
    for (const field of [coverParticles, bloomParticles, backCoverParticles, edgeParticles]) {
      if (field?.material.uniforms.uPixel) field.material.uniforms.uPixel.value = dpr
    }
  }
  if (!lastParticleWidth || Math.abs(rect.width - lastParticleWidth) > 96 || Math.abs(rect.height - lastParticleHeight) > 72) {
    rebuildParticles(rect.width, rect.height)
  }
}

function initScene() {
  const canvas = canvasRef.value
  if (!canvas) return
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(58, 1, 0.1, 90)
  camera.position.z = 18
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  bloomFx.attach(renderer, scene, camera)
  scene.add(shelfMgr.group)
  scene.add(stageLyrics.group)
  skullField = createSkullPreset(fx.value.shelfAccentColor)
  skullField.visible = false
  scene.add(skullField)
  loadSkullPresetAsset()
  freeCam.attach()
  renderer.setClearAlpha(0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  resizeScene()
  loadCoverParticleSource(props.coverUrl)
}

async function loadSkullPresetAsset() {
  if (!skullField || skullAssetLoaded) return
  try {
    const res = await fetch(SKULL_PRESET_ASSET)
    if (!res.ok) return
    const buffer = await res.arrayBuffer()
    if (!skullField) return
    skullAssetLoaded = applySkullPointBuffer(skullField, buffer, fx.value.shelfAccentColor)
  } catch {
    skullAssetLoaded = false
  }
}

function ensureAnalyser() {
  if (!props.audioEl || analyser || reducedMotion) return
  try {
    const nextAnalyser = getAudioAnalyser()
    if (!nextAnalyser) return
    analyser = nextAnalyser
    frequencyData = new Uint8Array(nextAnalyser.frequencyBinCount) as Uint8Array<ArrayBuffer>
  } catch {
    analyser = null
    beatEngine.reset()
    frequencyData = null
  }
}

function readOfflineBeatPulse() {
  offlineBeatPulse *= 0.86
  const map = props.beatMap
  const beatEvents = (map?.cameraBeats?.length ? map.cameraBeats : map?.pulseBeats?.length ? map.pulseBeats : map?.beats?.length ? map.beats : null) || []
  const peaks = beatEvents.length ? beatEvents.map((beat) => beat.time) : map?.peakTimes || []
  if (!props.playing || !peaks.length || reducedMotion) return offlineBeatPulse

  const signature = `${map?.mode || 'mr'}:${map?.updatedAt || 0}:${peaks.length}`
  const current = props.currentTime || 0
  if (signature !== offlineBeatSignature || current + 0.25 < lastOfflineBeatTime) {
    offlineBeatSignature = signature
    offlineBeatIndex = 0
    lastOfflineHitIndex = -1
  }
  lastOfflineBeatTime = current

  while (offlineBeatIndex < peaks.length - 1 && peaks[offlineBeatIndex] < current - 0.08) offlineBeatIndex += 1
  const hitTime = peaks[offlineBeatIndex]
  const hitWindow = map?.mode === 'dj' ? 0.095 : 0.075
  if (Math.abs(hitTime - current) <= hitWindow && offlineBeatIndex !== lastOfflineHitIndex) {
    lastOfflineHitIndex = offlineBeatIndex
    const event = beatEvents[offlineBeatIndex]
    const impact = Math.max(0.22, Math.min(1, event?.impact ?? event?.strength ?? (map?.mode === 'dj' ? 0.92 : 0.72)))
    const low = Math.max(0.18, Math.min(1, event?.low ?? impact * 0.72))
    const body = Math.max(0.12, Math.min(1, event?.body ?? impact * 0.34))
    const snap = Math.max(0.08, Math.min(1, event?.snap ?? impact * 0.18))
    offlineBeatPulse = Math.min(1, offlineBeatPulse + impact)
    beatState = {
      ...beatState,
      pulse: Math.max(beatState.pulse, impact),
      rawOnset: Math.max(beatState.rawOnset, impact),
      bass: Math.max(beatState.bass, low),
      body: Math.max(beatState.body, body),
      snap: Math.max(beatState.snap, snap),
      justHit: impact > 0.42,
      hitStrength: Math.max(beatState.hitStrength, impact),
      cam: {
        thetaKick: beatState.cam.thetaKick + (event?.combo === 'downbeat' ? 0.048 : 0.028) * impact,
        phiKick: beatState.cam.phiKick + (event?.combo === 'accent' ? -0.026 : 0.018) * impact,
        radiusKick: beatState.cam.radiusKick + 0.16 * impact,
        rollKick: beatState.cam.rollKick + (event?.sharpness ?? snap) * 0.022
      }
    }
  }
  return offlineBeatPulse
}

function readAudioEnergy(time: number) {
  if (props.playing) ensureAnalyser()
  let target = props.playing ? 0.28 + Math.sin(time * 1.7) * 0.08 : 0.06
  if (analyser && frequencyData) {
    analyser.getByteFrequencyData(frequencyData)
    beatState = beatEngine.update(frequencyData, 16, props.playing)
    target = beatState.bass * 0.78 + beatState.body * 0.36
  }
  const offlinePulse = readOfflineBeatPulse()
  if (offlinePulse > 0.12) {
    target += offlinePulse * 0.28
    beatPulse = Math.min(1, beatPulse + offlinePulse * 0.32)
  }
  smoothedEnergy += (target - smoothedEnergy) * 0.16
  const rise = smoothedEnergy - lastEnergy
  if (props.playing && rise > 0.055 && smoothedEnergy > 0.18) beatPulse = Math.min(1, beatPulse + rise * 5.2 + smoothedEnergy * 0.18)
  lastEnergy = smoothedEnergy
  return smoothedEnergy
}

function syncStageLyric() {
  syncStageLyricConfig()
  if (!props.showLyrics || !props.hasLyrics || props.activeLine < 0) {
    if (lastStageLyricKey) {
      stageLyrics.clear()
      lastStageLyricKey = ''
    }
    return
  }

  const line = props.lyricLines[props.activeLine]
  if (!line?.text) return
  const nextLine = props.lyricLines[props.activeLine + 1]
  const span = Math.max(0.8, (nextLine?.time ?? line.time + 4) - line.time)
  const progress = Math.max(0.02, Math.min(1, (props.currentTime - line.time) / span))
  const visual = fx.value
  const key = `${props.activeLine}:${line.time}:${line.text}:${visual.lyricSize}:${visual.lyricLineHeight}:${visual.lyricLetterSpacing}:${visual.lyricWeight}:${visual.lyricPrimaryColor}:${visual.lyricActiveColor}:${visual.lyricGlowColor}:${visual.lyricGlowEnabled}:${visual.renderQuality}`
  if (key !== lastStageLyricKey) {
    stageLyrics.show(line.text, progress)
    lastStageLyricKey = key
  } else {
    stageLyrics.updateCurrentProgress(progress)
  }
}

function syncCoverMaterial(material: THREE.ShaderMaterial, time: number, energy: number, alphaScale = 1) {
  const visual = fx.value
  material.uniforms.uTime.value = time
  material.uniforms.uEnergy.value = energy * visual.intensity
  material.uniforms.uBeat.value = visual.beatGlowEnabled ? beatPulse : 0
  material.uniforms.uPixel.value = Math.min(window.devicePixelRatio || 1, 2)
  material.uniforms.uAlpha.value = alphaScale
  material.uniforms.uPointer.value = pointer
  material.uniforms.uPointScale.value = material.depthTest ? visual.point : visual.point * 2.55
  material.uniforms.uScatter.value = visual.scatter
  material.uniforms.uTwist.value = visual.twist
  material.uniforms.uDepth.value = visual.depth * (material.depthTest ? 0.34 : 0.50)
  material.uniforms.uColorTension.value = visual.colorTension
  material.uniforms.uTint.value = colorUniform(visual.visualTintColor)
}

function updateCoverParticles(time: number, energy: number) {
  if (!coverParticles || !bloomParticles) return
  pointer.lerp(pointerTarget, 0.075)
  coverRotation.lerp(coverRotationTarget, dragActive ? 0.16 : 0.055)
  if (!dragActive) {
    coverRotationTarget.x *= 0.985
    coverRotationTarget.y *= 0.985
  }
  const idle = props.playing ? 1 : 0.58
  const wobbleX = Math.sin(time * 0.23) * 0.035
  const wobbleY = Math.cos(time * 0.19) * 0.045
  const visual = fx.value
  const targetScale = 1 + energy * 0.018 * visual.intensity + beatPulse * 0.035 * visual.intensity
  const shelfAvoidX = visual.shelfMode === 'side' ? -5.70 * shelfDetailLyricMix : 0

  for (const field of [coverParticles, bloomParticles]) {
    field.position.x += (shelfAvoidX - field.position.x) * 0.10
    field.rotation.x = coverRotation.y + pointer.y * 0.08 + wobbleX
    field.rotation.y = coverRotation.x + pointer.x * 0.10 + wobbleY
    field.rotation.z = Math.sin(time * 0.11) * 0.018
    coverScaleTarget.set(targetScale, targetScale, targetScale)
    field.scale.lerp(coverScaleTarget, 0.08)
  }
  syncCoverMaterial(coverParticles.material, time, energy, 0.76 + idle * 0.22 + energy * 0.10)
  syncCoverMaterial(bloomParticles.material, time, energy, ((props.playing ? 0.25 : 0.12) + energy * 0.24 + beatPulse * 0.26) * visual.bloom * (visual.bloomEnabled ? 1 : 0))
  if (backCoverParticles) {
    backCoverParticles.visible = visual.backCoverEnabled
    backCoverParticles.rotation.x = -coverParticles.rotation.x * 0.82
    backCoverParticles.rotation.y = coverParticles.rotation.y + Math.PI
    backCoverParticles.rotation.z = -coverParticles.rotation.z * 0.65
    backCoverParticles.position.set(coverParticles.position.x, 0, -1.1 - energy * 0.28)
    backCoverParticles.scale.setScalar(1.08 + energy * 0.04 + beatPulse * 0.04)
    syncCoverMaterial(backCoverParticles.material, time * 0.84, energy, visual.backCoverEnabled ? 0.18 + visual.backgroundOpacity * 0.20 : 0)
  }
  if (edgeParticles) {
    edgeParticles.visible = visual.edgeHighlightEnabled
    edgeParticles.rotation.copy(coverParticles.rotation)
    edgeParticles.position.set(coverParticles.position.x, 0, 0.06)
    edgeParticles.scale.setScalar(1.018 + beatPulse * 0.012)
    syncCoverMaterial(edgeParticles.material, time, energy, visual.edgeHighlightEnabled ? (0.18 + beatPulse * 0.32) * visual.bloom : 0)
    edgeParticles.material.uniforms.uPointScale.value = visual.point * 3.35
    edgeParticles.material.uniforms.uTint.value = colorUniform(visual.uiAccentColor)
  }
}

function draw() {
  if (!renderer || !scene || !camera) return
  const time = Date.now() * 0.001
  const vis = fx.value
  const dt = 0.016 * vis.speed
  const animTime = time * vis.speed
  const energy = reducedMotion ? 0 : readAudioEnergy(time)
  beatPulse *= reducedMotion ? 0 : 0.90
  updateCoverParticles(animTime, energy)
  shelfMgr.setConfig({
    mode: vis.shelfMode,
    cameraMode: vis.shelfCameraMode,
    presence: vis.shelfPresence,
    size: vis.shelfSize,
    offsetX: vis.shelfOffsetX,
    offsetY: vis.shelfOffsetY,
    offsetZ: vis.shelfOffsetZ,
    angleY: vis.shelfAngleY,
    opacity: vis.shelfOpacity,
    bgOpacity: vis.shelfBgOpacity,
    accentColor: vis.shelfAccentColor
  })
  if (props.shelfCards) shelfMgr.setCards(vis.shelfMode === 'off' ? [] : props.shelfCards)
  if (skullField) {
    skullField.visible = vis.skullPresetEnabled
    skullField.rotation.y += vis.skullPresetEnabled ? (0.004 + energy * 0.01) * vis.speed : 0
    skullField.rotation.x = Math.sin(animTime * 0.22) * 0.08
    skullField.position.z = -0.8 + Math.sin(animTime * 0.18) * 0.18
    skullField.scale.setScalar(1 + energy * 0.08 + beatPulse * 0.08)
  }
  const cinema = vis.cinemaEnabled ? cinemaCam.update(beatState, dt, vis.intensity * vis.cinemaShake) : { x: 0, y: 0, roll: 0 }
  syncStageLyric()
  stageLyrics.shelfDetailProfile = vis.skullPresetEnabled ? 'skull' : 'normal'
  stageLyrics.update(dt, beatState)
  freeCam.update(0.016, camera)
  camera.position.x += cinema.x
  camera.position.y += cinema.y
  camera.rotation.z += cinema.roll * 0.02
  camera.position.z += (((vis.lyricCameraLockEnabled && props.showLyrics ? 15.4 : 17.2) - energy * 0.52 - beatPulse * 0.34) - camera.position.z) * 0.08
  cameraLookTarget.set(0, 0, 0)
  if (vis.lyricCameraLockEnabled && props.showLyrics && props.hasLyrics) cameraLookTarget.copy(stageLyrics.group.position)
  camera.lookAt(cameraLookTarget)
  shelfMgr.update(dt, camera)
  const hasShelfContent = shelfMgr.hasVisibleContent()
  if (shelfContentVisible.value !== hasShelfContent) shelfContentVisible.value = hasShelfContent
  shelfDetailLyricMix += ((hasShelfContent ? 1 : 0) - shelfDetailLyricMix) * 0.12
  stageLyrics.shelfDetailMix = shelfDetailLyricMix
  const targetBoost = props.playing ? 1 + energy * 0.55 : 0.64
  if (particleField) {
    particleField.rotation.y += reducedMotion ? 0 : (props.playing ? 0.0028 + energy * 0.0046 : 0.0008) * vis.speed
    particleField.rotation.x = Math.sin(animTime * 0.28) * (0.08 + energy * 0.08)
    particleField.material.opacity += (0.95 * targetBoost - particleField.material.opacity) * 0.045
    particleField.scale.setScalar(1 + energy * 0.035)
  }
  if (dustField) {
    dustField.visible = vis.floatLayerEnabled
    dustField.rotation.y -= reducedMotion ? 0 : (props.playing ? 0.0014 + energy * 0.0022 : 0.00035) * vis.speed
    dustField.rotation.z = Math.sin(animTime * 0.18) * 0.035
    dustField.material.opacity += (0.70 * targetBoost - dustField.material.opacity) * 0.04
  }
  if (glowField) {
    glowField.visible = vis.floatLayerEnabled
    glowField.rotation.y += reducedMotion ? 0 : (props.playing ? 0.0034 + energy * 0.0052 : 0.001) * vis.speed
    glowField.rotation.z = Math.cos(animTime * 0.22) * 0.06
    glowField.material.opacity += ((vis.bloomEnabled ? 0.78 : 0.28) * targetBoost - glowField.material.opacity) * 0.05
    glowField.scale.setScalar(1 + energy * 0.06)
  }
  if (nearField) {
    nearField.visible = vis.floatLayerEnabled && vis.renderQuality !== 'release'
    nearField.rotation.y -= reducedMotion ? 0 : (props.playing ? 0.0048 + energy * 0.006 : 0.0012) * vis.speed
    nearField.rotation.x = Math.cos(animTime * 0.34) * (0.04 + energy * 0.06)
    nearField.material.opacity += ((props.playing ? 0.52 + energy * 0.38 : 0.28) - nearField.material.opacity) * 0.06
  }
  if (!vis.bloomEnabled || vis.renderQuality === 'release' || !bloomFx.render(dt)) {
    renderer.render(scene, camera)
  }
  raf = requestAnimationFrame(draw)
}

function disposeScene() {
  if (raf) cancelAnimationFrame(raf)
  disposeCoverParticles()
  disposeParticle(particleField)
  disposeParticle(dustField)
  disposeParticle(glowField)
  disposeParticle(nearField)
  disposeParticle(skullField)
  particleField = null
  dustField = null
  glowField = null
  nearField = null
  skullField = null
  renderer?.dispose()
  stageLyrics.dispose()
  lastStageLyricKey = ''
  renderer = null
  scene = null
  camera = null
  analyser = null
  beatEngine.reset()
  frequencyData = null
  dotTexture?.dispose()
  dotTexture = null
}

function updatePointerFromEvent(e: PointerEvent) {
  const pointerInfo = shelfPointerFromEvent(e)
  if (!pointerInfo) return
  pointerTarget.x = pointerInfo.x
  pointerTarget.y = pointerInfo.y
  updateShelfHover(pointerInfo)
  if (dragActive) {
    coverRotationTarget.x += (e.clientX - dragLastX) * 0.0032
    coverRotationTarget.y += (e.clientY - dragLastY) * 0.0024
    coverRotationTarget.x = Math.max(-0.62, Math.min(0.62, coverRotationTarget.x))
    coverRotationTarget.y = Math.max(-0.42, Math.min(0.42, coverRotationTarget.y))
    dragLastX = e.clientX
    dragLastY = e.clientY
  }
}

function shelfPointerFromEvent(e: MouseEvent | WheelEvent) {
  const parent = canvasRef.value?.parentElement
  if (!parent) return null
  const rect = parent.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  return {
    x: ((e.clientX - rect.left) / rect.width - 0.5) * 2,
    y: -(((e.clientY - rect.top) / rect.height - 0.5) * 2),
    relX: e.clientX - rect.left,
    relY: e.clientY - rect.top,
    width: rect.width,
    height: rect.height
  }
}

function shelfHitAt(x: number, y: number) {
  if (!camera || !shelfMgr.group.visible) return -1
  shelfRaycaster.setFromCamera(new THREE.Vector2(x, y), camera)
  return shelfMgr.raycast(shelfRaycaster)
}

function shelfHitFromPointer(pointerInfo: NonNullable<ReturnType<typeof shelfPointerFromEvent>>) {
  const hit = shelfHitAt(pointerInfo.x, pointerInfo.y)
  if (hit >= 0 || !camera) return hit
  return shelfMgr.pickAtScreen(camera, pointerInfo.width, pointerInfo.height, pointerInfo.relX, pointerInfo.relY, fx.value.shelfMode === 'side' ? 72 : 48)
}

function shelfContentHitFromPointer(pointerInfo: NonNullable<ReturnType<typeof shelfPointerFromEvent>>) {
  if (!camera) return -1
  return shelfMgr.pickContentAtScreen(camera, pointerInfo.width, pointerInfo.height, pointerInfo.relX, pointerInfo.relY)
}

function shelfContentActionFromPointer(pointerInfo: NonNullable<ReturnType<typeof shelfPointerFromEvent>>) {
  if (!camera) return null
  return shelfMgr.pickContentActionAtScreen(camera, pointerInfo.width, pointerInfo.height, pointerInfo.relX, pointerInfo.relY)
}

function shelfContentCloseFromPointer(pointerInfo: NonNullable<ReturnType<typeof shelfPointerFromEvent>>) {
  if (!camera) return false
  return shelfMgr.pickContentCloseAtScreen(camera, pointerInfo.width, pointerInfo.height, pointerInfo.relX, pointerInfo.relY)
}

function shelfContentPanelFromPointer(pointerInfo: NonNullable<ReturnType<typeof shelfPointerFromEvent>>) {
  if (!camera) return false
  return shelfMgr.pickContentPanelAtScreen(camera, pointerInfo.width, pointerInfo.height, pointerInfo.relX, pointerInfo.relY)
}

function updateShelfHover(pointerInfo?: NonNullable<ReturnType<typeof shelfPointerFromEvent>>) {
  const contentHit = pointerInfo ? shelfContentHitFromPointer(pointerInfo) : -1
  shelfMgr.setHoveredContent(contentHit)
  const hit = pointerInfo ? shelfHitFromPointer(pointerInfo) : shelfHitAt(pointerTarget.x, pointerTarget.y)
  const preview = !!pointerInfo && hit < 0 && isShelfPreviewZone(pointerInfo)
  shelfCueVisible.value = preview
  shelfMgr.setHovered(preview ? shelfMgr.getCenterIdx() : hit)
}

function handlePointerMove(e: PointerEvent) {
  updatePointerFromEvent(e)
}

function handlePointerLeave() {
  pointerTarget.set(0, 0)
  shelfMgr.setHovered(-1)
  shelfMgr.setHoveredContent(-1)
  shelfCueVisible.value = false
}

function handlePointerDown(e: PointerEvent) {
  updatePointerFromEvent(e)
  const pointerInfo = shelfPointerFromEvent(e)
  if (pointerInfo && shelfContentCloseFromPointer(pointerInfo) && shelfMgr.closeContent()) {
    shelfDetailExpanded.value = false
    return
  }
  const contentAction = pointerInfo ? shelfContentActionFromPointer(pointerInfo) : null
  if (contentAction && shelfMgr.clickContentRow(contentAction.index, contentAction.action)) {
    revealShelfDetail(true)
    return
  }
  const shelfIndex = pointerInfo ? shelfHitFromPointer(pointerInfo) : shelfHitAt(pointerTarget.x, pointerTarget.y)
  if (shelfIndex >= 0) {
    shelfMgr.click(shelfIndex)
    revealShelfDetail(true)
    return
  }
  if (pointerInfo && isShelfPreviewZone(pointerInfo)) {
    revealShelfDetail(true)
    return
  }
  if (shelfMgr.hasOpenContent() && shelfMgr.closeContent()) {
    shelfDetailExpanded.value = false
    return
  }
  dragActive = true
  dragLastX = e.clientX
  dragLastY = e.clientY
}

function handlePointerUp() {
  dragActive = false
}

function isShelfWheelZone(e: WheelEvent, pointerInfo: NonNullable<ReturnType<typeof shelfPointerFromEvent>>) {
  const vis = fx.value
  if (vis.shelfMode === 'off' || !shelfMgr.group.visible) return false
  if (e.shiftKey) return true
  const hit = shelfHitFromPointer(pointerInfo)
  if (hit >= 0) return true
  if (vis.shelfMode === 'stage') return pointerInfo.relY > pointerInfo.height * 0.60
  if (vis.shelfPresence === 'always') return false
  return isShelfAutoFocusZone(pointerInfo)
}

function isShelfPreviewZone(pointerInfo: NonNullable<ReturnType<typeof shelfPointerFromEvent>>) {
  const vis = fx.value
  if (vis.shelfMode !== 'side' || vis.shelfPresence !== 'auto' || !shelfMgr.group.visible) return false
  return isShelfAutoFocusZone(pointerInfo)
}

function isShelfAutoFocusZone(pointerInfo: NonNullable<ReturnType<typeof shelfPointerFromEvent>>) {
  const edge = Math.min(132, Math.max(92, pointerInfo.width * 0.08))
  const top = Math.max(104, pointerInfo.height * 0.22)
  const bottom = Math.min(pointerInfo.height - 104, pointerInfo.height * 0.78)
  return pointerInfo.relX > pointerInfo.width - edge && pointerInfo.relY > top && pointerInfo.relY < bottom
}

function isShelfContentWheelZone(pointerInfo: NonNullable<ReturnType<typeof shelfPointerFromEvent>>) {
  const vis = fx.value
  if (!shelfMgr.hasOpenContent()) return false
  if (shelfContentHitFromPointer(pointerInfo) >= 0) return true
  if (shelfContentPanelFromPointer(pointerInfo)) return true
  if (vis.shelfMode === 'stage') return pointerInfo.relY > pointerInfo.height * 0.52
  return isShelfAutoFocusZone(pointerInfo)
}

function handleWheel(e: WheelEvent) {
  const p = shelfPointerFromEvent(e)
  if (p && isShelfContentWheelZone(p)) {
    e.preventDefault()
    e.stopPropagation()
    shelfMgr.scrollContent(e.deltaY)
    revealShelfDetail(true)
    return
  }
  if (!p || !isShelfWheelZone(e, p)) return
  e.preventDefault()
  e.stopPropagation()
  shelfMgr.scroll(e.deltaY)
  updateShelfHover(p)
  revealShelfDetail(true)
}

function playShelfCenterCard() {
  revealShelfDetail(true)
  if (shelfCenterCard.value) emit('shelf-card-click', shelfCenterCard.value)
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
}

function handleShelfKeydown(e: KeyboardEvent) {
  if (isTypingTarget(e.target) || fx.value.shelfMode === 'off') return
  if (e.code === 'Escape' && shelfMgr.hasOpenContent()) {
    e.preventDefault()
    shelfMgr.closeContent()
    shelfDetailExpanded.value = false
  } else if (e.code === 'BracketRight' || e.code === 'PageDown') {
    e.preventDefault()
    shelfMgr.next()
    revealShelfDetail(true)
  } else if (e.code === 'BracketLeft' || e.code === 'PageUp') {
    e.preventDefault()
    shelfMgr.prev()
    revealShelfDetail(true)
  }
}

function revealShelfDetail(expanded: boolean) {
  if (!shelfCenterCard.value) return
  shelfDetailExpanded.value = expanded
  if (shelfDetailTimer) window.clearTimeout(shelfDetailTimer)
  shelfDetailTimer = window.setTimeout(() => {
    shelfDetailExpanded.value = false
    shelfDetailTimer = 0
  }, expanded ? 4200 : 1800)
}

function scrollActiveLine(force = false) {
  const el = lyricRef.value
  if (!el || props.activeLine < 0) return
  if (!force && lastScrolledLyric === props.activeLine) return
  const target = el.querySelector<HTMLElement>(`[data-li="${props.activeLine}"]`)
  if (!target) return
  lastScrolledLyric = props.activeLine
  el.scrollTo({ top: Math.max(0, target.offsetTop - el.clientHeight / 2 + target.clientHeight / 2), behavior: force ? 'auto' : 'smooth' })
}

onMounted(() => {
  reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
  initScene()
  const parent = canvasRef.value?.parentElement
  if (parent) {
    resizeObserver = new ResizeObserver(() => resizeScene())
    resizeObserver.observe(parent)
    parent.addEventListener('pointermove', handlePointerMove)
    parent.addEventListener('pointerleave', handlePointerLeave)
    parent.addEventListener('pointerdown', handlePointerDown)
    parent.addEventListener('wheel', handleWheel, { passive: false })
  }
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('resize', resizeScene)
  window.addEventListener('keydown', handleShelfKeydown, true)
  raf = requestAnimationFrame(() => {
    resizeScene()
    draw()
  })
})

watch(() => props.activeLine, () => {
  if (props.showLyrics) scrollActiveLine(false)
})
watch(() => props.showLyrics, (show) => {
  lastScrolledLyric = -1
  if (show) setTimeout(() => scrollActiveLine(true), 0)
  else syncStageLyric()
})
watch(() => [props.activeLine, props.currentTime, props.showLyrics, props.hasLyrics] as const, () => {
  if (props.showLyrics) scrollActiveLine(false)
  syncStageLyric()
})
watch(() => props.coverUrl, (url) => {
  loadCoverParticleSource(url)
})
watch(() => fx.value.coverResolution, () => {
  loadCoverParticleSource(props.coverUrl)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeScene)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('keydown', handleShelfKeydown, true)
  const parent = canvasRef.value?.parentElement
  parent?.removeEventListener('pointermove', handlePointerMove)
  parent?.removeEventListener('pointerleave', handlePointerLeave)
  parent?.removeEventListener('pointerdown', handlePointerDown)
  parent?.removeEventListener('wheel', handleWheel)
  if (shelfDetailTimer) window.clearTimeout(shelfDetailTimer)
  shelfDetailTimer = 0
  resizeObserver?.disconnect()
  resizeObserver = null
  coverLoadToken += 1
  disposeScene()
})
</script>

<template>
  <div :class="['music-stage', `shelf-${fx.shelfMode}`, shelfContentVisible ? 'shelf-detail-active' : '']">
    <div class="music-stage-bg" :style="[stageStyle, { opacity: fx.backgroundOpacity, filter: stageBgFilter }]"></div>
    <video
      v-if="customBackgroundType === 'video' && customBackgroundUrl"
      :key="customBackgroundUrl"
      class="music-stage-bg-video"
      :src="customBackgroundUrl"
      :style="{ opacity: fx.backgroundOpacity, filter: stageBgFilter }"
      autoplay
      loop
      muted
      playsinline
    ></video>
    <canvas ref="canvasRef" class="music-stage-canvas"></canvas>
    <div class="music-stage-vignette"></div>
    <div v-if="shelfCueVisible" class="music-shelf-cue" aria-hidden="true">
      <i></i>
      <i></i>
      <i></i>
    </div>
    <div v-if="shouldShowShelfDetail && shelfCenterCard" :class="['music-shelf-detail', shelfDetailExpanded ? 'expanded' : 'compact']">
      <span>{{ shelfCenterIndex + 1 }} / {{ shelfCards?.length || 0 }}</span>
      <strong>{{ shelfCenterCard.title }}</strong>
      <small>{{ shelfCenterCard.subtitle }}</small>
      <button type="button" @click.stop="playShelfCenterCard">{{ tt('music.play') }}</button>
    </div>

    <div v-show="!showLyrics" class="music-cover-wrap">
      <div class="music-stage-copy">
        <div class="music-stage-title">{{ title || tt('music.notPlaying') }}</div>
        <div class="music-stage-artist">{{ artist || tt('music.unknownArtist') }}</div>
      </div>
    </div>

    <div v-show="showLyrics" :class="['music-lyric-stage', fx.lyricGlowEnabled ? 'lyric-glow-on' : 'lyric-glow-off']" :style="lyricStageStyle">
      <div v-if="!hasLyrics && !metaLoad" class="music-lyric-empty">
        <FileText :size="34" :stroke-width="1.2" />
        <span>{{ tt('music.noLyricsFound') }}</span>
        <small v-if="lyricDebugText" :title="lyricDebugTitle">{{ lyricDebugText }}</small>
      </div>
      <div v-else ref="lyricRef" class="music-lyric-scroll">
        <div class="music-lyric-spacer"></div>
        <button
          v-for="(line, i) in lyricLines"
          :key="`${line.time}-${i}`"
          :data-li="i"
          :class="['music-lyric-line', i === activeLine ? 'active' : '', i < activeLine ? 'past' : '']"
          @click="emit('seek-lyric', line.time)"
        >
          {{ line.text }}
        </button>
        <div class="music-lyric-spacer"></div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.music-stage {
  position: relative;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: 0;
  color: var(--music-stage-text, #fff);
  background: var(--music-stage-base, #08090b);
}
.music-stage::before {
  content: '';
  position: absolute;
  inset: -10%;
  z-index: 1;
  pointer-events: none;
  background: var(--music-stage-aura);
  mix-blend-mode: screen;
  opacity: .9;
}
.music-stage-bg,
.music-stage-bg-video,
.music-stage-canvas,
.music-stage-vignette {
  position: absolute;
  inset: 0;
}
.music-stage-bg {
  z-index: 0;
  background-size: cover;
  background-position: center;
  filter: var(--music-stage-bg-filter, blur(120px) brightness(.18) saturate(1.5));
  transform: scale(1.4);
  opacity: var(--music-stage-bg-opacity, .92);
  transition: background-image 1.2s ease, opacity .5s ease;
}
.music-stage-bg-video {
  z-index: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: var(--music-stage-bg-filter, blur(120px) brightness(.18) saturate(1.5));
  transform: scale(1.16);
  transition: opacity .5s ease;
}
.music-stage-canvas {
  z-index: 2;
  width: 100%;
  height: 100%;
  opacity: 1;
  cursor: grab;
  mix-blend-mode: var(--music-particle-blend, screen);
  filter: var(--music-particle-filter, drop-shadow(0 0 22px rgba(143,245,234,.34)));
}
.music-stage-canvas:active {
  cursor: grabbing;
}
.music-stage-vignette {
  z-index: 3;
  pointer-events: none;
  background: var(--music-stage-vignette);
}
.music-shelf-cue {
  position: absolute;
  z-index: 5;
  top: 50%;
  right: clamp(12px, 2.2vw, 28px);
  display: grid;
  gap: 7px;
  width: 34px;
  padding: 12px 9px;
  border: 1px solid rgba(0,245,212,.16);
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(0,245,212,.10), rgba(244,210,138,.06));
  box-shadow: 0 0 28px rgba(0,245,212,.12), inset 0 1px 0 rgba(255,255,255,.08);
  pointer-events: none;
  transform: translateY(-50%);
  backdrop-filter: blur(14px) saturate(1.18);
}
.music-shelf-cue i {
  display: block;
  width: 100%;
  height: 2px;
  border-radius: 999px;
  background: rgba(0,245,212,.78);
  box-shadow: 0 0 12px rgba(0,245,212,.24);
}
.music-shelf-detail {
  position: absolute;
  z-index: 6;
  right: clamp(24px, 5.4vw, 86px);
  bottom: clamp(148px, 17vh, 196px);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "count action"
    "title action"
    "sub action"
    "tracks tracks";
  min-width: min(310px, 38vw);
  max-width: min(420px, 44vw);
  gap: 2px 12px;
  align-items: center;
  padding: 13px 14px;
  border: 1px solid rgba(255,255,255,.10);
  border-radius: 18px;
  color: var(--music-stage-text);
  background:
    radial-gradient(circle at 12% 0%, rgba(244,210,138,.12), transparent 42%),
    linear-gradient(145deg, rgba(18,21,26,.56), rgba(8,9,13,.78));
  box-shadow: 0 22px 68px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.08);
  backdrop-filter: blur(24px) saturate(1.18);
  pointer-events: auto;
  opacity: 1;
  transform: translate3d(0, 0, 0);
  transition: opacity .24s ease, transform .24s ease, max-width .24s ease, padding .24s ease;
}
.music-shelf-detail.compact {
  grid-template-areas:
    "count"
    "title"
    "sub";
  grid-template-columns: minmax(0, 1fr);
  min-width: min(230px, 28vw);
  max-width: min(300px, 32vw);
  padding: 10px 12px;
  opacity: .72;
  pointer-events: none;
  transform: translate3d(10px, 0, 0) scale(.96);
}
.music-shelf-detail.expanded {
  opacity: 1;
  pointer-events: auto;
}
.music-stage.shelf-side .music-shelf-detail {
  right: clamp(18px, 3.1vw, 42px);
  bottom: clamp(156px, 18vh, 210px);
  min-width: min(246px, 24vw);
  max-width: min(292px, 27vw);
  padding: 11px 12px;
  transform: translate3d(12px, 0, 0) scale(.94);
}
.music-stage.shelf-side .music-shelf-detail.expanded {
  transform: translate3d(0, 0, 0) scale(.96);
}
.music-shelf-detail.compact > button {
  display: none;
}
.music-shelf-detail span {
  grid-area: count;
  color: var(--music-stage-muted);
  font-size: 10px;
  font-weight: 780;
  letter-spacing: .12em;
}
.music-shelf-detail strong,
.music-shelf-detail small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.music-shelf-detail strong {
  grid-area: title;
  font-size: 14px;
  font-weight: 820;
}
.music-shelf-detail small {
  grid-area: sub;
  color: var(--music-stage-muted);
  font-size: 11px;
}
.music-shelf-detail > button {
  grid-area: action;
  height: 34px;
  padding: 0 13px;
  border: 1px solid rgba(0,245,212,.24);
  border-radius: 999px;
  color: #031311;
  background: linear-gradient(135deg, rgba(0,245,212,.96), rgba(244,210,138,.92));
  font-size: 12px;
  font-weight: 860;
  cursor: pointer;
  box-shadow: 0 12px 28px rgba(0,245,212,.12);
}
.music-cover-wrap,
.music-lyric-stage {
  position: relative;
  z-index: 4;
  height: 100%;
}
.music-cover-wrap {
  pointer-events: none;
  padding: 48px 32px 170px;
}
.music-stage-copy {
  position: absolute;
  left: 50%;
  top: calc(100% - clamp(122px, 15.5vh, 154px));
  width: min(520px, 80%);
  transform: translateX(-50%) translateY(-100%);
  text-align: center;
  text-shadow: 0 14px 50px rgba(0,0,0,.65);
  transition: left .32s ease, width .32s ease, opacity .24s ease;
}
.music-stage.shelf-side.shelf-detail-active .music-stage-copy {
  left: 38%;
  width: min(480px, 58%);
}
.music-stage-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 26px;
  font-weight: 800;
}
.music-stage-artist {
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--music-stage-muted, rgba(255,255,255,.56));
  font-size: 12px;
}
.music-lyric-stage {
  display: flex;
  flex-direction: column;
  padding: 46px clamp(24px, 8vw, 128px) 178px;
}
.music-lyric-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--music-stage-muted, rgba(255,255,255,.46));
}
.music-lyric-empty small {
  max-width: 520px;
  color: var(--music-stage-muted, rgba(255,255,255,.52));
  text-align: center;
  line-height: 1.5;
}
.music-lyric-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-width: none;
}
.music-lyric-scroll::-webkit-scrollbar {
  display: none;
}
.music-lyric-spacer {
  height: 36%;
}
.music-lyric-line {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--music-lyric-idle, rgba(255,255,255,.26));
  padding: 12px 0;
  font: inherit;
  font-family: var(--music-lyric-font, inherit);
  font-size: calc(clamp(24px, 3.8vw, 56px) * var(--music-lyric-size, 1));
  font-weight: var(--music-lyric-weight, 760);
  letter-spacing: var(--music-lyric-letter-spacing, 0);
  line-height: var(--music-lyric-line-height, 1.18);
  text-align: center;
  cursor: pointer;
  text-shadow: 0 10px 36px rgba(0,0,0,.45);
  transition: color .25s, transform .25s, filter .25s;
}
.music-lyric-line:hover {
  color: var(--music-lyric-hover, rgba(255,255,255,.72));
}
.music-lyric-line.active {
  color: var(--music-lyric-active, #fff9e8);
  transform: scale(1.035);
  text-shadow: 0 0 18px color-mix(in srgb, var(--music-lyric-active, #fff9e8) 30%, transparent), 0 0 42px color-mix(in srgb, var(--music-lyric-glow, #00f5d4) 26%, transparent), 0 16px 44px rgba(0,0,0,.62);
  filter: drop-shadow(0 0 18px color-mix(in srgb, var(--music-lyric-glow, #00f5d4) 34%, transparent));
}
.music-lyric-stage.lyric-glow-off .music-lyric-line,
.music-lyric-stage.lyric-glow-off .music-lyric-line.active {
  text-shadow: 0 10px 30px rgba(0,0,0,.42);
  filter: none;
}
.music-lyric-line.past {
  color: var(--music-lyric-past, rgba(255,255,255,.14));
}
@media (prefers-reduced-motion: reduce) {
  .music-stage-canvas {
    opacity: .36;
    filter: none;
  }
  .music-lyric-line {
    transition: none;
  }
}
@media (max-width: 760px) {
  .music-shelf-detail {
    left: 18px;
    right: 18px;
    bottom: 138px;
    min-width: 0;
    max-width: none;
  }
  .music-stage-copy {
    top: calc(50% + min(136px, 20vh));
  }
}
@media (max-height: 520px) {
  .music-cover-wrap {
    padding: 28px 18px 88px;
  }
  .music-stage-copy {
    top: calc(100% - 118px);
    width: min(360px, 76%);
  }
  .music-stage-title {
    font-size: clamp(15px, 4vw, 22px);
  }
  .music-stage-artist {
    margin-top: 3px;
    font-size: 11px;
  }
  .music-shelf-detail {
    right: 18px;
    bottom: 74px;
    min-width: 190px;
    max-width: min(280px, 34vw);
    padding: 9px 10px;
    border-radius: 14px;
  }
  .music-shelf-detail strong {
    font-size: 12px;
  }
  .music-shelf-detail small {
    font-size: 10px;
  }
  .music-shelf-detail > button {
    height: 28px;
    padding: 0 10px;
    font-size: 11px;
  }
  .music-lyric-stage {
    padding: 24px 22px 82px;
  }
  .music-lyric-line {
    padding: 6px 0;
    font-size: calc(clamp(18px, 5vh, 28px) * var(--music-lyric-size, 1));
  }
}
@media (max-height: 420px) {
  .music-shelf-detail {
    bottom: 62px;
    max-width: min(240px, 32vw);
  }
  .music-stage-copy {
    top: calc(100% - 96px);
  }
}
</style>
