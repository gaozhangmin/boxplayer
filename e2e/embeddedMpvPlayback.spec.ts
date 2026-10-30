import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http'
import { expect, test } from './fixtures/boxPlayer'
import { ALIYUN_MPV_PLAYBACK_HEADERS } from '../src/utils/playbackHeaders'

const bundleManifest = path.resolve('static/engine', process.platform, process.arch, 'mpv-texture/mpv-bundle-manifest.json')
// Source-built libmpv takes longer to initialize on the macOS x64 runner.
// Keep this above the longest player-surface wait so Playwright does not tear
// down Electron while the native player is still opening the authenticated URL.
test.setTimeout(180_000)
test.skip(!process.env.BOXPLAYER_MPV_REQUIRE_E2E && !existsSync(bundleManifest), 'Requires a local libmpv bundle for the host architecture')

const expectedCloudHeaders: Record<string, string> = {
  authorization: 'Bearer mpv-e2e-token',
  cookie: 'sid=mpv-e2e-cookie',
  'user-agent': 'BoxPlayer-MPV-E2E',
  referer: 'https://pan.example/',
  origin: 'https://pan.example',
  'x-urlp': '/signed/video.mp4'
}

async function startAuthenticatedMediaServer(expectedHeaders = expectedCloudHeaders): Promise<{ server: Server; url: string; received: () => IncomingHttpHeaders | undefined }> {
  const sample = readFileSync(path.resolve('e2e/assets/mpv-sample.mp4'))
  let receivedHeaders: IncomingHttpHeaders | undefined
  const server = createServer((request, response) => {
    receivedHeaders = request.headers
    const authorized = Object.entries(expectedHeaders).every(([key, value]) => request.headers[key] === value)
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

test('embedded MPV plays visible frames and forwards the authenticated cloud header contract', async ({ boxPlayer }) => {
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

  // Keep both playback checks in one Electron lifecycle. On slower macOS x64
  // runners the local proxy and native MPV teardown can outlive app.quit() by
  // a few seconds; launching a second app immediately could then close its
  // PageVideo window before the authenticated source finished loading.
  const authenticatedMedia = await startAuthenticatedMediaServer()
  try {
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
    await player.close()
  } finally {
    await new Promise<void>((resolve) => authenticatedMedia.server.close(() => resolve()))
  }
})

test('closing and reopening the MPV player does not crash Electron', async ({ boxPlayer }) => {
  const { app, page } = boxPlayer
  const authenticatedMedia = await startAuthenticatedMediaServer()
  const headers = Object.fromEntries(Object.entries(expectedCloudHeaders).map(([key, value]) => [key === 'user-agent' ? 'User-Agent' : key === 'x-urlp' ? 'x-urlp' : key[0].toUpperCase() + key.slice(1), value]))

  // Each preview close destroys the native context. The next open registers
  // new frame/status/error TSFNs and used to release stale handles a second
  // time, aborting the Electron main process in OnFrame().
  try {
    // Initialize the singleton from the main window, as a normal playback
    // session can do before opening a dedicated video preview window.
    const initialLoad = await page.evaluate((url) => window.WebMpvEmbeddedLoad({ url, title: 'MPV reopen setup' }), path.resolve('e2e/assets/mpv-sample.mp4'))
    expect(initialLoad.ok, initialLoad.error).toBe(true)
    expect((await page.evaluate(() => window.WebMpvEmbeddedControl({ action: 'stop' }))).ok).toBe(true)

    for (let attempt = 0; attempt < 3; attempt++) {
      const playerPromise = page.context().waitForEvent('page')
      await page.evaluate(({ mediaUrl, headers }) => window.WebOpenWindow({
        page: 'PageVideo',
        theme: 'dark',
        data: {
          user_id: 'mpv-reopen-e2e', tokenfrom: 'emby', drive_id: 'media_server', file_id: 'mpv-reopen-item',
          parent_file_id: 'mpv-reopen-library', file_name: 'mpv-sample.mp4', html: 'MPV reopen regression',
          encType: '', password: '', expire_time: 0, play_cursor: 0,
          media_url: mediaUrl, media_headers: headers,
          media_server_item_id: 'mpv-reopen-item', media_server_source_id: 'mpv-reopen-source',
          media_server_source_options: [{ id: 'mpv-reopen-source', label: 'Original' }], media_subtitle_sources: []
        }
      }), { mediaUrl: authenticatedMedia.url, headers })

      const player = await playerPromise
      await player.waitForSelector('#mpvEmbeddedPlayer.mpv-embedded-surface', { timeout: 90_000 })
      await expect.poll(async () => {
        const result = await player.evaluate(() => window.WebMpvEmbeddedStatus())
        return Boolean(result.ok && result.status?.duration > 0)
      }, { message: `MPV playback must start on open ${attempt + 1}`, timeout: 20_000 }).toBe(true)
      await player.close()
      expect(player.isClosed()).toBe(true)
      expect(app.process().exitCode).toBeNull()
    }
  } finally {
    await new Promise<void>((resolve) => authenticatedMedia.server.close(() => resolve()))
  }
})


test('MKV playback remains responsive through pause, resume and seek', async ({ boxPlayer }) => {
  const { page } = boxPlayer
  const videoPath = path.resolve('e2e/assets/boxplayer-e2e.mkv')
  const playerPromise = page.context().waitForEvent('page')
  await page.evaluate(({ videoPath, parentPath }) => window.WebOpenWindow({
    page: 'PageVideo', theme: 'dark', data: {
      user_id: 'e2e', tokenfrom: 'local', drive_id: 'local', file_id: videoPath,
      parent_file_id: parentPath, parent_file_name: 'assets', file_name: 'boxplayer-e2e.mkv', html: 'MKV responsiveness',
      encType: '', password: '', expire_time: 0, play_cursor: 0,
      custom_playlist: [{ user_id: 'e2e', drive_id: 'local', file_id: videoPath, parent_file_id: parentPath, file_name: 'boxplayer-e2e.mkv', html: 'MKV responsiveness' }]
    }
  }), { videoPath, parentPath: path.dirname(videoPath) })
  const player = await playerPromise
  const surface = player.locator('#mpvEmbeddedPlayer')
  await expect(surface).toBeVisible({ timeout: 30_000 })
  const status = () => player.evaluate(() => window.WebMpvEmbeddedStatus())
  await expect.poll(async () => (await status()).status?.position || 0, { timeout: 20_000 }).toBeGreaterThan(3)
  await surface.hover()
  await player.getByRole('button', { name: '暂停', exact: true }).click()
  await expect.poll(async () => (await status()).status?.paused, { timeout: 5_000 }).toBe(true)
  await player.getByRole('button', { name: '播放', exact: true }).click()
  await expect.poll(async () => (await status()).status?.position || 0, { timeout: 15_000 }).toBeGreaterThan(10)
  await surface.hover()
  const seek = player.getByRole('slider', { name: '播放进度' })
  const rect = await seek.boundingBox()
  expect(rect).not.toBeNull()
  await player.mouse.click(rect!.x + rect!.width * 0.72, rect!.y + rect!.height / 2)
  await expect.poll(async () => (await status()).status?.position || 0, { timeout: 8_000 }).toBeGreaterThan(14)
  await player.close()
})

test('MPV equalizers retain dragged values and settings fit the panel', async ({ boxPlayer }) => {
  const videoPath = path.resolve('e2e/assets/boxplayer-e2e.mkv')
  const playerPromise = boxPlayer.page.context().waitForEvent('page')
  await boxPlayer.page.evaluate(({ videoPath, parentPath }) => window.WebOpenWindow({
    page: 'PageVideo', theme: 'dark', data: {
      user_id: 'e2e', tokenfrom: 'local', drive_id: 'local', file_id: videoPath,
      parent_file_id: parentPath, parent_file_name: 'assets', file_name: 'boxplayer-e2e.mkv', html: 'MPV settings regression',
      encType: '', password: '', expire_time: 0, play_cursor: 0
    }
  }), { videoPath, parentPath: path.dirname(videoPath) })
  const player = await playerPromise
  try {
    await expect(player.locator('#mpvEmbeddedPlayer')).toBeVisible({ timeout: 30_000 })
    // This checks settings/track changes, not EOF handling. Keep the short
    // fixture loaded while slow CI runners exercise the controls.
    await expect.poll(async () => (await player.evaluate(() => window.WebMpvEmbeddedStatus())).status?.duration || 0, { timeout: 20_000 }).toBeGreaterThan(0)
    expect((await player.evaluate(() => window.WebMpvEmbeddedControl({ action: 'pause' }))).ok).toBe(true)
    await player.locator('#mpvEmbeddedPlayer').hover()
    await player.getByRole('button', { name: '设置', exact: true }).click()

    const dragAndHold = async (name: string, vertical = false) => {
      const slider = player.getByRole('slider', { name, exact: true })
      await slider.scrollIntoViewIfNeeded()
      const rect = (await slider.boundingBox())!
      await player.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
      await player.mouse.down()
      try {
        await player.mouse.move(rect.x + rect.width * (vertical ? 0.5 : 0.75), rect.y + rect.height * (vertical ? 0.25 : 0.5), { steps: 8 })
        const dragged = await slider.inputValue()
        expect(Number(dragged)).toBeGreaterThan(0)
        // Hold through status polling / Vue rerenders, without firing change.
        await player.waitForTimeout(1500)
        await expect(slider).toHaveValue(dragged)
      } finally {
        await player.mouse.up()
      }
    }

    await dragAndHold('亮度')
    await player.getByRole('button', { name: '音频', exact: true }).click()
    await dragAndHold('32 Hz 增益', true)
    await player.locator('.mpv-equalizer-grid').scrollIntoViewIfNeeded()
    const geometry = await player.locator('.mpv-equalizer-grid').evaluate(grid => {
      const bounds = grid.getBoundingClientRect()
      const content = grid.closest('.mpv-side-settings-content')!
      const panel = grid.closest('.mpv-side-panel')!.getBoundingClientRect()
      return {
        contained: [...grid.querySelectorAll('input, span')].every(element => {
          const rect = element.getBoundingClientRect()
          return rect.top >= bounds.top && rect.bottom <= bounds.bottom && rect.left >= bounds.left && rect.right <= bounds.right
        }),
        fitsPanel: bounds.bottom <= panel.bottom,
        horizontalOverflow: content.scrollWidth - content.clientWidth
      }
    })
    expect(geometry).toEqual({ contained: true, fitsPanel: true, horizontalOverflow: 0 })

    const colors = await player.locator('select[title="音轨"] option').first().evaluate(option => {
      const style = getComputedStyle(option)
      return { background: style.backgroundColor, text: style.color, scheme: getComputedStyle(option.parentElement!).colorScheme }
    })
    expect(colors).toEqual({ background: 'rgb(28, 29, 31)', text: 'rgb(241, 241, 241)', scheme: 'dark' })
    await player.locator('select[title="音轨"]').selectOption('2')
    await expect.poll(async () => (await player.evaluate(() => window.WebMpvEmbeddedStatus())).trackStatus?.audioId).toBe(2)
  } finally {
    await player.close()
  }
})

for (const closeWhileLoading of [false, true]) {
  test(`slow startup subtitles keep Electron responsive (${closeWhileLoading ? 'close while loading' : 'finish loading'})`, async ({ boxPlayer }) => {
    const waiting = new Set<ServerResponse>()
    const subtitle = readFileSync(path.resolve('e2e/assets/mpv-sample.srt'))
    let received = false
    let released = false
    const respond = (response: ServerResponse) => {
      response.writeHead(200, { 'content-type': 'application/x-subrip', 'content-length': subtitle.length })
      response.end(subtitle)
    }
    const server = createServer((_request, response) => {
      received = true
      if (released) return respond(response)
      waiting.add(response)
      response.once('close', () => waiting.delete(response))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Subtitle server failed to listen')
    const release = () => {
      released = true
      for (const response of waiting) respond(response)
      waiting.clear()
    }
    try {
      const videoPath = path.resolve('e2e/assets/boxplayer-e2e.mkv')
      const playerPromise = boxPlayer.page.context().waitForEvent('page')
      await boxPlayer.page.evaluate(({ videoPath, parentPath, subtitleUrl }) => window.WebOpenWindow({
        page: 'PageVideo', theme: 'dark', data: {
          user_id: 'e2e', tokenfrom: 'local', drive_id: 'local', file_id: videoPath,
          parent_file_id: parentPath, parent_file_name: 'assets', file_name: 'boxplayer-e2e.mkv', html: 'Slow subtitle regression',
          encType: '', password: '', expire_time: 0, play_cursor: 0,
          media_subtitle_sources: [{ url: subtitleUrl, title: 'Slow startup subtitle' }]
        }
      }), { videoPath, parentPath: path.dirname(videoPath), subtitleUrl: `http://127.0.0.1:${address.port}/slow.srt` })
      const player = await playerPromise
      await expect(player.locator('#mpvEmbeddedPlayer')).toBeVisible({ timeout: 30_000 })
      await expect.poll(() => received, { timeout: 15_000 }).toBe(true)
      // With synchronous sub-add the Cocoa/main event loop cannot service
      // even this ping until the test server releases the subtitle response.
      const responsive = await Promise.race([
        boxPlayer.app.evaluate(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2_000))
      ])
      expect(responsive, 'Electron main must respond while the subtitle download is pending').toBe(true)
      if (closeWhileLoading) {
        const closed = await Promise.race([
          player.close().then(() => true),
          new Promise<boolean>(resolve => setTimeout(() => resolve(false), 3_000))
        ])
        expect(closed, 'Closing playback must cancel the pending subtitle download').toBe(true)
        expect(await boxPlayer.app.evaluate(() => true)).toBe(true)
      } else {
        release()
        await expect.poll(async () => {
          const result = await player.evaluate(() => window.WebMpvEmbeddedStatus())
          return result.trackStatus?.tracks?.some((track: { type: string; external: boolean }) => track.type === 'sub' && track.external)
        }, { timeout: 10_000 }).toBe(true)
        await player.close()
      }
    } finally {
      release()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
}

// Exercise the actual Aliyun header path against libmpv itself, rather than
// only asserting the serialized loadfile string in a unit test.
test('embedded MPV sends actual Aliyun headers unchanged', async ({ boxPlayer }) => {
  const headers = Object.fromEntries(Object.entries(ALIYUN_MPV_PLAYBACK_HEADERS).map(([key, value]) => [key.toLowerCase(), value]))
  const media = await startAuthenticatedMediaServer(headers)
  try {
    const load = await boxPlayer.page.evaluate(({ url, headers }) =>
      window.WebMpvEmbeddedLoad({ url, headers, title: 'Aliyun header regression' }), { url: media.url, headers })
    expect(load.ok, load.error).toBe(true)
    await expect.poll(async () => {
      const result = await boxPlayer.page.evaluate(() => window.WebMpvEmbeddedStatus())
      return Boolean(result.ok && result.status?.duration > 0 && result.status?.position > 0)
    }, { timeout: 30_000 }).toBe(true)
    for (const [key, value] of Object.entries(headers)) expect(media.received()?.[key]).toBe(value)
  } finally {
    await boxPlayer.page.evaluate(() => window.WebMpvEmbeddedControl({ action: 'stop' })).catch(() => undefined)
    media.server.closeAllConnections()
    await new Promise<void>(resolve => media.server.close(() => resolve()))
  }
})
