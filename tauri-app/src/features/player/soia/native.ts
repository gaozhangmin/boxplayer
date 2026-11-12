// Compatibility boundary for unmodified soia UI. Never expose arbitrary mpv commands.
import { isNative, playerState, playerControl } from '@/platform/native'
export const isTauri = isNative
export function unavailable(feature: string): never { throw new Error(`${feature} 尚未接入；当前不会执行此操作。`) }
const properties: Record<string, string> = { 'video-aspect-override': 'aspect', 'video-zoom': 'zoom' }
export async function invoke<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  if (command === 'is_native_pip_enabled') return false as T
  if (command !== 'mpv_run_command') return unavailable('画中画')
  const args = payload?.args
  if (!Array.isArray(args) || args.length !== 3 || args[0] !== 'set' || !properties[args[1]]) return unavailable('播放命令')
  const state = await playerState()
  const number = args[2] === 'no' ? -1 : Number(args[2])
  if (!Number.isFinite(number)) throw new Error('无效播放参数')
  await playerControl(state.sessionId, properties[args[1]], number)
  return undefined as T
}
export async function loadUiState<T>(): Promise<T | null> { return null }
export async function applyRenderingSettings(_selected: string[], _active: string[]): Promise<{ activeShaderFiles: string[] } | null> { if (!_selected.length && !_active.length) return { activeShaderFiles: [] }; return unavailable('Shader 配置') }
