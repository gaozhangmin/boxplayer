import { fork, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { EmbeddedMpvNativeInstance, EmbeddedMpvStatus, EmbeddedMpvSubtitleStyle, EmbeddedMpvTextureInfo, EmbeddedMpvTrackStatus } from './embeddedMpvNativeAddon'

export function normalizeLinuxMpvStatus(status: EmbeddedMpvStatus | undefined): EmbeddedMpvStatus {
  const playing = Boolean(status?.playing)
  return {
    ...(status || {}),
    playing,
    paused: typeof status?.paused === 'boolean' ? status.paused : !playing,
    speed: typeof status?.speed === 'number' ? status.speed : 1
  }
}

export function createLinuxMpvHost(addonPath: string): EmbeddedMpvNativeInstance {
  const directory = path.dirname(addonPath)
  let child: ChildProcess | null = null
  let closeTransport: (() => void) | null = null
  let nextId = 0
  let latestStatus: EmbeddedMpvStatus = {}
  let latestTracks: EmbeddedMpvTrackStatus = {}
  let frameCallback: (frame: EmbeddedMpvTextureInfo) => void = () => {}
  let statusCallback: (status: EmbeddedMpvStatus) => void = () => {}
  let errorCallback: (error: string) => void = () => {}
  const pending = new Map<number, { resolve: (message: any) => void; reject: (error: Error) => void }>()
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

  function command<T = void>(method: string, ...args: unknown[]): Promise<T> {
    const id = ++nextId
    const owner = child
    return ready.then(() => new Promise<T>((resolve, reject) => {
      if (owner !== child) return reject(new Error('MPV playback session was replaced'))
      if (!child?.connected) return reject(new Error('MPV host is not connected'))
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`MPV ${method} timed out`))
      }, 20000)
      timer.unref?.()
      pending.set(id, {
        resolve: (message) => { clearTimeout(timer); resolve(message) },
        reject: (error) => { clearTimeout(timer); reject(error) }
      })
      child.send({ type: 'command', id, method, args }, (error) => {
        if (!error) return
        pending.get(id)?.reject(error)
        pending.delete(id)
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
    renderMode: 'texture',
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
      const owner = child
      closeTransport = null
      let transportPath: string | undefined
      let socketDirectory: string | undefined
      const transportAddon = path.join(directory, 'mpv_transport.node')
      if (existsSync(transportAddon)) {
        try {
          const transport = createRequire(import.meta.url)(transportAddon)
          socketDirectory = mkdtempSync(path.join(tmpdir(), 'boxplayer-mpv-'))
          transportPath = path.join(socketDirectory, 'frames')
          const receiver = new transport.Receiver(transportPath, (metadata: string, descriptors: number[]) => {
            let transferred = false
            let released = false
            let id: number | undefined
            const release = () => {
              if (released) return
              released = true
              transport.closeDescriptors(descriptors)
              if (id != null && owner.connected) owner.send({ type: 'texture-release', id }, () => {})
            }
            try {
              const frame = JSON.parse(metadata)
              id = frame.id
              if (owner !== child || frame.nativePixmap?.planes?.length !== descriptors.length) return
              if (!(frame.width > 0 && frame.width <= 16384 && frame.height > 0 && frame.height <= 16384)) return
              frame.handle = 0n
              frame.nativePixmap.planes.forEach((plane: any, index: number) => { plane.fd = descriptors[index] })
              frame.release = release
              frameCallback(frame)
              transferred = true
            } catch (error) {
              console.warn('[mpv] Could not receive GPU frame', error)
            } finally {
              if (!transferred) release()
            }
          })
          closeTransport = () => { receiver.stop(); rmSync(socketDirectory, { recursive: true, force: true }) }
        } catch (error) {
          transportPath = undefined
          if (socketDirectory) rmSync(socketDirectory, { recursive: true, force: true })
          console.warn('[mpv] DMA-BUF transport unavailable; using software frames', error)
        }
      }
      const cleanupTransport = closeTransport
      const startupTimer = setTimeout(() => {
        if (owner !== child || !readyResolve) return
        fail(new Error('MPV host startup timed out'))
        owner.kill()
      }, 10000)
      startupTimer.unref?.()
      child.stderr?.on('data', (data: Buffer) => console.error(`[mpv-host] ${data.toString()}`))
      child.on('error', (error) => { if (owner === child) fail(error) })
      child.on('exit', (code, signal) => {
        cleanupTransport?.()
        clearTimeout(startupTimer)
        if (owner !== child) return
        child = null
        fail(new Error(`MPV host exited (code=${code}, signal=${signal})`))
      })
      child.on('message', (message: any) => {
        if (owner !== child) return
        if (message?.type === 'ready') { clearTimeout(startupTimer); readyResolve?.(); readyResolve = null }
        else if (message?.type === 'frame' && message.frame?.pixels) {
          const frame = message.frame
          try {
            frameCallback(frame)
          } finally {
            child?.send({ type: 'frame-ack' })
          }
        } else if (message?.type === 'status') {
          latestStatus = normalizeLinuxMpvStatus(message.status)
          latestTracks = message.tracks || {}
          statusCallback(latestStatus)
        } else if (message?.type === 'result') {
          latestStatus = message.status ? normalizeLinuxMpvStatus(message.status) : latestStatus
          latestTracks = message.tracks || latestTracks
          pending.get(message.id)?.resolve({ ...message, status: latestStatus, tracks: latestTracks })
          pending.delete(message.id)
        } else if (message?.type === 'error') {
          const error = new Error(String(message.error))
          if (message.id) {
            // A timed-out command may reply after the request was discarded.
            // Its error must not poison the current playback session.
            pending.get(message.id)?.reject(error)
            pending.delete(message.id)
          } else fail(error)
        }
      })
      child.send({ type: 'create', config, transportPath })
    },
    useSoftwareReadback: () => sendControl('useSoftwareReadback'),
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
    addAudio: (url, title) => command('addAudio', url, title),
    addSubtitle: (url, title) => command('addSubtitle', url, title),
    getStatus: () => latestStatus,
    getTrackStatus: () => latestTracks,
    async refreshTrackStatus() {
      const result = await command<{ tracks?: EmbeddedMpvTrackStatus }>('getTrackStatus')
      latestTracks = result?.tracks || latestTracks
      return latestTracks
    },
    destroy() {
      if (!child) return
      const closing = child
      closeTransport?.()
      closeTransport = null
      // Reject only this session before a replacement can install requests.
      readyReject?.(new Error('MPV host closed'))
      readyReject = null
      readyResolve = null
      for (const request of pending.values()) request.reject(new Error('MPV host closed'))
      pending.clear()
      latestStatus = {}
      latestTracks = {}
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
