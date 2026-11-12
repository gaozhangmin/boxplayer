import type { MediaServerPlaybackQuality, MediaServerPlaybackCompatibility, MediaServerCustomDeviceProfile } from '@/features/sources/playbackQuality'
export type Theme = 'system' | 'light' | 'dark'
export type Language = 'zh-CN' | 'en'
export interface ServerPlaybackSettings { quality: MediaServerPlaybackQuality; compatibility: MediaServerPlaybackCompatibility; customProfile: MediaServerCustomDeviceProfile }
export const defaultServerPlayback = (): ServerPlaybackSettings => ({ quality:'max', compatibility:'auto', customProfile:{Action:'add',DirectPlayProfiles:[],TranscodingProfiles:[]} })
export interface ProxySettings { mode: 'system'|'direct'|'custom'; url: string }
export interface Settings {
  schemaVersion: 1
  revision: number
  theme: Theme
  language: Language
  sidebarCollapsed: boolean
  closeToTray: boolean
  launchAtLogin: boolean
  startHidden: boolean
  autoSign?: boolean
  libraryScanMinutes?: number
  proxy?: ProxySettings
  serverPlayback: ServerPlaybackSettings
}
export type SettingsPatch = Partial<Omit<Settings, 'schemaVersion' | 'revision'>>
export interface AppError { code: string; message: string; retryable: boolean }
export interface RuntimeInfo {
  schemaVersion: 1
  platform: string
  dataDirectory: string
  version: string
  pendingOpen: OpenRequest[]
}
export interface OpenRequest { kind: 'file' | 'deepLink'; value: string }
export interface PlayerProgress { schemaVersion: 1; sessionId: string; itemId: string; positionSeconds: number; durationSeconds: number; state: 'playing' | 'paused' | 'ended' }
export const defaultSettings = (): Settings => ({ schemaVersion: 1, revision: 0, theme: 'system', language: 'zh-CN', sidebarCollapsed: false, closeToTray: true, launchAtLogin: false, startHidden: false, proxy: {mode:'system',url:''}, serverPlayback: defaultServerPlayback() })

export interface LocalSource { id: string; name: string; path: string }
export interface LocalEntry { id: string; name: string; relativePath: string; isDirectory: boolean; size: number; modified: number; playable: boolean }
export interface LocalListing { sourceId: string; relativePath: string; parentPath: string | null; entries: LocalEntry[] }
export interface PlayerTrack { id: number; kind: string; title: string; language: string; selected: boolean }
export interface PlayerSnapshot {
  schemaVersion: 1; sessionId: string; itemId: string; sourceId: string; title: string; displayPath?: string
  state: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
  position: number; duration: number; bufferedPosition?: number; volume: number; speed: number; tracks: PlayerTrack[]
  videoWidth: number; videoHeight: number; queueIndex: number; queueLength: number; queue?: {itemId: string; title: string}[]
  error: string | null; runtime: string; engineVersion?: string; embedded: boolean; sequence: number
}
export interface MigrationReport { applied: boolean; sourceCount: number; positionCount: number; mediaCount?: number; backupId?: string|null; preferences?:Record<string,string> }
export interface RefreshRequest { requestId: string; sourceId: string; accountId: string; fileId: string }
