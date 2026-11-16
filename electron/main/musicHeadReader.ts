import { open } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isAbsolute } from 'node:path'
import { ipcMain } from 'electron'
const LIMIT = 1024 * 1024

/** One forward prefix only. Never issue suffix ranges or materialize a full response. */
export async function readMusicHead(input: { url: string; headers?: Record<string, string> }): Promise<string> {
  const url = String(input.url || '')
  if (/^[/\\]{2}/.test(url) || (url.startsWith('file:') && new URL(url).hostname && new URL(url).hostname !== 'localhost')) throw new Error('Remote file host is not local')
  if (url.startsWith('file:') || isAbsolute(url)) {
    const handle = await open(url.startsWith('file:') ? fileURLToPath(url) : url, 'r')
    try { const bytes = Buffer.alloc(LIMIT); const { bytesRead } = await handle.read(bytes, 0, LIMIT, 0); return bytes.subarray(0, bytesRead).toString('base64') } finally { await handle.close() }
  }
  throw new Error('Network audio metadata reads are disabled')
}
/** Local disk only; individual IPC reads stay bounded while offsets may reach EOF. */
export async function readLocalMusicChunk(input: {url: string; offset?: number; length?: number; version?: string}) {
  const url = String(input.url || '')
  if (url.startsWith('file:') && new URL(url).hostname && new URL(url).hostname !== 'localhost') throw new Error('Remote file host is not local')
  const path = url.startsWith('file:') ? fileURLToPath(url) : url
  if (!isAbsolute(path) || /^[/\\]{2}/.test(path)) throw new Error('Local audio path required')
  const handle = await open(path, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Local audio file required')
    const version = `${stat.size}:${stat.mtimeMs}:${stat.ino}`
    if (input.version && input.version !== version) throw new Error('Local audio changed during parsing')
    if (input.offset === undefined) return {size: stat.size, version}
    const length = input.length ?? 0, offset = input.offset
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > 65536 || offset + length > stat.size) throw new Error('Invalid local audio range')
    const bytes = Buffer.alloc(length)
    const {bytesRead} = await handle.read(bytes,0,length,offset)
    return {size:stat.size,version,base64:bytes.subarray(0,bytesRead).toString('base64')}
  } finally { await handle.close() }
}

export function registerMusicHeadIpc() { ipcMain.handle('MusicLocal:read', (_event, input) => readLocalMusicChunk(input)); ipcMain.handle('MusicHead:read', async (_event, input) => { try { return { base64: await readMusicHead(input) } } catch (error: any) { return { error: true, status: error.status, retryAfter: error.retryAfter } } }) }
