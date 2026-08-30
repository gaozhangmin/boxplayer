<script setup lang='ts'>
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  KeyboardState,
  useAppStore,
  useFootStore,
  useKeyboardStore,
  useMouseStore,
  useServerStore,
  useSettingStore,
  useUserStore,
  useWinStore
} from '../store'
import useMusicLibraryStore from '../store/musiclibrary'
import useMusicPlayerStore from '../store/musicplayerstore'
import useBookLibraryStore from '../store/booklibrary'
import { useMediaLibraryStore } from '../store/medialibrary'
import { BookOpen, Music, PanelLeftClose, PanelLeftOpen, Pause, Play, SkipBack, SkipForward, Video } from 'lucide-vue-next'
import { onHideRightMenu, TestAlt, TestCtrl, TestKey, TestShift } from '../utils/keyboardhelper'
import { copyToClipboard, getFromClipboard, openExternal } from '../utils/electronhelper'
import { bootstrapMusicLibrary, shutdownMusicLibrary } from '../utils/musicLibraryBootstrap'
import { bootstrapMediaLibrary, shutdownMediaLibrary } from '../utils/mediaLibraryBootstrap'
import { bootstrapBookLibrary, shutdownBookLibrary } from '../utils/bookLibraryBootstrap'
import { QRCode as AntQRCode } from 'ant-design-vue'
import { Modal } from '@arco-design/web-vue'
import DebugLog from '../utils/debuglog'
import message from '../utils/message'
import { t } from '../i18n'

import Pan from '../pan/index.vue'
import DropOverlay from '../components/radio/DropOverlay.vue'

import UserInfo from '../user/UserInfo.vue'
import UserLogin from '../user/UserLogin.vue'
import ShutDown from '../setting/ShutDown.vue'
import LimitReachedModal from '../setting/LimitReachedModal.vue'

import MyModal from './MyModal.vue'
import { B64decode } from '../utils/format'
import { throttle } from '../utils/debounce'
import { modalDaoRuShareLink } from '../utils/modal'
import { detectShareLink } from '../utils/shareLinkDetection'

const Setting = defineAsyncComponent(() => import('../setting/index.vue'))
const Rss = defineAsyncComponent(() => import('../rss/index.vue'))
const Share = defineAsyncComponent(() => import('../share/index.vue'))
const Down = defineAsyncComponent(() => import('../down/index.vue'))
const MediaLibraryView = defineAsyncComponent(() => import('../views/MediaLibraryView.vue'))
const MediaServerView = defineAsyncComponent(() => import('../views/MediaServerView.vue'))
const PageMusicLibrary = defineAsyncComponent(() => import('./PageMusicLibrary.vue'))
const PageBookLibrary = defineAsyncComponent(() => import('./PageBookLibrary.vue'))
const PageGlobalSearch = defineAsyncComponent(() => import('./PageGlobalSearch.vue'))
const PageAIWorkspace = defineAsyncComponent(() => import('./PageAIWorkspace.vue'))

const wechatPayImage = 'images/wechat_pay.jpg'
const alipayImage = 'images/alipay.jpg'
const cryptoDonationAddress = '0xb0a3f7254e97a8bd398b1ab7f70eb48b0dc68eaf'
const panVisible = ref(true)
const mediaNavVisible = ref(true)
const mediaServerNavVisible = ref(true)
const sidebarVisibility = ref<Record<'down' | 'share' | 'rss' | 'setting' | 'music' | 'book' | 'ai-workspace', boolean>>({
  down: true,
  share: true,
  rss: true,
  setting: true,
  music: true,
  book: true,
  'ai-workspace': true
})
const showLimitModal = ref(false)
const pricingPollTimer = window.setInterval(() => {
  if (localStorage.getItem('boxplayer_show_pricing') === '1') {
    localStorage.removeItem('boxplayer_show_pricing')
    showLimitModal.value = true
  }
}, 2000)
const appStore = useAppStore()
const settingStore = useSettingStore()
const winStore = useWinStore()
const keyboardStore = useKeyboardStore()
const mouseStore = useMouseStore()
const footStore = useFootStore()
let removeAutoUpdateStateListener: (() => void) | undefined
let shareClipboardTimer: number | undefined
let lastShareClipboardSignature = ''
let shareClipboardPromptOpen = false
const musicStore = useMusicLibraryStore()
const musicPlayerStore = useMusicPlayerStore()
const bookStore = useBookLibraryStore()
const mediaStore = useMediaLibraryStore()

function syncAutoUpdateState(state: { status?: string; percent?: number; version?: string }) {
  const status = state.status === 'downloading' || state.status === 'downloaded' || state.status === 'error' ? state.status : 'idle'
  footStore.updateStore({
    updateDownloadProgress: status === 'downloading' ? Math.max(0, Math.min(100, state.percent ?? 0)) : status === 'downloaded' ? 100 : 0,
    updateDownloadStatus: status,
    updateDownloadVersion: state.version || ''
  })
}

function checkClipboardShareLink() {
  if (document.visibilityState !== 'visible' || shareClipboardPromptOpen) return
  let clipboardText = ''
  try {
    clipboardText = getFromClipboard()
  } catch {
    return
  }
  const share = detectShareLink(clipboardText)
  if (!share) return
  const signature = `${share.provider}:${share.url}:${share.password}`
  if (signature === lastShareClipboardSignature) return
  lastShareClipboardSignature = signature
  shareClipboardPromptOpen = true
  const isEnglish = settingStore.uiLanguage === 'en-US'
  Modal.confirm({
    title: isEnglish ? `${share.providerName} share link detected` : `检测到${share.providerName}分享链接`,
    content: share.canImport
      ? (isEnglish ? 'View this share in BoxPlayer and choose files to save?' : '是否在 BoxPlayer 中查看并选择要保存的文件？')
      : (isEnglish ? `BoxPlayer cannot directly save ${share.providerName} share links yet. Open it in your browser?` : `BoxPlayer 暂不支持直接转存${share.providerName}分享链接，是否使用浏览器打开？`),
    okText: share.canImport ? (isEnglish ? 'View and save' : '查看并保存') : (isEnglish ? 'Open link' : '打开链接'),
    cancelText: isEnglish ? 'Ignore' : '忽略',
    onOk: () => {
      shareClipboardPromptOpen = false
      if (share.canImport) modalDaoRuShareLink(share.url, share.password)
      else openExternal(share.url)
    },
    onCancel: () => {
      shareClipboardPromptOpen = false
    }
  })
}

function scheduleClipboardShareCheck() {
  window.clearTimeout(shareClipboardTimer)
  shareClipboardTimer = window.setTimeout(checkClipboardShareLink, 250)
}

function handleDocumentVisibilityChange() {
  if (document.visibilityState === 'visible') scheduleClipboardShareCheck()
}

async function handleInstallUpdate() {
  const installed = await window.AutoUpdateInstall?.()
  if (!installed) message.warning('更新尚未下载完成')
}

const SYSTEM_VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm', 'ts', 'm2ts', 'flv', 'wmv', 'mpg', 'mpeg'])
const SYSTEM_AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'wma', 'aiff', 'ape'])
const SYSTEM_BOOK_EXTENSIONS = new Set(['epub', 'pdf', 'mobi', 'azw', 'azw3', 'fb2', 'txt', 'md', 'markdown', 'docx', 'html', 'htm', 'cbz', 'cbr', 'cbt', 'cb7'])

function getSystemFileExtension(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() || ''
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
}

function openSystemFile(payload: { filePath: string; fileUrl: string }) {
  const filePath = payload?.filePath || ''
  const fileUrl = payload?.fileUrl || ''
  const fileName = filePath.split(/[\\/]/).pop() || filePath
  const ext = getSystemFileExtension(filePath)
  if (!filePath || !fileUrl || !fileName) return

  if (SYSTEM_VIDEO_EXTENSIONS.has(ext)) {
    window.WebOpenWindow?.({
      page: 'PageVideo',
      theme: appStore.appTheme,
      data: { user_id: 'local', drive_id: 'local', file_id: filePath, parent_file_id: '', parent_file_name: '', file_name: fileName, html: '', encType: '', password: '', expire_time: 0, play_cursor: 0 }
    })
    return
  }
  if (SYSTEM_AUDIO_EXTENSIONS.has(ext)) {
    const track = { user_id: 'local', drive_id: 'local', file_id: filePath, parent_file_id: '', file_name: fileName, ext, encType: '', password: '', local_url: fileUrl }
    window.WebOpenWindow?.({ page: 'PageMusic', theme: appStore.appTheme, data: { ...track, parent_file_name: '', playlist: [track] } })
    return
  }
  if (SYSTEM_BOOK_EXTENSIONS.has(ext)) {
    const now = Date.now()
    window.WebOpenWindow?.({
      page: 'PageBookReader',
      theme: 'dark',
      data: { id: `system-${now}`, user_id: 'local', drive_id: 'local', file_id: filePath, parent_file_id: '', file_name: fileName, ext, size: 0, category: ['cbz', 'cbr', 'cbt', 'cb7'].includes(ext) ? 'comic' : 'book', title: fileName.replace(/\.[^.]+$/, ''), scanned_at: now, updated_at: now, sourceUrlOverride: fileUrl }
    })
    return
  }
  message.warning(`暂不支持打开 ${fileName}`)
}

const handleMusicLibraryClick = () => {
  appStore.toggleTab('music')
}

const handleBookLibraryClick = () => {
  appStore.toggleTab('book')
}

const handleMediaLibraryClick = () => {
  appStore.toggleTab('media')
}

const sidebarTabs = new Set(['pan', 'down', 'share', 'rss', 'media', 'media-server', 'music', 'book', 'ai-workspace', 'setting'])
const hasActiveSidebar = computed(() => sidebarTabs.has(appStore.appTab))
const activeSidebarVisible = computed(() => {
  if (appStore.appTab === 'pan') return panVisible.value
  if (appStore.appTab === 'media') return mediaNavVisible.value
  if (appStore.appTab === 'media-server') return mediaServerNavVisible.value
  return sidebarVisibility.value[appStore.appTab as keyof typeof sidebarVisibility.value] ?? true
})
const handleToggleSidebar = () => {
  if (appStore.appTab === 'pan') panVisible.value = !panVisible.value
  else if (appStore.appTab === 'media') mediaNavVisible.value = !mediaNavVisible.value
  else if (appStore.appTab === 'media-server') mediaServerNavVisible.value = !mediaServerNavVisible.value
  else if (appStore.appTab in sidebarVisibility.value) {
    const tab = appStore.appTab as keyof typeof sidebarVisibility.value
    sidebarVisibility.value = { ...sidebarVisibility.value, [tab]: !sidebarVisibility.value[tab] }
  }
}

const handleCopyCryptoDonationAddress = () => {
  copyToClipboard(cryptoDonationAddress)
  message.success(t('footer.cryptoCopied'))
}

const handleThemeClick = (val: any) => {
  if (appStore.appTheme == 'system') {
    if (appStore.appDark) {
      useSettingStore().updateStore({ uiTheme: 'light' })
    } else {
      useSettingStore().updateStore({ uiTheme: 'dark' })
    }
  } else if (appStore.appTheme === 'dark') {
    useSettingStore().updateStore({ uiTheme: 'light' })
  } else if (appStore.appTheme === 'light') {
    useSettingStore().updateStore({ uiTheme: 'dark' })
  }
}
const themeTitle = computed(() => {
  if (appStore.appTheme == 'system') {
    return t('theme.auto')
  } else if (appStore.appTheme === 'light') {
    return t('theme.light')
  } else if (appStore.appTheme === 'dark') {
    return t('theme.dark')
  }
})

