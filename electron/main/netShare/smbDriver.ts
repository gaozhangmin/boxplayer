import type { Readable } from 'node:stream'
import { Client as SmbClient } from 'smb3-client'
import { Open } from 'smb3-client/dist/open/open'
import { createReadStream as createOpenReadStream } from 'smb3-client/dist/open/readStream'
import { readdirAll } from 'smb3-client/dist/open/readdir'
import { CreateDisposition, CreateOptions, FileAccess, FileAttribute, ShareAccess } from 'smb3-client/dist/wire/structs/create'
import { smbTimeToDate } from 'smb3-client/dist/paths'
import { joinSharePath, resolveSmbPath, sortShareEntries, type NetShareConfig, type NetShareEntry } from '../../../shared/netShare'
import type { NetShareDriver, NetShareStat } from './types'

export const toSmbInSharePath = (value: string) => value.replace(/^[\\/]+/, '').replace(/\//g, '\\')

const READ_ACCESS = FileAccess.FILE_READ_DATA | FileAccess.FILE_READ_ATTRIBUTES
const SHARE_ALL = ShareAccess.READ | ShareAccess.WRITE | ShareAccess.DELETE

export class SmbDriver implements NetShareDriver {
  private client?: Promise<SmbClient>
  constructor(private readonly config: NetShareConfig, private readonly password: string) {}

  private async newClient(): Promise<SmbClient> {
    const guest = this.config.anonymous || !this.config.username
    const base = { host: this.config.host, port: this.config.port || 445, domain: this.config.domain || '', connectTimeout: 10000, requestTimeout: 30000 }
    const attempts = guest ? [{ username: 'guest', password: '' }, { username: '', password: '' }] : [{ username: this.config.username || '', password: this.password }]
    let lastError: unknown
    for (const credentials of attempts) {
      const client = new SmbClient({ ...base, ...credentials })
      try {
        await client.connect()
        return client
      } catch (error) {
        lastError = error
        await client.close().catch(() => undefined)
      }
    }
    throw lastError
  }

  private session(): Promise<SmbClient> {
    if (!this.client) this.client = this.newClient().catch((error) => { this.client = undefined; throw error })
    return this.client
  }

  private async withReconnect<T>(task: (client: SmbClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const client = await this.session()
      try {
        return await task(client)
      } catch (error: any) {
        const transport = /closed|not connected|ECONNRESET|EPIPE|socket|NETWORK_NAME_DELETED|USER_SESSION_DELETED/i.test(String(error?.message || error?.code || ''))
        if (!transport || attempt > 0) throw error
        this.client = undefined
        void client.close().catch(() => undefined)
      }
    }
  }

  private tree(client: SmbClient, share: string) {
    return (client as any).treeFor(share) as Promise<any>
  }

  async listShares(): Promise<string[]> {
    return this.withReconnect(async (client) => (await client.listShares()).filter(share => share.type === 'disk' && !share.name.endsWith('$')).map(share => share.name))
  }

  async list(relativePath: string): Promise<NetShareEntry[]> {
    const { share, path } = resolveSmbPath(this.config, relativePath)
    if (!share) {
      const shares = await this.listShares()
      return sortShareEntries(shares.map(name => ({ name, path: joinSharePath('/', name), isDir: true, size: 0, mtime: 0 })))
    }
    return this.withReconnect(async (client) => {
      const tree = await this.tree(client, share)
      const entries = await Open.withOpen(tree, {
        filename: toSmbInSharePath(path),
        desiredAccess: FileAccess.FILE_READ_DATA | FileAccess.FILE_READ_ATTRIBUTES,
        shareAccess: SHARE_ALL,
        createDisposition: CreateDisposition.OPEN,
        createOptions: CreateOptions.DIRECTORY_FILE,
        fileAttributes: 0
      }, (open) => readdirAll(open))
      return sortShareEntries(entries
        .filter(entry => !(entry.fileAttributes & FileAttribute.HIDDEN) || !entry.fileName.startsWith('.'))
        .map((entry) => {
          const isDir = (entry.fileAttributes & FileAttribute.DIRECTORY) !== 0
          return { name: entry.fileName, path: joinSharePath(relativePath, entry.fileName), isDir, size: isDir ? 0 : Number(entry.endOfFile), mtime: smbTimeToDate(entry.lastWriteTime).getTime() }
        }))
    })
  }

  async stat(relativePath: string): Promise<NetShareStat> {
    const { share, path } = resolveSmbPath(this.config, relativePath)
    if (!share || path === '/') return { isDir: true, size: 0, mtime: 0 }
    return this.withReconnect(async (client) => {
      const stat = await client.stat(`${share}/${path.replace(/^\/+/, '')}`)
      return { isDir: stat.isDirectory, size: stat.size, mtime: stat.mtime.getTime() }
    })
  }

  async createReadStream(relativePath: string, start: number, end?: number): Promise<Readable> {
    const { share, path } = resolveSmbPath(this.config, relativePath)
    if (!share) throw Object.assign(new Error('SMB 路径缺少共享名'), { code: 'EISDIR' })
    return this.withReconnect(async (client) => {
      const tree = await this.tree(client, share)
      const open = await Open.create(tree, {
        filename: toSmbInSharePath(path),
        desiredAccess: READ_ACCESS,
        shareAccess: SHARE_ALL,
        createDisposition: CreateDisposition.OPEN,
        createOptions: CreateOptions.NON_DIRECTORY_FILE,
        fileAttributes: 0
      })
      const size = open.meta.endOfFile
      const last = end === undefined ? size - 1n : BigInt(end)
      const stream = createOpenReadStream(open, { start: BigInt(start), end: last < size ? last : size - 1n, concurrency: 8 })
      let closed = false
      const release = () => { if (closed) return; closed = true; void open.close().catch(() => undefined) }
      stream.once('end', release)
      stream.once('error', release)
      stream.once('close', release)
      return stream
    })
  }

  close() {
    void this.client?.then(client => client.close()).catch(() => undefined)
    this.client = undefined
  }
}
