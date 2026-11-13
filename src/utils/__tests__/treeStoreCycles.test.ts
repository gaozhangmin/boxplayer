import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../db', () => ({ default: { getValueObject: async () => undefined } }))
vi.mock('../../store', () => ({ usePanTreeStore: () => ({ user_id: 'cloud189_fixture' }), useSettingStore: () => ({}) }))
vi.mock('../../aliapi/utils', () => ({ GetDriveType: () => ({ key: 'cloud189_root', title: 'Root' }) }))
import type { DirData } from '../../store/treestore'
let TreeStore: typeof import('../../store/treestore').default

const folder = (drive: string, id: string, parent: string): DirData => ({
  file_id: id, drive_id: drive, parent_file_id: parent, name: id, description: '', size: 0, time: 0
})
beforeAll(async () => {
  Object.assign(globalThis, { self: globalThis })
  TreeStore = (await import('../../store/treestore')).default
})

describe('directory graph corruption', () => {
  it('ends a family breadcrumb at the personal root despite a legacy empty-ID cache entry', async () => {
    const drive = 'legacy-family'
    const empty = folder(drive, '', 'cloud189_root')
    const driver = await TreeStore.ConvertToOneDriver('fixture', drive,
      [empty, folder(drive, 'family', 'cloud189_root')], false, true)
    expect(driver.DirMap.has('')).toBe(false)
    // Reproduce an already-loaded pre-fix cache without touching an actual account.
    driver.DirMap.set('', empty)
    expect(TreeStore.GetDirPath(drive, 'family').map(item => item.file_id))
      .toEqual(['cloud189_root', 'family'])
  })

  it('rejects a disconnected self-parent instead of allocating an endless breadcrumb array', async () => {
    const drive = 'self-cycle'
    await TreeStore.ConvertToOneDriver('fixture', drive, [folder(drive, 'family', 'family')], false, true)
    expect(() => TreeStore.GetDirPath(drive, 'family')).toThrow('Cyclic directory parent chain')
  })

  it('rejects a multi-directory parent cycle', async () => {
    const drive = 'parent-cycle'
    await TreeStore.ConvertToOneDriver('fixture', drive, [folder(drive, 'a', 'b'), folder(drive, 'b', 'a')], false, true)
    expect(() => TreeStore.GetDirPath(drive, 'a')).toThrow('Cyclic directory parent chain')
  })

  it('rejects a root child cycle while calculating sizes', async () => {
    const drive = 'root-cycle'
    await expect(TreeStore.ConvertToOneDriver('fixture', drive,
      [folder(drive, 'a', 'cloud189_root'), folder(drive, 'cloud189_root', 'a')], false, true))
      .rejects.toThrow('Cyclic directory child graph')
  })

  it('keeps a valid family path and unrelated siblings unchanged', async () => {
    const drive = 'valid-family'
    await TreeStore.ConvertToOneDriver('fixture', drive, [folder(drive, 'family', 'cloud189_root'),
      folder(drive, 'child', 'family'), folder(drive, 'other', 'cloud189_root')], false, true)
    expect(TreeStore.GetDirPath(drive, 'child').map(item => item.file_id)).toEqual(['cloud189_root', 'family', 'child'])
    expect(TreeStore.GetDirPath(drive, 'other').map(item => item.file_id)).toEqual(['cloud189_root', 'other'])
  })
})
