<script setup lang='ts'>
import { KeyboardState, useAppStore, useKeyboardStore, usePanFileStore, useSettingStore } from '../store'
import { useMediaLibraryStore } from '../store/medialibrary'
import type { MediaLibraryItem } from '../types/media'
import { computed, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Button, Input, Modal, Option as AOption, Select } from '@arco-design/web-vue'
import Artplayer from 'artplayer'
import HlsJs from 'hls.js'
import * as dashjs from 'dashjs'
import AliFile from '../aliapi/file'
import DriveFile from '../drive/file'
import AliDirFileList from '../aliapi/dirfilelist'
import levenshtein from 'fast-levenshtein'
import type { SettingOption } from 'artplayer/types/setting'
import type { Option } from 'artplayer/types/option'
import AliFileCmd from '../aliapi/filecmd'
import PlayerUtils from '../utils/playerhelper'
import { getEncType, getProxyUrl, getRawUrl, IRawUrl } from '../utils/proxyhelper'
import { TestAlt, TestKey } from '../utils/keyboardhelper'
import { GetExpiresTime } from '../utils/utils'
import artplayerPluginDanmuku from 'artplayer-plugin-danmuku'
import type { Danmu } from 'artplayer-plugin-danmuku'
import artplayerPluginChapter from 'artplayer-plugin-chapter'
import artplayerPluginDashControl from 'artplayer-plugin-dash-control'
import artplayerPluginHlsControl from 'artplayer-plugin-hls-control'
import artplayerPluginJassub from 'artplayer-plugin-jassub'
import artplayerPluginMultipleSubtitles from 'artplayer-plugin-multiple-subtitles'
import JASSUBWorker from 'jassub/dist/jassub-worker.js?url'
import JASSUBWorkerWasm from 'jassub/dist/jassub-worker.wasm?url'
import JASSUBWorkerModernWasm from 'jassub/dist/jassub-worker-modern.wasm?url'
import JASSUBDefaultFont from 'jassub/dist/default.woff2?url'
import JASSUBCjkFont from '../assets/fonts/NotoSansCJKsc-Regular.otf?url'
import {
  autoMatchDanmaku,
  buildDanmakuPluginOption,
  getBangumiDetail,
  loadDanmakuComments,
  searchAnime
} from '../utils/danmakuApi'
import type { DanmakuApiConfig, DanmakuEpisode, DanmakuSearchAnime } from '../utils/danmakuApi'
import {
  formatSubtitleDownloadCount,
  decodeSubtitleBuffer,
  getSubtitleDownload,
  getSubtitleExtension,
  searchSubtitles
} from '../utils/subtitleApi'
import type { SubtitleSearchFormat, SubtitleSearchResult } from '../utils/subtitleApi'
import { dedupeSubtitleSelectors, hasSubtitleSource } from '../utils/subtitleSelector'
import { formatEmbeddedSubtitleLabel } from '../utils/subtitleLanguage'
import { resolveFullscreenModalContainer } from '../utils/fullscreenModal'
import { updateSettingPreservingActivePanel } from '../utils/artplayerSetting'
import message from '../utils/message'
import { captureVideoQualitySwitchPlaybackState } from '../utils/videoQualitySwitch'
import { hasPlaybackHeaders, mergeMpvPlaybackHeaders, mergePlaybackHeaders } from '../utils/playbackHeaders'
import { getLocalVideoProgress, saveLocalVideoProgress } from '../utils/videoProgress'
import { isVideoFile } from '../utils/videoFile'
import { simpleToTradition, traditionToSimple } from 'chinese-simple2traditional'
import path from 'path'
import UserDAL from '../user/userdal'
import Config from '../config'
import { isBoxUser, isDropboxUser, isOneDriveUser, isQuarkUser } from '../aliapi/utils'
import { listProviderItems } from '../drive/providerList'
import { resolveDriveProvider } from '../utils/driveProvider'
import { getWebDavConnection, getWebDavConnectionId, isWebDavDrive, listWebDavDirectory } from '../utils/webdavClient'
import useMediaServerRegistryStore from '../store/mediaServerRegistry'
import MpvEmbeddedSurface from '../components/MpvEmbeddedSurface.vue'
import { t, useLocale } from '../i18n'
import {
  getMediaServerItemDetail,
  getMediaServerPlaybackInfo,
  reportMediaServerPlaybackProgress,
  reportMediaServerPlaybackStart,
  reportMediaServerPlaybackStop
} from '../media-server/contentGateway'

let jassubCjkFontData: Uint8Array | undefined

const getJassubCjkFont = async (): Promise<Uint8Array | undefined> => {
  if (jassubCjkFontData) return jassubCjkFontData
  try {
    const response = await fetch(JASSUBCjkFont)
    if (!response.ok) return undefined
    const data = new Uint8Array(await response.arrayBuffer())
    if (data.byteLength > 0) jassubCjkFontData = data
    return jassubCjkFontData
  } catch {
    return undefined
  }
}

const appStore = useAppStore()
const mediaStore = useMediaLibraryStore()
const mediaServerRegistry = useMediaServerRegistryStore()
const pageVideo = appStore.pageVideo!
const locale = useLocale()
const isTop = ref(false)
let autoPlayNumber = 0
let lastPlayNumber = -1
let playbackRate = 1
let longPressSpeed = 1
let qualitySwitchGeneration = 0
let ArtPlayerRef: Artplayer
let mediaServerReportStarted = false
let mediaServerStopReported = false
let mediaServerLastProgressSecond = -1
let pendingMediaServerSeekTime: number | null = null
const mediaServerControlNames = new Set<string>()
let danmakuAutoLoadingKey = ''
let danmakuAutoLoadedKey = ''
let activeSearchModal: { close: () => void } | undefined
const useMacEmbeddedMpv = useSettingStore().uiVideoPlayer === 'mpv'
const mpvEmbeddedUrl = ref('')
const mpvEmbeddedHeaders = ref<Record<string, string>>({})
const mpvEmbeddedError = ref('')
const mpvEmbeddedStatus = ref<any>(null)
const mpvEmbeddedStartPosition = ref(0)
const mpvEmbeddedQualityLabel = ref('')
const mpvEmbeddedQuality = ref('')
const mpvEmbeddedQualities = ref<selectorItem[]>([])
const mpvEmbeddedSubtitleSources = ref<Array<{ url: string; title?: string; streamIndex?: number }>>([])
const mpvPlaylistReady = ref(false)


const updateWindowTitle = (name?: string) => {
  document.title = name || pageVideo.file_name || t('video.onlinePreview')
}

const applyPendingMediaServerSeek = async (art: Artplayer) => {
  if (pendingMediaServerSeekTime == null) return
  const nextTime = pendingMediaServerSeekTime
  pendingMediaServerSeekTime = null
  if (nextTime <= 0) return
  try {
    art.currentTime = nextTime
  } catch (error) {
    console.warn('媒体服务器切换后恢复播放进度失败:', error)
  }
}

const keyboardStore = useKeyboardStore()
keyboardStore.$subscribe((_m: any, state: KeyboardState) => {
  if (TestAlt('f4', state.KeyDownEvent, handleHideClick)) return
  if (TestAlt('m', state.KeyDownEvent, handleMinClick)) return
  if (TestAlt('enter', state.KeyDownEvent, handleMaxClick)) return
  if (TestKey('f11', state.KeyDownEvent, handleMaxClick)) return
  if (TestKey('t', state.KeyDownEvent, handleTop)) return
})

const onKeyDown = (event: KeyboardEvent) => {
  const ele = (event.srcElement || event.target) as any
  const nodeName = ele && ele.nodeName
  if (document.body.getElementsByClassName('arco-modal-container').length) return
  if (event.key == 'Control' || event.key == 'Shift' || event.key == 'Alt' || event.key == 'Meta') return
  const isInput = nodeName == 'INPUT' || nodeName == 'TEXTAREA' || false
  if (!isInput) {
    keyboardStore.KeyDown(event)
  }
}
const options: Option = {
  id: 'artPlayer',
  container: '#artPlayer',
  url: '',
  volume: 1,
  backdrop: false,
  autoSize: false,
  autoMini: true,
  loop: false,
  flip: true,
  playbackRate: true,
  aspectRatio: true,
  setting: true,
  hotkey: true,
  pip: true,
  airplay: true,
  mutex: true,
  fullscreen: true,
  fullscreenWeb: false,
  subtitleOffset: false,
  screenshot: true,
  miniProgressBar: false,
  subtitle: {
    escape: false
  },
  playsInline: true,
  moreVideoAttr: {
    // @ts-ignore
    'webkit-playsinline': true,
    playsInline: true
  },
  customType: {
    m3u8: (video: HTMLMediaElement, url: string, art: Artplayer) => playByHls(video, url, art),
    ts: (video: HTMLMediaElement, url: string, art: Artplayer) => playByHls(video, url, art),
    mpd: (video: HTMLMediaElement, url: string, art: Artplayer) => playByDash(video, url, art)
  }
}

const refreshMediaServerPlayback = async (
  art: Artplayer,
  sourceId = '',
  videoStreamIndex = -1,
  audioStreamIndex = -1,
  subtitleStreamIndex = -1,
  forceCompatiblePlayback = false
) => {
  mediaServerRegistry.ensureLoaded()
  const serverId = pageVideo.media_server_id || ''
  const itemId = pageVideo.media_server_item_id || pageVideo.file_id || ''
  if (!serverId || !itemId) {
    art.notice.show = t('video.mediaServerPlaybackIncomplete')
    return
  }
  const server = mediaServerRegistry.servers.find((item) => item.id === serverId)
  if (!server) {
    art.notice.show = t('video.mediaServerMissing')
    return
  }
  const playback = await getMediaServerPlaybackInfo(
    server,
    itemId,
    sourceId || pageVideo.media_server_source_id || '',
    videoStreamIndex,
    audioStreamIndex,
    subtitleStreamIndex,
    useSettingStore().uiMediaServerVideoQuality,
    forceCompatiblePlayback && useSettingStore().uiMediaServerCompatibilityMode !== 'directPlay'
      ? 'mostCompatible'
      : useSettingStore().uiMediaServerCompatibilityMode,
    useSettingStore().uiMediaServerCustomDeviceProfile,
    useSettingStore().uiMediaServerBitrateTestSize,
    forceCompatiblePlayback
  )
  const resumeTime = art.currentTime || pageVideo.play_cursor || playback.playCursorSeconds || 0
  pendingMediaServerSeekTime = resumeTime
  pageVideo.play_cursor = resumeTime
  pageVideo.media_url = playback.url
  pageVideo.media_headers = playback.headers
  pageVideo.media_subtitle_sources = playback.subtitleSources || []
  pageVideo.media_server_tracks_selectable = playback.tracksSelectable === true
  pageVideo.media_server_source_id = sourceId || pageVideo.media_server_source_id || ''
  pageVideo.media_server_play_session_id = playback.playSessionId || pageVideo.media_server_play_session_id || ''
  if (videoStreamIndex >= 0) {
    pageVideo.media_server_video_label = (pageVideo.media_server_video_options || []).find((item) => item.streamIndex === videoStreamIndex)?.label || pageVideo.media_server_video_label || ''
  }
  if (audioStreamIndex >= 0) {
    pageVideo.media_server_audio_label = (pageVideo.media_server_audio_options || []).find((item) => item.streamIndex === audioStreamIndex)?.label || pageVideo.media_server_audio_label || ''
  }
  if (subtitleStreamIndex >= 0) {
    pageVideo.media_server_subtitle_label = (pageVideo.media_server_subtitle_options || []).find((item) => item.streamIndex === subtitleStreamIndex)?.label || pageVideo.media_server_subtitle_label || ''
  }
  setArtVideoUrl(art, resolveHeaderAwareVideoUrl(playback.url, playback.headers, 0, 'media_server'), getArtVideoType(playback.url))
  await loadMediaServerWebSubtitle(art, subtitleStreamIndex)
  mediaServerReportStarted = false
  mediaServerStopReported = false
  await sendMediaServerStartReport(resumeTime)
  await sendMediaServerProgressReport(resumeTime)
}

const getCurrentMediaServer = () => {
  mediaServerRegistry.ensureLoaded()
  const serverId = pageVideo.media_server_id || ''
  if (!serverId) return undefined
  return mediaServerRegistry.servers.find((item) => item.id === serverId)
}

const getCurrentPlaybackDuration = () => {
  if (useMacEmbeddedMpv) return Number(mpvEmbeddedStatus.value?.duration || 0)
  return Number(ArtPlayerRef?.duration || 0)
}

const sendMediaServerStartReport = async (positionSeconds = 0) => {
  if (pageVideo.drive_id !== 'media_server' || mediaServerReportStarted) return
  const server = getCurrentMediaServer()
  if (!server) return
  try {
    await reportMediaServerPlaybackStart(
      server,
      pageVideo.media_server_item_id || pageVideo.file_id,
      pageVideo.media_server_source_id,
      pageVideo.media_server_play_session_id,
      positionSeconds,
      getCurrentPlaybackDuration()
    )
    mediaServerReportStarted = true
    mediaServerStopReported = false
  } catch (error) {
    console.error('媒体服务器开始播放上报失败:', error)
  }
}

const sendMediaServerProgressReport = async (positionSeconds = 0) => {
  if (pageVideo.drive_id !== 'media_server' || !mediaServerReportStarted) return
  const server = getCurrentMediaServer()
  if (!server) return
  try {
    await reportMediaServerPlaybackProgress(
      server,
      pageVideo.media_server_item_id || pageVideo.file_id,
      pageVideo.media_server_source_id,
      pageVideo.media_server_play_session_id,
      positionSeconds,
      getCurrentPlaybackDuration()
    )
  } catch (error) {
    console.error('媒体服务器播放进度上报失败:', error)
  }
}

const sendMediaServerStopReport = async (positionSeconds = 0) => {
  if (pageVideo.drive_id !== 'media_server' || mediaServerStopReported) return
  const server = getCurrentMediaServer()
  if (!server) return
  try {
    await reportMediaServerPlaybackStop(
      server,
      pageVideo.media_server_item_id || pageVideo.file_id,
      pageVideo.media_server_source_id,
      pageVideo.media_server_play_session_id,
      positionSeconds,
      getCurrentPlaybackDuration()
    )
    mediaServerStopReported = true
  } catch (error) {
    console.error('媒体服务器停止播放上报失败:', error)
  }
}

const playByHls = (video: HTMLMediaElement, url: string, art: Artplayer) => {
  if (HlsJs.isSupported()) {
    // @ts-ignore
    if (art.hls) art.hls.destroy()
    destroyArtDash(art)
    const hls = new HlsJs({
      maxBufferLength: 500
    })
    hls.detachMedia()
    hls.loadSource(url)
    hls.attachMedia(video)
    hls.on(HlsJs.Events.ERROR, async (event, data) => {
      const errorType = data.type
      const errorDetails = data.details
      const errorFatal = data.fatal
      if (errorFatal) { // 尝试修复致命错误
        if (errorType === HlsJs.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError()
        } else if (errorType === HlsJs.ErrorTypes.NETWORK_ERROR) {
          if (pageVideo.expire_time && pageVideo.expire_time <= Date.now()) {
            await updateVideoTime()
            await getVideoInfo(art)
          } else {
            art.emit('video:error', data)
          }
        } else {
          hls.destroy()
        }
      }
    })
    hls.on(HlsJs.Events.MANIFEST_PARSED, () => {
      if ((art as any).hls === hls && isHlsVideoType(art.type)) getHlsControlPlugin(art)?.update?.()
    })
    hls.on(HlsJs.Events.AUDIO_TRACKS_UPDATED, () => {
      if ((art as any).hls === hls && isHlsVideoType(art.type)) getHlsControlPlugin(art)?.update?.()
    })
    // @ts-ignore
    art.hls = hls
    ensureHlsControlPlugin(art)
    art.on('destroy', () => hls.destroy())
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url
  } else {
    art.notice.show = t('video.unsupportedFormat')
  }
}

const playByDash = (video: HTMLMediaElement, url: string, art: Artplayer) => {
  if (!dashjs.supportsMediaSource()) {
    art.notice.show = t('video.unsupportedFormatMpd')
    return
  }
  destroyArtHls(art)
  destroyArtDash(art)
  const dash = dashjs.MediaPlayer().create()
  dash.initialize(video, url, art.option.autoplay)
  ;(art as any).dash = dash
  ensureDashControlPlugin(art)
  const events = dashjs.MediaPlayer.events
  dash.on(events.STREAM_INITIALIZED, () => {
    if ((art as any).dash === dash && isDashVideoType(art.type)) getDashControlPlugin(art)?.update?.()
  })
  dash.on(events.PLAYBACK_METADATA_LOADED, () => {
    if ((art as any).dash === dash && isDashVideoType(art.type)) getDashControlPlugin(art)?.update?.()
  })
  art.on('destroy', () => dash.destroy())
}

const getArtVideoType = (url: string, type?: string) => {
  const normalizedType = String(type || '').toLowerCase()
  if (normalizedType === 'hls' || normalizedType === 'm3u8') return 'm3u8'
  if (normalizedType === 'dash' || normalizedType === 'mpd') return 'mpd'
  if (normalizedType === 'ts') return 'ts'
  const pathname = url.split('?')[0].split('#')[0].toLowerCase()
  if (pathname.endsWith('.m3u8')) return 'm3u8'
  if (pathname.endsWith('.ts')) return 'ts'
  if (pathname.endsWith('.mpd')) return 'mpd'
  return ''
}

const isHlsVideoType = (type: string) => ['m3u8', 'hls', 'ts'].includes(type)
const isDashVideoType = (type: string) => ['mpd', 'dash'].includes(type)

const resolveHeaderAwareVideoUrl = (
  url: string,
  headers: Record<string, string> | undefined,
  fileSize: number,
  quality: string,
  proxyKind = ''
) => {
  if (!pageVideo.encType && !hasPlaybackHeaders(headers)) return url
  return getProxyUrl({
    user_id: pageVideo.user_id,
    drive_id: pageVideo.drive_id,
    file_id: pageVideo.file_id,
    encType: pageVideo.encType,
    password: pageVideo.password,
    file_size: fileSize,
    quality,
    proxy_url: url,
    proxy_headers: hasPlaybackHeaders(headers) ? JSON.stringify(headers) : undefined,
    proxy_kind: proxyKind
  })
}

const destroyArtHls = (art: Artplayer) => {
  if ((art as any).hls) {
    ;(art as any).hls.detachMedia?.()
    ;(art as any).hls.destroy?.()
    delete (art as any).hls
  }
  cleanupStreamingControlPlugin(art, 'hls')
}

const destroyArtDash = (art: Artplayer) => {
  if ((art as any).dash) {
    ;(art as any).dash.destroy?.()
    delete (art as any).dash
  }
  cleanupStreamingControlPlugin(art, 'dash')
}

const setArtVideoUrl = (art: Artplayer, url: string, type?: string) => {
  const artType = getArtVideoType(url, type)
  art.type = artType as any
  if (!isHlsVideoType(artType)) destroyArtHls(art)
  if (!isDashVideoType(artType)) destroyArtDash(art)
  art.url = url
  scheduleCleanupInactiveStreamingControls(art)
}

const getHlsControlPlugin = (art: Artplayer) => {
  return art.plugins.artplayerPluginHlsControl as any
}

const safeRemoveArtControl = (art: Artplayer, name: string) => {
  try {
    art.controls.remove(name)
  } catch (error) {
    if ((art.controls as any).cache?.has?.(name)) console.warn(`移除播放器控件失败: ${name}`, error)
  }
}

const safeRemoveArtSetting = (art: Artplayer, name: string) => {
  try {
    // `find` can miss an item while its setting panel is being rebuilt.
    // `remove` is idempotent for an absent setting and also clears the cached item.
    art.setting.remove(name)
  } catch (error) {
    if ((art.setting as any).cache?.has?.(name)) console.warn(`移除播放器设置失败: ${name}`, error)
  }
}

const forceRemoveStreamingControlDom = (art: Artplayer, name: string) => {
  const player = (art as any).template?.$player as HTMLElement | undefined
  if (!player) return
  player.querySelectorAll(`.art-control-${name}, .art-setting-item[data-name="${name}"]`)
    .forEach((element) => element.remove())
}

