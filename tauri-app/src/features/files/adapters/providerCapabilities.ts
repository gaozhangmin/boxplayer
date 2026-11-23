import type { Account } from '@/features/sources/contracts'
import { getProviderCapabilities } from '../electron/drive/services/agent/providerCapabilities'
import { defineProviderCapabilities, operationKeys, type DriveOperation, type ProviderCapabilityManifest } from '../electron/drive/services/agent/providerCapabilityTypes'

const platforms: Partial<Record<Account['providerId'],string>> = {
 aliyun:'aliyun','alipan-open':'aliyun','123':'cloud123','115':'115','139':'cloud139','189':'cloud189',
 baidu:'baidu',guangya:'guangya',pikpak:'pikpak',quark:'quark',dropbox:'dropbox',onedrive:'onedrive',box:'box',google:'google',webdav:'webdav',alist:'webdav'
}
const googleDriveReadOperations = new Set<DriveOperation>(['files.list','files.search','files.download','files.downloadZip','trash.list','links.direct'])
const googleDriveRestrictedCapabilities = ['upload','createFolder','rename','move','copy','share'] as const

/** Native Google Drive no longer exposes the Electron write capabilities. */
export function electronProviderCapabilities(account: Pick<Account,'providerId'>): ProviderCapabilityManifest | undefined {
 const platform=platforms[account.providerId]
 // Do not call the legacy registry without an explicit platform: it defaults to Aliyun.
 const manifest=platform ? getProviderCapabilities(platform) : undefined
 if (!manifest || account.providerId !== 'google') return manifest
 const capabilities = { ...manifest.capabilities }
 const evidence = { ...manifest.evidence }
 for (const key of googleDriveRestrictedCapabilities) {
   capabilities[key] = false
   evidence[key] = { status: 'unsupported', note: 'Tauri Google Drive is read-only' }
 }
 return defineProviderCapabilities({
   ...manifest,
   capabilities,
   evidence,
   operations: Object.fromEntries(operationKeys.map(key => [key, googleDriveReadOperations.has(key) && manifest.operations[key]]))
 })
}
/** A menu may enable an operation only when both upstream and the native port implement it. */
export function fileOperationAvailable(account: Pick<Account,'providerId'>, operation: DriveOperation, implemented: ReadonlySet<DriveOperation>): boolean {
 return implemented.has(operation) && electronProviderCapabilities(account)?.operations[operation] === true
}
