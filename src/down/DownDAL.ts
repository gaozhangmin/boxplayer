import { IAliGetFileModel } from '../aliapi/alimodels'
import path from 'path'
import TreeStore from '../store/treestore'
import { useDownedStore, useDowningStore, useFootStore, useSettingStore, useUserStore } from '../store'
import { ClearFileName } from '../utils/filehelper'
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

  size: number
  sizestr: string
  icon: string
  isDir: boolean
  encType: string

  sha1: string

  crc64: string

  localFilePath?: string
  downloadHeaders?: Record<string, string>
  offlineProvider?: 'cloud123' | 'pikpak'
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
    if (downedStore.ListLoading) return
    downedStore.ListLoading = true
    const max = useSettingStore().debugDownedListMax
    const showlist = await DBDown.getDownedByTop(max)
    const count = await DBDown.getDownedTaskCount()
    downedStore.aLoadListData(showlist, count)
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
  static aAddDownload(fileList: IAliGetFileModel[], savePath: string, needPanPath: boolean) {
    const userID = useUserStore().user_id
    const settingStore = useSettingStore()

    if (savePath.endsWith('/') || savePath.endsWith('\\')) {
      savePath = savePath.substr(0, savePath.length - 1)
    }

    const downlist: IStateDownFile[] = []
    const dTime = Date.now()

    let cPid = ''
    let cPath = ''
    const ariaRemote = settingStore.downUseAria2c && settingStore.ariaState == 'remote'
    const sep = settingStore.ariaSavePath.indexOf('/') >= 0 ? '/' : '\\'
    for (let f = 0; f < fileList.length; f++) {
      const file = fileList[f]
      const name = ClearFileName(DecodeEncName(userID, file).name)
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
        DownID: userID + '|' + file.file_id,
        Info: {
          GID: gid,
          user_id: userID,
          DownSavePath: fullPath,
          ariaRemote: ariaRemote,
          file_id: file.file_id,
          drive_id: file.drive_id,
          name: name,
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
      if (downitem.Info.ariaRemote && !downitem.Info.isDir) downitem.Info.icon = 'iconfont iconcloud-download'
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
    const ariaRemote = settingStore.downUseAria2c && settingStore.ariaState == 'remote'
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
        icon: params.icon || 'iconfont iconcloud-download',
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
    const ariaRemote = settingStore.downUseAria2c && !settingStore.AriaIsLocal

    const dellist: string[] = []
    const saveList: IStateDownFile[] = []

    let hasSpeed = 0

    for (const listItem of list) {
      try {
        const { gid, status, totalLength, completedLength, downloadSpeed, errorCode, errorMessage } = listItem
        const isComplete = status === 'complete'
        const isDowning = isComplete || status === 'active' || status === 'waiting'
        const isStop = status === 'paused' || status === 'removed'
        const isError = status === 'error'
        const downingItem: IStateDownFile | undefined = DowningList.find((item) => item.Info.ariaRemote === ariaRemote && item.Info.GID === gid)
        if (!downingItem) continue
        const { DownID, Down, Info } = downingItem
        const totalLengthInt = parseInt(totalLength) || 0
        Down.DownSize = parseInt(completedLength) || 0
        Down.DownSpeed = parseInt(downloadSpeed) || 0
        Down.DownSpeedStr = humanSize(Down.DownSpeed) + '/s'
        Down.DownProcess = Math.floor((Down.DownSize * 100) / (totalLengthInt + 1)) % 100
        Down.IsCompleted = isComplete
        Down.IsDowning = isDowning
        Down.IsFailed = isError
        Down.IsStop = isStop
        if (errorCode && errorCode !== '0') {
          Down.FailedCode = parseInt(errorCode) || 0
          Down.FailedMessage = FormatAriaError(errorCode, errorMessage)
        }
        if (isComplete) {
          downingStore.mUpdateDownState(downingItem, 'valid')
          const check = AriaHashFile(downingItem)
          if (check.Check) {
            if (useSettingStore().downFinishAudio && !sound.playing()) {
              sound.play()
            }
            downingStore.mUpdateDownState(downingItem, 'downed')
          } else {
            downingStore.mUpdateDownState(downingItem, 'error', '移动文件失败，请重新下载')
          }
        } else if (isStop) {
          downingStore.mUpdateDownState(downingItem, 'stop')
          if (shouldRemoveAriaStoppedResult(status)) dellist.push(gid)
        } else if (isError) {
          if (!Down.FailedMessage) {
            Down.FailedMessage = '下载失败'
          }
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
    for (const downFile of deleteList) {
      if (downFile.Info.offlineProvider !== 'pikpak' || !downFile.Info.offlineTaskId) continue
      const list = pikpakTaskMap.get(downFile.Info.user_id) || []
      list.push(downFile.Info.offlineTaskId)
      pikpakTaskMap.set(downFile.Info.user_id, list)
    }
    if (pikpakTaskMap.size) {
      const { apiPikPakOfflineDelete } = await import('../pikpak/offline')
      for (const [userID, taskIds] of pikpakTaskMap) {
        await apiPikPakOfflineDelete(userID, taskIds)
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

  static async aAddCloud123OfflineDownload(url: string, fileName: string, dirID: string | undefined) {
    const userID = useUserStore().user_id
    if (!userID) return { success: false, message: '请先登录' }
    const { apiCloud123OfflineCreate } = await import('../cloud123/offline')
    const resp = await apiCloud123OfflineCreate(userID, url, fileName, dirID)
    if (!resp.taskId) return { success: false, message: resp.error || '创建离线下载失败' }
    const downitem: IStateDownFile = {
      DownID: `${userID}|cloud123_offline_${resp.taskId}`,
      Info: {
        GID: `cloud123_offline_${resp.taskId}`,
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
        offlineTaskId: String(resp.taskId),
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
    return { success: true, message: '' }
  }

  static async aAddPikPakOfflineDownload(url: string, fileName: string, dirID: string | undefined) {
    const userID = useUserStore().user_id
    if (!userID) return { success: false, message: '请先登录' }
    const { apiPikPakOfflineCreate } = await import('../pikpak/offline')
    const resp = await apiPikPakOfflineCreate(userID, url, fileName, dirID)
    if (!resp.taskId && !resp.fileId) return { success: false, message: resp.error || '创建离线下载失败' }
    const taskId = String(resp.taskId || resp.fileId)
    const downitem: IStateDownFile = {
      DownID: `${userID}|pikpak_offline_${taskId}`,
      Info: {
        GID: `pikpak_offline_${taskId}`,
        user_id: userID,
        DownSavePath: '',
        ariaRemote: false,
        file_id: resp.fileId,
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
    return { success: true, message: '' }
  }

  private static cloud123OfflineTick = 0

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
}
