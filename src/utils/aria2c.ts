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
import { getRawUrl } from './proxyhelper'
import { isBaiduUser, isCloud123User, isDrive115User } from '../aliapi/utils'
import { getAriaAddUriGid, isAriaDuplicateGidError } from './aria2Rpc'

export const localPwd = 'S4znWTaZYQi3cpRNb'

let Aria2cChangeing: boolean = false
let Aria2EngineLocal: Aria2 | undefined = undefined
let Aria2EngineRemote: Aria2 | undefined = undefined

let IsAria2cOnlineLocal: boolean = false

let Aria2cLocalRelaunchTime = 0

let IsAria2cOnlineRemote: boolean = false

let Aria2cRemoteRetryTime = 0

function GetAria() {
  if (useSettingStore().AriaIsLocal) return Aria2EngineLocal
  return Aria2EngineRemote
}

/** Use native DownloadManager only when aria2c module is disabled */
function useNative(): boolean {
  return !useSettingStore().downUseAria2c
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
        Aria2EngineRemote.close().catch().then()
      } catch {
      }
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
          message.error('连接失败 密码错误 ' + url + ' secret=' + secret)
          return false
        }
      }
      if (error.message && error.message.indexOf('timeout of') >= 0) {
        message.error('连接失败 网络连接超时 ' + url)
        return false
      }
      message.error('连接失败 ' + (error.message ? error.message : '') + ' ' + url + ' secret=' + secret)
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
    Aria2EngineRemote = new Aria2({ WebSocket: global.WebSocket, fetch: window.fetch.bind(window), ...options })

    Aria2EngineRemote.on('close', () => {
      if (IsAria2cOnlineRemote && !Aria2cChangeing) {
        if (!settingStore.AriaIsLocal) {
          message.error('Aria2远程连接已断开')
          SetAriaOnline(false, 'remote')
        }
      }
    })
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
      const url = host + ':' + port + ' secret=' + secret
      if (!settingStore.AriaIsLocal && Aria2cRemoteRetryTime % 10 == 1) message.error('无法连接到远程Aria2 ' + url)
    } else {
      await AriaGlobalSpeed()
    }
  } catch (e) {
    SetAriaOnline(false, 'remote')
  }
  Aria2cChangeing = false
  return IsAria2cOnlineRemote
}


