import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const addonPath = path.resolve(process.argv[2] || path.join(packageRoot, 'build', 'Release', 'mpv_texture.node'))
const require = createRequire(import.meta.url)
const native = require(addonPath)
const mpv = native.mpvTexture || native

for (const name of ['create', 'destroy', 'getStatus', 'setVolume', 'setSpeed', 'getTrackStatus', 'setAudioTrack', 'setSubtitleTrack']) {
  if (typeof mpv[name] !== 'function') throw new Error(`Missing libmpv control method: ${name}`)
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
  console.log(`libmpv controls OK: ${process.platform}/${process.arch} ${addonPath}`)
} finally {
  mpv.destroy()
}
