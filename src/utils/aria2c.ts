import { IAliFileResp } from '../aliapi/dirfilelist'

import Aria2 from 'aria2-lib'
import axios from 'axios'
import DownDAL, { IAriaDownProgress, IStateDownFile } from '../down/DownDAL'
import message from './message'
import UserDAL from '../user/userdal'
import { useFootStore, useSettingStore } from '../store'
import DebugLog from './debuglog'
import Config from '../config'
import AliTrash from '../aliapi/trash'

import path from 'path'
import fs from 'fs'
import { getProxyUrl, getRawUrl } from './proxyhelper'
import { isBaiduUser, isDrive115User, isQuarkUser } from '../aliapi/utils'
import { callAriaClient, getAriaAddUriGid, isAriaDuplicateGidError } from './aria2Rpc'
import { buildAriaAddOptions, resolveProviderDownloadSplit, shouldCheckExistingDownloadTarget } from '../down/integration/aria2AddOptions'
import { DRIVE115_DOWN_AGENT } from '../cloud115/constants'
import { QUARK_DOWNLOAD_AGENT } from '../quark/auth'

export const localPwd = 'S4znWTaZYQi3cpRNb'

let Aria2cChangeing: boolean = false
let Aria2EngineLocal: Aria2 | undefined = undefined
let Aria2EngineRemote: Aria2 | undefined = undefined

let IsAria2cOnlineLocal: boolean = false

let Aria2cLocalRelaunchTime = 0

let IsAria2cOnlineRemote: boolean = false

let Aria2cRemoteRetryTime = 0

const ariaErrorLastLog: Record<'local' | 'remote', number> = { local: 0, remote: 0 }

export function bindAriaErrorListener(engine: { on: (event: string, listener: (error?: unknown) => void) => unknown }, ariaState: 'local' | 'remote', onDisconnect: (state: 'local' | 'remote') => void = state => SetAriaOnline(false, state)) {
  engine.on('error', (error?: unknown) => {
    const now = Date.now()
    if (now - ariaErrorLastLog[ariaState] >= 5000) {
      ariaErrorLastLog[ariaState] = now
      const detail = error instanceof Error ? error.message : String(error || 'WebSocket 连接错误')
      DebugLog.mSaveWarning(`Aria2${ariaState === 'local' ? '本地' : '远程'}连接错误`, detail)
    }
    onDisconnect(ariaState)
  })
}

function GetAria() {
  if (useSettingStore().AriaIsLocal) return Aria2EngineLocal
  return Aria2EngineRemote
}

function SetAriaOnline(isOnline: boolean, ariaState: string = '') {
  if (!ariaState) ariaState = useSettingStore().ariaState
  if (ariaState == 'local') {
    IsAria2cOnlineLocal = isOnline
    let ariaInfo = isOnline ? 'Aria ⚯ Local' : 'Aria 已断开'
    useFootStore().mSaveAriaInfo(ariaInfo)
  } else {
    IsAria2cOnlineRemote = isOnline
    let ariaInfo = isOnline ? 'Aria ⚯ ' + (Aria2EngineRemote?.host || '') : 'Aria 已断开'
    useFootStore().mSaveAriaInfo(ariaInfo)
  }
}

function CloseRemote() {
  if (IsAria2cOnlineRemote) {
    IsAria2cOnlineRemote = false
    if (Aria2EngineRemote) {
      try {
        Aria2EngineRemote.call('aria2.forceShutdown').catch(() => {})
      } catch {}
      try {
        Aria2EngineRemote.close()
      } catch {}
      Aria2EngineRemote = undefined
    }
  }
}

export function IsAria2cRemote() {
  return IsAria2cOnlineRemote
}

export async function AriaTest(https: boolean, host: string, port: number, secret: string) {
  const url = (https ? 'https://' : 'http://') + host + ':' + port.toString() + '/jsonrpc'
  return axios
    .post(
      url,
      { method: 'aria2.getGlobalStat', jsonrpc: '2.0', id: 'id' + Date.now(), params: ['token:' + secret] },
      {
        responseType: 'json',
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 4000
      }
    )
    .then(() => {
      return true
    })
    .catch(function(error) {
      if (error.response && error.response.data && error.response.data.error) {
        if (error.response.data.error.message == 'Unauthorized') {
          message.error('连接失败 密码错误 ' + url)
          return false
        }
      }
      if (error.message && error.message.indexOf('timeout of') >= 0) {
        message.error('连接失败 网络连接超时 ' + url)
        return false
      }
      message.error('连接失败 ' + (error.message ? error.message : '') + ' ' + url)
      return false
    })
}

