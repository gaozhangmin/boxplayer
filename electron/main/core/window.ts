import { app, BrowserWindow, ipcMain, Menu, MessageChannelMain, nativeTheme, screen, shell, Tray } from 'electron'
import { getAsarPath, getStaticPath, getUserDataPath } from '../utils/mainfile'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import is from 'electron-is'
import { ShowErrorAndRelaunch } from './dialog'

const DEBUGGING = !app.isPackaged && process.env.BOXPLAYER_E2E !== '1'
const E2E_RENDERER_URL = process.env.BOXPLAYER_E2E_RENDERER_URL || ''
export const ua = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) aDrive/4.12.0 Chrome/108.0.5359.215 Electron/22.3.24 Safari/537.36'
export const Referer = 'https://www.aliyundrive.com/'
export const AppWindow: {
  mainWindow: BrowserWindow | undefined
  previewWindows: Set<BrowserWindow>
  uploadWindow: BrowserWindow | undefined
  downloadWindow: BrowserWindow | undefined
  readerWindow: BrowserWindow | undefined
  appTray: Tray | undefined
  winWidth: number
  winHeight: number
  winTheme: string
} = {
  mainWindow: undefined,
  previewWindows: new Set(),
  uploadWindow: undefined,
  downloadWindow: undefined,
  readerWindow: undefined,
  appTray: undefined,
  winWidth: 0,
  winHeight: 0,
  winTheme: ''
}

let timerUpload: NodeJS.Timeout | undefined
const debounceUpload = (fn: any, wait: number) => {
  if (timerUpload) {
    clearTimeout(timerUpload)
  }
  timerUpload = setTimeout(() => {
    fn()
    timerUpload = undefined
  }, wait)
}
let timerDownload: NodeJS.Timeout | undefined
const debounceDownload = (fn: any, wait: number) => {
  if (timerDownload) {
    clearTimeout(timerDownload)
  }
  timerDownload = setTimeout(() => {
    fn()
    timerDownload = undefined
  }, wait)
}
let timerResize: NodeJS.Timeout | undefined
const debounceResize = (fn: any, wait: number) => {
  if (timerResize) clearTimeout(timerResize)
  timerResize = setTimeout(() => {
    fn()
    timerResize = undefined
  }, wait)
}
nativeTheme.on('updated', () => {
  const message = { dark: nativeTheme.shouldUseDarkColors }
  if (AppWindow.mainWindow && !AppWindow.mainWindow.isDestroyed()) AppWindow.mainWindow.webContents.send('setTheme', message)
  for (const win of AppWindow.previewWindows) {
    if (!win.isDestroyed()) win.webContents.send('setTheme', message)
  }
})

