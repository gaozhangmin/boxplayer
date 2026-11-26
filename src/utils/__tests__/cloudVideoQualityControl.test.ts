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
    const defineArtSelectorProps = (selector: any[]) => {
      for (const item of selector) {
        Object.defineProperty(item, '$control_option', { get: () => selector })
        Object.defineProperty(item, '$control_item', { get: () => ({}) })
        Object.defineProperty(item, '$control_value', { get: () => ({}) })
      }
    }
    const controls = {
      cache,
      remove: vi.fn((name: string) => { cache.delete(name) }),
      update: vi.fn((opt: any) => {
        if (cache.has(opt.name)) cache.delete(opt.name)
        if (Array.isArray(opt.selector)) defineArtSelectorProps(opt.selector)
        cache.set(opt.name, opt)
      })
    }
    const notice = { show: '' }
    const loading = { show: false }
    const listeners = new Map<string, Array<() => void>>()
    const art: any = {
      controls,
      notice,
      loading,
      option: { url: '' },
      on: (event: string, fn: () => void) => {
        listeners.set(event, [...(listeners.get(event) || []), fn])
      },
      emit: (event: string) => {
        for (const fn of listeners.get(event) || []) fn()
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
    const triggerError = () => art.emit('video:error')

    // 1) Multi-quality Origin + transcoded HLS: first error falls back once to FHD m3u8; repeated updateQualityControl() succeeds with cloned selector objects; second error shows notice.
    rawQualities = [
      { quality: 'Origin', html: '原画', url: originUrl, type: '' },
      { quality: 'HD', html: '高清 720P', width: 1280, height: 720, url: hdUrl, type: 'm3u8' },
      { quality: 'FHD', html: '全高清 1080p', width: 1920, height: 1080, url: fhdUrl, type: 'm3u8' }
    ]
    await getVideoInfo(art)
    expect(setArtVideoUrl).toHaveBeenLastCalledWith(art, originUrl, undefined)

    triggerError()
    expect(setArtVideoUrl).toHaveBeenCalledTimes(2)
    expect(setArtVideoUrl).toHaveBeenLastCalledWith(art, fhdUrl, 'm3u8')
    expect(art.option.url).toBe(fhdUrl)
    expect(notice.show).toBe('')
    expect(rawQualities.map((q) => q.default)).toEqual([false, false, true])
    expect(controls.update).toHaveBeenCalledTimes(2)
    expect(controls.cache.get('quality').selector.map((q: any) => q.default)).toEqual([false, false, true])

    // Simulated delayed Artplayer reconnect error after active HLS stream took over clears stale notice & spinner.
    art.hls = {}
    art.__hlsSourceUrl = fhdUrl
    notice.show = 'Reconnect: 1'
    loading.show = true
    art.emit('error')
    expect(notice.show).toBe('')
    expect(loading.show).toBe(false)

    triggerError()
    expect(setArtVideoUrl).toHaveBeenCalledTimes(2)
    expect(notice.show).toBe('不支持当前媒体类型')

    // 2) Next video with Origin-only does not reuse prior qualities and immediately shows unsupported notice.
    notice.show = ''
    delete art.hls
    delete art.__hlsSourceUrl
    rawQualities = [{ quality: 'Origin', html: '原画', url: 'https://cdn.test/only-origin.mp4', type: '' }]
    await getVideoInfo(art)
    triggerError()
    expect(setArtVideoUrl).toHaveBeenCalledTimes(3)
    expect(notice.show).toBe('不支持当前媒体类型')
  })

  it('preserves m3u8 stream type from unproxied URLs when header proxy omits extension and type', async () => {
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
    const rawM3u8Url = 'https://cdn.test/transcoded/master.m3u8?token=abc'
    const proxiedOrigin = 'http://127.0.0.1:29384/proxy?quality=Origin'
    const proxiedM3u8 = 'http://127.0.0.1:29384/proxy?quality=FHD'
    const rawQualities = [
      { quality: 'Origin', html: '原画', url: originUrl, type: '' },
      { quality: 'FHD', html: '全高清 1080p', width: 1920, height: 1080, url: rawM3u8Url, type: '' }
    ]
    const setArtVideoUrl = vi.fn()
    const cache = new Map<string, any>()
    const controls = {
      cache,
      remove: vi.fn((name: string) => { cache.delete(name) }),
      update: vi.fn((opt: any) => {
        if (cache.has(opt.name)) cache.delete(opt.name)
        if (Array.isArray(opt.selector)) {
          for (const item of opt.selector) {
            Object.defineProperty(item, '$control_option', { get: () => opt.selector })
          }
        }
        cache.set(opt.name, opt)
      })
    }
    const listeners = new Map<string, Array<() => void>>()
    const art: any = {
      controls,
      notice: { show: '' },
      loading: { show: false },
      option: { url: '' },
      on: (event: string, fn: () => void) => {
        listeners.set(event, [...(listeners.get(event) || []), fn])
      },
      emit: (event: string) => {
        for (const fn of listeners.get(event) || []) fn()
      }
    }
    let uiVideoQuality = 'Origin'
    const ports = {
      pageVideo: { drive_id: 'aliyun', user_id: 'account', file_id: 'video', file_name: 'sample.mp4' },
      getRawUrl: vi.fn(async () => ({ qualities: rawQualities, headers: { Cookie: 'a=1' }, size: 1024 })),
      setArtVideoUrl,
      useSettingStore: () => ({ uiVideoQuality }),
      mergePlaybackHeaders: (base: any, specific: any) => ({ ...(base || {}), ...(specific || {}) }),
      resolveHeaderAwareVideoUrl: (url: string, _headers: any, _size: number, quality: string) =>
        quality === 'Origin' ? proxiedOrigin : proxiedM3u8,
      GetExpiresTime: () => 0,
      getSubTitleList: async () => {},
      tryAutomaticSubtitleDownload: async () => {},
      isOriginVideoQuality,
      findOriginFallbackTranscodedQuality,
      t: (key: string) => key,
      captureVideoQualitySwitchPlaybackState: () => ({ shouldResume: false, position: 0 }),
      destroyArtHls: () => {},
      destroyArtDash: () => {},
      destroyArtFlv: () => {},
      scheduleCleanupInactiveStreamingControls: () => {},
      playbackRate: 1,
      qualitySwitchGeneration: 0,
      resolvePreferredVideoQuality: (qualities: any[], pref: string) => qualities.find((q) => q.quality === pref) || qualities[0],
      console: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    }
    const { getVideoInfo, registerVideoError } = new Function(...Object.keys(ports), combinedScript)(...Object.values(ports))
    registerVideoError(art)

    await getVideoInfo(art)
    expect(setArtVideoUrl).toHaveBeenLastCalledWith(art, proxiedOrigin, undefined)

    art.emit('video:error')
    expect(setArtVideoUrl).toHaveBeenLastCalledWith(art, proxiedM3u8, 'm3u8')

    // Also when initial preference selects the proxied m3u8 directly without explicit type:
    uiVideoQuality = 'FHD'
    await getVideoInfo(art)
    expect(setArtVideoUrl).toHaveBeenLastCalledWith(art, proxiedM3u8, 'm3u8')
  })

  it('aligns SettingPlay default player popover copy with settingstore default mpv', () => {
    const settingPlay = readFileSync(new URL('../../setting/SettingPlay.vue', import.meta.url), 'utf8')
    const settingStore = readFileSync(new URL('../../setting/settingstore.ts', import.meta.url), 'utf8')
    expect(settingStore).toContain("uiVideoPlayer: 'mpv'")
    expect(settingPlay).toContain("默认：<span class='opred'>内置 MPV 播放器</span>")
    expect(settingPlay).not.toContain("默认：<span class='opred'>内置网页播放器</span>")
  })
})