function Sleep(msTime: number) {
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          success: true,
          time: msTime
        }),
      msTime
    )
  )
}


export async function AriaChangeToRemote() {
  if (Aria2cChangeing) return undefined
  Aria2cChangeing = true
  CloseRemote()
  try {
    const settingStore = useSettingStore()
    const host = settingStore.ariaUrl.split(':')[0]
    const port = parseInt(settingStore.ariaUrl.split(':')[1])
    const secret = settingStore.ariaPwd

    const options = { host, port, secure: settingStore.ariaHttps, secret, path: '/jsonrpc' }
    Aria2EngineRemote = new Aria2({ WebSocket: global.WebSocket, fetch: (...args: any[]) => (window.fetch as any)(...args), ...options })
    bindAriaErrorListener(Aria2EngineRemote, 'remote')

    Aria2EngineRemote.on('close', () => {
      if (IsAria2cOnlineRemote && !Aria2cChangeing) {
        Aria2cRemoteRetryTime = 0 // 重置远程重试计数
        if (!settingStore.AriaIsLocal) {
          message.error('Aria2远程连接已断开')
          SetAriaOnline(false, 'remote')
          // 延迟 3 秒后自动重连
          setTimeout(() => {
            if (!IsAria2cOnlineRemote && !useSettingStore().AriaIsLocal) {
              AriaChangeToRemote()
            }
          }, 3000)
        }
      }
    })
    const _remoteNotifyRefresh = () => { AriaGetDowningList().catch(() => {}) }
    Aria2EngineRemote.on('onDownloadStart', _remoteNotifyRefresh)
    Aria2EngineRemote.on('onDownloadComplete', _remoteNotifyRefresh)
    Aria2EngineRemote.on('onDownloadError', _remoteNotifyRefresh)
    Aria2EngineRemote.on('onDownloadStop', _remoteNotifyRefresh)
    Aria2EngineRemote.on('onBtDownloadComplete', _remoteNotifyRefresh)
    await Sleep(500)
    await Aria2EngineRemote.open()
      .then(() => {
        Aria2cRemoteRetryTime = 0
        SetAriaOnline(true, 'remote')
      })
      .catch(() => {
        Aria2cRemoteRetryTime++
        SetAriaOnline(false, 'remote')
      })

    if (!IsAria2cOnlineRemote) {
      const url = host + ':' + port
      if (!settingStore.AriaIsLocal && Aria2cRemoteRetryTime % 10 == 1) message.error('无法连接到远程Aria2 ' + url)
    } else {
      await AriaGlobalSpeed(); await AriaApplyAdvancedOptions()
    }
  } catch (e) {
    SetAriaOnline(false, 'remote')
  }
  Aria2cChangeing = false
  return IsAria2cOnlineRemote
}


