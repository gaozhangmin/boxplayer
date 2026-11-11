import { ipcMain, safeStorage, app } from 'electron'
import { NetShareManager, type SecretCodec } from './manager'
import type { NetShareConfig } from '../../../shared/netShare'

const SAFE_PREFIX = 'safe:'

const secureStorageAvailable = () => {
  try {
    return safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  } catch {
    return false
  }
}

export const electronSecretCodec: SecretCodec = {
  encrypt(plain) {
    if (!plain || plain.startsWith(SAFE_PREFIX) || !secureStorageAvailable()) return plain
    return SAFE_PREFIX + safeStorage.encryptString(plain).toString('base64')
  },
  decrypt(stored) {
    if (!stored?.startsWith(SAFE_PREFIX)) return stored || ''
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(SAFE_PREFIX.length), 'base64'))
    } catch {
      throw Object.assign(new Error('无法解密已保存的网络共享密码，请重新编辑该来源并输入密码'), { code: 'NETSHARE_SECRET' })
    }
  }
}

let manager: NetShareManager | undefined
export const getNetShareManager = () => (manager ??= new NetShareManager(electronSecretCodec))

const serializeError = (error: any) => {
  const err = new Error(String(error?.message || error || 'unknown error'))
  ;(err as any).code = error?.code
  return err
}

const wrap = <A extends unknown[], R>(fn: (...args: A) => Promise<R> | R) => async (_event: unknown, ...args: A) => {
  try { return await fn(...args) } catch (error) { throw serializeError(error) }
}

export function registerNetShareIpc() {
  const shares = getNetShareManager()
  ipcMain.handle('NetShare:protectSecret', wrap((plain: string) => electronSecretCodec.encrypt(String(plain || ''))))
  ipcMain.handle('NetShare:test', wrap((config: NetShareConfig) => shares.test(config)))
  ipcMain.handle('NetShare:listShares', wrap((config: NetShareConfig) => shares.listShares(config)))
  ipcMain.handle('NetShare:list', wrap((config: NetShareConfig, relativePath: string) => shares.driverFor(config).list(relativePath || '/')))
  ipcMain.handle('NetShare:stat', wrap((config: NetShareConfig, relativePath: string) => shares.stat(config, relativePath || '/', 0)))
  ipcMain.handle('NetShare:streamUrl', wrap((config: NetShareConfig, relativePath: string) => shares.streamUrl(config, relativePath)))
  ipcMain.handle('NetShare:forget', wrap((id: string) => shares.forget(id)))
  ipcMain.handle('NetShare:download', async (event, config: NetShareConfig, relativePath: string, localFile: string, requestId?: string) => {
    try {
      let last = 0
      await shares.download(config, relativePath, localFile, (done, total) => {
        const now = Date.now()
        if (requestId && (now - last > 500 || done >= total)) { last = now; if (!event.sender.isDestroyed()) event.sender.send('NetShare:downloadProgress', { requestId, done, total }) }
      })
      return true
    } catch (error) {
      throw serializeError(error)
    }
  })
  app.on('will-quit', () => shares.close())
}
