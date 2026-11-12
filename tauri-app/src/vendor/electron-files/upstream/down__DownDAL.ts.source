import { IAliGetFileModel } from '../aliapi/alimodels'
import path from 'path'
import TreeStore from '../store/treestore'
import { useDownedStore, useDowningStore, useFootStore, useSettingStore, useUserStore } from '../store'
import { ClearFileName } from '../utils/filehelper'
import message from '../utils/message'
import {
  AriaAddUrl,
  AriaConnect,
  AriaDeleteList,
  AriaGetDowningList,
  AriaHashFile,
  AriaStopList,
  FormatAriaError,
  IsAria2cRemote
} from '../utils/aria2c'
import { humanSize, humanSizeSpeed } from '../utils/format'
import { Howl } from 'howler'
import DBDown from '../utils/dbdown'
import fsPromises from 'fs/promises'
import { DecodeEncName } from '../aliapi/utils'
import { getEncType } from '../utils/proxyhelper'
import { SHA256 } from 'crypto-js'
import { shouldRemoveAriaStoppedResult } from '../utils/aria2Rpc'
import { resolveAriaProgressErrorState } from './integration/downloadProgressState'
import { buildBtControlFileCandidates, isBtContentComplete, resolveBtDownloadTarget, resolveFollowedBtGid } from './integration/btDownloadTarget'
import { resolveDriveFileToken } from '../drive/account'

export interface IStateDownFile {
  DownID: string
  Info: IStateDownInfo

  Down: {
    DownState: string
    DownTime: number
    DownSize: number
    DownSpeed: number
    DownSpeedStr: string
    DownProcess: number
    IsStop: boolean
    IsDowning: boolean
    IsCompleted: boolean
    IsFailed: boolean
    FailedCode: number
    FailedMessage: string

    AutoTry: number

    DownUrl: string
  }
}

export interface IStateDownInfo {

  GID: string
  user_id: string

  DownSavePath: string
  ariaRemote: boolean

  file_id: string
  drive_id: string

  name: string
  cloudPath?: string

  size: number
  sizestr: string
  icon: string
  isDir: boolean
  encType: string

  sha1: string

  crc64: string

  localFilePath?: string
  downloadHeaders?: Record<string, string>
  externalHeaders?: string[]
  referer?: string
  userAgent?: string
  allProxy?: string
  sourceType?: 'url' | 'magnet' | 'torrent' | 'torrent-url'
  torrentBase64?: string
  torrentUrl?: string
  selectFile?: string
  split?: number
  offlineProvider?: 'cloud123' | 'pikpak' | 'guangya' | 'drive115' | 'dropbox'
  offlineTaskId?: string
  offlineDirId?: string
}

export interface IAriaDownProgress {
  gid: string
  status: string
  totalLength: string
  completedLength: string
  downloadSpeed: string
  errorCode: string
  errorMessage: string
  dir?: string
  files?: Array<{ path?: string; selected?: string | boolean; length?: string | number; completedLength?: string | number }>
  bittorrent?: { info?: { name?: string } }
  followedBy?: string[]
}

/** 存盘的时机：默认 10 时进行 */
let SaveTimeWait = 0
const sound = new Howl({
  src: ['./audio/download_finished.mp3'], // 音频文件路径
  autoplay: false, // 是否自动播放
  volume: 1.0 // 音量，范围 0.0 ~ 1.0
})

const buildAriaTaskGid = (file: IAliGetFileModel) => {
  const source = `${file.drive_id || ''}|${file.file_id || ''}|${file.size || 0}`
  return SHA256(source).toString().toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 16)
}

const buildUrlTaskGid = (source: string) => {
  return SHA256(source).toString().toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 16)
}

const isCompletedDowning = (downFile: IStateDownFile) => {
  return downFile.Down.IsCompleted && (downFile.Down.DownState === '已完成' || !!downFile.Info.offlineProvider)
}

export default class DownDAL {

  /**
   * 从DB中加载数据
   */
  static async aReloadDowning() {
    const downingStore = useDowningStore()
    if (downingStore.ListLoading) return
    downingStore.ListLoading = true
    const stateDownFiles = await DBDown.getDowningAll()
    // 首次从DB中加载数据，如果上次意外停止则重新开始，如果手动暂停则保持
    for (const stateDownFile of stateDownFiles) {
      if (!stateDownFile.Down.IsStop && stateDownFile.Down.DownState != '队列中') {
        const down = stateDownFile.Down
        down.IsDowning = false
        down.IsCompleted = false
        down.IsStop = false
        down.DownState = '队列中'
        down.DownSpeed = 0
        down.DownSpeedStr = ''
        down.IsFailed = false
        down.FailedCode = 0
        down.FailedMessage = ''
        down.AutoTry = 0
        down.IsDowning = false
      }
    }
    downingStore.ListDataRaw = stateDownFiles
    downingStore.ListLoading = false
    downingStore.mRefreshListDataShow(true)
  }

