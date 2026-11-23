import { describe, expect, it } from 'vitest'
import { getProviderCapabilities } from '../../services/agent/providerCapabilities'

describe('delete-to-trash capabilities', () => {
  it('matches every provider adapter that implements a delete-to-trash command', () => {
    for (const provider of ['aliyun', 'cloud123', '115', 'baidu', 'pikpak', 'quark', 'cloud139', 'cloud189', 'guangya', 'dropbox', 'onedrive', 'box']) {
      expect(getProviderCapabilities(provider).operations['trash.move']).toBe(true)
    }
  })

  it('lets Google Drive list the recycle bin without moving or restoring files', () => {
    const operations = getProviderCapabilities('google').operations
    expect(operations['trash.list']).toBe(true)
    expect(operations['trash.move']).toBe(false)
    expect(operations['trash.restore']).toBe(false)
    expect(operations['trash.delete']).toBe(false)
  })

  it('does not imply unsupported recycle-bin management', () => {
    for (const provider of ['baidu', 'cloud139', 'cloud189', 'guangya', 'quark', 'dropbox', 'onedrive']) {
      expect(getProviderCapabilities(provider).operations['trash.delete']).toBe(false)
      expect(getProviderCapabilities(provider).operations['trash.restore']).toBe(false)
    }
  })
})
