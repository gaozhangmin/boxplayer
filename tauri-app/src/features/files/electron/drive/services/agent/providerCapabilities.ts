import aliyun from '../../aliapi/capabilities'
import cloud123 from '../../cloud123/capabilities'
import cloud115 from '../../cloud115/capabilities'
import cloud139 from '../../cloud139/capabilities'
import cloud189 from '../../cloud189/capabilities'
import baidu from '../../cloudbaidu/capabilities'
import guangya from '../../guangya/capabilities'
import pikpak from '../../pikpak/capabilities'
import quark from '../../quark/capabilities'
import dropbox from '../../dropbox/capabilities'
import onedrive from '../../onedrive/capabilities'
import box from '../../box/capabilities'
import google from '../../google/capabilities'
import { commonDriveCapabilities, defineProviderCapabilities, type ProviderCapabilityManifest } from './providerCapabilityTypes'

export type { DriveCapability, CapabilityVerification, ProviderCapabilityEvidence, ProviderCapabilityManifest } from './providerCapabilityTypes'

const webdav = defineProviderCapabilities({
  platform: 'webdav', name: 'WebDAV',
  capabilities: { ...commonDriveCapabilities, search: false, upload: false, createFolder: false, rename: false, move: false, copy: false, share: false },
  notes: ['WebDAV 与 AList 在 BoxPlayer 中仅用于浏览、下载、播放、扫描和刮削，不支持任何写操作。'],
  evidence: { list: { status: 'implemented', implementation: 'src/utils/webdavClient.ts' } }
})

// The registry imports declarations owned by each provider adapter. The Agent only
// queries this aggregate; provider implementation details remain local to adapters.
export const PROVIDER_CAPABILITIES: Record<string, ProviderCapabilityManifest> = {
  aliyun, cloud123, '115': cloud115, cloud139, cloud189, baidu, guangya, pikpak, quark, dropbox, onedrive, box, google, webdav
}

export function normalizeProviderPlatform(platform?: string): string {
  const value = String(platform || '').toLowerCase()
  if (value === 'alist') return 'webdav'
  if (value === '123') return 'cloud123'
  if (value === '139') return 'cloud139'
  if (value === '189') return 'cloud189'
  if (value === 'drive115') return '115'
  return value || 'aliyun'
}

export function getProviderCapabilities(platform?: string): ProviderCapabilityManifest {
  const normalized = normalizeProviderPlatform(platform)
  return PROVIDER_CAPABILITIES[normalized] || defineProviderCapabilities({
    platform: normalized, name: normalized,
    capabilities: { ...commonDriveCapabilities, search: false, upload: false, createFolder: false, rename: false, move: false, copy: false, share: false },
    notes: ['该网盘尚未注册能力清单，Agent 只会执行明确可用的只读操作。'],
    evidence: { list: { status: 'unknown', note: 'No provider manifest registered.' } }
  })
}

export function supportsProviderSearch(platform?: string): boolean {
  return getProviderCapabilities(platform).operations['files.search']
}

export function formatProviderCapabilities(manifests: ProviderCapabilityManifest[]): string {
  if (!manifests.length) return '当前没有已登录网盘。'
  return manifests.map(item => {
    const supported = Object.entries(item.capabilities).filter(([, enabled]) => enabled).map(([name]) => name).join('、')
    const verification = Object.entries(item.evidence).filter(([, evidence]) => evidence.status === 'tested').map(([name]) => name).join('、')
    const operations = Object.entries(item.operations).filter(([, enabled]) => enabled).map(([name]) => name).join('、')
    return `- ${item.name} (${item.platform})：汇总能力 ${supported}。操作能力 ${operations || '无'}${verification ? `。已测试：${verification}` : ''}${item.notes.length ? `。限制：${item.notes.join('；')}` : ''}`
  }).join('\n')
}
