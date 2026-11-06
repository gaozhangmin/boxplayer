import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mock = vi.hoisted(() => ({
  handle: vi.fn(),
  directory: '',
}))
vi.mock('electron', () => ({ ipcMain: { handle: mock.handle } }))
vi.mock('../../utils/mainfile', () => ({
  getUserDataPath: (name: string) => join(mock.directory, name),
}))

import { registerStartupLock } from '../startupLock'

const frame = {}
const sender = { mainFrame: frame }
const event = { sender, senderFrame: frame }

function start() {
  registerStartupLock(() => ({ webContents: sender }) as any)
  return mock.handle.mock.calls.at(-1)![1]
}

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(mock.directory, { recursive: true, force: true })
})

it('persists a four-digit PIN with leading zeroes and requires it after restart and to disable the lock', () => {
  mock.directory = mkdtempSync(join(tmpdir(), 'boxplayer-startup-lock-'))
  let time = 1000
  vi.spyOn(Date, 'now').mockImplementation(() => time)
  let request = start()
  expect(request(event, 'status')).toEqual({ enabled: false, locked: false })
  for (const invalid of ['7', '12345', 'a123', '１２３４']) {
    expect(request(event, 'save', '', invalid)).toEqual({ ok: false })
  }
  expect(request(event, 'save', '', '0007')).toEqual({ ok: true })
  expect(JSON.parse(readFileSync(join(mock.directory, 'startup-lock.json'), 'utf8'))).toEqual({
    salt: expect.stringMatching(/^[0-9a-f]{32}$/),
    digest: expect.stringMatching(/^[0-9a-f]{64}$/),
  })

  request = start()
  expect(request(event, 'status')).toEqual({ enabled: true, locked: true })
  expect(request(event, 'disable', '0007')).toEqual({ ok: false })
  expect(request({ ...event, senderFrame: {} }, 'unlock', '0007')).toEqual({ ok: false })
  expect(request(event, 'unlock', '0008')).toEqual({ ok: false })
  expect(request(event, 'unlock', '0007')).toEqual({ ok: false })
  time += 750
  expect(request(event, 'unlock', '0007')).toEqual({ ok: true })
  expect(request(event, 'save', '0007', '0009')).toEqual({ ok: true })
  expect(request(event, 'disable', '0007')).toEqual({ ok: false })
  time += 750
  expect(request(event, 'disable', '0009')).toEqual({ ok: true })
  expect(start()(event, 'status')).toEqual({ enabled: false, locked: false })
})
