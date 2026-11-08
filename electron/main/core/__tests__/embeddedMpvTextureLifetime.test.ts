import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ imports: [] as any[], send: vi.fn(), native: {} as any }))
vi.mock('../../utils/mainfile', () => ({ getStaticPath: (file: string) => `/missing/${file}`, getAsarPath: (file: string) => `${process.cwd()}/${file}` }))
vi.mock('electron', () => ({ sharedTexture: {
  importSharedTexture: (options: any) => { mock.imports.push(options); return { release: vi.fn() } },
  sendSharedTexture: (...args: any[]) => mock.send(...args)
} }))
vi.mock('../../mpv/embeddedMpvNativeAddon', () => ({
  loadEmbeddedMpvNativeAddon: () => ({ addon: { mpvTexture: mock.native }, searchedPaths: [] }),
  getEmbeddedMpvNativeResourceStatus: () => ({ complete: true, missing: [] })
}))
vi.mock('../../mpv/embeddedMpvCapability', () => ({ getEmbeddedMpvCapability: () => ({ enabled: true }) }))
import { EmbeddedMpvTextureBridge } from '../../mpv/embeddedMpvTextureBridge'

function fixture() {
  let onFrame!: (frame: any) => void
  let onError!: (error: string) => void
  mock.native = {
    create: vi.fn(async () => {}), destroy: vi.fn(async () => {}), load: vi.fn(async () => {}),
    getStatus: () => ({}), getTrackStatus: () => ({ tracks: [] }),
    onFrame: (callback: any) => { onFrame = callback }, onStatus: () => {}, onError: (callback: any) => { onError = callback },
    addSubtitle: vi.fn(async () => {})
  }
  mock.send.mockReset().mockResolvedValue(undefined)
  mock.imports.length = 0
  const window = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: { send: vi.fn(), mainFrame: {} } })
  const bridge = new EmbeddedMpvTextureBridge()
  return { bridge, window, error: (value: string) => onError(value), frame: (release = vi.fn()) => onFrame({ handle: 1n, width: 1280, height: 720, format: 'bgra', release }) }
}
afterEach(() => vi.useRealTimers())

describe('MPV shared texture ownership', () => {
  it('keeps recoverable native diagnostics out of live status but includes them in terminal playback errors', async () => {
    const { bridge, window, error } = fixture()
    try {
      await bridge.load(window as any, { url: 'test' })
      error('MPV diagnostic: ffmpeg: HTTP 403 at https://example.test/video?token=private')
      expect((await bridge.getStatus()).error).toBeUndefined()
      error('Playback error: loading failed')
      expect((await bridge.getStatus()).error).toBe('Playback error: loading failed\nffmpeg: HTTP 403 at [media URL]')
      await bridge.load(window as any, { url: 'next' })
      expect((await bridge.getStatus()).error).toBeUndefined()
      error('MPV diagnostic: ffmpeg: https://example.test/video?access_token=private')
      error('MPV diagnostic: Authorization: Bearer private')
      expect((await bridge.getStatus()).error).toBeUndefined()
      error('Playback error: loading failed')
      expect((await bridge.getStatus()).error).toContain('[redacted source diagnostic]')
      expect((await bridge.getStatus()).error).not.toContain('private')
    } finally { bridge.destroy() }
  })

  it('passes 10x speed through the main-process bridge and rejects out-of-range values', async () => {
    const { bridge, window } = fixture()
    mock.native.setSpeed = vi.fn(async () => {})
    try {
      await bridge.load(window as any, { url: 'test', sessionId: 'speed' })
      expect(await bridge.control({ action: 'setSpeed', value: 10 })).toMatchObject({ ok: true })
      expect(mock.native.setSpeed).toHaveBeenCalledWith(10)
      for (const value of [10.25, 0, NaN, Infinity]) {
        expect(await bridge.control({ action: 'setSpeed', value })).toMatchObject({ ok: false })
      }
      expect(mock.native.setSpeed).toHaveBeenCalledOnce()
    } finally { bridge.destroy() }
  })

  it('retains native texture until all Electron references are released', async () => {
    const { bridge, window, frame } = fixture()
    await bridge.load(window as any, { url: 'test', sessionId: 'one' })
    const release = vi.fn()
    frame(release)
    await Promise.resolve()
    expect(release).not.toHaveBeenCalled()
    bridge.destroy()
    expect(release).not.toHaveBeenCalled()
    mock.imports[0].allReferencesReleased()
    expect(release).toHaveBeenCalledOnce()
  })

  it('releases a dropped pending frame without releasing an in-flight frame', async () => {
    const { bridge, window, frame } = fixture()
    let complete!: () => void
    mock.send.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve }))
    await bridge.load(window as any, { url: 'test' })
    const inFlight = vi.fn(), dropped = vi.fn(), latest = vi.fn()
    frame(inFlight)
    frame(dropped)
    frame(latest)
    expect(dropped).toHaveBeenCalledOnce()
    expect(inFlight).not.toHaveBeenCalled()
    bridge.destroy()
    expect(latest).toHaveBeenCalledOnce()
    complete()
    await Promise.resolve()
    mock.imports[0].allReferencesReleased()
    expect(inFlight).toHaveBeenCalledOnce()
  })

  it('allows reopening while the first native initialization is still pending', async () => {
    const { bridge, window } = fixture()
    let ready!: () => void
    mock.native.create.mockImplementationOnce(() => new Promise<void>((resolve) => { ready = resolve }))
    const first = bridge.load(window as any, { url: 'old', sessionId: 'old' })
    await vi.waitFor(() => expect(mock.native.create).toHaveBeenCalledOnce())
    window.emit('closed')
    const secondWindow = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: { send: vi.fn(), mainFrame: {} } })
    const second = bridge.load(secondWindow as any, { url: 'new', sessionId: 'new' })
    ready()
    expect(await first).toMatchObject({ ok: false })
    expect(await second).toMatchObject({ ok: true })
    expect(mock.native.create).toHaveBeenCalledTimes(2)
    bridge.destroy()
  })

  it('does not report a previous video subtitle completion as current state', async () => {
    const { bridge, window } = fixture()
    await bridge.load(window as any, { url: 'old', sessionId: 'old' })
    let complete!: () => void
    mock.native.addSubtitle.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve }))
    const pending = bridge.control({ action: 'addSubtitle', url: 'subtitle', sessionId: 'old' })
    await bridge.load(window as any, { url: 'new', sessionId: 'new' })
    complete()
    expect(await pending).toMatchObject({ ok: false, sessionId: 'old' })
    expect(await bridge.control({ action: 'addSubtitle', url: 'subtitle', sessionId: 'old' })).toMatchObject({ ok: false })
    expect(mock.native.addSubtitle).toHaveBeenCalledTimes(1)
    bridge.destroy()
  })
})
