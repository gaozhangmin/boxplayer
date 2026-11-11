// Minimal read-only NFSv3 client over ONC RPC / TCP (RFC 5531, RFC 1813, RFC 1833).
// Implements PORTMAP GETPORT, MOUNT3 MNT, NFS3 GETATTR / LOOKUP / READ / READDIRPLUS (+ READDIR fallback).
import net from 'node:net'
import os from 'node:os'

// ---------------- XDR ----------------

export class XdrWriter {
  private chunks: Buffer[] = []
  u32(value: number) { const b = Buffer.alloc(4); b.writeUInt32BE(value >>> 0); this.chunks.push(b); return this }
  u64(value: bigint | number) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(value)); this.chunks.push(b); return this }
  bool(value: boolean) { return this.u32(value ? 1 : 0) }
  fixed(data: Buffer) { this.chunks.push(data); const pad = (4 - (data.length % 4)) % 4; if (pad) this.chunks.push(Buffer.alloc(pad)); return this }
  opaque(data: Buffer) { this.u32(data.length); return this.fixed(data) }
  string(value: string) { return this.opaque(Buffer.from(value, 'utf8')) }
  toBuffer() { return Buffer.concat(this.chunks) }
}

export class XdrReader {
  offset = 0
  constructor(readonly buf: Buffer) {}
  private need(n: number) { if (this.offset + n > this.buf.length) throw new Error('XDR: unexpected end of data') }
  u32() { this.need(4); const v = this.buf.readUInt32BE(this.offset); this.offset += 4; return v }
  u64() { this.need(8); const v = this.buf.readBigUInt64BE(this.offset); this.offset += 8; return v }
  bool() { return this.u32() !== 0 }
  fixed(len: number) { this.need(len); const v = this.buf.subarray(this.offset, this.offset + len); this.offset += len + ((4 - (len % 4)) % 4); return Buffer.from(v) }
  opaque() { return this.fixed(this.u32()) }
  string() { return this.opaque().toString('utf8') }
}

// ---------------- RPC ----------------

export const PROG_PORTMAP = 100000
export const PROG_NFS = 100003
export const PROG_MOUNT = 100005
const AUTH_NONE = 0
const AUTH_SYS = 1

export interface RpcAuth { uid: number; gid: number; machine?: string }

export const encodeAuthSys = (auth: RpcAuth, stamp = Math.floor(Date.now() / 1000)) =>
  new XdrWriter().u32(stamp).string((auth.machine || 'boxplayer').slice(0, 255)).u32(auth.uid).u32(auth.gid).u32(0).toBuffer()

export const encodeRpcCall = (xid: number, prog: number, vers: number, proc: number, args: Buffer, auth?: RpcAuth): Buffer => {
  const w = new XdrWriter().u32(xid).u32(0).u32(2).u32(prog).u32(vers).u32(proc)
  if (auth) w.u32(AUTH_SYS).opaque(encodeAuthSys(auth))
  else w.u32(AUTH_NONE).opaque(Buffer.alloc(0))
  w.u32(AUTH_NONE).opaque(Buffer.alloc(0))
  return Buffer.concat([w.toBuffer(), args])
}

/** Adds the TCP record-marking header (single last fragment). */
export const frameRecord = (payload: Buffer): Buffer => {
  const header = Buffer.alloc(4)
  header.writeUInt32BE((0x80000000 | payload.length) >>> 0)
  return Buffer.concat([header, payload])
}

const ACCEPT_ERRORS = ['SUCCESS', 'PROG_UNAVAIL', 'PROG_MISMATCH', 'PROC_UNAVAIL', 'GARBAGE_ARGS', 'SYSTEM_ERR']
const AUTH_ERRORS = ['AUTH_OK', 'AUTH_BADCRED', 'AUTH_REJECTEDCRED', 'AUTH_BADVERF', 'AUTH_REJECTEDVERF', 'AUTH_TOOWEAK']

