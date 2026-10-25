import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('cloud folder download', () => {
  it('lists third-party child files with their provider APIs instead of the Aliyun endpoint', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/aliapi/trash.ts'), 'utf8')
    const providers = readFileSync(resolve(process.cwd(), 'src/drive/providerList.ts'), 'utf8')

    expect(source).toContain('resolveDriveProvider(dir.m_user_id, dir.m_drive_id')
    expect(source).toContain('listProviderItems(route.provider, dir.m_user_id, dir.m_drive_id')
    for (const adapter of ['listDrive115Items', 'listCloud123Items', 'listBaiduItems', 'listPikPakItems', 'listQuarkItems', 'listCloud139Items', 'listCloud189Items', 'listGuangyaItems', 'listDropboxItems', 'listOneDriveItems', 'listBoxItems']) {
      expect(providers).toContain(adapter)
    }
  })

  it('preserves Baidu folder paths between recursive download tasks', () => {
    const downDal = readFileSync(resolve(process.cwd(), 'src/down/DownDAL.ts'), 'utf8')
    const aria = readFileSync(resolve(process.cwd(), 'src/utils/aria2c.ts'), 'utf8')

    expect(downDal).toContain('cloudPath?: string')
    expect(downDal).toContain("cloudPath: file.path || ''")
    expect(aria).toContain("dirInfo as any).dirPath = info.cloudPath || ''")
  })

  it('normalizes synthetic root ids before listing recursive Aliyun download children', () => {
    const trash = readFileSync(resolve(process.cwd(), 'src/aliapi/trash.ts'), 'utf8')
    expect(trash).toContain("const parentFileId = dir.dirID.includes('root') ? 'root' : dir.dirID")
    expect(trash).toContain('parent_file_id: parentFileId')
  })
})
