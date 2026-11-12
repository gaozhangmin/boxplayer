import type { Account } from '@/features/sources/contracts'
import { getProviderCapabilities } from '../electron/drive/services/agent/providerCapabilities'
import type { DriveOperation, ProviderCapabilityManifest } from '../electron/drive/services/agent/providerCapabilityTypes'

const platforms: Partial<Record<Account['providerId'],string>> = {
 aliyun:'aliyun','alipan-open':'aliyun','123':'cloud123','115':'115','139':'cloud139','189':'cloud189',
 baidu:'baidu',guangya:'guangya',pikpak:'pikpak',quark:'quark',dropbox:'dropbox',onedrive:'onedrive',box:'box',google:'google',webdav:'webdav',alist:'webdav'
}
/** Electron's declaration describes upstream support, never Tauri acceptance evidence. */
export function electronProviderCapabilities(account: Pick<Account,'providerId'>): ProviderCapabilityManifest | undefined {
 const platform=platforms[account.providerId]
 // Do not call the legacy registry without an explicit platform: it defaults to Aliyun.
 return platform ? getProviderCapabilities(platform) : undefined
}
/** A menu may enable an operation only when both upstream and the native port implement it. */
export function fileOperationAvailable(account: Pick<Account,'providerId'>, operation: DriveOperation, implemented: ReadonlySet<DriveOperation>): boolean {
 return implemented.has(operation) && electronProviderCapabilities(account)?.operations[operation] === true
}
