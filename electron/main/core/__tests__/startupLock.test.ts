import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mock = vi.hoisted(() => ({
  handle: vi.fn(),
  directory: '',
  canUse: vi.fn(() => false),
  authenticate: vi.fn(async () => false),
}))
vi.mock('electron', () => ({ ipcMain: { handle: mock.handle } }))
vi.mock('../../utils/mainfile', () => ({
  getUserDataPath: (name: string) => join(mock.directory, name),
}))

vi.mock('../systemUnlock', () => ({ canUseSystemUnlock: mock.canUse, authenticateSystemUnlock: mock.authenticate }))

import { registerStartupLock, startupLockNeedsFullScreen } from '../startupLock'

const frame = {}
const sender = { mainFrame: frame, isDestroyed: () => false }
const event = { sender, senderFrame: frame }

function start() {
  registerStartupLock(() => ({ webContents: sender }) as any)
  return mock.handle.mock.calls.at(-1)![1]
}

afterEach(() => {
  vi.restoreAllMocks()
  mock.canUse.mockReturnValue(false)
  mock.authenticate.mockClear()
  rmSync(mock.directory, { recursive: true, force: true })
})

it('persists a four-digit PIN with leading zeroes and requires it after restart and to disable the lock', async () => {
  mock.directory = mkdtempSync(join(tmpdir(), 'boxplayer-startup-lock-'))
  let time = 1000
  vi.spyOn(Date, 'now').mockImplementation(() => time)
  let request = start()
  expect(await request(event, 'status')).toMatchObject({ enabled: false, locked: false })
  for (const invalid of ['7', '12345', 'a123', '１２３４']) {
    expect(await request(event, 'save', '', invalid)).toEqual({ ok: false })
  }
  expect(await request(event, 'save', '', '0007')).toEqual({ ok: true })
  expect(JSON.parse(readFileSync(join(mock.directory, 'startup-lock.json'), 'utf8'))).toEqual({
    salt: expect.stringMatching(/^[0-9a-f]{32}$/),
    digest: expect.stringMatching(/^[0-9a-f]{64}$/),
  })

  request = start()
  expect(await request(event, 'status')).toMatchObject({ enabled: true, locked: true })
  expect(await request(event, 'disable', '0007')).toEqual({ ok: false })
  expect(await request({ ...event, senderFrame: {} }, 'unlock', '0007')).toEqual({ ok: false })
  expect(await request(event, 'unlock', '0008')).toEqual({ ok: false })
  expect(await request(event, 'unlock', '0007')).toEqual({ ok: false })
  time += 750
  expect(await request(event, 'unlock', '0007')).toEqual({ ok: true })
  expect(await request(event, 'save', '0007', '0009')).toEqual({ ok: true })
  expect(await request(event, 'disable', '0007')).toEqual({ ok: false })
  time += 750
  expect(await request(event, 'disable', '0009')).toEqual({ ok: true })
  expect(await start()(event, 'status')).toMatchObject({ enabled: false, locked: false })
})

it('only enables system unlock after PIN verification and authenticates in the main process', async () => {
 mock.directory = mkdtempSync(join(tmpdir(), 'boxplayer-startup-system-'))
 mock.canUse.mockReturnValue(true)
 mock.authenticate.mockResolvedValue(true)
 let request = start()
 expect(startupLockNeedsFullScreen()).toBe(false)
 expect(await request(event, 'save', '', '1234')).toEqual({ ok: true })
 expect(startupLockNeedsFullScreen()).toBe(true)
 expect(await request(event, 'system-setting', '1234', true)).toEqual({ ok: true })
 request = start()
 expect(await request(event, 'status')).toMatchObject({ locked: true, systemUnlockAvailable: true, systemUnlockEnabled: true })
 expect(await request({ ...event, senderFrame: {} }, 'system-unlock')).toEqual({ ok: false })
 expect(await request(event, 'system-unlock')).toEqual({ ok: true })
 expect(mock.authenticate).toHaveBeenCalledTimes(1)
 expect(await request(event, 'status')).toMatchObject({ locked: false })
 mock.canUse.mockReturnValue(false)
})

it('keeps the lock closed when system authentication is cancelled, unavailable or not enabled', async () => {
 mock.directory = mkdtempSync(join(tmpdir(), 'boxplayer-startup-cancel-'))
 mock.canUse.mockReturnValue(true)
 mock.authenticate.mockResolvedValue(false)
 let request = start()
 await request(event, 'save', '', '1234')
 request = start()
 expect(await request(event, 'system-unlock')).toEqual({ ok: false })
 await request(event, 'unlock', '1234')
 await request(event, 'system-setting', '1234', true)
 request = start()
 expect(await request(event, 'system-unlock')).toEqual({ ok: false })
 expect(await request(event, 'status')).toMatchObject({ locked: true })
 mock.canUse.mockReturnValue(false)
 expect(await request(event, 'system-unlock')).toEqual({ ok: false })
 expect(await request(event, 'unlock', '1234')).toEqual({ ok: true })
})

it('does not accept an in-flight biometric result after the credential changes', async () => {
 mock.directory = mkdtempSync(join(tmpdir(), 'boxplayer-startup-race-'))
 mock.canUse.mockReturnValue(true)
 let finish!: (value: boolean) => void
 mock.authenticate.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve }))
 let request = start()
 await request(event, 'save', '', '1234')
 await request(event, 'system-setting', '1234', true)
 request = start()
 const pending = request(event, 'system-unlock')
 expect(await request(event, 'system-unlock')).toEqual({ ok: false })
 await request(event, 'unlock', '1234')
 await request(event, 'save', '1234', '5678')
 finish(true)
 expect(await pending).toEqual({ ok: false })
 expect(await start()(event, 'status')).toMatchObject({ locked: true })
})
