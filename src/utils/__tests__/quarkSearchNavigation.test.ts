import { describe, expect, it, vi } from 'vitest'
import { resolveQuarkSearchDirectory } from '../quarkSearchNavigation'

describe('Quark search result navigation', () => {
  it.each(['0', '/', 'root', 'quark_root'])('locates a root-level file from parent %s', async (parentFileId) => {
    expect(await resolveQuarkSearchDirectory({ fileId: 'video', parentFileId, isDir: false }, vi.fn())).toBe('quark_root')
  })

  it('opens the selected folder rather than its parent', async () => {
    const readParent = vi.fn()
    expect(await resolveQuarkSearchDirectory({ fileId: 'folder', parentFileId: 'parent', isDir: true }, readParent)).toBe('folder')
    expect(readParent).not.toHaveBeenCalled()
  })

  it('locates a nested file without an extra provider request', async () => {
    const readParent = vi.fn()
    expect(await resolveQuarkSearchDirectory({ fileId: 'video', parentFileId: 'nested', isDir: false }, readParent)).toBe('nested')
    expect(readParent).not.toHaveBeenCalled()
  })

  it('fetches a missing parent instead of passing the file ID to the folder browser', async () => {
    const readParent = vi.fn().mockResolvedValue('0')
    expect(await resolveQuarkSearchDirectory({ fileId: 'video', isDir: false }, readParent)).toBe('quark_root')
    expect(readParent).toHaveBeenCalledOnce()
  })

  it('rejects missing metadata and provider errors instead of silently opening another location', async () => {
    await expect(resolveQuarkSearchDirectory({ fileId: 'video', isDir: false }, async () => undefined)).rejects.toThrow()
    await expect(resolveQuarkSearchDirectory({ fileId: 'video', isDir: false }, async () => { throw new Error('offline') })).rejects.toThrow('offline')
  })
})
