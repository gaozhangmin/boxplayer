import { getProviderCapabilities } from '../services/agent/providerCapabilities'
import type { DriveOperation } from '../services/agent/providerCapabilityTypes'
import UserDAL from '../user/userdal'
import { isRemoteSourceProvider, resolveDriveProvider } from '../utils/driveProvider'

function providerPlatform(userId: string, driveId: string): string {
  const route = resolveDriveProvider(userId, driveId, UserDAL.GetUserToken(userId)?.tokenfrom)
  if (!route.isValid) return 'unknown'
  return route.provider === 'webdav' || isRemoteSourceProvider(route.provider) ? 'webdav' : route.provider
}

export function supportsProviderOperation(userId: string, driveId: string, operation: DriveOperation): boolean {
  return Boolean(getProviderCapabilities(providerPlatform(userId, driveId)).operations[operation])
}

export const supportsCreateTextFile = (userId: string, driveId: string) => supportsProviderOperation(userId, driveId, 'upload.memory')
export const supportsSearch = (userId: string, driveId: string) => supportsProviderOperation(userId, driveId, 'files.search')
export const supportsCreateFolder = (userId: string, driveId: string) => supportsProviderOperation(userId, driveId, 'files.createFolder')
export const supportsLocalUpload = (userId: string, driveId: string) => supportsProviderOperation(userId, driveId, 'upload.local')
export const supportsZipDownload = (userId: string, driveId: string) => supportsProviderOperation(userId, driveId, 'files.downloadZip')
export const supportsEncryptedFileOperations = (userId: string) => supportsProviderOperation(userId, '', 'upload.encrypted')
export const supportsCreateShare = (userId: string, driveId: string) => supportsProviderOperation(userId, driveId, 'share.create')
export const supportsShareImport = (userId: string, driveId: string) => supportsProviderOperation(userId, driveId, 'share.import')
export const supportsRename = (userId: string, driveId: string) => supportsProviderOperation(userId, driveId, 'files.rename')
export const supportsMove = (userId: string, driveId: string) => supportsProviderOperation(userId, driveId, 'files.move')
export const supportsCopy = (userId: string, driveId: string) => supportsProviderOperation(userId, driveId, 'files.copy')
export const supportsTrashMove = (userId: string, driveId: string) => supportsProviderOperation(userId, driveId, 'trash.move')
export const supportsTrashRestore = (userId: string, driveId: string) => supportsProviderOperation(userId, driveId, 'trash.restore')
export const supportsTrashPermanentDelete = (userId: string, driveId: string) => supportsProviderOperation(userId, driveId, 'trash.delete')
export const supportsDirectPermanentDelete = (userId: string, driveId: string) => {
  const provider = providerPlatform(userId, driveId)
  return provider !== '115' && provider !== 'box' && supportsProviderOperation(userId, driveId, 'trash.delete')
}

export const isWritableProviderDirectory = (fileId: string) => {
  const id = String(fileId || '')
  // The toolbar can render before the root directory has been hydrated into
  // selectDir. Treat that transient empty value as writable; individual file
  // operations still validate the destination before sending a request.
  return !id.startsWith('search') && !['recent', 'favorite', 'trash', 'google_shared', 'google_shared_drives'].includes(id)
}

export function isProviderReadOnly(userId: string, driveId: string): boolean {
  return !(['files.createFolder', 'files.rename', 'files.move', 'files.copy', 'upload.local', 'upload.memory', 'upload.encrypted', 'share.create', 'share.import', 'trash.move', 'trash.delete'] as DriveOperation[])
    .some(operation => supportsProviderOperation(userId, driveId, operation))
}