export async function AriaChangeToLocal() {
  CloseRemote()
  if (Aria2cLocalRelaunchTime < 5) {
    try {
      let port = 16800
      if (Aria2EngineLocal == undefined) {
        port = window.WebRelaunchAria ? await window.WebRelaunchAria() : 16800
        const options = { host: '127.0.0.1', port, secure: false, secret: localPwd, path: '/jsonrpc' }
        Aria2EngineLocal = new Aria2({ WebSocket: global.WebSocket, fetch: (...args: any[]) => (window.fetch as any)(...args), ...options })
        bindAriaErrorListener(Aria2EngineLocal, 'local')
        Aria2EngineLocal.on('close', () => {
          IsAria2cOnlineLocal = false
          if (useSettingStore().AriaIsLocal) {
            Aria2cLocalRelaunchTime = 0 // 重置重试计数，允许重新连接
            if (Aria2cLocalRelaunchTime < 2) {
              message.error('Aria2本地连接已断开')
            }
            SetAriaOnline(false, 'local')
            // 延迟 2 秒后自动重连，避免频繁重试
            setTimeout(() => {
              if (!IsAria2cOnlineLocal && useSettingStore().AriaIsLocal) {
                AriaChangeToLocal()
              }
            }, 2000)
          }
        })
        const _notifyRefresh = () => { AriaGetDowningList().catch(() => {}) }
        Aria2EngineLocal.on('onDownloadStart', _notifyRefresh)
        Aria2EngineLocal.on('onDownloadComplete', _notifyRefresh)
        Aria2EngineLocal.on('onDownloadError', _notifyRefresh)
        Aria2EngineLocal.on('onDownloadStop', _notifyRefresh)
        Aria2EngineLocal.on('onBtDownloadComplete', _notifyRefresh)
        Aria2EngineLocal.setMaxListeners(0)
      }
      await Sleep(800)
      await Aria2EngineLocal.open()
        .then(() => {
          Aria2cLocalRelaunchTime = 0
          SetAriaOnline(true, 'local')
        })
        .catch(() => {
          SetAriaOnline(false, 'local')
          Aria2cLocalRelaunchTime++
          if (Aria2cLocalRelaunchTime < 2) {
            message.info('正在尝试重启Aria进程中。。。')
          }
        })
      if (!IsAria2cOnlineLocal) {
        const url = `127.0.0.1:${port}`
        if (Aria2cLocalRelaunchTime < 2) message.error('无法连接到本地Aria2 ' + url)
      } else {
        await AriaGlobalSpeed(); await AriaApplyAdvancedOptions()
      }
    } catch (e) {
      SetAriaOnline(false, 'local')
    }
  } else {
    Aria2EngineLocal = undefined
  }
  return true
}


export async function AriaGlobalSpeed() {
  try {
    const settingStore = useSettingStore()
    const limit = settingStore.downGlobalSpeed.toString() + (settingStore.downGlobalSpeedM == 'MB' ? 'M' : 'K')
    await GetAria()?.call('aria2.changeGlobalOption', { 'max-overall-download-limit': limit }).catch((e: any) => {
      if (e && e.message == 'Unauthorized') message.error('Aria2密码错误(密码不要有 ^ 或特殊字符)')
      IsAria2cOnlineLocal = false
    })
  } catch {
    SetAriaOnline(false)
  }
}

export async function AriaApplyAdvancedOptions(): Promise<boolean> {
  const client = GetAria()
  if (!client) return false
  try {
    const settingStore = useSettingStore()
    const btTracker = settingStore.ariaBtTracker.split(/[\r\n,]+/).filter(Boolean).join(',')
    const uploadLimit = `${settingStore.ariaMaxOverallUploadLimit || 0}K`
    const options: Record<string, string> = {
      ...(btTracker ? { 'bt-tracker': btTracker } : {}),
      'max-overall-upload-limit': uploadLimit,
      'seed-ratio': String(settingStore.ariaSeedRatio || 2),
      'seed-time': String(settingStore.ariaSeedTime || 2880),
      // ↓ Download 迁移选项
      'max-connection-per-server': String(settingStore.ariaMaxConnectionPerServer || 16),
      'bt-force-encryption': settingStore.ariaBtForceEncryption ? 'true' : 'false',
      'enable-upnp': settingStore.ariaEnableUpnp ? 'true' : 'false',
      'listen-port': String(settingStore.ariaListenPort || 6881),
      'dht-listen-port': String(settingStore.ariaDhtListenPort || 6881),
      'bt-save-metadata': settingStore.ariaBtSaveMetadata ? 'true' : 'false',
      'follow-torrent': settingStore.ariaBtAutoDownloadContent ? 'true' : 'false',
      'follow-metalink': settingStore.ariaBtAutoDownloadContent ? 'true' : 'false',
      'pause-metadata': settingStore.ariaBtAutoDownloadContent ? 'false' : 'true',
      'continue': settingStore.ariaContinueDownload ? 'true' : 'false',
    }
    if (settingStore.ariaUserAgent) {
      options['user-agent'] = settingStore.ariaUserAgent
    }
    await client.call('aria2.changeGlobalOption', options)
    return true
  } catch {
    return false
  }
}

