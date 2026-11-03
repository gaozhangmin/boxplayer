export interface MediaAcquisitionCapability {
  label: string
  shareImport: boolean
  magnetOfflineDownload: boolean
  externalUrlOfflineDownload: boolean
}

const PLATFORM_ALIASES: Record<string, string> = {
  drive115: '115',
  '123': 'cloud123'
}

export function getMediaAcquisitionCapability(platform: string): MediaAcquisitionCapability | null {
  const normalized = normalizeProviderPlatform(platform)
  const manifest = getProviderCapabilities(normalized)
  const capability = {
    label: manifest.name,
    shareImport: manifest.operations['share.import'],
    magnetOfflineDownload: manifest.operations['offline.magnet'],
    externalUrlOfflineDownload: manifest.operations['offline.http']
  }
  return supportsMediaAcquisition(capability) ? capability : null
}

export function formatMediaAcquisitionCapability(capability: MediaAcquisitionCapability): string {
  return [capability.shareImport ? '分享导入' : '', capability.magnetOfflineDownload ? '磁力离线' : '', capability.externalUrlOfflineDownload ? 'HTTP 外链离线' : ''].filter(Boolean).join('、')
}

export function supportsMediaAcquisition(capability: MediaAcquisitionCapability | null | undefined): boolean {
  return Boolean(capability && (capability.shareImport || capability.magnetOfflineDownload || capability.externalUrlOfflineDownload))
}

export function normalizeMediaAcquisitionPlatform(platform: string): string {
  const value = String(platform || '').toLowerCase()
  return PLATFORM_ALIASES[value] || value
}

export function normalizeMediaAcquisitionRootFolder(platform: string, folderId: string | undefined): string {
  const normalizedPlatform = normalizeMediaAcquisitionPlatform(platform)
  const value = String(folderId || '')
  if (normalizedPlatform === '115' && (!value || value === 'drive115' || value === 'drive115_root' || value === 'root')) return 'drive115_root'
  if (normalizedPlatform === 'pikpak' && (!value || value === 'pikpak' || value === 'pikpak_root' || value === 'root')) return 'pikpak_root'
  if (normalizedPlatform === 'quark' && (!value || value === 'quark' || value === 'quark_root' || value === 'root')) return 'quark_root'
  if (normalizedPlatform === 'guangya' && (!value || value === 'guangya' || value === 'guangya_root' || value === 'root')) return 'guangya_root'
  if (normalizedPlatform === 'cloud123' && (!value || value === 'cloud123' || value === 'cloud_root' || value === 'root')) return 'cloud_root'
  return value
}
import { getProviderCapabilities, normalizeProviderPlatform } from '../agent/providerCapabilities'

/** Drives the mediary engine can land files on with BoxPlayer's own login (see electron/main/mediary). */
const MEDIARY_PLATFORMS = new Set(['115', 'cloud123', 'aliyun', 'pikpak', 'quark', 'guangya'])

export function isMediaryAcquisitionPlatform(platform: string): boolean {
  return MEDIARY_PLATFORMS.has(normalizeMediaAcquisitionPlatform(platform))
}
