import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const addonPath = path.resolve(process.argv[2] || path.join(packageRoot, 'build', 'Release', 'mpv_texture.node'))
const require = createRequire(import.meta.url)
const native = require(addonPath)
const mpv = native.mpvTexture || native

for (const name of ['create', 'destroy', 'load', 'getStatus', 'setVolume', 'setSpeed', 'getTrackStatus', 'setAudioTrack', 'setSubtitleTrack', 'addAudio']) {
  if (typeof mpv[name] !== 'function') throw new Error(`Missing libmpv control method: ${name}`)
}

async function waitForTrackCount(type, expected, timeout = 5_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const count = (mpv.getTrackStatus()?.tracks || []).filter((track) => track.type === type).length
    if (count >= expected) return count
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const status = mpv.getTrackStatus()
  throw new Error(`libmpv did not expose ${expected} ${type} track(s): ${JSON.stringify(status)}`)
}

try {
  mpv.create({ headless: true })
  if (mpv.isInitialized?.() === false) throw new Error('libmpv did not initialize')
  mpv.setVolume(50)
  mpv.setSpeed(1.25)
  mpv.setAudioTrack(-1)
  mpv.setSubtitleTrack(-1)
  const status = mpv.getStatus()
  const tracks = mpv.getTrackStatus()
  if (!status || typeof status !== 'object' || !tracks || typeof tracks !== 'object') throw new Error('libmpv status/track query failed')

  const samplePath = path.resolve(packageRoot, '..', '..', 'e2e', 'assets', 'mpv-sample.mp4')
  const audioSamplePath = path.resolve(packageRoot, '..', '..', 'e2e', 'assets', 'mpv-sample.m4a')
  if (existsSync(samplePath)) {
    mpv.load(samplePath)
    await waitForTrackCount('audio', 1)
    mpv.addAudio(audioSamplePath, 'external-smoke-audio')
    const audioTracks = (mpv.getTrackStatus()?.tracks || []).filter((track) => track.type === 'audio')
    if (audioTracks.length < 2 || !audioTracks.some((track) => track.external || track.title === 'external-smoke-audio')) {
      throw new Error(`libmpv audio-add returned before exposing the external track: ${JSON.stringify(audioTracks)}`)
    }
  }
  console.log(`libmpv controls OK: ${process.platform}/${process.arch} ${addonPath}`)
} finally {
  mpv.destroy()
}
