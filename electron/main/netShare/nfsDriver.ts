import { Readable } from 'node:stream'
import { joinSharePath, normalizeSharePath, sortShareEntries, type NetShareConfig, type NetShareEntry } from '../../../shared/netShare'
import { NF3DIR, NfsClient } from './nfsRpc'
import type { NetShareDriver, NetShareStat } from './types'

const READ_CHUNK = 128 * 1024
const READ_AHEAD = 4

export class NfsDriver implements NetShareDriver {
  private readonly client: NfsClient
  constructor(private readonly config: NetShareConfig) {
    this.client = new NfsClient(config.host, normalizeSharePath(config.exportPath), { port: config.port && config.port !== 2049 ? config.port : undefined })
  }

  private full(relativePath: string) {
    return joinSharePath(this.config.rootPath, relativePath)
  }

  async list(relativePath: string): Promise<NetShareEntry[]> {
    const entries = await this.client.readdir(this.full(relativePath))
    return sortShareEntries(entries.map((entry) => {
      const isDir = entry.attr?.type === NF3DIR
      return { name: entry.name, path: joinSharePath(relativePath, entry.name), isDir, size: isDir ? 0 : Number(entry.attr?.size || 0), mtime: entry.attr?.mtime || 0 }
    }))
  }

  async stat(relativePath: string): Promise<NetShareStat> {
    const attr = await this.client.stat(this.full(relativePath))
    return { isDir: attr.type === NF3DIR, size: Number(attr.size), mtime: attr.mtime }
  }

  async createReadStream(relativePath: string, start: number, end?: number): Promise<Readable> {
    const { handle } = await this.client.resolve(this.full(relativePath))
    const size = end === undefined ? Number((await this.client.getattr(handle)).size) : undefined
    const last = end ?? (size! - 1)
    const client = this.client
    let next = start
    const pending: Array<Promise<Buffer>> = []
    const schedule = () => {
      while (pending.length < READ_AHEAD && next <= last) {
        const offset = next
        const count = Math.min(READ_CHUNK, last - offset + 1)
        next += count
        pending.push(client.read(handle, BigInt(offset), count).then(result => result.data))
      }
    }
    return new Readable({
      highWaterMark: READ_CHUNK * 2,
      async read() {
        schedule()
        const head = pending.shift()
        if (!head) { this.push(null); return }
        try {
          const data = await head
          if (!data.length) { pending.length = 0; this.push(null); return }
          this.push(data)
        } catch (error) {
          this.destroy(error as Error)
        }
      }
    })
  }

  close() {
    this.client.close()
  }
}
