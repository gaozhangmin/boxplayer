import { beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import Player from '@/entries/player/App.vue'
import type { PlayerSnapshot } from '@/platform/contracts'
import * as native from '@/platform/native'
let listener: (event: { payload: PlayerSnapshot }) => void
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (_name, callback) => { if (_name === 'player:state') listener = callback; return vi.fn() }) }))
vi.mock('@/platform/native', async original => ({ ...await original<typeof import('@/platform/native')>(), isNative: () => true, playerState: vi.fn(), playerControl: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ isFullscreen: async () => false, isMaximized: async () => false, onResized: async () => vi.fn() }) }))
vi.mock('vue-sonner', () => ({ Toaster: { template: '<div />' } }))
const initial: PlayerSnapshot = { schemaVersion: 1, sessionId: 'session-a', itemId: 'video-a', sourceId: 'source-a', title: 'video.mp4', displayPath: '/Users/tester/Videos/video.mp4', state: 'paused', position: 2, duration: 10, volume: 70, speed: 1, tracks: [], videoWidth: 640, videoHeight: 360, queueIndex: 0, queueLength: 1, error: null, runtime: '/runtime', embedded: true, sequence: 1 }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(native.playerState).mockResolvedValue(initial) })
it('sends play controls with the current session and rejects an older event', async () => {
  const wrapper = mount(Player, { global: { plugins: [createPinia()] } }); await flushPromises()
  listener({ payload: { ...initial, sequence: 3, sessionId: 'session-b' } }); await flushPromises()
  listener({ payload: { ...initial, sequence: 2, sessionId: 'stale' } }); await flushPromises()
  await wrapper.get('button[title="Play"]').trigger('click'); await flushPromises()
  expect(native.playerControl).toHaveBeenCalledWith('session-b', 'pause', 0, undefined)
  expect(wrapper.find('.top-bar').exists()).toBe(true)
  expect((wrapper.get('input.top-bar__input').element as HTMLInputElement).value).toBe('~/Videos/video.mp4')
  expect(wrapper.find('.controls-left').exists()).toBe(true)
  expect(wrapper.find('.controls-right').exists()).toBe(true)
  expect(wrapper.find('.side-actions').exists()).toBe(true)
  expect(wrapper.find('.player-diagnostics').exists()).toBe(false)
  expect(wrapper.find('select[aria-label="倍速"]').exists()).toBe(false)
  wrapper.unmount()
})
