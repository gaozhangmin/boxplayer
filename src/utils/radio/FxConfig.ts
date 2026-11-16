export type ShelfMode = 'off' | 'side' | 'stage'
export type ShelfCameraMode = 'static' | 'dynamic'
export type ShelfPresence = 'auto' | 'always'
export type RenderQuality = 'auto' | 'keep' | 'release'
export type LyricSourceMode = 'original' | 'custom'
export type LyricFontFamily = 'system' | 'serif' | 'gothic' | 'mono'

export interface MusicFxConfig {
  version: 1
  playerInterface: 'particleStage' | 'fresh'
  intensity: number
  depth: number
  scatter: number
  twist: number
  point: number
  bloom: number
  speed: number
  colorTension: number
  bgFade: number
  cinemaShake: number
  lyricGlowStrength: number
  coverResolution: number
  uiAccentColor: string
  visualTintColor: string
  homeAccentColor: string
  homeIconColor: string
  visualIconColor: string
  backgroundColor: string
  shelfMode: ShelfMode
  shelfCameraMode: ShelfCameraMode
  shelfPresence: ShelfPresence
  shelfSize: number
  shelfOffsetX: number
  shelfOffsetY: number
  shelfOffsetZ: number
  shelfAngleY: number
  shelfOpacity: number
  shelfBgOpacity: number
  shelfAccentColor: string
  shelfShowFavorites: boolean
  shelfShowRecents: boolean
  shelfShowPodcasts: boolean
  shelfMergeCollections: boolean
  liveBackgroundKeep: boolean
  gestureControlEnabled: boolean
  backgroundOpacity: number
  bloomEnabled: boolean
  cinemaEnabled: boolean
  floatLayerEnabled: boolean
  edgeHighlightEnabled: boolean
  backCoverEnabled: boolean
  beatGlowEnabled: boolean
  colorLabEnabled: boolean
  lyricGlowParticlesEnabled: boolean
  lyricCameraLockEnabled: boolean
  wallpaperModeEnabled: boolean
  glassChromaticOffset: number
  splashEnabled: boolean
  skullPresetEnabled: boolean
  performanceManagerEnabled: boolean
  lyricGlowEnabled: boolean
  renderQuality: RenderQuality
  lyricSourceMode: LyricSourceMode
  lyricFontFamily: LyricFontFamily
  lyricSize: number
  lyricLineHeight: number
  lyricLetterSpacing: number
  lyricWeight: number
  lyricOffsetX: number
  lyricOffsetY: number
  lyricOffsetZ: number
  lyricRotateX: number
  lyricRotateY: number
  lyricPrimaryColor: string
  lyricActiveColor: string
  lyricGlowColor: string
}

export const DEFAULT_MUSIC_FX: MusicFxConfig = {
  version: 1,
  playerInterface: 'particleStage',
  intensity: 0.85,
  depth: 1,
  scatter: 0,
  twist: 0,
  point: 1,
  bloom: 0.62,
  speed: 1,
  colorTension: 1.1,
  bgFade: 0.2,
  cinemaShake: 0.5,
  lyricGlowStrength: 0.28,
  coverResolution: 1.55,
  uiAccentColor: '#ffffff',
  visualTintColor: '#9db8cf',
  homeAccentColor: '#ffffff',
  homeIconColor: '#ffffff',
  visualIconColor: '#ffffff',
  backgroundColor: '#000000',
  shelfMode: 'side',
  shelfCameraMode: 'static',
  shelfPresence: 'always',
  shelfSize: 1,
  shelfOffsetX: 0,
  shelfOffsetY: 0,
  shelfOffsetZ: 0,
  shelfAngleY: -15,
  shelfOpacity: 1,
  shelfBgOpacity: 0.9,
  shelfAccentColor: '#ffffff',
  shelfShowFavorites: false,
  shelfShowRecents: false,
  shelfShowPodcasts: false,
  shelfMergeCollections: false,
  liveBackgroundKeep: false,
  gestureControlEnabled: false,
  backgroundOpacity: 1,
  bloomEnabled: false,
  cinemaEnabled: true,
  floatLayerEnabled: false,
  edgeHighlightEnabled: false,
  backCoverEnabled: false,
  beatGlowEnabled: true,
  colorLabEnabled: false,
  lyricGlowParticlesEnabled: false,
  lyricCameraLockEnabled: false,
  wallpaperModeEnabled: false,
  glassChromaticOffset: 0.9,
  splashEnabled: false,
  skullPresetEnabled: false,
  performanceManagerEnabled: true,
  lyricGlowEnabled: true,
  renderQuality: 'auto',
  lyricSourceMode: 'original',
  lyricFontFamily: 'gothic',
  lyricSize: 1,
  lyricLineHeight: 1,
  lyricLetterSpacing: 0,
  lyricWeight: 900,
  lyricOffsetX: 0,
  lyricOffsetY: 0,
  lyricOffsetZ: 0,
  lyricRotateX: 0,
  lyricRotateY: 0,
  lyricPrimaryColor: '#a9b8c8',
  lyricActiveColor: '#fac900',
  lyricGlowColor: '#008aff'
}