const primaryTabDefinitions = [
  { key: 'pan', title: 'Alt+1', labelKey: 'nav.pan' },
  { key: 'media-server', title: 'Alt+6', labelKey: 'nav.mediaServer' },
  { key: 'search', title: 'Ctrl+K', labelKey: 'nav.search' },
  { key: 'ai-workspace', title: 'AI Workspace', labelKey: 'nav.aiWorkspace' },
  { key: 'media', title: 'Alt+5', labelKey: 'nav.video' },
  { key: 'music', title: 'Alt+8', labelKey: 'nav.music' },
  { key: 'book', title: 'Alt+9', labelKey: 'nav.books' }
]

const orderedPrimaryTabs = computed(() => {
  const preferred = settingStore.uiDefaultTab || 'pan'
  return [...primaryTabDefinitions].sort((a, b) => {
    if (a.key === preferred) return -1
    if (b.key === preferred) return 1
    return primaryTabDefinitions.findIndex((item) => item.key === a.key)
      - primaryTabDefinitions.findIndex((item) => item.key === b.key)
  })
})

const trailingTabs = [
  { key: 'down', title: 'Alt+2', labelKey: 'nav.transfer' },
  { key: 'share', title: 'Alt+3', labelKey: 'nav.share' },
  { key: 'rss', title: 'Alt+4', labelKey: 'nav.plugins' }
]

const topNavTabs = computed(() => {
  const hidden = new Set(settingStore.uiHiddenTopTabs || [])
  return [...orderedPrimaryTabs.value, ...trailingTabs].filter((tab) => !hidden.has(tab.key))
})

const handleHideClick = (_e: any) => {
  if (window.WebToElectron) window.WebToElectron({ cmd: useSettingStore().uiExitOnClose ? 'exit' : 'close' })
}
const handleMinClick = (_e: any) => {
  if (window.WebToElectron) window.WebToElectron({ cmd: 'minsize' })
}
const handleMaxClick = (_e: any) => {
  if (window.WebToElectron) window.WebToElectron({ cmd: 'maxsize' })
}

const handleHelpPage = () => {
  const ourl = B64decode(useServerStore().helpUrl)
  if (ourl) openExternal(ourl)
}

const handleGlobalSearch = () => {
  appStore.toggleTab('search')
}

keyboardStore.$subscribe((_m: any, state: KeyboardState) => {
  if (TestAlt('1', state.KeyDownEvent, () => appStore.toggleTab('pan'))) return
  if (TestAlt('2', state.KeyDownEvent, () => appStore.toggleTab('down'))) return
  if (TestAlt('3', state.KeyDownEvent, () => appStore.toggleTab('share'))) return
  if (TestAlt('4', state.KeyDownEvent, () => appStore.toggleTab('rss'))) return
  if (TestAlt('5', state.KeyDownEvent, () => appStore.toggleTab('media'))) return
  if (TestAlt('6', state.KeyDownEvent, () => appStore.toggleTab('media-server'))) return
  if (TestAlt('7', state.KeyDownEvent, () => appStore.toggleTab('setting'))) return
  if (TestAlt('8', state.KeyDownEvent, () => appStore.toggleTab('music'))) return
  if (TestAlt('9', state.KeyDownEvent, () => appStore.toggleTab('book'))) return
  if (TestAlt('f4', state.KeyDownEvent, () => handleHideClick(undefined))) return
  if (TestAlt('m', state.KeyDownEvent, () => handleMinClick(undefined))) return
  if (TestAlt('enter', state.KeyDownEvent, () => handleMaxClick(undefined))) return
  if (TestShift('tab', state.KeyDownEvent, () => appStore.toggleTabNext())) return
  if (TestCtrl('tab', state.KeyDownEvent, () => appStore.toggleTabNextMenu())) return
  if (TestAlt('l', state.KeyDownEvent, () => (useUserStore().userShowLogin = true))) return
  const f11 = () => {
    if (window.WebToElectron) window.WebToElectron({ cmd: 'maxsize' })
  }
  if (TestKey('f11', state.KeyDownEvent, f11)) return
})


const onResize = throttle(() => {
  try {
    const width = document.body.offsetWidth || 960
    const height = document.body.offsetHeight || 720
    if (winStore.width != width || winStore.height != height) {
      winStore.updateStore({ width, height })
    }
  } catch (err) {
  }
  // let ddsound = document.getElementById('ddsound') as { play: any } | undefined
  // if (ddsound) ddsound.play()
}, 50)

const onKeyDown = (event: KeyboardEvent) => {
  const ele = (event.srcElement || event.target) as any
  const nodeName = ele && ele.nodeName
  if (event.key === 'Tab') {
    event.preventDefault()
    event.stopPropagation()
    event.cancelBubble = true
    event.returnValue = false
    if (nodeName && !'BODY|DIV'.includes(nodeName)) ele.blur()
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !event.repeat) {
    event.preventDefault()
    appStore.toggleTab('search')
    return
  }
  if (document.body.getElementsByClassName('arco-modal-container').length) return
  if (event.key == 'Control' || event.key == 'Shift' || event.key == 'Alt' || event.key == 'Meta') return
  const isInput = nodeName == 'INPUT' || nodeName == 'TEXTAREA' || false
  if (!isInput) {
    onHideRightMenu()
    keyboardStore.KeyDown(event)
  }
}

const onMouseDown = (event: MouseEvent) => {
  const ele = (event.srcElement || event.target) as any
  const nodeName = ele && ele.nodeName
  if (document.body.getElementsByClassName('arco-modal-container').length) return
  const isInput = nodeName == 'INPUT' || nodeName == 'TEXTAREA' || false
  if (!isInput) {
    mouseStore.KeyDown(event)
  }
}
const handleAsyncDeleteAll = () => {
  footStore.mDeleteAllTask()
}
const handleAsyncClear = () => {
  footStore.mClearTask()
}
const handleAsyncDelete = (key: string) => {
  footStore.mDeleteTask(key)
}
const handleAudioStop = () => {
  footStore.mSaveAudioUrl('')
}

