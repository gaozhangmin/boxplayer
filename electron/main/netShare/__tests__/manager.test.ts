import { afterEach, describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NetShareManager } from '../manager'
import type { NetShareDriver } from '../types'
import type { NetShareConfig } from '../../../../shared/netShare'

const data = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz')
const files: Record<string, Buffer> = { '/v/a.mkv': data, '/v/sub/b.srt': Buffer.from('subtitle') }

const fakeDriver = (seen: string[] = []): NetShareDriver => ({
  async list(rel) {
    if (rel === '/v') return [{ name: 'a.mkv', path: '/v/a.mkv', isDir: false, size: data.length, mtime: 0 }, { name: 'sub', path: '/v/sub', isDir: true, size: 0, mtime: 0 }]
    if (rel === '/v/sub') return [{ name: 'b.srt', path: '/v/sub/b.srt', isDir: false, size: 8, mtime: 0 }]
    return []
  },
  async stat(rel) {
    if (files[rel]) return { isDir: false, size: files[rel].length, mtime: 1_700_000_000_000 }
    if (rel === '/v' || rel === '/v/sub') return { isDir: true, size: 0, mtime: 0 }
    throw Object.assign(new Error('missing'), { code: 'ENOENT' })
  },
  async createReadStream(rel, start, end) {
    seen.push(`${rel}:${start}-${end ?? ''}`)
    return Readable.from([files[rel].subarray(start, end === undefined ? undefined : end + 1)])
  },
  close() {}
})

const config: NetShareConfig = { id: 'c1', kind: 'smb', host: 'nas', share: 's', username: 'u', password: 'safe:xyz', rootPath: '/' }

describe('NetShareManager range proxy', () => {
  let manager: NetShareManager | undefined
  afterEach(() => manager?.close())

  const setup = (seen?: string[]) => {
    const passwords: string[] = []
    manager = new NetShareManager({ encrypt: v => v, decrypt: v => { passwords.push(v); return 'plain' } }, (_c, password) => { passwords.push(`factory:${password}`); return fakeDriver(seen) })
    return passwords
  }

  it('serves full, partial, suffix and unsatisfiable ranges', async () => {
    const seen: string[] = []
    const passwords = setup(seen)
    const url = await manager!.streamUrl(config, '/v/a.mkv')
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/netshare\/.+\/a\.mkv$/)
    expect(passwords).toEqual(['safe:xyz', 'factory:plain'])

    const full = await fetch(url)
    expect(full.status).toBe(200)
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(full.headers.get('content-type')).toBe('video/x-matroska')
    expect(Buffer.from(await full.arrayBuffer())).toEqual(data)

    const part = await fetch(url, { headers: { Range: 'bytes=10-19' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe(`bytes 10-19/${data.length}`)
    expect(part.headers.get('content-length')).toBe('10')
    expect(await part.text()).toBe('abcdefghij')

    const suffix = await fetch(url, { headers: { Range: 'bytes=-4' } })
    expect(await suffix.text()).toBe('wxyz')

    const bad = await fetch(url, { headers: { Range: 'bytes=999-' } })
    expect(bad.status).toBe(416)
    expect(bad.headers.get('content-range')).toBe(`bytes */${data.length}`)

    const head = await fetch(url, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe(String(data.length))
    expect(seen).toEqual([`/v/a.mkv:0-${data.length - 1}`, '/v/a.mkv:10-19', `/v/a.mkv:${data.length - 4}-${data.length - 1}`])
  })

  it('rejects wrong secrets, unknown files and directories', async () => {
    setup()
    const url = await manager!.streamUrl(config, '/v/a.mkv')
    expect((await fetch(url.replace(manager!.secret, 'nope'))).status).toBe(404)
    expect((await fetch(await manager!.streamUrl(config, '/v/zzz.mkv'))).status).toBe(404)
    expect((await fetch(await manager!.streamUrl(config, '/v'))).status).toBe(400)
    expect((await fetch(url, { method: 'POST' })).status).toBe(405)
  })

  it('reuses drivers until the config changes', () => {
    const passwords = setup()
    const a = manager!.driverFor(config)
    expect(manager!.driverFor({ ...config })).toBe(a)
    expect(manager!.driverFor({ ...config, rootPath: '/x' })).not.toBe(a)
    expect(passwords.filter(p => p.startsWith('factory')).length).toBe(2)
  })

  it('downloads folders recursively', async () => {
    setup()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxplayer-ns-'))
    try {
      const progress: number[] = []
      await manager!.download(config, '/v', path.join(dir, 'v'), done => progress.push(done))
      expect(fs.readFileSync(path.join(dir, 'v', 'a.mkv'))).toEqual(data)
      expect(fs.readFileSync(path.join(dir, 'v', 'sub', 'b.srt'), 'utf8')).toBe('subtitle')
      expect(fs.existsSync(path.join(dir, 'v', 'a.mkv.boxpart'))).toBe(false)
      expect(progress.length).toBeGreaterThan(0)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
