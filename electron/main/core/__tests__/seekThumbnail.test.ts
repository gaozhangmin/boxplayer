import { EventEmitter } from 'node:events'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ handlers: new Map<string, any>(), listeners: new Map<string, any>(), begin: vi.fn(), remove: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: {
  handle: (name: string, fn: any) => mock.handlers.set(name, fn),
  on: (name: string, fn: any) => mock.listeners.set(name, fn)
} }))
vi.mock('node:module', () => ({ createRequire: () => () => ({ beginSeekThumbnail: mock.begin }) }))
vi.mock('node:fs', () => ({ existsSync: () => true }))
vi.mock('node:fs/promises', () => ({
  mkdtemp: async () => '/tmp/preview-test', readdir: async () => ['00000001.png'],
  readFile: async () => Buffer.from('preview'), rm: (...args: any[]) => { mock.remove(...args); return Promise.resolve() }
}))
vi.mock('../../mpv/embeddedMpvNativeAddon', () => ({ getEmbeddedMpvNativeAddonCandidates: () => ['/fake/mpv.node'] }))
import { registerSeekThumbnailIpc } from '../../mpv/seekThumbnail'
registerSeekThumbnailIpc()
let nextId = 0
const owner = () => Object.assign(new EventEmitter(), { id: ++nextId, isDestroyed: () => false })
const request = (sender: any, time: number, url = 'https://video.invalid/movie', headers = { Authorization: 'Bearer example' }) =>
  mock.handlers.get('Playback:thumbnail')({ sender }, { url, headers, time })
const frameJob = () => ({ promise: Promise.resolve(true), cancel: vi.fn() })

// These fixtures exercise the in-process macOS addon contract. Linux uses a
// separate Node host, covered by the platform lifecycle and playback suites.
const hostPlatform = process.platform
beforeAll(() => { Object.defineProperty(process, 'platform', { value: 'darwin' }) })
afterAll(() => { Object.defineProperty(process, 'platform', { value: hostPlatform }) })

describe('independent seek thumbnails', () => {
  it('retains authorization and reuses cached frames within the same time bucket', async () => {
    mock.begin.mockReset().mockImplementation(frameJob)
    const sender = owner()
    const first = await request(sender, 10)
    expect(first).toBe('data:image/png;base64,cHJldmlldw==')
    expect(mock.begin.mock.calls[0][1]).toContain('Authorization: Bearer example')
    expect(mock.begin.mock.calls[0][1]).toContain('start=10')
    expect(await request(sender, 11)).toBe(first)
    expect(mock.begin).toHaveBeenCalledOnce()
    sender.emit('destroyed')
  })

  it('discards stale results and waits for the old decoder before opening a replacement', async () => {
    let finish!: (ok: boolean) => void
    const cancel = vi.fn()
    mock.begin.mockReset().mockImplementationOnce(() => ({ promise: new Promise(resolve => { finish = resolve }), cancel })).mockImplementation(frameJob)
    const sender = owner()
    const old = request(sender, 2)
    await vi.waitFor(() => expect(mock.begin).toHaveBeenCalledOnce())
    const latest = request(sender, 40)
    expect(cancel).toHaveBeenCalled()
    expect(mock.begin).toHaveBeenCalledOnce()
    finish(true)
    expect(await old).toBeNull()
    expect(await latest).toMatch(/^data:image\/png/)
    expect(mock.begin).toHaveBeenCalledTimes(2)
    sender.emit('destroyed')
  })

  it('invalidates cached authorization when credentials or video changes', async () => {
    mock.begin.mockReset().mockImplementation(frameJob)
    const sender = owner()
    await request(sender, 10)
    await request(sender, 10, 'https://video.invalid/movie', { Authorization: 'Bearer refreshed' })
    await request(sender, 10, 'https://video.invalid/other')
    expect(mock.begin).toHaveBeenCalledTimes(3)
    sender.emit('destroyed')
  })

  it('cancels an in-flight preview when the renderer leaves or closes', async () => {
    let finish!: (ok: boolean) => void
    const cancel = vi.fn()
    mock.begin.mockReset().mockImplementationOnce(() => ({ promise: new Promise(resolve => { finish = resolve }), cancel }))
    const sender = owner()
    const pending = request(sender, 2)
    await vi.waitFor(() => expect(mock.begin).toHaveBeenCalledOnce())
    mock.listeners.get('Playback:cancelThumbnail')({ sender })
    expect(cancel).toHaveBeenCalled()
    finish(true)
    expect(await pending).toBeNull()
    sender.emit('destroyed')
    expect(mock.remove).toHaveBeenCalled()
  })
})
