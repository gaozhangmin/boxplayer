// Reads duration, coded height and HDR signalling from MP4/MOV and Matroska/WebM
// headers without decoding. Pure logic over a random-access reader so it can be
// unit tested and run in the main process against local files.
export interface VideoProbeReader { size: number; read(offset: number, length: number): Promise<Uint8Array> }
export interface VideoProbeResult { duration: number; height: number; hdr: boolean }

const MAX_BOX = 64 * 1024 * 1024
const PQ = 16, HLG = 18
const DOLBY_VISION_BOXES = new Set(['dvcC', 'dvvC', 'dvwC'])
const DOLBY_VISION_ENTRIES = new Set(['dvh1', 'dvhe', 'dav1', 'dva1', 'dvav'])

const fourcc = (bytes: Uint8Array, offset: number) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

export async function probeVideoContainer(reader: VideoProbeReader): Promise<VideoProbeResult | undefined> {
  if (reader.size < 16) return undefined
  const head = await reader.read(0, 12)
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return probeMatroska(reader)
  if (['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip'].includes(fourcc(head, 4))) return probeMp4(reader)
  return undefined
}

// ---------------------------------------------------------------- MP4 / MOV
function* boxes(bytes: Uint8Array, start: number, end: number): Generator<{ type: string; body: number; end: number }> {
  const data = view(bytes)
  let offset = start
  while (offset + 8 <= end) {
    let size = data.getUint32(offset)
    let header = 8
    if (size === 1 && offset + 16 <= end) { size = Number(data.getBigUint64(offset + 8)); header = 16 }
    else if (size === 0) size = end - offset
    if (size < header || offset + size > end) return
    yield { type: fourcc(bytes, offset + 4), body: offset + header, end: offset + size }
    offset += size
  }
}

async function probeMp4(reader: VideoProbeReader): Promise<VideoProbeResult | undefined> {
  let offset = 0
  while (offset + 8 <= reader.size) {
    const header = view(await reader.read(offset, 16))
    let size = header.getUint32(0)
    let headerSize = 8
    if (size === 1) { size = Number(header.getBigUint64(8)); headerSize = 16 }
    else if (size === 0) size = reader.size - offset
    if (size < headerSize) return undefined
    const type = String.fromCharCode(header.getUint8(4), header.getUint8(5), header.getUint8(6), header.getUint8(7))
    if (type === 'moov') {
      if (size > MAX_BOX) return undefined
      const moov = await reader.read(offset + headerSize, size - headerSize)
      return parseMoov(moov)
    }
    offset += size
  }
  return undefined
}

function parseMoov(moov: Uint8Array): VideoProbeResult {
  const data = view(moov)
  const result: VideoProbeResult = { duration: 0, height: 0, hdr: false }
  for (const box of boxes(moov, 0, moov.length)) {
    if (box.type === 'mvhd' && box.end - box.body >= 20) {
      const version = moov[box.body]
      const timescale = data.getUint32(box.body + (version === 1 ? 20 : 12))
      const duration = version === 1 ? Number(data.getBigUint64(box.body + 24)) : data.getUint32(box.body + 16)
      if (timescale) result.duration = duration / timescale
    }
    if (box.type === 'trak') readTrack(moov, box.body, box.end, result)
  }
  return result
}

function readTrack(moov: Uint8Array, start: number, end: number, result: VideoProbeResult) {
  const data = view(moov)
  for (const box of boxes(moov, start, end)) {
    if (['mdia', 'minf', 'stbl'].includes(box.type)) readTrack(moov, box.body, box.end, result)
    if (box.type !== 'stsd' || box.end - box.body < 8) continue
    // FullBox header (4) + entry_count (4), then sample entries.
    for (const entry of boxes(moov, box.body + 8, box.end)) {
      // A visual sample entry stores width/height at +24/+26 from its body and children at +78.
      if (entry.end - entry.body < 78) continue
      const height = data.getUint16(entry.body + 26)
      const children = [...boxes(moov, entry.body + 78, entry.end)]
      const visual = children.some(child => ['avcC', 'hvcC', 'av1C', 'vpcC', 'colr', 'pasp', 'btrt'].includes(child.type) || DOLBY_VISION_BOXES.has(child.type))
      if (!visual && !DOLBY_VISION_ENTRIES.has(entry.type)) continue
      if (height > result.height) result.height = height
      if (DOLBY_VISION_ENTRIES.has(entry.type)) result.hdr = true
      for (const child of children) {
        if (DOLBY_VISION_BOXES.has(child.type)) result.hdr = true
        if (child.type === 'colr' && child.end - child.body >= 10 && ['nclx', 'nclc'].includes(fourcc(moov, child.body))) {
          const transfer = data.getUint16(child.body + 6)
          if (transfer === PQ || transfer === HLG) result.hdr = true
        }
      }
    }
  }
}

// ---------------------------------------------------------------- Matroska
const ID = { segment: 0x18538067, info: 0x1549a966, tracks: 0x1654ae6b, cluster: 0x1f43b675, timestampScale: 0x2ad7b1, duration: 0x4489, trackEntry: 0xae, trackType: 0x83, codecId: 0x86, video: 0xe0, pixelHeight: 0xba, colour: 0x55b0, transfer: 0x55ba, blockAdditionMapping: 0x41e4, blockAddIdType: 0x41e7 }
const UNKNOWN = -1

