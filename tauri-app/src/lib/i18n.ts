import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
const messages = {
  'zh-CN': {
    seek: '播放进度', addFileSource: '添加文件源', parentFolder: '上一级', refresh: '刷新', loadingFiles: '正在读取文件…', noSources: '还没有文件来源。添加文件夹即可开始浏览。', sourcePending: '此来源尚未接入', emptyFolder: '空文件夹 / 这儿什么都没有。', pause: '暂停', resume: '播放', previous: '上一集', next: '下一集', fullScreen: '全屏', volume: '音量', speed: '倍速', audioTrack: '音轨', subtitleTrack: '字幕', off: '关闭', playerEmpty: '选择视频开始播放', loadingVideo: '正在加载视频…', exportData: '导出迁移数据', importData: '导入迁移数据', migrationDone: '数据迁移完成', dataMigration: '数据迁移',
    network: '网络与代理', searchShort: '搜索', upgradeTo: '升级到', general: '通用', preferences: '偏好设置',
    home: '主屏幕', library: '媒体库', files: '文件', search: '搜索媒体、文件与资源', favorites: '收藏夹', recent: '最近添加', movies: '电影', series: '剧集', music: '音乐', directURL: '直接播放 URL', collapseFiles: '折叠文件列表', expandFiles: '展开文件列表',
    settings: '设置', appearance: '外观', theme: '主题', language: '语言', system: '跟随系统', light: '浅色', dark: '深色', launch: '启动与窗口', closeToTray: '关闭主窗口后保留在托盘', launchAtLogin: '登录系统时启动', startHidden: '自动启动时隐藏主窗口', storage: '存储与诊断', dataDirectory: '开发数据目录', reveal: '打开数据目录', version: '开发版本',
    preview: '浏览器预览 · 原生功能不可用，设置不会保存', native: '原生开发窗口', emptyTitle: '你的媒体，从这里开始', emptyDescription: '从「文件」添加来源，即可浏览和播放视频。', addSource: '从文件添加本地来源，点击视频播放', selectFile: '选择文件', openPlayer: '打开播放窗口', playerTitle: '本地视频播放器', playerDescription: '选择本地视频，通过 mpv 播放。',
    collapse: '折叠侧边栏', expand: '展开侧边栏', back: '返回', help: '项目主页', feedback: '反馈', account: '账号管理', pro: 'Pro 订阅暂不可用', error: '操作未完成', saved: '已保存', selected: '已选择文件', minimize: '最小化', maximize: '最大化 / 还原', close: '关闭窗口', stage: '迁移阶段 M3', notConnected: '尚未接入', settingsLoading: '正在读取设置…', retry: '重试', menu: '更多操作', unavailable: '此功能将在后续阶段接入', requests: '已收到打开请求。', searchPending: '搜索暂不可用',
  },
  en: {
    seek: 'Playback position', addFileSource: 'Add file source', parentFolder: 'Parent folder', refresh: 'Refresh', loadingFiles: 'Loading files…', noSources: 'No file sources yet. Add a folder to start browsing.', sourcePending: 'This source is not connected yet', emptyFolder: 'Empty folder / Nothing here.', pause: 'Pause', resume: 'Play', previous: 'Previous', next: 'Next', fullScreen: 'Fullscreen', volume: 'Volume', speed: 'Speed', audioTrack: 'Audio track', subtitleTrack: 'Subtitles', off: 'Off', playerEmpty: 'Select a video to start playback', loadingVideo: 'Loading video…', exportData: 'Export migration data', importData: 'Import migration data', migrationDone: 'Data migration complete', dataMigration: 'Data migration',
    network: 'Network & proxy', searchShort: 'Search', upgradeTo: 'Upgrade to', general: 'General', preferences: 'Preferences',
    home: 'Home', library: 'Library', files: 'Files', search: 'Search media, files and resources', favorites: 'Favorites', recent: 'Recently added', movies: 'Movies', series: 'TV shows', music: 'Music', directURL: 'Direct URL', collapseFiles: 'Collapse files', expandFiles: 'Expand files',
    settings: 'Settings', appearance: 'Appearance', theme: 'Theme', language: 'Language', system: 'System', light: 'Light', dark: 'Dark', launch: 'Startup & windows', closeToTray: 'Keep running in tray when the main window closes', launchAtLogin: 'Launch at login', startHidden: 'Hide the main window on automatic startup', storage: 'Storage & diagnostics', dataDirectory: 'Development data directory', reveal: 'Open data directory', version: 'Development version',
    preview: 'Browser preview · Native features unavailable; settings are not saved', native: 'Native development window', emptyTitle: 'Your media starts here', emptyDescription: 'Add a source in Files to browse and play videos.', addSource: 'Add a local source in Files and select a video', selectFile: 'Choose a file', openPlayer: 'Open player window', playerTitle: 'Local video player', playerDescription: 'Choose a local video to play with mpv.',
    collapse: 'Collapse sidebar', expand: 'Expand sidebar', back: 'Back', help: 'Project website', feedback: 'Feedback', account: 'Accounts', pro: 'Pro subscriptions are currently unavailable', error: 'Action failed', saved: 'Saved', selected: 'File selected', minimize: 'Minimize', maximize: 'Maximize / restore', close: 'Close window', stage: 'Migration milestone M3', notConnected: 'Not connected', settingsLoading: 'Loading settings…', retry: 'Retry', menu: 'More actions', unavailable: 'Available in a later milestone', requests: 'Open request received.', searchPending: 'Search is currently unavailable',
  }
} as const
export type MessageKey = keyof typeof messages.en
export function useI18n() {
  const settings = useSettingsStore()
  const language = computed(() => settings.value.language)
  const t = (key: MessageKey): string => messages[language.value][key]
  return { t, language }
}