const formatFooterMusicTime = (sec: number): string => {
  if (!isFinite(sec) || sec < 0) sec = 0
  const total = Math.floor(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const handleFooterMusicToggle = () => {
  musicPlayerStore.sendCommand('toggle')
}

const handleFooterMusicPrev = () => {
  musicPlayerStore.sendCommand('prev')
}

const handleFooterMusicNext = () => {
  musicPlayerStore.sendCommand('next')
}

const handleMineradioFilesDropped = (files: File[]) => {
  const audioCount = files.filter((file) => /^audio\//i.test(file.type) || /\.(mp3|flac|wav|ogg|m4a|aac)$/i.test(file.name)).length
  const imageCount = files.filter((file) => /^image\//i.test(file.type) || /\.(jpg|jpeg|png|webp)$/i.test(file.name)).length
  if (audioCount > 0) {
    message.info(t('music.cloudOnlyInfo'))
    appStore.toggleTab('music')
    return
  }
  if (imageCount > 0) {
    message.info(t('music.cropInVisualConsole'))
    return
  }
  message.warning(t('music.dropUnsupported'))
}

// Apply saved default tab — watch ensures it fires after store + template are ready
watch(() => settingStore.uiDefaultTab, (tab) => {
  if (tab && appStore.appTab !== tab) {
    appStore.toggleTab(tab)
  }
}, { immediate: true })

onMounted(() => {
  onResize()
  DebugLog.aLoadFromDB()
  window.addEventListener('resize', onResize, { passive: true })
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('mousedown', onMouseDown, true)
  window.addEventListener('focus', scheduleClipboardShareCheck)
  document.addEventListener('visibilitychange', handleDocumentVisibilityChange)
  setTimeout(() => {
    onHideRightMenu()
  }, 300)
  window.addEventListener('click', onHideRightMenu, { passive: true })
  bootstrapMusicLibrary()
  bootstrapBookLibrary()
  bootstrapMediaLibrary()
  window.onExternalFileOpen?.(openSystemFile)
  window.AutoUpdateGetState?.().then((state) => {
    syncAutoUpdateState(state)
  })
  removeAutoUpdateStateListener = window.AutoUpdateOnStateChanged?.((state) => {
    syncAutoUpdateState(state)
  })
  shareClipboardTimer = window.setTimeout(checkClipboardShareLink, 800)
})

onUnmounted(() => {
  window.clearTimeout(shareClipboardTimer)
  window.clearInterval(pricingPollTimer)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('mousedown', onMouseDown)
  window.removeEventListener('focus', scheduleClipboardShareCheck)
  document.removeEventListener('visibilitychange', handleDocumentVisibilityChange)
  window.removeEventListener('click', onHideRightMenu)
  shutdownMusicLibrary()
  shutdownMediaLibrary()
  shutdownBookLibrary()
  removeAutoUpdateStateListener?.()
})
</script>
<template>
  <a-layout style='height: 100vh' draggable='false'>
    <a-layout-header id='xbyhead' draggable='false'>
      <div id='xbyhead2' class='q-electron-drag'>
        <a-button v-show="hasActiveSidebar" type='text' size='small' :title="activeSidebarVisible ? '收起侧边栏' : '展开侧边栏'" @click='handleToggleSidebar'>
          <PanelLeftClose v-if='activeSidebarVisible' :size='18' :stroke-width='1.8' />
          <PanelLeftOpen v-else :size='18' :stroke-width='1.8' />
        </a-button>
        <a-menu mode='horizontal' :selected-keys='[appStore.appTab]'
                @update:selected-keys='appStore.toggleTab($event[0])'>
          <a-menu-item
            v-for='item in topNavTabs'
            :key='item.key'
            :data-testid='`top-nav-${item.key}`'
            :title='item.title'
          >
            {{ t(item.labelKey as Parameters<typeof t>[0]) }}
          </a-menu-item>
        </a-menu>

        <ShutDown />
        <UserInfo />
        <UserLogin />
        <a-button type='text' tabindex='-1' style="margin-right: 5px" :title='themeTitle' @click="handleThemeClick">
          <IconFont name="iconnight" v-if="appStore.appTheme === 'dark' || (appStore.appTheme == 'system' && appStore.appDark)" />
          <IconFont name="iconday" v-else />
        </a-button>
        <a-button type='text' tabindex='-1' data-testid='open-settings' :title="`${t('common.settings')} Alt+7`" :class="appStore.appTab == 'setting' ? 'active' : ''"
                  @click="appStore.toggleTab('setting')">
          <IconFont name="iconsetting" />
        </a-button>
        <a-button type='text' tabindex='-1' :title="`${t('common.minimize')} Alt+M`" @click='handleMinClick'>
          <IconFont name="iconzuixiaohua" />
        </a-button>
        <a-button type='text' tabindex='-1' :title="`${t('common.maximize')} Alt+Enter`" @click='handleMaxClick'>
          <IconFont name="iconfullscreen" />
        </a-button>
        <a-button type='text' tabindex='-1' :title="`${t('common.close')} Alt+F4`" @click='handleHideClick'>
          <IconFont name="iconclose" />
        </a-button>
      </div>
    </a-layout-header>
    <a-layout-content id='xbybody'>
      <a-tabs type='text' :direction="'horizontal'" class='hidetabs' :justify='true' :active-key='appStore.appTab' lazy-load>
        <a-tab-pane key='pan' title='1'>
          <Pan :visible='panVisible' />
        </a-tab-pane>
        <a-tab-pane key='down' title='2'>
          <Down :sidebar-visible="sidebarVisibility.down" />
        </a-tab-pane>
        <a-tab-pane key='share' title='3'>
          <Share :sidebar-visible="sidebarVisibility.share" />
        </a-tab-pane>
        <a-tab-pane key='rss' title='4'>
          <Rss :sidebar-visible="sidebarVisibility.rss" />
        </a-tab-pane>
        <a-tab-pane key='media' title='5'>
          <MediaLibraryView :navVisible="mediaNavVisible" />
        </a-tab-pane>
        <a-tab-pane key='media-server' title='6'>
          <MediaServerView :navVisible="mediaServerNavVisible" />
        </a-tab-pane>
        <a-tab-pane key='music' title='8'>
          <PageMusicLibrary :sidebar-visible="sidebarVisibility.music" />
        </a-tab-pane>
        <a-tab-pane key='book' title='9'>
          <PageBookLibrary :sidebar-visible="sidebarVisibility.book" />
        </a-tab-pane>
        <a-tab-pane key='search' title='0'>
          <PageGlobalSearch />
        </a-tab-pane>
        <a-tab-pane key='ai-workspace' :title="t('ai.workspace')">
          <PageAIWorkspace :sidebar-visible="sidebarVisibility['ai-workspace']" />
        </a-tab-pane>
        <a-tab-pane key='setting' title='7'>
          <Setting :sidebar-visible="sidebarVisibility.setting" />
        </a-tab-pane>
      </a-tabs>
    </a-layout-content>
    <a-layout-footer id='xbyfoot' draggable='false'>
      <div id='footer2'>
        <div v-if='footStore.loadingInfo' id='footLoading' class='footerBar fix' style='padding: 0 8px 0 0'>
          <div class='arco-spin'>
            <div class='arco-spin-icon'>
              <svg viewBox='0 0 48 48' fill='none' xmlns='http://www.w3.org/2000/svg' stroke='currentColor'
                   class='arco-icon arco-icon-loading arco-icon-spin' stroke-width='4' stroke-linecap='butt'
                   stroke-linejoin='miter'>
                <path d='M42 24c0 9.941-8.059 18-18 18S6 33.941 6 24 14.059 6 24 6'></path>
              </svg>
            </div>
          </div>
          <span style='margin-right: 8px'>{{ footStore.loadingInfo }}</span>
        </div>
        <div class='footinfo'>
          {{ footStore.GetSpaceInfo }}
        </div>
        <div
          v-if="musicPlayerStore.state.hasTrack"
          class='footer-music-player'
          :title="musicPlayerStore.state.title || t('music.player')"
        >
          <div class='footer-music-cover' @click='musicPlayerStore.togglePanel()'>
            <img v-if='musicPlayerStore.state.coverUrl' :src='musicPlayerStore.state.coverUrl' alt='' />
            <Music v-else :size='14' :stroke-width='1.8' />
          </div>
          <div class='footer-music-meta' @click='musicPlayerStore.togglePanel()'>
            <div class='footer-music-title'>{{ musicPlayerStore.state.title || t('music.player') }}</div>
            <div class='footer-music-bar'>
              <div class='footer-music-bar-fill' :style="{ width: musicPlayerStore.state.progressPercent + '%' }"></div>
            </div>
          </div>
          <span class='footer-music-time'>
            {{ formatFooterMusicTime(musicPlayerStore.state.currentTime) }}
          </span>
          <button class='footer-music-btn' :title="t('music.previousTrack')" @click.stop='handleFooterMusicPrev'>
            <SkipBack :size='13' :stroke-width='2' />
          </button>
          <button class='footer-music-btn primary' :title="musicPlayerStore.state.isPlaying ? t('music.pause') : t('music.play')" @click.stop='handleFooterMusicToggle'>
            <Pause v-if='musicPlayerStore.state.isPlaying' :size='13' :stroke-width='2' :fill="'currentColor'" />
            <Play v-else :size='13' :stroke-width='2' :fill="'currentColor'" />
          </button>
          <button class='footer-music-btn' :title="t('music.nextTrack')" @click.stop='handleFooterMusicNext'>
            <SkipForward :size='13' :stroke-width='2' />
          </button>
          <button class='footer-music-toggle' :title="musicPlayerStore.panelVisible ? t('music.collapse') : t('music.expand')" @click.stop='musicPlayerStore.togglePanel()'>
            {{ musicPlayerStore.panelVisible ? t('music.collapse') : t('music.expand') }}
          </button>
        </div>
        <div
          v-if="musicStore.isScanning && appStore.appTab !== 'music'"
          class='footerBar fix music-scan-foot'
          style='cursor: pointer; gap: 6px'
          :title="musicStore.scanLabel || t('music.scanningLibrary')"
          @click='handleMusicLibraryClick'
        >
          <Music :size="14" :stroke-width="1.8" class="music-scan-spin" />
          <span class='music-scan-text'>
            {{ musicStore.scanLabel || t('music.scanningLibrary') }} · {{ musicStore.scanFound }} {{ t('music.songsUnit') }}
          </span>
        </div>
        <div
          v-if="mediaStore.isScanning && appStore.appTab !== 'media'"
          class='footerBar fix music-scan-foot'
          style='cursor: pointer; gap: 6px'
          :title="`${t('footer.scanningMedia')} ${mediaStore.scanProgress}/${mediaStore.scanTotal}`"
          @click='handleMediaLibraryClick'
        >
          <Video :size="14" :stroke-width="1.8" class="music-scan-spin" />
          <span class='music-scan-text'>
            {{ t('footer.scanningMedia') }} {{ mediaStore.scanProgress }}/{{ mediaStore.scanTotal }}
          </span>
        </div>
        <div
          v-if="bookStore.isScanning && appStore.appTab !== 'book'"
          class='footerBar fix music-scan-foot'
          style='cursor: pointer; gap: 6px'
          :title="bookStore.scanLabel || t('footer.scanningBooks')"
          @click='handleBookLibraryClick'
        >
          <BookOpen :size="14" :stroke-width="1.8" class="music-scan-spin" />
          <span class='music-scan-text'>
            {{ bookStore.scanLabel || t('footer.scanningBooks') }} · {{ bookStore.scanFound }} {{ t('file.book') }}
          </span>
        </div>
        <div class='flexauto' />
        <div :style="{ display: 'flex', paddingRight: '16px', flexShrink: 0, flexGrow: 0 }">
          <div class='flexauto'></div>
          <div class='footinfo'>
            {{ footStore.GetInfo }}
          </div>
          <div v-if='footStore.audioUrl' style='width: 300px; display: flex; overflow: hidden'>
            <audio controls autoplay style='width: 360px; height: 24px; margin: 0 -50px 0 -12px'
                   :src='footStore.audioUrl'>no audio
            </audio>
          </div>
          <div v-if='footStore.audioUrl' class='footerBar fix' :title="t('footer.audioPreviewClose')" style='cursor: pointer'
               @click.stop='handleAudioStop()'>
            <IconFont name="iconclose" />
          </div>

          <div class='footerBar fix' v-show='footStore.uploadTotalSpeed'>
            <IconFont name="iconshangchuansudu" />
            <span id='footUploadSpeed' class='footspeedstr'>
              {{ footStore.uploadTotalSpeed }}
            </span>
          </div>

          <div class='footerBar fix' v-show='footStore.downloadTotalSpeed'>
            <IconFont name="iconxiazaisudu" />
            <span id='footDownSpeed' class='footspeedstr'>
              {{ footStore.downloadTotalSpeed }}
            </span>
          </div>

          <div class='footerBar fix update-progress-foot' v-show="footStore.updateDownloadStatus === 'downloading'" :title="`${t('footer.newVersion')} ${Math.round(footStore.updateDownloadProgress)}%`">
            <svg aria-hidden='true' class='update-progress-ring' viewBox='0 0 20 20'>
              <circle class='update-progress-track' cx='10' cy='10' fill='none' r='8' stroke-width='2' />
              <circle class='update-progress-value' cx='10' cy='10' fill='none' r='8' stroke-width='2' :style='{ strokeDashoffset: 50.27 * (1 - footStore.updateDownloadProgress / 100) }' />
            </svg>
            <span class='update-progress-label'>{{ Math.round(footStore.updateDownloadProgress) }}%</span>
          </div>
          <button class='footerBar fix update-progress-foot update-ready-foot' v-show="footStore.updateDownloadStatus === 'downloaded'" :title="`${footStore.updateDownloadVersion || t('footer.newVersion')} 已下载，点击重启安装`" @click='handleInstallUpdate'>
            {{ footStore.updateDownloadVersion || t('footer.newVersion') }} · 安装
          </button>

          <div class='footerBar fix'>
            <span class='footAria' :title="t('footer.ariaConnected')" v-if='footStore.ariaInfo'> {{ footStore.ariaInfo }} </span>
            <span class='footAria' :title="t('footer.ariaOffline')" v-else> Aria ⚯ Offline </span>
          </div>

          <a-popover v-model:popup-visible='footStore.taskVisible' trigger='click' position='top' class='asynclist'>
            <div class='footerBar fix' :title="t('footer.asyncNotifications')" style='cursor: pointer'>
              <span :class="footStore.GetIsRunning ? 'shake' : ''">
                <IconFont name="icontongzhiblue" />
              </span>
              <span>{{ t('footer.asyncNotifications') }}</span>
            </div>
            <template #content>
              <div style='width: 360px; min-height: 120px; max-height: 50vh; overflow-y: auto; overflow-x: hidden'>
                <div style="display:flex;" v-if="footStore.taskList.length > 0">
                  <div style="flex: 1;" :title="t('footer.taskList')">{{ t('footer.taskList') }}</div>
                  <div style="flex: 1;text-align: right">
                    <a-button-group>
                      <a-button type="outline" size='mini' :title="t('footer.clearCompleted')" @click.stop="handleAsyncClear">
                        {{ t('footer.clearCompleted') }}
                      </a-button>
                      <a-popconfirm :content="t('footer.clearAllTasksConfirm')" @ok="handleAsyncDeleteAll">
                        <a-button type="outline" size='mini' tabindex="-1" status="danger" :title="t('footer.clearAll')" style="margin-left: 2px">
                          {{ t('footer.clearAll') }}
                        </a-button>
                      </a-popconfirm>
                    </a-button-group>
                  </div>
                </div>
                <div v-for='item in footStore.taskList' :key='item.key' class='asynclistitem'>
                  <div class='asynclistitem-content'>
                    <div v-if="item.status == 'error'" class='asynclistitem-name danger' :title='item.title'>
                      {{ item.title }}
                    </div>
                    <div v-else class='asynclistitem-name' :title='item.title'>{{ item.title }}</div>
                    <span v-if="item.status == 'running'" class='asynclistitem-progress asynclistitem-icon-running'
                          :title="t('footer.running')"><IconFont name="iconhourglass" />{{ item.usetime }}</span>
                    <span v-if="item.status == 'success'" class='asynclistitem-progress asynclistitem-icon-success'
                          :title="t('footer.success')"><IconFont name="iconcheck" />{{ item.usetime }}</span>
                    <span v-if="item.status == 'error'" class='asynclistitem-progress asynclistitem-icon-error'
                          :title="t('footer.failed')"><IconFont name="iconclose" />{{ item.usetime }}</span>
                  </div>
                  <div class='asynclistitem-operation'>
                    <a-button type='text' size='mini' :title="t('footer.delete')" @click.stop='handleAsyncDelete(item.key)'>{{ t('footer.delete') }}</a-button>
                  </div>
                </div>
                <a-empty v-if='footStore.taskList.length == 0' style='margin-top: 24px'>{{ t('footer.noAsyncTasks') }}</a-empty>
              </div>
            </template>
          </a-popover>
          <a-popover trigger='hover' position='top' class='sponsor-popover'>
            <div class='footerBar fix footer-sponsor-button' :title="t('footer.sponsorApp')">
              <IconFont name="iconbiaozhang" />
              <span>{{ t('footer.sponsorApp') }}</span>
            </div>
            <template #content>
              <div class='sponsor-qrcode-panel'>
                <div class='sponsor-qrcode-item'>
                  <img :src='wechatPayImage' :alt="t('footer.wechatRewardCode')" />
                  <span>{{ t('footer.wechat') }}</span>
                </div>
                <div class='sponsor-qrcode-item'>
                  <img :src='alipayImage' :alt="t('footer.alipayRewardCode')" />
                  <span>{{ t('footer.alipay') }}</span>
                </div>
              </div>
              <div class='sponsor-crypto-panel'>
                <div class='sponsor-crypto-title' :title="t('footer.cryptoDonation')">{{ t('footer.cryptoDonation') }}</div>
                <div class='sponsor-crypto-address' :title='cryptoDonationAddress'>{{ cryptoDonationAddress }}</div>
                <a-button
                  type='primary'
                  size='mini'
                  long
                  tabindex='-1'
                  :title="t('footer.copyCryptoAddress')"
                  @click='handleCopyCryptoDonationAddress'
                >
                  <template #icon><IconFont name="iconcopy" /></template>
                  {{ t('footer.copyAddress') }}
                </a-button>
              </div>
            </template>
          </a-popover>
          <div class='footerBar fix' :title="t('footer.project')" style='margin: 0; cursor: pointer' @click='handleHelpPage'>
            <IconFont name="iconrss" />
            {{ t('footer.project') }}
          </div>
        </div>
      </div>
      <MyModal />
    </a-layout-footer>
  </a-layout>

    <DropOverlay v-if="appStore.appTab === 'music'" @files-dropped="handleMineradioFilesDropped" />
    <LimitReachedModal :visible="showLimitModal" @update:visible="showLimitModal = $event" />
  </template>

<style>
body {
  --app-type-caption: 12px;
  --app-type-control: 13px;
  --app-type-body: 14px;
  --app-type-nav: 14px;
  --app-type-section: 17px;
  --app-type-title: 22px;
}

#xbyhead {
  z-index: 2;
  height: 42px !important;
  padding: 3px 4px 2px 4px !important;
  color: rgba(232,236,239,.78);
  line-height: 37px !important;
  background:
    radial-gradient(circle at 26% 0%, rgba(0,245,212,.08), transparent 30%),
    linear-gradient(180deg, rgba(12,14,18,.92), rgba(8,9,11,.86));
  border-bottom: 1px solid rgba(255,255,255,.07);
  box-shadow: 0 14px 34px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.035);
  backdrop-filter: blur(22px) saturate(1.14);
}

.arco-avatar-circle .arco-avatar-image {
  line-height: 100% !important;
}

#xbyhead2 {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  height: 37px;
  padding: 0px 2px 0 4px;
  line-height: 37px;
}

#xbyhead2 button {
  min-width: 32px !important;
  height: 32px !important;
  min-height: 32px !important;
  margin-right: 1px;
  margin-left: 1px;
  padding: 0 !important;
  line-height: 32px !important;
  display: flex;
  justify-items: center;
  align-items: center;
  align-content: center;
  justify-content: center;
  flex-shrink: 0;
}