export async function AriaChangeToLocal() {
  CloseRemote()
  if (!useSettingStore().downUseAria2c) {
    // Native DownloadManager — no aria2c process needed
    try {
      IsAria2cOnlineLocal = true
      SetAriaOnline(true, 'local')
      await AriaGlobalSpeed()
    } catch (e) {
      SetAriaOnline(false, 'local')
    }
    return true
  }
  // Local aria2c via WebSocket
  if (Aria2cLocalRelaunchTime < 5) {
    try {
      let port = 16800
      if (Aria2EngineLocal == undefined) {
        port = window.WebRelaunchAria ? await window.WebRelaunchAria() : 16800
        const options = { host: '127.0.0.1', port, secure: false, secret: localPwd, path: '/jsonrpc' }
        Aria2EngineLocal = new Aria2({ WebSocket: global.WebSocket, fetch: window.fetch.bind(window), ...options })
        Aria2EngineLocal.on('close', () => {
          IsAria2cOnlineLocal = false
          if (useSettingStore().AriaIsLocal) {
            if (Aria2cLocalRelaunchTime < 2) {
              message.error('Aria2本地连接已断开')
            }
            SetAriaOnline(false, 'local')
          }
        })
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
        const url = `127.0.0.1:${port} secret=${localPwd}`
        if (Aria2cLocalRelaunchTime < 2) message.error('无法连接到本地Aria2 ' + url)
      } else {
        await AriaGlobalSpeed()
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
    if (useNative()) {
      await window.Electron.ipcRenderer.invoke('download:setSpeed', { limit })
    } else {
      await GetAria()?.call('aria2.changeGlobalOption', { 'max-overall-download-limit': limit }).catch((e: any) => {
        if (e && e.message == 'Unauthorized') message.error('Aria2密码错误(密码不要有 ^ 或特殊字符)')
        IsAria2cOnlineLocal = false
      })
    }
  } catch {
    SetAriaOnline(false)
  }
}

export async function AriaConnect() {
  if (!useSettingStore().downUseAria2c || useSettingStore().AriaIsLocal) {
    // Native IPC (downUseAria2c=false) or local aria2c (downUseAria2c=true, ariaState=local)
    if (!IsAria2cOnlineLocal) await AriaChangeToLocal()
    return IsAria2cOnlineLocal
  } else {
    if (!IsAria2cOnlineRemote) await AriaChangeToRemote()
    return IsAria2cOnlineRemote
  }
}


export async function AriaGetDowningList() {
  if (useNative()) {
    try {
      const list: IAriaDownProgress[] = await window.Electron.ipcRenderer.invoke('download:list')
      DownDAL.mSpeedEvent(list || [])
      SetAriaOnline(true)
    } catch (e: any) {
      DebugLog.mSaveLog('danger', 'AriaGetDowningList' + (e.message || ''), e)
      SetAriaOnline(false)
    }
    return
  }
  const multicall = [
    ['aria2.tellActive', ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorCode', 'errorMessage']],
    ['aria2.tellWaiting', 0, 1000, ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorCode', 'errorMessage']],
    ['aria2.tellStopped', 0, 1000, ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorCode', 'errorMessage']]
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
  if (useNative()) {
    try {
      await window.Electron.ipcRenderer.invoke('download:remove', list)
      SetAriaOnline(true)
    } catch {
      SetAriaOnline(false)
    }
    return
  }
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
  if (useNative()) {
    try {
      await window.Electron.ipcRenderer.invoke('download:pause', list)
      SetAriaOnline(true)
    } catch {
      SetAriaOnline(false)
    }
    return
  }
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
  if (useNative()) {
    // Native engine runs in the Electron main process; nothing to shut down from the renderer
    return
  }
  GetAria()?.call('aria2.forceShutdown').catch(() => {})
}

export async function AriaAddUrl(file: IStateDownFile): Promise<string> {
  try {
    const info = file.Info
    const token = UserDAL.GetUserToken(info.user_id)
    const hasPresetDownloadUrl = typeof file.Down.DownUrl === 'string' && /^https?:\/\//i.test(file.Down.DownUrl.trim())
    if ((!token || !token.access_token) && !(info.drive_id === 'media_server' && hasPresetDownloadUrl)) return '账号失效，操作取消'
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
      do {
        const isGet = await AliTrash.ApiFileListOnePageAria('name', 'ASC', dirInfo)
        if (!isGet) return '解析子文件列表失败，稍后重试'
        if (file.Down.IsStop) {
          dirInfo.items.length = 0
          return '已暂停'
        }
        if (dirInfo.items.length > 0) {
          DownDAL.aAddDownload(dirInfo.items, dirFull, false)
          dirInfo.items.length = 0
        }
      } while (dirInfo.next_marker)
      return 'downed'
    } else {
      const dirPath = info.DownSavePath
      const outFileName = info.ariaRemote ? info.name : info.name + '.td'
      const fileFull = path.join(dirPath, info.name)
      if (!info.ariaRemote) {
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
          if (info.size == 0) {
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
      if (downloadUrl && downloadUrl.includes('x-oss-expires=')) {
        const expires = downloadUrl.split('x-oss-expires=')[1].split('&')[0]
        const lastTime = parseInt(expires) - Date.now() / 1000
        const needTime = (info.size + 1) / 1024 / 1024
        if (lastTime < 60 || lastTime < needTime + 60) {
          downloadUrl = ''
        }
      }
      if (!downloadUrl) {
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
        file.Down.DownUrl = downloadUrl
      }
      if (!downloadUrl) {
        console.warn('[aria2] no downloadUrl before addUri', info.drive_id, info.file_id)
        return '生成下载链接失败, 下载地址为空'
      }
      const safeUrl = downloadUrl.replace(/\\u0026/g, '&')
      if (safeUrl !== downloadUrl) {
        console.warn('[aria2] normalize url', info.drive_id, info.file_id)
        downloadUrl = safeUrl
      }
      if (!/^https?:\/\//i.test(downloadUrl)) {
        console.warn('[aria2] invalid downloadUrl', info.drive_id, info.file_id, downloadUrl)
        return '生成下载链接失败, 下载地址无效'
      }
      console.log('[aria2] addUri', info.drive_id, info.file_id, {
        url: downloadUrl
      })
      if (file.Down.IsStop) return '已暂停'
      const split = useSettingStore().downThreadMax
      const referer = Config.referer
      const userAgent = Config.downAgent
      const token = UserDAL.GetUserToken(info.user_id)
      const headers: string[] = []
      for (const [key, value] of Object.entries(info.downloadHeaders || {})) {
        if (key && value) headers.push(`${key}: ${value}`)
      }
      if (token?.access_token && (isCloud123User(token) || isDrive115User(token) || isBaiduUser(token))) {
        headers.push(`Authorization: Bearer ${token.access_token}`)
      }
      if (isBaiduUser(token || '')) {
        headers.push(`User-Agent: pan.baidu.com`)
      } else {
        if (userAgent) {
          headers.push(`User-Agent: ${userAgent}`)
        }
      }
      if (useNative()) {
        // Native DownloadManager path: submit via IPC
        const headersRecord: Record<string, string> = {}
        for (const h of headers) {
          const colonIdx = h.indexOf(':')
          if (colonIdx > 0) {
            headersRecord[h.slice(0, colonIdx).trim()] = h.slice(colonIdx + 1).trim()
          }
        }
        const result: any = await window.Electron.ipcRenderer.invoke('download:add', {
          gid: info.GID,
          user_id: info.user_id,
          drive_id: info.drive_id,
          file_id: info.file_id,
          encType: info.encType,
          url: downloadUrl,
          headers: headersRecord,
          savePath: dirPath,
          fileName: info.name,
          fileSize: info.size,
          split
        })
        if (result === 'success') return 'success'
        return '创建下载任务失败: ' + (result || '未知错误')
      }
      const multicall = [
        ['aria2.forceRemove', info.GID],
        ['aria2.removeDownloadResult', info.GID],
        ['aria2.addUri', [downloadUrl], {
          gid: info.GID, dir: dirPath, out: outFileName,
          split, 'user-agent': userAgent, header: headers
        }]
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
      const addOptions: any = {
        gid: info.GID, dir: dirPath, out: outFileName,
        split, referer, 'user-agent': userAgent, header: headers
      }
      let singleError: any = undefined
      let singleResult: any = await GetAria()?.call('aria2.addUri', [downloadUrl], addOptions).catch((error: any) => {
        singleError = error
        return undefined
      })
      const singleGid = getAriaAddUriGid(singleResult)
      if (singleGid) {
        info.GID = singleGid
        return 'success'
      }
      if (isAriaDuplicateGidError(singleResult) || isAriaDuplicateGidError(singleError)) {
        return 'success'
      }
      if (!singleResult || singleResult.code) {
        delete addOptions.gid
        singleError = undefined
        singleResult = await GetAria()?.call('aria2.addUri', [downloadUrl], addOptions).catch((error: any) => {
          singleError = error
          return undefined
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
    return Promise.resolve('创建Aria任务失败连接断开')
  }
  return Promise.resolve('创建Aria任务失败1')
}


export function AriaHashFile(downitem: IStateDownFile): { DownID: string; Check: boolean } {
  const DownID = downitem.DownID
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
  if (useNative()) {
    // Native engine renames .td → final on completion; just verify the final file exists
    if (data.inputfile === data.movetofile || fs.existsSync(data.movetofile)) {
      success = true
    } else if (fs.existsSync(data.inputfile)) {
      // Fallback: manual rename if .td file still present
      try {
        fs.renameSync(data.inputfile, data.movetofile)
        success = true
      } catch (e: any) {
        DebugLog.mSaveLog('danger', 'AriaRename file=' + data.inputfile + ' error=' + (e.message || ''), e)
      }
    }
  } else {
    if (data.inputfile == data.movetofile) {
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
