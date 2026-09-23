import { defineStore } from 'pinia'
import { normalizeAria2cEnabled } from '../utils/aria2EnginePolicy'
import DebugLog from '../utils/debuglog'
import { getUserDataPath } from '../utils/electronhelper'
import { useAppStore } from '../store'
import PanDAL from '../pan/pandal'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { detectSystemLocale } from '../i18n'
import {
  DEFAULT_MEDIA_SERVER_CUSTOM_DEVICE_PROFILE,
  isMediaServerBitrateTestSize,
  isMediaServerPlaybackCompatibility,
  isMediaServerPlaybackQuality,
  normalizeMediaServerCustomDeviceProfile,
  type MediaServerBitrateTestSize,
  type MediaServerCustomDeviceProfile,
  type MediaServerPlaybackCompatibility,
  type MediaServerPlaybackQuality
} from '../media-server/playbackQuality'

declare type ProxyType = 'none' | 'http' | 'https' | 'socks4' | 'socks4a' | 'socks5' | 'socks5h'
declare type VideoQuality = 'Origin' | 'QHD' | 'FHD' | 'HD' | 'SD' | 'LD'
export type DanmakuMode = 0 | 1 | 2
export interface DanmakuApiSetting {
  id: string
  name: string
  url: string
}

export interface SettingState {
  // 应用设置
  uiLanguage: 'zh-CN' | 'en-US'
  uiTheme: string
  uiDefaultTab: string
  uiHiddenTopTabs: string[]
  uiImageMode: string
  uiExitOnClose: boolean
  uiLaunchAutoCheckUpdate: boolean
  uiLaunchMaximized: boolean
  uiLaunchAutoSign: boolean
  uiLaunchStart: boolean
  uiLaunchStartShow: boolean
  uiUpdateProxyEnable: boolean
  uiUpdateProxyUrl: string

  // 账户设置
  uiEnableOpenApiType: string
  uiOpenApiClientId: string
  uiOpenApiClientSecret: string

  // 安全设置
  securityEncType: string
  securityPassword: string
  securityPasswordConfirm: boolean
  securityEncFileName: boolean
  securityEncFileNameHideExt: boolean
  securityFileNameAutoDecrypt: boolean
  securityPreviewAutoDecrypt: boolean

  securityHideBackupDrive: boolean
  securityHideResourceDrive: boolean
  securityHidePicDrive: boolean

  // 在线预览
  uiVideoQuality: VideoQuality
  uiMediaServerVideoQuality: MediaServerPlaybackQuality
  uiMediaServerBitrateTestSize: MediaServerBitrateTestSize
  uiMediaServerCompatibilityMode: MediaServerPlaybackCompatibility
  uiMediaServerCustomDeviceProfile: MediaServerCustomDeviceProfile
  uiVideoQualityTips: boolean
  uiVideoQualityLastSelect: boolean
  uiVideoPlayer: string
  uiVideoEnablePlayerList: boolean
  uiVideoPlayerExit: boolean
  uiVideoPlayerHistory: boolean
  uiVideoPlayerParams: string
  uiVideoSubtitleMode: string
  mediaLibrarySubtitleScope: 'same-folder' | 'include-subfolders'
  uiVideoPlayerPath: string

  uiAutoColorVideo: boolean
  uiAutoPlaycursorVideo: boolean

  uiXBTNumber: number
  uiXBTWidth: number

  // 弹幕库
  danmakuApis: DanmakuApiSetting[]
  danmakuSpeed: number
  danmakuMarginTop: number
  danmakuMarginBottom: string
  danmakuOpacity: number
  danmakuColor: string
  danmakuMode: DanmakuMode
  danmakuModes: DanmakuMode[]
  danmakuFontSize: number
  danmakuAntiOverlap: boolean
  danmakuSynchronousPlayback: boolean
  danmakuHeatmap: boolean
  danmakuVisible: boolean
  danmakuTheme: 'dark' | 'light'
  danmakuFilterText: string

  // 网盘设置
  uiShowPanPath: boolean
  uiShowPanMedia: boolean
  uiShowPanRootFirst: string
  uiFolderSize: boolean
  uiFolderPreviewEnabled: boolean
  uiFolderPreviewAutoHide: number
  uiLibraryAutoScanMusic: boolean
  uiLibraryAutoScanVideo: boolean
  uiLibraryAutoScanBook: boolean
  uiLibraryIncrementalScan: boolean
  uiLibraryScanIntervalHours: number
  uiLibraryAutoScanPromptedUsers: string[]
  uiLibraryAutoScanMusicDisabledUsers: string[]
  uiLibraryAutoScanVideoDisabledUsers: string[]
  uiLibraryAutoScanBookDisabledUsers: string[]
  uiLibraryFollowManualScans: boolean
  uiMusicAutoScanFolders: { user_id: string; drive_id: string; file_id: string; name: string; path?: string }[]
  uiFileOrderDuli: string
  uiTimeFolderFormate: string
  uiTimeFolderIndex: number
  uiShareDays: string
  uiSharePassword: string
  uiShareFormate: string
  uiFileListOrder: string
  uiFileListMode: string
  uiFileColorArray: { key: string; title: string }[]

  // 下载文件
  downSavePath: string
  downSavePathDefault: boolean
  downSavePathFull: boolean
  downSaveBreakWeiGui: boolean
  downFileMax: number
  downThreadMax: number
  downGlobalSpeed: number
  downGlobalSpeedM: string
  downUseAria2c: boolean

