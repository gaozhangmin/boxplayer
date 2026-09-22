import { fork, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import type { EmbeddedMpvNativeInstance, EmbeddedMpvStatus, EmbeddedMpvSubtitleStyle, EmbeddedMpvTextureInfo, EmbeddedMpvTrackStatus } from './embeddedMpvNativeAddon'

export function createLinuxMpvHost(addonPath: string): EmbeddedMpvNativeInstance {
  const directory = path.dirname(addonPath)
  let child: ChildProcess | null = null
  let nextId = 0
  let latestStatus: EmbeddedMpvStatus = {}
  let latestTracks: EmbeddedMpvTrackStatus = {}
  let frameCallback: (frame: EmbeddedMpvTextureInfo) => void = () => {}
  let statusCallback: (status: EmbeddedMpvStatus) => void = () => {}
  let errorCallback: (error: string) => void = () => {}
  const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>()
  let readyResolve: (() => void) | null = null
  let readyReject: ((error: Error) => void) | null = null
  let ready: Promise<void> = Promise.reject(new Error('MPV host has not started'))
  ready.catch(() => {})

  function fail(error: Error): void {
    readyReject?.(error)
    readyReject = null
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    errorCallback(error.message)
  }

  function command(method: string, ...args: unknown[]): Promise<void> {
    const id = ++nextId
    return ready.then(() => new Promise<void>((resolve, reject) => {
      if (!child?.connected) return reject(new Error('MPV host is not connected'))
      pending.set(id, { resolve, reject })
      child.send({ type: 'command', id, method, args }, (error) => {
        if (!error) return
        pending.delete(id)
        reject(error)
      })
    }))
  }

  function sendControl(method: string, ...args: unknown[]): Promise<void> {
    return command(method, ...args).catch((error) => {
      errorCallback(error.message)
      throw error
    })
  }

  return {
    renderMode: 'software',
    create(config = {}) {
      if (child) return
      ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
      child = fork(path.join(directory, 'mpv-host.cjs'), [], {
        execPath: path.join(directory, 'mpv-node-host'),
        execArgv: [],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        serialization: 'advanced',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
      })
      child.stderr?.on('data', (data: Buffer) => console.error(`[mpv-host] ${data.toString()}`))
      child.on('error', (error) => fail(error))
      child.on('exit', (code, signal) => {
        child = null
        fail(new Error(`MPV host exited (code=${code}, signal=${signal})`))
      })
      child.on('message', (message: any) => {
        if (message?.type === 'ready') { readyResolve?.(); readyResolve = null }
        else if (message?.type === 'frame' && message.frame?.pixels) {
          const frame = message.frame
          try {
            frameCallback({ ...frame, pixels: Buffer.from(frame.pixels) })
          } finally {
            child?.send({ type: 'frame-ack' })
          }
        } else if (message?.type === 'status') {
          latestStatus = message.status || {}
          latestTracks = message.tracks || {}
          statusCallback(latestStatus)
        } else if (message?.type === 'result') {
          latestStatus = message.status || latestStatus
          latestTracks = message.tracks || latestTracks
          pending.get(message.id)?.resolve()
          pending.delete(message.id)
        } else if (message?.type === 'error') {
          const error = new Error(String(message.error))
          if (message.id && pending.has(message.id)) {
            pending.get(message.id)?.reject(error)
            pending.delete(message.id)
          } else fail(error)
        }
      })
      child.send({ type: 'create', config })
    },
    load: (url, options) => command('load', url, options),
    play: () => sendControl('play'),
    pause: () => sendControl('pause'),
    stop: () => sendControl('stop'),
    seek: (position) => sendControl('seek', position),
    setVolume: (volume) => sendControl('setVolume', volume),
    setSpeed: (speed) => sendControl('setSpeed', speed),
    setAudioTrack: (id) => sendControl('setAudioTrack', id),
    setSubtitleTrack: (id) => sendControl('setSubtitleTrack', id),
    setSubtitleStyle: (style: EmbeddedMpvSubtitleStyle) => sendControl('setSubtitleStyle', style),
    setVideoProperty: (name, value) => sendControl('setVideoProperty', name, value),
    addAudio: (url, title) => sendControl('addAudio', url, title),
    addSubtitle: (url, title) => sendControl('addSubtitle', url, title),
    getStatus: () => latestStatus,
    getTrackStatus: () => latestTracks,
    destroy() {
      if (!child) return
      const closing = child
      closing.send({ type: 'destroy' })
      setTimeout(() => {
        if (closing.exitCode === null && !closing.killed) closing.kill()
      }, 2000).unref()
      child = null
    },
    onFrame(callback) { frameCallback = callback },
    onStatus(callback) { statusCallback = callback },
    onError(callback) { errorCallback = callback }
  }
}