const cleanupStreamingControlPlugin = (art: Artplayer, type: 'hls' | 'dash') => {
  const plugin = type === 'hls' ? getHlsControlPlugin(art) : getDashControlPlugin(art)
  if (plugin?.update) {
    art.off('ready', plugin.update)
    art.off('restart', plugin.update)
  }
  safeRemoveArtControl(art, `${type}-quality`)
  safeRemoveArtControl(art, `${type}-audio`)
  safeRemoveArtSetting(art, `${type}-quality`)
  safeRemoveArtSetting(art, `${type}-audio`)
  forceRemoveStreamingControlDom(art, `${type}-quality`)
  forceRemoveStreamingControlDom(art, `${type}-audio`)
}

const cleanupInactiveStreamingControls = (art: Artplayer) => {
  if (!isHlsVideoType(art.type)) cleanupStreamingControlPlugin(art, 'hls')
  if (!isDashVideoType(art.type)) cleanupStreamingControlPlugin(art, 'dash')
}

const scheduleCleanupInactiveStreamingControls = (art: Artplayer) => {
  cleanupInactiveStreamingControls(art)
  window.setTimeout(() => cleanupInactiveStreamingControls(art), 0)
  window.setTimeout(() => cleanupInactiveStreamingControls(art), 250)
}

const ensureHlsControlPlugin = (art: Artplayer) => {
  if (getHlsControlPlugin(art)) return
  art.plugins.add(artplayerPluginHlsControl({
    quality: {
      control: false,
      setting: true,
      getName: (level: any) => level.name || (level.height ? `${level.height}P` : t('video.unknown')),
      title: t('video.quality'),
      auto: t('video.auto')
    },
    audio: {
      control: true,
      setting: true,
      getName: (track: any) => track.name || track.lang || track.language || t('video.defaultAudio'),
      title: t('video.audioTrack'),
      auto: t('video.auto')
    }
  }))
}

const getDashControlPlugin = (art: Artplayer) => {
  return art.plugins.artplayerPluginDashControl as any
}

const ensureDashControlPlugin = (art: Artplayer) => {
  if (getDashControlPlugin(art)) return
  art.plugins.add(artplayerPluginDashControl({
    quality: {
      control: false,
      setting: true,
      getName: (level: any) => level.height ? `${level.height}P` : t('video.unknown'),
      title: t('video.quality'),
      auto: t('video.auto')
    },
    audio: {
      control: true,
      setting: true,
      getName: (track: any) => String(track.lang || track.id || t('video.defaultAudio')).toUpperCase(),
      title: t('video.audioTrack'),
      auto: t('video.auto')
    }
  }))
}

const getChapterPlugin = (art: Artplayer) => {
  return art.plugins.artplayerPluginChapter as any
}

const getMediaServerChapters = (art: Artplayer) => {
  if (pageVideo.drive_id !== 'media_server') return []
  const duration = Number(art.duration || 0)
  if (!duration) return []
  return (pageVideo.media_server_chapters || [])
    .map((chapter) => ({
      start: Number(chapter.start),
      end: chapter.end === Infinity ? Infinity : Number(chapter.end),
      title: String(chapter.title || '')
    }))
    .filter((chapter) => (
      Number.isFinite(chapter.start)
      && chapter.start >= 0
      && chapter.start < duration
      && (chapter.end === Infinity || (Number.isFinite(chapter.end) && chapter.end > chapter.start))
    ))
    .map((chapter) => ({
      ...chapter,
      end: chapter.end === Infinity ? Infinity : Math.min(chapter.end, duration)
    }))
}

const updateVideoChapters = (art: Artplayer) => {
  getChapterPlugin(art)?.update?.({
    chapters: getMediaServerChapters(art)
  })
}

type selectorItem = {
  url: string;
  html: string;
  quality?: string;
  type?: string;
  width?: number;
  height?: number;
  label?: string;
  value?: string;
  name?: string;
  data?: string;
  default?: boolean;
  file_id?: string;
  ext?: string;
  description?: string;
  play_cursor?: number;
  user_id?: string;
  drive_id?: string;
  parent_file_id?: string;
  password?: string;
  tokenfrom?: string;
  encType?: string;
  headers?: Record<string, string>;
  isDir?: boolean;
}

const videoQualityAliases: Record<string, string[]> = {
  Origin: ['Origin', '100', '原画', '原始文件'],
  QHD: ['QHD', '5', '4K', '2160P', '2160p', '2560P', '2560p', '超高清'],
  FHD: ['FHD', '4', '1080P', '1080p', '全高清'],
  HD: ['HD', '3', '2', '720P', '720p', '高清', '超清'],
  SD: ['SD', '540P', '540p', '标清'],
  LD: ['LD', '1', '480P', '480p', '流畅']
}

const videoQualityTargetHeight: Record<string, number> = {
  QHD: 2560,
  FHD: 1080,
  HD: 720,
  SD: 540,
  LD: 480
}

const normalizeQualityText = (value?: string | number) => String(value || '').trim().toLowerCase()

const qualityMatchesPreference = (quality: selectorItem, preference: string) => {
  const aliases = videoQualityAliases[preference] || [preference]
  const values = [quality.quality, quality.html, quality.label, quality.value, quality.name].map(normalizeQualityText)
  return aliases.map(normalizeQualityText).some(alias => values.includes(alias))
}

const resolvePreferredVideoQuality = (qualities: selectorItem[], preference: string): selectorItem => {
  const candidates = qualities.filter(q => q.width || q.height)
  const exact = qualities.find(q => q.quality === preference) || qualities.find(q => qualityMatchesPreference(q, preference))
  if (exact) return exact

  const targetHeight = videoQualityTargetHeight[preference]
  if (targetHeight) {
    const belowTarget = candidates
      .filter(q => Number(q.height || 0) > 0 && Number(q.height || 0) <= targetHeight)
      .sort((a, b) => Number(b.height || 0) - Number(a.height || 0))[0]
    if (belowTarget) return belowTarget
  }

  return candidates[0] || qualities[0]
}

type MultipleSubtitleTrack = {
  name: string;
  label: string;
  url: string;
  type: 'srt' | 'vtt';
}

type mediaServerStreamOption = {
  streamIndex: number;
  label: string;
}

const findMediaServerStreamIndex = (options: mediaServerStreamOption[] = [], label?: string) => {
  if (!label) return -1
  return options.find((item) => item.label === label)?.streamIndex ?? -1
}

const upsertMediaServerControl = (art: Artplayer, option: Record<string, any>) => {
  const name = String(option.name || '')
  if (!name) return
  if (mediaServerControlNames.has(name)) {
    art.controls.update(option as any)
    return
  }
  art.controls.add(option as any)
  mediaServerControlNames.add(name)
}

const removeMediaServerControl = (art: Artplayer, name: string) => {
  if (!mediaServerControlNames.has(name)) return
  safeRemoveArtControl(art, name)
  mediaServerControlNames.delete(name)
}

const renderMediaSearchControl = (art: Artplayer) => {
  safeRemoveArtControl(art, 'danmakuSearch')
  safeRemoveArtControl(art, 'subtitleSearch')
  art.controls.update({
    name: 'mediaSearch',
    index: 21,
    position: 'right',
    style: { padding: '0 10px', marginRight: '8px', opacity: '0.92' },
    html: t('video.search'),
    selector: [
      {
        html: t('video.subtitleSearch'),
        type: 'subtitle'
      },
      {
        html: t('video.danmakuSearch'),
        type: 'danmaku'
      }
    ],
    onSelect: (selector: any) => {
      const item = selector as { type: string }
      if (item.type === 'subtitle') {
        openSubtitleSearchModal(art)
      } else {
        openDanmakuSearchModal(art)
      }
      return t('video.search')
    }
  })
}

const loadMediaServerSourceState = async (
  sourceId?: string,
  preferred?: {
    videoStreamIndex?: number
    audioStreamIndex?: number
    subtitleStreamIndex?: number
  }
) => {
  const server = getCurrentMediaServer()
  const itemId = pageVideo.media_server_item_id || pageVideo.file_id || ''
  if (!server || !itemId) return undefined

  const detail = await getMediaServerItemDetail(server, itemId)
  const sourceOptions = detail.sourceOptions || []
  const selectedSource = sourceOptions.find((item) => item.id === sourceId)
    || sourceOptions.find((item) => item.id === pageVideo.media_server_source_id)
    || sourceOptions[0]
  const mediaCards = selectedSource?.mediaInfoCards?.length
    ? selectedSource.mediaInfoCards
    : detail.mediaInfoCards

  const videoOptions = mediaCards
    .filter((card) => card.kind === 'video' && typeof card.streamIndex === 'number')
    .map((card) => ({ streamIndex: card.streamIndex as number, label: card.title }))
  const audioOptions = mediaCards
    .filter((card) => card.kind === 'audio' && typeof card.streamIndex === 'number')
    .map((card) => ({ streamIndex: card.streamIndex as number, label: card.title }))
  const subtitleOptions = mediaCards
    .filter((card) => card.kind === 'subtitle' && typeof card.streamIndex === 'number')
    .map((card) => ({ streamIndex: card.streamIndex as number, label: card.title }))

  const defaultVideoIndex = mediaCards.find((card) => card.kind === 'video' && card.selected && typeof card.streamIndex === 'number')?.streamIndex
    ?? mediaCards.find((card) => card.kind === 'video' && typeof card.streamIndex === 'number')?.streamIndex
    ?? -1
  const defaultAudioIndex = mediaCards.find((card) => card.kind === 'audio' && card.selected && typeof card.streamIndex === 'number')?.streamIndex
    ?? mediaCards.find((card) => card.kind === 'audio' && typeof card.streamIndex === 'number')?.streamIndex
    ?? -1
  const defaultSubtitleIndex = mediaCards.find((card) => card.kind === 'subtitle' && card.selected && typeof card.streamIndex === 'number')?.streamIndex
    ?? mediaCards.find((card) => card.kind === 'subtitle' && typeof card.streamIndex === 'number')?.streamIndex
    ?? -1

  const videoStreamIndex = typeof preferred?.videoStreamIndex === 'number' && preferred.videoStreamIndex >= 0 && videoOptions.some((item) => item.streamIndex === preferred.videoStreamIndex)
    ? preferred.videoStreamIndex
    : defaultVideoIndex
  const audioStreamIndex = typeof preferred?.audioStreamIndex === 'number' && preferred.audioStreamIndex >= 0 && audioOptions.some((item) => item.streamIndex === preferred.audioStreamIndex)
    ? preferred.audioStreamIndex
    : defaultAudioIndex
  const subtitleStreamIndex = typeof preferred?.subtitleStreamIndex === 'number' && preferred.subtitleStreamIndex >= 0 && subtitleOptions.some((item) => item.streamIndex === preferred.subtitleStreamIndex)
    ? preferred.subtitleStreamIndex
    : defaultSubtitleIndex

  pageVideo.media_server_source_id = selectedSource?.id || ''
  pageVideo.media_server_source_label = selectedSource?.title || ''
  pageVideo.media_server_source_options = sourceOptions.map((item) => ({
    id: item.id,
    label: item.title,
    subLabel: item.fileSubLabel
  }))
  pageVideo.media_server_video_options = videoOptions
  pageVideo.media_server_audio_options = audioOptions
  pageVideo.media_server_subtitle_options = subtitleOptions
  pageVideo.media_server_video_label = videoOptions.find((item) => item.streamIndex === videoStreamIndex)?.label || ''
  pageVideo.media_server_audio_label = audioOptions.find((item) => item.streamIndex === audioStreamIndex)?.label || ''
  pageVideo.media_server_subtitle_label = subtitleOptions.find((item) => item.streamIndex === subtitleStreamIndex)?.label || ''
  pageVideo.media_server_chapters = detail.chapters || []

  return {
    sourceId: selectedSource?.id || '',
    sourceLabel: selectedSource?.title || '',
    videoStreamIndex,
    audioStreamIndex,
    subtitleStreamIndex
  }
}

const renderMediaServerControls = (art: Artplayer) => {
  const sourceOptions = pageVideo.media_server_source_options || []
  const sourceLabel = pageVideo.media_server_source_label || ''
  const videoOptions = pageVideo.media_server_video_options || []
  const videoLabel = pageVideo.media_server_video_label || ''
  const audioLabel = pageVideo.media_server_audio_label || ''
  const subtitleLabel = pageVideo.media_server_subtitle_label || ''
  const tracksSelectable = pageVideo.media_server_tracks_selectable === true

  if (sourceOptions.length > 1) {
    upsertMediaServerControl(art, {
      name: 'mediaServerSource',
      index: 17,
      position: 'right',
      style: { padding: '0 10px', marginRight: '8px', opacity: '0.92' },
      html: sourceLabel || sourceOptions[0]?.label || t('video.version'),
      selector: sourceOptions.map((item) => ({
        html: item.subLabel ? `${item.label} · ${item.subLabel}` : item.label,
        sourceId: item.id,
        default: item.id === pageVideo.media_server_source_id
      })),
      onSelect: async (selector: any) => {
        const item = selector as { html: string, sourceId: string }
        const state = await loadMediaServerSourceState(item.sourceId)
        await refreshMediaServerPlayback(
          art,
          state?.sourceId || item.sourceId,
          state?.videoStreamIndex ?? -1,
          state?.audioStreamIndex ?? -1,
          state?.subtitleStreamIndex ?? -1
        )
        renderMediaServerControls(art)
        return state?.sourceLabel || item.html
      }
    })
  } else {
    removeMediaServerControl(art, 'mediaServerSource')
  }

  if (videoOptions.length > 1) {
    upsertMediaServerControl(art, {
      name: 'mediaServerVideo',
      index: 18,
      position: 'right',
      style: { padding: '0 10px', marginRight: '8px', opacity: '0.92' },
      html: t('video.videoStream'),
      selector: videoOptions.map((item) => ({
        html: item.label,
        streamIndex: item.streamIndex,
        default: item.label === videoLabel
      })),
      onSelect: async (selector: any) => {
        const item = selector as { html: string, streamIndex: number }
        pageVideo.media_server_video_label = item.html
        await refreshMediaServerPlayback(
          art,
          pageVideo.media_server_source_id || '',
          item.streamIndex,
          findMediaServerStreamIndex(pageVideo.media_server_audio_options, pageVideo.media_server_audio_label),
          findMediaServerStreamIndex(pageVideo.media_server_subtitle_options, pageVideo.media_server_subtitle_label),
          true
        )
        return t('video.videoStream')
      }
    })
  } else {
    removeMediaServerControl(art, 'mediaServerVideo')
    removeMediaServerControl(art, 'quality')
  }

  if (tracksSelectable && audioLabel) {
    upsertMediaServerControl(art, {
      name: 'mediaServerAudio',
      index: 19,
      position: 'right',
      style: { padding: '0 10px', marginRight: '8px', opacity: '0.92' },
      html: '音轨',
      selector: (pageVideo.media_server_audio_options || []).map((item) => ({
        html: item.label,
        streamIndex: item.streamIndex,
        default: item.label === audioLabel
      })),
      onSelect: async (selector: any) => {
        const item = selector as { html: string, streamIndex: number }
        pageVideo.media_server_audio_label = item.html
        await refreshMediaServerPlayback(
          art,
          pageVideo.media_server_source_id || '',
          findMediaServerStreamIndex(pageVideo.media_server_video_options, pageVideo.media_server_video_label),
          item.streamIndex,
          findMediaServerStreamIndex(pageVideo.media_server_subtitle_options, pageVideo.media_server_subtitle_label),
          true
        )
        return t('video.audioTrack')
      }
    })
  } else {
    removeMediaServerControl(art, 'mediaServerAudio')
  }

  if (tracksSelectable && subtitleLabel) {
    upsertMediaServerControl(art, {
      name: 'mediaServerSubtitle',
      index: 20,
      position: 'right',
      style: { padding: '0 10px', marginRight: '8px', opacity: '0.92' },
      html: t('video.subtitle'),
      selector: (pageVideo.media_server_subtitle_options || []).map((item) => ({
        html: item.label,
        streamIndex: item.streamIndex,
        default: item.label === subtitleLabel
      })),
      onSelect: async (selector: any) => {
        const item = selector as { html: string, streamIndex: number }
        pageVideo.media_server_subtitle_label = item.html
        await refreshMediaServerPlayback(
          art,
          pageVideo.media_server_source_id || '',
          findMediaServerStreamIndex(pageVideo.media_server_video_options, pageVideo.media_server_video_label),
          findMediaServerStreamIndex(pageVideo.media_server_audio_options, pageVideo.media_server_audio_label),
          item.streamIndex,
          true
        )
        return t('video.subtitle')
      }
    })
  } else {
    removeMediaServerControl(art, 'mediaServerSubtitle')
  }
  renderMediaSearchControl(art)
}

const refreshMediaServerPlayList = async (art: Artplayer, itemId?: string) => {
  const entries = pageVideo.media_server_episode_playlist || []
  if (entries.length <= 1) {
    playList.splice(0, playList.length)
    return
  }

  const currentItemId = itemId || pageVideo.media_server_item_id || pageVideo.file_id
  playList.splice(0, playList.length, ...entries.map((item) => ({
    url: '',
    html: item.title,
    name: item.title,
    file_id: item.id,
    default: item.id === currentItemId
  })))

  autoPlayNumber = Math.max(0, playList.findIndex((item) => item.file_id === currentItemId))
  lastPlayNumber = autoPlayNumber - 1
  const currentTitle = playList[autoPlayNumber]?.html || pageVideo.html || pageVideo.file_name || t('video.currentEpisode')

  art.setting.update({
    name: 'mediaServerPlayList',
    width: 300,
    html: pageVideo.media_server_playlist_label || t('video.playlist'),
    icon: art.icons.play,
    tooltip: handlerPlayTitle(currentTitle),
    selector: playList,
    onSelect: async (selector: any) => {
      const item = selector as selectorItem
      const nextTitle = await switchMediaServerPlaylistItem(art, item)
      return nextTitle || handlerPlayTitle(item.html)
    }
  })

  art.controls.update({
    name: 'playList',
    index: 10,
    position: 'right',
    style: { padding: '0 10px', marginRight: '10px' },
    html: handlerPlayTitle(currentTitle),
    selector: playList,
    mounted: (element: HTMLElement) => {
      const panel = element as HTMLDivElement
      const $current = Artplayer.utils.queryAll('.art-selector-item', panel)
        .find((item) => Number((item as HTMLElement).dataset.index) === autoPlayNumber)
      if ($current) Artplayer.utils.addClass($current as HTMLElement, 'art-list-icon')
    },
    onSelect: async (selector: any, element: HTMLElement) => {
      const item = selector as selectorItem
      const nextTitle = await switchMediaServerPlaylistItem(art, item)
      Artplayer.utils.inverseClass(element, 'art-list-icon')
      return nextTitle || handlerPlayTitle(item.html)
    }
  })
}

