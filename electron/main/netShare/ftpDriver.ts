import { PassThrough, Readable, Writable } from 'node:stream'
import { Client as FtpClient, FileType, type FileInfo } from 'basic-ftp'
import iconv from 'iconv-lite'
import { joinSharePath, normalizeSharePath, sortShareEntries, type NetShareConfig, type NetShareEntry } from '../../../shared/netShare'
import type { NetShareDriver, NetShareStat } from './types'

const NATIVE_ENCODINGS = new Set(['utf8', 'utf-8', ''])

export const normalizeFtpEncoding = (encoding?: string) => {
  const value = String(encoding || 'utf8').trim().toLowerCase()
  if (NATIVE_ENCODINGS.has(value)) return 'utf8'
  return iconv.encodingExists(value) ? value : 'utf8'
}

/**
 * basic-ftp only supports Node buffer encodings on the control socket. For legacy
 * servers (GBK, Big5, Shift_JIS…) the socket runs in latin1 (lossless byte mapping)
 * and names are transcoded here.
 */
export const createFtpNameCodec = (encoding?: string) => {
  const normalized = normalizeFtpEncoding(encoding)
  if (normalized === 'utf8') return { socketEncoding: 'utf8' as const, decode: (value: string) => value, encode: (value: string) => value }
  return {
    socketEncoding: 'latin1' as const,
    decode: (value: string) => iconv.decode(Buffer.from(value, 'latin1'), normalized),
    encode: (value: string) => iconv.encode(value, normalized).toString('latin1')
  }
}

export const ftpRemotePath = (config: Pick<NetShareConfig, 'rootPath'>, relativePath: string) => joinSharePath(config.rootPath, relativePath)

/** Maps basic-ftp listing entries (already parsed from LIST/MLSD) to share entries. */
export const mapFtpListing = (items: FileInfo[], parentRelativePath: string, decode: (value: string) => string = (v) => v): NetShareEntry[] => {
  const parent = normalizeSharePath(parentRelativePath)
  const entries: NetShareEntry[] = []
  for (const item of items) {
    const name = decode(item.name)
    if (!name || name === '.' || name === '..') continue
    const isDir = item.type === FileType.Directory || (item.type === FileType.SymbolicLink && !!item.link && !/\.[a-z0-9]{2,5}$/i.test(item.link) && item.size <= 4096)
    entries.push({ name, path: joinSharePath(parent, name), isDir, size: isDir ? 0 : Number(item.size || 0), mtime: item.modifiedAt?.getTime() || (item.rawModifiedAt ? Date.parse(item.rawModifiedAt) || 0 : 0) })
  }
  return sortShareEntries(entries)
}

const connect = async (config: NetShareConfig, password: string) => {
  const codec = createFtpNameCodec(config.encoding)
  const client = new FtpClient(30000)
  client.ftp.encoding = codec.socketEncoding
  const anonymous = config.anonymous || !config.username
  await client.access({
    host: config.host,
    port: config.port || 21,
    user: anonymous ? 'anonymous' : codec.encode(config.username || ''),
    password: anonymous ? (password || 'anonymous@') : codec.encode(password),
    secure: !!config.secure,
    secureOptions: config.secure ? { rejectUnauthorized: !config.allowUntrustedCert, servername: config.host } : undefined
  })
  // Re-apply after `useDefaultSettings`, which may toggle UTF-8 mode.
  client.ftp.encoding = codec.socketEncoding
  return { client, codec }
}

export class FtpDriver implements NetShareDriver {
  private control?: Promise<{ client: FtpClient; codec: ReturnType<typeof createFtpNameCodec> }>
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly config: NetShareConfig, private readonly password: string) {}

  private session() {
    if (!this.control) {
      this.control = connect(this.config, this.password).catch((error) => { this.control = undefined; throw error })
    }
    return this.control
  }

  /** basic-ftp allows one command at a time per connection: serialise control-channel work. */
  private exclusive<T>(task: (client: FtpClient, codec: ReturnType<typeof createFtpNameCodec>) => Promise<T>): Promise<T> {
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        const { client, codec } = await this.session()
        try {
          return await task(client, codec)
        } catch (error: any) {
          const closed = client.closed || /closed|ECONNRESET|EPIPE|timeout/i.test(String(error?.message || error?.code || ''))
          if (!closed || attempt > 0) throw error
          client.close()
          this.control = undefined
        }
      }
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  list(relativePath: string): Promise<NetShareEntry[]> {
    return this.exclusive(async (client, codec) => mapFtpListing(await client.list(codec.encode(ftpRemotePath(this.config, relativePath))), relativePath, codec.decode))
  }

  stat(relativePath: string): Promise<NetShareStat> {
    return this.exclusive(async (client, codec) => {
      const remote = codec.encode(ftpRemotePath(this.config, relativePath))
      // Some servers answer SIZE for directories too, so probe with CWD first (cheap, no data connection).
      const pwd = await client.pwd()
      let isDir = false
      try { await client.cd(remote); isDir = true } catch {} finally { await client.cd(pwd).catch(() => undefined) }
      if (isDir) return { isDir: true, size: 0, mtime: 0 }
      try {
        const size = await client.size(remote)
        let mtime = 0
        try { mtime = (await client.lastMod(remote)).getTime() } catch {}
        return { isDir: false, size, mtime }
      } catch (error) {
        throw Object.assign(new Error(`FTP 文件不存在: ${relativePath}`), { code: 'ENOENT', cause: error })
      }
    })
  }

  /** Each transfer uses its own connection so seeks / parallel range requests do not block browsing. */
  async createReadStream(relativePath: string, start: number, end?: number): Promise<Readable> {
    const { client, codec } = await connect(this.config, this.password)
    const output = new PassThrough({ highWaterMark: 1 << 20 })
    let remaining = end === undefined ? Infinity : end - start + 1
    let finished = false
    const finish = () => { if (finished) return; finished = true; client.close() }
    const sink = new Writable({
      highWaterMark: 1 << 20,
      write(chunk: Buffer, _encoding, callback) {
        if (remaining <= 0) { callback(); return }
        const piece = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk
        remaining -= piece.length
        const ok = output.write(piece)
        if (remaining <= 0) {
          output.end()
          finish() // Abort the transfer once the requested range has been delivered.
          callback()
        } else if (ok) callback()
        else output.once('drain', () => callback())
      }
    })
    output.on('close', finish)
    client.downloadTo(sink, codec.encode(ftpRemotePath(this.config, relativePath)), start)
      .then(() => { if (!output.writableEnded) output.end(); finish() })
      .catch((error) => { if (remaining > 0 && !output.destroyed) output.destroy(error); finish() })
    return output
  }

  close() {
    void this.control?.then(({ client }) => client.close()).catch(() => undefined)
    this.control = undefined
  }
}