export const MUSIC_FX_PRESETS: Array<{ id: string; name: string; config: MusicFxConfig }> = [
  {
    id: 'mineradio',
    name: 'BoxPlayer Radio',
    config: { ...DEFAULT_MUSIC_FX }
  },
  {
    id: 'cinema',
    name: '电影镜头',
    config: { ...DEFAULT_MUSIC_FX, intensity: 1.18, depth: 1.24, scatter: 0.42, twist: 0.74, bloom: 0.72, cinemaShake: 1.18, shelfCameraMode: 'dynamic', shelfAngleY: 0 }
  },
  {
    id: 'quiet',
    name: '低负载',
    config: { ...DEFAULT_MUSIC_FX, intensity: 0.58, depth: 0.72, scatter: 0.16, twist: 0.28, point: 0.78, bloom: 0.12, speed: 0.7, colorTension: 0.72, bgFade: 0.66, coverResolution: 0.78, shelfMode: 'off', renderQuality: 'release' }
  },
  {
    id: 'shelf',
    name: '歌单架',
    config: { ...DEFAULT_MUSIC_FX, shelfMode: 'stage', shelfCameraMode: 'dynamic', shelfSize: 1.14, shelfOpacity: 0.96, intensity: 0.86, bloom: 0.38 }
  },
  {
    id: 'lyric-lock',
    name: '歌词镜头',
    config: { ...DEFAULT_MUSIC_FX, lyricCameraLockEnabled: true, lyricGlowParticlesEnabled: true, lyricGlowStrength: 0.68, lyricSize: 1.12, lyricOffsetZ: -0.24, cinemaShake: 0.92 }
  },
  {
    id: 'skull',
    name: '安魂 Skull',
    config: { ...DEFAULT_MUSIC_FX, skullPresetEnabled: true, shelfMode: 'off', bloom: 0.76, colorTension: 1.32, bgFade: 0.72, cinemaShake: 1.05, lyricCameraLockEnabled: true, lyricGlowParticlesEnabled: true }
  },
  {
    id: 'vivid',
    name: '色彩张力',
    config: { ...DEFAULT_MUSIC_FX, colorTension: 1.55, visualTintColor: '#7fd8ff', backgroundColor: '#02050b', bloom: 0.92, speed: 1.22, bgFade: 0.34, edgeHighlightEnabled: true }
  }
]

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  const next = Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(min, Math.min(max, next))
}

function shelfMode(value: unknown): ShelfMode {
  return value === 'off' || value === 'stage' || value === 'side' ? value : DEFAULT_MUSIC_FX.shelfMode
}

function shelfCameraMode(value: unknown): ShelfCameraMode {
  return value === 'dynamic' || value === 'static' ? value : DEFAULT_MUSIC_FX.shelfCameraMode
}

function shelfPresence(value: unknown): ShelfPresence {
  return value === 'auto' || value === 'always' ? value : DEFAULT_MUSIC_FX.shelfPresence
}

