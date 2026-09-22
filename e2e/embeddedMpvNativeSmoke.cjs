const { app, BrowserWindow } = require('electron')
const path = require('node:path')

// Linux loads the native addon in the isolated Node host, not in Electron.
if (process.platform === 'linux') throw new Error('Use the production Linux isolated-host Playwright test instead')
const addon = require(path.resolve(__dirname, '../native/boxplayer-mpv-texture/build/Release/mpv_texture.node'))
const mpv = addon.mpvTexture || addon
const sample = path.resolve(__dirname, 'assets/mpv-sample.mp4')
let frames = 0
let window

app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 640, height: 360 })
  process.stderr.write('[mpv-smoke-electron] before create\n')
  mpv.create({ headless: false, width: 640, height: 360, hwdec: 'no' })
  process.stderr.write('[mpv-smoke-electron] after create\n')
  mpv.onFrame((frame) => {
    if (frame?.pixels?.length === frame.width * frame.height * 4) frames++
  })
  mpv.onError((error) => process.stderr.write(`[mpv-smoke-electron] ${error}\n`))
  await mpv.load(sample)
  process.stderr.write('[mpv-smoke-electron] after load\n')
  const deadline = Date.now() + 10_000
  while (frames === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
  if (frames === 0) throw new Error('Electron native addon produced no software frames')
  process.stderr.write(`[mpv-smoke-electron] frames=${frames}\n`)
  mpv.destroy()
  window.destroy()
  app.exit(0)
}).catch((error) => {
  process.stderr.write(`[mpv-smoke-electron] failed: ${error?.stack || error}\n`)
  app.exit(1)
})