export function createMainWindow() {
  Menu.setApplicationMenu(null)
  let launchMaximized = false
  try {
    const configJson = getUserDataPath('config.json')
    if (existsSync(configJson)) {
      const configData = JSON.parse(readFileSync(configJson, 'utf-8'))
      AppWindow.winWidth = configData.width
      AppWindow.winHeight = configData.height
    }
  } catch {
  }
  try {
    const settingJson = getUserDataPath('setting.config')
    if (existsSync(settingJson)) launchMaximized = JSON.parse(readFileSync(settingJson, 'utf-8')).uiLaunchMaximized === true
  } catch {
  }
  try {
    const themeJson = getUserDataPath('theme.json')
    if (existsSync(themeJson)) {
      const themeData = JSON.parse(readFileSync(themeJson, 'utf-8'))
      AppWindow.winTheme = themeData.theme
    }
  } catch {
  }
  if (AppWindow.winWidth <= 0) {
    try {
      const size = screen.getPrimaryDisplay().workAreaSize
      let width = size.width * 0.677
      const height = size.height * 0.866
      if (width > AppWindow.winWidth) AppWindow.winWidth = width
      if (AppWindow.winWidth > 990) AppWindow.winWidth = 990
      if (height > AppWindow.winHeight) AppWindow.winHeight = height
      if (AppWindow.winHeight > 680) AppWindow.winHeight = 680
    } catch {
      AppWindow.winWidth = 990
      AppWindow.winHeight = 680
    }
  }
  AppWindow.mainWindow = createElectronWindow(AppWindow.winWidth, AppWindow.winHeight, true, 'main', AppWindow.winTheme)
  if (launchMaximized) AppWindow.mainWindow.maximize()

  const showMainPage = () => {
    if (!AppWindow.mainWindow || AppWindow.mainWindow.isDestroyed()) return
    AppWindow.mainWindow.webContents.send('setPage', { page: 'PageMain' })
    AppWindow.mainWindow.webContents.send('setTheme', { dark: nativeTheme.shouldUseDarkColors })
  }

  AppWindow.mainWindow.on('resize', () => {
    debounceResize(function() {
      try {
        if (AppWindow.mainWindow
          && !AppWindow.mainWindow.isMaximized()
          && !AppWindow.mainWindow.isMinimized()
          && !AppWindow.mainWindow.isFullScreen()) {
          const s = AppWindow.mainWindow!.getSize()
          const configJson = getUserDataPath('config.json')
          writeFileSync(configJson, `{"width":${s[0].toString()},"height": ${s[1].toString()}}`, 'utf-8')
        }
      } catch {
      }
    }, 3000)
  })

  AppWindow.mainWindow.on('close', (event) => {
    if (is.macOS()) {
      // donothing
    } else {
      event.preventDefault()
      AppWindow.mainWindow?.hide()
    }
  })

  AppWindow.mainWindow.on('closed', (event: any) => {
    app.quit()
  })

  AppWindow.mainWindow.webContents.once('dom-ready', showMainPage)
  AppWindow.mainWindow.webContents.once('did-finish-load', showMainPage)
  setTimeout(showMainPage, 500)
  setTimeout(showMainPage, 1500)

  AppWindow.mainWindow.on('ready-to-show', function() {
    showMainPage()
    AppWindow.mainWindow!.setTitle('BoxPlayer')
    if (is.windows() && process.argv && process.argv.join(' ').indexOf('--openAsHidden') < 0) {
      AppWindow.mainWindow!.show()
    } else if (is.macOS() && !app.getLoginItemSettings().wasOpenedAsHidden) {
      AppWindow.mainWindow!.show()
    }
    if (is.linux()) {
      AppWindow.mainWindow!.show()
    }
  })

  AppWindow.mainWindow.webContents.on('render-process-gone', function(event, details) {
    if (details.reason == 'crashed' || details.reason == 'oom' || details.reason == 'killed') {
      ShowErrorAndRelaunch('(⊙o⊙)？小白羊遇到错误崩溃了', details.reason)
    }
  })

}

async function openDefaultAppSettings() {
  if (is.windows()) {
    try {
      await shell.openExternal('ms-settings:defaultapps')
      return
    } catch {
      // Fall through to the platform-neutral instructions below.
    }
  }

  const { dialog } = await import('electron')
  const isMac = is.macOS()
  await dialog.showMessageBox({
    type: 'info',
    title: '设置默认应用',
    message: isMac ? '请在 Finder 中选择 BoxPlayer 作为文件打开方式' : '请在系统中选择 BoxPlayer 作为默认应用',
    detail: isMac
      ? '在 Finder 中选中视频、音频或书籍文件，按 ⌘I，在“打开方式”中选择 BoxPlayer；如需应用到同类文件，点击“全部更改…”。'
      : '请在系统设置或文件管理器中，将所需的视频、音频或书籍格式关联到 BoxPlayer。'
  })
}

