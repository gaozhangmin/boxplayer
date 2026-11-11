import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomBytes, createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import fs from 'node:fs'
import path from 'node:path'
import mime from 'mime-types'
import { buildNetShareStreamPath, parseByteRange, parseNetShareStreamPath, type NetShareConfig } from '../../../shared/netShare'
import { FtpDriver } from './ftpDriver'
import { NfsDriver } from './nfsDriver'
import { SmbDriver } from './smbDriver'
import type { NetShareDriver, NetShareStat } from './types'

export type SecretCodec = { encrypt(plain: string): string; decrypt(stored: string): string }

/** `safe:` values are encrypted with the OS keychain (Electron safeStorage); anything else is legacy plaintext. */
export const plainSecretCodec: SecretCodec = { encrypt: value => value, decrypt: value => value }

const configKey = (config: NetShareConfig) => createHash('sha1').update(JSON.stringify([config.kind, config.host, config.port, config.share, config.domain, config.username, config.password, config.anonymous, config.exportPath, config.rootPath, config.secure, config.allowUntrustedCert, config.encoding])).digest('hex')

export const createDriver = (config: NetShareConfig, password: string): NetShareDriver & { listShares?: () => Promise<string[]> } => {
  if (config.kind === 'smb') return new SmbDriver(config, password)
  if (config.kind === 'nfs') return new NfsDriver(config)
  if (config.kind === 'ftp') return new FtpDriver(config, password)
  throw new Error(`不支持的网络共享类型: ${(config as any).kind}`)
}

export class NetShareManager {
  private drivers = new Map<string, { key: string; config: NetShareConfig; driver: NetShareDriver & { listShares?: () => Promise<string[]> } }>()
  private stats = new Map<string, { at: number; stat: NetShareStat }>()
  private server?: http.Server
  private listening?: Promise<number>
  readonly secret = randomBytes(18).toString('base64url')

  constructor(private readonly secrets: SecretCodec = plainSecretCodec, private readonly driverFactory = createDriver) {}

  /** Registers (or refreshes) a connection and returns its driver. */
  driverFor(config: NetShareConfig) {
    if (!config?.id || !config.kind || !config.host) throw new Error('网络共享配置不完整')
    const key = configKey(config)
    const existing = this.drivers.get(config.id)
    if (existing && existing.key === key) return existing.driver
    existing?.driver.close()
    const driver = this.driverFactory(config, this.secrets.decrypt(config.password || ''))
    this.drivers.set(config.id, { key, config, driver })
    for (const statKey of this.stats.keys()) if (statKey.startsWith(`${config.id}\n`)) this.stats.delete(statKey)
    return driver
  }

  forget(id: string) {
    this.drivers.get(id)?.driver.close()
    this.drivers.delete(id)
  }

  /** Builds a throwaway driver for "test connection" without touching cached sessions. */
  async test(config: NetShareConfig) {
    const driver = this.driverFactory(config, this.secrets.decrypt(config.password || ''))
    try {
      const entries = await driver.list('/')
      return { ok: true, count: entries.length }
    } finally {
      driver.close()
    }
  }

  async listShares(config: NetShareConfig) {
    if (config.kind !== 'smb') return []
    const driver = this.driverFactory({ ...config, share: '' }, this.secrets.decrypt(config.password || ''))
    try { return await driver.listShares!() } finally { driver.close() }
  }

  async stat(config: NetShareConfig, relativePath: string, maxAgeMs = 60000): Promise<NetShareStat> {
    const cacheKey = `${config.id}\n${relativePath}`
    const cached = this.stats.get(cacheKey)
    if (cached && Date.now() - cached.at < maxAgeMs) return cached.stat
    const stat = await this.driverFor(config).stat(relativePath)
    this.stats.set(cacheKey, { at: Date.now(), stat })
    return stat
  }

  async ensureServer(): Promise<number> {
    if (!this.listening) {
      this.server = http.createServer((req, res) => { void this.handle(req, res) })
      this.server.keepAliveTimeout = 30000
      this.listening = new Promise<number>((resolve, reject) => {
        this.server!.once('error', reject)
        this.server!.listen(0, '127.0.0.1', () => resolve((this.server!.address() as AddressInfo).port))
      }).catch((error) => { this.listening = undefined; throw error })
    }
    return this.listening
  }

  async streamUrl(config: NetShareConfig, relativePath: string): Promise<string> {
    this.driverFor(config)
    const port = await this.ensureServer()
    return `http://127.0.0.1:${port}${buildNetShareStreamPath(this.secret, config.id, relativePath)}`
  }

  async handle(req: IncomingMessage, res: ServerResponse) {
    const parsed = parseNetShareStreamPath(new URL(req.url || '/', 'http://127.0.0.1').pathname)
    if (!parsed || parsed.secret !== this.secret) { res.writeHead(404).end(); return }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return }
    const entry = this.drivers.get(parsed.connectionId)
    if (!entry) { res.writeHead(404).end('connection not registered'); return }
    try {
      const stat = await this.stat(entry.config, parsed.path)
      if (stat.isDir) { res.writeHead(400).end('is a directory'); return }
      const range = parseByteRange(req.headers.range, stat.size)
      const headers: Record<string, string | number> = {
        'Accept-Ranges': 'bytes',
        'Content-Type': mime.lookup(parsed.path) || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      }
      if (stat.mtime) headers['Last-Modified'] = new Date(stat.mtime).toUTCString()
      if (range === 'unsatisfiable') { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }).end(); return }
      const start = range ? range.start : 0
      const end = range ? range.end : stat.size - 1
      headers['Content-Length'] = Math.max(0, end - start + 1)
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`
      res.writeHead(range ? 206 : 200, headers)
      if (req.method === 'HEAD' || stat.size === 0) { res.end(); return }
      const stream = await entry.driver.createReadStream(parsed.path, start, end)
      req.on('close', () => stream.destroy())
      await pipeline(stream, res).catch(() => undefined)
    } catch (error: any) {
      if (!res.headersSent) res.writeHead(error?.code === 'ENOENT' ? 404 : error?.code === 'EACCES' ? 403 : 502, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(error?.message || error))
      else res.destroy(error)
    }
  }

  async download(config: NetShareConfig, relativePath: string, localFile: string, onProgress?: (done: number, total: number) => void) {
    const driver = this.driverFor(config)
    const stat = await driver.stat(relativePath)
    if (stat.isDir) {
      await fs.promises.mkdir(localFile, { recursive: true })
      for (const child of await driver.list(relativePath)) await this.download(config, child.path, path.join(localFile, child.name.replace(/[\\/:*?"<>|]/g, '_')), onProgress)
      return
    }
    await fs.promises.mkdir(path.dirname(localFile), { recursive: true })
    const partial = `${localFile}.boxpart`
    let offset = 0
    try { offset = (await fs.promises.stat(partial)).size } catch {}
    if (offset > stat.size) offset = 0
    let done = offset
    const source = await driver.createReadStream(relativePath, offset)
    source.on('data', (chunk: Buffer) => { done += chunk.length; onProgress?.(done, stat.size) })
    await pipeline(source, fs.createWriteStream(partial, { flags: offset ? 'a' : 'w' }))
    await fs.promises.rename(partial, localFile)
  }

  close() {
    for (const { driver } of this.drivers.values()) driver.close()
    this.drivers.clear()
    this.server?.close()
    this.server = undefined
    this.listening = undefined
  }
}
