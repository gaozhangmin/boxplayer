import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { children } = vi.hoisted(() => ({ children: [] as any[] }))
vi.mock('node:child_process', () => ({ fork: vi.fn(() => children.shift()) }))
import { createLinuxMpvHost } from '../../mpv/embeddedMpvLinuxHost'

function child() {
  const instance = Object.assign(new EventEmitter(), {
    connected: true, exitCode: null, killed: false,
    stderr: new EventEmitter(), send: vi.fn((_message: any, done?: (error: Error | null) => void) => done?.(null)),
    kill: vi.fn()
  })
  children.push(instance)
  return instance
}

afterEach(() => { children.length = 0; vi.useRealTimers() })

describe('MPV host lifecycle', () => {
  it('ignores an old child exit and messages after a replacement is ready', async () => {
    const old = child()
    const current = child()
    const host = createLinuxMpvHost('/missing/mpv_texture.node')
    host.create()
    old.emit('message', { type: 'ready' })
    host.destroy()
    host.create()
    current.emit('message', { type: 'ready' })
    old.emit('exit', 0, null)
    old.emit('message', { type: 'status', status: { position: 99 } })
    const request = host.pause()
    await Promise.resolve()
    const message = current.send.mock.calls.find(([value]) => value.type === 'command')![0]
    current.emit('message', { type: 'result', id: message.id, status: { position: 2, playing: false } })
    await expect(request).resolves.toBeDefined()
    expect(host.getStatus().position).toBe(2)
    host.destroy()
  })

  it('rejects requests waiting for readiness when the owning session closes', async () => {
    child()
    const host = createLinuxMpvHost('/missing/mpv_texture.node')
    host.create()
    const request = host.load('file.mkv')
    const rejected = expect(request).rejects.toThrow('closed')
    host.destroy()
    await rejected
  })

  it('bounds unanswered commands without launching another app', async () => {
    vi.useFakeTimers()
    const process = child()
    const host = createLinuxMpvHost('/missing/mpv_texture.node')
    host.create()
    process.emit('message', { type: 'ready' })
    const pending = host.load('file.mkv')
    const rejected = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(20001)
    await rejected
    host.destroy()
  })
  it('returns a subtitle failure without marking video playback as failed', async () => {
    const process = child()
    const host = createLinuxMpvHost('/missing/mpv_texture.node')
    const onError = vi.fn()
    host.onError(onError)
    host.create()
    process.emit('message', { type: 'ready' })
    const pending = host.addSubtitle!('subtitle.srt', 'external')
    const rejected = expect(pending).rejects.toThrow('core not initialized')
    await Promise.resolve()
    const message = process.send.mock.calls.find(([value]) => value.method === 'addSubtitle')![0]
    process.emit('message', { type: 'error', id: message.id, error: 'core not initialized' })
    await rejected
    expect(onError).not.toHaveBeenCalled()
    host.destroy()
  })

  it('ignores an error reply from an expired optional command', async () => {
    vi.useFakeTimers()
    const process = child()
    const host = createLinuxMpvHost('/missing/mpv_texture.node')
    const onError = vi.fn()
    host.onError(onError)
    host.create()
    process.emit('message', { type: 'ready' })
    const pending = host.addSubtitle!('subtitle.srt')
    const rejected = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(20001)
    await rejected
    const message = process.send.mock.calls.find(([value]) => value.method === 'addSubtitle')![0]
    process.emit('message', { type: 'error', id: message.id, error: 'cancelled' })
    expect(onError).not.toHaveBeenCalled()
    host.destroy()
  })

})