  // ↓ 新增：Download 迁移设置
  ariaMaxConnectionPerServer: number    // 每服务器最大连接数
  ariaContinueDownload: boolean         // 断点续传（continue=true）
  ariaBtSaveMetadata: boolean           // 保存 BT 元数据
  ariaBtForceEncryption: boolean        // BT 强制加密
  ariaBtAutoDownloadContent: boolean    // 自动开始 BT 内容下载
  ariaEnableUpnp: boolean               // UPnP/NAT-PMP 端口映射
  ariaListenPort: number                // BT 监听端口
  ariaDhtListenPort: number             // DHT 监听端口
  ariaUserAgent: string                 // 全局 User-Agent
  ariaRpcListenPort: number             // RPC 监听端口
  ariaRpcSecret: string                 // RPC 密钥

  // 任务通知
  ariaTaskNotification: boolean         // 下载完成声音通知

  // 上传文件
  uploadFileMax: number
  uploadGlobalSpeed: number
  uploadGlobalSpeedM: string

  // 上传下载综合设置
  downAutoShutDown: number
  downSaveShowPro: boolean
  downSmallFileFirst: boolean
  downUploadBreakFile: boolean
  downUploadWhatExist: string
  downIngoredList: string[]
  downFinishAudio: boolean
  downAutoStart: boolean

  // webdav
  webDavEnable: boolean
  webDavAutoEnable: boolean
  webDavHost: string
  webDavPort: number
  webDavListCache: number
  webDavStrategy: string

  // 高级选项
  debugDirSize: string
  debugCacheSize: string
  debugFileListMax: number
  debugFavorListMax: number
  debugDowningListMax: number
  debugDownedListMax: number
  debugFolderSizeCacheHour: number
  debugProxyHost: string
  debugProxyPort: string
  // 自动填写 分享链接提取码
  yinsiLinkPassword: boolean
  yinsiZipPassword: boolean

  // 网络代理
  proxyUseProxy: boolean
  proxyType: ProxyType
  proxyHost: string
  proxyPort: number
  proxyUserName: string
  proxyPassword: string

  // 远程Aria
  ariaSavePath: string
  ariaUrl: string
  ariaPwd: string
  ariaHttps: boolean
  ariaState: string
  ariaLoading: boolean

  ariaBtTracker: string
  ariaTrackerSources: string[]
  ariaAutoSyncTracker: boolean
  ariaMaxOverallUploadLimit: number
  ariaKeepSeeding: boolean
  ariaSeedRatio: number
  ariaSeedTime: number
  ariaResumeAllWhenLaunched: boolean

  // API 密钥 (BYOK)
  apiAIModelKey: string
  apiAIModelProvider: string
  apiAIModelId: string
  apiAIBaseUrl: string
  apiAIEmbeddingModelId: string
  apiAIRagEnabled: boolean
  apiAISpoilerProtection: boolean
  apiAIMaxContextChunks: number
  apiAIIndexingMode: 'on-demand' | 'background'
  apiAIReedyEnabled: boolean
  apiAIReedyRuntime: 'mvp' | 'agent'
  apiAIMediaScrapeEnabled: boolean
  mediaAcquisitionPreferredQuality: 'auto' | '2160p' | '1080p' | '720p' | '480p'
  mediaAcquisitionFetchSubtitles: boolean
  mediaAcquisitionSubtitleLanguage: 'zh-CN' | 'zh-Hant' | 'en' | 'ja' | 'ko' | 'auto'
  mediaAcquisitionAssrtEnabled: boolean
  mediaAcquisitionAssrtToken: string
  mediaAcquisitionPatrolTimes: string
  mediaAcquisitionAutoScanHistorical: boolean
  mediaAcquisitionRememberTarget: boolean
  mediaAcquisitionTargetUserId: string
  mediaAcquisitionTargetDriveId: string
  mediaAcquisitionTargetFolderId: string
  mediaAcquisitionTargetFolderName: string
}