#xbyhead2 .arco-btn-text {
  color: rgba(255,255,255,.68);
}

#xbyhead2 .arco-btn-text:hover,
#xbyhead2 .arco-btn-text.active {
  color: #fff;
  background-color: rgba(255,255,255,.072);
  box-shadow: inset 0 0 0 1px rgba(0,245,212,.18);
}

#xbyhead2 .iconfont,
#xbyhead2 .iconfont-svg {
  font-size: 24px;
  width: 24px;
  height: 24px;
}

.sponsor-popover .arco-popover-popup-content {
  padding: 12px;
}

.sponsor-qrcode-panel {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 14px;
}

.sponsor-qrcode-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--color-text-2);
  font-size: 13px;
  line-height: 18px;
}

.sponsor-qrcode-item img {
  display: block;
  width: 220px;
  height: 220px;
  object-fit: contain;
  background: #fff;
  border: 1px solid var(--color-border-2);
  border-radius: 6px;
}

.sponsor-crypto-panel {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 100%;
  max-width: 454px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border-2);
}

.sponsor-crypto-title {
  color: var(--color-text-1);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}

.sponsor-crypto-address {
  width: 100%;
  padding: 6px 8px;
  color: var(--color-text-2);
  font-family: monospace;
  font-size: 12px;
  line-height: 18px;
  word-break: break-all;
  background: var(--color-fill-2);
  border: 1px solid var(--color-border-2);
  border-radius: 6px;
  user-select: text;
}

.sponsor-crypto-panel .iconfont {
  font-size: 14px !important;
}

.footer-sponsor-button {
  margin: 0;
  cursor: pointer;
  gap: 4px;
}

#xbyhead2 .arco-menu-horizontal {
  width: 0;
  min-width: 0;
  flex: 1 1 auto;
  max-width: none;
  height: 37px;
  line-height: 24px;
  overflow: visible;
  background: transparent !important;
}

#xbyhead2 .arco-menu,
#xbyhead2 .arco-menu-horizontal .arco-menu-inner {
  display: flex;
  flex-wrap: nowrap;
  padding: 0;
  overflow: visible;
  background: transparent !important;
}

/* 菜单项仍可点击，隐藏标签留下的菜单空白则可用于拖动窗口。 */
#xbyhead2 .arco-menu,
#xbyhead2 .arco-menu-horizontal .arco-menu-inner,
#xbyhead2 .arco-menu-overflow-wrap {
  -webkit-app-region: drag;
}

#xbyhead2 .arco-menu-horizontal .arco-menu-item,
#xbyhead2 .arco-menu-horizontal .arco-menu-item * {
  -webkit-app-region: no-drag;
}

#xbyhead2 .arco-menu-horizontal .arco-menu-pop,
#xbyhead2 .arco-menu-horizontal .arco-menu-pop-header {
  background: transparent !important;
}

#xbyhead2 .arco-menu-horizontal .arco-menu-item {
  line-height: 24px;
  padding: 0 8px;
  min-width: 0;
  text-align: center;
  flex: 0 0 auto;
  white-space: nowrap;
  color: rgba(255,255,255,.64);
  border-radius: 13px;
  background: transparent;
  transition: background .18s, color .18s, box-shadow .18s;
}

#xbyhead2 .arco-menu-horizontal .arco-menu-item:hover,
#xbyhead2 .arco-menu-horizontal .arco-menu-item.arco-menu-selected {
  color: #fff;
  background: rgba(255,255,255,.072);
  box-shadow: inset 0 0 0 1px rgba(0,245,212,.18), 0 10px 26px rgba(0,245,212,.06);
}

#xbyhead2 .arco-menu-horizontal .arco-menu-pop {
  height: 32px;
  line-height: 32px;
}

#xbyhead2 .arco-menu-horizontal .arco-menu-pop::after {
  display: none;
}

#xbyhead2 .arco-menu-horizontal .arco-menu-pop-header {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 8px;
  line-height: 32px;
}

#xbyhead2 .arco-menu-horizontal .arco-menu-item.arco-menu-selected {
  font-size: 15px;
}

#xbyhead2 .arco-menu-selected-label {
  bottom: -7px;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--app-mineradio-accent, #00f5d4), transparent);
}

#xbybody {
  --app-mineradio-bg: #08090b;
  --app-mineradio-paper: #0e1014;
  --app-mineradio-ink: #e8ecef;
  --app-mineradio-accent: #00f5d4;
  --app-mineradio-champagne: #f4d28a;
  --app-detail-bg:
    linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.018)),
    #080a0e;
  --app-glass-panel:
    radial-gradient(circle at 8% 0%, rgba(255,255,255,.075), transparent 34%),
    linear-gradient(135deg, rgba(255,255,255,.058), rgba(255,255,255,.026));
  --app-glass-line: rgba(255,255,255,.082);
  --app-glass-hover: rgba(255,255,255,.072);
  --app-sidebar-glass:
    radial-gradient(circle at 42% 0%, rgba(0,245,212,.12), transparent 34%),
    radial-gradient(circle at 0% 86%, rgba(244,210,138,.07), transparent 26%),
    linear-gradient(180deg, rgba(14,16,20,.80), rgba(8,9,11,.94));
  position: relative;
  padding: 0 3px 0 2px;
  height: calc(100% - 42px - 24px - 20px);
  overflow: hidden;
  color: var(--app-mineradio-ink);
  background:
    radial-gradient(circle at 72% 8%, rgba(0,245,212,.10), transparent 28%),
    radial-gradient(circle at 12% 72%, rgba(36,66,255,.12), transparent 34%),
    var(--app-mineradio-bg);
}

#xbybody::before,
#xbybody::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

#xbybody::before {
  inset: -18%;
  background:
    radial-gradient(circle at 18% 14%, rgba(244,210,138,.10), transparent 22%),
    radial-gradient(circle at 80% 22%, rgba(0,245,212,.13), transparent 24%),
    radial-gradient(circle at 58% 88%, rgba(157,184,207,.10), transparent 32%);
  opacity: .9;
}

#xbybody::after {
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.012) 1px, transparent 1px);
  background-size: 58px 58px;
  mask-image: radial-gradient(circle at 50% 20%, #000 0, transparent 64%);
  opacity: .55;
}

.hidetabs {
  position: relative;
  z-index: 1;
  height: 100%;
  background: transparent !important;
}

.hidetabs > .ant-tabs-nav {
  height: 0 !important;
  display: none !important;
}

.hidetabs .ant-tabs-content {
  height: 100%;
  background: transparent !important;
}

.hidetabs > .arco-tabs-content {
  padding-top: 0 !important;
  padding-bottom: 1px !important;
  height: 100%;
  background: transparent !important;
}

.hidetabs .arco-tabs-content-list,
.hidetabs .arco-tabs-pane {
  height: 100%;
  background: transparent !important;
}

.hidetabs > .arco-tabs-nav {
  width: 0 !important;
  height: 0 !important;
  display: none !important;
}

