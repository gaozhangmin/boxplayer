import { ipcMain, WebContents } from 'electron'
import { createRequire } from 'node:module'
import { fork } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getEmbeddedMpvNativeAddonCandidates } from './embeddedMpvNativeAddon'
import { buildMpvLoadOptions } from './embeddedMpvLoadOptions'

type Job = { promise: Promise<unknown>; cancel: () => void }
type Owner = { source: string; generation: number; cancel?: () => void; running?: Promise<unknown>; cache: Map<number, string> }
const owners = new Map<number, Owner>()
const requireNative = createRequire(import.meta.url)

function beginDecode(url: string, options: string, directory: string): Job | undefined {
  for (const candidate of getEmbeddedMpvNativeAddonCandidates()) {
    if (!existsSync(candidate)) continue
    if (process.platform === 'linux') {
      const root = path.dirname(candidate)
      const executable = path.join(root, 'mpv-node-host')
      const host = path.join(root, 'mpv-host.cjs')
      if (!existsSync(executable) || !existsSync(host)) continue
      const child = fork(host, [], { execPath: executable, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { ...process.env, LD_LIBRARY_PATH: `${root}:${process.env.LD_LIBRARY_PATH || ''}` } })
      let result: unknown = false
      let stopping = false
      let finish: (value: unknown) => void = () => {}
      const promise = new Promise(resolve => { finish = resolve })
      const stop = (value: unknown) => {
        if (stopping) return
        stopping = true; result = value; child.kill()
      }
      const timer = setTimeout(() => { stop(false); child.kill('SIGKILL') }, 8000)
      child.on('message', (message: any) => { if (message.type === 'thumbnail-result') stop(message.ok) })
      child.once('error', () => { clearTimeout(timer); finish(false) })
      // Resolve only after exit, so temporary files cannot be written after cleanup.
      child.once('exit', () => { clearTimeout(timer); finish(result) })
      child.send({ type: 'thumbnail', url, options, directory })
      return { promise, cancel: () => stop(false) }
    }
    try {
      const addon = requireNative(candidate)
      if (typeof addon.beginSeekThumbnail === 'function') return addon.beginSeekThumbnail(url, options, directory)
    } catch { /* Try the next matching native bundle. */ }
  }
}

function ownerFor(sender: WebContents): Owner {
  let owner = owners.get(sender.id)
  if (!owner) {
    owner = { source: '', generation: 0, cache: new Map() }
    owners.set(sender.id, owner)
    sender.once('destroyed', () => { owner!.generation++; owner!.cancel?.(); owners.delete(sender.id) })
  }
  return owner
}

export function registerSeekThumbnailIpc() {
  ipcMain.on('Playback:cancelThumbnail', event => {
    const owner = owners.get(event.sender.id)
    if (owner) { owner.generation++; owner.cancel?.() }
  })
  ipcMain.handle('Playback:thumbnail', async (event, input) => {
    if (!input || typeof input.url !== 'string' || input.url.length > 32768 || !Number.isFinite(input.time) || input.time < 0) return null
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(input.headers || {})) {
      if (typeof value === 'string' && !/[\r\n]/.test(key + value)) headers[key] = value
    }
    const owner = ownerFor(event.sender)
    const source = JSON.stringify([input.url, headers])
    if (owner.source !== source) { owner.source = source; owner.cache.clear() }
    const bucket = Math.floor(input.time / 2)
    const token = ++owner.generation
    owner.cancel?.()
    if (owner.cache.has(bucket)) return owner.cache.get(bucket)
    const previous = owner.running
    const running = (async () => {
      await previous?.catch(() => null)
      if (owner.generation !== token || event.sender.isDestroyed()) return null
      const directory = await mkdtemp(path.join(tmpdir(), 'boxplayer-preview-')).catch(() => null)
      if (!directory) return null
      try {
        if (owner.generation !== token) return null
        const job = beginDecode(input.url, buildMpvLoadOptions({ url: input.url, headers, startPosition: bucket * 2 }), directory)
        if (!job) return null
        owner.cancel = job.cancel
        const ok = await job.promise
        if (!ok || owner.generation !== token) return null
        const file = (await readdir(directory)).find(name => name.endsWith('.png'))
        if (!file) return null
        const bytes = await readFile(path.join(directory, file))
        if (bytes.length > 2 * 1024 * 1024 || owner.generation !== token) return null
        const image = `data:image/png;base64,${bytes.toString('base64')}`
        owner.cache.set(bucket, image)
        if (owner.cache.size > 48) owner.cache.delete(owner.cache.keys().next().value!)
        return image
      } catch { return null }
      finally { await rm(directory, { recursive: true, force: true }).catch(() => {}) }
    })()
    owner.running = running
    return running
  })
}