const setting: SettingState = {
  // 应用设置
  uiLanguage: detectSystemLocale(),
  uiTheme: 'system',
  uiDefaultTab: 'pan',
  uiHiddenTopTabs: [],
  uiImageMode: 'fill',
  uiExitOnClose: false,
  uiLaunchAutoCheckUpdate: false,
  uiLaunchMaximized: false,
  uiLaunchAutoSign: false,
  uiLaunchStart: false,
  uiLaunchStartShow: false,
  uiUpdateProxyEnable: false,
  uiUpdateProxyUrl: 'https://gh-proxy.com',

  // 账户设置
  uiEnableOpenApiType: 'inline',
  uiOpenApiClientId: '',
  uiOpenApiClientSecret: '',

  // 安全设置
  securityEncType: 'aesctr',
  securityPassword: '',
  securityPasswordConfirm: false,
  securityEncFileName: true,
  securityEncFileNameHideExt: false,
  securityFileNameAutoDecrypt: true,
  securityPreviewAutoDecrypt: true,

  securityHideBackupDrive: false,
  securityHideResourceDrive: false,
  securityHidePicDrive: false,

  // 在线预览
  uiVideoQuality: 'Origin',
  uiMediaServerVideoQuality: 'max',
  uiMediaServerBitrateTestSize: '5000000',
  uiMediaServerCompatibilityMode: 'auto',
  uiMediaServerCustomDeviceProfile: DEFAULT_MEDIA_SERVER_CUSTOM_DEVICE_PROFILE,
  uiVideoQualityTips: false,
  uiVideoQualityLastSelect: true,
  uiVideoPlayer: 'mpv',
  uiVideoEnablePlayerList: false,
  uiVideoPlayerExit: false,
  uiVideoPlayerHistory: false,
  uiVideoPlayerParams: '',
  uiVideoSubtitleMode: 'auto',
  mediaLibrarySubtitleScope: 'same-folder',
  uiVideoPlayerPath: '',

  uiAutoPlaycursorVideo: true,
  uiAutoColorVideo: true,

  uiXBTNumber: 36,
  uiXBTWidth: 960,

  // 弹幕库
  danmakuApis: [],
  danmakuSpeed: 5,
  danmakuMarginTop: 10,
  danmakuMarginBottom: '25%',
  danmakuOpacity: 1,
  danmakuColor: '#FFFFFF',
  danmakuMode: 0,
  danmakuModes: [0, 1, 2],
  danmakuFontSize: 25,
  danmakuAntiOverlap: true,
  danmakuSynchronousPlayback: false,
  danmakuHeatmap: false,
  danmakuVisible: false,
  danmakuTheme: 'dark',
  danmakuFilterText: '',

  // 网盘设置
  uiShowPanPath: true,
  uiShowPanMedia: false,
  uiShowPanRootFirst: 'all',
  uiFolderSize: true,
  uiFolderPreviewEnabled: true,
  uiFolderPreviewAutoHide: 6,
  uiLibraryAutoScanMusic: false,
  uiLibraryAutoScanVideo: false,
  uiLibraryAutoScanBook: false,
  uiLibraryIncrementalScan: true,
  uiLibraryScanIntervalHours: 24,
  uiLibraryAutoScanPromptedUsers: [],
  uiLibraryAutoScanMusicDisabledUsers: [],
  uiLibraryAutoScanVideoDisabledUsers: [],
  uiLibraryAutoScanBookDisabledUsers: [],
  uiLibraryFollowManualScans: true,
  uiMusicAutoScanFolders: [],
  uiFileOrderDuli: 'null',
  uiTimeFolderFormate: 'yyyy-MM-dd HH-mm-ss',
  uiTimeFolderIndex: 1,
  uiShareDays: 'always',
  uiSharePassword: 'random',
  uiShareFormate: '「NAME」URL\n提取码: PWD',
  uiFileListOrder: 'name asc',
  uiFileListMode: 'list',
  uiFileColorArray: [
    { key: '#df5659', title: '鹅冠红' },
    { key: '#9c27b0', title: '兰花紫' },
    { key: '#42a5f5', title: '晴空蓝' },
    { key: '#00bc99', title: '竹叶青' },
    { key: '#4caf50', title: '宝石绿' },
    { key: '#ff9800', title: '金盏黄' }
  ],

  // 下载文件
  downSavePath: '',
  downSavePathDefault: true,
  downSavePathFull: true,
  downSaveBreakWeiGui: true,
  downFileMax: 5,
  downThreadMax: 4,
  downGlobalSpeed: 0,
  downGlobalSpeedM: 'MB',
  downUseAria2c: true,

  // ↓ 新增：Download 迁移设置 默认值
  ariaMaxConnectionPerServer: 16,
  ariaContinueDownload: true,
  ariaBtSaveMetadata: true,
  ariaBtForceEncryption: false,
  ariaBtAutoDownloadContent: true,
  ariaEnableUpnp: true,
  ariaListenPort: 6881,
  ariaDhtListenPort: 6881,
  ariaUserAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4577.63 Safari/537.36',
  ariaRpcListenPort: 16800,
  ariaRpcSecret: 'S4znWTaZYQi3cpRNb',
  ariaTaskNotification: true,

  // 上传文件
  uploadFileMax: 5,
  uploadGlobalSpeed: 0,
  uploadGlobalSpeedM: 'MB',

  // 上传下载综合设置
  downAutoShutDown: 0,
  downSaveShowPro: true,
  downSmallFileFirst: false,
  downUploadBreakFile: false,
  downUploadWhatExist: 'refuse',
  downIngoredList: ['thumbs.db', 'desktop.ini', '.ds_store', '.td', '~', '.downloading'],
  downFinishAudio: true,
  downAutoStart: true,

  // webdav
  webDavEnable: false,
  webDavAutoEnable: false,
  webDavHost: '127.0.0.1',
  webDavPort: 8888,
  webDavListCache: 10,
  webDavStrategy: 'redirect',

  // 高级选项
  debugCacheSize: '',
  debugDirSize: '',
  debugFileListMax: 3000,
  debugFavorListMax: 500,
  debugDowningListMax: 1000,
  debugDownedListMax: 5000,
  debugFolderSizeCacheHour: 72,
  debugProxyHost: '127.0.0.1',
  debugProxyPort: '6666',
  // 自动填写 分享链接提取码
  yinsiLinkPassword: false,
  yinsiZipPassword: false,

  // 网络代理
  proxyUseProxy: false,
  proxyType: 'none',
  proxyHost: '',
  proxyPort: 0,
  proxyUserName: '',
  proxyPassword: '',

  // 远程Aria
  ariaSavePath: '',
  ariaUrl: '',
  ariaPwd: '',
  ariaHttps: false,
  ariaState: 'local',
  ariaLoading: false,

  ariaBtTracker: '',
  ariaTrackerSources: [
    'https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_best_ip.txt',
    'https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_best.txt'
  ],
  ariaAutoSyncTracker: true,
  ariaMaxOverallUploadLimit: 0,
  ariaKeepSeeding: false,
  ariaSeedRatio: 2,
  ariaSeedTime: 2880,
  ariaResumeAllWhenLaunched: false,

  apiAIModelKey: '',
  apiAIModelProvider: '',
  apiAIModelId: '',
  apiAIBaseUrl: '',
  apiAIEmbeddingModelId: '',
  apiAIRagEnabled: false,
  apiAISpoilerProtection: true,
  apiAIMaxContextChunks: 6,
  apiAIIndexingMode: 'on-demand',
  apiAIReedyEnabled: false,
  apiAIReedyRuntime: 'mvp',
  apiAIMediaScrapeEnabled: false,
  mediaAcquisitionPreferredQuality: 'auto',
  mediaAcquisitionFetchSubtitles: true,
  mediaAcquisitionSubtitleLanguage: 'zh-CN',
  mediaAcquisitionAssrtEnabled: false,
  mediaAcquisitionAssrtToken: '',
  mediaAcquisitionPatrolTimes: '06:00,21:00',
  mediaAcquisitionAutoScanHistorical: false,
  mediaAcquisitionRememberTarget: false,
  mediaAcquisitionTargetUserId: '',
  mediaAcquisitionTargetDriveId: '',
  mediaAcquisitionTargetFolderId: '',
  mediaAcquisitionTargetFolderName: ''
}