function readVint(bytes: Uint8Array, offset: number, keepMarker: boolean): { value: number; length: number } | undefined {
  const first = bytes[offset]
  if (first === undefined || first === 0) return undefined
  let length = 1
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++
  if (length > 8 || offset + length > bytes.length) return undefined
  let value = keepMarker ? first : first & (0xff >> length)
  let allOnes = value === (0xff >> length)
  for (let i = 1; i < length; i++) { value = value * 256 + bytes[offset + i]; if (bytes[offset + i] !== 0xff) allOnes = false }
  return { value: !keepMarker && allOnes ? UNKNOWN : value, length }
}

function* elements(bytes: Uint8Array, start: number, end: number): Generator<{ id: number; body: number; end: number }> {
  let offset = start
  while (offset < end) {
    const id = readVint(bytes, offset, true)
    if (!id) return
    const size = readVint(bytes, offset + id.length, false)
    if (!size) return
    const body = offset + id.length + size.length
    const stop = size.value === UNKNOWN ? end : Math.min(end, body + size.value)
    yield { id: id.value, body, end: stop }
    offset = stop
  }
}

const readUint = (bytes: Uint8Array, start: number, end: number) => { let value = 0; for (let i = start; i < end; i++) value = value * 256 + bytes[i]; return value }
const readFloat = (bytes: Uint8Array, start: number, end: number) => end - start === 4 ? view(bytes).getFloat32(start) : end - start === 8 ? view(bytes).getFloat64(start) : 0

async function probeMatroska(reader: VideoProbeReader): Promise<VideoProbeResult | undefined> {
  const prefix = await reader.read(0, Math.min(reader.size, 64))
  // Skip the EBML header to find the Segment.
  const ebml = [...elements(prefix, 0, prefix.length)][0]
  if (!ebml) return undefined
  const segmentHeader = await reader.read(ebml.end, Math.min(16, reader.size - ebml.end))
  const segmentId = readVint(segmentHeader, 0, true)
  const segmentSize = segmentId && readVint(segmentHeader, segmentId.length, false)
  if (!segmentId || !segmentSize || segmentId.value !== ID.segment) return undefined
  const segmentStart = ebml.end + segmentId.length + segmentSize.length
  const segmentEnd = segmentSize.value === UNKNOWN ? reader.size : Math.min(reader.size, segmentStart + segmentSize.value)
  const result: VideoProbeResult = { duration: 0, height: 0, hdr: false }
  let scale = 1_000_000, rawDuration = 0, sawInfo = false, sawTracks = false
  let offset = segmentStart
  for (let guard = 0; offset < segmentEnd && guard < 4096 && !(sawInfo && sawTracks); guard++) {
    const header = await reader.read(offset, Math.min(16, segmentEnd - offset))
    const id = readVint(header, 0, true)
    const size = id && readVint(header, id.length, false)
    if (!id || !size || size.value === UNKNOWN) break
    const body = offset + id.length + size.length
    if ((id.value === ID.info || id.value === ID.tracks) && size.value <= MAX_BOX) {
      const bytes = await reader.read(body, Math.min(size.value, segmentEnd - body))
      if (id.value === ID.info) {
        sawInfo = true
        for (const child of elements(bytes, 0, bytes.length)) {
          if (child.id === ID.timestampScale) scale = readUint(bytes, child.body, child.end) || scale
          if (child.id === ID.duration) rawDuration = readFloat(bytes, child.body, child.end)
        }
      } else {
        sawTracks = true
        readMatroskaTracks(bytes, result)
      }
    } else if (id.value === ID.cluster && (sawInfo || sawTracks)) break
    offset = body + size.value
  }
  result.duration = rawDuration * scale / 1e9
  return result
}

function readMatroskaTracks(bytes: Uint8Array, result: VideoProbeResult) {
  for (const entry of elements(bytes, 0, bytes.length)) {
    if (entry.id !== ID.trackEntry) continue
    let video = false, height = 0, hdr = false
    for (const child of elements(bytes, entry.body, entry.end)) {
      if (child.id === ID.trackType) video = readUint(bytes, child.body, child.end) === 1
      if (child.id === ID.codecId && /^V_/.test(new TextDecoder().decode(bytes.subarray(child.body, child.end)))) video = true
      if (child.id === ID.blockAdditionMapping) {
        for (const mapping of elements(bytes, child.body, child.end)) {
          if (mapping.id === ID.blockAddIdType && DOLBY_VISION_BOXES.has(fourcc(bytes, mapping.end - 4))) hdr = true
        }
      }
      if (child.id !== ID.video) continue
      for (const field of elements(bytes, child.body, child.end)) {
        if (field.id === ID.pixelHeight) height = readUint(bytes, field.body, field.end)
        if (field.id !== ID.colour) continue
        for (const colour of elements(bytes, field.body, field.end)) {
          if (colour.id === ID.transfer && [PQ, HLG].includes(readUint(bytes, colour.body, colour.end))) hdr = true
        }
      }
    }
    if (!video) continue
    if (height > result.height) result.height = height
    if (hdr) result.hdr = true
  }
}

/** "4K" for 2160p and above, otherwise "<height>p". */
export function videoResolutionLabel(height: number | undefined): string {
  if (!height || height <= 0) return ''
  return height >= 2160 ? '4K' : `${height}p`
}
