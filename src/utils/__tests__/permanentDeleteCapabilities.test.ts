import { describe, expect, it, vi } from 'vitest'

vi.mock('../../user/userdal', () => ({
  default: { GetUserToken: () => undefined }
}))

import { supportsDirectPermanentDelete, supportsTrashPermanentDelete } from '../../drive/providerFeatures'

describe('permanent delete capabilities', () => {
  it('only offers direct permanent deletion where the provider command supports it', () => {
    expect(supportsDirectPermanentDelete('aliyun_user', 'unknown-drive')).toBe(true)
    expect(supportsDirectPermanentDelete('', 'pikpak')).toBe(true)
    expect(supportsDirectPermanentDelete('', 'google')).toBe(false)

    expect(supportsDirectPermanentDelete('', 'cloud123')).toBe(false)
    expect(supportsDirectPermanentDelete('', 'drive115')).toBe(false)
    expect(supportsDirectPermanentDelete('', 'box')).toBe(false)
    expect(supportsDirectPermanentDelete('', 'onedrive')).toBe(false)
  })

  it('keeps providers that implement trash purging available inside their recycle bins', () => {
    expect(supportsTrashPermanentDelete('', 'drive115')).toBe(true)
    expect(supportsTrashPermanentDelete('', 'box')).toBe(true)
  })
})