function boolIn(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function renderQuality(value: unknown): RenderQuality {
  return value === 'auto' || value === 'keep' || value === 'release' ? value : DEFAULT_MUSIC_FX.renderQuality
}

function lyricSourceMode(value: unknown): LyricSourceMode {
  return value === 'custom' || value === 'original' ? value : DEFAULT_MUSIC_FX.lyricSourceMode
}

function lyricFontFamily(value: unknown): LyricFontFamily {
  return value === 'serif' || value === 'gothic' || value === 'mono' || value === 'system' ? value : DEFAULT_MUSIC_FX.lyricFontFamily
}

function colorIn(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

export function normalizeMusicFxConfig(value: unknown): MusicFxConfig {
  const raw = (value && typeof value === 'object') ? value as Partial<MusicFxConfig> : {}
  return {
    version: 1,
    playerInterface: raw.playerInterface === 'fresh' ? 'fresh' : 'particleStage',
    intensity: numberIn(raw.intensity, 0.2, 1.6, DEFAULT_MUSIC_FX.intensity),
    depth: numberIn(raw.depth, 0.2, 1.8, DEFAULT_MUSIC_FX.depth),
    scatter: numberIn(raw.scatter, 0, 1.2, DEFAULT_MUSIC_FX.scatter),
    twist: numberIn(raw.twist, 0, 1.8, DEFAULT_MUSIC_FX.twist),
    point: numberIn(raw.point, 0.45, 1.8, DEFAULT_MUSIC_FX.point),
    bloom: numberIn(raw.bloom, 0, 1.3, DEFAULT_MUSIC_FX.bloom),
    speed: numberIn(raw.speed, 0.2, 2.5, DEFAULT_MUSIC_FX.speed),
    colorTension: numberIn(raw.colorTension, 0.5, 2, DEFAULT_MUSIC_FX.colorTension),
    bgFade: numberIn(raw.bgFade, 0, 1.2, DEFAULT_MUSIC_FX.bgFade),
    cinemaShake: numberIn(raw.cinemaShake, 0, 1.8, DEFAULT_MUSIC_FX.cinemaShake),
    lyricGlowStrength: numberIn(raw.lyricGlowStrength, 0, 0.85, DEFAULT_MUSIC_FX.lyricGlowStrength),
    coverResolution: numberIn(raw.coverResolution, 0.72, 1.55, DEFAULT_MUSIC_FX.coverResolution),
    uiAccentColor: colorIn(raw.uiAccentColor, DEFAULT_MUSIC_FX.uiAccentColor),
    visualTintColor: colorIn(raw.visualTintColor, DEFAULT_MUSIC_FX.visualTintColor),
    homeAccentColor: colorIn(raw.homeAccentColor, DEFAULT_MUSIC_FX.homeAccentColor),
    homeIconColor: colorIn(raw.homeIconColor, DEFAULT_MUSIC_FX.homeIconColor),
    visualIconColor: colorIn(raw.visualIconColor, DEFAULT_MUSIC_FX.visualIconColor),
    backgroundColor: colorIn(raw.backgroundColor, DEFAULT_MUSIC_FX.backgroundColor),
    shelfMode: shelfMode(raw.shelfMode),
    shelfCameraMode: shelfCameraMode(raw.shelfCameraMode),
    shelfPresence: shelfPresence(raw.shelfPresence),
    shelfSize: numberIn(raw.shelfSize, 0.65, 1.45, DEFAULT_MUSIC_FX.shelfSize),
    shelfOffsetX: numberIn(raw.shelfOffsetX, -1.2, 1.2, DEFAULT_MUSIC_FX.shelfOffsetX),
    shelfOffsetY: numberIn(raw.shelfOffsetY, -0.9, 0.9, DEFAULT_MUSIC_FX.shelfOffsetY),
    shelfOffsetZ: numberIn(raw.shelfOffsetZ, -0.9, 0.9, DEFAULT_MUSIC_FX.shelfOffsetZ),
    shelfAngleY: numberIn(raw.shelfAngleY, -30, 30, DEFAULT_MUSIC_FX.shelfAngleY),
    shelfOpacity: numberIn(raw.shelfOpacity, 0.25, 1, DEFAULT_MUSIC_FX.shelfOpacity),
    shelfBgOpacity: numberIn(raw.shelfBgOpacity, 0.25, 0.98, DEFAULT_MUSIC_FX.shelfBgOpacity),
    shelfAccentColor: colorIn(raw.shelfAccentColor, DEFAULT_MUSIC_FX.shelfAccentColor),
    shelfShowFavorites: boolIn(raw.shelfShowFavorites, DEFAULT_MUSIC_FX.shelfShowFavorites),
    shelfShowRecents: boolIn(raw.shelfShowRecents, DEFAULT_MUSIC_FX.shelfShowRecents),
    shelfShowPodcasts: boolIn(raw.shelfShowPodcasts, DEFAULT_MUSIC_FX.shelfShowPodcasts),
    shelfMergeCollections: boolIn(raw.shelfMergeCollections, DEFAULT_MUSIC_FX.shelfMergeCollections),
    liveBackgroundKeep: boolIn(raw.liveBackgroundKeep, DEFAULT_MUSIC_FX.liveBackgroundKeep),
    gestureControlEnabled: boolIn(raw.gestureControlEnabled, DEFAULT_MUSIC_FX.gestureControlEnabled),
    backgroundOpacity: numberIn(raw.backgroundOpacity, 0.12, 1, DEFAULT_MUSIC_FX.backgroundOpacity),
    bloomEnabled: boolIn(raw.bloomEnabled, DEFAULT_MUSIC_FX.bloomEnabled),
    cinemaEnabled: boolIn(raw.cinemaEnabled, DEFAULT_MUSIC_FX.cinemaEnabled),
    floatLayerEnabled: boolIn(raw.floatLayerEnabled, DEFAULT_MUSIC_FX.floatLayerEnabled),
    edgeHighlightEnabled: boolIn(raw.edgeHighlightEnabled, DEFAULT_MUSIC_FX.edgeHighlightEnabled),
    backCoverEnabled: boolIn(raw.backCoverEnabled, DEFAULT_MUSIC_FX.backCoverEnabled),
    beatGlowEnabled: boolIn(raw.beatGlowEnabled, DEFAULT_MUSIC_FX.beatGlowEnabled),
    colorLabEnabled: boolIn(raw.colorLabEnabled, DEFAULT_MUSIC_FX.colorLabEnabled),
    lyricGlowParticlesEnabled: boolIn(raw.lyricGlowParticlesEnabled, DEFAULT_MUSIC_FX.lyricGlowParticlesEnabled),
    lyricCameraLockEnabled: boolIn(raw.lyricCameraLockEnabled, DEFAULT_MUSIC_FX.lyricCameraLockEnabled),
    wallpaperModeEnabled: boolIn(raw.wallpaperModeEnabled, DEFAULT_MUSIC_FX.wallpaperModeEnabled),
    glassChromaticOffset: numberIn(raw.glassChromaticOffset, 0, 2, DEFAULT_MUSIC_FX.glassChromaticOffset),
    splashEnabled: boolIn(raw.splashEnabled, DEFAULT_MUSIC_FX.splashEnabled),
    skullPresetEnabled: boolIn(raw.skullPresetEnabled, DEFAULT_MUSIC_FX.skullPresetEnabled),
    performanceManagerEnabled: boolIn(raw.performanceManagerEnabled, DEFAULT_MUSIC_FX.performanceManagerEnabled),
    lyricGlowEnabled: boolIn(raw.lyricGlowEnabled, DEFAULT_MUSIC_FX.lyricGlowEnabled),
    renderQuality: renderQuality(raw.renderQuality),
    lyricSourceMode: lyricSourceMode(raw.lyricSourceMode),
    lyricFontFamily: lyricFontFamily(raw.lyricFontFamily),
    lyricSize: numberIn(raw.lyricSize, 0.35, 1.65, DEFAULT_MUSIC_FX.lyricSize),
    lyricLineHeight: numberIn(raw.lyricLineHeight, 0.86, 1.35, DEFAULT_MUSIC_FX.lyricLineHeight),
    lyricLetterSpacing: numberIn(raw.lyricLetterSpacing, -0.04, 0.18, DEFAULT_MUSIC_FX.lyricLetterSpacing),
    lyricWeight: numberIn(raw.lyricWeight, 500, 900, DEFAULT_MUSIC_FX.lyricWeight),
    lyricOffsetX: numberIn(raw.lyricOffsetX, -2, 2, DEFAULT_MUSIC_FX.lyricOffsetX),
    lyricOffsetY: numberIn(raw.lyricOffsetY, -1.2, 1.35, DEFAULT_MUSIC_FX.lyricOffsetY),
    lyricOffsetZ: numberIn(raw.lyricOffsetZ, -1.6, 1.6, DEFAULT_MUSIC_FX.lyricOffsetZ),
    lyricRotateX: numberIn(raw.lyricRotateX, -42, 42, DEFAULT_MUSIC_FX.lyricRotateX),
    lyricRotateY: numberIn(raw.lyricRotateY, -42, 42, DEFAULT_MUSIC_FX.lyricRotateY),
    lyricPrimaryColor: colorIn(raw.lyricPrimaryColor, DEFAULT_MUSIC_FX.lyricPrimaryColor),
    lyricActiveColor: colorIn(raw.lyricActiveColor, DEFAULT_MUSIC_FX.lyricActiveColor),
    lyricGlowColor: colorIn(raw.lyricGlowColor, DEFAULT_MUSIC_FX.lyricGlowColor)
  }
}

export function parseMusicFxConfigJson(text: string): MusicFxConfig | null {
  try {
    return normalizeMusicFxConfig(JSON.parse(text))
  } catch {
    return null
  }
}