export async function AriaConnect() {
  const settingStore = useSettingStore()
  if (settingStore.AriaIsLocal) {
    if (!IsAria2cOnlineLocal || !Aria2EngineLocal) await AriaChangeToLocal()
    return IsAria2cOnlineLocal
  } else {
    if (!IsAria2cOnlineRemote || !Aria2EngineRemote) await AriaChangeToRemote()
    return IsAria2cOnlineRemote
  }
}


export async function AriaGetDowningList() {
  const fields = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorCode', 'errorMessage', 'dir', 'files', 'bittorrent', 'followedBy']
  const multicall = [
    ['aria2.tellActive', fields],
    ['aria2.tellWaiting', 0, 1000, fields],
    ['aria2.tellStopped', 0, 1000, fields]
  ]
  try {
    const result: any = await GetAria()?.multicall(multicall)
    if (result) {
      let list: IAriaDownProgress[] = []
      let arr = result[0][0]
      list = list.concat(arr)
      arr = result[1][0]
      list = list.concat(arr)
      arr = result[2][0]
      list = list.concat(arr)
      DownDAL.mSpeedEvent(list || [])
      SetAriaOnline(true)
    }
  } catch (e: any) {
    DebugLog.mSaveLog('danger', 'AriaGetDowningList' + (e.message || ''), e)
    SetAriaOnline(false)
  }
}


export async function AriaDeleteList(list: string[]) {
  const multicall = []
  for (let i = 0, maxi = list.length; i < maxi; i++) {
    multicall.push(['aria2.forceRemove', list[i]])
    multicall.push(['aria2.removeDownloadResult', list[i]])
  }
  try {
    await GetAria()?.multicall(multicall)
    SetAriaOnline(true)
  } catch {
    SetAriaOnline(false)
  }
}


export async function AriaStopList(list: string[]) {
  const multicall = []
  for (let i = 0, maxi = list.length; i < maxi; i++) {
    multicall.push(['aria2.forcePause', list[i]])
  }
  try {
    await GetAria()?.multicall(multicall)
    SetAriaOnline(true)
  } catch {
    SetAriaOnline(false)
  }
}


export function AriaShoutDown() {
  try {
    const aria = GetAria()
    if (aria) {
      aria.call('aria2.forceShutdown').catch(() => {})
    }
  } catch {}
  // 断开 WebSocket
  CloseRemote()
  // 清理本地引擎引用
  if (Aria2EngineLocal) {
    try { Aria2EngineLocal.close() } catch {}
    Aria2EngineLocal = undefined
  }
  IsAria2cOnlineLocal = false
}

export async function AriaRawCall(method: string, ...args: any[]): Promise<any> {
  return GetAria()?.call(method, ...args)
}

