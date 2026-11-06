import { ipcMain, type BrowserWindow } from 'electron'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { getUserDataPath } from '../utils/mainfile'

type Credential = { salt: string; digest: string }

function readCredential(): Credential | undefined {
  try {
    const data = JSON.parse(readFileSync(getUserDataPath('startup-lock.json'), 'utf8'))
    if (!/^[0-9a-f]{32}$/.test(data?.salt) || !/^[0-9a-f]{64}$/.test(data?.digest)) {
      throw new Error('Invalid startup lock credential')
    }
    return data
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{4}$/.test(value)
}

export function registerStartupLock(mainWindow: () => BrowserWindow | undefined) {
  let unlocked = false
  let retryAt = 0
  ipcMain.handle('StartupLock:request', (event, action: unknown, current?: unknown, next?: unknown) => {
    if (event.sender !== mainWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) {
      return action === 'status' ? { enabled: false, locked: false } : { ok: false }
    }

    const credential = readCredential()
    if (action === 'status') return { enabled: !!credential, locked: !!credential && !unlocked }
    if (action !== 'unlock' && action !== 'save' && action !== 'disable') return { ok: false }
    if (action !== 'unlock' && credential && !unlocked) return { ok: false }
    if (action === 'save' && !validPassword(next)) return { ok: false }
    if (credential) {
      if (!validPassword(current) || Date.now() < retryAt) return { ok: false }
      retryAt = Date.now() + 750
      const candidate = scryptSync(current, credential.salt, 32)
      if (!timingSafeEqual(candidate, Buffer.from(credential.digest, 'hex'))) return { ok: false }
      retryAt = 0
    }
    if (action === 'save' && validPassword(next)) {
      const salt = randomBytes(16).toString('hex')
      const digest = scryptSync(next, salt, 32).toString('hex')
      const path = getUserDataPath('startup-lock.json')
      const temporary = path + '.tmp'
      try {
        writeFileSync(temporary, JSON.stringify({ salt, digest }), { mode: 0o600 })
        renameSync(temporary, path)
      } finally {
        rmSync(temporary, { force: true })
      }
    } else if (action === 'disable') {
      rmSync(getUserDataPath('startup-lock.json'), { force: true })
    }
    unlocked = true
    return { ok: true }
  })
}