/** Decodes an RPC reply; returns xid and a reader positioned at the procedure results. */
export const decodeRpcReply = (message: Buffer): { xid: number; reader: XdrReader } => {
  const r = new XdrReader(message)
  const xid = r.u32()
  if (r.u32() !== 1) throw new Error('RPC: not a reply')
  const replyStat = r.u32()
  if (replyStat === 1) {
    const rejectStat = r.u32()
    if (rejectStat === 0) throw new Error(`RPC: version mismatch (${r.u32()}-${r.u32()})`)
    const authStat = r.u32()
    throw Object.assign(new Error(`RPC: authentication rejected (${AUTH_ERRORS[authStat] || authStat})`), { code: 'NFS_AUTH' })
  }
  r.u32() // verifier flavor
  r.opaque()
  const acceptStat = r.u32()
  if (acceptStat !== 0) throw new Error(`RPC: ${ACCEPT_ERRORS[acceptStat] || acceptStat}`)
  return { xid, reader: r }
}

/** Accumulates TCP stream data and yields complete RPC records (handles multi-fragment records). */
export class RecordDecoder {
  private pending: Buffer = Buffer.alloc(0)
  private fragments: Buffer[] = []
  push(data: Buffer): Buffer[] {
    this.pending = this.pending.length ? Buffer.concat([this.pending, data]) : data
    const records: Buffer[] = []
    while (this.pending.length >= 4) {
      const header = this.pending.readUInt32BE(0)
      const length = header & 0x7fffffff
      if (this.pending.length < 4 + length) break
      this.fragments.push(this.pending.subarray(4, 4 + length))
      this.pending = this.pending.subarray(4 + length)
      if (header & 0x80000000) {
        records.push(Buffer.concat(this.fragments))
        this.fragments = []
      }
    }
    return records
  }
}

const connectSocket = (host: string, port: number, localPort: number | undefined, timeoutMs: number) => new Promise<net.Socket>((resolve, reject) => {
  const socket = net.connect({ host, port, ...(localPort ? { localPort } : {}) })
  const timer = setTimeout(() => { socket.destroy(); reject(Object.assign(new Error(`连接 ${host}:${port} 超时`), { code: 'ETIMEDOUT' })) }, timeoutMs)
  socket.once('connect', () => { clearTimeout(timer); resolve(socket) })
  socket.once('error', (error) => { clearTimeout(timer); socket.destroy(); reject(error) })
})

/**
 * Many NFS servers (Linux default `secure` export option) only accept requests from a
 * privileged source port (< 1024). That works as root, on Windows and on macOS ≥ 10.14;
 * elsewhere we fall back to an ephemeral port (server needs the `insecure` option).
 */
const connectPreferPrivileged = async (host: string, port: number, timeoutMs: number) => {
  const start = 600 + Math.floor(Math.random() * 400)
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await connectSocket(host, port, start + attempt, timeoutMs)
    } catch (error: any) {
      if (!['EACCES', 'EADDRINUSE', 'EPERM', 'EADDRNOTAVAIL'].includes(error?.code)) throw error
      if (error?.code === 'EACCES' || error?.code === 'EPERM') break
    }
  }
  return connectSocket(host, port, undefined, timeoutMs)
}

export class RpcClient {
  private socket?: net.Socket
  private connecting?: Promise<net.Socket>
  private nextXid = Math.floor(Math.random() * 0x7fffffff)
  private waiters = new Map<number, { resolve: (r: XdrReader) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  constructor(readonly host: string, readonly port: number, readonly options: { privileged?: boolean; timeoutMs?: number; auth?: RpcAuth } = {}) {}

  private async ensure(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) return this.socket
    if (!this.connecting) {
      const timeout = this.options.timeoutMs ?? 15000
      this.connecting = (this.options.privileged ? connectPreferPrivileged(this.host, this.port, timeout) : connectSocket(this.host, this.port, undefined, timeout)).then((socket) => {
        const decoder = new RecordDecoder()
        socket.setNoDelay(true)
        socket.on('data', (data) => {
          let records: Buffer[]
          try { records = decoder.push(data) } catch (error) { this.fail(error as Error); return }
          for (const record of records) {
            const xid = record.readUInt32BE(0)
            const waiter = this.waiters.get(xid)
            if (!waiter) continue
            this.waiters.delete(xid)
            clearTimeout(waiter.timer)
            try { waiter.resolve(decodeRpcReply(record).reader) } catch (error) { waiter.reject(error as Error) }
          }
        })
        socket.on('error', (error) => this.fail(error))
        socket.on('close', () => this.fail(new Error('NFS 连接已关闭')))
        this.socket = socket
        return socket
      }).finally(() => { this.connecting = undefined })
    }
    return this.connecting
  }