function _loadSetting(val: any) {
  console.log('_loadSetting', val)
  // 应用设置
  setting.uiLanguage = defaultValue(val.uiLanguage, ['zh-CN', 'en-US'], detectSystemLocale()) as SettingState['uiLanguage']
  setting.uiTheme = defaultValue(val.uiTheme, ['system', 'light', 'dark'])
  setting.uiDefaultTab = defaultValue(val.uiDefaultTab, ['pan', 'media', 'media-server', 'music'])
  setting.uiHiddenTopTabs = Array.isArray(val.uiHiddenTopTabs) ? val.uiHiddenTopTabs.filter((tab: unknown) => typeof tab === 'string' && ['pan', 'media-server', 'search', 'ai-workspace', 'media', 'music', 'book', 'share', 'rss'].includes(tab)) : []
  setting.uiImageMode = defaultValue(val.uiImageMode, ['fill', 'width', 'web'])
  setting.uiExitOnClose = defaultBool(val.uiExitOnClose, false)
  setting.uiLaunchAutoCheckUpdate = defaultBool(val.uiLaunchAutoCheckUpdate, false)
  setting.uiLaunchMaximized = defaultBool(val.uiLaunchMaximized, false)
  setting.uiLaunchAutoSign = defaultBool(val.uiLaunchAutoSign, false)
  setting.uiLaunchStart = defaultBool(val.uiLaunchStart, false)
  setting.uiLaunchStartShow = defaultBool(val.uiLaunchStartShow, false)
  setting.uiUpdateProxyEnable = defaultBool(val.uiUpdateProxyEnable, false)
  setting.uiUpdateProxyUrl = defaultString(val.uiUpdateProxyUrl, 'https://gh-proxy.com')

  // 账户设置
  setting.uiEnableOpenApiType = defaultValue(val.uiEnableOpenApiType, ['inline', 'custom'])
  setting.uiOpenApiClientId = defaultString(val.uiOpenApiClientId, '')
  setting.uiOpenApiClientSecret = defaultString(val.uiOpenApiClientSecret, '')

  // 安全设置
  setting.securityEncType = defaultValue(val.securityEncType, ['aesctr', 'rc4md5'])
  setting.securityPassword = defaultString(val.securityPassword, '')
  setting.securityPasswordConfirm = defaultBool(val.securityPasswordConfirm, false)
  setting.securityEncFileName = defaultBool(val.securityEncFileName, true)
  setting.securityEncFileNameHideExt = defaultBool(val.securityEncFileNameHideExt, false)
  setting.securityFileNameAutoDecrypt = defaultBool(val.securityFileNameAutoDecrypt, true)
  setting.securityPreviewAutoDecrypt = defaultBool(val.securityPreviewAutoDecrypt, true)
  setting.securityHideBackupDrive = defaultBool(val.securityHideBackupDrive, false)
  setting.securityHideResourceDrive = defaultBool(val.securityHideResourceDrive, false)
  setting.securityHidePicDrive = defaultBool(val.securityHidePicDrive, false)

  // 在线预览
  setting.uiVideoQuality = defaultValue(val.uiVideoQuality, ['Origin', 'QHD', 'FHD', 'HD', 'SD', 'LD'])
  setting.uiMediaServerVideoQuality = isMediaServerPlaybackQuality(val.uiMediaServerVideoQuality) ? val.uiMediaServerVideoQuality : 'max'
  setting.uiMediaServerBitrateTestSize = isMediaServerBitrateTestSize(val.uiMediaServerBitrateTestSize) ? val.uiMediaServerBitrateTestSize : '5000000'
  setting.uiMediaServerCompatibilityMode = isMediaServerPlaybackCompatibility(val.uiMediaServerCompatibilityMode) ? val.uiMediaServerCompatibilityMode : 'auto'
  setting.uiMediaServerCustomDeviceProfile = normalizeMediaServerCustomDeviceProfile(val.uiMediaServerCustomDeviceProfile)
  setting.uiVideoQualityTips = defaultBool(val.uiVideoQualityTips, false)
  setting.uiVideoQualityLastSelect = defaultBool(val.uiVideoQualityLastSelect, true)
  setting.uiVideoPlayer = defaultValue(val.uiVideoPlayer, ['mpv', 'web', 'other'])
  setting.uiVideoEnablePlayerList = defaultBool(val.uiVideoEnablePlayerList, false)
  setting.uiVideoPlayerExit = defaultBool(val.uiVideoPlayerExit, false)
  setting.uiVideoPlayerHistory = defaultBool(val.uiVideoPlayerHistory, false)
  setting.uiVideoPlayerParams = defaultString(val.uiVideoPlayerParams, '')
  setting.uiVideoSubtitleMode = defaultValue(val.uiVideoSubtitleMode, ['close', 'auto', 'select'])
  setting.mediaLibrarySubtitleScope = defaultValue(val.mediaLibrarySubtitleScope, ['same-folder', 'include-subfolders']) as SettingState['mediaLibrarySubtitleScope']
  setting.uiVideoPlayerPath = defaultString(val.uiVideoPlayerPath, '')
  setting.uiAutoPlaycursorVideo = defaultBool(val.uiAutoPlaycursorVideo, true)
  setting.uiAutoColorVideo = defaultBool(val.uiAutoColorVideo, true)

  setting.uiXBTNumber = defaultValue(val.uiXBTNumber, [36, 24, 36, 48, 60, 72])
  setting.uiXBTWidth = defaultValue(val.uiXBTWidth, [960, 720, 960, 1080, 1280])

  // 弹幕库
  setting.danmakuApis = Array.isArray(val.danmakuApis)
    ? val.danmakuApis
      .filter((api: any) => api && typeof api.name === 'string' && typeof api.url === 'string')
      .map((api: any, index: number) => ({
        id: defaultString(api.id, `danmaku-api-${index}`),
        name: defaultString(api.name, ''),
        url: defaultString(api.url, '')
      }))
    : []
  setting.danmakuSpeed = defaultNumberSub(val.danmakuSpeed, 5, 1, 10)
  setting.danmakuMarginTop = defaultNumberSub(val.danmakuMarginTop, 10, 0, 200)
  setting.danmakuMarginBottom = defaultString(val.danmakuMarginBottom, '25%')
  setting.danmakuOpacity = defaultNumberSub(val.danmakuOpacity, 1, 0, 1)
  setting.danmakuColor = defaultString(val.danmakuColor, '#FFFFFF')
  setting.danmakuMode = defaultValue(val.danmakuMode, [0, 1, 2])
  setting.danmakuModes = Array.isArray(val.danmakuModes) && val.danmakuModes.length > 0
    ? val.danmakuModes.filter((mode: any) => [0, 1, 2].includes(mode))
    : [0, 1, 2]
  setting.danmakuFontSize = defaultNumberSub(val.danmakuFontSize, 25, 12, 80)
  setting.danmakuAntiOverlap = defaultBool(val.danmakuAntiOverlap, true)
  setting.danmakuSynchronousPlayback = defaultBool(val.danmakuSynchronousPlayback, false)
  setting.danmakuHeatmap = defaultBool(val.danmakuHeatmap, false)
  setting.danmakuVisible = defaultBool(val.danmakuVisible, false)
  setting.danmakuTheme = defaultValue(val.danmakuTheme, ['dark', 'light'])
  setting.danmakuFilterText = defaultString(val.danmakuFilterText, '')

  // 网盘设置
  setting.uiShowPanPath = defaultBool(val.uiShowPanPath, true)
  setting.uiShowPanMedia = defaultBool(val.uiShowPanMedia, false)
  setting.uiShowPanRootFirst = defaultValue(val.uiShowPanRootFirst, ['all', 'backup', 'resource'])
  setting.uiFolderSize = defaultBool(val.uiFolderSize, true)
  setting.uiFolderPreviewEnabled = defaultBool(val.uiFolderPreviewEnabled, true)
  setting.uiFolderPreviewAutoHide = defaultNumber(val.uiFolderPreviewAutoHide, 6)
  setting.uiLibraryAutoScanMusic = defaultBool(val.uiLibraryAutoScanMusic, false)
  setting.uiLibraryAutoScanVideo = defaultBool(val.uiLibraryAutoScanVideo, false)
  setting.uiLibraryAutoScanBook = defaultBool(val.uiLibraryAutoScanBook, false)
  setting.uiLibraryIncrementalScan = defaultBool(val.uiLibraryIncrementalScan, true)
  setting.uiLibraryScanIntervalHours = defaultNumberSub(val.uiLibraryScanIntervalHours, 24, 1, 24 * 30)
  setting.uiLibraryAutoScanPromptedUsers = Array.isArray(val.uiLibraryAutoScanPromptedUsers)
    ? val.uiLibraryAutoScanPromptedUsers.filter((s: unknown) => typeof s === 'string')
    : []
  setting.uiLibraryAutoScanMusicDisabledUsers = Array.isArray(val.uiLibraryAutoScanMusicDisabledUsers)
    ? val.uiLibraryAutoScanMusicDisabledUsers.filter((s: unknown) => typeof s === 'string')
    : []
  setting.uiLibraryAutoScanVideoDisabledUsers = Array.isArray(val.uiLibraryAutoScanVideoDisabledUsers)
    ? val.uiLibraryAutoScanVideoDisabledUsers.filter((s: unknown) => typeof s === 'string')
    : []
  setting.uiLibraryAutoScanBookDisabledUsers = Array.isArray(val.uiLibraryAutoScanBookDisabledUsers)
    ? val.uiLibraryAutoScanBookDisabledUsers.filter((s: unknown) => typeof s === 'string')
    : []
  setting.uiLibraryFollowManualScans = defaultBool(val.uiLibraryFollowManualScans, true)
  setting.uiMusicAutoScanFolders = Array.isArray(val.uiMusicAutoScanFolders)
    ? val.uiMusicAutoScanFolders
        .filter((f: any) => f && typeof f.user_id === 'string' && typeof f.drive_id === 'string' && typeof f.file_id === 'string')
        .map((f: any) => ({
          user_id: String(f.user_id),
          drive_id: String(f.drive_id),
          file_id: String(f.file_id),
          name: typeof f.name === 'string' ? f.name : '',
          path: typeof f.path === 'string' ? f.path : ''
        }))
    : []
  setting.uiFileOrderDuli = defaultString(val.uiFileOrderDuli, 'null')
  setting.uiTimeFolderFormate = defaultString(val.uiTimeFolderFormate, 'yyyy-MM-dd HH-mm-ss').replace('mm-dd', 'MM-dd').replace('HH-MM', 'HH-mm')
  setting.uiTimeFolderIndex = defaultNumber(val.uiTimeFolderIndex, 1)
  setting.uiShareDays = defaultValue(val.uiShareDays, ['always', 'week', 'month'])
  setting.uiSharePassword = defaultValue(val.uiSharePassword, ['random', 'last', 'nopassword'])
  setting.uiShareFormate = defaultString(val.uiShareFormate, 'NAME URL 提取码：PWD')
  setting.uiFileListOrder = defaultValue(val.uiFileListOrder, ['updated_at desc', 'name asc', 'name desc', 'updated_at asc', 'updated_at desc', 'size asc', 'size desc'])
  setting.uiFileListMode = defaultValue(val.uiFileListMode, ['list', 'image', 'bigimage'])
  if (val.uiFileColorArray && val.uiFileColorArray.length >= 6) setting.uiFileColorArray = val.uiFileColorArray

  // 下载文件
  setting.downSavePath = defaultString(val.downSavePath, '')
  setting.downSavePathDefault = defaultBool(val.downSavePathDefault, true)
  setting.downSavePathFull = defaultBool(val.downSavePathFull, true)
  setting.downSaveBreakWeiGui = defaultBool(val.downSaveBreakWeiGui, true)
  setting.downFileMax = defaultValue(val.downFileMax, [5, 1, 2, 3, 4, 5])
  setting.downThreadMax = defaultValue(val.downThreadMax, [4, 1, 2, 4, 8, 16, 24, 32])
  setting.downGlobalSpeed = defaultNumberSub(val.downGlobalSpeed, 0, 0, 999)
  setting.downGlobalSpeedM = defaultValue(val.downGlobalSpeedM, ['MB', 'KB'])
  setting.downUseAria2c = normalizeAria2cEnabled(defaultBool(val.downUseAria2c, true))

  // 上传文件
  setting.uploadFileMax = defaultValue(val.uploadFileMax, [5, 1, 3, 5, 10, 20, 30, 50])
  setting.uploadGlobalSpeed = defaultNumberSub(val.uploadGlobalSpeed, 0, 0, 999)
  setting.uploadGlobalSpeedM = defaultValue(val.uploadGlobalSpeedM, ['MB', 'KB'])

  // 上传下载综合设置
  setting.downAutoShutDown = 0
  setting.downSaveShowPro = defaultBool(val.downSaveShowPro, true)
  setting.downSmallFileFirst = defaultBool(val.downSmallFileFirst, false)
  setting.downUploadBreakFile = defaultBool(val.downUploadBreakFile, false)
  setting.downUploadWhatExist = defaultValue(val.downUploadWhatExist, ['ignore', 'overwrite', 'auto_rename', 'refuse'])
  setting.downIngoredList = val.downIngoredList && val.downIngoredList.length > 0 ? val.downIngoredList : ['thumbs.db', 'desktop.ini', '.ds_store', '.td', '~', '.downloading']
  setting.downFinishAudio = defaultBool(val.downFinishAudio, true)
  setting.downAutoStart = defaultBool(val.downAutoStart, true)

  // webdav
  setting.webDavEnable = defaultBool(val.webDavEnable, false)
  setting.webDavAutoEnable = defaultBool(val.webDavAutoEnable, false)
  setting.webDavHost = defaultString(val.webDavHost, '127.0.0.1')
  setting.webDavPort = defaultNumber(val.webDavPort, 12000)
  setting.webDavListCache = defaultNumber(val.webDavListCache, 10)
  setting.webDavStrategy = defaultValue(val.webDavStrategy, ['redirect', 'proxy'])

  // 高级选项
  setting.debugDirSize = defaultString(val.debugDirSize, '')
  setting.debugCacheSize = defaultString(val.debugCacheSize, '')
  setting.debugFileListMax = defaultNumberSub(val.debugFileListMax, 3000, 3000, 10000)
  setting.debugFavorListMax = defaultNumberSub(val.debugFavorListMax, 500, 100, 3000)
  setting.debugDowningListMax = 1000
  setting.debugDownedListMax = defaultNumberSub(val.debugDownedListMax, 5000, 1000, 50000)
  setting.debugFolderSizeCacheHour = defaultValue(val.debugFolderSizeCacheHour, [72, 2, 8, 24, 48, 72])
  setting.debugProxyHost = defaultString(val.debugProxyHost, '127.0.0.1')
  // Chromium blocks a number of ports, including 6666 (ERR_UNSAFE_PORT).
  // Migrate the historical default so media playback can reach the local proxy.
  const debugProxyPort = defaultString(val.debugProxyPort, '18888')
  setting.debugProxyPort = debugProxyPort === '6666' ? '18888' : debugProxyPort
  // 自动填写 分享链接提取码
  setting.yinsiLinkPassword = defaultBool(val.yinsiLinkPassword, false)
  setting.yinsiZipPassword = defaultBool(val.yinsiZipPassword, false)

  // 网络代理
  setting.proxyUseProxy = defaultBool(val.proxyUseProxy, false)
  setting.proxyType = defaultValue(val.proxyType, ['none', 'http', 'https', 'socks5', 'socks5h'])
  setting.proxyHost = defaultString(val.proxyHost, '')
  setting.proxyPort = defaultNumber(val.proxyPort, 0)
  setting.proxyUserName = defaultString(val.proxyUserName, '')
  setting.proxyPassword = defaultString(val.proxyPassword, '')

  // 远程Aria
  setting.ariaSavePath = defaultString(val.ariaSavePath, '')
  if (setting.ariaSavePath.indexOf('/') < 0 && setting.ariaSavePath.indexOf('\\') < 0) setting.ariaSavePath = ''
  setting.ariaUrl = defaultString(val.ariaUrl, '')
  if (setting.ariaUrl.indexOf(':') < 0) setting.ariaUrl = ''
  setting.ariaPwd = defaultString(val.ariaPwd, '')
  setting.ariaHttps = defaultBool(val.ariaHttps, false)
  setting.ariaState = defaultValue(val.ariaState, ['local', 'remote'])
  setting.ariaLoading = false

  // BT / Tracker
  setting.ariaBtTracker = defaultString(val.ariaBtTracker, '')
  setting.ariaTrackerSources = Array.isArray(val.ariaTrackerSources) && val.ariaTrackerSources.length
    ? val.ariaTrackerSources
    : [
        'https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_best_ip.txt',
        'https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_best.txt'
      ]
  setting.ariaAutoSyncTracker = defaultBool(val.ariaAutoSyncTracker, true)
  setting.ariaMaxOverallUploadLimit = defaultNumber(val.ariaMaxOverallUploadLimit, 0)
  setting.ariaKeepSeeding = defaultBool(val.ariaKeepSeeding, false)
  setting.ariaSeedRatio = defaultNumber(val.ariaSeedRatio, 2)
  setting.ariaSeedTime = defaultNumber(val.ariaSeedTime, 2880)
  setting.ariaResumeAllWhenLaunched = defaultBool(val.ariaResumeAllWhenLaunched, false)

  // API 密钥
  setting.apiAIModelKey = defaultString(val.apiAIModelKey, '')
  setting.apiAIModelProvider = defaultString(val.apiAIModelProvider, '')
  setting.apiAIModelId = defaultString(val.apiAIModelId, '')
  setting.apiAIBaseUrl = defaultString(val.apiAIBaseUrl, '')
  setting.apiAIEmbeddingModelId = defaultString(val.apiAIEmbeddingModelId, '')
  setting.apiAIRagEnabled = defaultBool(val.apiAIRagEnabled, false)
  setting.apiAISpoilerProtection = defaultBool(val.apiAISpoilerProtection, true)
  setting.apiAIMaxContextChunks = defaultNumberSub(val.apiAIMaxContextChunks, 6, 1, 12)
  setting.apiAIIndexingMode = defaultValue(val.apiAIIndexingMode, ['on-demand', 'background'])
  setting.apiAIReedyEnabled = defaultBool(val.apiAIReedyEnabled, false)
  setting.apiAIReedyRuntime = defaultValue(val.apiAIReedyRuntime, ['mvp', 'agent']) as 'mvp' | 'agent'
  setting.apiAIMediaScrapeEnabled = defaultBool(val.apiAIMediaScrapeEnabled, false)
  setting.mediaAcquisitionPreferredQuality = defaultValue(val.mediaAcquisitionPreferredQuality, ['auto', '2160p', '1080p', '720p', '480p']) as SettingState['mediaAcquisitionPreferredQuality']
  setting.mediaAcquisitionFetchSubtitles = defaultBool(val.mediaAcquisitionFetchSubtitles, true)
  setting.mediaAcquisitionSubtitleLanguage = defaultValue(val.mediaAcquisitionSubtitleLanguage, ['zh-CN', 'zh-Hant', 'en', 'ja', 'ko', 'auto']) as SettingState['mediaAcquisitionSubtitleLanguage']
  setting.mediaAcquisitionAssrtEnabled = defaultBool(val.mediaAcquisitionAssrtEnabled, false)
  setting.mediaAcquisitionAssrtToken = defaultString(val.mediaAcquisitionAssrtToken, '')
  setting.mediaAcquisitionPatrolTimes = defaultString(val.mediaAcquisitionPatrolTimes, '06:00,21:00')
  setting.mediaAcquisitionAutoScanHistorical = defaultBool(val.mediaAcquisitionAutoScanHistorical, false)
  setting.mediaAcquisitionRememberTarget = defaultBool(val.mediaAcquisitionRememberTarget, false)
  setting.mediaAcquisitionTargetUserId = defaultString(val.mediaAcquisitionTargetUserId, '')
  setting.mediaAcquisitionTargetDriveId = defaultString(val.mediaAcquisitionTargetDriveId, '')
  setting.mediaAcquisitionTargetFolderId = defaultString(val.mediaAcquisitionTargetFolderId, '')
  setting.mediaAcquisitionTargetFolderName = defaultString(val.mediaAcquisitionTargetFolderName, '')
}

