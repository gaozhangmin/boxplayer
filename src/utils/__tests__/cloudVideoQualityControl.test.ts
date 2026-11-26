import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { findOriginFallbackTranscodedQuality, isOriginVideoQuality } from '../videoQualitySwitch'

const page = readFileSync(new URL('../../layout/PageVideo.vue', import.meta.url), 'utf8')
const removal = page.slice(page.indexOf('const safeRemoveArtControl'), page.indexOf('const safeRemoveArtSetting'))
const videoInfo = page.slice(page.indexOf('const getVideoInfo ='), page.indexOf('const playList ='))
const script = ts.transpile(`${removal}\n${videoInfo}\nreturn getVideoInfo`)

const artTypeHelpers = page.slice(page.indexOf('const getArtVideoType ='), page.indexOf('const resolveHeaderAwareVideoUrl ='))
const fallbackHelper = page.slice(page.indexOf('const tryFallbackOriginVideoQuality ='), page.indexOf('const initEvent ='))
const videoErrorRegistration = page.slice(page.indexOf("  art.on('video:error'"), page.indexOf("  art.on('ready'"))

describe('Cloud video quality control', () => {
  it.each([false, true])('resolves and loads a single-quality video with an existing control: %s', async (existing) => {
    const cache = new Map(existing ? [['quality', {}]] : [])
    const controls = {
      cache,
      remove: vi.fn((name: string) => {
        if (!cache.delete(name)) throw new Error(`Can't find [${name}] from the [control]`)
      }),
      update: vi.fn(),
    }
    const getRawUrl = vi.fn(async () => ({ qualities: [{ quality: 'Origin', url: 'https://example.invalid/video.mp4' }] }))
    const setArtVideoUrl = vi.fn()
    const ports = {
      pageVideo: { drive_id: 'aliyun', user_id: 'account', file_id: 'video' },
      getRawUrl,
      setArtVideoUrl,
      useSettingStore: () => ({ uiVideoQuality: 'Origin' }),
      mergePlaybackHeaders: () => ({}),
      resolveHeaderAwareVideoUrl: (url: string) => url,
      GetExpiresTime: () => 0,
      getSubTitleList: async () => {},
      tryAutomaticSubtitleDownload: async () => {},
    }
    const getVideoInfo = new Function(...Object.keys(ports), script)(...Object.values(ports))
    const art = { controls }
    await getVideoInfo(art)
    expect(getRawUrl).toHaveBeenCalledOnce()
    expect(setArtVideoUrl).toHaveBeenCalledWith(art, 'https://example.invalid/video.mp4', undefined)
    expect(controls.remove).toHaveBeenCalledTimes(existing ? 1 : 0)
    expect(controls.update).not.toHaveBeenCalled()
  })

  it('selects the highest transcoded HLS fallback when Origin fails', () => {
    expect(isOriginVideoQuality({ quality: 'Origin', html: '原画' })).toBe(true)
    expect(isOriginVideoQuality({ quality: '100', html: '原画' })).toBe(true)
    expect(isOriginVideoQuality({ quality: 'FHD', html: '全高清 1080p' })).toBe(false)

    const isHls = (item: { url: string; type?: string }) => item.type === 'm3u8' || item.url.includes('.m3u8')
    const unordered = [
      { quality: 'Origin', html: '原画', url: 'https://cdn.test/video.mp4', type: '' },
      { quality: 'HD', html: '高清 720P', width: 1280, height: 720, url: 'https://cdn.test/720.m3u8', type: 'm3u8' },
      { quality: 'QHD', html: '超高清 2560p', width: 2560, height: 1440, url: 'https://cdn.test/1440.m3u8', type: 'm3u8' },
      { quality: 'FHD', html: '全高清 1080p', width: 1920, height: 1080, url: 'https://cdn.test/1080.m3u8', type: 'm3u8' }
    ]
    expect(findOriginFallbackTranscodedQuality(unordered, isHls)?.quality).toBe('QHD')

    const drive115 = [
      { quality: '100', html: '原画', url: 'https://cdn.test/raw.mp4', type: '' },
      { quality: '4', html: '1080P', width: 1920, height: 1080, url: 'https://cdn.test/4.m3u8', type: 'm3u8' },
      { quality: '5', html: '4K', width: 3840, height: 2160, url: 'https://cdn.test/5.m3u8', type: 'm3u8' }
    ]
    expect(findOriginFallbackTranscodedQuality(drive115, isHls)?.quality).toBe('5')

    const originOnly = [{ quality: 'Origin', html: '原画', url: 'https://cdn.test/video.mp4', type: '' }]
    expect(findOriginFallbackTranscodedQuality(originOnly, isHls)).toBeUndefined()
  })

  it('auto-falls back once from failed Origin MP4 to highest transcoded HLS in PageVideo before showing unsupportedMediaType', async () => {
    const combinedScript = ts.transpile(`
      ${removal}
      ${artTypeHelpers}
      ${videoInfo}
      ${fallbackHelper}
      const registerVideoError = (art: any) => {
        ${videoErrorRegistration}
      }
      return { getVideoInfo, registerVideoError }
    `)

    const originUrl = 'https://cdn.test/video.mp4'
    const fhdUrl = 'https://cdn.test/1080p.m3u8'
    const hdUrl = 'https://cdn.test/720p.m3u8'
    let rawQualities: any[] = []
    const getRawUrl = vi.fn(async () => ({ qualities: rawQualities, headers: { Referer: 'https://pan.test/' }, size: 1024 }))
    const setArtVideoUrl = vi.fn()
    const cache = new Map<string, any>()
    const controls = {
      cache,
      remove: vi.fn((name: string) => { cache.delete(name) }),
      update: vi.fn((opt: any) => { cache.set(opt.name, opt) })
    }
    const notice = { show: '' }
    let errorHandler: (() => void) | undefined
    const art: any = {
      controls,
      notice,
      option: { url: '' },
      on: (event: string, fn: () => void) => {
        if (event === 'video:error') errorHandler = fn
      }
    }
    const ports = {
      pageVideo: { drive_id: 'aliyun', user_id: 'account', file_id: 'video', file_name: 'sample.mp4' },
      getRawUrl,
      setArtVideoUrl,
      useSettingStore: () => ({ uiVideoQuality: 'Origin' }),
      mergePlaybackHeaders: (base: any, specific: any) => ({ ...(base || {}), ...(specific || {}) }),
      resolveHeaderAwareVideoUrl: (url: string) => url,
      GetExpiresTime: () => 0,
      getSubTitleList: async () => {},
      tryAutomaticSubtitleDownload: async () => {},
      isOriginVideoQuality,
      findOriginFallbackTranscodedQuality,
      t: (key: string) => key === 'video.unsupportedMediaType' ? '不支持当前媒体类型' : key,
      captureVideoQualitySwitchPlaybackState: () => ({ shouldResume: false, position: 0 }),
      destroyArtHls: () => {},
      destroyArtDash: () => {},
      destroyArtFlv: () => {},
      scheduleCleanupInactiveStreamingControls: () => {},
      playbackRate: 1,
      qualitySwitchGeneration: 0,
      console: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    }
    const { getVideoInfo, registerVideoError } = new Function(...Object.keys(ports), combinedScript)(...Object.values(ports))
    registerVideoError(art)
    const triggerError = () => errorHandler?.()

    // 1) Multi-quality Origin + transcoded HLS: first error falls back once to FHD m3u8; second error shows notice.
    rawQualities = [
      { quality: 'Origin', html: '原画', url: originUrl, type: '' },
      { quality: 'HD', html: '高清 720P', width: 1280, height: 720, url: hdUrl, type: 'm3u8' },
      { quality: 'FHD', html: '全高清 1080p', width: 1920, height: 1080, url: fhdUrl, type: 'm3u8' }
    ]
    await getVideoInfo(art)
    expect(setArtVideoUrl).toHaveBeenLastCalledWith(art, originUrl, '')

    triggerError()
    expect(setArtVideoUrl).toHaveBeenCalledTimes(2)
    expect(setArtVideoUrl).toHaveBeenLastCalledWith(art, fhdUrl, 'm3u8')
    expect(art.option.url).toBe(fhdUrl)
    expect(notice.show).toBe('')
    expect(rawQualities.map((q) => q.default)).toEqual([false, false, true])
    expect(controls.update).toHaveBeenCalledTimes(2)

    triggerError()
    expect(setArtVideoUrl).toHaveBeenCalledTimes(2)
    expect(notice.show).toBe('不支持当前媒体类型')

    // 2) Next video with Origin-only does not reuse prior qualities and immediately shows unsupported notice.
    notice.show = ''
    rawQualities = [{ quality: 'Origin', html: '原画', url: 'https://cdn.test/only-origin.mp4', type: '' }]
    await getVideoInfo(art)
    triggerError()
    expect(setArtVideoUrl).toHaveBeenCalledTimes(3)
    expect(notice.show).toBe('不支持当前媒体类型')
  })

  it('aligns SettingPlay default player popover copy with settingstore default mpv', () => {
    const settingPlay = readFileSync(new URL('../../setting/SettingPlay.vue', import.meta.url), 'utf8')
    const settingStore = readFileSync(new URL('../../setting/settingstore.ts', import.meta.url), 'utf8')
    expect(settingStore).toContain("uiVideoPlayer: 'mpv'")
    expect(settingPlay).toContain("默认：<span class='opred'>内置 MPV 播放器</span>")
    expect(settingPlay).not.toContain("默认：<span class='opred'>内置网页播放器</span>")
  })
})