  private fail(error: Error) {
    for (const [, waiter] of this.waiters) { clearTimeout(waiter.timer); waiter.reject(error) }
    this.waiters.clear()
    this.socket?.destroy()
    this.socket = undefined
  }

  async call(prog: number, vers: number, proc: number, args: Buffer, useAuth = true): Promise<XdrReader> {
    const socket = await this.ensure()
    const xid = (this.nextXid = (this.nextXid + 1) >>> 0)
    const payload = frameRecord(encodeRpcCall(xid, prog, vers, proc, args, useAuth ? (this.options.auth || { uid: 0, gid: 0 }) : undefined))
    return new Promise<XdrReader>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(xid); reject(Object.assign(new Error('NFS 请求超时'), { code: 'ETIMEDOUT' })) }, this.options.timeoutMs ?? 30000)
      this.waiters.set(xid, { resolve, reject, timer })
      socket.write(payload)
    })
  }

  close() { this.fail(new Error('NFS 连接已关闭')); }
}

export const portmapGetPort = async (host: string, prog: number, vers: number, timeoutMs = 10000): Promise<number> => {
  const client = new RpcClient(host, 111, { timeoutMs })
  try {
    const args = new XdrWriter().u32(prog).u32(vers).u32(6).u32(0).toBuffer()
    const port = (await client.call(PROG_PORTMAP, 2, 3, args, false)).u32()
    if (!port) throw new Error(`RPC 程序 ${prog} v${vers} 未在 ${host} 注册`)
    return port
  } finally {
    client.close()
  }
}

// ---------------- NFSv3 ----------------

export const NFS3_OK = 0
const NFS3_ERRORS: Record<number, string> = {
  1: 'NFS3ERR_PERM', 2: 'NFS3ERR_NOENT', 5: 'NFS3ERR_IO', 6: 'NFS3ERR_NXIO', 13: 'NFS3ERR_ACCES', 17: 'NFS3ERR_EXIST', 20: 'NFS3ERR_NOTDIR', 21: 'NFS3ERR_ISDIR',
  22: 'NFS3ERR_INVAL', 63: 'NFS3ERR_NAMETOOLONG', 70: 'NFS3ERR_STALE', 10001: 'NFS3ERR_BADHANDLE', 10004: 'NFS3ERR_NOTSUPP', 10006: 'NFS3ERR_SERVERFAULT'
}
const MOUNT_ERRORS: Record<number, string> = { 1: 'MNT3ERR_PERM', 2: 'MNT3ERR_NOENT', 5: 'MNT3ERR_IO', 13: 'MNT3ERR_ACCES', 20: 'MNT3ERR_NOTDIR', 22: 'MNT3ERR_INVAL', 63: 'MNT3ERR_NAMETOOLONG', 10004: 'MNT3ERR_NOTSUPP', 10006: 'MNT3ERR_SERVERFAULT' }

export class NfsError extends Error {
  constructor(readonly status: number, operation: string) {
    super(`NFS ${operation} 失败: ${NFS3_ERRORS[status] || status}`)
    this.code = status === 2 ? 'ENOENT' : status === 13 || status === 1 ? 'EACCES' : 'EIO'
  }
  code: string
}

