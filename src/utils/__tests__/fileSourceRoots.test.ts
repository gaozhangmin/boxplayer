import { expect, it } from 'vitest'
import { tokenRootScanFolders } from '../fileSourceRoots'
import type { ITokenInfo } from '../../user/userstore'
it('provides a Google account root with the owning account attached for source browsing', () => {
  const roots = tokenRootScanFolders({ user_id: 'google-account', access_token: 'test', tokenfrom: 'google', user_name: 'Account' } as ITokenInfo)
  expect(roots).toHaveLength(1)
  expect(roots[0].folder).toMatchObject({ user_id: 'google-account', drive_id: 'google', file_id: 'google_root', isDir: true })
})
it('preserves backup and resource drive identities even when default aliases a drive', () => {
  const roots = tokenRootScanFolders({ user_id: 'aliyun-account', access_token: 'test', tokenfrom: 'aliyun', default_drive_id: 'backup', backup_drive_id: 'backup', resource_drive_id: 'resource' } as ITokenInfo)
  expect(roots.some(r => r.folder.drive_id === 'backup')).toBe(true)
  expect(roots.some(r => r.folder.drive_id === 'resource')).toBe(true)
  expect(roots.every(r => (r.folder as any).user_id === 'aliyun-account')).toBe(true)
})

it.each(['cloud123', '115', 'baidu', 'pikpak', 'quark', '139', '189', 'guangya', 'dropbox', 'onedrive', 'box', 'google'])('provides an explicit directory root for %s', provider => {
  const roots = tokenRootScanFolders({ user_id: 'account', access_token: 'test', tokenfrom: provider } as ITokenInfo)
  expect(roots.length).toBeGreaterThan(0)
  for (const root of roots) {
    expect(root.folder.isDir).toBe(true)
    expect(root.folder.file_id).toBeTruthy()
    expect(root.folder.drive_id).toBeTruthy()
  }
})
