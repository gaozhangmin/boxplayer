import { app } from 'electron'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { BOXPLAYER_DRIVE_AUTH_ERROR } from '@mediary/storage-brands'
import { resolveCloudDriveCliConfigDir } from '../core/cliConfigPath'

/** A file or folder as the bundled clouddrive-cli providers return it. */
export interface CliDriveItem {
  fileId: string
  parentFileId?: string
  name: string
  type: 'file' | 'folder'
  size?: number
}

export type CliToken = Record<string, unknown> & { access_token?: string; refresh_token?: string; device_id?: string; expire_time?: string }

export interface CliDriveProvider {
  auth?: { refresh?: (token: CliToken) => Promise<Partial<CliToken>> }
  files: {
    list(input: { token: CliToken; driveId?: string; parentFileId: string }): Promise<CliDriveItem[]>
    mkdir(input: { token: CliToken; driveId?: string; parentId: string; name: string }): Promise<CliDriveItem>
    moveBatch(input: { token: CliToken; driveId?: string; moves: Array<{ fileId: string; toParentId: string }> }): Promise<Array<{ fileId: string; status: string; message?: string }>>
    trash(input: { token: CliToken; driveId?: string; items: Array<{ fileId: string }> }): Promise<unknown>
    renameBatch(input: { token: CliToken; driveId?: string; renames: Array<{ fileId: string; newName: string }> }): Promise<Array<{ fileId: string; status: string; message?: string }>>
  }
}

interface CliAccount { provider: string; accountId: string; token?: CliToken }

const PROVIDER_MODULES: Record<string, [file: string, factory: string]> = {
  '115': ['drive115Provider.mjs', 'createDrive115Provider'],
  cloud123: ['cloud123Provider.mjs', 'createCloud123Provider'],
  aliyun: ['aliyun.mjs', 'createAliyunProvider'],
  pikpak: ['pikpakProvider.mjs', 'createPikpakProvider']
}
const REFRESH_BUFFER_MS = 5 * 60 * 1000

function cliModuleUrl(...segments: string[]): string {
  return pathToFileURL(path.join(app.getAppPath(), 'clouddrive-cli', ...segments)).href
}

export async function loadCliDriveProvider(platform: string): Promise<CliDriveProvider> {
  const entry = PROVIDER_MODULES[platform]
  if (!entry) throw new Error(`${platform} 没有可用的网盘命令行实现`)
  const mod = await import(/* @vite-ignore */ cliModuleUrl('providers', entry[0])) as Record<string, () => CliDriveProvider>
  return mod[entry[1]]()
}

/** The CLI account id BoxPlayer exports for a drive login (see UserDAL.toCliAccount). */
export function cliAccountId(platform: string, userId: string): string {
  return platform === 'aliyun' && !userId.startsWith('aliyun_') ? `aliyun_${userId}` : userId
}

/**
 * Read a drive login from the CLI token file that BoxPlayer keeps in sync with its own
 * accounts, refreshing it the way `clouddrive-cli` does when it is about to expire.
 */
interface CliAuthStore {
  getAccount(provider: string, accountId: string): Promise<CliAccount | null>
  saveAccount(account: CliAccount): Promise<unknown>
}

async function openAuthStore(): Promise<CliAuthStore> {
  const { createAuthStore } = await import(/* @vite-ignore */ cliModuleUrl('core', 'authStore.mjs')) as { createAuthStore: (options: { configDir: string }) => CliAuthStore }
  return createAuthStore({ configDir: resolveCloudDriveCliConfigDir(process.env.CLOUDDRIVE_CLI_CONFIG_DIR, os.homedir()) })
}

export async function resolveCliToken(platform: string, userId: string, provider?: CliDriveProvider): Promise<CliToken> {
  const store = await openAuthStore()
  const account = await store.getAccount(platform, cliAccountId(platform, userId))
  const token = account?.token
  if (!account || !token?.access_token) throw new Error(`${BOXPLAYER_DRIVE_AUTH_ERROR}: 未找到该网盘的登录信息，请在 BoxPlayer 中重新登录这个网盘`)
  const expireTime = token.expire_time ? new Date(token.expire_time).getTime() : 0
  if (provider?.auth?.refresh && token.refresh_token && expireTime && expireTime - Date.now() < REFRESH_BUFFER_MS) {
    const refreshed = { ...token, ...(await provider.auth.refresh(token)) }
    await store.saveAccount({ ...account, token: refreshed })
    return refreshed
  }
  return token
}

export async function saveCliToken(platform: string, userId: string, token: CliToken): Promise<void> {
  const store = await openAuthStore()
  const account = await store.getAccount(platform, cliAccountId(platform, userId))
  if (account) await store.saveAccount({ ...account, token })
}

/** Turn a provider login failure into the marker the mediary worker treats as a drive problem. */
export function asDriveAuthError(error: unknown): unknown {
  const code = String((error as { code?: unknown })?.code || '')
  const status = Number((error as { status?: unknown; statusCode?: unknown })?.status ?? (error as { statusCode?: unknown })?.statusCode)
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes(BOXPLAYER_DRIVE_AUTH_ERROR)) return error
  if (code.includes('AUTH') || status === 401) return new Error(`${BOXPLAYER_DRIVE_AUTH_ERROR}: ${message}`, { cause: error })
  return error
}
