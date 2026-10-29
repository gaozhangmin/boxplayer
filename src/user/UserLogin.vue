<script setup lang='ts'>
import { computed, h, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import SourceFormSurface from '../components/SourceFormSurface.vue'
import { ITokenInfo, useAppStore, useSettingStore, useUserStore } from '../store'
import UserDAL from '../user/userdal'
import Config from '../config'
import message from '../utils/message'
import DebugLog from '../utils/debuglog'
import { GetSignature } from '../aliapi/utils'
import getUuid from 'uuid-by-string'
import AliUser from '../aliapi/user'
import AliHttp from '../aliapi/alihttp'
import { Input, Modal, Space } from '@arco-design/web-vue'
import { QRCode as AntQRCode } from 'ant-design-vue'
import { buildCloud123AuthUrl, exchangeCloud123CodeForToken } from '../cloud123/auth'
import { buildBaiduAuthUrl, exchangeBaiduCodeForToken } from '../cloudbaidu/auth'
import { refreshDrive115UserInfo } from '../cloud115/auth'
import { buildQrImageUrl, DRIVE115_APP_ID, exchangeDeviceCode, generatePkce, normalize115Token, pollDeviceStatus, requestDeviceCode } from '../utils/drive115'
import { loginPikPak } from '../pikpak/auth'
import { completeQuarkQrLogin, pollQuarkQrStatus, requestQuarkQrCode } from '../quark/auth'
import { normalizeCloud139Token } from '../cloud139/auth'
import { Cloud189QrState, pollCloud189QrLogin, requestCloud189QrCode } from '../cloud189/auth'
import { GuangyaSmsState, generateGuangyaDid, requestGuangyaSmsCode, submitGuangyaSmsCode } from '../guangya/auth'
import { DROPBOX_APP_KEY, buildDropboxAuthUrl, createDropboxPkceVerifier, exchangeDropboxCodeForToken } from '../dropbox/auth'
import { ONEDRIVE_CLIENT_ID, buildOneDriveAuthUrl, createOneDrivePkceVerifier, exchangeOneDriveCodeForToken } from '../onedrive/auth'
import { BOX_CLIENT_ID, buildBoxAuthUrl, createBoxPkceVerifier, exchangeBoxCodeForToken } from '../box/auth'
import { GOOGLE_CLIENT_ID, buildGoogleAuthUrl, createGooglePkceVerifier, exchangeGoogleCodeForToken } from '../google/auth'
import { getDriveProviderMeta } from '../utils/driveProvider'
import { ALIYUN_APP_ID, ALIYUN_APP_SECRET, GOOGLE_CLIENT_SECRET } from '../secrets.generated'
import { t } from '../i18n'
import { createAListConnection, createWebDavConnection, saveWebDavConnection, testWebDavConnection } from '../utils/webdavClient'
import { createRemoteDriveAccount } from '../utils/remoteDriveAccount'
import { useMediaLibraryStore } from '../store/medialibrary'

const props = defineProps<{ embedded?: boolean; provider?: string; sourceName?: string }>()
const emit = defineEmits<{ connected: []; cancel: [] }>()
const inlineVisible = ref(false)
let disposed = false
let loginCompleted = false
const loginVisible = computed({
  get: () => props.embedded ? inlineVisible.value : useUser.userShowLogin,
  set: value => {
    if (disposed) return
    if (props.embedded) {
      inlineVisible.value = value
      if (!value) {
        if (loginCompleted) emit('connected')
        else emit('cancel')
      }
    } else useUser.userShowLogin = value
  }
})
const saveLogin = async (token: ITokenInfo, interactive = false) => {
  if (disposed || !loginVisible.value) return
  const sourceName = ['webdav', 'alist'].includes(loginProvider.value) ? remoteDriveForm.value.name : props.sourceName
  await UserDAL.UserLogin(token, interactive, props.embedded ? sourceName : undefined)
  loginCompleted = true
}

const useUser = useUserStore()
const settingStore = useSettingStore()
const loginCur = ref(1)
const loginToken = ref<ITokenInfo>()
const loginStatus = ref<'wait' | 'error' | 'finish' | 'process'>('process')
const loginLoading = ref(true)
const client_id = ref(ALIYUN_APP_ID)
const client_secret = ref(ALIYUN_APP_SECRET)

const intervalId = ref()
const qrCodeUrl = ref('')
const qrCodeStatusType = ref()
const qrCodeStatusTips = ref()

type LoginProvider = 'aliyun' | 'cloud123' | '115' | '139' | '189' | 'guangya' | 'baidu' | 'pikpak' | 'quark' | 'dropbox' | 'onedrive' | 'box' | 'google' | 'webdav' | 'alist'

const loginProvider = ref<LoginProvider>('aliyun')
const loginProviders: LoginProvider[] = ['aliyun', 'cloud123', '115', '139', '189', 'guangya', 'baidu', 'pikpak', 'quark', 'dropbox', 'onedrive', 'box', 'google', 'webdav', 'alist']
const getLoginProviderMeta = (provider: LoginProvider) => getDriveProviderMeta(provider)
const activeLoginProviderMeta = computed(() => getLoginProviderMeta(loginProvider.value))
const cloud123Code = ref('')
const cloud123Loading = ref(false)
const baiduCode = ref('')
const baiduLoading = ref(false)
const baiduAuthUrl = ref('')
const pikpakUsername = ref('')
const pikpakPassword = ref('')
const pikpakLoading = ref(false)
const quarkLoading = ref(false)
const quarkTips = ref(t('login.scanWithQuark'))
const quarkQrToken = ref('')
const quarkQrImageUrl = ref('')
const quarkQrStatusType = ref<'info' | 'success' | 'warning' | 'error'>('info')
const cloud139Authorization = ref('')
const cloud139Loading = ref(false)
const cloud189Loading = ref(false)
const cloud189Tips = ref(t('login.scanWithCloud189'))
const cloud189QrState = ref<Cloud189QrState | null>(null)
const cloud189QrStatusType = ref<'info' | 'success' | 'warning' | 'error'>('info')
const cloud189QrUrl = ref('')
const guangyaPhone = ref('')
const guangyaCode = ref('')
const guangyaDeviceId = ref(generateGuangyaDid())
const guangyaSmsState = ref<GuangyaSmsState | null>(null)
const guangyaLoading = ref(false)
const dropboxAppKey = ref('')
const dropboxVerifier = ref('')
const dropboxLoading = ref(false)
const dropboxAuthUrl = ref('')
const onedriveClientId = ref('')
const onedriveVerifier = ref('')
const onedriveLoading = ref(false)
const onedriveAuthUrl = ref('')
const boxClientId = ref('')
const boxVerifier = ref('')
const boxLoading = ref(false)
const boxAuthUrl = ref('')
const googleClientId = ref('')
const googleVerifier = ref('')
const googleState = ref('')
const googleRedirectUri = ref('')
const googleLoading = ref(false)
const remoteDriveLoading = ref(false)
const remoteDriveForm = ref({ name: props.sourceName || '', url: '', username: '', password: '', rootPath: '/' })
const drive115ClientId = ref(DRIVE115_APP_ID || '')
const drive115Verifier = ref('')
const drive115Uid = ref('')
const drive115Time = ref('')
const drive115Sign = ref('')
const drive115Tips = ref(t('login.scanWith115'))
const drive115Loading = ref(false)
const drive115Polling = ref(false)
let drive115Timer: any = null
let quarkTimer: any = null
let quarkPolling = false
let cloud189Timer: any = null
let cloud189Polling = false
let loginOpenTimer: any = null
let cloud123OpenTimer: any = null
let baiduOpenTimer: any = null
let aliyunLoginHandled = false
let aliyunWebviewInitialized = false

const getAliyunLoginWebview = () => document.getElementById('loginiframe') as any

const clearOpenTimers = () => {
  if (loginOpenTimer) {
    clearTimeout(loginOpenTimer)
    loginOpenTimer = null
  }
  if (cloud123OpenTimer) {
    clearTimeout(cloud123OpenTimer)
    cloud123OpenTimer = null
  }
  if (baiduOpenTimer) {
    clearTimeout(baiduOpenTimer)
    baiduOpenTimer = null
  }
}

const handleModalOpen = () => {
  if (disposed || !loginVisible.value) return
  const stored = props.embedded ? props.provider : localStorage.getItem('login_provider')
  if (stored === 'cloud123' || stored === 'aliyun' || stored === '115' || stored === '139' || stored === '189' || stored === 'guangya' || stored === 'baidu' || stored === 'pikpak' || stored === 'quark' || stored === 'dropbox' || stored === 'onedrive' || stored === 'box' || stored === 'google' || stored === 'webdav' || stored === 'alist') {
    loginProvider.value = stored
  }
  dropboxAppKey.value = localStorage.getItem('dropbox_app_key') || DROPBOX_APP_KEY
  onedriveClientId.value = localStorage.getItem('onedrive_client_id') || ONEDRIVE_CLIENT_ID
  boxClientId.value = localStorage.getItem('box_client_id') || BOX_CLIENT_ID
  googleClientId.value = GOOGLE_CLIENT_ID
  if (loginProvider.value === 'cloud123') {
    handleOpenCloud123()
  } else if (loginProvider.value === 'baidu') {
    handleOpenBaidu()
  } else if (loginProvider.value === '115') {
    handleOpen115()
  } else if (loginProvider.value === 'pikpak') {
    loginLoading.value = false
  } else if (loginProvider.value === 'quark') {
    handleOpenQuark()
  } else if (loginProvider.value === '139') {
    loginLoading.value = false
  } else if (loginProvider.value === '189') {
    handleOpen189()
  } else if (loginProvider.value === 'guangya') {
    loginLoading.value = false
  } else if (loginProvider.value === 'dropbox') {
    handleOpenDropbox()
  } else if (loginProvider.value === 'onedrive') {
    handleOpenOneDrive()
  } else if (loginProvider.value === 'box') {
    handleOpenBox()
  } else if (loginProvider.value === 'google') {
    handleOpenGoogle()
  } else if (loginProvider.value === 'webdav' || loginProvider.value === 'alist') {
    loginLoading.value = false
  } else {
    handleOpen()
  }
}

const handleOauthCallback = (event: any) => {
  if (!loginVisible.value) return
  if (loginProvider.value !== 'cloud123' && loginProvider.value !== 'baidu' && loginProvider.value !== 'dropbox' && loginProvider.value !== 'onedrive' && loginProvider.value !== 'box' && loginProvider.value !== 'google') return
  const url = event?.detail || ''
  if (!url) return
  try {
    const parsed = new URL(url)
    const code = parsed.searchParams.get('code') || ''
    if (code) {
      if (loginProvider.value === 'cloud123') {
        cloud123Code.value = code
        submitCloud123Code()
      } else if (loginProvider.value === 'baidu') {
        baiduCode.value = code
        submitBaiduCode()
      } else if (loginProvider.value === 'dropbox') {
        submitDropboxCode(code)
      } else if (loginProvider.value === 'onedrive') {
        submitOneDriveCode(code)
      } else if (loginProvider.value === 'box') {
        submitBoxCode(code)
      } else if (loginProvider.value === 'google') {
        const state = parsed.searchParams.get('state') || ''
        if (!googleState.value || state !== googleState.value) {
          message.error('Google Drive 授权回调校验失败，请重新登录')
          return
        }
        submitGoogleCode(code)
      }
    }
  } catch {
    // ignore parse errors
  }
}

onMounted(() => {
  if (props.embedded) {
    useUser.loginFromFileSources = true
    inlineVisible.value = true
  }
  window.addEventListener('cloud123-oauth-callback', handleOauthCallback as EventListener)
})

onBeforeUnmount(() => {
  disposed = true
  if (props.embedded) { handleClose(); useUser.loginFromFileSources = false }
  window.removeEventListener('cloud123-oauth-callback', handleOauthCallback as EventListener)
})

watch(loginProvider, () => {
  if (props.embedded || !loginVisible.value) return
  clearOpenTimers()
  if (loginProvider.value === 'cloud123') {
    handleOpenCloud123()
  } else if (loginProvider.value === 'baidu') {
    handleOpenBaidu()
  } else if (loginProvider.value === '115') {
    handleOpen115()
  } else if (loginProvider.value === 'pikpak') {
    loginLoading.value = false
  } else if (loginProvider.value === 'quark') {
    handleOpenQuark()
  } else if (loginProvider.value === '139') {
    loginLoading.value = false
  } else if (loginProvider.value === '189') {
    handleOpen189()
  } else if (loginProvider.value === 'guangya') {
    loginLoading.value = false
  } else if (loginProvider.value === 'dropbox') {
    handleOpenDropbox()
  } else if (loginProvider.value === 'onedrive') {
    handleOpenOneDrive()
  } else if (loginProvider.value === 'box') {
    handleOpenBox()
  } else if (loginProvider.value === 'google') {
    handleOpenGoogle()
  } else if (loginProvider.value === 'webdav' || loginProvider.value === 'alist') {
    loginLoading.value = false
  } else {
    handleOpen()
  }
})


const cb = (val: any) => {
  settingStore.updateStore(val)
}

function b64decode(e: string) {
  const t = atob(e)
  let r = t.length
  const n = new Uint8Array(r)
  while (r--) n[r] = t.charCodeAt(r)
  return new Blob([n])
}

function readData(e: string) {
  return new Promise<string>(function(resolve, reject) {
    const n = b64decode(e)
    const i = new FileReader()
    i.onloadend = function(e) {
      resolve((e?.target?.result as string | undefined) || '')
    }
    i.onerror = function(e) {
      return reject(e)
    }
    i.readAsText(n, 'gbk')
  })
}

const refreshStepTips = (status: 'error' | 'finish' | 'process', index: number) => {
  loginStatus.value = status
  loginLoading.value = index !== loginCur.value
  loginCur.value = index
}

const refreshQrCodeStatus = (codeUrl: string = '', type: string = 'info', tips: string = t('login.scanWithAliyun')) => {
  qrCodeUrl.value = codeUrl
  qrCodeStatusType.value = type
  qrCodeStatusTips.value = tips
}

const handleOpen = () => {
  clearOpenTimers()
  loginOpenTimer = setTimeout(() => {
    if (loginProvider.value !== 'aliyun' || !loginVisible.value) return
    const webview = getAliyunLoginWebview()
    if (!webview) {
      message.error(t('login.loginFailed'))
      return
    }
    if (aliyunWebviewInitialized) {
      loginLoading.value = typeof webview.isLoading === 'function' ? webview.isLoading() : false
      return
    }
    aliyunWebviewInitialized = true
    if (import.meta.env.DEV) {
      try {
        webview.openDevTools({ mode: 'bottom', activate: false })
      } catch (err: any) {
        DebugLog.mSaveWarning('Aliyun login webview DevTools open failed ' + (err?.message || err))
      }
    }
    aliyunLoginHandled = false
    const extractBizExt = (payload: string) => {
      try {
        const parsed = JSON.parse(payload)
        if (parsed?.bizExt) return String(parsed.bizExt)
      } catch {
        // Some versions of the login page print a JavaScript object instead of JSON.
      }
      const match = payload.match(/["']?bizExt["']?\s*[:=]\s*["']([^"']+)["']/i)
      return match?.[1] || ''
    }
    const handleLoginPayload = (payload: string) => {
      try {
        const parsed = JSON.parse(payload)
        if (parsed?.code && !aliyunLoginHandled) {
          aliyunLoginHandled = true
          loginStepFirst(payload)
          try {
            webview.stop()
          } catch {
            // ignore navigation stop errors after the OAuth callback is received
          }
          return true
        }
      } catch {
        // Continue with the legacy bizExt parser below.
      }
      const bizExt = extractBizExt(payload)
      if (aliyunLoginHandled || !bizExt) return false
      aliyunLoginHandled = true
      loginStepFirst(JSON.stringify({ bizExt }))
      try {
        webview.stop()
      } catch {
        // ignore navigation stop errors after the login callback is received
      }
      return true
    }
    const handleLoginNavigation = (event: any) => {
      const url = event?.url || ''
      if (!url) return
      try {
        const parsed = new URL(url)
        const code = parsed.searchParams.get('code') || ''
        if (code && handleLoginPayload(JSON.stringify({ code }))) {
          event?.preventDefault?.()
          return
        }
        if (!url.includes('bizExt')) return
        const bizExt = parsed.searchParams.get('bizExt') || new URLSearchParams(parsed.hash.replace(/^#\??/, '')).get('bizExt')
        if (bizExt && handleLoginPayload(JSON.stringify({ bizExt }))) event?.preventDefault?.()
      } catch (err: any) {
        DebugLog.mSaveWarning('Aliyun login callback parse failed ' + (err?.message || err))
      }
    }
    webview.addEventListener('will-navigate', handleLoginNavigation)
    webview.addEventListener('did-navigate', handleLoginNavigation)
    webview.addEventListener('did-redirect-navigation', handleLoginNavigation)
    webview.addEventListener('did-navigate-in-page', handleLoginNavigation)
    webview.addEventListener('console-message', (e: any) => {
      const msg = e.message || ''
      loginLoading.value = false
      handleLoginPayload(msg)
    })
    const load = webview.loadURL(Config.loginUrl, { httpReferrer: Config.referer })
    if (load?.catch) {
      load.catch((err: any) => {
        loginLoading.value = false
        if (loginProvider.value === 'aliyun' && loginVisible.value) DebugLog.mSaveWarning('Aliyun login webview load failed ' + (err?.message || err))
      })
    }
    webview.addEventListener('did-finish-load', () => {
      loginLoading.value = false
    })
    webview.addEventListener('did-fail-load', () => {
      loginLoading.value = false
    })
  }, 1000)
}

const handleClose = () => {
  if (!props.embedded) useUser.loginFromFileSources = false
  aliyunWebviewInitialized = false
  loginLoading.value = true
  client_id.value = ALIYUN_APP_ID
  client_secret.value = ALIYUN_APP_SECRET
  clearInterval(intervalId.value)
  clearOpenTimers()
  if (drive115Timer) {
    clearTimeout(drive115Timer)
    drive115Timer = null
  }
  clearQuarkTimer()
  clearCloud189Timer()
  refreshStepTips('process', 1)
  refreshQrCodeStatus()
  cloud123Code.value = ''
  cloud123Loading.value = false
  baiduCode.value = ''
  baiduLoading.value = false
  baiduAuthUrl.value = ''
  drive115Verifier.value = ''
  drive115Uid.value = ''
  drive115Time.value = ''
  drive115Sign.value = ''
  drive115Tips.value = t('login.scanWith115')
  drive115Loading.value = false
  drive115Polling.value = false
  pikpakPassword.value = ''
  pikpakLoading.value = false
  quarkLoading.value = false
  quarkTips.value = t('login.scanWithQuark')
  quarkQrToken.value = ''
  quarkQrImageUrl.value = ''
  quarkQrStatusType.value = 'info'
  cloud139Authorization.value = ''
  cloud139Loading.value = false
  cloud189Loading.value = false
  cloud189Tips.value = t('login.scanWithCloud189')
  cloud189QrState.value = null
  cloud189QrStatusType.value = 'info'
  cloud189QrUrl.value = ''
  guangyaCode.value = ''
  guangyaSmsState.value = null
  guangyaLoading.value = false
  dropboxVerifier.value = ''
  dropboxLoading.value = false
  dropboxAuthUrl.value = ''
  onedriveVerifier.value = ''
  onedriveLoading.value = false
  onedriveAuthUrl.value = ''
  boxVerifier.value = ''
  boxLoading.value = false
  boxAuthUrl.value = ''
  remoteDriveLoading.value = false
  remoteDriveForm.value = { name: '', url: '', username: '', password: '', rootPath: '/' }
}

const submitRemoteDrive = async () => {
  const form = remoteDriveForm.value
  const provider = loginProvider.value
  if ((provider !== 'webdav' && provider !== 'alist') || !form.url.trim() || !form.username.trim() || !form.password.trim()) {
    message.error(provider === 'alist' ? '请填写 AList 地址、用户名和密码' : '请填写 WebDAV 地址、用户名和密码')
    return
  }

  remoteDriveLoading.value = true
  try {
    const connection = provider === 'alist' ? createAListConnection(form) : createWebDavConnection(form)
    await testWebDavConnection(connection)
    if (disposed || !loginVisible.value) return
    saveWebDavConnection(connection)
    const account = createRemoteDriveAccount(connection)
    const mediaStore = useMediaLibraryStore()
    if (!mediaStore.folders.some((folder) => folder.id === account.folder.id)) mediaStore.addFolder(account.folder)
    await saveLogin(account.token)
    if (!props.embedded) useAppStore().resetTab('pan')
    loginVisible.value = false
    message.success(`${provider === 'alist' ? 'AList' : 'WebDAV'} 已连接，可在网盘中浏览并对文件夹执行刮削`)
  } catch (error: any) {
    message.error(`连接失败：${error?.message || '请检查地址和登录信息'}`)
  } finally {
    remoteDriveLoading.value = false
  }
}

const handleOpenCloud123 = () => {
  loginLoading.value = false
  clearOpenTimers()
  cloud123OpenTimer = setTimeout(() => {
    if (loginProvider.value !== 'cloud123' || !loginVisible.value) return
    const authUrl = buildCloud123AuthUrl()
    window.Electron.shell.openExternal(authUrl)
  }, 50)
}

const handleReopenCloud123 = () => {
  const authUrl = buildCloud123AuthUrl()
  window.Electron.shell.openExternal(authUrl)
}

const handleOpenBaidu = () => {
  loginLoading.value = false
  clearOpenTimers()
  if (loginProvider.value !== 'baidu' || !loginVisible.value) return
  const authUrl = buildBaiduAuthUrl()
  baiduAuthUrl.value = authUrl
  window.Electron.shell.openExternal(authUrl)
}

const handleReopenBaidu = () => {
  const authUrl = baiduAuthUrl.value || buildBaiduAuthUrl()
  baiduAuthUrl.value = authUrl
  window.Electron.shell.openExternal(authUrl)
}

const handleOpenDropbox = async () => {
  loginLoading.value = false
  const appKey = (dropboxAppKey.value || localStorage.getItem('dropbox_app_key') || DROPBOX_APP_KEY).trim()
  if (!appKey) {
    message.warning('请先在 src/dropbox/auth.ts 填写 DROPBOX_APP_KEY')
    return
  }
  dropboxAppKey.value = appKey
  localStorage.setItem('dropbox_app_key', appKey)
  dropboxVerifier.value = createDropboxPkceVerifier()
  const authUrl = await buildDropboxAuthUrl(appKey, dropboxVerifier.value)
  if (disposed || !loginVisible.value) return
  dropboxAuthUrl.value = authUrl
  window.Electron.shell.openExternal(authUrl)
}

const handleReopenDropbox = () => {
  handleOpenDropbox().catch((err: any) => message.error(err?.message || '打开 Dropbox 授权页失败'))
}

const handleOpenOneDrive = async () => {
  loginLoading.value = false
  const clientId = (onedriveClientId.value || localStorage.getItem('onedrive_client_id') || ONEDRIVE_CLIENT_ID).trim()
  if (!clientId) {
    message.warning('请先在 src/onedrive/auth.ts 填写 ONEDRIVE_CLIENT_ID')
    return
  }
  onedriveClientId.value = clientId
  localStorage.setItem('onedrive_client_id', clientId)
  onedriveVerifier.value = createOneDrivePkceVerifier()
  const authUrl = await buildOneDriveAuthUrl(clientId, onedriveVerifier.value)
  if (disposed || !loginVisible.value) return
  onedriveAuthUrl.value = authUrl
  window.Electron.shell.openExternal(authUrl)
}

const handleReopenOneDrive = () => {
  handleOpenOneDrive().catch((err: any) => message.error(err?.message || '打开 OneDrive 授权页失败'))
}

const handleOpenBox = async () => {
  loginLoading.value = false
  const clientId = (boxClientId.value || localStorage.getItem('box_client_id') || BOX_CLIENT_ID).trim()
  if (!clientId) {
    message.warning('请先在 src/box/auth.ts 填写 BOX_CLIENT_ID')
    return
  }
  boxClientId.value = clientId
  localStorage.setItem('box_client_id', clientId)
  boxVerifier.value = createBoxPkceVerifier()
  const authUrl = await buildBoxAuthUrl(clientId, boxVerifier.value)
  if (disposed || !loginVisible.value) return
  boxAuthUrl.value = authUrl
  window.Electron.shell.openExternal(authUrl)
}

const handleReopenBox = () => {
  handleOpenBox().catch((err: any) => message.error(err?.message || '打开 Box 授权页失败'))
}

const handleOpenGoogle = async () => {
  loginLoading.value = false
  const clientId = GOOGLE_CLIENT_ID.trim()
  if (!clientId) {
    message.warning('请先配置 GOOGLE_CLIENT_ID')
    return
  }
  if (!GOOGLE_CLIENT_SECRET.trim()) {
    message.warning('请先配置 GOOGLE_CLIENT_SECRET')
    return
  }
  const redirectUri = await window.Electron?.ipcRenderer?.invoke?.('GoogleOAuth:StartLoopback')
  if (disposed || !loginVisible.value) return
  if (typeof redirectUri !== 'string' || !redirectUri.startsWith('http://127.0.0.1:')) {
    message.error('Google Drive 本机授权回调启动失败')
    return
  }
  googleClientId.value = clientId
  googleRedirectUri.value = redirectUri
  googleVerifier.value = createGooglePkceVerifier()
  googleState.value = crypto.randomUUID()
  const authUrl = await buildGoogleAuthUrl(clientId, googleVerifier.value, redirectUri, googleState.value)
  if (!disposed && loginVisible.value) window.Electron.shell.openExternal(authUrl)
}

const handleReopenGoogle = () => {
  handleOpenGoogle().catch((err: any) => message.error(err?.message || '打开 Google 授权页失败'))
}

const submitCloud123Code = async () => {
  if (cloud123Loading.value) return
  if (!cloud123Code.value.trim()) {
    message.error(t('login.authCodeMissing'))
    return
  }
  cloud123Loading.value = true
  try {
    const token = await exchangeCloud123CodeForToken(cloud123Code.value.trim())
    if (token) {
      await saveLogin(token, true)
      loginVisible.value = false
    }
  } catch (error) {
    console.error('123网盘登录失败:', error)
    message.error(`123 ${t('login.loginFailed')}`)
  } finally {
    cloud123Loading.value = false
  }
}

const submitBaiduCode = async () => {
  if (baiduLoading.value) return
  if (!baiduCode.value.trim()) {
    message.error(t('login.authCodeMissing'))
    return
  }
  baiduLoading.value = true
  try {
    const token = await exchangeBaiduCodeForToken(baiduCode.value.trim())
    if (token) {
      await saveLogin(token, true)
      loginVisible.value = false
    }
  } catch (error) {
    console.error('百度网盘登录失败:', error)
    message.error(`百度网盘 ${t('login.loginFailed')}`)
  } finally {
    baiduLoading.value = false
  }
}

const submitDropboxCode = async (code: string) => {
  if (dropboxLoading.value) return
  const appKey = dropboxAppKey.value.trim()
  if (!appKey || !dropboxVerifier.value) {
    message.error(`Dropbox ${t('login.authExpired')}`)
    return
  }
  dropboxLoading.value = true
  try {
    const token = await exchangeDropboxCodeForToken(code, appKey, dropboxVerifier.value)
    if (token) {
      await saveLogin(token, true)
      loginVisible.value = false
    }
  } catch (error) {
    console.error('Dropbox 登录失败:', error)
    message.error(`Dropbox ${t('login.loginFailed')}`)
  } finally {
    dropboxLoading.value = false
  }
}

const submitOneDriveCode = async (code: string) => {
  if (onedriveLoading.value) return
  const clientId = onedriveClientId.value.trim()
  if (!clientId || !onedriveVerifier.value) {
    message.error(`OneDrive ${t('login.authExpired')}`)
    return
  }
  onedriveLoading.value = true
  try {
    const token = await exchangeOneDriveCodeForToken(code, clientId, onedriveVerifier.value)
    if (token) {
      await saveLogin(token, true)
      loginVisible.value = false
    }
  } catch (error) {
    console.error('OneDrive 登录失败:', error)
    message.error(`OneDrive ${t('login.loginFailed')}`)
  } finally {
    onedriveLoading.value = false
  }
}

const submitBoxCode = async (code: string) => {
  if (boxLoading.value) return
  const clientId = boxClientId.value.trim()
  if (!clientId || !boxVerifier.value) {
    message.error(`Box ${t('login.authExpired')}`)
    return
  }
  boxLoading.value = true
  try {
    const token = await exchangeBoxCodeForToken(code, clientId, boxVerifier.value)
    if (token) {
      await saveLogin(token, true)
      loginVisible.value = false
    }
  } catch (error) {
    console.error('Box 登录失败:', error)
    message.error(`Box ${t('login.loginFailed')}`)
  } finally {
    boxLoading.value = false
  }
}

const submitGoogleCode = async (code: string) => {
  if (googleLoading.value || !googleClientId.value || !googleVerifier.value || !googleRedirectUri.value) return
  googleLoading.value = true
  try {
    const token = await exchangeGoogleCodeForToken(code, googleClientId.value, googleVerifier.value, googleRedirectUri.value)
    if (token) {
      await saveLogin(token, true)
      loginVisible.value = false
    }
  } catch (error) {
    console.error('Google Drive 登录失败:', error)
    message.error(`Google Drive ${t('login.loginFailed')}`)
  } finally {
    googleState.value = ''
    googleVerifier.value = ''
    googleRedirectUri.value = ''
    googleLoading.value = false
  }
}

const submitPikPakLogin = async () => {
  if (pikpakLoading.value) return
  const username = pikpakUsername.value.trim()
  if (!username || !pikpakPassword.value) {
    message.error(`PikPak ${t('login.enterAccountPassword')}`)
    return
  }
  pikpakLoading.value = true
  try {
    const token = await loginPikPak(username, pikpakPassword.value)
    await saveLogin(token, true)
    loginVisible.value = false
  } catch (err: any) {
    message.error(err?.message || `PikPak ${t('login.loginFailed')}`)
  } finally {
    pikpakLoading.value = false
  }
}

const submitCloud139Login = async () => {
  if (cloud139Loading.value) return
  if (!cloud139Authorization.value.trim()) {
    message.error('请输入 139 云盘 Authorization')
    return
  }
  cloud139Loading.value = true
  try {
    const token = normalizeCloud139Token(cloud139Authorization.value.trim())
    await saveLogin(token, true)
    loginVisible.value = false
  } catch (err: any) {
    message.error(err?.message || `139 云盘 ${t('login.loginFailed')}`)
  } finally {
    cloud139Loading.value = false
  }
}

const sendGuangyaSmsCode = async () => {
  if (guangyaLoading.value) return
  const phone = guangyaPhone.value.trim()
  if (!phone) {
    message.error('请输入光鸭云盘手机号，例如 +86 13800138000')
    return
  }
  guangyaLoading.value = true
  try {
    guangyaDeviceId.value = guangyaDeviceId.value || generateGuangyaDid()
    guangyaSmsState.value = await requestGuangyaSmsCode(phone, guangyaDeviceId.value)
    message.success(t('login.smsSent'))
  } catch (err: any) {
    message.error(err?.message || t('login.loginFailed'))
  } finally {
    guangyaLoading.value = false
  }
}

const submitGuangyaLogin = async () => {
  if (guangyaLoading.value) return
  if (!guangyaSmsState.value) {
    message.error(t('login.sendSmsFirst'))
    return
  }
  const code = guangyaCode.value.trim()
  if (!code) {
    message.error(t('login.enterSmsCode'))
    return
  }
  guangyaLoading.value = true
  try {
    const token = await submitGuangyaSmsCode(guangyaSmsState.value, code, guangyaDeviceId.value)
    await saveLogin(token, true)
    loginVisible.value = false
  } catch (err: any) {
    message.error(err?.message || `光鸭云盘 ${t('login.loginFailed')}`)
  } finally {
    guangyaLoading.value = false
  }
}

const clearCloud189Timer = () => {
  if (cloud189Timer) {
    clearTimeout(cloud189Timer)
    cloud189Timer = null
  }
}

const handleOpen189 = async () => {
  clearOpenTimers()
  clearCloud189Timer()
  if (cloud189Loading.value) return
  loginLoading.value = true
  cloud189Loading.value = true
  cloud189QrStatusType.value = 'info'
  cloud189Tips.value = t('login.gettingQr')
  cloud189QrUrl.value = ''
  cloud189QrState.value = null
  try {
    const state = await requestCloud189QrCode()
    cloud189QrState.value = state
    cloud189QrUrl.value = state.qrUrl
    cloud189Tips.value = t('login.scanWithCloud189')
    loginLoading.value = false
    pollCloud189Status()
  } catch (err: any) {
    cloud189QrStatusType.value = 'error'
    cloud189Tips.value = err?.message || t('login.loginFailed')
    message.error(cloud189Tips.value)
    loginLoading.value = false
  } finally {
    cloud189Loading.value = false
  }
}

const pollCloud189Status = async () => {
  if (loginProvider.value !== '189' || !loginVisible.value || !cloud189QrState.value) return
  if (cloud189Polling) return
  cloud189Polling = true
  const state = cloud189QrState.value
  try {
    const result = await pollCloud189QrLogin(state)
    if (cloud189QrState.value !== state) return
    if (result.status === 'success' && result.token) {
      clearCloud189Timer()
      cloud189QrStatusType.value = 'success'
      cloud189Tips.value = t('login.scanSuccessSigningIn')
      await saveLogin(result.token, true)
      loginVisible.value = false
      return
    }
    if (result.status === 'expired' || result.status === 'failed') {
      clearCloud189Timer()
      cloud189QrStatusType.value = result.status === 'expired' ? 'warning' : 'error'
      cloud189Tips.value = result.message
      return
    }
    cloud189QrStatusType.value = 'info'
    cloud189Tips.value = result.message || t('login.scanWithCloud189')
    cloud189Timer = setTimeout(pollCloud189Status, 1500)
  } catch (err: any) {
    cloud189QrStatusType.value = 'error'
    cloud189Tips.value = err?.message || t('login.loginFailed')
    cloud189Timer = setTimeout(pollCloud189Status, 2000)
  } finally {
    cloud189Polling = false
  }
}

const clearQuarkTimer = () => {
  if (quarkTimer) {
    clearTimeout(quarkTimer)
    quarkTimer = null
  }
}

const handleOpenQuark = async () => {
  clearOpenTimers()
  clearQuarkTimer()
  if (quarkLoading.value) return
  loginLoading.value = true
  quarkLoading.value = true
  quarkQrImageUrl.value = ''
  quarkQrToken.value = ''
  quarkQrStatusType.value = 'info'
  quarkTips.value = t('login.gettingQr')
  try {
    const qr = await requestQuarkQrCode()
    quarkQrToken.value = qr.token
    quarkQrImageUrl.value = qr.qrImageUrl
    quarkTips.value = t('login.scanWithQuark')
    loginLoading.value = false
    quarkLoading.value = false
    pollQuarkStatus()
  } catch (err: any) {
    quarkQrStatusType.value = 'error'
    quarkTips.value = err?.message || t('login.loginFailed')
    message.error(quarkTips.value)
    loginLoading.value = false
    quarkLoading.value = false
  }
}

const pollQuarkStatus = async () => {
  if (loginProvider.value !== 'quark' || !loginVisible.value || !quarkQrToken.value) return
  if (quarkPolling) return
  quarkPolling = true
  const pollingToken = quarkQrToken.value
  try {
    const status = await pollQuarkQrStatus(pollingToken)
    if (quarkQrToken.value !== pollingToken) return
    if (status.status === 'confirmed') {
      clearQuarkTimer()
      quarkQrToken.value = ''
      quarkLoading.value = true
      quarkQrStatusType.value = 'success'
      quarkTips.value = t('login.scanSuccessSigningIn')
      try {
        const token = await completeQuarkQrLogin(status.serviceTicket)
        await saveLogin(token, true)
        loginVisible.value = false
      } catch (err: any) {
        quarkQrStatusType.value = 'error'
        quarkTips.value = err?.message || t('login.loginFailed')
        message.error(quarkTips.value)
      }
      return
    }
    if (status.status === 'expired') {
      clearQuarkTimer()
      quarkQrStatusType.value = 'warning'
      quarkTips.value = status.message || t('login.qrExpired')
      return
    }
    if (status.status === 'failed') {
      clearQuarkTimer()
      quarkQrStatusType.value = 'error'
      quarkTips.value = status.message || `夸克 ${t('login.loginFailed')}`
      return
    }
    quarkQrStatusType.value = 'info'
    quarkTips.value = status.message || t('login.scanWithQuark')
    quarkTimer = setTimeout(pollQuarkStatus, 1500)
  } catch (err: any) {
    if (quarkQrToken.value !== pollingToken) return
    quarkQrStatusType.value = 'error'
    quarkTips.value = err?.message || t('login.loginFailed')
    if (loginProvider.value === 'quark' && loginVisible.value && quarkQrToken.value) {
      quarkTimer = setTimeout(pollQuarkStatus, 2000)
    }
  } finally {
    quarkPolling = false
    quarkLoading.value = false
  }
}

const handleOpen115 = async () => {
  if (!drive115ClientId.value.trim() && !DRIVE115_APP_ID) {
    loginLoading.value = false
    drive115Tips.value = t('login.clientId')
    return
  }
  loginLoading.value = true
  drive115Loading.value = true
  try {
    const { codeVerifier, codeChallenge } = await generatePkce()
    drive115Verifier.value = codeVerifier
    const resp = await requestDeviceCode(drive115ClientId.value.trim(), codeChallenge, 'sha256')
    if (resp.error) {
      drive115Tips.value = resp.error
      loginLoading.value = false
      drive115Loading.value = false
      return
    }
    drive115Uid.value = resp.uid || ''
    drive115Time.value = resp.time || ''
    drive115Sign.value = resp.sign || ''
    qrCodeUrl.value = buildQrImageUrl(resp.qrcode || '')
    qrCodeStatusType.value = 'info'
    drive115Tips.value = t('login.scanWith115')
    loginLoading.value = false
    drive115Loading.value = false
    drive115Polling.value = true
    poll115Status()
  } catch (err: any) {
    drive115Tips.value = err?.message || t('login.loginFailed')
    loginLoading.value = false
    drive115Loading.value = false
  }
}

const poll115Status = async () => {
  if (!drive115Polling.value) return
  if (!drive115Uid.value || !drive115Time.value || !drive115Sign.value) return
  try {
    const status = await pollDeviceStatus(drive115Uid.value, drive115Time.value, drive115Sign.value)
    if (status.error) {
      drive115Tips.value = status.error
    } else if (status.state === 0) {
      drive115Tips.value = t('login.qrExpired')
      drive115Polling.value = false
      return
    } else if (status.status === 1) {
      drive115Tips.value = status.msg || t('login.scanSuccessSigningIn')
    } else if (status.status === 2) {
      drive115Tips.value = status.msg || t('login.scanSuccessSigningIn')
      drive115Polling.value = false
      const tokenResp = await exchangeDeviceCode(drive115Uid.value, drive115Verifier.value)
      if (tokenResp.error) {
        drive115Tips.value = tokenResp.error
        return
      }
      const token = normalize115Token(tokenResp.data)
      if (!token) {
        drive115Tips.value = t('login.loginFailed')
        return
      }
      await refreshDrive115UserInfo(token)
      await saveLogin(token, true)
      loginVisible.value = false
      return
    }
  } catch (err: any) {
    drive115Tips.value = err?.message || t('login.loginFailed')
  }
  drive115Timer = setTimeout(poll115Status, 1500)
}

const handleRefresh115Qr = () => {
  if (drive115Loading.value) return
  handleOpen115()
}

const handleStorageChange = (val: any) => {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem('drive115_client_id', String(val || ''))
  }
}

const loginStepFirst = async (msg: string) => {
  let data: { bizExt?: string; code?: string } = {}
  try {
    data = JSON.parse(msg)
  } catch {
  }
  if (!data.bizExt && !data.code) {
    refreshStepTips('error', 1)
    DebugLog.mSaveDanger('登录失败：' + msg)
    return
  }
  const resultPromise = data.code
    ? AliUser.LoginByOAuthCode(data.code).then((resp: any) => {
      if (!AliHttp.IsSuccess(resp.code)) throw new Error(resp.body?.message || resp.body?.code || `OAuth code exchange failed: ${resp.code}`)
      const body = resp.body?.token_info || resp.body?.tokenInfo || resp.body
      return {
        accessToken: body.accessToken || body.access_token,
        refreshToken: body.refreshToken || body.refresh_token,
        tokenType: body.tokenType || body.token_type,
        expiresIn: body.expiresIn || body.expires_in,
        userId: body.userId || body.user_id,
        userName: body.userName || body.user_name,
        avatar: body.avatar,
        nickName: body.nickName || body.nick_name,
        defaultSboxDriveId: body.defaultSboxDriveId || body.default_sbox_drive_id,
        role: body.role,
        status: body.status,
        expireTime: body.expireTime || body.expire_time,
        state: body.state,
        dataPinSetup: body.dataPinSetup || body.data_pin_setup,
        isFirstLogin: body.isFirstLogin || body.is_first_login,
        needRpVerify: body.needRpVerify || body.need_rp_verify
      }
    })
    : readData(data.bizExt || '').then((jsonstr: string) => JSON.parse(jsonstr).pds_login_result)
  resultPromise.then((result: any) => {
    try {
      const deviceId = getUuid(result.userId.toString(), 5)
      const { signature } = GetSignature(0, result.userId.toString(), deviceId)
      const token: ITokenInfo = {
        tokenfrom: 'aliyun',
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        session_expires_in: 0,
        open_api_token_type: '',
        open_api_access_token: '',
        open_api_refresh_token: '',
        open_api_expires_in: 0,
        expires_in: result.expiresIn,
        token_type: result.tokenType,
        user_id: result.userId,
        user_name: result.userName,
        avatar: result.avatar,
        nick_name: result.nickName,
        default_drive_id: '',
        default_sbox_drive_id: result.defaultSboxDriveId,
        resource_drive_id: '',
        backup_drive_id: '',
        sbox_drive_id: '',
        role: result.role,
        status: result.status,
        expire_time: result.expireTime,
        state: result.state,
        pin_setup: result.dataPinSetup,
        is_first_login: result.isFirstLogin,
        need_rp_verify: result.needRpVerify,
        name: '',
        spu_id: '',
        is_expires: false,
        used_size: 0,
        total_size: 0,
        free_size: 0,
        space_expire: false,
        spaceinfo: '',
        pic_drive_id: '',
        vipname: '',
        vipexpire: '',
        vipIcon: '',
        device_id: deviceId,
        signature: signature,
        signInfo: {
          signMon: -1,
          signDay: -1
        }
      }
      loginToken.value = token
      if (settingStore.uiEnableOpenApiType === 'custom') {
        client_id.value = settingStore.uiOpenApiClientId.trim()
        client_secret.value = settingStore.uiOpenApiClientSecret.trim()
      } else {
        client_id.value = ALIYUN_APP_ID
        client_secret.value = ALIYUN_APP_SECRET
      }
      refreshStepTips('process', 2)
      loginStepSecond(token)
    } catch (err: any) {
      refreshStepTips('error', 1)
      message.error(t('login.loginFailed') + '：' + (err.message || t('login.parseFailed')))
      DebugLog.mSaveDanger('登录失败：' + (err.message || '解析失败'), JSON.stringify(err))
    }
  }).catch((err: any) => {
    refreshStepTips('error', 1)
    message.error(t('login.loginFailed') + '：' + (err?.message || t('login.retry')))
    DebugLog.mSaveDanger('Aliyun login result read failed', err)
  })
}

const loginStepSecond = async (token: ITokenInfo) => {
  if (!token) {
    refreshStepTips('process', 1)
    message.error(t('login.retryLogin'))
    return
  }
  loginLoading.value = false
  clearInterval(intervalId.value)
  let codeUrl = ''
  try {
    codeUrl = await AliUser.OpenApiQrCodeUrl(client_id.value, client_secret.value, 250, 250)
  } catch (err: any) {
    refreshQrCodeStatus('', 'error', t('login.loginFailed'))
    refreshStepTips('error', 2)
    DebugLog.mSaveDanger('Aliyun second QR code request failed', err)
    return
  }
  if (!codeUrl) {
    refreshQrCodeStatus('', 'error', t('login.loginFailed'))
    refreshStepTips('error', 2)
    handlerChangeType()
    return
  }
  refreshQrCodeStatus(codeUrl, 'info', t('login.waitingScan'))
  refreshStepTips('process', 2)
  // 监听状态
  intervalId.value = setInterval(async () => {
    try {
      const result = await AliUser.OpenApiQrCodeStatus(codeUrl)
      if (!result || typeof result !== 'object') return
      const { authCode, statusCode, statusType, statusTips } = result
    if (!statusCode) {
      refreshQrCodeStatus()
      clearInterval(intervalId.value)
      return
    }
    refreshQrCodeStatus(codeUrl, statusType, statusTips)
    if (statusCode === 'QRCodeExpired') {
      clearInterval(intervalId.value)
      refreshQrCodeStatus()
      return
    }
      if (authCode && statusCode === 'LoginSuccess') {
      // 构造请求体
      await AliUser.OpenApiLoginByAuthCode(token, client_id.value, client_secret.value, authCode)
      loginSuccess(token)
        clearInterval(intervalId.value)
      }
    } catch (err: any) {
      clearInterval(intervalId.value)
      refreshQrCodeStatus('', 'error', t('login.loginFailed'))
      DebugLog.mSaveWarning('Aliyun second QR code status failed', err)
    }
  }, 1500)
}

const handlerChangeType = () => {
  clearInterval(intervalId.value)
  refreshQrCodeStatus()
  if (settingStore.uiEnableOpenApiType === 'custom') {
    Modal.open({
      title: t('login.enterDeveloperAccount'),
      bodyStyle: { minWidth: '340px' },
      content: () => h(Space, { direction: 'vertical' }, () => [
        h(Input, {
          type: 'text',
          tabindex: '-1',
          allowClear: true,
          modelValue: settingStore.uiOpenApiClientId.trim(),
          style: { width: '340px' },
          placeholder: t('login.clientId'),
          'onUpdate:modelValue': (e) => cb({ uiOpenApiClientId: e.trim() })
        }),
        h(Input, {
          type: 'text',
          tabindex: '-1',
          allowClear: true,
          modelValue: settingStore.uiOpenApiClientSecret.trim(),
          style: { width: '340px' },
          placeholder: t('login.clientSecret'),
          'onUpdate:modelValue': (e) => cb({ uiOpenApiClientSecret: e.trim() })
        })
      ]),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onBeforeOk: async (e: any) => {
        if (settingStore.uiOpenApiClientId && settingStore.uiOpenApiClientSecret) {
          client_id.value = settingStore.uiOpenApiClientId
          client_secret.value = settingStore.uiOpenApiClientSecret
          handleRefreshQrCodeUrl()
          return true
        } else {
          message.error(t('login.enterDeveloperAccountWarn'))
          return false
        }
      }
    })
  } else {
    client_id.value = ALIYUN_APP_ID
    client_secret.value = ALIYUN_APP_SECRET
    handleRefreshQrCodeUrl()
  }
}

const handleRefreshQrCodeUrl = () => {
  refreshQrCodeStatus()
  clearInterval(intervalId.value)
  loginStepSecond(loginToken.value!!)
}

const loginSuccess = (token: ITokenInfo) => {
  saveLogin(token, true)
    .then(() => {
      if (window.WebClearCookies) {
        window.WebClearCookies({
          origin: 'https://auth.aliyundrive.com',
          storages: ['cookies', 'localstorage']
        })
      }
      refreshStepTips('process', 3)
      refreshQrCodeStatus()
      loginVisible.value = false
    })
    .catch(() => {
      loginVisible.value = false
      if (window.WebClearCookies) {
        window.WebClearCookies({
          origin: 'https://auth.aliyundrive.com',
          storages: ['cookies', 'localstorage']
        })
      }
      refreshQrCodeStatus()
    })
}

</script>

<template>
  <SourceFormSurface :embedded="embedded" :visible="loginVisible" :title="embedded ? undefined : t('login.driveAccount')" :closable="!embedded" modal-class="userloginmodal" @update:visible="loginVisible = $event" @before-open="handleModalOpen" @close="handleClose">
    <div class="modalbody login-modal-body" :class="{ 'login-embedded': embedded }">
      <aside v-if="!embedded" class="login-provider-sidebar">
        <button
          v-for="provider in loginProviders"
          :key="provider"
          class="login-provider-side-item"
          :class="{ active: loginProvider === provider }"
          :title="getLoginProviderMeta(provider).label"
          @click="loginProvider = provider"
        >
          <span v-if="getLoginProviderMeta(provider).icon" class="login-provider-icon">
            <img :src="getLoginProviderMeta(provider).icon" :alt="getLoginProviderMeta(provider).label" />
          </span>
          <span v-else class="login-provider-fallback">{{ getLoginProviderMeta(provider).label.slice(0, 1) }}</span>
          <span class="login-provider-side-label">{{ getLoginProviderMeta(provider).label }}</span>
        </button>
      </aside>

      <section class="login-provider-content">
        <div class="login-provider-heading" :title="activeLoginProviderMeta.label">
          <span v-if="activeLoginProviderMeta.icon" class="login-provider-heading-icon">
            <img :src="activeLoginProviderMeta.icon" :alt="activeLoginProviderMeta.label" />
          </span>
          <span>{{ activeLoginProviderMeta.label }}</span>
        </div>

        <div v-show="loginProvider === 'aliyun'">
          <a-steps v-model:current="loginCur" :status="loginStatus">
            <a-step :description="t('login.scanOrAccount')">{{ t('login.firstScan') }}</a-step>
            <a-step :description="t('login.mobileAuth')">{{ t('login.secondScan') }}</a-step>
          </a-steps>
          <div id='logindiv'>
            <div class='logincontent'>
            <div id="loginframediv" class="loginframe">
              <a-spin class="loading" :size="32" v-if='loginLoading' :tip="t('common.loading')" />
              <Webview id="loginiframe" v-show='!loginLoading && loginCur === 1'
                       plugins nodeintegration disablewebsecurity
                       webpreferences="allowRunningInsecureContent"
                       src="about:blank" style="width: 100%; height: 400px; border: none; overflow: hidden" />
              <div class="qrcodeframe" v-if="loginCur === 2 && !loginLoading">
                <a-image
                  width='250'
                  height='250'
                  :hide-footer='true'
                  :preview='false'
                  :show-loader="true"
                  @click="handleRefreshQrCodeUrl"
                  style="display:inline-block;"
                  :src="qrCodeUrl">
                </a-image>
                <a-alert banner center :show-icon="false" :type='qrCodeStatusType'>
                  {{ qrCodeStatusTips }}
                </a-alert>
              </div>
            </div>
          </div>
        </div>
        </div>

      <template v-if="loginProvider !== 'aliyun'">
      <div v-if="loginProvider === 'cloud123'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="browser-login-hint">
              <p style="margin: 32px 0 8px; font-size: 15px;">{{ t('login.browserOpenedPrefix') }} 123 网盘{{ t('login.authPageSuffix') }}</p>
              <p style="color: var(--color-text-3); font-size: 13px;">{{ t('login.browserContinue') }}</p>
              <a-button style="margin-top: 16px;" @click="handleReopenCloud123">{{ t('login.reopenBrowser') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === '115'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div id="loginframediv" class="loginframe">
              <a-spin class="loading" :size="32" v-if='loginLoading' :tip="t('common.loading')" />
              <div class="qrcodeframe" v-if="!loginLoading">
                <a-image
                  width='250'
                  height='250'
                  :hide-footer='true'
                  :preview='false'
                  :show-loader="true"
                  @click="handleRefresh115Qr"
                  style="display:inline-block;"
                  :src="qrCodeUrl">
                </a-image>
                <a-alert banner center :show-icon="false" :type="qrCodeStatusType || 'info'">
                  {{ drive115Tips }}
                </a-alert>
              </div>
            </div>
            <div class="cloud123-code">
              <a-input v-model="drive115ClientId" placeholder="App ID（client_id）" allow-clear
                       @change="handleStorageChange" />
              <a-button type="primary" :loading="drive115Loading" @click="handleRefresh115Qr">{{ t('login.refreshQrCode') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === '139'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="pikpak-login-form">
              <a-textarea v-model="cloud139Authorization" placeholder="粘贴 139 云盘 Authorization（Basic 后面的完整值也可以）" :auto-size="{ minRows: 4, maxRows: 6 }" allow-clear />
              <a-button type="primary" long :loading="cloud139Loading" @click="submitCloud139Login">登录 139 云盘</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === '189'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div id="loginframediv" class="loginframe">
              <a-spin class="loading" :size="32" v-if='loginLoading' :tip="t('common.loading')" />
              <div class="qrcodeframe" v-if="!loginLoading">
                <div class="cloud189-qrcode-wrap">
                  <AntQRCode :value="cloud189QrUrl || 'cloud189'" :size="250" color="#000" bg-color="#fff" />
                </div>
                <a-alert banner center :show-icon="false" :type="cloud189QrStatusType">
                  {{ cloud189Tips }}
                </a-alert>
              </div>
            </div>
            <div class="quark-login-toolbar" v-if="!loginLoading">
              <a-button type="primary" :loading="cloud189Loading" @click="handleOpen189">{{ t('login.refreshQrCode') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'guangya'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="pikpak-login-form">
              <a-input v-model="guangyaPhone" placeholder="手机号，例如 +86 13800138000" allow-clear />
              <a-input v-model="guangyaCode" :placeholder="t('login.smsCode')" allow-clear @press-enter="submitGuangyaLogin" />
              <a-space direction="vertical" fill>
                <a-button type="outline" long :loading="guangyaLoading" @click="sendGuangyaSmsCode">{{ guangyaSmsState ? t('login.resendSmsCode') : t('login.sendSmsCode') }}</a-button>
                <a-button type="primary" long :loading="guangyaLoading" @click="submitGuangyaLogin">登录光鸭云盘</a-button>
              </a-space>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'baidu'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="browser-login-hint">
              <p style="margin: 32px 0 8px; font-size: 15px;">{{ t('login.browserOpenedPrefix') }}百度网盘{{ t('login.authPageSuffix') }}</p>
              <p style="color: var(--color-text-3); font-size: 13px;">{{ t('login.browserContinue') }}</p>
              <a-button style="margin-top: 16px;" @click="handleReopenBaidu">{{ t('login.reopenBrowser') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'pikpak'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="pikpak-login-form">
              <a-input v-model="pikpakUsername" placeholder="PikPak 邮箱 / 手机号 / 用户名" allow-clear />
              <a-input-password v-model="pikpakPassword" placeholder="PikPak 密码" allow-clear @press-enter="submitPikPakLogin" />
              <a-button type="primary" long :loading="pikpakLoading" @click="submitPikPakLogin">登录 PikPak</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'quark'">
        <div id='logindiv'>
          <div class='logincontent quark-logincontent'>
            <a-spin class="loading" :size="32" v-if='loginLoading' :tip="t('common.loading')" />
            <div class="qrcodeframe" v-if="!loginLoading">
              <a-image
                width='250'
                height='250'
                :hide-footer='true'
                :preview='false'
                :show-loader="true"
                @click="handleOpenQuark"
                style="display:inline-block;"
                :src="quarkQrImageUrl">
              </a-image>
              <a-alert banner center :show-icon="false" :type="quarkQrStatusType">
                {{ quarkTips }}
              </a-alert>
            </div>
            <div class="quark-login-toolbar" v-if="!loginLoading">
              <a-button type="primary" :loading="quarkLoading" @click="handleOpenQuark">{{ t('login.refreshQrCode') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'dropbox'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="browser-login-hint">
              <p style="margin: 32px 0 8px; font-size: 15px;">{{ t('login.browserOpenedPrefix') }} Dropbox {{ t('login.authPageSuffix') }}</p>
              <p style="color: var(--color-text-3); font-size: 13px;">{{ t('login.browserContinue') }}</p>
              <a-button style="margin-top: 16px;" :loading="dropboxLoading" @click="handleReopenDropbox">{{ t('login.reopenBrowser') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'onedrive'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="browser-login-hint">
              <p style="margin: 32px 0 8px; font-size: 15px;">{{ t('login.browserOpenedPrefix') }} OneDrive {{ t('login.authPageSuffix') }}</p>
              <p style="color: var(--color-text-3); font-size: 13px;">{{ t('login.browserContinue') }}</p>
              <a-button style="margin-top: 16px;" :loading="onedriveLoading" @click="handleReopenOneDrive">{{ t('login.reopenBrowser') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'box'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="browser-login-hint">
              <p style="margin: 32px 0 8px; font-size: 15px;">{{ t('login.browserOpenedPrefix') }} Box {{ t('login.authPageSuffix') }}</p>
              <p style="color: var(--color-text-3); font-size: 13px;">{{ t('login.browserContinue') }}</p>
              <a-button style="margin-top: 16px;" :loading="boxLoading" @click="handleReopenBox">{{ t('login.reopenBrowser') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'google'">
        <div id='logindiv'><div class='logincontent'><div class="browser-login-hint">
          <p style="margin: 32px 0 8px; font-size: 15px;">{{ t('login.browserOpenedPrefix') }} Google Drive {{ t('login.authPageSuffix') }}</p>
          <p style="color: var(--color-text-3); font-size: 13px;">{{ t('login.browserContinue') }}</p>
          <a-button style="margin-top: 16px;" :loading="googleLoading" @click="handleReopenGoogle">{{ t('login.reopenBrowser') }}</a-button>
        </div></div></div>
      </div>

      <div v-else-if="loginProvider === 'webdav' || loginProvider === 'alist'">
        <div id='logindiv'>
          <div class='logincontent'>
            <form class="remote-drive-login-form" :class="{ 'remote-drive-embedded': embedded }" @submit.prevent="submitRemoteDrive">
              <label class="remote-field"><span>{{ t('mediaServer.name') }}</span><a-input v-model="remoteDriveForm.name" :placeholder="t('mediaServer.name')" :disabled="remoteDriveLoading" allow-clear /></label>
              <label class="remote-field"><span>{{ t('mediaServer.address') }}</span><a-input v-model="remoteDriveForm.url" :placeholder="loginProvider === 'alist' ? 'http://127.0.0.1:5244' : 'https://example.com/dav'" :disabled="remoteDriveLoading" allow-clear /></label>
              <label class="remote-field"><span>{{ t('mediaServer.username') }}</span><a-input v-model="remoteDriveForm.username" :disabled="remoteDriveLoading" autocomplete="username" allow-clear /></label>
              <label class="remote-field"><span>{{ t('mediaServer.password') }}</span><a-input-password v-model="remoteDriveForm.password" :disabled="remoteDriveLoading" autocomplete="current-password" allow-clear /></label>
              <label class="remote-field"><span>{{ t('mediaServer.path') }}</span><a-input v-model="remoteDriveForm.rootPath" placeholder="/" :disabled="remoteDriveLoading" allow-clear /></label>
              <a-button html-type="submit" type="primary" :loading="remoteDriveLoading">{{ t('mediaServer.connect') }}</a-button>
            </form>
          </div>
        </div>
      </div>
      </template>
      </section>
    </div>
  </SourceFormSurface>
</template>
<style lang="less" scoped>
#logindiv {
  overflow: hidden;
  text-align: center;

  .logincontent {
    position: relative;
    width: 348px;
    height: 367px;
    min-height: 400px;
    margin: 0 auto;
    overflow: hidden;
    text-align: center;

    .loginframe {
      overflow: hidden;
      position: relative;
      width: 100%;
      height: 100%
    }

    .qrcodeframe {
      border-radius: 10px;
      padding: 5px;
      box-shadow: grey 0 0 10px;
      margin: 40px 15px 15px 15px;
    }

    .cloud189-qrcode-wrap {
      display: flex;
      justify-content: center;
    }

    .loading {
      min-height: 60px;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    }
  }
}

.userloginmodal .arco-modal-body {
  min-height: 440px;
  padding: 0 16px 16px 16px !important;
}

.login-modal-body {
  display: flex;
  width: 540px;
  height: 458px;
  overflow: hidden;
}

.login-provider-sidebar {
  flex: 0 0 148px;
  height: 100%;
  padding: 8px 8px 8px 0;
  overflow-y: auto;
  overflow-x: hidden;
  border-right: 1px solid var(--color-border-2);
}

.login-provider-sidebar::-webkit-scrollbar {
  width: 6px;
}

.login-provider-sidebar::-webkit-scrollbar-thumb {
  background: var(--color-fill-3);
  border-radius: 999px;
}

.login-provider-side-item {
  width: 100%;
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  margin-bottom: 3px;
  color: var(--color-text-2);
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s, color 0.15s;
}

.login-provider-side-item:hover {
  color: var(--color-text-1);
  background: var(--color-fill-2);
}

.login-provider-side-item.active {
  color: rgb(var(--primary-6));
  background: rgba(var(--primary-6), 0.12);
  font-weight: 600;
}

.login-provider-side-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
}

.login-provider-content {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 8px 0 0 16px;
  overflow: hidden;
}

.login-provider-tab {
  display: inline-flex;
  align-items: center;
  max-width: 92px;
  gap: 5px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  line-height: 1;
}

.login-provider-icon,
.login-provider-heading-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.login-provider-icon {
  width: 16px;
  height: 16px;
  overflow: hidden;
}

.login-provider-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  color: rgb(var(--primary-6));
  background: rgba(var(--primary-6), 0.12);
  font-size: 10px;
  font-weight: 700;
}

.login-provider-heading-icon {
  width: 22px;
  height: 22px;
  overflow: hidden;
}

.login-provider-icon img,
.login-provider-heading-icon img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  color: transparent;
  font-size: 0;
}

.login-provider-heading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  margin: 0 0 8px;
  gap: 8px;
  color: var(--color-text-1);
  font-size: 14px;
  font-weight: 600;
}

.cloud123-code {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  margin-top: 12px;
}

.cloud123-code .arco-input-wrapper {
  width: 260px;
}

.browser-login-hint {
  text-align: center;
  padding: 16px 8px 0;
}

.pikpak-login-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 300px;
  margin: 64px auto 0;
}

.remote-drive-login-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 300px;
  margin: 28px auto 0;
  text-align: left;
}

.remote-drive-hint {
  margin: 2px 0 4px;
  color: var(--color-text-3);
  font-size: 12px;
  line-height: 1.55;
}

.quark-logincontent {
  height: 430px !important;
  min-height: 430px !important;
}

.quark-login-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0;
}

</style>

<style scoped>
.login-modal-body.login-embedded{width:100%;height:auto;min-height:440px;overflow:visible}
.login-embedded .login-provider-content{padding:0;min-width:0}
.login-embedded .login-provider-heading{display:none}
.login-embedded #logindiv .logincontent{width:100%;max-width:400px;height:auto;min-height:400px}
</style>

<style scoped>
.remote-field{display:grid;grid-template-columns:88px minmax(0,1fr);gap:16px;align-items:center;text-align:right;color:var(--color-text-2);font-size:14px}
.remote-drive-embedded{padding-top:40px!important;width:100%;max-width:400px!important}
.remote-drive-embedded :deep(.arco-input-wrapper){background:transparent;border-radius:4px}
.remote-drive-embedded>.arco-btn{align-self:flex-start;margin-left:104px;min-width:130px}
</style>
