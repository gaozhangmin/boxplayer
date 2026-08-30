import { createApp } from 'vue'
import App from './App.vue'
import ArcoVue from '@arco-design/web-vue'
import store, { useAppStore, useSettingStore } from './store'
import '@arco-themes/vue-gi-demo/css/arco.css'
import message from './utils/message'
import DebugLog from './utils/debuglog'
import { PageMain } from './layout/PageMain'
import { WorkerPage } from './workerpage/workercmd'
import ServerHttp from './aliapi/server'
import { startMediaAcquisitionWorkflowRunner, wakeMediaAcquisitionWorkflowRunner } from './services/mediaAcquisition/workflowRunner'
import { setLocale } from './i18n'
import UserDAL from './user/userdal'
import { startAnalytics } from './analytics/posthog'

document.documentElement.style.setProperty('--app-icon-image', `url("${new URL('icon.svg', document.baseURI).toString()}")`)

window.onerror = function (errorMessage, scriptURI, lineNo, columnNo, error) {
  try {
    if (errorMessage
      && typeof errorMessage === 'string') {
      if (errorMessage.indexOf('ResizeObserver') >= 0
        || errorMessage.indexOf('listen EADDRINUSE') >= 0
        || errorMessage.indexOf('connect ENOENT') >= 0) {
        return true
      }
    }
    // DebugLog.mSaveDanger('onerror')
    if (typeof errorMessage === 'string') {
      DebugLog.mSaveDanger(errorMessage)
      message.error('onerror ' + errorMessage)
    }
    if (error) {
      DebugLog.mSaveDanger('onerror', error)
      message.error('onerror ' + error.message)
    }
  } catch {}
  return true
}

window.addEventListener('unhandledrejection', function (event) {
  try {
    if (event.reason && event.reason.message && event.reason.message.indexOf('oauth/authorize?') > 0) {
      event.stopPropagation()
      event.preventDefault()
      return
    }

    // DebugLog.mSaveDanger('unhandledrejection')
    const reason = event.reason
    if (reason && reason.message) {
      if (/no supported source/i.test(reason.message)) {
        message.error('不支持当前媒体类型', 1)
        event.stopPropagation()
        event.preventDefault()
        return
      }
      DebugLog.mSaveDanger('unhandledrejection', reason)
      message.error('rejection ' + reason.message, 1)
    }
    if (!reason) DebugLog.mSaveDanger('unhandledrejection', JSON.stringify(event))
  } catch {}
  event.stopPropagation()
  event.preventDefault()
})

const app = createApp(App)
import IconFont from './components/IconFont.vue'
app.component('IconFont', IconFont)
app.config.errorHandler = function (err: any, vm, info) {
  try {
    if (typeof err === 'string') {
      DebugLog.mSaveDanger('errorHandler', err)
      message.error('errorHandler ' + err, 1)
    } else {
      DebugLog.mSaveDanger('errorHandler', err)
      if (err && err.message) message.error('errorHandler ' + err.message, 1)
    }
  } catch {}
  return true
}
app.use(ArcoVue, {})
app.use(store)
const settingStore = useSettingStore()
setLocale(settingStore.uiLanguage)
settingStore.$subscribe((_mutation, state) => setLocale(state.uiLanguage))
// Page components can request cloud data as soon as Vue mounts, so install
// network-failure tracking before those first requests begin.
startAnalytics()
app.mount('#app')
window.Electron.ipcRenderer.on('mediaAcquisition:wake', () => {
  // A deep-link page can receive the durable main-process wake before the UI
  // switches back to PageMain. The runner is lease-protected, so start it in
  // every renderer route rather than silently dropping queued work.
  startMediaAcquisitionWorkflowRunner()
  wakeMediaAcquisitionWorkflowRunner()
})