#xbybody .gs-page,
#xbybody .book-library,
#xbybody .media-library-view,
#xbybody .media-server-view,
#xbybody .media-server-sidebar,
#xbybody .media-server-content,
#xbybody .media-server-workspace,
#xbybody .settings-shell,
#xbybody .settings-sider,
#xbybody .settings-content,
#xbybody .ai-chat,
#xbybody .ai-bottom,
#xbybody .ai-footer,
#xbybody .arco-layout,
#xbybody .arco-layout-content {
  background: transparent !important;
  background-color: transparent !important;
}

#xbybody .xbyleft,
#xbybody .settings-sider,
#xbybody .book-sidebar,
#xbybody .media-server-sidebar,
#xbybody .rss-sider,
#xbybody .library-sidebar {
  position: relative;
  flex: 0 0 218px !important;
  width: 218px !important;
  min-width: 218px !important;
  max-width: 218px !important;
  height: calc(100% - 36px) !important;
  margin: 18px 0 18px 18px !important;
  padding: 14px 12px !important;
  color: #fff;
  background: var(--app-sidebar-glass) !important;
  border: 1px solid rgba(255,255,255,.085) !important;
  border-radius: 28px !important;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.075);
  backdrop-filter: blur(34px) saturate(1.24);
}

#xbybody .xbyleft::before,
#xbybody .settings-sider::before,
#xbybody .book-sidebar::before,
#xbybody .media-server-sidebar::before,
#xbybody .rss-sider::before,
#xbybody .library-sidebar::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(90deg, rgba(255,255,255,.030) 0 1px, transparent 1px 44px),
    linear-gradient(0deg, rgba(255,255,255,.020) 0 1px, transparent 1px 42px),
    linear-gradient(180deg, rgba(255,255,255,.07), transparent 18%),
    radial-gradient(circle at 50% 22%, rgba(255,255,255,.06), transparent 34%);
  opacity: .9;
  z-index: 0;
}

#xbybody .xbyleft > *,
#xbybody .settings-sider > *,
#xbybody .book-sidebar > *,
#xbybody .media-server-sidebar > *,
#xbybody .rss-sider > *,
#xbybody .library-sidebar > * {
  position: relative;
  z-index: 1;
}

#xbybody .library-sidebar > .media-library-nav {
  flex: 1 1 auto !important;
  width: 100% !important;
  min-width: 0 !important;
  max-width: none !important;
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  color: inherit;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

#xbybody .library-sidebar > .media-library-nav::before {
  display: none !important;
}

#xbybody .xbyright,
#xbybody .settings-content,
#xbybody .media-library-pane,
#xbybody .media-server-content,
#xbybody .media-server-workspace,
#xbybody .book-main,
#xbybody .book-content,
#xbybody .rightbg {
  min-width: 0;
}

#xbybody .xbyright {
  padding: 18px 18px 18px 14px !important;
  color: var(--app-mineradio-ink);
  background: transparent !important;
}

#xbybody .MySplit {
  background: transparent !important;
}

#xbybody .MySplit .arco-split-pane {
  background: transparent !important;
}

#xbybody .MySplit .arco-split-pane-second {
  padding: 18px 18px 18px 14px;
}

#xbybody .MySplit .arco-split-pane-first {
  background: transparent !important;
}

#xbybody .splitline {
  width: 14px;
  margin: 0;
  border: 0;
  background: transparent;
}

#xbybody .splitline:hover,
#xbybody .splitline.resize {
  background: transparent;
}

#xbybody .splitline .line {
  left: 6px;
  width: 2px;
  height: 72px;
  margin-top: -36px;
  border-radius: 999px;
  background: rgba(0,245,212,.34);
  box-shadow: 0 0 18px rgba(0,245,212,.18);
}

#xbybody .headdesc {
  display: flex !important;
  align-items: center;
  height: auto !important;
  min-height: 36px;
  margin: 0 0 12px !important;
  padding: 0 10px 8px !important;
  border: 0 !important;
  border-radius: 0 !important;
  color: rgba(255,255,255,.92);
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0;
  line-height: 1.2;
  background: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  overflow: hidden;
}

#xbybody .xbyleftmenu,
#xbybody .xbyleftmenu .arco-menu,
#xbybody .xbyleftmenu .arco-menu-inner,
#xbybody .rss-leftmenu,
#xbybody .rss-leftmenu .arco-menu,
#xbybody .rss-leftmenu .arco-menu-inner {
  background: transparent !important;
  color: rgba(255,255,255,.68);
}

#xbybody .xbyleftmenu .arco-menu-item,
#xbybody .rss-leftmenu .arco-menu-item,
#xbybody .book-nav-item,
#xbybody .media-server-title,
#xbybody .workspace-tab,
#xbybody .media-library-nav button {
  min-height: 46px;
  border: 1px solid transparent !important;
  border-radius: 999px;
  color: rgba(255,255,255,.62);
  background: rgba(255,255,255,0);
  font-size: 13px;
  font-weight: 760;
  transition: background .18s, color .18s, box-shadow .18s, transform .18s;
}

#xbybody .xbyleftmenu .arco-menu-item,
#xbybody .rss-leftmenu .arco-menu-item {
  height: 46px;
  margin: 0 0 8px;
  padding: 0 12px !important;
  line-height: 46px;
  box-shadow: none !important;
}

#xbybody .xbyleftmenu .arco-menu-item:hover,
#xbybody .xbyleftmenu .arco-menu-selected,
#xbybody .rss-leftmenu .arco-menu-item:hover,
#xbybody .rss-leftmenu .arco-menu-selected,
#xbybody .book-nav-item:hover,
#xbybody .book-nav-item.active,
#xbybody .media-server-title:hover,
#xbybody .workspace-tab:hover,
#xbybody .workspace-tab.active,
#xbybody .media-library-nav button:hover,
#xbybody .media-library-nav button.active {
  color: #fff !important;
  background: rgba(255,255,255,.072) !important;
}

#xbybody .xbyleftmenu .arco-menu-selected,
#xbybody .rss-leftmenu .arco-menu-selected,
#xbybody .book-nav-item.active,
#xbybody .workspace-tab.active,
#xbybody .media-library-nav button.active {
  border-color: rgba(0,245,212,.26) !important;
  background: rgba(0,245,212,.090) !important;
  box-shadow: inset 0 0 0 1px rgba(0,245,212,.12), 0 12px 30px rgba(0,245,212,.075) !important;
}

#xbybody .xbyleftmenu .arco-menu-item:hover,
#xbybody .rss-leftmenu .arco-menu-item:hover,
#xbybody .book-nav-item:hover,
#xbybody .media-server-title:hover,
#xbybody .workspace-tab:hover,
#xbybody .media-library-nav button:hover {
  transform: translateY(-1px);
}

#xbybody .xbyleftmenu .arco-menu-item::after,
#xbybody .rss-leftmenu .arco-menu-item::after {
  display: none !important;
}

#xbybody .single-boundary-sidebar > .single-boundary-sidebar-menu {
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

#xbybody .single-boundary-sidebar > .single-boundary-sidebar-menu .arco-menu-inner {
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

#xbybody .single-boundary-sidebar .single-boundary-sidebar-menu .arco-menu-item {
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

#xbybody .single-boundary-sidebar .single-boundary-sidebar-menu .arco-menu-item:hover {
  border: 0 !important;
  background: rgba(255,255,255,.055) !important;
  box-shadow: none !important;
}

#xbybody .single-boundary-sidebar .single-boundary-sidebar-menu .arco-menu-selected {
  border-color: transparent !important;
  background: rgba(0,245,212,.090) !important;
  box-shadow: none !important;
}

#xbybody .single-boundary-sidebar .single-boundary-sidebar-menu .arco-menu-item::before,
#xbybody .single-boundary-sidebar .single-boundary-sidebar-menu .arco-menu-item::after {
  display: none !important;
}

#xbybody .settings-side-title,
#xbybody .book-brand,
#xbybody .media-library-title,
#xbybody .library-scan-panel,
#xbybody .scan-progress-section {
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

#xbybody .settings-side-title,
#xbybody .book-brand,
#xbybody .media-library-title {
  border-radius: 0 !important;
}

#xbybody .scan-progress-section {
  border-radius: 16px !important;
  background: rgba(255,255,255,.042) !important;
}

#xbybody .arco-card,
#xbybody .arco-list,
#xbybody .arco-table,
#xbybody .arco-collapse,
#xbybody .arco-tabs-card,
#xbybody .arco-drawer,
#xbybody .settings-card,
#xbybody .settings-panel,
#xbybody .settingcard,
#xbybody .media-library-pane,
#xbybody .media-server-content,
#xbybody .media-server-workspace,
#xbybody .workspace-toolbar,
#xbybody .workspace-header-card,
#xbybody .summary-item,
#xbybody .placeholder-card,
#xbybody .server-switch-menu,
#xbybody .home-intro,
#xbybody .home-error,
#xbybody .home-loading,
#xbybody .empty-placeholder,
#xbybody .library-card,
#xbybody .detail-section,
#xbybody .person-shelf-card,
#xbybody .person-rail-card,
#xbybody .search-feedback-card,
#xbybody .listing-toggle-group,
#xbybody .book-main,
#xbybody .book-header,
#xbybody .book-content,
#xbybody .book-list-item,
#xbybody .book-group,
#xbybody .book-cover-item,
#xbybody .book-annotation-toolbar,
#xbybody .book-annotation-item,
#xbybody .book-tag-editor,
#xbybody .book-trash-toolbar,
#xbybody .workspace-tabs,
#xbybody .ai-input-bar,
#xbybody .ai-msg-body,
#xbybody .gs-panel {
  color: var(--app-mineradio-ink);
  border-color: var(--app-glass-line) !important;
  background: var(--app-glass-panel) !important;
  box-shadow: 0 18px 55px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.052);
  backdrop-filter: blur(20px) saturate(1.12);
}

#xbybody .arco-card,
#xbybody .settings-card,
#xbybody .settings-panel,
#xbybody .settingcard,
#xbybody .workspace-toolbar,
#xbybody .workspace-header-card,
#xbybody .summary-item,
#xbybody .placeholder-card,
#xbybody .library-card,
#xbybody .detail-section,
#xbybody .person-shelf-card,
#xbybody .person-rail-card,
#xbybody .book-list-item,
#xbybody .book-group,
#xbybody .book-cover-item,
#xbybody .book-annotation-item,
#xbybody .gs-panel {
  border-radius: 18px !important;
}

#xbybody .xbyright > .hidetabs,
#xbybody .rightbg,
#xbybody .settings-content,
#xbybody .media-library-pane,
#xbybody .media-server-content,
#xbybody .media-server-workspace,
#xbybody .book-main,
#xbybody .book-content {
  border: 1px solid rgba(255,255,255,.075) !important;
  border-radius: 24px !important;
  background:
    linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.018)),
    rgba(8,10,14,.24) !important;
  box-shadow: 0 20px 60px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.075);
  backdrop-filter: blur(24px) saturate(1.14);
}

#xbybody .xbyright > .hidetabs {
  height: 100%;
  overflow: hidden;
}

#xbybody .rightbg,
#xbybody .settings-content,
#xbybody .media-server-content,
#xbybody .media-server-workspace,
#xbybody .book-content {
  height: 100%;
  overflow: hidden;
}

