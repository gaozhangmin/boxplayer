export const shouldRetryInitialRootLoad = (provider: string) => String(provider || '').toLowerCase() !== 'aliyun'

export const selectInitialAliyunRoot = (preference: string, backupDriveId: string, resourceDriveId: string) => {
  if (preference === 'resource' && resourceDriveId) return { driveId: resourceDriveId, rootId: 'resource_root' }
  if (backupDriveId) return { driveId: backupDriveId, rootId: 'backup_root' }
  if (resourceDriveId) return { driveId: resourceDriveId, rootId: 'resource_root' }
  return { driveId: '', rootId: '' }
}

const waitForRootRetry = () => new Promise<void>(resolve => setTimeout(resolve, 600))

export async function loadInitialProviderRoot(shouldRetry: boolean, load: () => Promise<void>, wait: () => Promise<void> = waitForRootRetry): Promise<void> {
  try {
    await load()
  } catch (error) {
    if (!shouldRetry) throw error
    await wait()
    await load()
  }
}
