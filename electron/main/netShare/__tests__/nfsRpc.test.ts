import { describe, expect, it } from 'vitest'
import { NF3DIR, NfsError, PROG_NFS, RecordDecoder, XdrReader, XdrWriter, decodeReaddirplusResult, decodeRpcReply, encodeReaddirplusArgs, encodeRpcCall, frameRecord } from '../nfsRpc'

const fattr = (w: XdrWriter, type: number, size: number, mtimeSec: number) => {
  w.u32(type).u32(0o755).u32(1).u32(0).u32(0).u64(size).u64(size).u32(0).u32(0).u64(1).u64(42).u32(0).u32(0).u32(mtimeSec).u32(500_000_000).u32(0).u32(0)
}

describe('XDR', () => {
  it('pads opaque data to 4 bytes and reads it back', () => {
    const buf = new XdrWriter().u32(7).string('abcde').u64(2n ** 40n).bool(true).toBuffer()
    expect(buf.length).toBe(4 + 4 + 8 + 8 + 4)
    const r = new XdrReader(buf)
    expect(r.u32()).toBe(7)
    expect(r.string()).toBe('abcde')
    expect(r.u64()).toBe(2n ** 40n)
    expect(r.bool()).toBe(true)
    expect(() => r.u32()).toThrow(/unexpected end/)
  })
})

describe('ONC RPC framing', () => {
  it('encodes a CALL header with AUTH_SYS credentials', () => {
    const call = encodeRpcCall(0x1234, PROG_NFS, 3, 1, Buffer.from([1, 2, 3, 4]), { uid: 0, gid: 0, machine: 'm' })
    const r = new XdrReader(call)
    expect([r.u32(), r.u32(), r.u32(), r.u32(), r.u32(), r.u32()]).toEqual([0x1234, 0, 2, PROG_NFS, 3, 1])
    expect(r.u32()).toBe(1) // AUTH_SYS
    const cred = new XdrReader(r.opaque())
    cred.u32() // stamp
    expect(cred.string()).toBe('m')
    expect([cred.u32(), cred.u32(), cred.u32()]).toEqual([0, 0, 0])
    expect([r.u32(), r.opaque().length]).toEqual([0, 0]) // verifier AUTH_NONE
    expect([...call.subarray(r.offset)]).toEqual([1, 2, 3, 4])
  })

  it('encodes AUTH_NONE when no credentials are given', () => {
    const r = new XdrReader(encodeRpcCall(1, 100000, 2, 3, Buffer.alloc(0)))
    for (let i = 0; i < 6; i++) r.u32()
    expect(r.u32()).toBe(0)
  })

  it('reassembles split and multi-fragment records', () => {
    const payload = Buffer.from('hello world, rpc')
    const framed = frameRecord(payload)
    expect(framed.readUInt32BE(0)).toBe((0x80000000 | payload.length) >>> 0)
    const decoder = new RecordDecoder()
    expect(decoder.push(framed.subarray(0, 6))).toEqual([])
    expect(decoder.push(framed.subarray(6))).toEqual([payload])
    // two fragments, first not last
    const a = Buffer.from('abc'); const b = Buffer.from('defg')
    const h1 = Buffer.alloc(4); h1.writeUInt32BE(a.length)
    const both = Buffer.concat([h1, a, frameRecord(b), frameRecord(Buffer.from('x'))])
    expect(decoder.push(both).map(String)).toEqual(['abcdefg', 'x'])
  })

  it('decodes accepted, rejected and error replies', () => {
    const ok = new XdrWriter().u32(9).u32(1).u32(0).u32(0).opaque(Buffer.alloc(0)).u32(0).u32(77).toBuffer()
    const { xid, reader } = decodeRpcReply(ok)
    expect(xid).toBe(9)
    expect(reader.u32()).toBe(77)
    const denied = new XdrWriter().u32(9).u32(1).u32(1).u32(1).u32(2).toBuffer()
    expect(() => decodeRpcReply(denied)).toThrow(/AUTH_REJECTEDCRED/)
    const unavailable = new XdrWriter().u32(9).u32(1).u32(0).u32(0).opaque(Buffer.alloc(0)).u32(1).toBuffer()
    expect(() => decodeRpcReply(unavailable)).toThrow(/PROG_UNAVAIL/)
  })
})

describe('NFSv3 READDIRPLUS', () => {
  it('encodes arguments', () => {
    const args = encodeReaddirplusArgs(Buffer.from([1, 2, 3, 4, 5]), 3n, Buffer.alloc(8, 9), 100, 200)
    const r = new XdrReader(args)
    expect([...r.opaque()]).toEqual([1, 2, 3, 4, 5])
    expect(r.u64()).toBe(3n)
    expect([...r.fixed(8)]).toEqual(Array(8).fill(9))
    expect([r.u32(), r.u32()]).toEqual([100, 200])
  })

  it('decodes entries with attributes and handles', () => {
    const w = new XdrWriter().u32(0).bool(false).fixed(Buffer.alloc(8, 1))
    w.bool(true).u64(1).string('Movies').u64(10n).bool(true); fattr(w, NF3DIR, 4096, 1_700_000_000); w.bool(true).opaque(Buffer.from([0xaa]))
    w.bool(true).u64(2).string('电影.mkv').u64(20n).bool(true); fattr(w, 1, 123456789, 1_700_000_001); w.bool(false)
    w.bool(false).bool(true)
    const result = decodeReaddirplusResult(new XdrReader(w.toBuffer()))
    expect(result.eof).toBe(true)
    expect(result.entries.map(e => [e.name, e.cookie, e.attr?.type, e.attr?.size, e.handle?.length])).toEqual([
      ['Movies', 10n, NF3DIR, 4096n, 1],
      ['电影.mkv', 20n, 1, 123456789n, undefined]
    ])
    expect(result.entries[1].attr?.mtime).toBe(1_700_000_001_500)
  })

  it('maps status codes to errors', () => {
    const w = new XdrWriter().u32(13).bool(false)
    expect(() => decodeReaddirplusResult(new XdrReader(w.toBuffer()))).toThrow(NfsError)
    try { decodeReaddirplusResult(new XdrReader(new XdrWriter().u32(2).bool(false).toBuffer())) } catch (e: any) { expect(e.code).toBe('ENOENT') }
  })
})