const switchMediaServerPlaylistItem = async (art: Artplayer, item: selectorItem) => {
  const nextItemId = item.file_id || ''
  if (!nextItemId || nextItemId === (pageVideo.media_server_item_id || pageVideo.file_id)) {
    return handlerPlayTitle(item.html)
  }

  const server = getCurrentMediaServer()
  if (!server) {
    art.notice.show = t('video.mediaServerMissing')
    return handlerPlayTitle(pageVideo.html || pageVideo.file_name || item.html)
  }

  try {
    await sendMediaServerProgressReport(art.currentTime || 0)
    await sendMediaServerStopReport(art.currentTime || 0)

    const detail = await getMediaServerItemDetail(server, nextItemId)
    const sourceOption = detail.sourceOptions[0]
    const mediaCards = sourceOption?.mediaInfoCards?.length ? sourceOption.mediaInfoCards : detail.mediaInfoCards
    const selectedVideoCard = mediaCards.find((card) => card.kind === 'video' && card.selected)
      || mediaCards.find((card) => card.kind === 'video')
    const selectedAudioCard = mediaCards.find((card) => card.kind === 'audio' && card.selected)
      || mediaCards.find((card) => card.kind === 'audio')
    const selectedSubtitleCard = mediaCards.find((card) => card.kind === 'subtitle' && card.selected)
      || mediaCards.find((card) => card.kind === 'subtitle')
    const videoOptions = mediaCards
      .filter((card) => card.kind === 'video' && typeof card.streamIndex === 'number')
      .map((card) => ({
        streamIndex: card.streamIndex as number,
        label: card.title
      }))
    const audioOptions = mediaCards
      .filter((card) => card.kind === 'audio' && typeof card.streamIndex === 'number')
      .map((card) => ({
        streamIndex: card.streamIndex as number,
        label: card.title
      }))
    const subtitleOptions = mediaCards
      .filter((card) => card.kind === 'subtitle' && typeof card.streamIndex === 'number')
      .map((card) => ({
        streamIndex: card.streamIndex as number,
        label: card.title
      }))
    const playback = await getMediaServerPlaybackInfo(
      server,
      detail.id,
      sourceOption?.id || '',
      typeof selectedVideoCard?.streamIndex === 'number' ? selectedVideoCard.streamIndex : -1,
      typeof selectedAudioCard?.streamIndex === 'number' ? selectedAudioCard.streamIndex : -1,
      typeof selectedSubtitleCard?.streamIndex === 'number' ? selectedSubtitleCard.streamIndex : -1,
      useSettingStore().uiMediaServerVideoQuality,
      useSettingStore().uiMediaServerCompatibilityMode,
      useSettingStore().uiMediaServerCustomDeviceProfile,
      useSettingStore().uiMediaServerBitrateTestSize
    )

    pageVideo.file_id = detail.id
    pageVideo.file_name = detail.title
    pageVideo.html = detail.title
    updateWindowTitle(detail.title)
    pageVideo.parent_file_name = detail.parentTitle || pageVideo.parent_file_name
    pageVideo.play_cursor = playback.playCursorSeconds || 0
    pageVideo.media_url = playback.url
    pageVideo.media_headers = playback.headers
    pageVideo.media_subtitle_sources = playback.subtitleSources || []
    pageVideo.media_server_tracks_selectable = playback.tracksSelectable === true
    pageVideo.media_server_item_id = detail.id
    pageVideo.media_server_source_id = sourceOption?.id || ''
    pageVideo.media_server_source_label = sourceOption?.title || ''
    pageVideo.media_server_play_session_id = playback.playSessionId || ''
    pageVideo.media_server_source_options = detail.sourceOptions.map((item) => ({
      id: item.id,
      label: item.title,
      subLabel: item.fileSubLabel
    }))
    pageVideo.media_server_video_label = selectedVideoCard?.title || ''
    pageVideo.media_server_video_options = videoOptions
    pageVideo.media_server_audio_label = selectedAudioCard?.title || ''
    pageVideo.media_server_subtitle_label = selectedSubtitleCard?.title || ''
    pageVideo.media_server_audio_options = audioOptions
    pageVideo.media_server_subtitle_options = subtitleOptions
    pageVideo.media_server_chapters = detail.chapters || []

    mediaServerReportStarted = false
    mediaServerStopReported = false
    mediaServerLastProgressSecond = -1
    if (onlineSubData.dataUrl) URL.revokeObjectURL(onlineSubData.dataUrl)
    onlineSubData.data = ''
    onlineSubData.ext = ''
    onlineSubData.name = ''
    onlineSubData.dataUrl = ''
    clearDownloadedSubtitleSelector()

    pendingMediaServerSeekTime = pageVideo.play_cursor || playback.playCursorSeconds || 0
    await getVideoInfo(art)
    await refreshMediaServerPlayList(art, detail.id)
    await art.play().catch(() => undefined)
    await getVideoCursor(art, pageVideo.play_cursor)
    await applyPendingMediaServerSeek(art)
    art.playbackRate = playbackRate
    await sendMediaServerStartReport(art.currentTime || pageVideo.play_cursor || 0)
    await autoLoadDanmaku(art)
    return handlerPlayTitle(detail.title)
  } catch (error: any) {
    console.error('播放器内切换剧集失败:', error)
    art.notice.show = error?.message || t('video.switchEpisodeFailed')
    return handlerPlayTitle(pageVideo.html || pageVideo.file_name || item.html)
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown, true)
  pageVideo.play_cursor = Math.max(
    Number(pageVideo.play_cursor || 0),
    getLocalVideoProgress(pageVideo.user_id, pageVideo.drive_id, pageVideo.file_id)
  )
  const name = pageVideo.file_name || t('video.onlinePreview')
  document.body.setAttribute('arco-theme', 'dark')
  setTimeout(() => {
    updateWindowTitle(name)
    document.getElementById(useMacEmbeddedMpv ? 'mpvEmbeddedPlayer' : 'artPlayer')?.focus()
  }, 1000)
  if (useMacEmbeddedMpv) {
    await buildPageVideoPlayList()
    mpvPlaylistReady.value = playList.length > 1
    if (await loadMpvEmbeddedCurrentVideo()) await sendMediaServerStartReport(pageVideo.play_cursor || 0)
    return
  }
  // 创建播放窗口
  await createVideo(name)
  // 获取视频信息
  await refreshPlayList(ArtPlayerRef)
  await loadPlugins(ArtPlayerRef)
  await getVideoInfo(ArtPlayerRef)
  await autoLoadDanmaku(ArtPlayerRef)
  // 加载设置
  await defaultSettings(ArtPlayerRef)
  await defaultControls(ArtPlayerRef)
})

const createVideo = async (name: string) => {
  // 初始化
  Artplayer.SETTING_WIDTH = 300
  Artplayer.SETTING_ITEM_WIDTH = 300
  Artplayer.NOTICE_TIME = 3000
  Artplayer.LOG_VERSION = false
  Artplayer.PLAYBACK_RATE = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]
  ArtPlayerRef = new Artplayer(options)
  // 获取用户配置
  initStorage(ArtPlayerRef)
  initEvent(ArtPlayerRef)
  initHotKey(ArtPlayerRef)
}

const initStorage = (art: Artplayer) => {
  const storage = art.storage
  if (storage.get('autoJumpCursor') === undefined) storage.set('autoJumpCursor', true)
  if (storage.get('subtitleSize') === undefined) storage.set('subtitleSize', 30)
  if (storage.get('subtitleTranslate') === undefined) storage.set('subtitleTranslate', 0)
  if (storage.get('autoSkipEnd') === undefined) storage.set('autoSkipEnd', 0)
  if (storage.get('longPressSpeed') === undefined) storage.set('longPressSpeed', 2)
  if (storage.get('autoSkipBegin') === undefined) storage.set('autoSkipBegin', 0)
  if (storage.get('videoVolume')) ArtPlayerRef.volume = parseFloat(String(storage.get('videoVolume')))
  if (storage.get('videoMuted')) ArtPlayerRef.muted = storage.get('videoMuted') === 'true'
}

// 自定义热键
const initHotKey = (art: Artplayer) => {
  // enter
  art.hotkey.add("13", () => {
    art.fullscreen = !art.fullscreen
  })
  // z
  art.hotkey.add("90", () => {
    art.playbackRate = 1
  })
  // x
  art.hotkey.add("88", () => {
    art.playbackRate = Math.max(0.5, art.playbackRate - 0.5)
  })
  // f
  art.hotkey.add("70", () => {
    art.fullscreen = !art.fullscreen
  })
  // m
  art.hotkey.add("77", () => {
    art.muted = !art.muted
    art.notice.show = art.muted ? t('video.muteOn') : t('video.muteOff')
  })
  // c
  art.hotkey.add("67", () => {
    playbackRate = Math.min(4, playbackRate + 0.5)
    art.playbackRate = playbackRate
  })
  art.events.proxy(document, 'keydown', (event: any) => {
    if (!art.video.paused && !art.video.ended && art.video.readyState > art.video.HAVE_CURRENT_DATA) {
      if (event && (event.key === 'ArrowRight' || event.code === 'KeyD')) {
        if (event.repeat) {
          // 按下右箭头键，阻止默认行为
          event.stopPropagation()
          event.preventDefault()
          // 设置播放速度
          art.playbackRate = Number(art.storage.get('longPressSpeed')) || 2
          art.notice.show = t('video.speedPlaying', { rate: art.playbackRate.toFixed(1) })
        } else {
          longPressSpeed = art.playbackRate
        }
      }
    }
  })
  art.events.proxy(document, 'keyup', (event: any) => {
    if (art.playing && event && (event.key === 'ArrowRight' || event.code === 'KeyD')) {
      // 按下右箭头键，阻止默认行为
      event.stopPropagation()
      event.preventDefault()
      // 恢复倍数
      art.playbackRate = longPressSpeed
    }
  })
}

const initEvent = (art: Artplayer) => {
  // 监听事件
  art.on('video:error', () => {
    art.notice.show = t('video.unsupportedMediaType')
  })
  art.on('ready', async () => {
    await art.play().catch()
    await getVideoCursor(art, pageVideo.play_cursor)
    await applyPendingMediaServerSeek(art)
    art.playbackRate = playbackRate
    scheduleCleanupInactiveStreamingControls(art)
    if (pageVideo.drive_id === 'media_server') {
      await sendMediaServerStartReport(art.currentTime || pageVideo.play_cursor || 0)
    }
  })
  art.on('restart', async () => {
    if (qualitySwitchGeneration > 0) return
    await art.play().catch()
    await getVideoCursor(art, pageVideo.play_cursor)
    await applyPendingMediaServerSeek(art)
    art.playbackRate = playbackRate
    scheduleCleanupInactiveStreamingControls(art)
    if (pageVideo.drive_id === 'media_server') {
      mediaServerLastProgressSecond = -1
      await sendMediaServerStartReport(art.currentTime || pageVideo.play_cursor || 0)
    }
  })
  // 视频播放完毕
  art.on('video:ended', async () => {
    if (pageVideo.drive_id === 'media_server') {
      await sendMediaServerStopReport(art.currentTime || 0)
    }
    if (playList.length > 1 && art.video.readyState > art.video.HAVE_CURRENT_DATA) {
      if (autoPlayNumber + 1 >= playList.length) {
        art.notice.show = t('video.ended')
        return
      }
      if (art.storage.get('autoPlayNext')) {
        await jumpToNextVideo(art)
      }
    }
  })
  // 播放已暂停
  art.on('video:pause', async () => {
    if (art.video.currentTime > 0
      && !art.video.ended
      && art.video.readyState > art.video.HAVE_CURRENT_DATA) {
      if (pageVideo.drive_id === 'media_server') {
        await sendMediaServerProgressReport(art.currentTime || 0)
      }
      await persistVideoProgress(art.currentTime, art.duration, true)
    }
  })
  // 音量发生变化
  art.on('video:volumechange', () => {
    art.storage.set('videoVolume', art.volume)
    art.storage.set('videoMuted', art.muted ? 'true' : 'false')
  })
  // 播放倍数变化
  art.on('video:ratechange', () => {
    playbackRate = art.playbackRate
    const $panel = art.query('.art-setting-panel.art-current')
    const $tooltip = art.query('.art-current .art-setting-item-right-tooltip')
    if ($tooltip) ($tooltip as HTMLElement).innerText = playbackRate === 1.0 ? art.i18n.get('Normal') : playbackRate.toFixed(1)
    if ($panel) {
      const $current = Artplayer.utils.queryAll('.art-setting-item', $panel as HTMLElement)
        .find((item) => Number((item as HTMLElement).dataset.value) === playbackRate)
      if ($current) Artplayer.utils.inverseClass($current as HTMLElement, 'art-current')
    }
  })
  art.on('video:loadedmetadata', () => {
    updateVideoChapters(art)
    scheduleCleanupInactiveStreamingControls(art)
  })
  art.on('video:canplay', () => {
    scheduleCleanupInactiveStreamingControls(art)
  })
  // 播放时间变化
  art.on('video:timeupdate', async () => {
    if (art.video.currentTime > 0
      && !art.video.paused && !art.video.ended
      && art.video.readyState > art.video.HAVE_CURRENT_DATA) {
      if (pageVideo.drive_id === 'media_server') {
        const currentSecond = Math.floor(art.currentTime)
        if (currentSecond > 0 && currentSecond % 10 === 0 && currentSecond !== mediaServerLastProgressSecond) {
          mediaServerLastProgressSecond = currentSecond
          await sendMediaServerProgressReport(currentSecond)
        }
      }
      const endDuration = art.storage.get('autoSkipEnd') as number
      const currentTime = art.currentTime
      pageVideo.play_cursor = Math.floor(currentTime)
      if (pageVideo.drive_id !== 'media_server' && Math.floor(currentTime) % 10 === 0) {
        await persistVideoProgress(currentTime, art.duration)
      }
      if (currentTime > 0 && endDuration > 0) {
        if (endDuration <= currentTime) {
          if (art.storage.get('autoPlayNext')) {
            await jumpToNextVideo(art)
          }
        }
      }
    }
  })
}

const jumpToNextVideo = async (art: Artplayer) => {
  if (lastPlayNumber + 1 !== autoPlayNumber) return
  if (autoPlayNumber + 1 >= playList.length) {
    autoPlayNumber = playList.length
    art.notice.show = t('video.lastEpisode')
    return
  }
  const item = playList[++autoPlayNumber]
  if (pageVideo.drive_id === 'media_server') {
    const nextTitle = await switchMediaServerPlaylistItem(art, item)
    art.notice.show = t('video.switchTo', { title: nextTitle || item.html })
    return
  }
  // 刷新视频
  await persistVideoProgress(art.currentTime, art.duration, true)
  await refreshSetting(art, item)
  await refreshPlayList(art, item.file_id)
  await autoLoadDanmaku(art)
}

const curDirFileList: any[] = []
const childDirFileList: any[] = []
let curDirFileListDirId: string | null = null
let childDirFileListDirId: string | null = null
const getDirFileList = async (dir_id: string, hasDir: boolean, category: string = '', filter?: RegExp, refresh = false): Promise<any[]> => {
  const cacheNeedsRefresh = refresh || (hasDir ? childDirFileListDirId !== dir_id : curDirFileListDirId !== dir_id)
  if (cacheNeedsRefresh) {
    if (hasDir) {
      childDirFileList.splice(0, childDirFileList.length)
      childDirFileListDirId = dir_id
    } else {
      curDirFileList.splice(0, curDirFileList.length)
      curDirFileListDirId = dir_id
    }
    let items: any[] = []
    if (isWebDavDrive(pageVideo.drive_id)) {
      const connection = getWebDavConnection(getWebDavConnectionId(pageVideo.drive_id))
      if (connection) {
        items = await listWebDavDirectory(connection, dir_id || '/')
      }
    } else {
      const route = resolveDriveProvider(pageVideo.user_id, pageVideo.drive_id, pageVideo.tokenfrom || UserDAL.GetUserToken(pageVideo.user_id)?.tokenfrom)
      const providerResult = route.isValid && route.provider !== 'aliyun'
        ? await listProviderItems(route.provider, pageVideo.user_id, pageVideo.drive_id, dir_id, true)
        : undefined
      if (providerResult) {
        items = providerResult.items
      } else if (route.isValid && route.provider === 'aliyun') {
        const dir = await AliDirFileList.ApiDirFileList(pageVideo.user_id, pageVideo.drive_id, dir_id, '', 'name asc', '')
        items = dir.items || []
      } else {
        console.warn('[PageVideo] skip unknown or mismatched drive source', { user_id: pageVideo.user_id, drive_id: pageVideo.drive_id, dir_id, error: route.error })
      }
    }
    for (let item of items) {
      const fileInfo = {
        html: item.name,
        category: item.category,
        description: item.description,
        name: item.name,
        file_id: item.file_id,
        drive_id: item.drive_id || pageVideo.drive_id,
        parent_file_id: item.parent_file_id || dir_id,
        ext: item.ext,
        isDir: item.isDir,
        encType: getEncType({ description: item.description || '' })
      }
      if (!hasDir) curDirFileList.push(fileInfo)
      else childDirFileList.push(fileInfo)
    }
  }
  const filterList = hasDir ? [...childDirFileList, ...curDirFileList].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')) : curDirFileList
  if (category) {
    return filterList.filter(file => file.category === category)
  }
  if (filter) {
    return filterList.filter(file => filter.test(file.ext))
  }
  return filterList
}

const getSubtitleFileList = async (includeSubfolders = false): Promise<selectorItem[]> => {
  const subtitlePattern = /srt|vtt|ass|ssa/
  const currentDirItems = await getDirFileList(pageVideo.parent_file_id, false, '')
  const subtitleFiles = [
    ...(pageVideo.library_subtitle_files || []).map((item) => ({
      html: item.name,
      name: item.name,
      file_id: item.file_id,
      parent_file_id: item.parent_file_id,
      drive_id: item.drive_id,
      user_id: item.user_id,
      ext: item.ext || item.name.split('.').pop() || ''
    })),
    ...currentDirItems.filter((item) => subtitlePattern.test(item.ext || ''))
  ]

  if (includeSubfolders) {
    // Subtitle libraries are commonly stored in immediate child folders. Keep the video folder first so a sibling subtitle wins ties.
    for (const dir of currentDirItems.filter((item) => item.isDir && item.file_id)) {
      subtitleFiles.push(...await getDirFileList(dir.file_id, true, '', subtitlePattern, true))
    }
  }
  return dedupeSubtitleSelectors(subtitleFiles)
}


const refreshSetting = async (art: Artplayer, item: any) => {
  // 刷新文件
  pageVideo.html = item.html
  pageVideo.play_cursor = item.play_cursor
  pageVideo.file_name = item.html
  pageVideo.file_id = item.file_id || ''
  if (item.user_id) pageVideo.user_id = item.user_id
  if (item.tokenfrom) pageVideo.tokenfrom = item.tokenfrom
  if (item.drive_id) pageVideo.drive_id = item.drive_id
  if (item.parent_file_id) pageVideo.parent_file_id = item.parent_file_id
  if (typeof item.password === 'string') pageVideo.password = item.password
  if (typeof item.encType === 'string' && item.encType) {
    pageVideo.encType = getEncType({ description: item.encType })
  } else if (item.description) {
    pageVideo.encType = getEncType({ description: item.description })
  }
  autoPlayNumber = playList.findIndex(list => list.file_id == pageVideo.file_id)
  // 更新标记
  const settingStore = useSettingStore()
  const description = item.description
  if (settingStore.uiAutoColorVideo && !isQuarkUser(pageVideo.user_id) && !isDropboxUser(pageVideo.user_id) && !isOneDriveUser(pageVideo.user_id) && !isBoxUser(pageVideo.user_id) && pageVideo.drive_id !== 'quark' && pageVideo.drive_id !== 'dropbox' && pageVideo.drive_id !== 'onedrive' && pageVideo.drive_id !== 'box' && (!description || !description.includes('ce74c3c'))) {
    AliFileCmd.ApiFileColorBatch(pageVideo.user_id, pageVideo.drive_id, item.description, 'ce74c3c', [item.file_id])
  }
  if (onlineSubData.dataUrl) {
    URL.revokeObjectURL(onlineSubData.dataUrl)
  }
  onlineSubData.data = ''
  onlineSubData.ext = ''
  onlineSubData.name = ''
  clearDownloadedSubtitleSelector()
  // 刷新信息
  await getVideoInfo(art)
  await defaultSettings(art)
}

const defaultSettings = async (art: Artplayer) => {
  let autoPlayNext = art.storage.get('autoPlayNext') as boolean
  let autoJumpCursor = art.storage.get('autoJumpCursor') as boolean
  let autoSkipBegin = art.storage.get('autoSkipBegin') as number
  let autoSkipEnd = art.storage.get('autoSkipEnd') as number
  let longPressSpeed = art.storage.get('longPressSpeed') as number
  art.setting.update({
    name: 'autoJumpCursor',
    width: 300,
    html: t('video.autoJump'),
    icon: art.icons.play,
    tooltip: autoJumpCursor ? t('video.jumpToHistory') : t('video.off'),
    switch: autoJumpCursor,
    onSwitch: async (item: SettingOption) => {
      item.tooltip = item.switch ? t('video.off') : t('video.jumpToHistory')
      art.storage.set('autoJumpCursor', !item.switch)
      return !item.switch
    }
  })
  if (playList.length > 1) {
    art.setting.update({
      name: 'autoPlayNext',
      width: 300,
      html: t('video.autoPlayNext'),
      icon: art.icons.airplay,
      tooltip: autoPlayNext ? t('video.on') : t('video.off'),
      switch: autoPlayNext,
      onSwitch: (item: SettingOption) => {
        item.tooltip = item.switch ? t('video.off') : t('video.on')
        art.notice.show = '自动连播' + item.tooltip
        art.storage.set('autoPlayNext', !item.switch)
        return !item.switch
      }
    })
  }
  art.setting.update({
    name: 'autoSkip',
    width: 300,
    html: t('video.moreSettings'),
    selector: [{
      name: 'longPressSpeed',
      width: 300,
      html: t('video.longPressSpeed'),
      icon: art.icons.playbackRate,
      tooltip: 'x' + longPressSpeed,
      range: [longPressSpeed, 1.5, 4, 0.5],
      onChange(item: SettingOption) {
        art.storage.set('longPressSpeed', item.range)
        return 'x' + item.range
      }
    }, {
      name: 'autoSkipBegin',
      width: 300,
      html: t('video.setIntro'),
      tooltip: autoSkipBegin + 's',
      range: [autoSkipBegin, 0, 3000, 1],
      onChange(item: SettingOption) {
        art.storage.set('autoSkipBegin', item.range)
        return item.range + 's'
      }
    }, {
      name: 'autoSkipEnd',
      width: 300,
      html: t('video.setOutro'),
      tooltip: autoSkipEnd + 's',
      range: [autoSkipEnd, 0, 3000, 1],
      onChange(item: SettingOption) {
        art.storage.set('autoSkipEnd', item.range)
        return item.range + 's'
      }
    }]
  })
}

