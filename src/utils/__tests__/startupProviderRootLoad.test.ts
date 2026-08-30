import { describe, expect, it } from 'vitest'
import { loadInitialProviderRoot, selectInitialAliyunRoot, shouldRetryInitialRootLoad } from '../../user/startupProviderRootLoad'

describe('startup provider root loading', () => {
  it('retries a failed third-party initial root request once', async () => {
    let attempts = 0

    await loadInitialProviderRoot(true, async () => {
      attempts += 1
      if (attempts === 1) throw new Error('cold-start request failed')
    }, async () => undefined)

    expect(attempts).toBe(2)
    expect(shouldRetryInitialRootLoad('cloud123')).toBe(true)
    expect(shouldRetryInitialRootLoad('baidu')).toBe(true)
    expect(shouldRetryInitialRootLoad('139')).toBe(true)
  })

  it('does not retry the existing provider path', async () => {
    let attempts = 0

    await expect(loadInitialProviderRoot(false, async () => {
      attempts += 1
      throw new Error('request failed')
    }, async () => undefined)).rejects.toThrow('request failed')

    expect(attempts).toBe(1)
    expect(shouldRetryInitialRootLoad('aliyun')).toBe(false)
  })

  it('默认“全部”时直接打开备份盘，不先跳转资源盘', () => {
    expect(selectInitialAliyunRoot('all', 'backup-drive', 'resource-drive')).toEqual({ driveId: 'backup-drive', rootId: 'backup_root' })
  })

  it('显式选择资源盘时打开资源盘', () => {
    expect(selectInitialAliyunRoot('resource', 'backup-drive', 'resource-drive')).toEqual({ driveId: 'resource-drive', rootId: 'resource_root' })
  })

  it('首选盘不存在时回退到可用盘', () => {
    expect(selectInitialAliyunRoot('backup', '', 'resource-drive')).toEqual({ driveId: 'resource-drive', rootId: 'resource_root' })
    expect(selectInitialAliyunRoot('resource', 'backup-drive', '')).toEqual({ driveId: 'backup-drive', rootId: 'backup_root' })
  })

  it('启动时每个阿里云盘只准备一次，并且只打开一个根目录', async () => {
    const source = await import('../../user/userdal.ts?raw')
    const start = source.default.indexOf('static async LoadPanData')
    const end = source.default.indexOf('static async UserLogOff', start)
    const loadPanData = source.default.slice(start, end)

    expect(loadPanData.match(/PanDAL\.aReLoadBackupDrive\(token\)/g)).toHaveLength(1)
    expect(loadPanData.match(/PanDAL\.aReLoadResourceDrive\(token\)/g)).toHaveLength(1)
    expect(loadPanData.match(/PanDAL\.aReLoadOneDirToShow\(/g)).toHaveLength(1)
  })
})
