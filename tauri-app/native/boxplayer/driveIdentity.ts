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