let settingstr = ''


export function LoadSetting() {
  try {
    const settingConfig = getUserDataPath('setting.config')
    if (settingConfig && existsSync(settingConfig)) {
      settingstr = readFileSync(settingConfig, 'utf-8')
      const val = JSON.parse(settingstr)
      _loadSetting(val)
      if (setting.uiUpdateProxyUrl === 'https://mirror.ghproxy.com') {
        setting.uiUpdateProxyUrl = 'https://gh-proxy.com'
        SaveSetting()
      }
      useAppStore().toggleTheme(setting.uiTheme)
    } else {
      SaveSetting()
    }
  } catch {
    SaveSetting()
  }
  return setting
}

function defaultValue(val: any, check: any[], fallback = check[0]) {
  if (val && check.includes(val)) return val
  return fallback
}

function defaultString(val: any, check: string) {
  if (val && typeof val == 'string') return val
  return check
}

function defaultBool(val: any, check: boolean) {
  if (typeof val == 'boolean') return val
  return check
}

function defaultNumber(val: any, check: number) {
  if (typeof val == 'number') return val
  return check
}

function defaultNumberSub(val: any, check: number, min: number, max: number) {
  if (typeof val == 'number') {
    if (val < min) return min
    if (val > max) return max
    return val
  }
  return check
}


