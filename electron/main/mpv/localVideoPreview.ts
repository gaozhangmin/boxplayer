import { app, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { probeVideoContainer, type VideoProbeResult } from '../../../shared/videoContainerProbe'
import { beginDecode } from './seekThumbnail'

// Local file posters: a frame decoded by the bundled libmpv (software decode, so
// MKV/AV1/HEVC/HDR work where Chromium's <video> cannot) plus header metadata.
export interface LocalVideoPreviewResult { thumbnail: string; duration: number; height: number; hdr: boolean }
type CacheEntry = { duration: number; height: number; hdr: boolean; frame: boolean }

const pending = new Map<string, Promise<LocalVideoPreviewResult>>()
const waiting: Array<() => void> = []
let active = 0
const cacheDir = () => path.join(app.getPath('userData'), 'local-video-previews')

async function withDecodeSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve))
  active++
  try { return await task() } finally { active--; waiting.shift()?.() }
}

export async function probeLocalVideo(file: string): Promise<VideoProbeResult | undefined> {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    return await probeVideoContainer({
      size,
      read: async (offset, length) => {
        const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - offset)))
        if (buffer.length) await handle.read(buffer, 0, buffer.length, offset)
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length)
      }
    })
  } finally { await handle.close() }
}

async function decodeFrame(file: string, duration: number): Promise<Buffer | undefined> {
  return withDecodeSlot(async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'boxplayer-local-preview-')).catch(() => null)
    if (!directory) return undefined
    try {
      // Skip opening credits/black frames, but stay inside very short clips.
      const start = duration > 0 ? Math.min(Math.max(1, duration * 0.1), 300).toFixed(2) : '10%'
      const job = beginDecode(file, `start=${start}`, directory)
      if (!job || !(await job.promise)) return undefined
      const name = (await readdir(directory)).find(entry => entry.endsWith('.png'))
      if (!name) return undefined
      const bytes = await readFile(path.join(directory, name))
      return bytes.length && bytes.length <= 4 * 1024 * 1024 ? bytes : undefined
    } catch { return undefined }
    finally { await rm(directory, { recursive: true, force: true }).catch(() => {}) }
  })
}

async function readPreview(file: string): Promise<LocalVideoPreviewResult> {
  const empty = { thumbnail: '', duration: 0, height: 0, hdr: false }
  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) return empty
  const key = createHash('sha1').update(`${file}\0${info.size}\0${info.mtimeMs}`).digest('hex')
  const directory = cacheDir()
  const metaPath = path.join(directory, `${key}.json`), framePath = path.join(directory, `${key}.png`)
  const toResult = async (entry: CacheEntry) => ({
    duration: entry.duration, height: entry.height, hdr: entry.hdr,
    thumbnail: entry.frame ? await readFile(framePath).then(bytes => `data:image/png;base64,${bytes.toString('base64')}`).catch(() => '') : ''
  })
  const cached = await readFile(metaPath, 'utf8').then(text => JSON.parse(text) as CacheEntry).catch(() => null)
  if (cached) return toResult(cached)
  const probe = await probeLocalVideo(file).catch(() => undefined)
  const frame = await decodeFrame(file, probe?.duration || 0)
  const entry: CacheEntry = { duration: probe?.duration || 0, height: probe?.height || 0, hdr: !!probe?.hdr, frame: !!frame }
  try {
    await mkdir(directory, { recursive: true })
    if (frame) await writeFile(framePath, frame)
    // A failed decode is still cached so unreadable files are not retried on every scroll.
    await writeFile(metaPath, JSON.stringify(entry))
  } catch { /* The preview still renders without a persistent cache. */ }
  return { ...entry, thumbnail: frame ? `data:image/png;base64,${frame.toString('base64')}` : '' }
}

export function getLocalVideoPreview(file: string): Promise<LocalVideoPreviewResult> {
  let job = pending.get(file)
  if (!job) {
    job = readPreview(file).finally(() => pending.delete(file))
    pending.set(file, job)
  }
  return job
}

export function registerLocalVideoPreviewIpc() {
  ipcMain.handle('LocalVideo:preview', async (_event, input) => {
    const file = typeof input?.path === 'string' ? input.path : ''
    if (!file || file.length > 4096 || !path.isAbsolute(file)) return null
    return getLocalVideoPreview(file).catch(() => null)
  })
}
