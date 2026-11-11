import type { IPageVideo } from '../store/appstore'
import useSettingStore from '../setting/settingstore'
import PlayerUtils from './playerhelper'
import message from './message'

/** Route local and already-resolved server videos through the selected player. */
export async function openVideoPage(options: { page: string; data: IPageVideo; theme?: string }): Promise<void> {
  const settings = useSettingStore()
  const page = options.data
  if (settings.uiVideoPlayer !== 'other') {
    window.WebOpenWindow(options)
    return
  }
  const url = page.drive_id === 'local' ? page.file_id : page.media_url
  if (!url) {
    message.error('视频地址解析失败，操作取消')
    return
  }
  try {
    await PlayerUtils.startPlayer({ user_id: page.user_id } as any, settings.uiVideoPlayerPath.trim(), {
      resolvedSource: true,
      playCursor: page.play_cursor,
      subtitleUrl: settings.uiVideoSubtitleMode === 'close' ? '' : page.media_subtitle_sources?.[0]?.url || '',
      file: { name: page.file_name, drive_id: page.drive_id, file_id: page.file_id },
      rawData: { qualities: [{ quality: 'Origin', url, headers: page.media_headers || {} }] },
      quality: 'Origin'
    })
  } catch (error: any) {
    message.error(`播放器启动失败：${error.message || String(error)}`)
  }
}