  static async aReloadDowned() {
    const downedStore = useDownedStore()
    const downingStore = useDowningStore()
    if (downedStore.ListLoading) return
    downedStore.ListLoading = true
    const max = useSettingStore().debugDownedListMax
    const showlist = await DBDown.getDownedByTop(max)
    const completedList: IStateDownFile[] = []
    for (const item of showlist) {
      const isLocalBt = !item.Info.ariaRemote && (item.Info.sourceType === 'magnet' || item.Info.sourceType === 'torrent' || item.Info.sourceType === 'torrent-url')
      let hasControlFile = false
      if (isLocalBt) {
        for (const controlFile of buildBtControlFileCandidates(item.Info, item.Down.DownUrl || '')) {
          try {
            await fsPromises.access(controlFile)
            hasControlFile = true
            break
          } catch {}
        }
      }
      if (!hasControlFile) {
        completedList.push(item)
        continue
      }

      item.Info.isDir = false
      item.Info.icon = 'iconfile-bt'
      item.Down.DownState = '队列中'
      item.Down.DownProcess = 0
      item.Down.DownSpeed = 0
      item.Down.DownSpeedStr = ''
      item.Down.IsStop = false
      item.Down.IsDowning = false
      item.Down.IsCompleted = false
      item.Down.IsFailed = false
      item.Down.FailedCode = 0
      item.Down.FailedMessage = ''
      await DBDown.saveDowning(item.DownID, JSON.parse(JSON.stringify(item)))
      await DBDown.deleteDowned(item.DownID)
      if (!downingStore.ListDataRaw.some((downing) => downing.DownID === item.DownID)) downingStore.ListDataRaw.push(item)
    }
    downingStore.mRefreshListDataShow(true)
    const count = await DBDown.getDownedTaskCount()
    downedStore.aLoadListData(completedList, count)
    downedStore.ListLoading = false
  }

  static async aClearDowned() {
    const max = useSettingStore().debugDownedListMax
    return await DBDown.deleteDownedOutCount(max)
  }