export async function AriaAddUrl(file: IStateDownFile): Promise<string> {
  try {
    // 提交任务前先确保 Aria2 连接正常
    const connected = await AriaConnect()
    if (!connected) {
      if (useSettingStore().AriaIsLocal) {
        // 尝试重新连接本地 Aria2
        await AriaChangeToLocal()
        if (!IsAria2cOnlineLocal) return 'Aria2未连接，请检查本地Aria连接状态'
      } else {
        return 'Aria2未连接，请检查远程Aria连接状态'
      }
    }

    const info = file.Info
    const accountToken = UserDAL.GetUserToken(info.user_id)
    const sourceType = info.sourceType || ''
    const isExternalSource = sourceType === 'url' || sourceType === 'magnet' || sourceType === 'torrent' || sourceType === 'torrent-url'
    const isBtSource = sourceType === 'magnet' || sourceType === 'torrent' || sourceType === 'torrent-url'
    const presetSource = typeof file.Down.DownUrl === 'string' ? file.Down.DownUrl.trim() : ''
    const hasPresetDownloadUrl = /^https?:\/\//i.test(presetSource) || /^magnet:\?/i.test(presetSource) || sourceType === 'torrent'
    if ((!accountToken || !accountToken.access_token) && !isExternalSource && !(info.drive_id === 'media_server' && hasPresetDownloadUrl)) return '账号失效，操作取消'
    if (info.isDir) {
      const dirFull = path.join(info.DownSavePath, info.name)
      if (!info.ariaRemote) {
        try {
          await fs.promises.mkdir(dirFull, { recursive: true })
        } catch (error: any) {
          const errorMap: Record<string, string> = {
            EPERM: '文件没有读取权限',
            EBUSY: '文件被占用或锁定中',
            EACCES: '文件没有读取权限'
          }
          const errorMessage = errorMap[error.code] || error.message
          DebugLog.mSaveLog('danger', 'AriaAddUrl创建文件夹失败：' + dirFull + ' ' + (error || ''), error)
          return errorMessage
        }
      }
      const dirInfo: IAliFileResp = {
        items: [],
        itemsKey: new Set(),
        punished_file_count: 0,
        next_marker: '',
        m_user_id: info.user_id,
        m_drive_id: info.drive_id,
        dirID: info.file_id,
        dirName: info.name
      }
      ;(dirInfo as any).dirPath = info.cloudPath || ''
      do {
        const isGet = await AliTrash.ApiFileListOnePageAria('name', 'ASC', dirInfo)
        if (!isGet) return '解析子文件列表失败，稍后重试'
        if (file.Down.IsStop) {
          dirInfo.items.length = 0
          return '已暂停'
        }
        if (dirInfo.items.length > 0) {
          await DownDAL.aAddDownload(dirInfo.items, dirFull, false)
          dirInfo.items.length = 0
        }
      } while (dirInfo.next_marker)
      return 'downed'
    } else {
      const dirPath = info.DownSavePath
      const outFileName = info.ariaRemote ? info.name : info.name + '.td'
      const fileFull = path.join(dirPath, info.name)
      if (!info.ariaRemote && shouldCheckExistingDownloadTarget(sourceType)) {
        try {
          const fileStat = await fs.promises.stat(fileFull)
          if (fileStat && fileStat.size == info.size) return 'downed'
          else return '本地存在重名文件，请手动删除'
        } catch (error: any) {
          const errorMap: Record<string, string> = {
            EPERM: '文件没有读取权限',
            EBUSY: '文件被占用或锁定中',
            EACCES: '文件没有读取权限'
          }
          const errorMessage = errorMap[error.code] || error.message
          if (errorMessage.indexOf('no such file') < 0) {
            DebugLog.mSaveLog(
              'danger',
              `AriaAddUrl访问文件失败：${fileFull} ${errorMessage || ''}`,
              error
            )
            return errorMessage
          }
          if (info.size == 0 && !isExternalSource) {
            try {
              await (await fs.promises.open(fileFull, 'w')).close()
              return 'downed'
            } catch {
              return '创建空文件失败'
            }
          }
        }
      }
      let downloadUrl = typeof file.Down.DownUrl === 'string' ? file.Down.DownUrl : ''
      downloadUrl = downloadUrl.trim()
      let resolvedDownloadHeaders: Record<string, string> = {}
      if (downloadUrl && !isBtSource && downloadUrl.includes('x-oss-expires=')) {
        const expires = downloadUrl.split('x-oss-expires=')[1].split('&')[0]
        const lastTime = parseInt(expires) - Date.now() / 1000
        const needTime = (info.size + 1) / 1024 / 1024
        if (lastTime < 60 || lastTime < needTime + 60) {
          downloadUrl = ''
        }
      }
      if (!downloadUrl && !isExternalSource) {
        const durl = await getRawUrl(info.user_id, info.drive_id, info.file_id, info.encType)
        if (typeof durl == 'string') {
          console.warn('[aria2] getRawUrl failed', info.drive_id, info.file_id, durl)
          return `生成下载链接失败, ${durl}`
        } else if (!durl.url && !durl.qualities?.length) {
          console.warn('[aria2] getRawUrl empty url', info.drive_id, info.file_id, durl)
          DebugLog.mSaveLog('danger', `${info.file_id} 生成下载链接失败, ${JSON.stringify(durl)}`, null)
          return `生成下载链接失败,${JSON.stringify(durl)}`
        }
        downloadUrl = durl.url || durl.qualities?.[0]?.url || ''
        if (durl.headers) {
          resolvedDownloadHeaders = durl.headers
        }
        file.Down.DownUrl = downloadUrl
      }
      if (sourceType === 'torrent') {
        downloadUrl = ''
        if (!info.torrentBase64) return '种子内容为空'
      } else if (!downloadUrl) {
        console.warn('[aria2] no downloadUrl before addUri', info.drive_id, info.file_id)
        return '生成下载链接失败, 下载地址为空'
      }
      const safeUrl = downloadUrl.replace(/\\u0026/g, '&')
      if (safeUrl !== downloadUrl) {
        console.warn('[aria2] normalize url', info.drive_id, info.file_id)
        downloadUrl = safeUrl
      }
      const isLocalQuarkDownload = !info.ariaRemote && (info.drive_id === 'quark' || isQuarkUser(accountToken || ''))
      if (isLocalQuarkDownload && /^https?:\/\//i.test(downloadUrl) && !downloadUrl.includes('/proxy?')) {
        downloadUrl = getProxyUrl({
          user_id: info.user_id,
          drive_id: info.drive_id,
          file_id: info.file_id,
          file_size: info.size,
          proxy_url: downloadUrl,
          proxy_headers: JSON.stringify({ ...resolvedDownloadHeaders, ...(info.downloadHeaders || {}) }),
          proxy_kind: 'quark-download'
        })
        resolvedDownloadHeaders = {}
        file.Down.DownUrl = ''
      }
      if (sourceType === 'magnet' && !/^magnet:\?/i.test(downloadUrl)) {
        console.warn('[aria2] invalid magnet', info.drive_id, info.file_id, downloadUrl)
        return '磁力链接无效'
      }
      if ((sourceType !== 'magnet' && sourceType !== 'torrent') && !/^https?:\/\//i.test(downloadUrl)) {
        console.warn('[aria2] invalid downloadUrl', info.drive_id, info.file_id, downloadUrl)
        return '生成下载链接失败, 下载地址无效'
      }
      console.log('[aria2] addUri', info.drive_id, info.file_id, { url: downloadUrl, sourceType })
      if (file.Down.IsStop) return '已暂停'
      const token = UserDAL.GetUserToken(info.user_id)
      const isBaiduDownload = isBaiduUser(token || '') || info.drive_id === 'baidu'
      const isDrive115Download = isDrive115User(token || '') || info.drive_id === 'drive115'
      const isQuarkDownload = isQuarkUser(token || '') || info.drive_id === 'quark'
      const split = resolveProviderDownloadSplit(
        isDrive115Download ? 'drive115' : (isQuarkDownload ? 'quark' : info.drive_id),
        info.split || useSettingStore().downThreadMax
      )
      const referer = info.referer || (isBaiduDownload ? 'https://pan.baidu.com/' : isQuarkDownload ? 'https://pan.quark.cn/' : isDrive115Download ? '' : Config.referer)
      const userAgent = isBaiduDownload ? 'pan.baidu.com' : isQuarkDownload ? QUARK_DOWNLOAD_AGENT : isDrive115Download ? DRIVE115_DOWN_AGENT : (info.userAgent || useSettingStore().ariaUserAgent || Config.downAgent)
      const headers: string[] = []
      const downloadHeaders = {
        ...(info.downloadHeaders || {}),
        ...resolvedDownloadHeaders
      }
      for (const [key, value] of Object.entries(downloadHeaders)) {
        if (key && value) headers.push(`${key}: ${value}`)
      }
      headers.push(...(info.externalHeaders || []))
      const hasAuthorizationHeader = headers.some((header) => /^authorization\s*:/i.test(header))
      if (!hasAuthorizationHeader && token?.access_token && (isDrive115User(token) || isBaiduUser(token))) {
        headers.push(`Authorization: Bearer ${token.access_token}`)
      }
      if (info.drive_id === 'baidu') {
        headers.push(`User-Agent: pan.baidu.com`)
      } else {
        if (userAgent) {
          headers.push(`User-Agent: ${userAgent}`)
        }
      }
      if (isDrive115Download) {
        try {
          const url = new URL(downloadUrl)
          const sanitizedHeaders = headers.map((header) => {
            const index = header.indexOf(':')
            const key = index >= 0 ? header.slice(0, index).trim() : header
            const value = index >= 0 ? header.slice(index + 1).trim() : ''
            if (/^authorization$/i.test(key)) return `${key}: ${value ? 'Bearer ***' : ''}`
            if (/^cookie$/i.test(key)) return `${key}: ***`
            return `${key}: ${value}`
          })
          console.log('[drive115] aria2 addUri options', {
            host: url.host,
            pathname: url.pathname,
            hasQuery: !!url.search,
            split,
            referer,
            userAgent,
            headers: sanitizedHeaders
          })
        } catch {
          console.log('[drive115] aria2 addUri options', {
            urlValid: false,
            split,
            referer,
            userAgent,
            headers: headers.map((header) => header.replace(/Authorization:\\s*Bearer\\s+.+/i, 'Authorization: Bearer ***'))
          })
        }
      }
      const addOptions: any = buildAriaAddOptions({
        gid: info.GID,
        dir: dirPath,
        split,
        referer,
        userAgent,
        headers,
        outFileName,
        sourceType,
        selectFile: info.selectFile,
        allProxy: info.allProxy
      })
      const client = GetAria()
      if (!client) return 'Aria2未连接，请检查本地或远程Aria连接状态'
      if (sourceType === 'torrent') {
        let torrentError: any = undefined
        const torrentResult: any = await callAriaClient(client, 'aria2.addTorrent', info.torrentBase64, [], addOptions, (error: unknown) => {
          torrentError = error
        })
        const torrentGid = getAriaAddUriGid(torrentResult)
        if (torrentGid) {
          info.GID = torrentGid
          return 'success'
        }
        if (isAriaDuplicateGidError(torrentResult) || isAriaDuplicateGidError(torrentError)) return 'success'
        delete addOptions.gid
        torrentError = undefined
        const fallbackTorrentResult: any = await callAriaClient(client, 'aria2.addTorrent', info.torrentBase64, [], addOptions, (error: unknown) => {
          torrentError = error
        })
        const fallbackTorrentGid = getAriaAddUriGid(fallbackTorrentResult)
        if (fallbackTorrentGid) {
          info.GID = fallbackTorrentGid
          return 'success'
        }
        return '创建BT任务失败，稍后自动重试' + ((fallbackTorrentResult && fallbackTorrentResult.message) || (torrentError && torrentError.message) || (torrentResult && torrentResult.message) || '')
      }
      const multicall = [
        ['aria2.forceRemove', info.GID],
        ['aria2.removeDownloadResult', info.GID],
        ['aria2.addUri', [downloadUrl], addOptions]
      ]
      const result: any = await GetAria()?.multicall(multicall)
      console.log('[aria2] addUri result', info.drive_id, info.file_id, JSON.stringify(result))
      const addResult = result && result.length >= 3 ? result[2] : undefined
      const addGid = getAriaAddUriGid(addResult)
      if (addGid) {
        info.GID = addGid
        return 'success'
      }
      // GID 不存在时忽略清理错误，尝试单独 addUri
      let singleError: any = undefined
      let singleResult: any = await callAriaClient(client, 'aria2.addUri', [downloadUrl], addOptions, (error: unknown) => {
        singleError = error
      })
      const singleGid = getAriaAddUriGid(singleResult)
      if (singleGid) {
        info.GID = singleGid
        return 'success'
      }
      if (isAriaDuplicateGidError(singleResult) || isAriaDuplicateGidError(singleError)) {
        // GID 重复说明旧任务残留，先强制清理再重建
        await callAriaClient(client, 'aria2.forceRemove', info.GID)
        await callAriaClient(client, 'aria2.removeDownloadResult', info.GID)
        delete addOptions.gid
        singleError = undefined
        singleResult = await callAriaClient(client, 'aria2.addUri', [downloadUrl], addOptions, (error: unknown) => {
          singleError = error
        })
        const retryGid = getAriaAddUriGid(singleResult)
        if (retryGid) {
          info.GID = retryGid
          return 'success'
        }
        if (isAriaDuplicateGidError(singleResult) || isAriaDuplicateGidError(singleError)) {
          return 'success'
        }
        return '创建aria任务失败，稍后自动重试' + ((singleResult && singleResult.message) || (singleError && singleError.message) || '')
      }
      if (!singleResult || singleResult.code) {
        delete addOptions.gid
        singleError = undefined
        singleResult = await callAriaClient(client, 'aria2.addUri', [downloadUrl], addOptions, (error: unknown) => {
          singleError = error
        })
        const fallbackGid = getAriaAddUriGid(singleResult)
        if (fallbackGid) {
          info.GID = fallbackGid
          return 'success'
        }
        return '创建aria任务失败，稍后自动重试' + ((singleResult && singleResult.message) || (singleError && singleError.message) || (addResult && addResult.message) || '')
      }
    }
  } catch (e: any) {
    SetAriaOnline(false)
    DebugLog.mSaveLog('danger', 'AriaAddUrl' + (e.message || ''), e)
    SetAriaOnline(false)
    return Promise.resolve('创建Aria任务失败连接断开：' + (e.message || '未知错误'))
  }
  return Promise.resolve('创建Aria任务失败1')
}


