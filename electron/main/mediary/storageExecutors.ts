import { BrowserWindow } from 'electron'
import type { StorageExecutor } from '@mediary/ports'
import { createExecutorForBrand } from '@mediary/storage-executor-factory'
import type { MediaryDriveTarget } from '@shared/types/mediary'
import { BoxPlayerStorageExecutor } from './BoxPlayerStorageExecutor'
import { asDriveAuthError, resolveCliToken, saveCliToken } from './cliDrive'
import { BOXPLAYER_HOSTED_PLATFORMS, createBoxPlayerDriveClient, normalizeBoxPlayerPlatform, providerFolderId } from './driveClients'

/** The mediary storage brand for a BoxPlayer drive platform. */
export function storageBrandForPlatform(platform: string): string {
  const normalized = normalizeBoxPlayerPlatform(platform)
  if (normalized === '115') return 'pan115'
  if (['quark', 'guangya', 'cloud123', 'aliyun', 'pikpak'].includes(normalized)) return normalized
  throw new Error(`${platform} 暂不支持 AI 媒体获取`)
}

export function isMediaryPlatformSupported(platform: string): boolean {
  try {
    storageBrandForPlatform(platform)
    return true
  } catch {
    return false
  }
}

/**
 * Build the executor for one drive target. Quark and 光鸭 run the vendored mediary
 * executors on BoxPlayer's own login; the other drives run BoxPlayerStorageExecutor.
 * Creation is deferred to the first call so a missing login fails the run, not the claim.
 */
export function createStorageExecutor(target: MediaryDriveTarget): StorageExecutor {
  const platform = normalizeBoxPlayerPlatform(target.platform)
  const folderId = providerFolderId(platform, target.folderId)
  let executor: Promise<StorageExecutor> | undefined
  const load = () => executor ??= buildExecutor(target, platform, folderId).catch(error => {
    executor = undefined
    throw asDriveAuthError(error)
  })
  return new Proxy({} as StorageExecutor, {
    get(_target, property) {
      if (property === 'then') return undefined
      // Subtitle landing needs an assrt token BoxPlayer does not configure yet.
      if (property === 'transferSubtitleUrl' || property === 'apiCallCount' || property === 'apiCallBudget') return undefined
      return async (...args: unknown[]) => {
        const inner = await load() as unknown as Record<string, (...input: unknown[]) => unknown>
        return inner[property as string](...args)
      }
    }
  })
}

async function buildExecutor(target: MediaryDriveTarget, platform: string, folderId: string): Promise<StorageExecutor> {
  if ((BOXPLAYER_HOSTED_PLATFORMS as readonly string[]).includes(platform)) {
    return new BoxPlayerStorageExecutor({ client: await createBoxPlayerDriveClient(target), writeScopeDirectoryIds: [folderId] })
  }
  const token = await resolveCliToken(platform, target.userId)
  if (platform === 'quark') return createExecutorForBrand({ provider: 'quark', cookie: String(token.access_token || ''), scopeCids: [folderId] })
  return createExecutorForBrand({
    provider: 'guangya',
    credential: { accessToken: token.access_token, refreshToken: token.refresh_token, ...(token.device_id ? { deviceId: token.device_id } : {}) },
    scopeCids: [folderId],
    // 光鸭 rotates its refresh token; keep BoxPlayer's own login in step with the new pair.
    onCredentialRefresh: async refreshed => {
      const next = refreshed as { accessToken?: string; refreshToken?: string }
      const updated = { ...token, ...(next.accessToken ? { access_token: next.accessToken } : {}), ...(next.refreshToken ? { refresh_token: next.refreshToken } : {}) }
      await saveCliToken(platform, target.userId, updated)
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('mediary:driveTokenRefreshed', { platform, userId: target.userId, accessToken: updated.access_token, refreshToken: updated.refresh_token })
      }
    }
  })
}
