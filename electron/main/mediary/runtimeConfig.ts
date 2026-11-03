import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import type { MediaryRuntimeConfig } from '@shared/types/mediary'
import { AppWindow } from '../core/window'

const REQUEST_TIMEOUT_MS = 10_000
const pending = new Map<string, (config: MediaryRuntimeConfig | null) => void>()
let registered = false

/**
 * The AI model and BoxPlayer service endpoints live in the renderer (settings store and
 * BoxPlayer login). Ask the window for them right before a run; nothing is cached on disk.
 */
export function requestMediaryRuntimeConfig(): Promise<MediaryRuntimeConfig | null> {
  registerReplyHandler()
  const window = AppWindow.mainWindow
  if (!window || window.isDestroyed()) return Promise.resolve(null)
  const requestId = randomUUID()
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      resolve(null)
    }, REQUEST_TIMEOUT_MS)
    pending.set(requestId, config => {
      clearTimeout(timer)
      resolve(config)
    })
    window.webContents.send('mediary:runtimeConfigRequest', requestId)
  })
}

function registerReplyHandler(): void {
  if (registered) return
  registered = true
  ipcMain.on('mediary:runtimeConfigReply', (_event, requestId: string, config: MediaryRuntimeConfig | null) => {
    const resolve = pending.get(requestId)
    if (!resolve) return
    pending.delete(requestId)
    resolve(config && typeof config === 'object' ? config : null)
  })
}
