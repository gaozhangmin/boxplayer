// The Linux MPV addon must run outside Electron's Chromium/FFmpeg process.
const path = require('node:path')
const mpvModule = require(path.join(__dirname, 'mpv_texture.node'))
let mpv = mpvModule.mpvTexture || mpvModule
let waitingForFrameAck = false
let pendingFrame = null
let statusTimer = null
let nextTextureId = 0
const textures = new Map()

function send(message) {
  if (process.connected) process.send(message)
}

process.on('message', async (message) => {
  try {
    if (message.type === 'create-audio') {
      if (typeof mpvModule.createAudioDeck !== 'function') throw new Error('Music audio decks require an updated MPV core')
      mpv = mpvModule.createAudioDeck()
      statusTimer = setInterval(() => send({type:'status',status:mpv.getStatus()}),50)
      send({type:'ready'})
      return
    }
    if (message.type === 'texture-release') { textures.get(message.id)?.release?.(); textures.delete(message.id); return }
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
      const transport = message.transportPath ? require(path.join(__dirname, 'mpv_transport.node')) : null
      if (!transport) process.env.BOXPLAYER_MPV_RENDERER = 'software'
      await mpv.create(message.config)
      mpv.onFrame((frame) => {
        if (frame?.nativePixmap && transport) {
          const id = ++nextTextureId
          const { release, handle, ...metadata } = frame
          const descriptors = frame.nativePixmap.planes.map((plane) => plane.fd)
          if (transport.send(message.transportPath, JSON.stringify({ ...metadata, id }), descriptors)) textures.set(id, frame)
          else { release?.(); mpv.useSoftwareReadback() }
          return
        }
        if (!frame?.pixels) { frame?.release?.(); return }
        const copiedFrame = frame
        if (waitingForFrameAck) pendingFrame = copiedFrame
        else {
          waitingForFrameAck = true
          send({ type: 'frame', frame: copiedFrame })
        }
      })
      mpv.onStatus((status) => send({ type: 'status', status, tracks: mpv.getTrackStatus?.() }))
      mpv.onError((error) => send({ type: 'error', error: String(error) }))
      send({ type: 'ready' })
      return
    }
    if (message.type === 'destroy') {
      if (statusTimer) clearInterval(statusTimer)
      for (const frame of textures.values()) frame.release?.()
      textures.clear()
      await mpv.destroy()
      process.exit(0)
    }
    if (message.type !== 'command') return
    const { id, method, args = [] } = message
    const allowed = new Set(['load', 'play', 'pause', 'stop', 'seek', 'setVolume', 'setSpeed', 'setAudioTrack', 'setSubtitleTrack', 'setSubtitleStyle', 'setVideoProperty', 'addAudio', 'addSubtitle', 'getTrackStatus', 'useSoftwareReadback'])
    if (!allowed.has(method) || typeof mpv[method] !== 'function') throw new Error(`Unsupported MPV command: ${method}`)
    process.stderr.write(`[mpv-host] command ${method} start\n`)
    await mpv[method](...args)
    process.stderr.write(`[mpv-host] command ${method} complete\n`)
    send({ type: 'result', id, status: mpv.getStatus(), tracks: mpv.getTrackStatus?.() })
  } catch (error) {
    send({ type: 'error', id: message.id, error: error?.stack || String(error) })
  }
})

process.on('disconnect', async () => {
  if (statusTimer) clearInterval(statusTimer)
  await mpv.destroy()
  process.exit(0)
})