export function createTray() {
  const trayMenuTemplate = [
    {
      label: '显示主界面',
      click: function() {
        if (AppWindow.mainWindow && AppWindow.mainWindow.isDestroyed() == false) {
          if (AppWindow.mainWindow.isMinimized()) AppWindow.mainWindow.restore()
          AppWindow.mainWindow.show()
          AppWindow.mainWindow.focus()
        } else {
          createMainWindow()
        }
      }
    },
    {
      label: '系统默认应用设置',
      click: () => void openDefaultAppSettings()
    },
    {
      label: '安装命令行工具',
      click: async function() {
        const { ipcMain, dialog } = await import('electron')
        const win = AppWindow.mainWindow
        try {
          const result = await win?.webContents.executeJavaScript(
            `window.TvBoxInvoke('InstallCli', {})`
          )
          if (result?.ok) {
            dialog.showMessageBox({
              type: 'info',
              title: '安装成功',
              message: result.message || '命令行工具已安装',
              detail: (result.paths || []).join('\n'),
            })
          } else if (result?.needsElevation) {
            dialog.showMessageBox({
              type: 'warning',
              title: '权限不足',
              message: result.error,
            })
          } else {
            dialog.showErrorBox('安装失败', result?.error || '未知错误')
          }
        } catch (e: any) {
          dialog.showErrorBox('安装失败', e?.message || '未知错误')
        }
      }
    },
    {
      label: '彻底退出并停止下载',
      click: function() {
        if (AppWindow.mainWindow) {
          AppWindow.mainWindow.destroy()
          AppWindow.mainWindow = undefined
        }
        app.quit()
      }
    }
  ]

  const icon = getStaticPath('icon_256x256.ico')
  AppWindow.appTray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate(trayMenuTemplate)
  AppWindow.appTray.setToolTip('BoxPlayer')
  AppWindow.appTray.setContextMenu(contextMenu)
  AppWindow.appTray.on('click', () => {
    if (AppWindow.mainWindow && AppWindow.mainWindow.isDestroyed() == false) {
      if (AppWindow.mainWindow.isMinimized()) AppWindow.mainWindow.restore()
      AppWindow.mainWindow.show()
      AppWindow.mainWindow.focus()
    } else {
      createMainWindow()
    }
  })
}

export function createElectronWindow(width: number, height: number, center: boolean, page: string, theme: string, devTools: boolean = true) {
  const win = new BrowserWindow({
    show: false,
    width: width,
    height: height,
    minWidth: width > 680 ? 680 : width,
    minHeight: height > 500 ? 500 : height,
    center: center,
    icon: getStaticPath('icon_256x256.ico'),
    useContentSize: true,
    frame: false,
    transparent: false,
    hasShadow: width > 680,
    autoHideMenuBar: true,
    backgroundColor: theme && theme == 'dark' ? '#23232e' : '#ffffff',
    webPreferences: {
      spellcheck: false,
      devTools: true,
      webviewTag: true,
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      contextIsolation: false,
      backgroundThrottling: false,
      enableWebSQL: true,
      disableBlinkFeatures: 'OutOfBlinkCors,SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure',
      preload: getAsarPath('dist/electron/preload/index.js')
    }
  })
  win.removeMenu()
  if (DEBUGGING || E2E_RENDERER_URL) {
    win.loadURL(E2E_RENDERER_URL || process.env.VITE_DEV_SERVER_URL || '', { userAgent: ua, httpReferrer: Referer })
  } else {
    win.loadURL('file://' + getAsarPath('dist/' + page + '.html'), {
      userAgent: ua,
      httpReferrer: Referer
    })
  }

  if (DEBUGGING && devTools) {
    if (width < 100) {
      win.setSize(800, 680)
    }
    win.show()
    win.webContents.openDevTools({ mode: 'bottom' })
  } else {
    win.webContents.on('devtools-opened', () => {
      if (win && win.webContents.getType() === 'webview') {
        win.webContents.closeDevTools()
      }
    })
  }
  if (page == 'main2') {
    handleWinCmd(win)
  }
  handleWebView(win)
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault()
    if (!url.includes(process.env.VITE_DEV_SERVER_URL)) {
      shell.openExternal(url)
    }
  })
  win.webContents.on('did-create-window', (childWindow) => {
    if (is.windows()) {
      childWindow.setMenu(null)
    }
  })
  return win
}

function handleWebView(win: BrowserWindow) {
  // 处理DevTools
  win.webContents.on('before-input-event', (_, input: Electron.Input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key === 'F12') {
      win.webContents.isDevToolsOpened()
        ? win.webContents.closeDevTools()
        : win.webContents.openDevTools({ mode: 'undocked' })
    }
  })
  // 处理webview跳转
  win.webContents.addListener('did-attach-webview', (event, webContent) => {
    webContent.on('before-input-event', (_, input: Electron.Input) => {
      if (input.type === 'keyDown' && input.control && input.shift && input.key === 'F12') {
        webContent.isDevToolsOpened()
          ? webContent.closeDevTools()
          : webContent.openDevTools({ mode: 'undocked' })
      }
    })
    // 不允许的网址则阻止页面跳转并拉取浏览器展示页面
    webContent.setWindowOpenHandler((details) => {
      let url = details.url
      if (!/(aliyundrive|alipan).com\/s\/[0-9a-zA-Z_]{11,}/.test(url)) {
        webContent.loadURL(url)
      } else {
        win.webContents.send('webview-new-window', webContent.id, details)
      }
      return { action: 'deny' }
    })
    webContent.on('will-redirect', (e, url) => {
      if (/(aliyundrive|alipan).com\/s\/[0-9a-zA-Z_]{11,}/.test(url)) {
        e.preventDefault()
        win.webContents.send('webview-redirect', webContent.id, url)
      }
    })
    // 拦截链接跳转
    webContent.on('will-navigate', (e, url) => {
      if (/(aliyundrive|alipan).com\/s\/[0-9a-zA-Z_]{11,}/.test(url)) {
        e.preventDefault()
      }
    })
  })
}