  /**
   * 添加到下载动作
   * @param fileList
   * @param savePath
   * @param needPanPath
   */
  static async aAddDownload(fileList: IAliGetFileModel[], savePath: string, needPanPath: boolean) {
    const userID = useUserStore().user_id
    const settingStore = useSettingStore()

    if (savePath.endsWith('/') || savePath.endsWith('\\')) {
      savePath = savePath.substr(0, savePath.length - 1)
    }

    const downlist: IStateDownFile[] = []
    const dTime = Date.now()

    let cPid = ''
    let cPath = ''
    const ariaRemote = settingStore.ariaState == 'remote'
    const sep = settingStore.ariaSavePath.indexOf('/') >= 0 ? '/' : '\\'
    for (let f = 0; f < fileList.length; f++) {
      const file = fileList[f]
      const token = await resolveDriveFileToken(file as IAliGetFileModel & { user_id?: string }, userID)
      if (!token?.user_id) {
        message.error(`添加下载失败：找不到 ${file.drive_id} 对应的已登录账号`)
        continue
      }
      const fileUserId = token.user_id
      const name = ClearFileName(DecodeEncName(fileUserId, file).name)
      let fullPath = savePath
      if (needPanPath) {
        if (cPath != '' && cPid == file.parent_file_id) fullPath = cPath
        else {
          let cPath2 = savePath
          const plist = TreeStore.GetDirPath(file.drive_id, file.parent_file_id)
          for (let p = 0; p < plist.length; p++) {
            const pName = ClearFileName(plist[p].name)
            if (plist[p].file_id.includes('root')) continue
            if (path.join(cPath2, pName, name).length > 250) break
            cPath2 = path.join(cPath2, pName)
          }
          cPid = file.parent_file_id
          cPath = cPath2
          fullPath = cPath2
        }
      }

      if (ariaRemote) {
        if (sep == '/') fullPath = fullPath.replace(/\\/g, '/')
        else fullPath = fullPath.replace(/\//g, '\\')
      }

      const gid = buildAriaTaskGid(file)

      let downloadurl = ''
      let crc64 = ''
      const downitem: IStateDownFile = {
        DownID: fileUserId + '|' + file.file_id,
        Info: {
          GID: gid,
          user_id: fileUserId,
          DownSavePath: fullPath,
          ariaRemote: ariaRemote,
          file_id: file.file_id,
          drive_id: file.drive_id,
          name: name,
          cloudPath: file.path || '',
          size: file.size,
          sizestr: file.sizeStr,
          isDir: file.isDir,
          icon: file.icon,
          encType: getEncType(file),
          sha1: '',
          crc64: crc64
        },
        Down: {
          DownState: '队列中',
          DownTime: dTime + f,
          DownSize: 0,
          DownSpeed: 0,
          DownSpeedStr: '',
          DownProcess: 0,
          IsStop: false,
          IsDowning: false,
          IsCompleted: false,
          IsFailed: false,
          FailedCode: 0,
          FailedMessage: '',
          AutoTry: 0,
          DownUrl: downloadurl
        }
      }
      if (downitem.Info.ariaRemote && !downitem.Info.isDir) downitem.Info.icon = 'iconcloud-download'
      downlist.push(downitem)
    }
    useDowningStore().mAddDownload({ downlist })
  }

  static aAddUrlDownload(params: {
    user_id: string
    drive_id: string
    file_id: string
    url: string
    headers?: Record<string, string>
    savePath: string
    fileName: string
    fileSize?: number
    icon?: string
  }) {
    const settingStore = useSettingStore()
    const name = ClearFileName(params.fileName || 'media')
    const ariaRemote = settingStore.ariaState == 'remote'
    let fullPath = params.savePath
    if (fullPath.endsWith('/') || fullPath.endsWith('\\')) fullPath = fullPath.substr(0, fullPath.length - 1)
    if (ariaRemote) {
      const sep = settingStore.ariaSavePath.indexOf('/') >= 0 ? '/' : '\\'
      fullPath = sep == '/' ? fullPath.replace(/\\/g, '/') : fullPath.replace(/\//g, '\\')
    }
    const gid = buildUrlTaskGid(`${params.drive_id}|${params.file_id}|${params.url}|${params.fileSize || 0}`)
    const downitem: IStateDownFile = {
      DownID: `${params.user_id}|${params.drive_id}|${params.file_id}|${gid}`,
      Info: {
        GID: gid,
        user_id: params.user_id,
        DownSavePath: fullPath,
        ariaRemote,
        file_id: params.file_id,
        drive_id: params.drive_id,
        name,
        size: params.fileSize || 0,
        sizestr: params.fileSize ? humanSize(params.fileSize) : '',
        isDir: false,
        icon: params.icon || 'iconcloud-download',
        encType: '',
        sha1: '',
        crc64: '',
        downloadHeaders: params.headers || {}
      },
      Down: {
        DownState: '队列中',
        DownTime: Date.now(),
        DownSize: 0,
        DownSpeed: 0,
        DownSpeedStr: '',
        DownProcess: 0,
        IsStop: false,
        IsDowning: false,
        IsCompleted: false,
        IsFailed: false,
        FailedCode: 0,
        FailedMessage: '',
        AutoTry: 0,
        DownUrl: params.url
      }
    }
    useDowningStore().mAddDownload({ downlist: [downitem] })
  }

  static aAddExternalDownload(params: {
    source: string
    sourceType: 'url' | 'magnet' | 'torrent' | 'torrent-url'
    savePath: string
    fileName?: string
    torrentBase64?: string
    selectFile?: string
    split?: number
    userAgent?: string
    authorization?: string
    referer?: string
    cookie?: string
    allProxy?: string
  }) {
    const settingStore = useSettingStore()
    const userID = useUserStore().user_id || 'external'
    const ariaRemote = settingStore.ariaState == 'remote'
    let fullPath = params.savePath || (ariaRemote ? settingStore.ariaSavePath : settingStore.downSavePath)
    if (!fullPath) return { success: false, message: '请先选择保存目录' }
    if (fullPath.endsWith('/') || fullPath.endsWith('\\')) fullPath = fullPath.substr(0, fullPath.length - 1)

    if (ariaRemote) {
      const sep = settingStore.ariaSavePath.indexOf('/') >= 0 ? '/' : '\\'
      fullPath = sep == '/' ? fullPath.replace(/\\/g, '/') : fullPath.replace(/\//g, '\\')
    }

    const source = params.source.trim()
    const inferredName = (() => {
      if (params.fileName?.trim()) return params.fileName.trim()
      if (params.sourceType === 'magnet') return 'BT 磁力任务'
      if (params.sourceType === 'torrent') return 'BT 种子任务'
      try {
        const url = new URL(source)
        const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '')
        return name || (params.sourceType === 'torrent-url' ? 'BT 种子任务' : 'URL 下载任务')
      } catch {
        return params.sourceType === 'torrent-url' ? 'BT 种子任务' : 'URL 下载任务'
      }
    })()
    const name = ClearFileName(inferredName)
    const gid = buildUrlTaskGid(`${params.sourceType}|${source}|${params.torrentBase64 || ''}|${params.selectFile || ''}`)
    const downitem: IStateDownFile = {
      DownID: `${userID}|external|${gid}`,
      Info: {
        GID: gid,
        user_id: userID,
        DownSavePath: fullPath,
        ariaRemote,
        file_id: gid,
        drive_id: 'external',
        name,
        size: 0,
        sizestr: '',
        isDir: false,
        icon: params.sourceType === 'url' ? 'iconcloud-download' : 'iconfile-bt',
        encType: '',
        sha1: '',
        crc64: '',
        externalHeaders: [
          params.authorization ? `Authorization: ${params.authorization}` : '',
          params.cookie ? `Cookie: ${params.cookie}` : ''
        ].filter(Boolean),
        referer: params.referer,
        userAgent: params.userAgent,
        allProxy: params.allProxy,
        sourceType: params.sourceType,
        torrentBase64: params.torrentBase64,
        torrentUrl: params.sourceType === 'torrent-url' ? source : undefined,
        selectFile: params.selectFile,
        split: params.split
      },
      Down: {
        DownState: '队列中',
        DownTime: Date.now(),
        DownSize: 0,
        DownSpeed: 0,
        DownSpeedStr: '',
        DownProcess: 0,
        IsStop: false,
        IsDowning: false,
        IsCompleted: false,
        IsFailed: false,
        FailedCode: 0,
        FailedMessage: '',
        AutoTry: 0,
        DownUrl: source
      }
    }
    useDowningStore().mAddDownload({ downlist: [downitem] })
    return { success: true, message: '' }
  }

  /**
   * 速度事件动作
   */
  static async aSpeedEvent() {
    const downingStore = useDowningStore()
    const downedStore = useDownedStore()
    const settingStore = useSettingStore()

    const isOnline = await AriaConnect()

    if (isOnline && downingStore.ListDataRaw.length) {
      await AriaGetDowningList()
      const ariaRemote = IsAria2cRemote()
      const DowningList: IStateDownFile[] = downingStore.ListDataRaw
      const timeThreshold = Date.now() - 60 * 1000
      const downFileMax = settingStore.downFileMax
      const shouldSkipDown = (Down: any) => {
        return (
          Down.IsCompleted ||
          Down.IsStop ||
          Down.IsDowning ||
          (Down.IsFailed && timeThreshold <= Down.AutoTry)
        )
      }
      let addDowningCount = 0
      for (let i = 0; i < DowningList.length; i++) {
        const DownItem = DowningList[i]
        const { DownID, Info, Down } = DownItem
        if (Info.ariaRemote !== ariaRemote) continue
        if (isCompletedDowning(DownItem)) {
          // 将下载标记为已完成并添加到列表以供稍后处理
          const completedDownId = `${Date.now()}_${Down.DownTime}`
          // 删除已完成的下载并更新数据库
          DowningList.splice(i, 1)
          await DBDown.deleteDowning(DownID)
          // 将已完成的下载添加到下载文件列表中
          const downedData = JSON.parse(JSON.stringify({ DownID: completedDownId, Down, Info }))
          downedStore.ListDataRaw.unshift({ DownID: completedDownId, Down, Info })
          downedStore.mRefreshListDataShow(true)
          await DBDown.saveDowned(completedDownId, downedData)
          if (downedStore.ListSelected.has(completedDownId)) {
            downedStore.ListSelected.delete(completedDownId)
          }
          // 移除Aria2已完成的任务
          await AriaDeleteList([Info.GID])
          i--
        } else if ((addDowningCount + downingStore.ListDataDowningCount) < downFileMax && !shouldSkipDown(Down)) {
          addDowningCount++
          downingStore.mUpdateDownState(DownItem, 'start')
          let state = await AriaAddUrl(DownItem)
          downingStore.mUpdateDownState(DownItem, state)
        }
      }
    } else {
      useFootStore().mSaveDownTotalSpeedInfo('')
    }
    await DownDAL.aCloud123OfflineProgress()
    await DownDAL.aPikPakOfflineProgress()
    await DownDAL.aGuangyaOfflineProgress()
    await DownDAL.aDrive115OfflineProgress()
    await DownDAL.aDropboxOfflineProgress()

    downingStore.mRefreshListDataShow(true)
    downedStore.mRefreshListDataShow(true)
  }

  /**
   * 速度事件方法
   */
  static mSpeedEvent(list: IAriaDownProgress[]) {
    const downingStore = useDowningStore()
    const settingStore = useSettingStore()
    const DowningList: IStateDownFile[] = downingStore.ListDataRaw
    const ariaRemote = !settingStore.AriaIsLocal

    const dellist: string[] = []
    const saveList: IStateDownFile[] = []

    let hasSpeed = 0

    for (const listItem of list) {
      try {
        const { gid, status, totalLength, completedLength, downloadSpeed, errorCode, errorMessage } = listItem
        const ariaReportedComplete = status === 'complete'
        const isStop = status === 'paused' || status === 'removed'
        const isError = status === 'error'
        const downingItem: IStateDownFile | undefined = DowningList.find((item) => item.Info.ariaRemote === ariaRemote && item.Info.GID === gid)
        if (!downingItem) continue
        const { DownID, Down, Info } = downingItem
        const isBtSource = Info.sourceType === 'magnet' || Info.sourceType === 'torrent' || Info.sourceType === 'torrent-url'
        const followedGid = resolveFollowedBtGid(listItem)
        if (followedGid && (Info.sourceType === 'magnet' || Info.sourceType === 'torrent-url')) {
          Info.GID = followedGid
          Down.IsCompleted = false
          Down.IsDowning = true
          Down.DownState = '解析完成，等待下载'
          saveList.push(downingItem)
          continue
        }
        const totalLengthInt = parseInt(totalLength) || 0
        if (isBtSource && totalLengthInt > 0) {
          Info.size = totalLengthInt
          Info.sizestr = humanSize(totalLengthInt)
        }
        const isComplete = ariaReportedComplete && (!isBtSource || isBtContentComplete(listItem))
        const isDowning = isComplete || status === 'active' || status === 'waiting'
        if (ariaReportedComplete && isBtSource && !isComplete) {
          Down.DownSize = parseInt(completedLength) || 0
          Down.DownSpeed = 0
          Down.DownSpeedStr = ''
          Down.DownProcess = totalLengthInt > 0 ? Math.min(99, Math.floor((Down.DownSize * 100) / totalLengthInt)) : 0
          Down.IsCompleted = false
          Down.IsDowning = true
          Down.IsFailed = false
          Down.IsStop = false
          Down.DownState = '元数据已解析，等待内容下载'
          saveList.push(downingItem)
          continue
        }
        Down.DownSize = parseInt(completedLength) || 0
        Down.DownSpeed = parseInt(downloadSpeed) || 0
        Down.DownSpeedStr = humanSize(Down.DownSpeed) + '/s'
        Down.DownProcess = Math.floor((Down.DownSize * 100) / (totalLengthInt + 1)) % 100
        Down.IsCompleted = isComplete
        Down.IsDowning = isDowning
        const errorState = resolveAriaProgressErrorState({ status, errorCode, errorMessage }, FormatAriaError)
        Down.IsFailed = errorState.isFailed
        // 保护 '队列中' 状态不被 Aria2 'paused' 覆盖（用户刚点开始，aria2.unpause 尚未生效）
        if (Down.DownState !== '队列中') {
          Down.IsStop = isStop
        }
        Down.FailedCode = errorState.failedCode
        Down.FailedMessage = errorState.failedMessage
        if (isComplete) {
          if (isBtSource) {
            const target = resolveBtDownloadTarget(listItem)
            if (target) {
              Info.localFilePath = target.localFilePath
              Info.name = target.name
              Info.isDir = target.isDir
              Info.icon = target.isDir ? 'iconfile-folder' : 'iconfile-bt'
            }
          }
          downingStore.mUpdateDownState(downingItem, 'valid')
          const check = AriaHashFile(downingItem)
          if (check.Check) {
            if (useSettingStore().downFinishAudio && !sound.playing()) {
              sound.play()
            }
            downingStore.mUpdateDownState(downingItem, 'downed')
            window.WebToElectron?.({ cmd: 'downloadCompleted', fileName: Info.name, showNotification: useSettingStore().ariaTaskNotification })
          } else {
            downingStore.mUpdateDownState(downingItem, 'error', '移动文件失败，请重新下载')
          }
        } else if (isStop && Down.DownState !== '队列中') {
          downingStore.mUpdateDownState(downingItem, 'stop')
          if (shouldRemoveAriaStoppedResult(status)) dellist.push(gid)
        } else if (isError) {
          downingStore.mUpdateDownState(downingItem, 'error', Down.FailedMessage)
          if (shouldRemoveAriaStoppedResult(status)) dellist.push(gid)
        } else if (isDowning) {
          hasSpeed += Down.DownSpeed
          let lastTime = ((totalLengthInt - Down.DownSize) / (Down.DownSpeed + 1)) % 356400
          if (lastTime < 1) lastTime = 1
          // 进度条
          Down.DownState =
            `${Down.DownProcess}% ${(lastTime / 3600).toFixed(0).padStart(2, '0')}:${((lastTime % 3600) / 60)
              .toFixed(0)
              .padStart(2, '0')}:${(lastTime % 60).toFixed(0).padStart(2, '0')}`
          if (SaveTimeWait > 10) {
            saveList.push(downingItem)
          }
        }
        downingStore.mRefreshListDataShow(true)
      } catch {
        // Ignore any errors
      }
    }
    // 存盘时间
    SaveTimeWait = (SaveTimeWait + 1) % 11
    if (saveList.length) {
      DBDown.saveDownings(JSON.parse(JSON.stringify(saveList)))
    }
    if (dellist.length) {
      AriaDeleteList(dellist).then()
    }
    useFootStore().mSaveDownTotalSpeedInfo(hasSpeed && humanSizeSpeed(hasSpeed) || '')

    const totalCount = DowningList.filter((d) => !d.Down.IsCompleted).length
    const activeCount = DowningList.filter((d) => d.Down.IsDowning && !d.Down.IsCompleted).length
    const totalBytes = DowningList.reduce((s, d) => s + (parseInt(String(d.Info.size)) || 0), 0)
    const doneBytes = DowningList.reduce((s, d) => s + (d.Down.DownSize || 0), 0)
    const overallProgress = totalBytes > 0 ? doneBytes / totalBytes : -1
    window.WebToElectron?.({ cmd: 'downloadProgress', progress: overallProgress, activeCount, totalCount })
  }

  static async deleteDowning(isAll: boolean, deleteList: IStateDownFile[], gidList: string[]) {
    // 处理待删除文件
    if (!isAll) {
      const downIDList = deleteList.map(item => item.DownID)
      // console.log('deleteDowning', deleteList)
      await DBDown.deleteDownings(JSON.parse(JSON.stringify(downIDList)))
    } else {
      await DBDown.deleteDowningAll()
    }
    // 停止aria2下载任务
    await AriaStopList(gidList)
    await AriaDeleteList(gidList)
    const pikpakTaskMap = new Map<string, string[]>()
    const drive115TaskMap = new Map<string, string[]>()
    for (const downFile of deleteList) {
      if (!downFile.Info.offlineTaskId) continue
      if (downFile.Info.offlineProvider === 'pikpak') {
        const list = pikpakTaskMap.get(downFile.Info.user_id) || []
        list.push(downFile.Info.offlineTaskId)
        pikpakTaskMap.set(downFile.Info.user_id, list)
      } else if (downFile.Info.offlineProvider === 'drive115') {
        const list = drive115TaskMap.get(downFile.Info.user_id) || []
        list.push(downFile.Info.offlineTaskId)
        drive115TaskMap.set(downFile.Info.user_id, list)
      }
    }
    if (pikpakTaskMap.size) {
      const { apiPikPakOfflineDelete } = await import('../pikpak/offline')
      for (const [userID, taskIds] of pikpakTaskMap) {
        await apiPikPakOfflineDelete(userID, taskIds)
      }
    }
    if (drive115TaskMap.size) {
      const { apiDrive115OfflineDelete } = await import('../cloud115/offline')
      for (const [userID, taskIds] of drive115TaskMap) {
        await apiDrive115OfflineDelete(userID, taskIds)
      }
    }
    // 删除临时文件
    for (let downFile of deleteList) {
      let downInfo = downFile.Info
      if (downInfo.offlineProvider) continue
      if (downInfo.ariaRemote) continue
      try {
        if (!downInfo.isDir) {
          let filePath = path.join(downInfo.DownSavePath, downInfo.name)
          let tmpFilePath1 = filePath + '.td.aria2'
          let tmpFilePath2 = filePath + '.td'
          const tmpFilePath3 = filePath + '.td.json'
          await fsPromises.rm(tmpFilePath1, { recursive: true })
          await fsPromises.rm(tmpFilePath2, { recursive: true })
          await fsPromises.rm(tmpFilePath3, { recursive: true })
        }
      } catch (e) {
      }
    }
  }

  static async deleteDowned(isAll: boolean, deleteList: IStateDownFile[]) {
    if (!isAll) {
      // 处理待删除状态
      const downIDList = deleteList
        .filter(list => list.Down.DownState === '待删除')
        .map(item => item.DownID)
      console.log('downedList', deleteList)
      await DBDown.deleteDowneds(JSON.parse(JSON.stringify(downIDList)))
    } else {
      await DBDown.deleteDownedAll()
    }
  }

  static async stopDowning(downList: IStateDownFile[], gidList: string[]) {
    await DBDown.saveDownings(JSON.parse(JSON.stringify(downList)))
    await AriaStopList(gidList)
  }

  static QueryIsDowning() {
    return useDowningStore().ListDataDowningCount > 0
  }

  static async aAddDropboxOfflineDownload(url: string, fileName: string, dirID: string | undefined) {
    const userID = useUserStore().user_id
    if (!userID) return { success: false, message: '请先登录' }
    const { buildDropboxUploadPath } = await import('../dropbox/upload')
    const { apiDropboxOfflineCreate } = await import('../dropbox/offline')
    const fallbackName = (() => {
      try { return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'download') } catch { return 'download' }
    })()
    const name = fileName || fallbackName
    const targetPath = buildDropboxUploadPath(dirID || 'dropbox_root', name)
    const resp = await apiDropboxOfflineCreate(userID, url, targetPath)
    if (!resp.taskId) return { success: false, message: resp.error || '创建 Dropbox 离线下载失败' }
    DownDAL.aTrackDropboxOfflineDownload(userID, url, name, dirID, resp.taskId)
    return { success: true, message: '' }
  }

  static aTrackDropboxOfflineDownload(userID: string, url: string, fileName: string, dirID: string | undefined, taskId: string) {
    useDowningStore().mAddDownload({ downlist: [{
      DownID: `${userID}|dropbox_offline_${taskId}`,
      Info: { GID: `dropbox_offline_${taskId}`, user_id: userID, DownSavePath: '', ariaRemote: false, file_id: '', drive_id: 'dropbox', name: fileName || url, size: 0, sizestr: '', icon: 'iconcloud-download', isDir: false, encType: '', sha1: '', crc64: '', offlineProvider: 'dropbox', offlineTaskId: taskId, offlineDirId: dirID || '' },
      Down: { DownState: '离线下载中', DownTime: Date.now(), DownSize: 0, DownSpeed: 0, DownSpeedStr: '', DownProcess: 0, IsStop: false, IsDowning: true, IsCompleted: false, IsFailed: false, FailedCode: 0, FailedMessage: '', AutoTry: 0, DownUrl: url }
    }] })
  }

  static async aAddCloud123OfflineDownload(url: string, fileName: string, dirID: string | undefined) {
    const userID = useUserStore().user_id
    if (!userID) return { success: false, message: '请先登录' }
    const { apiCloud123OfflineCreate } = await import('../cloud123/offline')
    const resp = await apiCloud123OfflineCreate(userID, url, fileName, dirID)
    if (!resp.taskId) return { success: false, message: resp.error || '创建离线下载失败' }
    DownDAL.aTrackCloud123OfflineDownload(userID, url, fileName, dirID, String(resp.taskId))
    return { success: true, message: '' }
  }

  static aTrackCloud123OfflineDownload(userID: string, url: string, fileName: string, dirID: string | undefined, taskId: string) {
    const downitem: IStateDownFile = {
      DownID: `${userID}|cloud123_offline_${taskId}`,
      Info: {
        GID: `cloud123_offline_${taskId}`,
        user_id: userID,
        DownSavePath: '',
        ariaRemote: false,
        file_id: '',
        drive_id: 'cloud123',
        name: fileName || url,
        size: 0,
        sizestr: '',
        icon: 'iconcloud-download',
        isDir: false,
        encType: '',
        sha1: '',
        crc64: '',
        offlineProvider: 'cloud123',
        offlineTaskId: taskId,
        offlineDirId: dirID || ''
      },
      Down: {
        DownState: '离线下载中',
        DownTime: Date.now(),
        DownSize: 0,
        DownSpeed: 0,
        DownSpeedStr: '',
        DownProcess: 0,
        IsStop: false,
        IsDowning: true,
        IsCompleted: false,
        IsFailed: false,
        FailedCode: 0,
        FailedMessage: '',
        AutoTry: 0,
        DownUrl: url
      }
    }
    useDowningStore().mAddDownload({ downlist: [downitem] })
  }

  static async aAddPikPakOfflineDownload(url: string, fileName: string, dirID: string | undefined) {
    const userID = useUserStore().user_id
    if (!userID) return { success: false, message: '请先登录' }
    const { apiPikPakOfflineCreate } = await import('../pikpak/offline')
    const resp = await apiPikPakOfflineCreate(userID, url, fileName, dirID)
    if (!resp.taskId && !resp.fileId) return { success: false, message: resp.error || '创建离线下载失败' }
    const taskId = String(resp.taskId || resp.fileId)
    DownDAL.aTrackPikPakOfflineDownload(userID, url, fileName, dirID, taskId, resp.fileId)
    return { success: true, message: '' }
  }

  static aTrackPikPakOfflineDownload(userID: string, url: string, fileName: string, dirID: string | undefined, taskId: string, fileId?: string) {
    const downitem: IStateDownFile = {
      DownID: `${userID}|pikpak_offline_${taskId}`,
      Info: {
        GID: `pikpak_offline_${taskId}`,
        user_id: userID,
        DownSavePath: '',
        ariaRemote: false,
        file_id: fileId || '',
        drive_id: 'pikpak',
        name: fileName || url,
        size: 0,
        sizestr: '',
        icon: 'iconcloud-download',
        isDir: false,
        encType: '',
        sha1: '',
        crc64: '',
        offlineProvider: 'pikpak',
        offlineTaskId: taskId,
        offlineDirId: dirID || ''
      },
      Down: {
        DownState: '离线下载中',
        DownTime: Date.now(),
        DownSize: 0,
        DownSpeed: 0,
        DownSpeedStr: '',
        DownProcess: 0,
        IsStop: false,
        IsDowning: true,
        IsCompleted: false,
        IsFailed: false,
        FailedCode: 0,
        FailedMessage: '',
        AutoTry: 0,
        DownUrl: url
      }
    }
    useDowningStore().mAddDownload({ downlist: [downitem] })
  }

  static async aAddGuangyaOfflineDownload(url: string, fileName: string, dirID: string | undefined) {
    const userID = useUserStore().user_id
    if (!userID) return { success: false, message: '请先登录' }
    const { apiGuangyaOfflineCreate } = await import('../guangya/offline')
    const resp = await apiGuangyaOfflineCreate(userID, url, fileName, dirID)
    if (!resp.taskId && !resp.fileId) return { success: false, message: resp.error || '创建离线下载失败' }
    const taskId = String(resp.taskId || resp.fileId)
    DownDAL.aTrackGuangyaOfflineDownload(userID, url, fileName, dirID, taskId, resp.fileId)
    return { success: true, message: '' }
  }

  static aTrackGuangyaOfflineDownload(userID: string, url: string, fileName: string, dirID: string | undefined, taskId: string, fileId?: string) {
    const downitem: IStateDownFile = {
      DownID: `${userID}|guangya_offline_${taskId}`,
      Info: {
        GID: `guangya_offline_${taskId}`,
        user_id: userID,
        DownSavePath: '',
        ariaRemote: false,
        file_id: fileId || '',
        drive_id: 'guangya',
        name: fileName || url,
        size: 0,
        sizestr: '',
        icon: 'iconcloud-download',
        isDir: false,
        encType: '',
        sha1: '',
        crc64: '',
        offlineProvider: 'guangya',
        offlineTaskId: taskId,
        offlineDirId: dirID || ''
      },
      Down: {
        DownState: '离线下载中',
        DownTime: Date.now(),
        DownSize: 0,
        DownSpeed: 0,
        DownSpeedStr: '',
        DownProcess: 0,
        IsStop: false,
        IsDowning: true,
        IsCompleted: false,
        IsFailed: false,
        FailedCode: 0,
        FailedMessage: '',
        AutoTry: 0,
        DownUrl: url
      }
    }
    useDowningStore().mAddDownload({ downlist: [downitem] })
  }

  static async aAddDrive115OfflineDownload(url: string, dirID: string | undefined) {
    const userID = useUserStore().user_id
    if (!userID) return { success: false, message: '请先登录' }
    const { apiDrive115OfflineCreate } = await import('../cloud115/offline')
    const resp = await apiDrive115OfflineCreate(userID, url, dirID)
    if (!resp.taskIds.length) return { success: false, message: resp.error || '创建 115 云下载失败' }
    DownDAL.aTrackDrive115OfflineDownload(userID, url, dirID, resp.taskIds)
    return { success: true, message: '' }
  }

  static aTrackDrive115OfflineDownload(userID: string, url: string, dirID: string | undefined, taskIds: string[], displayName?: string) {
    const downlist: IStateDownFile[] = taskIds.map(taskId => ({
      DownID: `${userID}|drive115_offline_${taskId}`,
      Info: {
        GID: `drive115_offline_${taskId}`,
        user_id: userID,
        DownSavePath: '',
        ariaRemote: false,
        file_id: '',
        drive_id: 'drive115',
        name: displayName || url,
        size: 0,
        sizestr: '',
        icon: 'iconcloud-download',
        isDir: false,
        encType: '',
        sha1: '',
        crc64: '',
        offlineProvider: 'drive115',
        offlineTaskId: taskId,
        offlineDirId: dirID || ''
      },
      Down: {
        DownState: '离线下载中',
        DownTime: Date.now(),
        DownSize: 0,
        DownSpeed: 0,
        DownSpeedStr: '',
        DownProcess: 0,
        IsStop: false,
        IsDowning: true,
        IsCompleted: false,
        IsFailed: false,
        FailedCode: 0,
        FailedMessage: '',
        AutoTry: 0,
        DownUrl: url
      }
    }))
    useDowningStore().mAddDownload({ downlist })
  }

  private static cloud123OfflineTick = 0

  private static dropboxOfflineTick = 0

  static async aDropboxOfflineProgress() {
    const list = useDowningStore().ListDataRaw
    if (!list.length) return
    DownDAL.dropboxOfflineTick = (DownDAL.dropboxOfflineTick + 1) % 5
    if (DownDAL.dropboxOfflineTick !== 0) return
    const { apiDropboxOfflineProcess } = await import('../dropbox/offline')
    const saveList: IStateDownFile[] = []
    for (const item of list) {
      if (item.Info.offlineProvider !== 'dropbox' || !item.Info.offlineTaskId || item.Down.IsCompleted || item.Down.IsFailed) continue
      const info = await apiDropboxOfflineProcess(item.Info.user_id, item.Info.offlineTaskId)
      if (info.complete) {
        item.Down.IsCompleted = true
        item.Down.IsDowning = false
        item.Down.DownState = '离线下载完成'
        item.Down.DownProcess = 100
      } else if (info.failed) {
        item.Down.IsFailed = true
        item.Down.IsDowning = false
        item.Down.DownState = '离线下载失败'
        item.Down.FailedMessage = info.error || 'Dropbox 离线下载失败'
      } else {
        item.Down.DownState = '离线下载中'
      }
      saveList.push(item)
    }
    if (saveList.length) await DBDown.saveDownings(JSON.parse(JSON.stringify(saveList)))
  }

  static async aCloud123OfflineProgress() {
    const downingStore = useDowningStore()
    const list = downingStore.ListDataRaw
    if (!list.length) return
    DownDAL.cloud123OfflineTick = (DownDAL.cloud123OfflineTick + 1) % 5
    if (DownDAL.cloud123OfflineTick !== 0) return
    const { apiCloud123OfflineProcess } = await import('../cloud123/offline')
    const saveList: IStateDownFile[] = []
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      if (item.Info.offlineProvider !== 'cloud123' || !item.Info.offlineTaskId) continue
      if (item.Down.IsCompleted || item.Down.IsFailed) continue
      const info = await apiCloud123OfflineProcess(item.Info.user_id, item.Info.offlineTaskId)
      if (info.error) {
        item.Down.IsFailed = true
        item.Down.IsDowning = false
        item.Down.DownState = '离线下载失败'
        item.Down.FailedMessage = info.error
        saveList.push(item)
        continue
      }
      const process = Math.max(0, Math.min(100, info.process))
      item.Down.DownProcess = process
      item.Down.DownSpeedStr = ''
      if (info.status === 2) {
        item.Down.IsCompleted = true
        item.Down.IsDowning = false
        item.Down.DownState = '离线下载完成'
        item.Down.DownProcess = 100
      } else if (info.status === 1) {
        item.Down.IsFailed = true
        item.Down.IsDowning = false
        item.Down.DownState = '离线下载失败'
      } else if (info.status === 3) {
        item.Down.IsDowning = true
        item.Down.DownState = `离线下载重试中 ${process}%`
      } else {
        item.Down.IsDowning = true
        item.Down.DownState = `离线下载中 ${process}%`
      }
      saveList.push(item)
    }
    if (saveList.length) {
      DBDown.saveDownings(JSON.parse(JSON.stringify(saveList)))
    }
  }

