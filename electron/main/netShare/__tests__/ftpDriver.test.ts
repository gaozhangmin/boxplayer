import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import iconv from 'iconv-lite'
import { parseList } from 'basic-ftp'
import { FtpDriver, createFtpNameCodec, ftpRemotePath, mapFtpListing, normalizeFtpEncoding } from '../ftpDriver'
import type { NetShareConfig } from '../../../../shared/netShare'

const readAll = async (stream: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks)
}

describe('FTP listing parse', () => {
  it('maps unix LIST output, skips dot entries and sorts folders first', () => {
    const raw = [
      'drwxr-xr-x    2 ftp      ftp          4096 Jan 01  2024 .',
      'drwxr-xr-x    2 ftp      ftp          4096 Jan 01  2024 ..',
      '-rw-r--r--    1 ftp      ftp     734003200 Mar 15  2024 Movie 2.mkv',
      'drwxr-xr-x    2 ftp      ftp          4096 Feb 02  2024 Season 1',
      '-rw-r--r--    1 ftp      ftp          2048 Mar 15  2024 Movie 2.zh.srt',
      'lrwxrwxrwx    1 ftp      ftp            10 Mar 15  2024 latest -> Season 1'
    ].join('\r\n')
    const entries = mapFtpListing(parseList(raw), '/tv')
    expect(entries.map(e => [e.name, e.path, e.isDir])).toEqual([
      ['latest', '/tv/latest', true],
      ['Season 1', '/tv/Season 1', true],
      ['Movie 2.mkv', '/tv/Movie 2.mkv', false],
      ['Movie 2.zh.srt', '/tv/Movie 2.zh.srt', false]
    ])
    expect(entries.find(e => e.name === 'Movie 2.mkv')?.size).toBe(734003200)
  })

  it('maps MS-DOS LIST output', () => {
    const raw = '03-15-24  10:30PM       <DIR>          Anime\r\n03-15-24  10:31PM            123456 clip.mp4'
    expect(mapFtpListing(parseList(raw), '/').map(e => [e.name, e.isDir, e.size])).toEqual([['Anime', true, 0], ['clip.mp4', false, 123456]])
  })

  it('transcodes legacy encodings through latin1', () => {
    expect(normalizeFtpEncoding('UTF-8')).toBe('utf8')
    expect(normalizeFtpEncoding('nope')).toBe('utf8')
    expect(normalizeFtpEncoding('GBK')).toBe('gbk')
    const codec = createFtpNameCodec('gbk')
    expect(codec.socketEncoding).toBe('latin1')
    const wire = iconv.encode('电影', 'gbk').toString('latin1')
    expect(codec.decode(wire)).toBe('电影')
    expect(codec.encode('电影')).toBe(wire)
    expect(ftpRemotePath({ rootPath: '/pub/' }, 'a/b')).toBe('/pub/a/b')
  })
})

// In-process ftp-srv integration: browse + ranged reads.
const freePort = () => new Promise<number>((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)) }) })

describe('FtpDriver against ftp-srv', () => {
  let root = ''
  let server: any
  let port = 0
  const content = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 251))

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'boxplayer-ftp-'))
    fs.mkdirSync(path.join(root, 'media', '剧集'), { recursive: true })
    fs.writeFileSync(path.join(root, 'media', 'movie.mkv'), content)
    fs.writeFileSync(path.join(root, 'media', 'movie.srt'), '1\n00:00:01,000 --> 00:00:02,000\nhi\n')
    port = await freePort()
    const { FtpSrv } = await import('ftp-srv')
    const silent: any = { child: () => silent, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} }
    server = new FtpSrv({ url: `ftp://127.0.0.1:${port}`, pasv_url: '127.0.0.1', pasv_min: 40000, pasv_max: 40100, anonymous: false, log: silent })
    server.on('login', ({ username, password }: any, resolve: any, reject: any) => username === 'u' && password === 'p' ? resolve({ root }) : reject(new Error('bad login')))
    await server.listen()
  })

  afterAll(async () => {
    await server?.close().catch(() => undefined)
    fs.rmSync(root, { recursive: true, force: true })
  })

  const config = (): NetShareConfig => ({ id: 't', kind: 'ftp', host: '127.0.0.1', port, username: 'u', password: 'p', rootPath: '/media', encoding: 'utf8', passive: true })

  it('lists, stats and streams byte ranges', async () => {
    const driver = new FtpDriver(config(), 'p')
    try {
      const entries = await driver.list('/')
      expect(entries.map(e => [e.name, e.isDir])).toEqual([['剧集', true], ['movie.mkv', false], ['movie.srt', false]])
      expect(await driver.stat('/movie.mkv')).toMatchObject({ isDir: false, size: content.length })
      expect((await driver.stat('/剧集')).isDir).toBe(true)
      await expect(driver.stat('/missing.mkv')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readAll(await driver.createReadStream('/movie.mkv', 0))).toEqual(content)
      expect(await readAll(await driver.createReadStream('/movie.mkv', 1000, 1999))).toEqual(content.subarray(1000, 2000))
      expect(await readAll(await driver.createReadStream('/movie.mkv', 299_990))).toEqual(content.subarray(299_990))
    } finally { driver.close() }
  }, 30000)

  it('rejects bad credentials', async () => {
    const driver = new FtpDriver({ ...config(), id: 'bad' }, 'wrong')
    await expect(driver.list('/')).rejects.toThrow()
    driver.close()
  }, 30000)
})