const getVideoDanmakuTitle = () => {
  return pageVideo.file_name || pageVideo.html || ''
}

const getVideoSearchTitle = () => {
  return pageVideo.file_name || pageVideo.html || ''
}

const getDanmakuVideoKey = () => {
  return [
    pageVideo.drive_id || '',
    pageVideo.user_id || '',
    pageVideo.file_id || '',
    pageVideo.media_server_item_id || '',
    getVideoDanmakuTitle(),
    autoPlayNumber
  ].join('|')
}

const getDanmakuApis = (): DanmakuApiConfig[] => {
  return useSettingStore().danmakuApis
    .filter((api) => api.name.trim() && api.url.trim())
    .map((api) => ({
      id: api.id,
      name: api.name.trim(),
      url: api.url.trim()
    }))
}

const getDanmakuPlugin = (art: Artplayer) => {
  return art.plugins.artplayerPluginDanmuku as any
}

const applyDanmakuPluginConfig = (art: Artplayer) => {
  const plugin = getDanmakuPlugin(art)
  plugin?.config?.(buildDanmakuPluginOption(useSettingStore()) as any)
}

const loadDanmakuToPlayer = async (art: Artplayer, danmus: Danmu[], tip = t('video.loadedDanmaku')) => {
  const plugin = getDanmakuPlugin(art)
  if (!plugin) return
  applyDanmakuPluginConfig(art)
  await plugin.load?.(danmus)
  if (useSettingStore().danmakuVisible) plugin.show?.()
  else plugin.hide?.()
  message.success(`${tip}（${danmus.length} 条）`)
}

const getJassubInstance = (art: Artplayer) => {
  return (art.plugins.artplayerPluginJassub as any)?.instance
}

const setJassubVisible = (art: Artplayer, visible: boolean) => {
  const instance = getJassubInstance(art)
  const canvasParent = instance?._canvasParent as HTMLElement | undefined
  if (canvasParent) canvasParent.style.display = visible ? 'block' : 'none'
  if (visible) instance?.resize?.()
}

const clearJassubSubtitle = (art: Artplayer) => {
  const instance = getJassubInstance(art)
  instance?.freeTrack?.()
  setJassubVisible(art, false)
  const subtitleElement = (art as any).template?.$subtitle as HTMLElement | undefined
  if (subtitleElement) subtitleElement.style.visibility = 'visible'
}

const isAssSubtitleType = (type?: string) => {
  return ['ass', 'ssa'].includes(String(type || '').toLowerCase())
}

const getSubtitleItemExt = (item: selectorItem) => {
  return String(item.ext || getSubtitleExtension(item.name || item.url || item.html)).toLowerCase()
}

const refreshCurrentSubtitleCue = async (art: Artplayer) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const textTrack = (art.subtitle as any).textTrack as TextTrack | undefined
    if (textTrack?.activeCues != null) {
      ;(art.subtitle as any).update()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const switchNativeSubtitle = async (art: Artplayer, url: string, name: string, ext: string) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let settled = false
  const subtitleLoaded = new Promise<void>((resolve) => {
    const finish = () => {
      if (settled) return
      settled = true
      if (timeoutId) clearTimeout(timeoutId)
      resolve()
    }
    art.once('subtitleLoad', finish)
    timeoutId = setTimeout(finish, 1500)
  })
  await art.subtitle.switch(url, { name, type: ext, escape: false })
  await subtitleLoaded
  // ArtPlayer does not refresh the active cue when a new track loads while paused.
  await refreshCurrentSubtitleCue(art)
  art.subtitle.show = true
}

const switchSubtitleText = async (art: Artplayer, name: string, ext: string, data: string) => {
  if (isAssSubtitleType(ext)) {
    const instance = getJassubInstance(art)
    if (!instance) throw new Error(t('video.jassubNotReady'))
    const subtitleElement = (art as any).template?.$subtitle as HTMLElement | undefined
    if (subtitleElement) subtitleElement.style.visibility = 'hidden'
    instance.freeTrack?.()
    instance.setTrack(data)
    setJassubVisible(art, true)
    art.subtitle.show = true
    art.notice.show = t('video.switchSubtitle', { name })
    return
  }

  clearJassubSubtitle(art)
  await switchNativeSubtitle(art, onlineSubData.dataUrl, name, ext)
  art.notice.show = t('video.switchSubtitle', { name })
}

const autoLoadDanmaku = async (art: Artplayer) => {
  const videoKey = getDanmakuVideoKey()
  if (!videoKey || danmakuAutoLoadedKey === videoKey || danmakuAutoLoadingKey === videoKey) return
  const apis = getDanmakuApis()
  if (!apis.length) return
  danmakuAutoLoadingKey = videoKey
  try {
    const match = await autoMatchDanmaku(getVideoDanmakuTitle(), apis)
    const firstMatch = match?.response.matches?.[0]
    if (!match || !firstMatch) throw new Error('no danmaku match')
    const danmus = await loadDanmakuComments(firstMatch.episodeId, match.api)
    if (!danmus.length) throw new Error('empty danmaku')
    if (getDanmakuVideoKey() !== videoKey) return
    const title = firstMatch.episodeTitle || firstMatch.animeTitle || match.api.name
    await loadDanmakuToPlayer(art, danmus, t('video.autoLoadedDanmaku', { title }))
    danmakuAutoLoadedKey = videoKey
  } catch (error) {
    console.warn('自动加载弹幕失败:', error)
    if (getDanmakuVideoKey() === videoKey) {
      message.warning(t('video.autoLoadDanmakuFailed'))
      danmakuAutoLoadedKey = videoKey
    }
  } finally {
    if (danmakuAutoLoadingKey === videoKey) danmakuAutoLoadingKey = ''
  }
}

const subtitleLanguages = [
  { code: 'zh-cn', name: 'Simplified Chinese' },
  { code: 'en', name: 'English' },
  { code: 'zh-tw', name: 'Traditional Chinese' }
]

const getSelectedDanmakuApi = (apis: DanmakuApiConfig[], apiId: string) => {
  return apis.find((api) => api.id === apiId) || apis[0]
}

const toStringValue = (value: unknown) => {
  return typeof value === 'string' ? value : String(value ?? '')
}

const focusActiveSearchModal = () => {
  if (!activeSearchModal) return false
  requestAnimationFrame(() => {
    const dialog = document.querySelector<HTMLElement>('.arco-modal.danmaku-search-modal')
    const focusTarget = dialog?.querySelector<HTMLElement>('.danmaku-search-input') || dialog
    focusTarget?.focus({ preventScroll: true })
  })
  return true
}

const getSearchModalPopupContainer = (art: Artplayer) => {
  return resolveFullscreenModalContainer(art.fullscreen, document.fullscreenElement) as HTMLElement | undefined
}

const openDanmakuSearchModal = (art: Artplayer) => {
  if (focusActiveSearchModal()) return
  const apis = getDanmakuApis()
  if (!apis.length) {
    message.warning(t('video.configureDanmakuApi'))
    return
  }

  const keyword = ref(getVideoDanmakuTitle())
  const apiId = ref(apis[0].id)
  const loading = ref(false)
  const animes = ref<DanmakuSearchAnime[]>([])
  const episodes = ref<DanmakuEpisode[]>([])
  const selectedAnimeTitle = ref('')
  const selectedAnimeMeta = ref('')
  const viewMode = ref<'search' | 'episodes'>('search')
  let modal: any

  const renderEmpty = (text: string) => {
    return h('div', { class: 'danmaku-empty' }, text)
  }

  const renderAnimeRow = (anime: DanmakuSearchAnime) => {
    const selected = selectedAnimeTitle.value === anime.animeTitle
    return h('button', {
      class: ['danmaku-result-row', selected ? 'is-active' : ''],
      type: 'button',
      onClick: () => loadEpisodes(anime)
    }, [
      h('span', { class: 'danmaku-result-icon' }, [
        anime.imageUrl
          ? h('img', { class: 'danmaku-result-poster', src: anime.imageUrl, alt: '' })
          : h('span', { class: 'danmaku-video-glyph' })
      ]),
      h('span', { class: 'danmaku-result-copy' }, [
        h('span', { class: 'danmaku-result-title' }, anime.animeTitle),
        h('span', { class: 'danmaku-result-meta' }, [
          anime.typeDescription || anime.type || t('video.anime'),
          typeof anime.episodeCount === 'number' ? `  ${anime.episodeCount} ${t('video.episodesUnit')}` : ''
        ].join(''))
      ]),
      h('span', { class: 'danmaku-result-arrow' }, '›')
    ])
  }

  const renderEpisodeRow = (episode: DanmakuEpisode) => {
    const title = episode.episodeTitle || t('video.episodeTitle', { number: episode.episodeNumber || episode.episodeId })
    return h('button', {
      class: 'danmaku-episode-card',
      type: 'button',
      onClick: () => loadEpisode(episode)
    }, [
      h('span', { class: 'danmaku-episode-number' }, typeof episode.episodeNumber !== 'undefined' ? t('video.episodeNumber', { number: episode.episodeNumber }) : title),
      h('span', { class: 'danmaku-episode-title' }, title)
    ])
  }

  const runSearch = async () => {
    const api = getSelectedDanmakuApi(apis, apiId.value)
    if (!api || !keyword.value.trim()) return
    loading.value = true
    episodes.value = []
    selectedAnimeTitle.value = ''
    selectedAnimeMeta.value = ''
    viewMode.value = 'search'
    try {
      animes.value = await searchAnime(keyword.value, api)
      if (!animes.value.length) message.warning(t('video.noDanmakuFound'))
    } catch (error: any) {
      message.error(error?.message || t('video.searchDanmakuFailed'))
    } finally {
      loading.value = false
    }
  }

  const loadEpisodes = async (anime: DanmakuSearchAnime) => {
    const api = getSelectedDanmakuApi(apis, apiId.value)
    if (!api) return
    loading.value = true
    try {
      const detail = await getBangumiDetail(anime.animeId, api)
      selectedAnimeTitle.value = detail.animeTitle || anime.animeTitle
      selectedAnimeMeta.value = anime.typeDescription || anime.type || detail.typeDescription || detail.type || ''
      episodes.value = detail.episodes || []
      if (!episodes.value.length) message.warning(t('video.noEpisodeDanmaku'))
      else viewMode.value = 'episodes'
    } catch (error: any) {
      message.error(error?.message || t('video.fetchEpisodeDanmakuFailed'))
    } finally {
      loading.value = false
    }
  }

  const loadEpisode = async (episode: DanmakuEpisode) => {
    const api = getSelectedDanmakuApi(apis, apiId.value)
    if (!api) return
    loading.value = true
    try {
      const danmus = await loadDanmakuComments(episode.episodeId, api)
      if (!danmus.length) throw new Error(t('video.noLoadableDanmaku'))
      await loadDanmakuToPlayer(art, danmus, `已加载弹幕：${episode.episodeTitle}`)
      danmakuAutoLoadedKey = getDanmakuVideoKey()
      modal?.close?.()
    } catch (error: any) {
      message.error(error?.message || t('video.loadDanmakuFailed'))
    } finally {
      loading.value = false
    }
  }

  const renderHeader = () => {
    return h('div', { class: 'danmaku-full-header' }, [
      h('button', {
        class: 'danmaku-close-button',
        type: 'button',
        onClick: () => modal?.close?.()
      }, '×'),
      h('div', { class: 'danmaku-header-copy' }, [
        h('div', { class: 'danmaku-full-title' }, t('video.onlineDanmakuSearch')),
        h('div', { class: 'danmaku-full-subtitle' }, t('video.danmakuSearchSubtitle'))
      ])
    ])
  }

  const renderSearchView = () => {
    return h('div', { class: 'danmaku-full-content' }, [
      h('div', { class: 'danmaku-searchbar' }, [
        h(Select, {
          class: 'danmaku-api-select',
          modelValue: apiId.value,
          triggerProps: { autoFitPopupMinWidth: true },
          'onUpdate:modelValue': (value: string | number | boolean | Record<string, any> | Array<string | number | boolean | Record<string, any>>) => {
            apiId.value = toStringValue(value)
            animes.value = []
            episodes.value = []
            selectedAnimeTitle.value = ''
            selectedAnimeMeta.value = ''
            if (keyword.value.trim()) void runSearch()
          }
        }, () => apis.map((api) => h(AOption, { value: api.id }, () => api.name))),
      h('div', { class: 'danmaku-input-wrap' }, [
          h(Input, {
            class: 'danmaku-search-input',
            modelValue: keyword.value,
            placeholder: t('video.searchInputPlaceholder'),
            onInput: (value: string) => { keyword.value = value },
            'onUpdate:modelValue': (value: string) => { keyword.value = value },
            onPressEnter: runSearch
          })
        ]),
        h(Button, {
          class: 'danmaku-search-button',
          loading: loading.value,
          onClick: runSearch
        }, () => '搜索')
      ]),
      h('p', { class: 'danmaku-search-tip' }, t('video.danmakuSearchTip')),
      h('section', { class: 'danmaku-result-shell' }, [
        h('div', { class: 'danmaku-result-toolbar' }, [
          h('span', {}, loading.value ? t('video.searching') : animes.value.length ? t('video.foundWorks', { count: animes.value.length }) : t('video.searchResults')),
          h('span', {}, getSelectedDanmakuApi(apis, apiId.value)?.name || '')
        ]),
        h('div', { class: 'danmaku-modal-list' }, animes.value.length ? animes.value.map(renderAnimeRow) : renderEmpty(t('video.noSearchResults')))
      ])
    ])
  }

  const renderEpisodesView = () => {
    return h('div', { class: 'danmaku-full-content danmaku-full-content-episodes' }, [
      h('button', {
        class: 'danmaku-back-button',
        type: 'button',
        onClick: () => { viewMode.value = 'search' }
      }, t('video.backToEpisodeSearch')),
      h('div', { class: 'danmaku-episode-heading' }, [
        h('strong', {}, selectedAnimeTitle.value),
        h('span', {}, [selectedAnimeMeta.value, `${episodes.value.length} ${t('video.episodesUnit')}`].filter(Boolean).join('  ·  '))
      ]),
      h('section', { class: 'danmaku-episode-shell' }, [
        h('div', { class: 'danmaku-episode-grid' }, episodes.value.length ? episodes.value.map(renderEpisodeRow) : renderEmpty(t('video.noEpisodeDanmaku')))
      ])
    ])
  }

  modal = Modal.open({
    title: '',
    width: 920,
    hideTitle: true,
    closable: false,
    footer: false,
    maskClosable: true,
    renderToBody: true,
    popupContainer: getSearchModalPopupContainer(art),
    modalClass: 'danmaku-search-modal',
    bodyClass: 'danmaku-search-modal-body',
    onOpen: runSearch,
    onClose: () => {
      if (activeSearchModal === modal) activeSearchModal = undefined
    },
    content: () => h('div', { class: 'danmaku-modal' }, [
      renderHeader(),
      viewMode.value === 'episodes' ? renderEpisodesView() : renderSearchView()
    ])
  })
  activeSearchModal = modal
}

const loadSubtitleTextToPlayer = async (art: Artplayer, name: string, ext: string, data: string) => {
  clearMultipleSubtitleState(art)
  const normalizedExt = getSubtitleExtension(`subtitle.${ext || getSubtitleExtension(name)}`)
  if (onlineSubData.dataUrl) URL.revokeObjectURL(onlineSubData.dataUrl)
  const subtitleTranslate = art.storage.get('subtitleTranslate')
  if (subtitleTranslate === 1) {
    onlineSubData.data = traditionToSimple(data)
  } else if (subtitleTranslate === 2) {
    onlineSubData.data = simpleToTradition(data)
  } else {
    onlineSubData.data = data
  }
  onlineSubData.name = name
  onlineSubData.ext = normalizedExt
  onlineSubData.dataUrl = URL.createObjectURL(new Blob([onlineSubData.data], { type: normalizedExt === 'vtt' ? 'text/vtt' : 'text/plain' }))
  await switchSubtitleText(art, name, normalizedExt, onlineSubData.data)
}

const selectLocalSubtitleFile = () => new Promise<File | undefined>((resolve) => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.ass,.ssa,.srt,.vtt'
  input.style.display = 'none'
  const cleanup = () => input.remove()
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    cleanup()
    resolve(file)
  }, { once: true })
  input.addEventListener('cancel', () => {
    cleanup()
    resolve(undefined)
  }, { once: true })
  document.body.appendChild(input)
  input.click()
})

const importLocalSubtitle = async (art: Artplayer) => {
  try {
    let name = ''
    let data = ''
    if (typeof window.WebShowOpenDialog === 'function') {
      const paths = await window.WebShowOpenDialog({
        title: t('video.importLocalSubtitle'),
        buttonLabel: t('common.open'),
        properties: ['openFile'],
        filters: [{ name: 'Subtitle files', extensions: ['ass', 'ssa', 'srt', 'vtt'] }]
      })
      const subtitlePath = paths[0]
      if (!subtitlePath) return
      const fs = window.require?.('fs') as { readFileSync?: (filePath: string) => Uint8Array } | undefined
      const bytes = fs?.readFileSync?.(subtitlePath)
      if (!bytes) throw new Error('Unable to read subtitle file')
      name = path.basename(subtitlePath)
      data = decodeSubtitleBuffer(Uint8Array.from(bytes).buffer)
    } else {
      const file = await selectLocalSubtitleFile()
      if (!file) return
      name = file.name
      data = decodeSubtitleBuffer(await file.arrayBuffer())
    }
    const ext = getSubtitleExtension(name)
    await loadSubtitleTextToPlayer(art, name, ext, data)
    addDownloadedSubtitleToSelector(name, ext, data)
    // The local subtitle is already active. A cloud-directory refresh is optional
    // and must not turn a successful import into a visible failure.
    await getSubTitleList(art, false).catch((error) => {
      console.warn('刷新字幕列表失败，本地字幕已加载:', error)
    })
  } catch (error) {
    console.error('导入本地字幕失败:', error)
    art.notice.show = t('video.subtitleLoadFailed')
  }
}

const addDownloadedSubtitleToSelector = (name: string, ext: string, data: string) => {
  downloadedSubSelector.forEach((item) => { item.default = false })
  const html = `${t('video.search')}: ${name}`
  const index = downloadedSubSelector.findIndex((item) => item.name === name)
  const item = {
    url: '',
    html,
    name,
    ext,
    data,
    default: true
  }
  if (index >= 0) downloadedSubSelector.splice(index, 1, item)
  else downloadedSubSelector.push(item)
}