export interface Fattr3 { type: number; mode: number; size: bigint; mtime: number; fileid: bigint }
export const NF3DIR = 2
export const NF3LNK = 5

export const decodeFattr3 = (r: XdrReader): Fattr3 => {
  const type = r.u32(); const mode = r.u32()
  r.u32(); r.u32(); r.u32() // nlink, uid, gid
  const size = r.u64(); r.u64() // used
  r.u32(); r.u32() // rdev
  r.u64() // fsid
  const fileid = r.u64()
  r.u32(); r.u32() // atime
  const mtimeSec = r.u32(); const mtimeNsec = r.u32()
  r.u32(); r.u32() // ctime
  return { type, mode, size, fileid, mtime: mtimeSec * 1000 + Math.floor(mtimeNsec / 1e6) }
}

const decodePostOpAttr = (r: XdrReader) => (r.bool() ? decodeFattr3(r) : undefined)
const decodePostOpFh = (r: XdrReader) => (r.bool() ? r.opaque() : undefined)

export interface NfsDirEntry { name: string; attr?: Fattr3; handle?: Buffer }

export const encodeReaddirplusArgs = (dir: Buffer, cookie: bigint, verifier: Buffer, dircount = 8192, maxcount = 65536) =>
  new XdrWriter().opaque(dir).u64(cookie).fixed(verifier).u32(dircount).u32(maxcount).toBuffer()

export const decodeReaddirplusResult = (r: XdrReader) => {
  const status = r.u32()
  if (status !== NFS3_OK) { decodePostOpAttr(r); throw new NfsError(status, 'READDIRPLUS') }
  decodePostOpAttr(r)
  const verifier = r.fixed(8)
  const entries: Array<NfsDirEntry & { cookie: bigint }> = []
  while (r.bool()) {
    r.u64() // fileid
    const name = r.string()
    const cookie = r.u64()
    const attr = decodePostOpAttr(r)
    const handle = decodePostOpFh(r)
    entries.push({ name, cookie, attr, handle })
  }
  return { verifier, entries, eof: r.bool() }
}

export class NfsClient {
  private nfs?: RpcClient
  private rootHandle?: Buffer
  private handles = new Map<string, { handle: Buffer; attr?: Fattr3 }>()
  private readonly auth: RpcAuth
  constructor(readonly host: string, readonly exportPath: string, readonly options: { port?: number; mountPort?: number; uid?: number; gid?: number; timeoutMs?: number } = {}) {
    this.auth = { uid: options.uid ?? 0, gid: options.gid ?? 0, machine: os.hostname() }
  }

  async connect() {
    if (this.rootHandle && this.nfs) return
    const timeoutMs = this.options.timeoutMs ?? 15000
    const mountPort = this.options.mountPort || await portmapGetPort(this.host, PROG_MOUNT, 3, timeoutMs)
    const mount = new RpcClient(this.host, mountPort, { privileged: true, timeoutMs, auth: this.auth })
    try {
      const r = await mount.call(PROG_MOUNT, 3, 1, new XdrWriter().string(this.exportPath || '/').toBuffer())
      const status = r.u32()
      if (status !== 0) throw Object.assign(new Error(`NFS 挂载 ${this.exportPath} 失败: ${MOUNT_ERRORS[status] || status}`), { code: status === 13 || status === 1 ? 'EACCES' : 'ENOENT' })
      this.rootHandle = r.opaque()
    } finally {
      mount.close()
    }
    const nfsPort = this.options.port || await portmapGetPort(this.host, PROG_NFS, 3, timeoutMs).catch(() => 2049)
    this.nfs = new RpcClient(this.host, nfsPort, { privileged: true, timeoutMs: Math.max(timeoutMs, 30000), auth: this.auth })
    this.handles.set('/', { handle: this.rootHandle })
  }

  private async rpc(proc: number, args: Buffer) {
    await this.connect()
    return this.nfs!.call(PROG_NFS, 3, proc, args)
  }