#xbybody .media-library-pane,
#xbybody .book-main {
  box-sizing: border-box;
  height: calc(100% - 36px);
}

#xbybody .settings-content {
  box-sizing: border-box;
  height: calc(100% - 36px);
  margin: 18px 18px 18px 14px !important;
}

#xbybody .book-main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

#xbybody .book-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

#xbybody .book-header {
  background: linear-gradient(180deg, rgba(255,255,255,.04), transparent) !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

#xbybody #SettingObserver.settings-content {
  overflow-x: hidden !important;
  overflow-y: auto !important;
}

body[arco-theme='dark'] #xbybody .settings-sider,
body[arco-theme='dark'] #xbybody .settings-content,
body[arco-theme='dark'] #xbybody .settingcard,
body[arco-theme='dark'] #xbybody .xbyleftmenu {
  backdrop-filter: none !important;
}

body[arco-theme='dark'] #xbybody .settings-sider,
body[arco-theme='dark'] #xbybody .settings-content {
  transform: translateZ(0);
  will-change: auto;
}

body[arco-theme='dark'] #xbybody .settings-sider .xbyleftmenu .arco-menu-item,
body[arco-theme='dark'] #xbybody .settings-sider .xbyleftmenu .arco-menu-item:hover {
  transform: none !important;
}

#xbybody .book-library,
#xbybody .workspace-page,
#xbybody .home-page,
#xbybody .search-shell,
#xbybody .detail-page,
#xbybody .person-content {
  color: var(--app-mineradio-ink) !important;
  background: transparent !important;
  background-color: transparent !important;
}

#xbybody .workspace-header h2,
#xbybody .server-empty-shell h2,
#xbybody .workspace-header-card h2,
#xbybody .home-intro h2,
#xbybody .detail-section-title,
#xbybody .library-list-title,
#xbybody .person-shelf-title,
#xbybody .person-rail-title,
#xbybody .book-header-title,
#xbybody .book-list-title,
#xbybody .book-cover-item-title,
#xbybody .book-group-title,
#xbybody .settinghead,
#xbybody .media-library-title h2 {
  color: rgba(255,255,255,.92) !important;
}

#xbybody .workspace-header p,
#xbybody .server-empty-shell p,
#xbybody .workspace-header-card p,
#xbybody .library-meta-line,
#xbybody .library-list-overview,
#xbybody .person-rail-subtitle,
#xbybody .person-rail-overview,
#xbybody .book-list-sub,
#xbybody .book-cover-item-author,
#xbybody .book-cover-item-publisher,
#xbybody .book-cover-item-desc,
#xbybody .settingrow,
#xbybody .helptxt,
#xbybody .media-library-title p {
  color: rgba(232,236,239,.66) !important;
}

#xbybody .workspace-eyebrow,
#xbybody .scan-header,
#xbybody .book-source-pill,
#xbybody .book-progress-chip,
#xbybody .library-list-meta-chip,
#xbybody .listing-overlay-badge {
  color: var(--app-mineradio-accent) !important;
  background: rgba(0,245,212,.10) !important;
  border-color: rgba(0,245,212,.18) !important;
}

#xbybody .workspace-tab,
#xbybody .book-sort-item,
#xbybody .book-annotation-tag,
#xbybody .listing-toggle-group button,
#xbybody .home-poster-toggle button {
  color: rgba(255,255,255,.68) !important;
  background: transparent !important;
}

#xbybody .workspace-tab.active,
#xbybody .book-sort-item.active,
#xbybody .book-annotation-tag.active,
#xbybody .listing-toggle-group button.active,
#xbybody .home-poster-toggle button.active {
  color: #fff !important;
  background: rgba(255,255,255,.085) !important;
  box-shadow: inset 0 0 0 1px rgba(0,245,212,.22), 0 10px 28px rgba(0,245,212,.055);
}

#xbybody .arco-table-th,
#xbybody .arco-table-td,
#xbybody .arco-list-item,
#xbybody .arco-collapse-item,
#xbybody .arco-card-header,
#xbybody .arco-card-body {
  color: rgba(232,236,239,.88);
  border-color: rgba(255,255,255,.055) !important;
  background: transparent !important;
}

#xbybody .arco-table-tr:hover .arco-table-td,
#xbybody .arco-list-item:hover,
#xbybody .arco-collapse-item:hover {
  background: var(--app-glass-hover) !important;
}

#xbybody .arco-input-wrapper,
#xbybody .arco-select-view,
#xbybody .arco-textarea-wrapper,
#xbybody .arco-input-tag,
#xbybody .arco-input-number,
#xbybody .arco-picker {
  color: rgba(255,255,255,.88);
  border-color: rgba(255,255,255,.088) !important;
  background: rgba(255,255,255,.052) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.045);
}

#xbybody .arco-input-wrapper:hover,
#xbybody .arco-select-view:hover,
#xbybody .arco-textarea-wrapper:hover,
#xbybody .arco-input-tag:hover,
#xbybody .arco-input-number:hover,
#xbybody .arco-picker:hover {
  border-color: rgba(0,245,212,.22) !important;
  background: rgba(255,255,255,.075) !important;
}

#xbybody .arco-btn:not(.arco-btn-primary):not(.arco-btn-text) {
  color: rgba(255,255,255,.82);
  border-color: rgba(255,255,255,.10);
  background: rgba(255,255,255,.052);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.045);
}

#xbybody .arco-btn:not(.arco-btn-primary):not(.arco-btn-text):hover {
  color: #fff;
  border-color: rgba(0,245,212,.22);
  background: var(--app-glass-hover);
}

#xbybody .arco-btn-primary {
  border-color: rgba(0,245,212,.28);
  color: #03110f;
  background: linear-gradient(135deg, rgba(0,245,212,.95), rgba(244,210,138,.82));
  box-shadow: 0 12px 34px rgba(0,245,212,.13), inset 0 1px 0 rgba(255,255,255,.35);
}

#xbybody .arco-tag,
#xbybody .arco-badge-status-text,
#xbybody .arco-radio-button,
#xbybody .arco-checkbox-label {
  color: rgba(255,255,255,.72);
}

#xbybody {
  font-size: var(--app-type-body);
}

#xbybody .treeleft .arco-tree-node-title,
#xbybody .treeleft .arco-tree-node-title-text,
#xbybody .xbyleftmenu .arco-menu-item,
#xbybody .xbyleftmenu .arco-menu-title,
#xbybody .rss-leftmenu .arco-menu-item,
#xbybody .rss-leftmenu .arco-menu-title,
#xbybody .book-sidebar .book-nav-item,
#xbybody .book-sidebar .book-nav-item > span,
#xbybody .media-library-nav .nav-item,
#xbybody .media-library-nav .nav-item > span:first-of-type,
#xbybody .media-server-nav .nav-item,
#xbybody .media-server-nav .nav-item .server-name,
#xbybody .media-server-nav .nav-item > span:first-of-type,
#xbybody .workspace-tab {
  font-size: var(--app-type-nav) !important;
}

#xbybody .ai-task-rail .ai-new-task,
#xbybody .ai-task-rail .ai-rail-action,
#xbybody .ai-task-rail .ai-history-item {
  font-size: var(--app-type-nav) !important;
}

#xbybody .media-library-nav .nav-header,
#xbybody .media-library-nav .nav-item .count,
#xbybody .media-library-nav .folder-source,
#xbybody .media-server-nav .nav-header,
#xbybody .media-server-nav .server-meta,
#xbybody .book-sidebar .book-brand-sub,
#xbybody .settings-sider .settings-side-kicker,
#xbybody .settings-sider .settings-side-title small,
#xbybody .ai-task-rail .ai-rail-label,
#xbybody .ai-task-rail .ai-rail-foot,
#xbybody .ai-task-rail .ai-memory-item {
  font-size: var(--app-type-caption) !important;
}

#xbybody .arco-input,
#xbybody .arco-textarea,
#xbybody .arco-select-view-value,
#xbybody .arco-select-view-placeholder,
#xbybody .arco-input-number-input,
#xbybody .arco-picker input,
#xbybody .arco-btn,
#xbybody .arco-radio-label,
#xbybody .arco-checkbox-label,
#xbybody .arco-tabs-tab-title,
#xbybody .arco-dropdown-option {
  font-size: var(--app-type-control) !important;
}

#xbybody .arco-table-th,
#xbybody .arco-table-td,
#xbybody .arco-list-item,
#xbybody .arco-collapse-item,
#xbybody .arco-card-header,
#xbybody .arco-card-body {
  font-size: var(--app-type-body);
}

#xbybody .arco-tag,
#xbybody .arco-badge-status-text,
#xbybody .arco-form-item-message,
#xbybody .arco-form-item-extra {
  font-size: var(--app-type-caption) !important;
}

body > .arco-modal-container,
body > .arco-drawer-container,
body > .arco-trigger-popup {
  font-size: var(--app-type-body);
}

body > .arco-modal-container :where(.arco-btn, .arco-input, .arco-textarea, .arco-select-view-value, .arco-select-view-placeholder, .arco-radio-label, .arco-checkbox-label, .arco-tabs-tab-title),
body > .arco-drawer-container :where(.arco-btn, .arco-input, .arco-textarea, .arco-select-view-value, .arco-select-view-placeholder, .arco-radio-label, .arco-checkbox-label, .arco-tabs-tab-title),
body > .arco-trigger-popup :where(.arco-dropdown-option, .arco-select-option, .arco-cascader-option) {
  font-size: var(--app-type-control) !important;
}

#xbybody .arco-scrollbar-thumb {
  background: rgba(255,255,255,.18) !important;
}

@media (prefers-reduced-motion: reduce) {
  #xbybody *,
  #xbybody *::before,
  #xbybody *::after {
    transition-duration: .01ms !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
  }
}

@media (prefers-reduced-transparency: reduce) {
  #xbybody .xbyleft,
  #xbybody .settings-sider,
  #xbybody .book-sidebar,
  #xbybody .media-server-sidebar,
  #xbybody .rss-sider,
  #xbybody .library-sidebar,
  #xbybody .arco-card,
  #xbybody .arco-list,
  #xbybody .arco-table,
  #xbybody .settings-card,
  #xbybody .settings-panel,
  #xbybody .settingcard,
  #xbybody .media-library-pane,
  #xbybody .media-server-content,
  #xbybody .media-server-workspace,
  #xbybody .workspace-toolbar,
  #xbybody .workspace-header-card,
  #xbybody .summary-item,
  #xbybody .placeholder-card,
  #xbybody .library-card,
  #xbybody .book-main,
  #xbybody .book-header,
  #xbybody .book-content,
  #xbybody .book-list-item,
  #xbybody .book-group,
  #xbybody .book-cover-item,
  #xbybody .ai-input-bar,
  #xbybody .ai-msg-body,
  #xbybody .gs-panel {
    background: #101216 !important;
    backdrop-filter: none !important;
  }
}

body:not([arco-theme='dark']) #xbyhead {
  color: var(--color-text-2);
  background: var(--color-bg-1);
  border-bottom: 1px solid var(--color-border);
  box-shadow: 0 1px 0 var(--color-border);
  backdrop-filter: none;
}