const loadSubtitleUrlToPlayer = async (art: Artplayer, item: selectorItem) => {
  clearMultipleSubtitleState(art)
  if (typeof item.data === 'string' && item.data.length > 0) {
    await loadSubtitleTextToPlayer(art, item.name || item.html, item.ext || getSubtitleExtension(item.name || item.html), item.data)
    return item.html
  }
  const ext = getSubtitleItemExt(item)
  const response = await fetch(item.url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  await loadSubtitleTextToPlayer(art, item.name || item.html, ext, decodeSubtitleBuffer(await response.arrayBuffer()))
  return item.html
}

const loadMediaServerWebSubtitle = async (art: Artplayer, preferredStreamIndex = -1) => {
  const sources = pageVideo.media_subtitle_sources || []
  embedSubSelector = sources.map((source) => ({
    html: formatEmbeddedSubtitleLabel(source.title, locale.value) || t('video.subtitle'),
    name: formatEmbeddedSubtitleLabel(source.title, locale.value) || t('video.subtitle'),
    ext: getSubtitleExtension(source.url),
    url: source.url,
    default: source.streamIndex === preferredStreamIndex
  }))
  if (!embedSubSelector.length) return

  const selected = embedSubSelector.find((item) => item.default)
    || embedSubSelector.find((item) => item.name === pageVideo.media_server_subtitle_label)
    || embedSubSelector[0]
  embedSubSelector.forEach((item) => { item.default = item === selected })
  try {
    await loadSubtitleUrlToPlayer(art, selected)
  } catch (error) {
    console.error('媒体服务器字幕加载失败:', error)
    art.notice.show = t('video.subtitleLoadFailed')
  }
}

const openSubtitleSearchModal = (art: Artplayer) => {
  if (focusActiveSearchModal()) return
  const keyword = ref(getVideoSearchTitle())
  const language = ref('zh-cn')
  const format = ref<'all' | Exclude<SubtitleSearchFormat, 'unknown'>>('all')
  const loading = ref(false)
  const downloadingFileId = ref<number>()
  const errorText = ref('')
  const results = ref<SubtitleSearchResult[]>([])
  const visibleResults = computed(() => format.value === 'all' ? results.value : results.value.filter((subtitle) => subtitle.format === format.value))
  let modal: any

  const runSearch = async () => {
    if (!keyword.value.trim()) return
    loading.value = true
    errorText.value = ''
    try {
      results.value = await searchSubtitles(keyword.value, language.value)
      if (!results.value.length) message.warning(t('video.noSubtitleFound'))
    } catch (error: any) {
      errorText.value = error?.message || t('video.searchFailedRetry')
    } finally {
      loading.value = false
    }
  }

  const loadSubtitle = async (subtitle: SubtitleSearchResult) => {
    loading.value = true
    downloadingFileId.value = subtitle.fileId
    errorText.value = ''
    try {
      const detail = await getSubtitleDownload(subtitle.fileId)
      const response = await fetch(detail.link)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.text()
      await loadSubtitleTextToPlayer(art, detail.fileName, getSubtitleExtension(detail.fileName), data)
      addDownloadedSubtitleToSelector(detail.fileName, getSubtitleExtension(detail.fileName), data)
      await getSubTitleList(art)
      modal?.close?.()
    } catch (error: any) {
      errorText.value = error?.message || t('video.downloadFailedRetry')
    } finally {
      loading.value = false
      downloadingFileId.value = undefined
    }
  }

  const renderSubtitleRow = (subtitle: SubtitleSearchResult) => {
    return h('button', {
      class: 'danmaku-result-row',
      type: 'button',
      disabled: loading.value,
      onClick: () => loadSubtitle(subtitle)
    }, [
      h('span', { class: 'danmaku-result-icon' }, [
        h('span', { class: 'subtitle-doc-glyph' })
      ]),
      h('span', { class: 'danmaku-result-copy' }, [
        h('span', { class: 'subtitle-result-title-row' }, [
          h('span', { class: 'danmaku-result-title' }, subtitle.name),
          ...(subtitle.format === 'unknown' ? [] : [h('span', { class: 'subtitle-format-badge' }, subtitle.format.toUpperCase())])
        ]),
        h('span', { class: 'danmaku-result-meta' }, `${subtitle.language}  下载: ${formatSubtitleDownloadCount(subtitle.downloadCount)}`)
      ]),
      h('span', { class: ['subtitle-download-arrow', downloadingFileId.value === subtitle.fileId ? 'is-loading' : ''] }, downloadingFileId.value === subtitle.fileId ? t('video.loading') : t('video.load'))
    ])
  }

  const renderContentState = () => {
    if (loading.value && !results.value.length) return h('div', { class: 'danmaku-empty' }, `${t('video.searching')}...`)
    if (errorText.value) return h('div', { class: 'danmaku-empty' }, errorText.value)
    if (!results.value.length) return h('div', { class: 'danmaku-empty' }, keyword.value.trim() ? t('video.noSubtitleFound') : t('video.enterSearchKeyword'))
    if (!visibleResults.value.length) return h('div', { class: 'danmaku-empty' }, t('video.noSubtitleFormatFound'))
    return visibleResults.value.map(renderSubtitleRow)
  }

  modal = Modal.open({
    title: '',
    width: 860,
    hideTitle: true,
    closable: false,
    footer: false,
    maskClosable: false,
    renderToBody: true,
    popupContainer: getSearchModalPopupContainer(art),
    modalClass: 'danmaku-search-modal subtitle-search-modal',
    bodyClass: 'danmaku-search-modal-body',
    onOpen: runSearch,
    onClose: () => {
      if (activeSearchModal === modal) activeSearchModal = undefined
    },
    content: () => h('div', { class: 'danmaku-modal' }, [
      h('div', { class: 'danmaku-full-header' }, [
        h('button', {
          class: 'danmaku-close-button',
          type: 'button',
          onClick: () => modal?.close?.()
        }, '×'),
        h('div', { class: 'danmaku-header-copy' }, [
          h('div', { class: 'danmaku-full-title' }, t('video.onlineSubtitleSearch')),
          h('div', { class: 'danmaku-full-subtitle' }, t('video.subtitleSearchSubtitle'))
        ])
      ]),
      h('div', { class: 'danmaku-full-content' }, [
        h('div', { class: 'danmaku-searchbar subtitle-searchbar' }, [
          h(Select, {
            class: 'danmaku-api-select',
            modelValue: language.value,
            triggerProps: { autoFitPopupMinWidth: true },
            'onUpdate:modelValue': (value: string | number | boolean | Record<string, any> | Array<string | number | boolean | Record<string, any>>) => {
              language.value = toStringValue(value)
              if (keyword.value.trim()) void runSearch()
            }
          }, () => subtitleLanguages.map((item) => h(AOption, { value: item.code }, () => item.name))),
          h(Select, {
            class: 'subtitle-format-select',
            modelValue: format.value,
            triggerProps: { autoFitPopupMinWidth: true },
            'onUpdate:modelValue': (value: string | number | boolean | Record<string, any> | Array<string | number | boolean | Record<string, any>>) => {
              format.value = toStringValue(value) as 'all' | Exclude<SubtitleSearchFormat, 'unknown'>
            }
          }, () => [
            ['all', t('video.subtitleFormatAll')],
            ['srt', 'SRT'],
            ['ass', 'ASS'],
            ['vtt', 'VTT']
          ].map(([value, label]) => h(AOption, { value }, () => label))),
          h('div', { class: 'danmaku-input-wrap' }, [
            h(Input, {
              class: 'danmaku-search-input',
              modelValue: keyword.value,
              placeholder: t('video.subtitleSearchPlaceholder'),
              onInput: (value: string) => { keyword.value = value },
              'onUpdate:modelValue': (value: string) => { keyword.value = value },
              onPressEnter: runSearch
            })
          ]),
          h(Button, {
            class: 'danmaku-search-button',
            loading: loading.value,
            disabled: !keyword.value.trim(),
            onClick: runSearch
          }, () => '搜索')
        ]),
        h('section', { class: 'danmaku-result-shell' }, [
          h('div', { class: 'danmaku-result-toolbar' }, [
            h('span', {}, loading.value ? t('video.searching') : visibleResults.value.length ? t('video.foundSubtitles', { count: visibleResults.value.length }) : t('video.searchResults')),
            h('span', {}, subtitleLanguages.find(item => item.code === language.value)?.name || '')
          ]),
          h('div', { class: 'danmaku-modal-list' }, renderContentState())
        ])
      ])
    ])
  })
  activeSearchModal = modal
}

const defaultControls = async (art: Artplayer) => {
  if (playList.length > 1) {
    art.controls.update({
      index: 20,
      position: 'left',
      html: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-skip-forward"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" x2="19" y1="5" y2="19"></line></svg>',
      tooltip: t('video.nextEpisode'),
      click: async () => {
        await jumpToNextVideo(art)
      }
    })
  }
  art.controls.update({
    name: 'skipBegin',
    index: 40,
    position: 'left',
    style: { marginLeft: '10px' },
    html: t('video.intro'),
    tooltip: t('video.clickSetIntro'),
    click: async (component, event) => {
      if (Number(art.storage.get('autoSkipBegin')) > 0) {
        art.storage.set('autoSkipBegin', 0)
        art.notice.show = t('video.cancelSetIntro')
      } else {
        art.storage.set('autoSkipBegin', art.currentTime)
        art.notice.show = t('video.setIntroAt', { time: art.currentTime })
      }
    }
  })
  art.controls.update({
    name: 'skipEnd',
    index: 50,
    position: 'left',
    html: t('video.outro'),
    tooltip: t('video.clickSetOutro'),
    click: async (component, event) => {
      if (Number(art.storage.get('autoSkipEnd')) > 0) {
        art.storage.set('autoSkipEnd', 0)
        art.notice.show = t('video.cancelSetOutro')
      } else {
        art.storage.set('autoSkipEnd', art.currentTime)
        art.notice.show = t('video.setOutroAt', { time: art.currentTime })
      }
    }
  })
  renderMediaSearchControl(art)
}

const loadPlugins = async (art: Artplayer) => {
  // 章节插件
  art.plugins.add(artplayerPluginChapter({
    chapters: []
  }))
  // 弹幕插件
  art.plugins.add(artplayerPluginDanmuku({
    ...buildDanmakuPluginOption(useSettingStore()),
    danmuku: []
  } as any))
  // ASS/SSA 字幕插件
  const cjkFont = await getJassubCjkFont()
  const availableFonts: Record<string, string | Uint8Array> = {
    'liberation sans': JASSUBDefaultFont
  }
  let fallbackFont = 'liberation sans'
  if (cjkFont) {
    availableFonts['noto sans cjk sc'] = cjkFont
    availableFonts['noto sans sc'] = cjkFont
    availableFonts['pingfang sc'] = cjkFont
    availableFonts['microsoft yahei'] = cjkFont
    availableFonts.simhei = cjkFont
    availableFonts.simsun = cjkFont
    fallbackFont = 'noto sans cjk sc'
  }
  art.plugins.add(artplayerPluginJassub({
    workerUrl: JASSUBWorker,
    wasmUrl: JASSUBWorkerWasm,
    modernWasmUrl: JASSUBWorkerModernWasm,
    fonts: cjkFont ? [cjkFont] : [],
    availableFonts: availableFonts as any,
    fallbackFont,
    subContent: '[Script Info]\nScriptType: v4.00+'
  }))
  clearJassubSubtitle(art)
}

const resolveRawMpvQualitySource = (data: IRawUrl, preferredQuality?: string): { quality: selectorItem; url: string; headers?: Record<string, string>; type?: string; qualityLabel: string } => {
  const uiVideoQuality = preferredQuality || useSettingStore().uiVideoQuality
  let defaultQuality: selectorItem
  if (uiVideoQuality === 'Origin' && pageVideo.drive_id != 'baidu' && pageVideo.drive_id != 'drive115') {
    defaultQuality = data.qualities[0]
  } else {
    defaultQuality = resolvePreferredVideoQuality(data.qualities, uiVideoQuality)
  }

  // Provider-level headers (Authorization/Cookie/Referer/etc.) apply to every
  // quality. Quality-specific headers may add to or override them, but an empty
  // quality header object must never discard provider authentication.
  const provider = resolveDriveProvider(pageVideo.user_id, pageVideo.drive_id, pageVideo.tokenfrom).provider
  const defaultHeaders = mergeMpvPlaybackHeaders(provider, data.headers, defaultQuality.headers)
  const useAuthenticatedMpvProxy = !pageVideo.encType && hasPlaybackHeaders(defaultHeaders)
  const defaultUrl = resolveHeaderAwareVideoUrl(defaultQuality.url, defaultHeaders, data.size, defaultQuality.quality || '', useAuthenticatedMpvProxy ? 'mpv' : '')
  const mpvHeaders = defaultUrl === defaultQuality.url ? defaultHeaders : undefined
  const defaultQualityWidth = (defaultQuality as any).width
  return {
    quality: defaultQuality,
    url: defaultUrl,
    headers: mpvHeaders,
    type: defaultQuality.type,
    qualityLabel: defaultQuality.html || defaultQuality.quality || (defaultQualityWidth ? `${defaultQualityWidth}p` : '原画')
  }
}

const resolvePageVideoMpvSource = async (): Promise<{ url: string; headers?: Record<string, string>; type?: string; qualityLabel?: string; quality?: string; qualities?: selectorItem[]; subtitles?: Array<{ url: string; title?: string; streamIndex?: number }>; error?: string }> => {
  if (pageVideo.drive_id === 'local') {
    const urlModule = window.require?.('url')
    const filePath = pageVideo.file_id || (pageVideo as any).file_path || ''
    if (!filePath) return { url: '', error: t('video.localVideoPathEmpty') }
    return {
      url: urlModule?.pathToFileURL ? urlModule.pathToFileURL(filePath).href : `file://${encodeURI(filePath)}`,
      qualityLabel: t('video.local'),
      subtitles: pageVideo.media_subtitle_sources || []
    }
  }

  if (pageVideo.drive_id === 'media_server') {
    if (!(pageVideo.media_server_source_options || []).length) {
      try {
        await loadMediaServerSourceState(pageVideo.media_server_source_id || '')
      } catch (error) {
        console.error('加载媒体服务器版本信息失败:', error)
      }
    }
    const mediaUrl = pageVideo.media_url || ''
    if (!mediaUrl) return { url: '', error: t('video.getMediaServerUrlFailed') }
    const mediaHeaders = pageVideo.media_headers
    // Keep the URL and request headers together in the local proxy. This also
    // preserves authentication across redirects and nested HLS requests.
    const useAuthenticatedMpvProxy = hasPlaybackHeaders(mediaHeaders)
    const mpvUrl = useAuthenticatedMpvProxy
      ? getProxyUrl({
          user_id: pageVideo.user_id,
          drive_id: pageVideo.drive_id,
          file_id: pageVideo.media_server_item_id || pageVideo.file_id,
          file_size: 0,
          quality: 'media_server',
          proxy_url: mediaUrl,
          proxy_headers: JSON.stringify(mediaHeaders),
          proxy_kind: 'mpv'
        })
      : mediaUrl
    return {
      url: mpvUrl,
      headers: useAuthenticatedMpvProxy ? undefined : mediaHeaders,
      type: getArtVideoType(mediaUrl),
      qualityLabel: pageVideo.media_server_source_label || t('video.mediaServer'),
      subtitles: pageVideo.media_subtitle_sources || []
    }
  }

  const data: string | IRawUrl = await getRawUrl(pageVideo.user_id, pageVideo.drive_id, pageVideo.file_id, pageVideo.encType, pageVideo.password, false, 'video', '', 'thirdParty', pageVideo.tokenfrom)
  if (typeof data === 'string') return { url: '', error: data }
  if (!data.qualities.length) return { url: '', error: t('video.getVideoUrlFailed') }

  const source = resolveRawMpvQualitySource(data, mpvEmbeddedQuality.value)
  const defaultQuality = source.quality
  const qualities = data.qualities.map(q => ({
    ...q,
    default: q.quality === defaultQuality.quality
  }))
  pageVideo.expire_time = GetExpiresTime(defaultQuality.url)
  const provider = resolveDriveProvider(pageVideo.user_id, pageVideo.drive_id, pageVideo.tokenfrom).provider
  const subtitles = (data.subtitles || []).map((subtitle) => {
    const subtitleHeaders = mergeMpvPlaybackHeaders(provider, subtitle.headers)
    return {
      url: hasPlaybackHeaders(subtitleHeaders)
        ? getProxyUrl({
          user_id: pageVideo.user_id,
          drive_id: pageVideo.drive_id,
          file_id: pageVideo.file_id,
          proxy_kind: 'subtitle',
          proxy_url: subtitle.url,
          proxy_headers: JSON.stringify(subtitleHeaders)
        })
        : subtitle.url,
      title: formatEmbeddedSubtitleLabel(subtitle.language, locale.value)
    }
  })
  return { url: source.url, headers: source.headers, type: source.type, qualityLabel: source.qualityLabel, quality: defaultQuality.quality, qualities, subtitles }
}

const resolveMpvEmbeddedExternalSubtitle = async (): Promise<{ url: string; title?: string } | undefined> => {
  if (!useMacEmbeddedMpv) return undefined
  if (useSettingStore().uiVideoSubtitleMode !== 'auto') return undefined
  if (pageVideo.drive_id === 'local' || pageVideo.drive_id === 'media_server') return undefined
  if (!pageVideo.parent_file_id || !pageVideo.file_name) return undefined

  const subtitleFiles = await getSubtitleFileList(useSettingStore().mediaLibrarySubtitleScope === 'include-subfolders')
  if (!subtitleFiles.length) return undefined
  const subtitleFile = PlayerUtils.filterSubtitleFile(pageVideo.file_name, subtitleFiles as any) as selectorItem | undefined
  if (!subtitleFile?.file_id) return undefined

  const subtitleUrl = await resolveCloudSubtitleUrl(subtitleFile)
  if (!subtitleUrl) return undefined

  return {
    url: subtitleUrl,
    title: subtitleFile.name || subtitleFile.html || t('video.autoSubtitle')
  }
}

const loadMpvEmbeddedCurrentVideo = async (resumePosition = pageVideo.play_cursor || 0) => {
  const storedProgress = getLocalVideoProgress(pageVideo.user_id, pageVideo.drive_id, pageVideo.file_id)
  resumePosition = Math.max(Number(resumePosition) || 0, storedProgress)
  pageVideo.play_cursor = Math.max(Number(pageVideo.play_cursor) || 0, storedProgress)
  const source = await resolvePageVideoMpvSource()
  if (source.error || !source.url) {
    mpvEmbeddedError.value = source.error || t('video.getMpvUrlFailed')
    message.error(mpvEmbeddedError.value)
    return false
  }
  mpvEmbeddedError.value = ''
  mpvEmbeddedStartPosition.value = Math.max(0, Math.floor(Number(resumePosition) || 0))
  mpvEmbeddedUrl.value = source.url
  mpvEmbeddedHeaders.value = source.headers || {}
  mpvEmbeddedQualityLabel.value = source.qualityLabel || ''
  mpvEmbeddedQuality.value = source.quality || ''
  mpvEmbeddedQualities.value = source.qualities || []
  console.info('[播放][MPV] 当前播放链接', {
    quality: source.quality || '',
    qualityLabel: source.qualityLabel || '',
    url: source.url,
    position: mpvEmbeddedStartPosition.value,
    hasAuthorization: Boolean(source.headers && Object.keys(source.headers).some((key) => key.toLowerCase() === 'authorization')),
    userAgent: source.headers && Object.entries(source.headers).find(([key]) => key.toLowerCase() === 'user-agent')?.[1] || ''
  })
  try {
    const subtitleSources = [...(source.subtitles || [])]
    const externalSubtitle = await resolveMpvEmbeddedExternalSubtitle()
    if (externalSubtitle && !subtitleSources.some((item) => item.url === externalSubtitle.url)) subtitleSources.push(externalSubtitle)
    mpvEmbeddedSubtitleSources.value = subtitleSources
  } catch (error) {
    console.warn('MPV 自动加载同目录字幕失败:', error)
    mpvEmbeddedSubtitleSources.value = source.subtitles || []
  }
  return true
}

const handleMpvEmbeddedQualitySelect = async (quality: string) => {
  if (!quality || quality === mpvEmbeddedQuality.value) return
  const status = await window.WebMpvEmbeddedStatus?.().catch(() => undefined)
  const position = Math.max(
    Number(status?.status?.position || 0),
    Number(mpvEmbeddedStatus.value?.position || 0),
    Number(pageVideo.play_cursor || 0),
    getLocalVideoProgress(pageVideo.user_id, pageVideo.drive_id, pageVideo.file_id)
  )
  pageVideo.play_cursor = Number.isFinite(position) && position > 0 ? Math.floor(position) : 0
  const resumePosition = pageVideo.play_cursor
  saveLocalVideoProgress(pageVideo.user_id, pageVideo.drive_id, pageVideo.file_id, pageVideo.play_cursor)
  console.info('[播放][MPV] 切换清晰度前保存进度', {
    quality,
    position: pageVideo.play_cursor,
    source: status?.status?.position || mpvEmbeddedStatus.value?.position ? 'mpv-status' : 'shared-progress'
  })
  mpvEmbeddedQuality.value = quality
  await loadMpvEmbeddedCurrentVideo(resumePosition)
}

const applyPlaylistItemToPageVideo = (item: selectorItem) => {
  pageVideo.html = item.html
  pageVideo.play_cursor = item.play_cursor || 0
  pageVideo.file_name = item.name || item.html
  pageVideo.file_id = item.file_id || ''
  if (item.user_id) pageVideo.user_id = item.user_id
  if (item.drive_id) pageVideo.drive_id = item.drive_id
  if (item.parent_file_id) pageVideo.parent_file_id = item.parent_file_id
  if (typeof item.password === 'string') pageVideo.password = item.password
  if (typeof item.encType === 'string' && item.encType) {
    pageVideo.encType = getEncType({ description: item.encType })
  } else if (item.description) {
    pageVideo.encType = getEncType({ description: item.description })
  }
  autoPlayNumber = playList.findIndex(list => list.file_id == pageVideo.file_id)
  updateWindowTitle(pageVideo.file_name)
}

const switchMpvEmbeddedPlaylistItem = async (item: selectorItem) => {
  if (!item.file_id || item.file_id === pageVideo.file_id) return
  const position = mpvEmbeddedStatus.value?.position || pageVideo.play_cursor || 0
  const duration = mpvEmbeddedStatus.value?.duration || 0
  if (pageVideo.drive_id === 'media_server') {
    if (position > 0) {
      await sendMediaServerProgressReport(position)
      await sendMediaServerStopReport(position)
    }
    await switchMpvMediaServerPlaylistItem(item)
    return
  }
  if (position > 0) await persistVideoProgress(position, duration, true)
  applyPlaylistItemToPageVideo(item)
  await buildPageVideoPlayList(item.file_id)
  await loadMpvEmbeddedCurrentVideo()
}

const switchMpvMediaServerPlaylistItem = async (item: selectorItem) => {
  const server = getCurrentMediaServer()
  const nextItemId = item.file_id || ''
  if (!server || !nextItemId) {
    mpvEmbeddedError.value = t('video.mediaServerEpisodeIncomplete')
    message.error(mpvEmbeddedError.value)
    return
  }

  try {
    const detail = await getMediaServerItemDetail(server, nextItemId)
    pageVideo.file_id = detail.id
    pageVideo.media_server_item_id = detail.id
    const state = await loadMediaServerSourceState('')
    const playback = await getMediaServerPlaybackInfo(
      server,
      detail.id,
      state?.sourceId || '',
      state?.videoStreamIndex ?? -1,
      state?.audioStreamIndex ?? -1,
      state?.subtitleStreamIndex ?? -1,
      useSettingStore().uiMediaServerVideoQuality,
      useSettingStore().uiMediaServerCompatibilityMode,
      useSettingStore().uiMediaServerCustomDeviceProfile,
      useSettingStore().uiMediaServerBitrateTestSize
    )

    pageVideo.file_name = detail.title
    pageVideo.html = detail.title
    pageVideo.parent_file_name = detail.parentTitle || pageVideo.parent_file_name
    pageVideo.play_cursor = playback.playCursorSeconds || 0
    pageVideo.media_url = playback.url
    pageVideo.media_headers = playback.headers
    pageVideo.media_subtitle_sources = playback.subtitleSources || []
    pageVideo.media_server_tracks_selectable = playback.tracksSelectable === true
    pageVideo.media_server_source_id = state?.sourceId || ''
    pageVideo.media_server_source_label = state?.sourceLabel || ''
    pageVideo.media_server_play_session_id = playback.playSessionId || ''
    mediaServerReportStarted = false
    mediaServerStopReported = false
    mediaServerLastProgressSecond = -1
    updateWindowTitle(detail.title)
    await buildPageVideoPlayList(detail.id)
    if (await loadMpvEmbeddedCurrentVideo()) await sendMediaServerStartReport(pageVideo.play_cursor || 0)
  } catch (error: any) {
    console.error('MPV 切换媒体服务器剧集失败:', error)
    mpvEmbeddedError.value = error?.message || t('video.switchEpisodeFailed')
    message.error(mpvEmbeddedError.value)
  }
}

const handleMpvPlaylistSelect = async (fileId: string) => {
  const item = playList.find((list) => list.file_id === fileId)
  if (item) await switchMpvEmbeddedPlaylistItem(item)
}

const handleMpvPlaylistStep = async (step: number) => {
  if (!playList.length) return
  const currentIndex = playList.findIndex((list) => list.file_id === pageVideo.file_id)
  const nextIndex = currentIndex + step
  if (nextIndex < 0 || nextIndex >= playList.length) return
  await switchMpvEmbeddedPlaylistItem(playList[nextIndex])
}

const getVideoInfo = async (art: Artplayer) => {
  if (pageVideo.drive_id === 'local') {
    const urlModule = window.require?.('url')
    const filePath = pageVideo.file_id || (pageVideo as any).file_path || ''
    if (filePath) {
      const fileUrl = urlModule?.pathToFileURL ? urlModule.pathToFileURL(filePath).href : `file://${encodeURI(filePath)}`
      setArtVideoUrl(art, fileUrl)
      return
    }
  }
  if (pageVideo.drive_id === 'media_server') {
    if (!(pageVideo.media_server_source_options || []).length) {
      try {
        await loadMediaServerSourceState(pageVideo.media_server_source_id || '')
      } catch (error) {
        console.error('加载媒体服务器版本信息失败:', error)
      }
    }
    const mediaUrl = pageVideo.media_url || ''
    if (!mediaUrl) {
      art.url = ''
      art.notice.show = t('video.getMediaServerUrlFailed')
      art.emit('video:error', t('video.getMediaServerUrlFailed'))
      return
    }
    setArtVideoUrl(art, resolveHeaderAwareVideoUrl(mediaUrl, pageVideo.media_headers, 0, 'media_server'), getArtVideoType(mediaUrl))
    await loadMediaServerWebSubtitle(art, findMediaServerStreamIndex(pageVideo.media_server_subtitle_options, pageVideo.media_server_subtitle_label))
    renderMediaServerControls(art)
    return
  }
  // 获取视频链接
  const data: string | IRawUrl = await getRawUrl(pageVideo.user_id, pageVideo.drive_id, pageVideo.file_id, pageVideo.encType, pageVideo.password, false, 'video', '', 'thirdParty', pageVideo.tokenfrom)
  if (typeof data != 'string' && data.qualities.length > 0) {
    // 画质
    let uiVideoQuality = useSettingStore().uiVideoQuality
    let defaultQuality: selectorItem
    if (uiVideoQuality === 'Origin' && pageVideo.drive_id != 'baidu' && pageVideo.drive_id != 'drive115') {
      defaultQuality = data.qualities[0]
    } else {
      defaultQuality = resolvePreferredVideoQuality(data.qualities, uiVideoQuality)
    }
    const defaultHeaders = mergePlaybackHeaders(data.headers, defaultQuality.headers)
    const defaultUrl = resolveHeaderAwareVideoUrl(defaultQuality.url, defaultHeaders, data.size, defaultQuality.quality || '')
    setArtVideoUrl(art, defaultUrl, defaultQuality.type)
    defaultQuality.default = true
    pageVideo.expire_time = GetExpiresTime(defaultQuality.url)
    art.controls.update({
      name: 'quality',
      index: 20,
      position: 'right',
      style: { marginRight: '15px' },
      html: defaultQuality ? defaultQuality.html : '',
      selector: data.qualities,
      onSelect: (selector: any, element: HTMLElement, event: Event) => {
        const item = selector as selectorItem
        const playbackState = captureVideoQualitySwitchPlaybackState(!art.video.paused && !art.video.ended, art.video.currentTime)
        const artType = getArtVideoType(item.url, item.type)
        art.type = artType as any
        if (!isHlsVideoType(artType)) destroyArtHls(art)
        if (!isDashVideoType(artType)) destroyArtDash(art)
        const itemHeaders = mergePlaybackHeaders(data.headers, item.headers)
        const itemUrl = resolveHeaderAwareVideoUrl(item.url, itemHeaders, data.size, item.quality || '')
        console.info('[播放][网页] 切换清晰度链接', {
          quality: item.quality || '',
          qualityLabel: item.html || '',
          url: itemUrl,
          position: playbackState.position,
          shouldResume: playbackState.shouldResume
        })
        let positionRestored = false
        const switchGeneration = ++qualitySwitchGeneration
        const restorePlayback = async () => {
          if (switchGeneration !== qualitySwitchGeneration) return
          if (playbackState.position > 0 && !positionRestored) {
            art.currentTime = playbackState.position
            positionRestored = true
          }
          if (playbackState.shouldResume && art.video.paused) await art.play().catch(() => undefined)
        }
        const handleQualityCanPlay = () => {
          void restorePlayback()
        }
        const handleQualityError = () => {
          art.off('video:canplay', handleQualityCanPlay)
        }
        art.once('video:canplay', handleQualityCanPlay)
        art.once('video:error', handleQualityError)
        art.switchQuality(itemUrl).then(async () => {
          if (switchGeneration !== qualitySwitchGeneration) return
          art.off('video:canplay', handleQualityCanPlay)
          art.off('video:error', handleQualityError)
          scheduleCleanupInactiveStreamingControls(art)
          art.playbackRate = playbackRate
          await restorePlayback()
          if (switchGeneration === qualitySwitchGeneration) qualitySwitchGeneration = 0
          console.info('[播放][网页] 已切换播放链接', {
            quality: item.quality || '',
            url: art.video?.currentSrc || art.url || itemUrl,
            position: art.currentTime,
            playing: art.playing
          })
        }).catch((error) => {
          if (switchGeneration === qualitySwitchGeneration) qualitySwitchGeneration = 0
          art.off('video:canplay', handleQualityCanPlay)
          art.off('video:error', handleQualityError)
          console.error('[播放][网页] 切换播放链接失败', { quality: item.quality || '', url: itemUrl, error })
        })
        return item.html
      }
    })
    // 内嵌字幕
    const subtitles = data.subtitles || []
    if (subtitles.length > 0) {
      embedSubSelector = []
      for (let i = 0; i < subtitles.length; i++) {
        const subtitle = subtitles[i]
        const subtitleUrl = hasPlaybackHeaders(subtitle.headers)
          ? getProxyUrl({
            user_id: pageVideo.user_id,
            drive_id: pageVideo.drive_id,
            file_id: pageVideo.file_id,
            proxy_kind: 'subtitle',
            proxy_url: subtitle.url,
            proxy_headers: JSON.stringify(subtitle.headers)
          })
          : subtitle.url
        embedSubSelector.push({
          html: formatEmbeddedSubtitleLabel(subtitle.language, locale.value),
          name: formatEmbeddedSubtitleLabel(subtitle.language, locale.value),
          ext: getSubtitleExtension(subtitle.url),
          url: subtitleUrl,
          default: i === 0
        })
      }
    }
    // 字幕列表
    await getSubTitleList(art)
  } else {
    const errorMessage = typeof data === 'string' ? data : t('video.getVideoUrlFailed')
    if (typeof data === 'string') message.error(errorMessage)
    art.url = ''
    art.notice.show = errorMessage
    art.emit('video:error', errorMessage)
  }
}

const playList = reactive<selectorItem[]>([])
const isVideoPlaylistItem = isVideoFile
const buildPageVideoPlayList = async (file_id?: string) => {
  if (pageVideo.drive_id === 'media_server') {
    const entries = pageVideo.media_server_episode_playlist || []
    if (entries.length <= 1) return
    const currentItemId = file_id || pageVideo.media_server_item_id || pageVideo.file_id
    playList.splice(0, playList.length, ...entries.map((item) => ({
      url: '',
      html: item.title,
      name: item.title,
      file_id: item.id,
      default: item.id === currentItemId
    })))
    return
  }

  if (pageVideo.custom_playlist && pageVideo.custom_playlist.length > 1) {
    if (!file_id) {
      playList.splice(0, playList.length, ...pageVideo.custom_playlist.map((item) => ({
        url: '',
        html: item.html || path.parse(item.file_name).name,
        name: item.file_name,
        file_id: item.file_id,
        ext: item.ext,
        description: item.description,
        play_cursor: item.play_cursor,
        user_id: item.user_id,
        tokenfrom: item.tokenfrom || pageVideo.tokenfrom,
        drive_id: item.drive_id,
        parent_file_id: item.parent_file_id,
        password: item.password,
        encType: item.encType,
        default: item.file_id === pageVideo.file_id
      })))
    } else {
      for (let list of playList) {
        if (list.file_id === file_id) {
          list.default = true
          break
        }
      }
    }
    return
  }

  if (pageVideo.drive_id === 'local') {
    const fs = window.require?.('fs')
    const pathModule = window.require?.('path')
    const currentPath = pageVideo.file_id || (pageVideo as any).file_path || ''
    const directory = currentPath && pathModule?.dirname ? pathModule.dirname(currentPath) : ''
    if (!fs?.readdirSync || !pathModule || !directory) {
      playList.splice(0, playList.length)
      return
    }

    const videoExtensions = /\.(3gp|avi|flv|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|ts|webm|wmv)$/i
    try {
      const localItems = fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry: any) => entry.isFile?.() && videoExtensions.test(entry.name))
        .map((entry: any) => {
          const filePath = pathModule.join(directory, entry.name)
          return {
            url: '',
            html: pathModule.parse(entry.name).name,
            name: entry.name,
            file_id: filePath,
            drive_id: 'local',
            parent_file_id: directory,
            default: filePath === currentPath
          }
        })
        .sort((left: selectorItem, right: selectorItem) => String(left.name || '').localeCompare(String(right.name || ''), undefined, { numeric: true, sensitivity: 'base' }))
      playList.splice(0, playList.length, ...localItems)
    } catch (error) {
      console.warn('读取本地视频播放列表失败:', error)
      playList.splice(0, playList.length)
    }
    return
  }

  if (!file_id) {
    const rawFolderItems = (usePanFileStore().ListDataRaw || []).filter((item: any) => !item.isDir)
    const currentFolderItems = rawFolderItems.filter((item: any) => item.parent_file_id === pageVideo.parent_file_id)
    const rawVideoItems = (currentFolderItems.length > 1 ? currentFolderItems : rawFolderItems).filter(isVideoPlaylistItem)
    let fileList: any[] = rawVideoItems.length > 1
      ? rawVideoItems
      : await getDirFileList(pageVideo.parent_file_id, false, '', undefined, true) || []
    const videoFiles = fileList.filter(isVideoPlaylistItem)
    const currentFileInList = videoFiles.some((item) => item.file_id === pageVideo.file_id)
    if (!currentFileInList && pageVideo.file_id && pageVideo.file_name) {
      videoFiles.push({
        html: path.parse(pageVideo.file_name).name,
        name: pageVideo.file_name,
        file_id: pageVideo.file_id,
        drive_id: pageVideo.drive_id,
        parent_file_id: pageVideo.parent_file_id,
        default: true
      })
    }
    videoFiles.sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), undefined, { numeric: true, sensitivity: 'base' }))
    if (videoFiles.length > 0) {
      playList.splice(0, playList.length)
      for (let i = 0; i < videoFiles.length; i++) {
        const file = videoFiles[i]
        let fileExt = file.ext
        let fileName = file.name
        let html = path.parse(fileName).name
        playList.push({
          url: '',
          html: html,
          name: file.name,
          file_id: file.file_id,
          ext: fileExt,
          description: file.description,
          play_cursor: file.play_cursor,
          user_id: pageVideo.user_id,
          drive_id: file.drive_id || pageVideo.drive_id,
          parent_file_id: file.parent_file_id || pageVideo.parent_file_id,
          default: file.file_id === pageVideo.file_id
        })
      }
    }
  } else {
    for (let list of playList) {
      if (list.file_id === file_id) {
        list.default = true
        break
      }
    }
  }
}

