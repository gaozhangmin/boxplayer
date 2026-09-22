import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const addonPath = path.join(packageRoot, 'build', 'Release', 'mpv_texture.node')
const sample = path.resolve(process.argv[2] || path.join(packageRoot, '..', '..', 'e2e', 'assets', 'mpv-sample.mp4'))
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
  console.log(`Software MPV playback OK: ${process.platform}/${process.arch}, frames=${frames}`)
} finally {
  mpv.destroy()
}
