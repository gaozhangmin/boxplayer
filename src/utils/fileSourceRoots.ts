import { t } from '../i18n'
import type { ITokenInfo } from '../user/userstore'
import type { IAliGetFileModel } from '../aliapi/alimodels'

export type ScanSourceTarget = { value: string; label: string; folder: IAliGetFileModel; driveServerId: string }

export function isFileSourceRoot(folder: Pick<IAliGetFileModel, 'file_id'>): boolean {
  return ['root', '/', '0', 'google_root', 'google_shared', 'pikpak_root', 'dropbox_root', 'onedrive_root', 'cloud139_root', 'cloud189_root', 'guangya_root'].includes(folder.file_id)
}

function driveLabelFromToken(token: ITokenInfo): string {
  if (token.tokenfrom === 'cloud123') return t('drive.cloud123')
  if (token.tokenfrom === '115') return t('drive.drive115')
  if (token.tokenfrom === 'baidu') return t('drive.baiduFull')
  if (token.tokenfrom === 'pikpak') return 'PikPak'
  if (token.tokenfrom === 'quark') return t('drive.quarkFull')
  if (token.tokenfrom === '139') return t('drive.cloud139')
  if (token.tokenfrom === '189') return t('drive.cloud189')
  if (token.tokenfrom === 'guangya') return t('drive.guangya')
  if (token.tokenfrom === 'dropbox') return 'Dropbox'
  if (token.tokenfrom === 'onedrive') return 'OneDrive'
  if (token.tokenfrom === 'box') return 'Box'
  if (token.tokenfrom === 'google') return 'Google Drive'
  return t('drive.aliyun')
}

function scanAccountLabel(token: ITokenInfo): string {
  if (token.source_name?.trim()) return token.source_name.trim()
  return `${driveLabelFromToken(token)} · ${token.nick_name || token.user_name || token.name || token.user_id}`
}

export function makeScanFolder(token: ITokenInfo, driveId: string, fileId: string, name: string, path = ''): IAliGetFileModel {
  const folder = {
    __v_skip: true,
    drive_id: driveId,
    file_id: fileId,
    parent_file_id: '',
    name,
    namesearch: name.toLowerCase(),
    path,
    ext: '',
    mime_type: '',
    mime_extension: '',
    category: 'folder',
    icon: '',
    size: 0,
    sizeStr: '',
    time: Date.now(),
    timeStr: '',
    starred: false,
    isDir: true,
    thumbnail: '',
    description: ''
  } as IAliGetFileModel
  ;(folder as any).user_id = token.user_id
  return folder
}

export function tokenRootScanFolders(token: ITokenInfo): ScanSourceTarget[] {
  if (!token?.user_id || !token?.access_token) return []
  const label = scanAccountLabel(token)
  if (token.tokenfrom === 'aliyun') {
    const drives = [
      { driveId: token.default_drive_id, name: t('drive.default') },
      { driveId: token.resource_drive_id, name: t('drive.resource') },
      { driveId: token.backup_drive_id, name: t('drive.backup') }
    ].filter((item): item is { driveId: string; name: string } => !!item.driveId)
    return drives.map((item) => ({
      value: `account:${token.user_id}:${item.driveId}:root`,
      label: `${label} · ${item.name}`,
      folder: makeScanFolder(token, item.driveId, 'root', item.name),
      driveServerId: item.driveId
    }))
  }

  if (token.tokenfrom === 'google') {
    return [{ value: `account:${token.user_id}:google:root`, label, driveServerId: 'google', folder: makeScanFolder(token, 'google', 'google_root', label, '/') }]
  }
  const nonAliRoot: Record<string, { driveId: string; fileId: string; path?: string }> = {
    cloud123: { driveId: 'cloud123', fileId: '0' },
    '115': { driveId: 'drive115', fileId: '0' },
    baidu: { driveId: 'baidu', fileId: '/', path: '/' },
    pikpak: { driveId: 'pikpak', fileId: 'pikpak_root' },
    quark: { driveId: 'quark', fileId: '0' },
    '139': { driveId: 'cloud139', fileId: 'cloud139_root' },
    '189': { driveId: 'cloud189', fileId: 'cloud189_root' },
    guangya: { driveId: 'guangya', fileId: 'guangya_root' },
    dropbox: { driveId: 'dropbox', fileId: 'dropbox_root' },
    onedrive: { driveId: 'onedrive', fileId: 'onedrive_root' },
    box: { driveId: 'box', fileId: '0' }
  }
  const root = nonAliRoot[token.tokenfrom]
  if (!root) return []
  return [{
    value: `account:${token.user_id}:${root.driveId}:${root.fileId}`,
    label,
    folder: makeScanFolder(token, root.driveId, root.fileId, '/', root.path || ''),
    driveServerId: root.driveId
  }]
}