body:not([arco-theme='dark']) #xbyhead2 .arco-btn-text,
body:not([arco-theme='dark']) #xbyhead2 .arco-menu-horizontal .arco-menu-item,
body:not([arco-theme='dark']) #xbyhead2 .arco-menu,
body:not([arco-theme='dark']) #xbyhead2 .arco-menu-horizontal,
body:not([arco-theme='dark']) #xbyhead2 .arco-menu-horizontal .arco-menu-inner,
body:not([arco-theme='dark']) #xbyhead2 .arco-menu-horizontal .arco-menu-pop,
body:not([arco-theme='dark']) #xbyhead2 .arco-menu-horizontal .arco-menu-pop-header {
  color: var(--color-text-2);
  background: transparent;
  box-shadow: none;
}

body:not([arco-theme='dark']) #xbyhead2 .arco-btn-text:hover,
body:not([arco-theme='dark']) #xbyhead2 .arco-btn-text.active,
body:not([arco-theme='dark']) #xbyhead2 .arco-menu-horizontal .arco-menu-item:hover,
body:not([arco-theme='dark']) #xbyhead2 .arco-menu-horizontal .arco-menu-item.arco-menu-selected {
  color: rgb(var(--primary-6));
  background-color: var(--color-fill-2);
  box-shadow: none;
}

body:not([arco-theme='dark']) #xbybody {
  --app-mineradio-bg: var(--color-bg-1);
  --app-mineradio-paper: var(--color-bg-2);
  --app-mineradio-ink: var(--color-text-1);
  --app-glass-panel: var(--color-bg-1);
  --app-glass-line: var(--color-border-2);
  --app-glass-hover: var(--color-fill-2);
  --app-sidebar-glass: var(--color-bg-1);
  --app-detail-bg: var(--color-bg-1);
  color: var(--color-text-1);
  background: var(--color-bg-1);
}

body:not([arco-theme='dark']) #xbybody .cellcount .arco-badge-status-text {
  color: var(--color-text-2);
}

body:not([arco-theme='dark']) #xbybody::before,
body:not([arco-theme='dark']) #xbybody::after {
  display: none;
}

body:not([arco-theme='dark']) #xbybody .xbyright > .hidetabs {
  border-color: var(--color-border-2) !important;
  background: var(--color-bg-1) !important;
  box-shadow: none;
  backdrop-filter: none;
}

body:not([arco-theme='dark']) #xbybody .settings-content {
  border-color: var(--color-border-2) !important;
  background: var(--color-bg-1) !important;
  box-shadow: none;
  backdrop-filter: none;
}

body:not([arco-theme='dark']) #xbybody .xbyleft,
body:not([arco-theme='dark']) #xbybody .settings-sider,
body:not([arco-theme='dark']) #xbybody .book-sidebar,
body:not([arco-theme='dark']) #xbybody .media-server-sidebar,
body:not([arco-theme='dark']) #xbybody .rss-sider,
body:not([arco-theme='dark']) #xbybody .library-sidebar {
  color: var(--color-text-1);
  background: var(--color-bg-1) !important;
  border-right: 1px solid var(--color-neutral-3) !important;
  box-shadow: none;
  backdrop-filter: none;
}

body:not([arco-theme='dark']) #xbybody .single-boundary-sidebar {
  border: 1px solid var(--color-neutral-3) !important;
}

body:not([arco-theme='dark']) #xbybody .xbyleft::before,
body:not([arco-theme='dark']) #xbybody .settings-sider::before,
body:not([arco-theme='dark']) #xbybody .book-sidebar::before,
body:not([arco-theme='dark']) #xbybody .media-server-sidebar::before,
body:not([arco-theme='dark']) #xbybody .rss-sider::before,
body:not([arco-theme='dark']) #xbybody .library-sidebar::before {
  display: none;
}

body:not([arco-theme='dark']) #xbybody .library-sidebar > .media-library-nav {
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

body:not([arco-theme='dark']) #xbybody .headdesc,
body:not([arco-theme='dark']) #xbybody .settings-side-title,
body:not([arco-theme='dark']) #xbybody .book-brand,
body:not([arco-theme='dark']) #xbybody .media-library-title {
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

body:not([arco-theme='dark']) #xbybody .xbyleftmenu,
body:not([arco-theme='dark']) #xbybody .xbyleftmenu .arco-menu,
body:not([arco-theme='dark']) #xbybody .xbyleftmenu .arco-menu-inner,
body:not([arco-theme='dark']) #xbybody .rss-leftmenu,
body:not([arco-theme='dark']) #xbybody .rss-leftmenu .arco-menu,
body:not([arco-theme='dark']) #xbybody .rss-leftmenu .arco-menu-inner {
  color: var(--color-text-2);
  background: transparent !important;
}

body:not([arco-theme='dark']) #xbybody .xbyleftmenu .arco-menu-item,
body:not([arco-theme='dark']) #xbybody .rss-leftmenu .arco-menu-item,
body:not([arco-theme='dark']) #xbybody .book-nav-item,
body:not([arco-theme='dark']) #xbybody .media-server-title,
body:not([arco-theme='dark']) #xbybody .workspace-tab,
body:not([arco-theme='dark']) #xbybody .media-library-nav button {
  color: var(--color-text-2) !important;
  background: transparent !important;
  box-shadow: none !important;
}

body:not([arco-theme='dark']) #xbybody .xbyleftmenu .arco-menu-item:hover,
body:not([arco-theme='dark']) #xbybody .xbyleftmenu .arco-menu-selected,
body:not([arco-theme='dark']) #xbybody .rss-leftmenu .arco-menu-item:hover,
body:not([arco-theme='dark']) #xbybody .rss-leftmenu .arco-menu-selected,
body:not([arco-theme='dark']) #xbybody .book-nav-item:hover,
body:not([arco-theme='dark']) #xbybody .book-nav-item.active,
body:not([arco-theme='dark']) #xbybody .media-server-title:hover,
body:not([arco-theme='dark']) #xbybody .workspace-tab:hover,
body:not([arco-theme='dark']) #xbybody .workspace-tab.active,
body:not([arco-theme='dark']) #xbybody .media-library-nav button:hover,
body:not([arco-theme='dark']) #xbybody .media-library-nav button.active {
  color: var(--color-text-1) !important;
  background: var(--color-fill-2) !important;
}

body:not([arco-theme='dark']) #xbybody .arco-card,
body:not([arco-theme='dark']) #xbybody .arco-list,
body:not([arco-theme='dark']) #xbybody .arco-table,
body:not([arco-theme='dark']) #xbybody .arco-collapse,
body:not([arco-theme='dark']) #xbybody .arco-tabs-card,
body:not([arco-theme='dark']) #xbybody .arco-drawer,
body:not([arco-theme='dark']) #xbybody .settings-card,
body:not([arco-theme='dark']) #xbybody .settings-panel,
body:not([arco-theme='dark']) #xbybody .settingcard,
body:not([arco-theme='dark']) #xbybody .media-library-pane,
body:not([arco-theme='dark']) #xbybody .media-server-content,
body:not([arco-theme='dark']) #xbybody .media-server-workspace,
body:not([arco-theme='dark']) #xbybody .workspace-toolbar,
body:not([arco-theme='dark']) #xbybody .workspace-header-card,
body:not([arco-theme='dark']) #xbybody .summary-item,
body:not([arco-theme='dark']) #xbybody .placeholder-card,
body:not([arco-theme='dark']) #xbybody .server-switch-menu,
body:not([arco-theme='dark']) #xbybody .home-intro,
body:not([arco-theme='dark']) #xbybody .home-error,
body:not([arco-theme='dark']) #xbybody .home-loading,
body:not([arco-theme='dark']) #xbybody .empty-placeholder,
body:not([arco-theme='dark']) #xbybody .library-card,
body:not([arco-theme='dark']) #xbybody .detail-section,
body:not([arco-theme='dark']) #xbybody .person-shelf-card,
body:not([arco-theme='dark']) #xbybody .person-rail-card,
body:not([arco-theme='dark']) #xbybody .search-feedback-card,
body:not([arco-theme='dark']) #xbybody .listing-toggle-group,
body:not([arco-theme='dark']) #xbybody .book-main,
body:not([arco-theme='dark']) #xbybody .book-header,
body:not([arco-theme='dark']) #xbybody .book-content,
body:not([arco-theme='dark']) #xbybody .book-list-item,
body:not([arco-theme='dark']) #xbybody .book-group,
body:not([arco-theme='dark']) #xbybody .book-cover-item,
body:not([arco-theme='dark']) #xbybody .book-annotation-toolbar,
body:not([arco-theme='dark']) #xbybody .book-annotation-item,
body:not([arco-theme='dark']) #xbybody .book-tag-editor,
body:not([arco-theme='dark']) #xbybody .book-trash-toolbar,
body:not([arco-theme='dark']) #xbybody .workspace-tabs,
body:not([arco-theme='dark']) #xbybody .ai-input-bar,
body:not([arco-theme='dark']) #xbybody .ai-msg-body,
body:not([arco-theme='dark']) #xbybody .gs-panel {
  color: var(--color-text-1) !important;
  border-color: var(--color-border-2) !important;
  background: var(--color-bg-1) !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

body:not([arco-theme='dark']) #xbybody .workspace-header h2,
body:not([arco-theme='dark']) #xbybody .server-empty-shell h2,
body:not([arco-theme='dark']) #xbybody .workspace-header-card h2,
body:not([arco-theme='dark']) #xbybody .home-intro h2,
body:not([arco-theme='dark']) #xbybody .detail-section-title,
body:not([arco-theme='dark']) #xbybody .library-list-title,
body:not([arco-theme='dark']) #xbybody .person-shelf-title,
body:not([arco-theme='dark']) #xbybody .person-rail-title,
body:not([arco-theme='dark']) #xbybody .book-header-title,
body:not([arco-theme='dark']) #xbybody .book-list-title,
body:not([arco-theme='dark']) #xbybody .book-cover-item-title,
body:not([arco-theme='dark']) #xbybody .book-group-title,
body:not([arco-theme='dark']) #xbybody .settinghead,
body:not([arco-theme='dark']) #xbybody .media-library-title h2 {
  color: var(--color-text-1) !important;
}

body:not([arco-theme='dark']) #xbybody .workspace-header p,
body:not([arco-theme='dark']) #xbybody .server-empty-shell p,
body:not([arco-theme='dark']) #xbybody .workspace-header-card p,
body:not([arco-theme='dark']) #xbybody .library-meta-line,
body:not([arco-theme='dark']) #xbybody .library-list-overview,
body:not([arco-theme='dark']) #xbybody .person-rail-subtitle,
body:not([arco-theme='dark']) #xbybody .person-rail-overview,
body:not([arco-theme='dark']) #xbybody .book-list-sub,
body:not([arco-theme='dark']) #xbybody .book-cover-item-author,
body:not([arco-theme='dark']) #xbybody .book-cover-item-publisher,
body:not([arco-theme='dark']) #xbybody .book-cover-item-desc,
body:not([arco-theme='dark']) #xbybody .settingrow,
body:not([arco-theme='dark']) #xbybody .helptxt,
body:not([arco-theme='dark']) #xbybody .media-library-title p {
  color: var(--color-text-2) !important;
}