let hasWindowCommandHandler = false

function handleWinCmd(win: BrowserWindow) {
  if (hasWindowCommandHandler) return
  hasWindowCommandHandler = true
  ipcMain.on('WebToWindow', (event, data) => {
    const currentWin = BrowserWindow.fromWebContents(event.sender) || win
    if (data.cmd && data.cmd === 'close') {
      event.returnValue = 'close'
      if (currentWin && !currentWin.isDestroyed()) currentWin.close()
    } else if (data.cmd && data.cmd === 'minsize') {
      event.returnValue = 'minsize'
      if (currentWin && !currentWin.isDestroyed()) currentWin.minimize()
    } else if (data.cmd && data.cmd === 'top') {
      if (currentWin && !currentWin.isDestroyed()) {
        if (currentWin.isAlwaysOnTop()) {
          event.returnValue = 'untop'
          currentWin.setAlwaysOnTop(false)
        } else {
          event.returnValue = 'top'
          currentWin.setAlwaysOnTop(true, 'status')
        }
      } else {
        event.returnValue = 'missing'
      }
    } else if (data.cmd && data.cmd === 'maxsize') {
      if (currentWin && !currentWin.isDestroyed()) {
        if (currentWin.isMaximized()) {
          event.returnValue = 'unmaximize'
          currentWin.unmaximize()
        } else {
          event.returnValue = 'maximize'
          currentWin.maximize()
        }
      } else {
        event.returnValue = 'missing'
      }
    } else if (data.cmd && data.cmd === 'fullscreen') {
      if (currentWin && !currentWin.isDestroyed()) {
        const isFullScreen = currentWin.isFullScreen()
        currentWin.setFullScreen(!isFullScreen)
        event.returnValue = isFullScreen ? 'unfullscreen' : 'fullscreen'
      } else {
        event.returnValue = 'missing'
      }
    } else if (data.cmd && data.cmd === 'enterfullscreen') {
      if (currentWin && !currentWin.isDestroyed()) {
        if (!currentWin.isFullScreen()) currentWin.setFullScreen(true)
        event.returnValue = 'fullscreen'
      } else {
        event.returnValue = 'missing'
      }
    } else if (data.cmd && data.cmd === 'exitfullscreen') {
      if (currentWin && !currentWin.isDestroyed()) {
        if (currentWin.isFullScreen()) currentWin.setFullScreen(false)
        event.returnValue = 'unfullscreen'
      } else {
        event.returnValue = 'missing'
      }
    } else {
      event.returnValue = 'unknown'
    }
  })
}

function creatUploadPort() {
  debounceUpload(function() {
    if (AppWindow.mainWindow && AppWindow.uploadWindow && AppWindow.uploadWindow.isDestroyed() == false) {
      const { port1, port2 } = new MessageChannelMain()
      AppWindow.mainWindow.webContents.postMessage('setUploadPort', undefined, [port1])
      AppWindow.uploadWindow.webContents.postMessage('setPort', undefined, [port2])
    }
  }, 1000)
}

function creatDownloadPort() {
  debounceDownload(function() {
    if (AppWindow.mainWindow && AppWindow.downloadWindow && AppWindow.downloadWindow.isDestroyed() == false) {
      const { port1, port2 } = new MessageChannelMain()
      AppWindow.mainWindow.webContents.postMessage('setDownloadPort', undefined, [port1])
      AppWindow.downloadWindow.webContents.postMessage('setPort', undefined, [port2])
    }
  }, 1000)
}


