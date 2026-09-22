import path from 'node:path'
import { existsSync } from 'node:fs'
import { expect, test } from './fixtures/boxPlayer'

const bundleManifest = path.resolve('static/engine', process.platform, process.arch, 'mpv-texture/mpv-bundle-manifest.json')
test.setTimeout(60_000)
test.skip(!process.env.BOXPLAYER_MPV_REQUIRE_E2E && !existsSync(bundleManifest), 'Requires a local libmpv bundle for the host architecture')

test('embedded MPV plays visible frames from a local video in the production Electron app', async ({ boxPlayer }) => {
  const { page } = boxPlayer
  boxPlayer.app.process().once('exit', (code, signal) => {
    console.error(`Embedded MPV Electron process exited: code=${code}, signal=${signal}`)
  })
  page.once('close', () => console.error('Embedded MPV renderer window closed during test'))
  page.once('crash', () => console.error('Embedded MPV renderer process crashed during test'))
  const sample = path.resolve('e2e/assets/mpv-sample.mp4')
  const capability = await page.evaluate(() => window.WebMpvEmbeddedCapability())
  expect(capability.enabled, capability.reason).toBe(true)

  await page.evaluate(() => {
    ;(window as any).__mpvFrameCount = 0
    ;(window as any).__mpvVisibleSoftwareFrame = false
    window.WebMpvSharedTexture.onFrame((frame) => {
      ;(window as any).__mpvFrameCount++
      frame.close()
    })
    window.WebMpvSharedTexture.onSoftwareFrame((pixels, width, height) => {
      if (pixels.length !== width * height * 4) return
      ;(window as any).__mpvFrameCount++
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) return
      context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0)
      const sample = context.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data
      if (sample[3] === 255 && (sample[0] !== 0 || sample[1] !== 0 || sample[2] !== 0)) {
        ;(window as any).__mpvVisibleSoftwareFrame = true
      }
    })
  })

  const load = await page.evaluate((url) => window.WebMpvEmbeddedLoad({ url, title: 'MPV E2E sample' }), sample)
  expect(load.ok, load.error).toBe(true)

  await expect.poll(async () => {
    const result = await page.evaluate(() => window.WebMpvEmbeddedStatus())
    return Boolean(result.ok && result.status?.duration > 0 && result.status?.position > 0)
  }, { timeout: 15_000 }).toBe(true)

  await expect.poll(() => page.evaluate(() => (window as any).__mpvFrameCount), { timeout: 15_000 }).toBeGreaterThan(0)
  if (process.platform !== 'darwin') {
    await expect.poll(() => page.evaluate(() => (window as any).__mpvVisibleSoftwareFrame), { timeout: 15_000 }).toBe(true)
  }

  const stop = await page.evaluate(() => window.WebMpvEmbeddedControl({ action: 'stop' }))
  expect(stop.ok, stop.error).toBe(true)
})