  private static pikpakOfflineTick = 0

  static async aPikPakOfflineProgress() {
    const downingStore = useDowningStore()
    const list = downingStore.ListDataRaw
    if (!list.length) return
    DownDAL.pikpakOfflineTick = (DownDAL.pikpakOfflineTick + 1) % 5
    if (DownDAL.pikpakOfflineTick !== 0) return
    const { apiPikPakOfflineProcess } = await import('../pikpak/offline')
    const saveList: IStateDownFile[] = []
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      if (item.Info.offlineProvider !== 'pikpak' || !item.Info.offlineTaskId) continue
      if (item.Down.IsCompleted || item.Down.IsFailed) continue
      const info = await apiPikPakOfflineProcess(item.Info.user_id, item.Info.offlineTaskId, item.Info.file_id)
      if (info.error) {
        item.Down.IsFailed = true
        item.Down.IsDowning = false
        item.Down.DownState = '离线下载失败'
        item.Down.FailedMessage = info.error
        saveList.push(item)
        continue
      }
      const process = Math.max(0, Math.min(100, info.process))
      item.Down.DownProcess = process
      item.Down.DownSpeedStr = ''
      if (info.status === 2) {
        item.Down.IsCompleted = true
        item.Down.IsDowning = false
        item.Down.DownState = '离线下载完成'
        item.Down.DownProcess = 100
      } else if (info.status === 1) {
        item.Down.IsFailed = true
        item.Down.IsDowning = false
        item.Down.DownState = '离线下载失败'
      } else if (info.status === 3) {
        item.Down.IsDowning = true
        item.Down.DownState = `离线下载等待中 ${process}%`
      } else {
        item.Down.IsDowning = true
        item.Down.DownState = `离线下载中 ${process}%`
      }
      saveList.push(item)
    }
    if (saveList.length) {
      DBDown.saveDownings(JSON.parse(JSON.stringify(saveList)))
    }
  }

  private static guangyaOfflineTick = 0

  static async aGuangyaOfflineProgress() {
    const downingStore = useDowningStore()
    const list = downingStore.ListDataRaw
    if (!list.length) return
    DownDAL.guangyaOfflineTick = (DownDAL.guangyaOfflineTick + 1) % 5
    if (DownDAL.guangyaOfflineTick !== 0) return
    const { apiGuangyaOfflineProcess } = await import('../guangya/offline')
    const saveList: IStateDownFile[] = []
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      if (item.Info.offlineProvider !== 'guangya' || !item.Info.offlineTaskId) continue
      if (item.Down.IsCompleted || item.Down.IsFailed) continue
      const info = await apiGuangyaOfflineProcess(item.Info.user_id, item.Info.offlineTaskId)
      if (info.error) {
        item.Down.IsFailed = true
        item.Down.IsDowning = false
        item.Down.DownState = '离线下载失败'
        item.Down.FailedMessage = info.error
        saveList.push(item)
        continue
      }
      const process = Math.max(0, Math.min(100, info.process))
      item.Down.DownProcess = process
      item.Down.DownSpeedStr = ''
      if (info.status === 2 || process >= 100) {
        item.Down.IsCompleted = true
        item.Down.IsDowning = false
        item.Down.DownState = '离线下载完成'
        item.Down.DownProcess = 100
      } else if (info.status === 4) {
        item.Down.IsFailed = true
        item.Down.IsDowning = false
        item.Down.DownState = '离线下载失败'
      } else if (info.status === 3) {
        item.Down.IsDowning = true
        item.Down.DownState = `离线下载等待中 ${process}%`
      } else {
        item.Down.IsDowning = true
        item.Down.DownState = `离线下载中 ${process}%`
      }
      saveList.push(item)
    }
    if (saveList.length) {
      DBDown.saveDownings(JSON.parse(JSON.stringify(saveList)))
    }
  }

  private static drive115OfflineTick = 0

  static async aDrive115OfflineProgress() {
    const downingStore = useDowningStore()
    const list = downingStore.ListDataRaw
    if (!list.length) return
    DownDAL.drive115OfflineTick = (DownDAL.drive115OfflineTick + 1) % 5
    if (DownDAL.drive115OfflineTick !== 0) return
    const { apiDrive115OfflineProcess } = await import('../cloud115/offline')
    const saveList: IStateDownFile[] = []
    for (const item of list) {
      if (item.Info.offlineProvider !== 'drive115' || !item.Info.offlineTaskId) continue
      if (item.Down.IsCompleted || item.Down.IsFailed) continue
      const info = await apiDrive115OfflineProcess(item.Info.user_id, item.Info.offlineTaskId)
      if (info.error) {
        item.Down.IsFailed = true
        item.Down.IsDowning = false
        item.Down.DownState = '离线下载失败'
        item.Down.FailedMessage = info.error
      } else {
        item.Down.DownProcess = info.process
        item.Down.DownSize = info.size > 0 ? Math.floor(info.size * info.process / 100) : item.Down.DownSize
        if (info.name) item.Info.name = info.name
        if (info.size) item.Info.size = info.size
        if (info.status === 2 || info.process >= 100) {
          item.Down.IsCompleted = true
          item.Down.IsDowning = false
          item.Down.DownState = '离线下载完成'
          item.Down.DownProcess = 100
        } else if (info.status === -1) {
          item.Down.IsFailed = true
          item.Down.IsDowning = false
          item.Down.DownState = '离线下载失败'
        } else {
          item.Down.IsDowning = true
          item.Down.DownState = `离线下载中 ${info.process}%`
        }
      }
      saveList.push(item)
    }
    if (saveList.length) DBDown.saveDownings(JSON.parse(JSON.stringify(saveList)))
  }
}
