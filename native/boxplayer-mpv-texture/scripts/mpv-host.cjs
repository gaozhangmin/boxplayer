// The Linux MPV addon must run outside Electron's Chromium/FFmpeg process.
const path = require('node:path')
const mpvModule = require(path.join(__dirname, 'mpv_texture.node'))
const mpv = mpvModule.mpvTexture || mpvModule
let waitingForFrameAck = false
let pendingFrame = null
let statusTimer = null

function send(message) {
  if (process.connected) process.send(message)
}

process.on('message', async (message) => {
  try {
    if (message.type === 'frame-ack') {
      waitingForFrameAck = false
      if (pendingFrame) {
        const frame = pendingFrame
        pendingFrame = null
        waitingForFrameAck = true
        send({ type: 'frame', frame })
      }
      return
    }
    if (message.type === 'create') {
      mpv.create(message.config)
      mpv.onFrame((frame) => {
        if (!frame?.pixels) return
        const copiedFrame = { ...frame, pixels: Buffer.from(frame.pixels) }
        if (waitingForFrameAck) pendingFrame = copiedFrame
        else {
          waitingForFrameAck = true
          send({ type: 'frame', frame: copiedFrame })
        }
      })
      mpv.onStatus((status) => send({ type: 'status', status, tracks: mpv.getTrackStatus?.() }))
      mpv.onError((error) => send({ type: 'error', error: String(error) }))
      // Track discovery and async audio-add/sub-add do not always change an
      // observed scalar property. Poll while isolated so the Electron-side
      // cache remains current when playback is paused or already at EOF.
      statusTimer = setInterval(() => send({ type: 'status', status: mpv.getStatus(), tracks: mpv.getTrackStatus?.() }), 250)
      statusTimer.unref?.()
      send({ type: 'ready' })
      return
    }
    if (message.type === 'destroy') {
      if (statusTimer) clearInterval(statusTimer)
      mpv.destroy()
      process.exit(0)
    }
    if (message.type !== 'command') return
    const { id, method, args = [] } = message
    const allowed = new Set(['load', 'play', 'pause', 'stop', 'seek', 'setVolume', 'setSpeed', 'setAudioTrack', 'setSubtitleTrack', 'setSubtitleStyle', 'setVideoProperty', 'addAudio', 'addSubtitle'])
    if (!allowed.has(method) || typeof mpv[method] !== 'function') throw new Error(`Unsupported MPV command: ${method}`)
    await mpv[method](...args)
    send({ type: 'result', id, status: mpv.getStatus(), tracks: mpv.getTrackStatus?.() })
  } catch (error) {
    send({ type: 'error', id: message.id, error: error?.stack || String(error) })
  }
})

process.on('disconnect', () => {
  if (statusTimer) clearInterval(statusTimer)
  mpv.destroy()
  process.exit(0)
})
