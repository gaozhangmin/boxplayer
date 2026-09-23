import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { expect, test } from './fixtures/boxPlayer'

const bundleManifest = path.resolve('static/engine', process.platform, process.arch, 'mpv-texture/mpv-bundle-manifest.json')
test.setTimeout(60_000)
test.skip(!process.env.BOXPLAYER_MPV_REQUIRE_E2E && !existsSync(bundleManifest), 'Requires a local libmpv bundle for the host architecture')

const expectedCloudHeaders: Record<string, string> = {
  authorization: 'Bearer mpv-e2e-token',
  cookie: 'sid=mpv-e2e-cookie',
  'user-agent': 'BoxPlayer-MPV-E2E',
  referer: 'https://pan.example/',
  origin: 'https://pan.example',
  'x-urlp': '/signed/video.mp4'
}

async function startAuthenticatedMediaServer(): Promise<{ server: Server; url: string; received: () => IncomingHttpHeaders | undefined }> {
  const sample = readFileSync(path.resolve('e2e/assets/mpv-sample.mp4'))
  let receivedHeaders: IncomingHttpHeaders | undefined
  const server = createServer((request, response) => {
    receivedHeaders = request.headers
    const authorized = Object.entries(expectedCloudHeaders).every(([key, value]) => request.headers[key] === value)
    if (!authorized) {
      response.writeHead(403, { 'content-type': 'text/plain' })
      response.end('missing cloud playback headers')
      return
    }

    const range = String(request.headers.range || '')
    const match = /^bytes=(\d+)-(\d*)$/.exec(range)
    if (match) {
      const start = Number(match[1])
      const end = match[2] ? Math.min(Number(match[2]), sample.length - 1) : sample.length - 1
      response.writeHead(206, {
        'accept-ranges': 'bytes',
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${sample.length}`,
        'content-type': 'video/mp4'
      })
      response.end(sample.subarray(start, end + 1))
      return
    }

    response.writeHead(200, {
      'accept-ranges': 'bytes',
      'content-length': String(sample.length),
      'content-type': 'video/mp4'
    })
    response.end(request.method === 'HEAD' ? undefined : sample)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Authenticated media server did not bind a TCP port')
  return { server, url: `http://127.0.0.1:${address.port}/signed/video.mp4`, received: () => receivedHeaders }
}

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

test('PageVideo MPV forwards the complete authenticated cloud header contract', async ({ boxPlayer }) => {
  const authenticatedMedia = await startAuthenticatedMediaServer()
  try {
    const { page } = boxPlayer
    const capability = await page.evaluate(() => window.WebMpvEmbeddedCapability())
    expect(capability.enabled, capability.reason).toBe(true)

    const playerPromise = page.context().waitForEvent('page')
    await page.evaluate(({ mediaUrl, headers }) => window.WebOpenWindow({
      page: 'PageVideo',
      theme: 'dark',
      data: {
        user_id: 'mpv-e2e-user',
        tokenfrom: 'emby',
        drive_id: 'media_server',
        file_id: 'mpv-e2e-item',
        parent_file_id: 'mpv-e2e-library',
        file_name: 'authenticated.mp4',
        html: 'Authenticated MPV E2E',
        encType: '',
        password: '',
        expire_time: 0,
        play_cursor: 0,
        media_url: mediaUrl,
        media_headers: headers,
        media_server_item_id: 'mpv-e2e-item',
        media_server_source_id: 'mpv-e2e-source',
        media_server_source_options: [{ id: 'mpv-e2e-source', label: 'Original' }],
        media_subtitle_sources: []
      }
    }), { mediaUrl: authenticatedMedia.url, headers: Object.fromEntries(Object.entries(expectedCloudHeaders).map(([key, value]) => [key === 'user-agent' ? 'User-Agent' : key === 'x-urlp' ? 'x-urlp' : key[0].toUpperCase() + key.slice(1), value])) })

    const player = await playerPromise
    await player.waitForSelector('#mpvEmbeddedPlayer.mpv-embedded-surface', { timeout: 90_000 })
    await expect.poll(async () => {
      const status = await player.evaluate(() => window.WebMpvEmbeddedStatus())
      return Boolean(status.ok && status.status?.duration > 0)
    }, { timeout: 20_000 }).toBe(true)
    await expect.poll(() => authenticatedMedia.received()?.authorization, { timeout: 10_000 }).toBe(expectedCloudHeaders.authorization)
    for (const [key, value] of Object.entries(expectedCloudHeaders)) expect(authenticatedMedia.received()?.[key]).toBe(value)
  } finally {
    await new Promise<void>((resolve) => authenticatedMedia.server.close(() => resolve()))
  }
})