const refreshPlayList = async (art: Artplayer, file_id?: string) => {
  if (pageVideo.drive_id === 'local') return
  if (pageVideo.drive_id === 'media_server') {
    await refreshMediaServerPlayList(art, file_id)
    return
  }
  await buildPageVideoPlayList(file_id)
  if (playList.length > 1) {
    autoPlayNumber = playList.findIndex(list => list.file_id == pageVideo.file_id)
    lastPlayNumber = autoPlayNumber - 1
    let curPlayTitle = playList[autoPlayNumber].html
    art.controls.update({
      name: 'playList',
      index: 10,
      position: 'right',
      style: { padding: '0 10px', marginRight: '10px' },
      html: handlerPlayTitle(curPlayTitle),
      tooltip: pageVideo.custom_playlist_label || '',
      selector: playList,
      mounted: (element: HTMLElement) => {
        const panel = element as HTMLDivElement
        const $current = Artplayer.utils.queryAll('.art-selector-item', panel)
          .find((item) => Number((item as HTMLElement).dataset.index) == autoPlayNumber)
        if ($current) Artplayer.utils.addClass($current as HTMLElement, 'art-list-icon')
      },
      onSelect: (selector: any, element: HTMLElement, event: Event) => {
        const item = selector as selectorItem
        updateVideoTime().then(() => {
          refreshSetting(art, item).then(() => {
            lastPlayNumber = autoPlayNumber - 1
            Artplayer.utils.inverseClass(element, 'art-list-icon')
            void autoLoadDanmaku(art)
          })
        })
        return handlerPlayTitle(item.html)
      }
    })
  }
}

const handlerPlayTitle = (html: string) => {
  return (html.length > 15 ? html.substring(0, 10) + '...' : html)
}

const getVideoCursor = async (art: Artplayer, play_cursor?: number) => {
  const autoSkipBegin = art.storage.get('autoSkipBegin') as number
  if (art.storage.get('autoJumpCursor')) {
    let cursor = 0
    // 进度
    if (play_cursor) {
      cursor = play_cursor
    } else {
      const info = await PlayerUtils.getPlayCursor(pageVideo.user_id, pageVideo.drive_id, pageVideo.file_id)
      if (info?.play_cursor) {
        cursor = info.play_cursor as number
      } else if (info?.info?.user_meta) {
        const meta = JSON.parse(info?.info?.user_meta)
        if (meta.play_cursor) {
          cursor = parseFloat(meta.play_cursor)
        }
      }
    }
    cursor = Math.max(cursor, getLocalVideoProgress(pageVideo.user_id, pageVideo.drive_id, pageVideo.file_id))
    // 防止无效跳转
    if (cursor >= art.duration) {
      cursor = art.duration - 60
    }
    if (cursor > autoSkipBegin) {
      art.currentTime = cursor
    } else {
      art.currentTime = autoSkipBegin
    }
  } else {
    art.currentTime = autoSkipBegin
  }
}

let onlineSubData: any = { name: '', data: '', dataUrl: '', ext: '' }

let multipleSubtitleBlobUrls: string[] = []
let multipleSubtitleMode = 'single'

const applyMultipleSubtitleStyle = () => {
  const style = `
.art-subtitle-primary {
  color: #ffffff;
  font-size: 1em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, .85);
}

.art-subtitle-secondary {
  color: #ffd859;
  font-size: .82em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, .85);
}
`
  const oldStyle = document.getElementById('artplayer-multiple-subtitle-style')
  if (oldStyle) {
    oldStyle.textContent = style
    return
  }
  const styleElement = document.createElement('style')
  styleElement.id = 'artplayer-multiple-subtitle-style'
  styleElement.textContent = style
  document.head.appendChild(styleElement)
}

const cleanupMultipleSubtitleBlobs = () => {
  multipleSubtitleBlobUrls.forEach((url) => URL.revokeObjectURL(url))
  multipleSubtitleBlobUrls = []
}

const clearMultipleSubtitleState = (art: Artplayer) => {
  ;(art.plugins as any).multipleSubtitles?.tracks?.([])
  cleanupMultipleSubtitleBlobs()
  multipleSubtitleMode = 'single'
}

const isMultipleSubtitleSupported = (item: selectorItem) => {
  const ext = getSubtitleItemExt(item)
  return ['srt', 'vtt'].includes(ext) && (!!item.url || !!item.file_id || typeof item.data === 'string')
}

