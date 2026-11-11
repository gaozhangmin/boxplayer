import { describe, expect, it } from 'vitest'
import { probeVideoContainer, videoResolutionLabel } from '../videoContainerProbe'

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u16 = (n: number) => [(n >>> 8) & 255, n & 255]
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0))
const box = (type: string, ...body: number[][]) => { const flat = body.flat(); return [...u32(flat.length + 8), ...ascii(type), ...flat] }
const reader = (bytes: number[]) => { const data = Uint8Array.from(bytes); return { size: data.length, read: async (offset: number, length: number) => data.slice(offset, offset + length) } }

function mp4({ height, transfer, entry = 'hvc1', dolby = false }: { height: number; transfer?: number; entry?: string; dolby?: boolean }) {
  const mvhd = box('mvhd', [0, 0, 0, 0], u32(0), u32(0), u32(1000), u32(95_000), new Array(80).fill(0))
  const children = [box('hvcC', [1, 2, 3]), ...(transfer ? [box('colr', ascii('nclx'), u16(9), u16(transfer), u16(9), [0x80])] : []), ...(dolby ? [box('dvcC', [1, 0])] : [])]
  const visual = box(entry, new Array(24).fill(0), u16(3840), u16(height), new Array(50).fill(0), ...children)
  const stsd = box('stsd', [0, 0, 0, 0], u32(1), visual)
  const moov = box('moov', mvhd, box('trak', box('mdia', box('minf', box('stbl', stsd)))))
  return [...box('ftyp', ascii('isom'), u32(0)), ...box('mdat', [0, 0, 0, 0]), ...moov]
}

const ebml = (id: number[], body: number[]) => [...id, ...size(body.length), ...body]
const size = (n: number) => [0x01, ...[0, 0, 0, 0, 0, 0, 0].map((_, i) => Math.floor(n / 256 ** (6 - i)) & 255)]
function mkv({ height, transfer }: { height: number; transfer?: number }) {
  const duration = new Uint8Array(new Float64Array([61_000]).buffer).reverse() // 61000 ms at 1ms scale, big endian
  const info = ebml([0x15, 0x49, 0xa9, 0x66], [...ebml([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), ...ebml([0x44, 0x89], [...duration])])
  const colour = transfer ? ebml([0x55, 0xb0], ebml([0x55, 0xba], [transfer])) : []
  const video = ebml([0xe0], [...ebml([0xb0], u16(3840)), ...ebml([0xba], u16(height)), ...colour])
  const track = ebml([0xae], [...ebml([0x83], [1]), ...ebml([0x86], ascii('V_AV1')), ...video])
  const tracks = ebml([0x16, 0x54, 0xae, 0x6b], track)
  const segment = ebml([0x18, 0x53, 0x80, 0x67], [...info, ...tracks, ...ebml([0x1f, 0x43, 0xb6, 0x75], [0])])
  return [...ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], ascii('matroska'))), ...segment]
}

describe('video container probe', () => {
  it('reads duration, height and PQ transfer from MP4 behind mdat', async () => {
    expect(await probeVideoContainer(reader(mp4({ height: 2160, transfer: 16 })))).toEqual({ duration: 95, height: 2160, hdr: true })
  })
  it('treats SDR MP4 as non-HDR and detects HLG and Dolby Vision', async () => {
    expect((await probeVideoContainer(reader(mp4({ height: 1080, transfer: 1 }))))?.hdr).toBe(false)
    expect((await probeVideoContainer(reader(mp4({ height: 1080, transfer: 18 }))))?.hdr).toBe(true)
    expect((await probeVideoContainer(reader(mp4({ height: 2160, entry: 'dvh1' }))))?.hdr).toBe(true)
    expect((await probeVideoContainer(reader(mp4({ height: 2160, dolby: true }))))?.hdr).toBe(true)
  })
  it('reads Matroska duration, pixel height and colour transfer', async () => {
    expect(await probeVideoContainer(reader(mkv({ height: 2160, transfer: 16 })))).toEqual({ duration: 61, height: 2160, hdr: true })
    expect(await probeVideoContainer(reader(mkv({ height: 1080 })))).toEqual({ duration: 61, height: 1080, hdr: false })
  })
  it('ignores unknown containers', async () => {
    expect(await probeVideoContainer(reader(new Array(64).fill(7)))).toBeUndefined()
  })
  it('labels resolutions', () => {
    expect(videoResolutionLabel(2160)).toBe('4K')
    expect(videoResolutionLabel(2304)).toBe('4K')
    expect(videoResolutionLabel(1080)).toBe('1080p')
    expect(videoResolutionLabel(0)).toBe('')
  })
})