  async getattr(handle: Buffer): Promise<Fattr3> {
    const r = await this.rpc(1, new XdrWriter().opaque(handle).toBuffer())
    const status = r.u32()
    if (status !== NFS3_OK) throw new NfsError(status, 'GETATTR')
    return decodeFattr3(r)
  }

  async lookup(dir: Buffer, name: string): Promise<{ handle: Buffer; attr?: Fattr3 }> {
    const r = await this.rpc(3, new XdrWriter().opaque(dir).string(name).toBuffer())
    const status = r.u32()
    if (status !== NFS3_OK) throw new NfsError(status, 'LOOKUP')
    const handle = r.opaque()
    return { handle, attr: decodePostOpAttr(r) }
  }

  /** Resolves a path (relative to the export root) to a file handle, caching every component. */
  async resolve(path: string): Promise<{ handle: Buffer; attr?: Fattr3 }> {
    await this.connect()
    const parts = path.split('/').filter(Boolean)
    let current = '/'
    let entry = this.handles.get('/')!
    for (const part of parts) {
      const next = current === '/' ? `/${part}` : `${current}/${part}`
      let cached = this.handles.get(next)
      if (!cached) {
        cached = await this.lookup(entry.handle, part)
        this.handles.set(next, cached)
      }
      entry = cached
      current = next
    }
    return entry
  }

  async stat(path: string): Promise<Fattr3> {
    const entry = await this.resolve(path)
    const attr = await this.getattr(entry.handle)
    entry.attr = attr
    return attr
  }

  async readdir(path: string): Promise<NfsDirEntry[]> {
    const dir = (await this.resolve(path)).handle
    try {
      return await this.readdirPlus(dir)
    } catch (error) {
      if (!(error instanceof NfsError) || error.status !== 10004) throw error
      return this.readdirBasic(dir)
    }
  }

  private async readdirPlus(dir: Buffer): Promise<NfsDirEntry[]> {
    const out: NfsDirEntry[] = []
    let cookie = 0n
    let verifier = Buffer.alloc(8)
    for (let page = 0; page < 10000; page++) {
      const result = decodeReaddirplusResult(await this.rpc(17, encodeReaddirplusArgs(dir, cookie, verifier)))
      verifier = result.verifier
      for (const entry of result.entries) {
        cookie = entry.cookie
        if (entry.name !== '.' && entry.name !== '..') out.push(entry)
      }
      if (result.eof || !result.entries.length) break
    }
    return out
  }

  private async readdirBasic(dir: Buffer): Promise<NfsDirEntry[]> {
    const names: string[] = []
    let cookie = 0n
    let verifier = Buffer.alloc(8)
    for (let page = 0; page < 10000; page++) {
      const r = await this.rpc(16, new XdrWriter().opaque(dir).u64(cookie).fixed(verifier).u32(65536).toBuffer())
      const status = r.u32()
      if (status !== NFS3_OK) throw new NfsError(status, 'READDIR')
      decodePostOpAttr(r)
      verifier = r.fixed(8)
      let count = 0
      while (r.bool()) {
        r.u64(); const name = r.string(); cookie = r.u64(); count++
        if (name !== '.' && name !== '..') names.push(name)
      }
      if (r.bool() || !count) break
    }
    const entries: NfsDirEntry[] = []
    for (const name of names) {
      try { entries.push({ name, ...(await this.lookup(dir, name)) }) } catch { entries.push({ name }) }
    }
    return entries
  }

  async read(handle: Buffer, offset: bigint, count: number): Promise<{ data: Buffer; eof: boolean }> {
    const r = await this.rpc(6, new XdrWriter().opaque(handle).u64(offset).u32(count).toBuffer())
    const status = r.u32()
    if (status !== NFS3_OK) throw new NfsError(status, 'READ')
    decodePostOpAttr(r)
    r.u32() // count
    const eof = r.bool()
    return { data: r.opaque(), eof }
  }

  close() {
    this.nfs?.close()
    this.nfs = undefined
    this.rootHandle = undefined
    this.handles.clear()
  }
}
