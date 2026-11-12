import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { AppError, RuntimeInfo, Settings, SettingsPatch } from './contracts'

export const isNative = () => isTauri()
export function asAppError(error: unknown): AppError {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) return error as AppError
  return { code: 'NATIVE_ERROR', message: error instanceof Error ? error.message : String(error), retryable: false }
}
export async function nativeCall<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isNative()) throw { code: 'NATIVE_UNAVAILABLE', message: '浏览器预览：原生功能不可用，请运行 pnpm tauri dev。', retryable: false } satisfies AppError
  try { return await invoke<T>(command, args) } catch (error) { throw asAppError(error) }
}
export const getSettings = () => nativeCall<Settings>('settings_get')
export const updateSettings = (expectedRevision: number, patch: SettingsPatch) => nativeCall<Settings>('settings_update', { expectedRevision, patch })
export const runtimeInfo = () => nativeCall<RuntimeInfo>('runtime_info')
export const openWindow = (kind: 'settings' | 'player') => nativeCall<void>('window_open', { kind })
export const openFile = () => nativeCall<string | null>('choose_file')
export const revealData = () => nativeCall<void>('reveal_data_directory')
export const openWebsite = (target: 'help' | 'feedback') => nativeCall<void>('open_website', { target })
export const showContextMenu = (x: number, y: number) => nativeCall<void>('show_context_menu', { x, y })
export async function onSettingsChanged(callback: (settings: Settings) => void): Promise<UnlistenFn> {
  if (!isNative()) return () => {}
  return listen<Settings>('settings:changed', event => callback(event.payload))
}

export const localSources = () => nativeCall<import('./contracts').LocalSource[]>('local_sources')
export const addLocalSource = () => nativeCall<import('./contracts').LocalSource | null>('local_add_source')
export const localList = (sourceId: string, relativePath = '') => nativeCall<import('./contracts').LocalListing>('local_list', { sourceId, relativePath })
export const playLocal = (sourceId: string, relativePath: string) => nativeCall<void>('player_open_local', { sourceId, relativePath })
export const playFile = (path: string) => nativeCall<void>('player_open_file', { path })
export const playerState = () => nativeCall<import('./contracts').PlayerSnapshot>('player_state')
export const playerControl = (sessionId: string, action: string, value?: number, trackId?: number) => nativeCall<void>('player_control', { control: { sessionId, action, value: value ?? null, trackId: trackId ?? null } })
export const closePlayer = () => nativeCall<void>('player_close')
const migrationPreferenceKey=(key:string)=>['unified-library-category-placement-v2','unified-media-home-preferences','unified-library-category-bookmarks-v1','unified-library-favorite-card-order-v1','tauri.filePreferences'].includes(key)||key.startsWith('series.')||key.startsWith('general.')
export function migrationPreferences(){const result:Record<string,string>={};for(let index=0;index<localStorage.length;index++){const key=localStorage.key(index);if(key&&migrationPreferenceKey(key)){const value=localStorage.getItem(key);if(value!==null)result[key]=value}}return result}
export const exportMigration = () => nativeCall<boolean>('migration_export',{preferences:migrationPreferences()})
export const importMigration = () => nativeCall<import('./contracts').MigrationReport | null>('migration_import')

export const inspectMigration=()=>nativeCall<{schemaVersion:number;sourceVersion:string;tables:Record<string,number>;sha256:string}|null>('migration_inspect')
