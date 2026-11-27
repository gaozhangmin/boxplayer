import { expect, it } from 'vitest'
import { electronProviderCapabilities, fileOperationAvailable } from '@/features/files/adapters/providerCapabilities'
import { providers, type ProviderId } from '@/features/sources/contracts'
import type { DriveOperation } from '@/features/files/electron/drive/services/agent/providerCapabilityTypes'
it('uses upstream declarations only for sources covered by the legacy registry', () => {
 const outsideLegacyRegistry = new Set<ProviderId>(['jellyfin', 'emby', 'plex', 'boxplayer', 'smb', 'nfs', 'ftp'])
 for (const [providerId] of providers) {
   expect(Boolean(electronProviderCapabilities({ providerId })), providerId).toBe(!outsideLegacyRegistry.has(providerId))
 }
 expect(electronProviderCapabilities({providerId:'115'})!.operations['share.create']).toBe(false)
 expect(electronProviderCapabilities({providerId:'google'})!.operations['files.rename']).toBe(true)
 expect(electronProviderCapabilities({providerId:'123'})!.platform).toBe('cloud123')
})
it('does not enable write menus just because Electron implements an operation',()=>{
 const implemented=new Set<DriveOperation>(['files.list','files.search'])
 expect(fileOperationAvailable({providerId:'google'},'files.rename',implemented)).toBe(false)
 expect(fileOperationAvailable({providerId:'google'},'files.list',implemented)).toBe(true)
 expect(fileOperationAvailable({providerId:'webdav'},'files.search',implemented)).toBe(false)
 expect(fileOperationAvailable({providerId:'plex'},'files.list',implemented)).toBe(false)
})
