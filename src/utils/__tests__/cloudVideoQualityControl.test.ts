import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const page = readFileSync(new URL('../../layout/PageVideo.vue', import.meta.url), 'utf8')
const removal = page.slice(page.indexOf('const safeRemoveArtControl'), page.indexOf('const safeRemoveArtSetting'))
const videoInfo = page.slice(page.indexOf('const getVideoInfo ='), page.indexOf('const playList ='))
const script = ts.transpile(`${removal}\n${videoInfo}\nreturn getVideoInfo`)

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
})
