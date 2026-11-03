import { asDriveAuthError, loadCliDriveProvider, resolveCliToken, type CliDriveProvider, type CliToken } from './cliDrive'
import type { BoxPlayerDriveClient, DriveItem } from './BoxPlayerStorageExecutor'
import { create115OfflineTask, create123OfflineTask, createPikPakOfflineTask, get115OfflineTaskStatus, get123OfflineTaskStatus, getPikPakOfflineTaskStatus, importAliyunShare, importPikPakShare } from './providerTransfers'

/** Drive platforms whose mediary executor is BoxPlayer's own (quark and guangya use the vendored executors). */
export const BOXPLAYER_HOSTED_PLATFORMS = ['115', 'cloud123', 'aliyun', 'pikpak'] as const

const PROVIDER_ROOTS: Record<string, string> = { '115': '0', cloud123: '0', aliyun: 'root', pikpak: '' }
const LABELS: Record<string, string> = { '115': '115 网盘', cloud123: '123 云盘', aliyun: '阿里云盘', pikpak: 'PikPak' }
/** BoxPlayer's own placeholder ids for a drive root. */
const ROOT_ALIASES = new Set(['root', 'drive115', 'drive115_root', 'cloud123', 'cloud_root', 'pikpak', 'pikpak_root', 'quark', 'quark_root', 'guangya', 'guangya_root'])

export function normalizeBoxPlayerPlatform(platform: string): string {
  const value = String(platform || '').toLowerCase()
  if (value === 'drive115') return '115'
  if (value === '123' || value === '123pan') return 'cloud123'
  if (value === 'ali' || value === 'alipan') return 'aliyun'
  return value
}

/** The provider id for a folder id as BoxPlayer stores it. */
export function providerFolderId(platform: string, folderId: string): string {
  const id = String(folderId || '').trim()
  if (!id || ROOT_ALIASES.has(id)) return PROVIDER_ROOTS[normalizeBoxPlayerPlatform(platform)] ?? '0'
  return id
}

export async function createBoxPlayerDriveClient(input: { platform: string; userId: string; driveId: string }): Promise<BoxPlayerDriveClient> {
  const platform = normalizeBoxPlayerPlatform(input.platform)
  if (!(BOXPLAYER_HOSTED_PLATFORMS as readonly string[]).includes(platform)) throw new Error(`${input.platform} 不由 BoxPlayer 网盘执行器处理`)
  const provider = await loadCliDriveProvider(platform)
  const driveId = platform === 'aliyun' ? input.driveId : undefined
  const token = () => resolveCliToken(platform, input.userId, provider)
  const call = async <T>(work: (token: CliToken) => Promise<T>): Promise<T> => {
    try {
      return await work(await token())
    } catch (error) {
      throw asDriveAuthError(error)
    }
  }
  return {
    label: LABELS[platform],
    rootId: PROVIDER_ROOTS[platform],
    listFiles: directoryId => call(async t => (await provider.files.list({ token: t, driveId, parentFileId: directoryId })).map(toDriveItem)),
    createDirectory: (parentId, name) => call(async t => {
      const created = await provider.files.mkdir({ token: t, driveId, parentId, name })
      if (!created?.fileId) throw new Error(`${LABELS[platform]} 创建目录失败：${name}`)
      return created.fileId
    }),
    renameFile: (fileId, newName) => call(async t => assertBatchSucceeded(await provider.files.renameBatch({ token: t, driveId, renames: [{ fileId, newName }] }), '重命名')),
    moveFiles: (fileIds, targetDirectoryId) => call(async t => assertBatchSucceeded(await provider.files.moveBatch({ token: t, driveId, moves: fileIds.map(fileId => ({ fileId, toParentId: targetDirectoryId })) }), '移动')),
    trashFiles: fileIds => call(async t => { await provider.files.trash({ token: t, driveId, items: fileIds.map(fileId => ({ fileId })) }) }),
    ...transferCapabilities(platform, input.driveId, call)
  }
}

function transferCapabilities(platform: string, driveId: string, call: <T>(work: (token: CliToken) => Promise<T>) => Promise<T>): Partial<BoxPlayerDriveClient> {
  if (platform === 'aliyun') {
    return { shareTypes: ['aliyun'], importShare: ({ url, password, directoryId }) => call(t => importAliyunShare(t, driveId, url, password, directoryId)) }
  }
  if (platform === 'pikpak') {
    return {
      shareTypes: ['pikpak'],
      importShare: ({ url, password, directoryId }) => call(t => importPikPakShare(t, url, password, directoryId)),
      createOfflineTask: ({ url, title, directoryId }) => call(t => createPikPakOfflineTask(t, url, title, directoryId)),
      getOfflineTaskStatus: task => call(t => getPikPakOfflineTaskStatus(t, task))
    }
  }
  if (platform === '115') {
    return {
      createOfflineTask: ({ url, directoryId }) => call(t => create115OfflineTask(t, url, directoryId)),
      getOfflineTaskStatus: task => call(t => get115OfflineTaskStatus(t, task))
    }
  }
  return {
    createOfflineTask: ({ url, title, directoryId }) => call(t => create123OfflineTask(t, url, title, directoryId)),
    getOfflineTaskStatus: task => call(t => get123OfflineTaskStatus(t, task))
  }
}

function toDriveItem(item: { fileId: string; name: string; type: string; size?: number }): DriveItem {
  return { id: String(item.fileId), name: String(item.name || ''), isDirectory: item.type === 'folder', size: Number(item.size || 0) }
}

function assertBatchSucceeded(results: Array<{ fileId: string; status: string; message?: string }>, action: string): void {
  const failed = (results || []).filter(item => item.status !== 'success')
  if (failed.length) throw new Error(`${action}失败：${failed.map(item => item.message || item.fileId).join('；')}`)
}

export type { CliDriveProvider }