function createUpload() {
  if (AppWindow.uploadWindow && AppWindow.uploadWindow.isDestroyed() == false) return
  AppWindow.uploadWindow = createElectronWindow(10, 10, false, 'main', 'dark', false)

  AppWindow.uploadWindow.on('ready-to-show', function() {
    creatUploadPort()
    AppWindow.uploadWindow!.webContents.send('setPage', { page: 'PageWorker', data: { type: 'upload' } })
    AppWindow.uploadWindow!.setTitle('boxplayer上传进程')
  })

  AppWindow.uploadWindow.webContents.on('render-process-gone', function(event, details) {
    if (details.reason == 'crashed' || details.reason == 'oom' || details.reason == 'killed' || details.reason == 'integrity-failure') {
      try {
        AppWindow.uploadWindow?.destroy()
      } catch {
      }
      AppWindow.uploadWindow = undefined
      createUpload()
    }
  })
  // AppWindow.uploadWindow.webContents.openDevTools({ mode: 'undocked' })
  AppWindow.uploadWindow.hide()
}

function createDownload() {
  if (AppWindow.downloadWindow && AppWindow.downloadWindow.isDestroyed() == false) return
  AppWindow.downloadWindow = createElectronWindow(10, 10, false, 'main', 'dark', false)

  AppWindow.downloadWindow.on('ready-to-show', function() {
    creatDownloadPort()
    AppWindow.downloadWindow!.webContents.send('setPage', { page: 'PageWorker', data: { type: 'download' } })
    AppWindow.downloadWindow!.setTitle('boxplayer下载进程')
  })

  AppWindow.downloadWindow.webContents.on('render-process-gone', function(event, details) {
    if (details.reason == 'crashed' || details.reason == 'oom' || details.reason == 'killed' || details.reason == 'integrity-failure') {
      try {
        AppWindow.downloadWindow?.destroy()
      } catch {
      }
      AppWindow.downloadWindow = undefined
      createDownload()
    }
  })

  AppWindow.downloadWindow.webContents.closeDevTools()
  AppWindow.downloadWindow.hide()
}

ipcMain.on('EnsureTransferWorker', (_event, type: unknown) => {
  if (type === 'upload') createUpload()
  else if (type === 'download') createDownload()
})

export function createReaderWindow(bookData: any) {
  if (AppWindow.readerWindow && !AppWindow.readerWindow.isDestroyed()) {
    AppWindow.readerWindow.focus()
    AppWindow.readerWindow.webContents.send('setPage', { page: 'PageBookReader', data: bookData })
    return
  }

  const display = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = display.workAreaSize
  const winWidth = Math.min(Math.round(screenWidth * 0.75), 1200)
  const winHeight = Math.min(Math.round(screenHeight * 0.85), 900)

  AppWindow.readerWindow = new BrowserWindow({
    show: false,
    width: winWidth,
    height: winHeight,
    minWidth: 680,
    minHeight: 500,
    center: true,
    icon: getStaticPath('icon_256x256.ico'),
    useContentSize: true,
    frame: false,
    transparent: false,
    title: 'BoxPlayer 阅读器',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      spellcheck: false,
      devTools: true,
      webviewTag: true,
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      contextIsolation: false,
      backgroundThrottling: false,
      enableWebSQL: true,
      disableBlinkFeatures: 'OutOfBlinkCors,SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure',
      preload: getAsarPath('dist/electron/preload/index.js')
    }
  })

  AppWindow.readerWindow.removeMenu()

  if (DEBUGGING || E2E_RENDERER_URL) {
    AppWindow.readerWindow.loadURL(E2E_RENDERER_URL || process.env.VITE_DEV_SERVER_URL!, { userAgent: ua, httpReferrer: Referer })
  } else {
    AppWindow.readerWindow.loadURL('file://' + getAsarPath('dist/main.html'), { userAgent: ua, httpReferrer: Referer })
  }

  AppWindow.readerWindow.on('ready-to-show', () => {
    AppWindow.readerWindow!.webContents.send('setPage', { page: 'PageBookReader', data: bookData })
    AppWindow.readerWindow!.show()
  })

  AppWindow.readerWindow.on('closed', () => {
    AppWindow.readerWindow = undefined
  })

  handleWinCmd(AppWindow.readerWindow)

  AppWindow.readerWindow.webContents.on('will-navigate', (e, url) => {
    e.preventDefault()
    if (!url.includes(process.env.VITE_DEV_SERVER_URL || '')) {
      shell.openExternal(url)
    }
  })
}