const readSubtitleItemText = async (item: selectorItem) => {
  if (!item.file_id) return ''
  const url = await resolveCloudSubtitleUrl(item)
  if (!url) throw new Error(`Unable to resolve subtitle URL: ${item.name || item.html}`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Subtitle request failed: HTTP ${response.status}`)
  const data = decodeSubtitleBuffer(await response.arrayBuffer())
  if (!data.trim()) throw new Error(`Subtitle response is empty: ${item.name || item.html}`)
  return data
}

const resolveCloudSubtitleUrl = async (item: selectorItem): Promise<string> => {
  if (!item.file_id) return item.url || ''
  const userId = item.user_id || pageVideo.user_id
  const driveId = item.drive_id || pageVideo.drive_id
  const tokenfrom = item.tokenfrom || (userId === pageVideo.user_id ? pageVideo.tokenfrom : '')
  const data = await DriveFile.ApiFileDownloadUrl(userId, driveId, item.file_id, 14400, tokenfrom)
  if (typeof data === 'string' || !data.url) return ''
  const provider = resolveDriveProvider(userId, driveId, tokenfrom).provider
  const playbackHeaders = useMacEmbeddedMpv ? mergeMpvPlaybackHeaders(provider, data.headers) : data.headers
  return getProxyUrl({
    user_id: userId,
    drive_id: driveId,
    file_id: item.file_id,
    encType: item.encType,
    password: item.password || pageVideo.password,
    file_size: data.size,
    quality: 'Origin',
    proxy_kind: 'subtitle',
    proxy_url: data.url,
    proxy_headers: hasPlaybackHeaders(playbackHeaders) ? JSON.stringify(playbackHeaders) : undefined
  })
}

const buildMultipleSubtitleTrack = async (art: Artplayer, item: selectorItem, index: number): Promise<MultipleSubtitleTrack | undefined> => {
  const ext = getSubtitleItemExt(item)
  if (ext !== 'srt' && ext !== 'vtt') return undefined
  const label = item.name || item.html || t('video.subtitleIndex', { index: index + 1 })
  if (item.url) {
    return {
      name: index === 0 ? 'primary' : 'secondary',
      label,
      url: item.url,
      type: ext
    }
  }
  if (typeof item.data === 'string') {
    const url = URL.createObjectURL(new Blob([item.data], { type: ext }))
    multipleSubtitleBlobUrls.push(url)
    return {
      name: index === 0 ? 'primary' : 'secondary',
      label,
      url,
      type: ext
    }
  }
  const data = await readSubtitleItemText(item)
  if (!data) return undefined
  const url = URL.createObjectURL(new Blob([data], { type: ext }))
  multipleSubtitleBlobUrls.push(url)
  return {
    name: index === 0 ? 'primary' : 'secondary',
    label,
    url,
    type: ext
  }
}

const applyMultipleSubtitles = async (art: Artplayer, items: selectorItem[], reverse = false) => {
  const subtitleItems = [...items]
  if (reverse) subtitleItems.reverse()
  clearMultipleSubtitleState(art)
  clearJassubSubtitle(art)
  const tracks = (await Promise.all(
    subtitleItems.slice(0, 2).map((item, index) => buildMultipleSubtitleTrack(art, item, index))
  )).filter(Boolean) as MultipleSubtitleTrack[]
  if (tracks.length < 2) {
    art.notice.show = t('video.needTwoSubtitles')
    return false
  }
  applyMultipleSubtitleStyle()
  const plugin = await artplayerPluginMultipleSubtitles({
    subtitles: tracks.map((track) => ({
      name: track.name,
      url: track.url,
      type: track.type
    }))
  })(art) as any
  ;(art.plugins as any).multipleSubtitles = plugin
  ;(art.plugins as any).multipleSubtitles.tracks(tracks.map((track) => track.name))
  art.subtitle.show = true
  multipleSubtitleMode = reverse ? 'reverse' : 'double'
  art.notice.show = t('video.loadedDualSubtitles', { tracks: tracks.map((track) => track.label).join(' / ') })
  return true
}

const loadOnlineSub = async (art: Artplayer, item: selectorItem) => {
  clearMultipleSubtitleState(art)
  const data = await readSubtitleItemText(item)
  await loadSubtitleTextToPlayer(art, item.name || item.html, getSubtitleItemExt(item), data)
  return item.html
}

const loadSubtitleItem = async (art: Artplayer, item: selectorItem) => {
  return item.file_id
    ? loadOnlineSub(art, item)
    : loadSubtitleUrlToPlayer(art, item)
}

const updateSubtitleListControl = (art: Artplayer, subSelector: selectorItem[], subDefault: selectorItem) => {
  art.controls.update({
    name: 'subtitleListControl',
    index: 20,
    position: 'right',
    style: { padding: '0 10px', marginRight: '8px', opacity: '0.92' },
    html: t('video.subtitle'),
    tooltip: hasSubtitleSource(subDefault) ? subDefault.html : t('video.noAvailableSubtitle'),
    selector: subSelector,
    onSelect: async (selector: any, element: HTMLElement) => {
      const item = selector as selectorItem
      if (!hasSubtitleSource(item)) {
        art.notice.show = t('video.noAvailableSubtitle')
        Artplayer.utils.removeClass(element, 'art-current')
        return t('video.subtitle')
      }
      if (!art.subtitle.show) art.subtitle.show = true
      try {
        art.notice.show = ''
        await loadSubtitleItem(art, item)
        return t('video.subtitle')
      } catch (error) {
        console.error('加载字幕失败:', error)
        art.notice.show = `加载${item.name || item.html}字幕失败`
        Artplayer.utils.removeClass(element, 'art-current')
        return t('video.subtitle')
      }
    }
  })
}

// 内嵌字幕
let embedSubSelector: selectorItem[] = []
let downloadedSubSelector: selectorItem[] = []

const clearDownloadedSubtitleSelector = () => {
  downloadedSubSelector = []
}

const getSubTitleList = async (art: Artplayer, autoLoad = true) => {
  // Load subtitles from the video folder and each immediate child folder.
  let subSelector: selectorItem[]
  const includeSubfolders = useSettingStore().mediaLibrarySubtitleScope === 'include-subfolders'
  const onlineSubSelector = await getSubtitleFileList(includeSubfolders)
  // console.log('onlineSubSelector', onlineSubSelector)
  subSelector = dedupeSubtitleSelectors([...embedSubSelector, ...onlineSubSelector, ...downloadedSubSelector])
  if (subSelector.length === 0) {
    subSelector.push({ html: t('video.noAvailableSubtitle'), name: '', url: '', default: true })
  } else {
    let subtitleSize = art.storage.get('subtitleSize') + 'px'
    const hasDownloadedDefault = downloadedSubSelector.some((item) => item.default)
    if (autoLoad && onlineSubSelector.length > 0 && !hasDownloadedDefault) {
      const fileName = pageVideo.file_name
      // 自动加载同名字幕
      const similarity = subSelector.reduce((min, item, index) => {
        // 莱文斯坦距离算法(计算相似度)
        const distance = levenshtein.get(fileName, item.html, { useCollator: true })
        if (distance < min.distance) {
          min.distance = distance
          min.index = index
        }
        return min
      }, { distance: Infinity, index: -1 })
      if (similarity.index !== -1) {
        subSelector.forEach(v => v.default = false)
        subSelector[similarity.index].default = true
        art.subtitle.style('fontSize', subtitleSize)
        await loadSubtitleItem(art, subSelector[similarity.index])
      }
    } else if (autoLoad && embedSubSelector.length > 0 && !hasDownloadedDefault) {
      await loadSubtitleUrlToPlayer(art, embedSubSelector[0])
      art.subtitle.style('fontSize', subtitleSize)
    }
  }
  if (!autoLoad && onlineSubData.name) {
    const current = subSelector.find((item) => (item.name || item.html) === onlineSubData.name)
    if (current) {
      subSelector.forEach((item) => { item.default = item === current })
    }
  }
  const subDefault = subSelector.find((item) => item.default) || subSelector[0]
  updateSubtitleListControl(art, subSelector, subDefault)
  const multipleSubtitleCandidates = subSelector.filter(isMultipleSubtitleSupported)
  const subtitleTranslate = art.storage.get('subtitleTranslate')
  // 字幕设置面板
  updateSettingPreservingActivePanel(art.setting as any, {
    name: 'Subtitle',
    html: t('video.subtitleSettings'),
    tooltip: art.subtitle.show ? (hasSubtitleSource(subDefault) ? t('video.subtitleOn') : subDefault.html) : t('video.subtitleOff'),
    selector: [{
      html: t('video.subtitleSwitch'),
      icon: art.icons.pip,
      tooltip: hasSubtitleSource(subDefault) ? t('video.on') : t('video.off'),
      switch: hasSubtitleSource(subDefault),
      onSwitch: (item: SettingOption) => {
        if (hasSubtitleSource(subDefault)) {
          item.tooltip = item.switch ? t('video.off') : t('video.on')
          art.subtitle.show = !item.switch
          if (isAssSubtitleType(onlineSubData.ext)) setJassubVisible(art, !item.switch)
          art.notice.show = t('video.subtitle') + item.tooltip
          let subtitleSize = art.storage.get('subtitleSize') + 'px'
          art.subtitle.style('fontSize', subtitleSize)
          let currentItem = Artplayer.utils.queryAll('.art-setting-panel.art-current .art-setting-item:nth-of-type(n+3)')
          if (currentItem.length > 0) {
            currentItem.forEach((current: Element) => {
              const currentElement = current as HTMLElement
              if (item.switch) {
                !art.subtitle.url && Artplayer.utils.removeClass(currentElement, 'art-current')
                Artplayer.utils.addClass(currentElement, 'disable')
                if (item.$parent) item.$parent.tooltip = hasSubtitleSource(subDefault) ? t('video.subtitleOn') : subDefault.html
              } else {
                if (item.$parent) item.$parent.tooltip = t('video.subtitleOn')
                Artplayer.utils.removeClass(currentElement, 'disable')
              }
            })
          }
          return !item.switch
        } else {
          return false
        }
      }
    }, {
      html: t('video.subtitleTraditionalConvert'),
      tooltip: subtitleTranslate === 0 ? t('video.off') : (subtitleTranslate === 1 ? t('video.traditionalToSimplified') : t('video.simplifiedToTraditional')),
      selector: [{
        default: subtitleTranslate == 1,
        html: t('video.traditionalToSimplified'),
        subtitleTranslate: 1
      }, {
        default: subtitleTranslate == 2,
        html: t('video.simplifiedToTraditional'),
        subtitleTranslate: 2
      }, {
        default: subtitleTranslate == 0,
        html: t('video.off'),
        subtitleTranslate: 0
      }],
      onSelect: async (item: SettingOption) => {
        art.storage.set('subtitleTranslate', item.subtitleTranslate)
        // 字幕繁中转换
        if (onlineSubData.data) {
          let data = onlineSubData.data
          let tips = t('video.off')
          if (item.subtitleTranslate === 1) {
            data = traditionToSimple(onlineSubData.data)
            tips = t('video.subtitleTraditionalToSimplified')
          } else if (item.subtitleTranslate === 2) {
            data = simpleToTradition(onlineSubData.data)
            tips = t('video.subtitleSimplifiedToTraditional')
          }
          if (onlineSubData.dataUrl) URL.revokeObjectURL(onlineSubData.dataUrl)
          onlineSubData.dataUrl = URL.createObjectURL(
            new Blob([data], { type: onlineSubData.ext })
          )
          await switchSubtitleText(art, onlineSubData.name, onlineSubData.ext, data)
          art.notice.show = tips
        }
        return item.html
      }
    }, {
      html: t('video.importLocalSubtitle'),
      tooltip: t('video.importLocalSubtitle'),
      onClick: async (item: SettingOption) => {
        await importLocalSubtitle(art)
      }
    }, ...(multipleSubtitleCandidates.length >= 2 ? [{
      html: t('video.dualSubtitle'),
      tooltip: multipleSubtitleMode === 'double' ? t('video.on') : (multipleSubtitleMode === 'reverse' ? t('video.reverse') : t('video.off')),
      selector: [{
        default: multipleSubtitleMode === 'single',
        html: t('video.off'),
        mode: 'single'
      }, {
        default: multipleSubtitleMode === 'double',
        html: t('video.dualSubtitle'),
        mode: 'double'
      }, {
        default: multipleSubtitleMode === 'reverse',
        html: t('video.dualSubtitleReverse'),
        mode: 'reverse'
      }],
      onSelect: async (item: SettingOption) => {
        if (item.mode === 'single') {
          clearMultipleSubtitleState(art)
          if (subDefault.file_id) await loadOnlineSub(art, subDefault)
          else if (subDefault.url) await loadSubtitleUrlToPlayer(art, subDefault)
          art.notice.show = t('video.dualSubtitle') + t('video.off')
          return item.html
        }
        const ok = await applyMultipleSubtitles(art, multipleSubtitleCandidates.slice(0, 2), item.mode === 'reverse')
        if (ok && item.$parent) item.$parent.tooltip = item.mode === 'reverse' ? t('video.reverse') : t('video.on')
        return item.html
      }
    }] : []), {
      html: t('video.subtitleOffset'),
      tooltip: '0s',
      range: [0, -5, 10, 0.1],
      onChange(item: SettingOption) {
        art.subtitleOffset = item.range
        const instance = getJassubInstance(art)
        if (instance) instance.timeOffset = item.range
        return item.range + 's'
      }
    }, {
      html: t('video.subtitleSize'),
      tooltip: art.storage.get('subtitleSize') + 'px',
      range: [art.storage.get('subtitleSize'), 20, 50, 5],
      onChange: (item: SettingOption) => {
        let size = item.range + 'px'
        art.storage.set('subtitleSize', item.range)
        art.subtitle.style('fontSize', size)
        return size
      }
    }],
    onSelect: async (selector: any, element: HTMLElement, event: Event) => {
      const item = selector as selectorItem
      // Setting actions (for example “Import Local Subtitle”) also bubble here.
      // They are not subtitle sources and must never be handed to the subtitle loader.
      if (!hasSubtitleSource(item)) return false
      if (art.subtitle.show) {
        try {
          art.notice.show = ''
          return await loadSubtitleItem(art, item)
        } catch (error) {
          console.error('加载字幕失败:', error)
          art.notice.show = `加载${item.name || item.html}字幕失败`
          Artplayer.utils.removeClass(element, 'art-current')
          return false
        }
      } else {
        art.notice.show = t('video.subtitleNotEnabled')
        Artplayer.utils.removeClass(element, 'art-current')
        return false
      }
    }
  })
}

const updateVideoTime = async (positionSeconds = ArtPlayerRef?.currentTime || 0, durationSeconds = ArtPlayerRef?.duration || 0) => {
  if (pageVideo.drive_id === 'media_server') return
  if (isQuarkUser(pageVideo.user_id) || pageVideo.drive_id === 'quark') return
  await AliFile.ApiUpdateVideoTime(
    pageVideo.user_id,
    pageVideo.drive_id,
    pageVideo.file_id,
    positionSeconds
  )
  updateContinueWatching(positionSeconds, durationSeconds)
}

let lastVideoProgressSaveSecond = -1
let lastVideoProgressSaveKey = ''

const persistVideoProgress = async (positionSeconds: number, durationSeconds: number, force = false) => {
  if (pageVideo.drive_id === 'media_server') return
  const position = Number(positionSeconds || 0)
  if (!Number.isFinite(position) || position <= 0) return
  const key = `${pageVideo.user_id}:${pageVideo.drive_id}:${pageVideo.file_id}`
  if (key !== lastVideoProgressSaveKey) {
    lastVideoProgressSaveKey = key
    lastVideoProgressSaveSecond = -1
  }
  const second = Math.floor(position)
  saveLocalVideoProgress(pageVideo.user_id, pageVideo.drive_id, pageVideo.file_id, position)
  if (!force && second < 10) return
  if (!force && second === lastVideoProgressSaveSecond) return
  lastVideoProgressSaveSecond = second
  await updateVideoTime(position, durationSeconds)
}

const findMediaItemByFileId = (fileId: string): MediaLibraryItem | undefined => {
  for (const item of mediaStore.mediaItems) {
    if (item.driveFiles?.some(file => file.id === fileId)) {
      return item
    }
    const season = item.seasons?.find(s =>
      s.episodes?.some(ep => ep.driveFiles?.some(file => file.id === fileId))
    )
    if (season) {
      const episode = season.episodes?.find(ep => ep.driveFiles?.some(file => file.id === fileId))
      if (episode) {
        return {
          ...item,
          id: `${item.id}_${season.seasonNumber}_${episode.episodeNumber}`
        }
      }
    }
  }
  return undefined
}

const updateContinueWatching = (positionSeconds = ArtPlayerRef?.currentTime || 0, durationSeconds = ArtPlayerRef?.duration || 0) => {
  const fileId = pageVideo.file_id
  const item = findMediaItemByFileId(fileId)
  if (!item) return
  const duration = durationSeconds || 0
  const progress = duration > 0 ? positionSeconds / duration : 0
  item.watchProgress = Math.max(0, Math.min(1, progress))
  item.lastWatched = new Date()
  mediaStore.addToContinueWatching(item)
}

const handleMpvEmbeddedStatus = async (status: any) => {
  if (!useMacEmbeddedMpv || !status) return
  mpvEmbeddedStatus.value = status
  if (status.__loading) return
  const currentSecond = Math.floor(Number(status.position || 0))
  const duration = Number(status.duration || 0)
  if (currentSecond <= 0) return
  pageVideo.play_cursor = currentSecond
  if (pageVideo.expire_time && pageVideo.expire_time <= Date.now() + 60 * 1000) {
    pageVideo.expire_time = 0
    await loadMpvEmbeddedCurrentVideo()
    return
  }
  if (!status.paused && duration > 30 && duration - currentSecond <= 2 && playList.length > 1) {
    await handleMpvPlaylistStep(1)
    return
  }
  if (pageVideo.drive_id === 'media_server') {
    if (currentSecond % 10 === 0 && currentSecond !== mediaServerLastProgressSecond) {
      mediaServerLastProgressSecond = currentSecond
      await sendMediaServerProgressReport(currentSecond)
    }
    return
  }
  await persistVideoProgress(currentSecond, duration)
}

const handleHideClick = async () => {
  if (pageVideo.drive_id === 'media_server') {
    const mpvStatus = useMacEmbeddedMpv ? await window.WebMpvEmbeddedStatus?.().catch(() => undefined) : undefined
    await sendMediaServerStopReport(useMacEmbeddedMpv ? mpvStatus?.status?.position || pageVideo.play_cursor || 0 : ArtPlayerRef?.currentTime || 0)
  }
  if (useMacEmbeddedMpv) {
    const status = await window.WebMpvEmbeddedStatus?.().catch(() => undefined)
    const position = status?.status?.position || mpvEmbeddedStatus.value?.position || pageVideo.play_cursor || 0
    const duration = status?.status?.duration || mpvEmbeddedStatus.value?.duration || 0
    if (position > 0) await persistVideoProgress(position, duration, true)
    await window.WebMpvEmbeddedControl?.({ action: 'stop' }).catch(() => undefined)
    window.close()
    return
  }
  await ArtPlayerRef.emit('video:pause')
  await persistVideoProgress(ArtPlayerRef?.currentTime || 0, ArtPlayerRef?.duration || 0, true)
  window.close()
}
const handleMinClick = (_e: any) => {
  if (window.WebToWindow) window.WebToWindow({ cmd: 'minsize' })
}
const handleMaxClick = (_e: any) => {
  if (window.WebToWindow) window.WebToWindow({ cmd: 'maxsize' })
}
const handleTop = (_e: any) => {
  if (window.WebToWindow) window.WebToWindow({ cmd: 'top' }, (res: string) => {
    ArtPlayerRef.notice.show = res === 'top' ? t('video.windowTop') : t('video.windowUntop')
    isTop.value = res === 'top'
  })
}

onBeforeUnmount(() => {
  activeSearchModal?.close()
  activeSearchModal = undefined
  if (pageVideo.drive_id === 'media_server') {
    void sendMediaServerStopReport(useMacEmbeddedMpv ? mpvEmbeddedStatus.value?.position || pageVideo.play_cursor || 0 : ArtPlayerRef?.currentTime || 0)
  }
  if (useMacEmbeddedMpv) {
    const position = mpvEmbeddedStatus.value?.position || pageVideo.play_cursor || 0
    const duration = mpvEmbeddedStatus.value?.duration || 0
    if (position > 0) void persistVideoProgress(position, duration, true)
    void window.WebMpvEmbeddedControl?.({ action: 'stop' })
  } else if (ArtPlayerRef?.currentTime > 0) {
    // BrowserWindow may be closed by the system window button without going
    // through handleHideClick. Keep the shared progress synchronous.
    saveLocalVideoProgress(pageVideo.user_id, pageVideo.drive_id, pageVideo.file_id, ArtPlayerRef.currentTime)
  }
  if (onlineSubData.dataUrl) {
    URL.revokeObjectURL(onlineSubData.dataUrl)
  }
  onlineSubData.name = ''
  onlineSubData.data = ''
  onlineSubData.ext = ''
  cleanupMultipleSubtitleBlobs()
  autoPlayNumber = 0
  lastPlayNumber = -1
  playbackRate = 1
  longPressSpeed = 1
  ArtPlayerRef && ArtPlayerRef.destroy(false)
})

</script>

<template>
  <a-layout style='height: 100vh' draggable='false'>
    <a-layout-header id='xbyhead' draggable='false'>
      <div v-if="useMacEmbeddedMpv" class="mpv-video-titlebar q-electron-drag">
        <div class="mpv-window-controls">
          <button class="mpv-window-dot close" type="button" :aria-label="t('video.closeWindow')" @click.stop="handleHideClick"></button>
          <button class="mpv-window-dot min" type="button" :aria-label="t('video.minimizeWindow')" @click.stop="handleMinClick"></button>
          <button class="mpv-window-dot max" type="button" :aria-label="t('video.maximizeWindow')" @click.stop="handleMaxClick"></button>
        </div>
        <div class="mpv-window-title">{{ pageVideo?.file_name || t('video.onlinePreview') }}</div>
      </div>
      <div v-else id='xbyhead2' class='q-electron-drag'>
        <a-button type='text' tabindex='-1'>
          <IconFont name="iconfile_video" />
        </a-button>
        <div class='title'>{{ pageVideo?.file_name || t('video.onlinePreview') }}</div>
        <div class='flexauto'></div>
        <a-button type='text' tabindex='-1' :title="(isTop ? t('video.cancelTop') : t('video.top')) + ' Alt+T'" @click='handleTop'>
          <IconFont :name="(isTop ? 'iconquxiaozhiding' : 'iconzhiding')" />
        </a-button>
        <a-button type='text' tabindex='-1' :title="t('video.minimize') + ' Alt+M'" @click='handleMinClick'>
          <IconFont name="iconzuixiaohua" />
        </a-button>
        <a-button type='text' tabindex='-1' :title="t('video.maximize') + ' Alt+Enter'" @click='handleMaxClick'>
          <IconFont name="iconfullscreen" />
        </a-button>
        <a-button type='text' tabindex='-1' :title="t('video.close') + ' Alt+F4'" @click='handleHideClick'>
          <IconFont name="iconclose" />
        </a-button>
      </div>
    </a-layout-header>
    <a-layout-content>
      <MpvEmbeddedSurface
        v-if="useMacEmbeddedMpv && mpvEmbeddedUrl"
        id="mpvEmbeddedPlayer"
        :current-file-id="pageVideo.drive_id === 'media_server' ? pageVideo.media_server_item_id || pageVideo.file_id : pageVideo.file_id"
        :current-quality="mpvEmbeddedQuality"
        :chapters="pageVideo.media_server_chapters || []"
        :subtitle-sources="mpvEmbeddedSubtitleSources"
        :headers="mpvEmbeddedHeaders"
        :playlist="[...playList]"
        :qualities="mpvEmbeddedQualities"
        :quality-label="mpvEmbeddedQualityLabel"
        :start-position="mpvEmbeddedStartPosition || pageVideo.play_cursor || 0"
        :title="pageVideo.file_name"
        :url="mpvEmbeddedUrl"
        @error="(error) => mpvEmbeddedError = error"
        @quality-select="handleMpvEmbeddedQualitySelect"
        @playlist-next="handleMpvPlaylistStep(1)"
        @playlist-prev="handleMpvPlaylistStep(-1)"
        @playlist-select="handleMpvPlaylistSelect"
        @status="handleMpvEmbeddedStatus"
      />
      <div v-else-if="useMacEmbeddedMpv" id="mpvEmbeddedPlayer" class="mpv-embedded-page-error">{{ mpvEmbeddedError || t('video.preparingMpv') }}</div>
      <div v-else id='artPlayer' style='width: 100%; height: 100%;text-overflow: ellipsis;white-space: nowrap;' />
    </a-layout-content>
  </a-layout>
</template>

<style scoped lang="less">
.disable {
  cursor: not-allowed;
  pointer-events: none;
  background-color: transparent;
  color: #ACA899;
}

.mpv-embedded-page-error {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  background: #000;
  color: rgba(255, 255, 255, .72);
  font-size: 14px;
  font-weight: 600;
}

.mpv-video-titlebar {
  position: relative;
  display: flex;
  height: 40px;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, .08);
  background: rgba(23, 24, 26, .96);
  color: rgba(255, 255, 255, .72);
  z-index: 4;
}

.mpv-window-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 14px;
}

.mpv-window-dot {
  width: 12px;
  height: 12px;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  opacity: .92;
}

.mpv-window-dot:hover {
  opacity: 1;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, .1);
}

.mpv-window-dot.close { background: #ff5f57; }
.mpv-window-dot.min { background: #febc2e; }
.mpv-window-dot.max { background: #28c840; }

.mpv-window-title {
  position: absolute;
  left: 50%;
  max-width: 55%;
  overflow: hidden;
  color: rgba(255, 255, 255, .48);
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  transform: translateX(-50%);
  white-space: nowrap;
  pointer-events: none;
}

.art-list-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.art-list-icon:before {
  content: '\2713';
  font-size: 20px;
  font-weight: bold;
  color: white;
}

:deep(.art-notice) {
  height: 8% !important;
  justify-content: center;
  align-items: center;

  .art-notice-inner {
    background-color: rgba(33, 33, 33, .9);
    color: #fff;
    border-radius: 4px;
    font-size: 16px;
    font-weight: bold;
  }
}

:deep(#artPlayer .JASSUB) {
  position: absolute !important;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 20;
}

:deep(#artPlayer .JASSUB canvas) {
  pointer-events: none;
  transform: translateY(-5%);
}

.danmaku-modal {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background:
    radial-gradient(circle at 34% 18%, rgba(255, 255, 255, .035), transparent 26%),
    linear-gradient(135deg, #1b1b1b 0%, #242424 48%, #181818 100%);
  color: #f1f1f1;
}

.danmaku-full-header {
  position: relative;
  display: flex;
  height: 72px;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid rgba(255, 255, 255, .12);
}

.danmaku-close-button {
  position: absolute;
  left: 32px;
  top: 18px;
  display: flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, .7);
  color: #242424;
  cursor: pointer;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.danmaku-close-button:hover {
  background: rgba(255, 255, 255, .9);
}

.danmaku-full-title {
  color: #f2f2f2;
  font-size: 34px;
  font-weight: 800;
  letter-spacing: 0;
}

.danmaku-full-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 28px;
  padding: 36px;
}

.danmaku-full-content-episodes {
  padding-top: 34px;
}

.danmaku-searchbar {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr) 210px;
  gap: 24px;
  align-items: center;
  padding: 28px;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 22px;
  background: rgba(255, 255, 255, .045);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .04);
}

.danmaku-search-input,
.danmaku-api-select,
.danmaku-search-button {
  min-width: 0;
}

.danmaku-api-select :deep(.arco-select-view-single) {
  height: 48px;
  border: 0;
  border-radius: 9px;
  background: rgba(255, 255, 255, .08);
  color: #f1f1f1;
  font-size: 18px;
  font-weight: 800;
}

.danmaku-input-wrap {
  position: relative;
  display: flex;
  height: 80px;
  align-items: center;
  border-radius: 12px;
  background: rgba(0, 0, 0, .28);
}

.danmaku-search-button-icon {
  position: relative;
  display: inline-block;
  width: 24px;
  height: 24px;
  border: 4px solid currentColor;
  border-radius: 50%;
}

.danmaku-search-icon {
  margin-left: 34px;
  color: rgba(255, 255, 255, .7);
}

.danmaku-search-icon::after,
.danmaku-search-button-icon::after {
  content: '';
  position: absolute;
  width: 12px;
  height: 4px;
  border-radius: 999px;
  background: currentColor;
  transform: translate(15px, 18px) rotate(45deg);
}

.danmaku-search-input {
  flex: 1;
}

.danmaku-search-input :deep(.arco-input-wrapper) {
  height: 80px;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.danmaku-search-input :deep(.arco-input) {
  color: #f1f1f1;
  font-size: 24px;
  font-weight: 800;
}

.danmaku-search-input :deep(.arco-input::placeholder) {
  color: rgba(255, 255, 255, .36);
}

.danmaku-search-button {
  height: 104px;
  border: 0;
  border-radius: 999px;
  background: #f7f7f7;
  color: #060606;
  font-size: 24px;
  font-weight: 900;
}

.danmaku-search-button :deep(.arco-btn-content) {
  display: flex;
  align-items: center;
  gap: 18px;
}

.danmaku-search-button-icon {
  width: 20px;
  height: 20px;
  border-width: 4px;
}

.danmaku-search-tip {
  margin: 4px 8px 8px;
  color: rgba(255, 255, 255, .58);
  font-size: 18px;
  font-weight: 700;
}

.danmaku-result-shell,
.danmaku-episode-shell {
  flex: 1;
  min-height: 0;
  border: 1px solid rgba(255, 255, 255, .07);
  border-radius: 28px;
  background: rgba(0, 0, 0, .08);
  padding: 42px 40px;
}

.danmaku-modal-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
  height: 100%;
  overflow: auto;
}

.danmaku-result-row {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr) 36px;
  width: 100%;
  min-height: 128px;
  align-items: center;
  gap: 28px;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 22px;
  padding: 24px 36px 24px 28px;
  background: rgba(255, 255, 255, .045);
  color: #f0f0f0;
  text-align: left;
  cursor: pointer;
  transition: background-color .16s ease, border-color .16s ease, transform .16s ease;
}

.danmaku-result-row:hover {
  background: rgba(255, 255, 255, .07);
  border-color: rgba(255, 255, 255, .14);
  transform: translateY(-1px);
}

.danmaku-result-row.is-active {
  border-color: rgba(64, 128, 255, .8);
}

.danmaku-result-icon {
  display: flex;
  width: 80px;
  height: 80px;
  align-items: center;
  justify-content: center;
  border-radius: 20px;
  background: rgba(255, 255, 255, .06);
  color: rgba(255, 255, 255, .68);
}

.danmaku-video-glyph {
  position: relative;
  display: block;
  width: 42px;
  height: 30px;
  border: 4px solid currentColor;
  border-radius: 4px;
}

.danmaku-video-glyph::before {
  content: '';
  position: absolute;
  left: 14px;
  top: 6px;
  width: 0;
  height: 0;
  border-top: 7px solid transparent;
  border-bottom: 7px solid transparent;
  border-left: 11px solid currentColor;
}

.danmaku-video-glyph::after {
  content: '';
  position: absolute;
  left: 10px;
  bottom: -14px;
  width: 20px;
  height: 4px;
  border-radius: 999px;
  background: currentColor;
}

.danmaku-result-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}

.danmaku-result-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 24px;
  font-weight: 900;
  line-height: 1.2;
}

.danmaku-result-meta {
  overflow: hidden;
  color: rgba(255, 255, 255, .58);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 20px;
  font-weight: 800;
  line-height: 1.25;
}

.danmaku-result-arrow {
  color: #3f83ff;
  font-size: 56px;
  font-weight: 300;
  line-height: 1;
}

.danmaku-back-button {
  align-self: flex-start;
  min-width: 190px;
  height: 56px;
  border: 0;
  border-radius: 999px;
  padding: 0 24px;
  background: rgba(255, 255, 255, .07);
  color: #f1f1f1;
  cursor: pointer;
  font-size: 22px;
  font-weight: 900;
}

.danmaku-back-button:hover {
  background: rgba(255, 255, 255, .12);
}

.danmaku-episode-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  align-content: flex-start;
  gap: 16px;
  height: 100%;
  overflow: auto;
  padding: 52px 24px;
}

.danmaku-episode-card {
  display: flex;
  min-height: 180px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 20px;
  padding: 24px;
  background: rgba(255, 255, 255, .035);
  color: #f1f1f1;
  cursor: pointer;
  text-align: center;
}

.danmaku-episode-card:hover {
  background: rgba(255, 255, 255, .065);
  border-color: rgba(255, 255, 255, .16);
}

.danmaku-episode-number {
  font-size: 25px;
  font-weight: 900;
}

.danmaku-episode-title {
  max-width: 100%;
  color: rgba(255, 255, 255, .62);
  font-size: 20px;
  font-weight: 800;
  line-height: 1.35;
}

.danmaku-empty {
  display: flex;
  min-height: 260px;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, .5);
  font-size: 20px;
  font-weight: 800;
}

:global(.danmaku-search-modal) {
  background: transparent;
}

:global(.danmaku-search-modal .arco-modal-header) {
  display: none;
}

:global(.danmaku-search-modal-body) {
  height: 100vh;
  padding: 0 !important;
  background: transparent;
}

:global(.danmaku-search-modal .arco-modal-close-btn) {
  display: none;
}

:global(.danmaku-search-modal .arco-modal-footer) {
  display: none;
}

@media (max-width: 900px) {
  .danmaku-searchbar {
    grid-template-columns: 1fr;
  }

  .danmaku-search-button {
    height: 72px;
  }

  .danmaku-result-row {
    grid-template-columns: 56px minmax(0, 1fr) 24px;
    min-height: 100px;
    gap: 16px;
    padding: 18px;
  }

  .danmaku-result-icon {
    width: 56px;
    height: 56px;
    border-radius: 14px;
  }

  .danmaku-result-title {
    font-size: 18px;
  }

  .danmaku-result-meta {
    font-size: 15px;
  }
}
</style>

<style lang="less">
.danmaku-search-modal {
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: 18px;
  background:
    radial-gradient(circle at 12% 0%, rgba(63, 131, 255, .12), transparent 34%),
    #15171b;
  box-shadow: 0 28px 90px rgba(0, 0, 0, .56);

  .arco-modal-header,
  .arco-modal-close-btn,
  .arco-modal-footer {
    display: none;
  }
}

.danmaku-search-modal-body {
  height: min(650px, calc(100vh - 80px));
  overflow: hidden;
  padding: 0 !important;
  background: transparent;
}

.danmaku-modal {
  display: flex;
  height: min(650px, calc(100vh - 80px));
  overflow: hidden;
  flex-direction: column;
  background:
    radial-gradient(circle at 12% 0%, rgba(63, 131, 255, .12), transparent 34%),
    #15171b;
  color: #f1f1f1;
}

.danmaku-full-header {
  position: relative;
  display: flex;
  height: 72px;
  flex: 0 0 72px;
  align-items: center;
  justify-content: flex-start;
  padding: 0 64px;
  border-bottom: 1px solid rgba(255, 255, 255, .12);
}

.danmaku-close-button {
  position: absolute;
  right: 22px;
  left: auto;
  top: 20px;
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, .12);
  background: rgba(255, 255, 255, .06);
  color: rgba(255, 255, 255, .78);
  cursor: pointer;
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
}

.danmaku-header-copy {
  display: grid;
  gap: 3px;
}

.danmaku-full-title {
  color: #f2f2f2;
  font-size: 19px;
  font-weight: 800;
  letter-spacing: 0;
}

.danmaku-full-subtitle {
  color: rgba(255, 255, 255, .46);
  font-size: 12px;
  font-weight: 600;
}

.danmaku-full-content {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  padding: 18px 20px 20px;
}

.danmaku-searchbar {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) 116px;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 12px;
  background: rgba(255, 255, 255, .045);
}

.subtitle-searchbar {
  grid-template-columns: 150px 116px minmax(0, 1fr) 116px;
}

.subtitle-format-select .arco-select-view-single {
  min-width: 116px;
}

.danmaku-api-select .arco-select-view-single {
  height: 44px;
  border: 1px solid rgba(255, 255, 255, .22);
  border-radius: 6px;
  background: rgba(255, 255, 255, .04);
  color: #f1f1f1;
  font-size: 16px;
  font-weight: 600;
}

.danmaku-input-wrap {
  position: relative;
  display: flex;
  height: 44px;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, .12);
  border-radius: 6px;
  background: rgba(0, 0, 0, .28);
}

.danmaku-search-icon,
.danmaku-search-button-icon {
  position: relative;
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-radius: 50%;
}

.danmaku-search-button-icon::after {
  content: '';
  position: absolute;
  width: 8px;
  height: 2px;
  border-radius: 999px;
  background: currentColor;
  transform: translate(11px, 12px) rotate(45deg);
}

.danmaku-search-input {
  min-width: 0;
  flex: 1;
  width: 100%;
}

.danmaku-search-input .arco-input-wrapper {
  height: 42px;
  padding-left: 16px;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.danmaku-search-input .arco-input {
  color: #f1f1f1;
  font-size: 16px;
  font-weight: 600;
}

.danmaku-search-input .arco-input::placeholder {
  color: rgba(255, 255, 255, .36);
}

.danmaku-search-button {
  min-width: 0;
  height: 44px;
  border: 1px solid rgba(255, 255, 255, .22);
  border-radius: 999px;
  background: rgba(255, 255, 255, .92);
  color: #111;
  font-size: 16px;
  font-weight: 700;
}

.danmaku-search-button .arco-btn-content {
  display: flex;
  align-items: center;
  gap: 10px;
}

.danmaku-search-button-icon {
  width: 16px;
  height: 16px;
  border-width: 3px;
}

.danmaku-search-tip {
  margin: 0 4px;
  color: rgba(255, 255, 255, .58);
  font-size: 12px;
  font-weight: 600;
}

.danmaku-result-shell,
.danmaku-episode-shell {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .07);
  border-radius: 14px;
  background: rgba(0, 0, 0, .08);
  padding: 0;
}

.danmaku-result-toolbar {
  display: flex;
  height: 42px;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, .07);
  color: rgba(255, 255, 255, .48);
  font-size: 12px;
  font-weight: 700;
}

.danmaku-modal-list {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  padding: 10px;
}

.danmaku-result-row {
  display: grid;
  width: 100%;
  min-height: 72px;
  grid-template-columns: 46px minmax(0, 1fr) 54px;
  align-items: center;
  gap: 14px;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 10px;
  padding: 10px 14px 10px 12px;
  background: rgba(255, 255, 255, .045);
  color: #f0f0f0;
  text-align: left;
  cursor: pointer;
}

.danmaku-result-icon {
  display: flex;
  width: 46px;
  height: 46px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 9px;
  background: rgba(255, 255, 255, .06);
  color: rgba(255, 255, 255, .68);
}

.danmaku-result-poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.danmaku-video-glyph {
  position: relative;
  display: block;
  width: 28px;
  height: 20px;
  border: 3px solid currentColor;
  border-radius: 4px;
}

.danmaku-video-glyph::before {
  content: '';
  position: absolute;
  left: 9px;
  top: 4px;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 8px solid currentColor;
}

.danmaku-video-glyph::after {
  content: '';
  position: absolute;
  left: 7px;
  bottom: -10px;
  width: 14px;
  height: 3px;
  border-radius: 999px;
  background: currentColor;
}

.subtitle-doc-glyph {
  position: relative;
  display: block;
  width: 28px;
  height: 34px;
  border: 3px solid currentColor;
  border-radius: 4px;
}

.subtitle-doc-glyph::before,
.subtitle-doc-glyph::after {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  height: 3px;
  border-radius: 999px;
  background: currentColor;
}

.subtitle-doc-glyph::before {
  top: 10px;
}

.subtitle-doc-glyph::after {
  top: 19px;
}

.danmaku-result-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.subtitle-result-title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.subtitle-result-title-row .danmaku-result-title {
  flex: 1 1 auto;
  min-width: 0;
}

.subtitle-format-badge {
  flex: 0 0 auto;
  border: 1px solid rgba(113, 165, 255, .42);
  border-radius: 4px;
  padding: 2px 5px;
  color: #9dc0ff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
}

.danmaku-result-title {
  overflow: hidden;
  color: #f0f0f0;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 800;
}

.danmaku-result-meta {
  overflow: hidden;
  color: rgba(255, 255, 255, .58);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}

.danmaku-result-arrow {
  color: #3f83ff;
  font-size: 38px;
  font-weight: 300;
  line-height: 1;
}

.subtitle-download-arrow {
  color: #71a5ff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
}

.subtitle-download-arrow.is-loading {
  color: rgba(255, 255, 255, .46);
}

.danmaku-back-button {
  align-self: flex-start;
  min-width: 132px;
  height: 36px;
  border: 0;
  border-radius: 999px;
  padding: 0 24px;
  background: rgba(255, 255, 255, .07);
  color: #f1f1f1;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
}

.danmaku-episode-heading {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 0 4px;
}

.danmaku-episode-heading strong {
  overflow: hidden;
  color: #f2f2f2;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
}

.danmaku-episode-heading span {
  color: rgba(255, 255, 255, .46);
  font-size: 12px;
}

.danmaku-episode-grid {
  display: grid;
  height: 100%;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  align-content: flex-start;
  gap: 16px;
  overflow: auto;
  padding: 14px;
}

.danmaku-episode-card {
  display: flex;
  min-height: 94px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 10px;
  padding: 16px;
  background: rgba(255, 255, 255, .035);
  color: #f1f1f1;
  cursor: pointer;
  text-align: center;
}

.danmaku-episode-number {
  font-size: 15px;
  font-weight: 900;
}

.danmaku-episode-title {
  color: rgba(255, 255, 255, .62);
  font-size: 12px;
  font-weight: 600;
}

.danmaku-empty {
  display: flex;
  min-height: 180px;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, .5);
  font-size: 15px;
  font-weight: 800;
}

@media (max-width: 900px) {
  .danmaku-searchbar {
    grid-template-columns: 1fr;
  }

  .danmaku-search-button {
    height: 72px;
  }
}
</style>