body:not([arco-theme='dark']) #xbybody .arco-table-th,
body:not([arco-theme='dark']) #xbybody .arco-table-td,
body:not([arco-theme='dark']) #xbybody .arco-list-item,
body:not([arco-theme='dark']) #xbybody .arco-collapse-item,
body:not([arco-theme='dark']) #xbybody .arco-card-header,
body:not([arco-theme='dark']) #xbybody .arco-card-body {
  color: var(--color-text-1) !important;
  border-color: var(--color-border-2) !important;
  background: transparent !important;
}

body:not([arco-theme='dark']) #xbybody .arco-input-wrapper,
body:not([arco-theme='dark']) #xbybody .arco-select-view,
body:not([arco-theme='dark']) #xbybody .arco-textarea-wrapper,
body:not([arco-theme='dark']) #xbybody .arco-input-tag,
body:not([arco-theme='dark']) #xbybody .arco-input-number,
body:not([arco-theme='dark']) #xbybody .arco-picker {
  color: var(--color-text-1) !important;
  border-color: var(--color-border-2) !important;
  background: var(--color-bg-1) !important;
  box-shadow: none !important;
}

body:not([arco-theme='dark']) #xbybody .arco-btn:not(.arco-btn-primary):not(.arco-btn-text) {
  color: var(--color-text-1);
  border-color: var(--color-border-2);
  background: var(--color-bg-1);
  box-shadow: none;
}

body:not([arco-theme='dark']) #xbyfoot {
  color: var(--foot-txt);
  background: var(--foot-bg);
  border-top: none;
  box-shadow: none;
  backdrop-filter: none;
}

body:not([arco-theme='dark']) .footerBar:hover {
  color: #fff;
  background-color: #569dff;
  box-shadow: none;
}

#xbyfoot {
  display: flex;
  flex-direction: row;
  height: 24px;
  padding: 0 0 0 16px;
  color: rgba(232,236,239,.68);
  font-size: 12px;
  line-height: 23px;
  background:
    linear-gradient(180deg, rgba(12,14,18,.88), rgba(8,9,11,.94));
  border-top: 1px solid rgba(255,255,255,.07);
  box-shadow: 0 -12px 30px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.035);
  backdrop-filter: blur(20px) saturate(1.12);
}

a {
  /*color: #F596AA;*/
  color: rosybrown;
}

#footer2 {
  display: flex;
  flex: 100% 1 1;
  flex-direction: row;
  height: 24px;
  padding: 0;
  color: hsla(0, 0%, 100%, 0.85);
  font-size: 12px;
  line-height: 24px;
  justify-content: stretch;
  align-items: center;
}

.footerBar {
  flex: auto 1;
  flex-shrink: 0;
  padding: 0 8px;
  cursor: default;
  height: 100%;
  line-height: 24px;
  transition: background-color 0.2s, color 0.2s, box-shadow 0.2s;
  display: flex;
  flex-direction: row;
  justify-content: stretch;
  align-items: center;
}

.footerBar.fix {
  flex-grow: 0;
}

.footerBar:hover {
  color: #fff;
  background-color: rgba(255,255,255,.07);
  box-shadow: inset 0 0 0 1px rgba(0,245,212,.16);
}

.footerBar .iconfont {
  font-size: 14px;
  line-height: 24px;
}

.update-progress-foot {
  gap: 5px;
}

.update-progress-ring {
  width: 16px;
  height: 16px;
  transform: rotate(-90deg);
}

.update-progress-track {
  stroke: rgba(255, 255, 255, 0.2);
}

.update-progress-value {
  stroke: #00d9bd;
  stroke-linecap: round;
  stroke-dasharray: 50.27;
  transition: stroke-dashoffset 0.2s ease;
}

.update-progress-label {
  min-width: 28px;
  color: rgba(255, 255, 255, 0.88);
  font-variant-numeric: tabular-nums;
}

#footLoading .arco-icon-loading {
  color: hsla(0, 0%, 100%, 0.85);
  width: 14px;
  height: 14px;
}

.footloadingicon {
  width: 14px;
  height: 14px;
  display: inline-block;
}

.syncmessage {
  width: 380px;
}

#footLoading .arco-spin .arco-spin-icon {
  padding-bottom: 4px;
  margin-right: 2px;
}

.footinfo {
  padding: 0 8px;
  opacity: 0.9;
}

.footer-music-player {
  display: flex;
  align-items: center;
  flex: 0 1 420px;
  min-width: 260px;
  max-width: 420px;
  height: 24px;
  padding: 0 6px;
  gap: 5px;
  border-left: 1px solid rgba(255, 255, 255, 0.12);
  border-right: 1px solid rgba(255, 255, 255, 0.12);
}

.footer-music-cover {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  overflow: hidden;
  color: hsla(0, 0%, 100%, 0.8);
  background: rgba(255, 255, 255, 0.12);
  border-radius: 3px;
  cursor: pointer;
}

.footer-music-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.footer-music-meta {
  flex: 1 1 auto;
  min-width: 0;
  cursor: pointer;
}

.footer-music-title {
  max-width: 100%;
  height: 14px;
  overflow: hidden;
  color: hsla(0, 0%, 100%, 0.92);
  font-size: 12px;
  line-height: 14px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.footer-music-bar {
  position: relative;
  height: 2px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 999px;
}

.footer-music-bar-fill {
  height: 100%;
  background: #ffffff;
  border-radius: inherit;
  transition: width 0.2s ease;
}

.footer-music-time {
  flex: 0 0 auto;
  min-width: 32px;
  color: hsla(0, 0%, 100%, 0.72);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.footer-music-btn {
  width: 18px;
  height: 18px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: hsla(0, 0%, 100%, 0.82);
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.footer-music-btn:hover,
.footer-music-toggle:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.16);
}

.footer-music-btn.primary {
  color: var(--foot-bg);
  background: rgba(255, 255, 255, 0.9);
}

.footer-music-toggle {
  height: 18px;
  padding: 0 6px;
  flex: 0 0 auto;
  color: hsla(0, 0%, 100%, 0.8);
  font-size: 11px;
  line-height: 18px;
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

body[arco-theme='dark'] .footinfo {
  opacity: 0.8;
}

body[arco-theme='dark'] #xbyhead {
  color: rgba(255, 255, 255, 0.85);
}
body[arco-theme='dark'] #xbyhead2 .arco-menu-horizontal .arco-menu-item {
  color: rgba(255, 255, 255, 0.65);
}
body[arco-theme='dark'] #xbyhead2 .arco-menu-horizontal .arco-menu-item:hover {
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.08);
}
body[arco-theme='dark'] #xbyhead2 .arco-menu-horizontal .arco-menu-item.arco-menu-selected {
  color: rgb(var(--primary-6));
}
body[arco-theme='dark'] #xbyhead2 .arco-menu-selected-label {
  background: rgb(var(--primary-6));
}
.footuploadlist .arco-popover-popup-content,
.footdownlist .arco-popover-popup-content,
.asynclist .arco-popover-popup-content {
  padding: 0 8px 12px 8px;
  margin-right: 8px;
}

.asynclistitem {
  position: relative;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  margin-top: 12px;
}

.asynclistitem-content {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px 8px 12px;
  overflow: hidden;
  font-size: 14px;
  background-color: var(--color-fill-1);
  border-radius: var(--border-radius-small);
  transition: background-color 0.1s cubic-bezier(0, 0, 1, 1);
}

.asynclistitem-operation {
  margin-left: 12px;
  color: var(--color-text-2);
  font-size: 12px;
}

.asynclistitem-operation .arco-btn {
  padding: 0 6px;
}

.asynclistitem-name {
  display: flex;
  flex: 1;
  align-items: center;
  margin-right: 10px;
  overflow: hidden;
  color: rgb(var(--link-6));
  font-size: 14px;
  line-height: 1.4286;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.asynclistitem-progress {
  position: relative;
  margin-left: auto;
  line-height: 12px;
  min-width: 52px;
  display: inline-block;
}

.asynclistitem-icon-running {
  color: var(--color-text-2);
  font-size: 14px;
  line-height: 14px;
}

.asynclistitem-icon-success {
  color: rgb(var(--success-6));
  font-size: 14px;
  line-height: 14px;
}

.asynclistitem-icon-error {
  color: rgb(var(--danger-6));
  font-size: 14px;
  line-height: 14px;
}

#footer2 audio {
  border-radius: 0;
  border: none;
  outline: none;
}

#footer2 audio::-webkit-media-controls-panel {
  border-radius: 0;
  border: none;
  color: #ffffff !important;
  filter: invert(80);
}

#footer2 audio::-webkit-media-controls-enclosure {
  background: var(--foot-bg);
  border-radius: 4px;
}

#footer2 audio::-webkit-media-controls-current-time-display,
#footer2 audio::-webkit-media-controls-time-remaining-display {
  text-shadow: unset;
  font-size: 12px;
  font-weight: bold;
  color: #000000 !important;
}

body[arco-theme='dark'] #footer2 audio::-webkit-media-controls-panel {
  filter: invert(0);
}

body[arco-theme='dark'] #footer2 audio::-webkit-media-controls-current-time-display,
body[arco-theme='dark'] #footer2 audio::-webkit-media-controls-time-remaining-display {
  color: #ffffff !important;
}

.arco-upload-list-item-file-icon {
  margin-right: 4px !important;
}

.footspeedstr {
  min-width: 52px;
  max-width: 140px;
  overflow: hidden;
  display: inline-block;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footerBar.fix > span:last-child {
  min-width: 0;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.music-scan-foot {
  opacity: 0.85;
}

.music-scan-foot:hover {
  background-color: #569dff;
  opacity: 1;
}

.music-scan-foot .music-scan-spin {
  flex-shrink: 0;
  animation: music-scan-rotate 2.4s linear infinite;
}

.music-scan-foot .music-scan-text {
  max-width: 240px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

@keyframes music-scan-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>

<style>
.shake {
  animation-name: upAnimation;
  transform-origin: center top;
  animation-duration: 2s;
  animation-fill-mode: both;
  animation-iteration-count: infinite;
  animation-delay: 0.5s;
}

@keyframes upAnimation {
  0% {
    transform: rotate(0deg);
    transition-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1);
  }
  10% {
    transform: rotate(-12deg);
    transition-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1);
  }
  20% {
    transform: rotate(12deg);
    transition-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1);
  }
  28% {
    transform: rotate(-10deg);
    transition-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1);
  }
  36% {
    transform: rotate(10deg);
    transition-timing-function: cubic-bezier(0.755, 0.5, 0.855, 0.06);
  }
  42% {
    transform: rotate(-8deg);
    transition-timing-function: cubic-bezier(0.755, 0.5, 0.855, 0.06);
  }
  48% {
    transform: rotate(8deg);
    transition-timing-function: cubic-bezier(0.755, 0.5, 0.855, 0.06);
  }
  52% {
    transform: rotate(-4deg);
    transition-timing-function: cubic-bezier(0.755, 0.5, 0.855, 0.06);
  }
  56% {
    transform: rotate(4deg);
    transition-timing-function: cubic-bezier(0.755, 0.5, 0.855, 0.06);
  }
  60% {
    transform: rotate(0deg);
    transition-timing-function: cubic-bezier(0.755, 0.5, 0.855, 0.06);
  }
  100% {
    transform: rotate(0deg);
    transition-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1);
  }
}
</style>