export function AriaHashFile(downitem: IStateDownFile): { DownID: string; Check: boolean } {
  const DownID = downitem.DownID
  const sourceType = downitem.Info.sourceType || ''
  if (sourceType === 'magnet' || sourceType === 'torrent' || sourceType === 'torrent-url') {
    return { DownID, Check: true }
  }
  const dir = downitem.Info.DownSavePath
  const out = downitem.Info.ariaRemote ? downitem.Info.name : downitem.Info.name + '.td'
  const sha1 = downitem.Info.sha1
  const crc64 = downitem.Info.crc64

  const data = {
    DownID: DownID,
    inputfile: path.join(dir, out),
    movetofile: path.join(dir, downitem.Info.name),
    hash: crc64 ? 'crc64' : sha1 ? 'sha1' : '',
    check: crc64 || sha1 || ''
  }
  let success = false
  if (data.inputfile == data.movetofile) {
    success = true
  } else if (fs.existsSync(data.movetofile)) {
    success = true
  } else {
    try {
      fs.renameSync(data.inputfile, data.movetofile)
      success = true
    } catch {
      try {
        fs.renameSync(data.inputfile, data.movetofile)
        success = true
      } catch (e: any) {
        DebugLog.mSaveLog('danger', 'AriaRename file=' + data.inputfile + ' error=' + (e.message || ''), e)
      }
    }
  }
  return { DownID, Check: success }
}


