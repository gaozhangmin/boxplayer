import { describe, expect, it, vi } from 'vitest'
import { nativeCall } from '@/platform/native'
import { invoke } from '@tauri-apps/api/core'
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }))
describe('browser boundary', () => {
  it('rejects native operations explicitly instead of returning fake success', async () => {
    await expect(nativeCall('settings_update', { patch: { theme: 'dark' } })).rejects.toMatchObject({ code: 'NATIVE_UNAVAILABLE' })
    expect(invoke).not.toHaveBeenCalled()
  })
})