window.WinMsgToMain = function (event: any) {
  if (window.MainPort) window.MainPort.postMessage(event)
}
const pendingUploadEvents: any[] = []
const pendingDownloadEvents: any[] = []
window.WinMsgToUpload = function (event: any) {
  if (window.UploadPort) {
    window.UploadPort.postMessage(event)
    return
  }
  pendingUploadEvents.push(event)
  window.Electron.ipcRenderer.send('EnsureTransferWorker', 'upload')
}
window.WinMsgToDownload = function (event: any) {
  if (window.DownloadPort) {
    window.DownloadPort.postMessage(event)
    return
  }
  pendingDownloadEvents.push(event)
  window.Electron.ipcRenderer.send('EnsureTransferWorker', 'download')
}

window.Electron.ipcRenderer.on('setPort', (_event: any, args: any) => {
  const [port] = _event.ports
  window.MainPort = port
  port.onmessage = (event: any) => {
    Promise.resolve().then(() => {
      try {
        if (window.WinMsg) window.WinMsg(event.data)
      } catch {}
    })
  }
})
window.Electron.ipcRenderer.on('setUploadPort', (_event: any, args: any) => {
  const [port] = _event.ports
  window.UploadPort = port
  port.onmessage = (event: any) => {
    Promise.resolve().then(() => {
      try {
        if (window.WinMsg) window.WinMsg(event.data)
      } catch {}
    })
  }
  while (pendingUploadEvents.length) window.UploadPort.postMessage(pendingUploadEvents.shift())
})
window.Electron.ipcRenderer.on('setDownloadPort', (_event: any, args: any) => {
  const [port] = _event.ports
  window.DownloadPort = port
  port.onmessage = (event: any) => {
    Promise.resolve().then(() => {
      try {
        if (window.WinMsg) window.WinMsg(event.data)
      } catch {}
    })
  }
  while (pendingDownloadEvents.length) window.DownloadPort.postMessage(pendingDownloadEvents.shift())
})

window.Electron.ipcRenderer.on('setPage', async (_event: any, args: any) => {
  console.log('setPage', args.page, args)
  const appStore = useAppStore()
  const settingStore = useSettingStore()
  if (args.appTheme && settingStore) appStore.toggleTheme(args.appTheme)

  const pageUserId = String(args?.data?.user_id || '')
  if (pageUserId) await UserDAL.GetUserTokenFromDB(pageUserId)

  if (args.page == 'PageMain') {
    PageMain()
    window.IsMainPage = true
    startMediaAcquisitionWorkflowRunner()
  } else if (args.page == 'PageWorker') {
    WorkerPage(args.data.type)
  } else if (args.page == 'PageCode') {
    appStore.pageCode = args.data
  } else if (args.page == 'PageOffice') {
    appStore.pageOffice = args.data
  } else if (args.page == 'PagePdf') {
    appStore.pagePdf = args.data
  } else if (args.page == 'PageEpub') {
    appStore.pageEpub = args.data
  } else if (args.page == 'PageBookReader') {
    appStore.pageEpub = args.data
  } else if (args.page == 'PageDocx') {
    appStore.pageDocx = args.data
  } else if (args.page == 'PageSheet') {
    appStore.pageSheet = args.data
  } else if (args.page == 'PageImage') {
    appStore.pageImage = args.data
  } else if (args.page == 'PageVideoXBT') {
    appStore.pageVideoXBT = args.data
  } else if (args.page == 'PageVideo') {
    appStore.pageVideo = args.data
  } else if (args.page == 'PageMusic') {
    appStore.pageMusic = args.data
  } else if (args.page == 'PageLyric') {
    // Desktop lyric window - just toggle page, no data needed
  }
  if (args.page) appStore.togglePage(args.page)
})

window.Electron.ipcRenderer.on('setTheme', (_event: any, args: any) => {
  const appStore = useAppStore()
  if (args.theme) appStore.toggleTheme(args.theme)
  appStore.toggleDark(args.dark)
})

window.Electron.ipcRenderer.on('showUpdateModal', () => {
  ServerHttp.CheckUpgrade(false).catch(() => {})
})

window.Electron.ipcRenderer.on('cloud123-oauth-callback', (_event: any, url: string) => {
  if (!url) return
  window.dispatchEvent(new CustomEvent('cloud123-oauth-callback', { detail: url }))
})
try {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
} catch {}