function SaveSetting() {
  try {
    const saveStr = JSON.stringify(setting)
    // console.log('SaveSetting', saveStr)
    if (saveStr != settingstr) {
      const settingConfig = getUserDataPath('setting.config')
      writeFileSync(settingConfig, saveStr, 'utf-8')
      settingstr = saveStr
    }
  } catch (err: any) {
    DebugLog.mSaveDanger('SaveSettingToJson', err)
  }
}

const useSettingStore = defineStore('setting', {
  state: (): SettingState => LoadSetting(),
  getters: {
    AriaIsLocal(state: SettingState): boolean {
      return state.ariaState == 'local'
    }
  },
  actions: {
    async updateStore(partial: Partial<SettingState>) {
      if (Object.hasOwn(partial, 'downUseAria2c')) {
        partial.downUseAria2c = normalizeAria2cEnabled(partial.downUseAria2c)
      }
      if (partial.uiTimeFolderFormate) {
        partial.uiTimeFolderFormate = partial.uiTimeFolderFormate
          .replace('mm-dd', 'MM-dd').replace('HH-MM', 'HH-mm')
      }
      this.$patch(partial)
      if (Object.hasOwn(partial, 'uiLaunchStart')) {
        window.WebToElectron({ cmd: { launchStart: this.uiLaunchStart, launchStartShow: this.uiLaunchStartShow } })
      }
      if (Object.hasOwn(partial, 'uiShowPanMedia')
        || Object.hasOwn(partial, 'uiFolderSize')
        || Object.hasOwn(partial, 'uiFileOrderDuli')) {
        await PanDAL.aReLoadOneDirToShow('', 'refresh', false)
      }
      if (Object.hasOwn(partial, 'proxyUseProxy')) {
        this.WebSetProxy()
      }
      SaveSetting()
      useAppStore().toggleTheme(setting.uiTheme)
      if (Object.hasOwn(partial, 'uiTheme')) window.WebSaveTheme({ theme: setting.uiTheme })
      window.MainProxyHost = setting.debugProxyHost
      window.MainProxyPort = setting.debugProxyPort
      window.WinMsgToUpload({ cmd: 'SettingRefresh' })
      window.WinMsgToDownload({ cmd: 'SettingRefresh' })
    },
    updateFileColor(key: string, title: string) {
      if (!key) return
      const arr = setting.uiFileColorArray.concat()
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].key == key) arr[i].title = title
      }
      this.$patch({ uiFileColorArray: arr })
      SaveSetting()
    },
    getProxy() {
      if (!this.proxyType || this.proxyType == 'none') return undefined
      if (!this.proxyHost) return undefined

      if (this.proxyType.startsWith('http')) {
        const auth = this.proxyUserName && this.proxyPassword ? this.proxyUserName + ':' + this.proxyPassword : ''
        return this.proxyType + '://' + (auth ? auth + '@' : '') + this.proxyHost + ':' + this.proxyPort
      }
      return {
        hostname: this.proxyHost,
        port: this.proxyPort,
        protocol: this.proxyType,
        username: this.proxyUserName,
        password: this.proxyPassword
      }
    },
    WebSetProxy() {
      let proxy = ''
      if (this.proxyUseProxy) {
        if (this.proxyType && this.proxyType !== 'none' && this.proxyHost && this.proxyPort) {
          const auth = this.proxyUserName && this.proxyPassword ? this.proxyUserName + ':' + this.proxyPassword : ''
          proxy = this.proxyType + '://' + (auth ? auth + '@' : '') + this.proxyHost + ':' + this.proxyPort
        }
      }
      window.WebSetProxy({ proxyUrl: proxy })
    },
    async syncBtTrackers(): Promise<void> {
      try {
        await (window as any).TvBoxInvoke('motrix:sync-trackers')
      } catch (e: any) {
        console.warn('[settingStore] syncBtTrackers failed', e?.message)
      }
    },
    async getBtTrackers(): Promise<string> {
      try {
        return await (window as any).TvBoxInvoke('motrix:get-trackers') || ''
      } catch {
        return ''
      }
    }
  }
})

export default useSettingStore