export function FormatAriaError(code: string, message: string): string {
  switch (code) {
    case '0':
      return ''
    case '1':
      return 'aria2c未知错误'
    case '2':
      return 'aria2c网络超时'
    case '3':
      return 'aria2c网络文件404'
    case '4':
      return 'aria2c网络文件404'
    case '5':
      return 'aria2c下载缓慢自动退出'
    case '6':
      return 'aria2c发生网络中断'
    case '7':
      return 'aria2c被强制退出错误'
    case '8':
      return 'aria2c服务器不支持断点续传'
    case '9':
      return 'aria2c本地硬盘空间不足'
    case '10':
      return 'aria2c分片大小更改'
    case '11':
      return 'aria2c重复任务'
    case '12':
      return 'aria2c重复BT任务'
    case '13':
      return 'aria2c文件已存在且不能覆盖'
    case '14':
      return 'aria2c文件重命名失败'
    case '15':
      return 'aria2c打开文件失败'
    case '16':
      return 'aria2c创建文件时失败'
    case '17':
      return 'aria2c文件写入失败'
    case '18':
      return 'aria2c创建文件夹失败, 请设置保存路径'
    case '19':
      return 'aria2cDNS解析失败'
    case '20':
      return 'aria2c解析磁力失败'
    case '21':
      return 'aria2cFTP不支持的命令'
    case '22':
      if (message.includes('403')) return '服务器拒绝访问403'
      if (message.includes('503')) return '服务器返回错误503'
      return message
    case '23':
      return 'aria2cHTTP重定向失败'
    case '24':
      return 'aria2cHTTP认证失败'
    case '25':
      return 'aria2c格式化种子失败'
    case '26':
      return 'aria2c读取种子信息失败'
    case '27':
      return 'aria2c磁力链接错误'
    case '28':
      return 'aria2c提供了错误的参数'
    case '29':
      return 'aria2c服务器超载暂时无法处理请求'
    case '30':
      return 'aria2cRPC传输参数错误'
    case '31':
      return 'aria2c多余的响应数据'
    case '32':
      return 'aria2c文件sha1校验失败'
    default:
      return message
  }
}
