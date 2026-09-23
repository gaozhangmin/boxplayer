import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const addonPath = path.join(packageRoot, 'build', 'Release', 'mpv_texture.node')
const sample = path.resolve(process.argv[2] || path.join(packageRoot, '..', '..', 'e2e', 'assets', 'mpv-sample.mp4'))
const externalAudio = path.resolve(process.argv[3] || path.join(packageRoot, '..', '..', 'e2e', 'assets', 'mpv-sample.m4a'))
const externalSubtitle = path.resolve(process.argv[4] || path.join(packageRoot, '..', '..', 'e2e', 'assets', 'mpv-sample.srt'))
const native = createRequire(import.meta.url)(addonPath)
const mpv = native.mpvTexture || native
let frames = 0
let lastStatus = null

try {
  mpv.create({ headless: false, width: 640, height: 360, hwdec: 'no' })
  mpv.onFrame((frame) => {
    if (frame?.pixels?.length === frame.width * frame.height * 4) frames++
  })
  mpv.onStatus((status) => { lastStatus = status })
  await mpv.load(sample)
  const deadline = Date.now() + 10_000
  while (frames === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (frames === 0) throw new Error(`No software video frames; status=${JSON.stringify(lastStatus)}`)
  for (const [name, value] of [
    ['video-aspect-override', '16:9'],
    ['video-crop', '16:10'],
    ['video-rotate', '90'],
    ['hwdec', 'auto'],
    ['deinterlace', 'yes'],
    ['tone-mapping', 'auto'],
    ['brightness', '10']
  ]) mpv.setVideoProperty(name, value)
  mpv.addAudio(externalAudio, 'software-render-smoke-audio')
  mpv.addSubtitle(externalSubtitle, 'software-render-smoke-subtitle')
  const trackDeadline = Date.now() + 5_000
  let tracks = mpv.getTrackStatus?.()
  while (Date.now() < trackDeadline && (!(tracks?.tracks || []).some((track) => track.type === 'audio' && track.external) || !(tracks?.tracks || []).some((track) => track.type === 'sub' && track.external))) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    tracks = mpv.getTrackStatus?.()
  }
  if (!(tracks?.tracks || []).some((track) => track.type === 'audio' && track.external)) throw new Error(`External audio missing during software rendering: ${JSON.stringify(tracks)}`)
  if (!(tracks?.tracks || []).some((track) => track.type === 'sub' && track.external)) throw new Error(`External subtitle missing during software rendering: ${JSON.stringify(tracks)}`)
  console.log(`Software MPV playback and track mutation OK: ${process.platform}/${process.arch}, frames=${frames}`)
} finally {
  mpv.destroy()
}
