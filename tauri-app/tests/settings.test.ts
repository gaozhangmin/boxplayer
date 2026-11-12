import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defaultSettings, type Settings } from '@/platform/contracts'
import { useSettingsStore } from '@/stores/settings'
import * as native from '@/platform/native'

vi.mock('@/platform/native', async importOriginal => {
  const actual = await importOriginal<typeof import('@/platform/native')>()
  return { ...actual, isNative: vi.fn(() => true), getSettings: vi.fn(), updateSettings: vi.fn(), onSettingsChanged: vi.fn() }
})
let listener: (value: Settings) => void
const stop = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  vi.mocked(native.isNative).mockReturnValue(true)
  vi.mocked(native.getSettings).mockResolvedValue(defaultSettings())
  vi.mocked(native.onSettingsChanged).mockImplementation(async callback => { listener = callback; return stop })
})
describe('settings across windows', () => {
  it('subscribes before reading and rejects a stale initial response', async () => {
    vi.mocked(native.getSettings).mockImplementation(async () => {
      listener({ ...defaultSettings(), revision: 2, theme: 'dark' })
      return { ...defaultSettings(), revision: 1, theme: 'light' }
    })
    const store = useSettingsStore()
    await store.initialize()
    expect(store.value.theme).toBe('dark')
    expect(store.value.revision).toBe(2)
    expect(store.ready).toBe(true)
    store.dispose()
    expect(stop).toHaveBeenCalledOnce()
  })
  it('updates from another window without overwriting newer state', async () => {
    const store = useSettingsStore()
    await store.initialize()
    listener({ ...defaultSettings(), revision: 4, language: 'en' })
    listener({ ...defaultSettings(), revision: 3, language: 'zh-CN' })
    expect(store.value.language).toBe('en')
    expect(store.value.revision).toBe(4)
  })
  it('preserves the saved value when disk write fails', async () => {
    const store = useSettingsStore()
    await store.initialize()
    vi.mocked(native.updateSettings).mockRejectedValue({ code: 'STORAGE_IO', message: 'disk full', retryable: true })
    await expect(store.save({ theme: 'dark' })).rejects.toMatchObject({ code: 'STORAGE_IO' })
    expect(store.value.theme).toBe('system')
    expect(store.error).toBe('disk full')
    expect(store.saving).toBe(false)
  })
  it('reloads after revision conflict instead of retrying stale fields', async () => {
    const store = useSettingsStore()
    await store.initialize()
    vi.mocked(native.getSettings).mockResolvedValue({ ...defaultSettings(), revision: 3, theme: 'light' })
    vi.mocked(native.updateSettings).mockRejectedValue({ code: 'REVISION_CONFLICT', message: 'reload', retryable: true })
    await expect(store.save({ theme: 'dark' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(store.value.revision).toBe(3)
    expect(store.value.theme).toBe('light')
    expect(native.updateSettings).toHaveBeenCalledTimes(1)
  })
  it('initializes a browser preview without native calls or persistence', async () => {
    vi.mocked(native.isNative).mockReturnValue(false)
    const store = useSettingsStore()
    await store.initialize()
    expect(store.preview).toBe(true)
    expect(store.ready).toBe(true)
    expect(native.getSettings).not.toHaveBeenCalled()
    expect(native.onSettingsChanged).not.toHaveBeenCalled()
  })
})
