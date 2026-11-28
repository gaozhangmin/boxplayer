import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Player from '@/entries/player/App.vue'
import type { PlayerSnapshot } from '@/platform/contracts'
import * as native from '@/platform/native'

let publish: (event: { payload: PlayerSnapshot }) => void
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name, callback) => {
  if (name === 'player:state') publish = callback
  return vi.fn()
}) }))
vi.mock('@/platform/native', async original => ({
  ...await original<typeof import('@/platform/native')>(), isNative: () => true,
  nativeCall: vi.fn(), playerState: vi.fn(), openFile: vi.fn(),
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({
  isFullscreen: async () => false, isMaximized: async () => false, onResized: async () => vi.fn(),
}) }))
vi.mock('vue-sonner', () => ({ Toaster: { template: '<div />' } }))

const idle: PlayerSnapshot = {
  schemaVersion: 1, sessionId: '', itemId: '', sourceId: '', title: '', state: 'idle',
  position: 0, duration: 0, volume: 70, speed: 1, tracks: [], videoWidth: 0, videoHeight: 0,
  queueIndex: 0, queueLength: 0, error: null, runtime: '', embedded: false, sequence: 0,
}
const loading: PlayerSnapshot = {
  ...idle, sessionId: 'video-session', itemId: 'video', sourceId: 'source', title: 'video.mp4',
  state: 'loading', queueLength: 1, embedded: true, sequence: 1,
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
  vi.mocked(native.openFile).mockResolvedValue(null)
})
afterEach(() => vi.unstubAllGlobals())

it('keeps the startup canvas black through unknown, idle and loading states', async () => {
  let finishSnapshot!: (snapshot: PlayerSnapshot) => void
  vi.mocked(native.playerState).mockReturnValue(new Promise(resolve => { finishSnapshot = resolve }))
  const window = mount(Player, { global: { plugins: [createPinia()] } })
  const canvas = window.get('.soia-container')

  expect(canvas.classes()).toContain('video-background')
  expect(canvas.find('.soia-empty').exists()).toBe(false)
  expect(canvas.find('.soia-loading').exists()).toBe(false)
  await flushPromises()
  expect(native.playerState).toHaveBeenCalled()
  finishSnapshot(idle)
  await flushPromises()
  expect(canvas.classes()).toContain('video-background')
  expect(canvas.text()).not.toMatch(/选择视频|select a video/i)
  expect(canvas.find('.soia-loading').exists()).toBe(false)

  publish({ payload: loading })
  await flushPromises()
  expect(canvas.find('.soia-loading [role="status"]').exists()).toBe(true)
  expect(canvas.classes()).toContain('video-background')

  publish({ payload: { ...loading, state: 'playing', videoWidth: 1280, videoHeight: 720, sequence: 2 } })
  await flushPromises()
  expect(canvas.classes()).toContain('video-mode')
  expect(canvas.classes()).not.toContain('video-background')
  expect(canvas.find('.soia-loading').exists()).toBe(false)
})

it('shows playback errors without a selection prompt and keeps the toolbar file picker', async () => {
  vi.mocked(native.playerState).mockResolvedValue({ ...loading, state: 'error', error: 'Video could not be opened' })
  const window = mount(Player, { global: { plugins: [createPinia()] } })
  await flushPromises()
  expect(window.get('.soia-playback-error[role="alert"]').text()).toBe('Video could not be opened')
  expect(window.find('.soia-empty').exists()).toBe(false)
  await window.get('button[title="Open File"]').trigger('click')
  expect(native.openFile).toHaveBeenCalledOnce()
})
