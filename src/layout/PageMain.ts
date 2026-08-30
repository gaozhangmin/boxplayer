import ServerHttp from '../aliapi/server'
import { useAppStore, useFootStore, usePanTreeStore, useSettingStore } from '../store'
import AppCache from '../utils/appcache'
import DownDAL from '../down/DownDAL'
import UploadDAL from '../transfer/uploaddal'
import ShareDAL from '../share/share/ShareDAL'

import UserDAL from '../user/userdal'
import DebugLog from '../utils/debuglog'
import PanDAL from '../pan/pandal'
import UploadingDAL from '../transfer/uploadingdal'
import { Sleep } from '../utils/format'
import { createProxyServer } from '../utils/proxyhelper'
import cache from '../utils/cache'
import WebDavServer from '../module/webdav'
import message from '../utils/message'
import { startBackgroundStartupTasks } from '../utils/startupTask'

export function PageMain() {
  if (window.WinMsg) return
  window.WinMsg = WinMsg
  //useSettingStore().WebSetProxy()
  Promise.resolve()
    .then(async () => {
      // DebugLog.mSaveSuccess('小白羊启动')
      void ShareDAL.aLoadFromDB().catch((err: any) => {
        DebugLog.mSaveDanger('ShareDALLDB', err)
      })
      // 加载数据库用户
      await UserDAL.aLoadFromDB().catch((err: any) => {
        DebugLog.mSaveDanger('UserDALLDB', err)
      })
    })
    .then(() => {
      startBackgroundStartupTasks([
        {
          label: 'CreateProxyServer',
          run: async () => {
            if (window.MainProxyServer) return
            window.MainProxyHost = useSettingStore().debugProxyHost
            window.MainProxyPort = useSettingStore().debugProxyPort
            window.MainProxyServer = await createProxyServer(window.MainProxyPort)
            window.MainProxyServer.on('close', async () => {
              await Sleep(2000)
              window.MainProxyServer = await createProxyServer(window.MainProxyPort)
            })
          }
        },
        {
          label: 'CheckUpgrade',
          run: async () => {
            await Sleep(1500)
            if (!useSettingStore().uiLaunchAutoCheckUpdate) return
            const state = await window.AutoUpdateCheck?.(false)
            if (state?.status === 'downloading') message.info(state.version ? `发现新版本 ${state.version}，正在后台下载` : '发现新版本，正在后台下载')
          }
        },
        {
          label: 'RestoreTransferState',
          run: async () => {
            await Sleep(500)
            await DownDAL.aReloadDowning()
            await DownDAL.aReloadDowned()
            await UploadingDAL.aReloadUploading()
            await UploadDAL.aReloadUploaded()
          }
        },
        {
          label: 'AppStorageSize',
          run: async () => {
            await Sleep(1500)
            await AppCache.aLoadStorageSize()
          }
        },
        {
          label: 'StartWebDav',
          run: async () => {
            if (!useSettingStore().webDavAutoEnable) {
              useSettingStore().webDavEnable = false
              return
            }
            await WebDavServer.config({
              port: useSettingStore().webDavPort,
              hostname: useSettingStore().webDavHost,
              requireAuthentification: false
            }).start()
            useSettingStore().webDavEnable = WebDavServer.isStarted()
          }
        }
      ], (label, err: any) => {
        if (label === 'StartWebDav') useSettingStore().webDavEnable = false
        DebugLog.mSaveDanger(label, err)
      })
      setTimeout(timeEvent, 1000)
    })
    .catch((err: any) => {
      DebugLog.mSaveDanger('LoadSettingFromDB', err)
    })
}

export const WinMsg = async (arg: any) => {
  if (arg.cmd == 'MainUploadEvent') {
    if (arg.ReportList.length > 0 && arg.ReportList.length != arg.RunningKeys.length) {
      console.log('RunningKeys', arg)
    }
    if (arg.StopKeys.length > 0) console.log('StopKeys', arg)
    UploadingDAL.aUploadingEvent(arg.ReportList, arg.ErrorList, arg.SuccessList, arg.RunningKeys, arg.StopKeys, arg.LoadingKeys, arg.SpeedTotal)
  } else if (arg.cmd == 'MainUploadAppendFiles') {
    UploadingDAL.aUploadingAppendFiles(arg.TaskID, arg.UploadID, arg.CreatedDirID, arg.AppendList)
  } else if (arg.cmd == 'MainSaveAllDir') {
    PanDAL.aReLoadDriveSave(arg.OneDriver, arg.ErrorMessage, arg.drive_id)
  } else if (arg.cmd == 'MainShowAllDirProgress') {
    PanDAL.aReLoadDriveProgress(arg.drive_id, arg.index, arg.total)
  }
}

let runTime = Math.floor(Date.now() / 1000)
let chkUpgradeTime1 = Math.floor(Date.now() / 1000)
let chkUpgradeTime2 = Math.floor(Date.now() / 1000)
let chkBackupDirSizeTime = 0
let chkResourceDirSizeTime = 0
let lockBackupDirSizeTime = false
let lockResourceDirSizeTime = false
let chkClearDownLogTime = 0
let chkTokenTime = 0
let chkTaskTime = 0
let chkDanmuTime = 0

/**
 * 时间事件，一但被调用每秒执行一次 <br/>
 * 可以理解为定时任务，根据不同的时间节点执行不同的任务
 */
function timeEvent() {
  const settingStore = useSettingStore()

  const nowTime = Math.floor(Date.now() / 1000)

  // 24小时重置
  if (nowTime - runTime > 60 * 60 * 24) {
    runTime = nowTime
    chkBackupDirSizeTime = 0
    chkResourceDirSizeTime = 0
  }

  // 启动时检查一次
  if (chkUpgradeTime1 > 0 && nowTime - chkUpgradeTime1 > 360) {
    chkUpgradeTime1 = -1
    ServerHttp.CheckConfigUpgrade().catch((err: any) => {
      DebugLog.mSaveDanger('CheckConfigUpgrade', err)
    })
  }
  // 14300s检查一次
  if (nowTime - chkUpgradeTime2 > 14300) {
    chkUpgradeTime2 = nowTime
    ServerHttp.CheckConfigUpgrade().catch((err: any) => {
      DebugLog.mSaveDanger('CheckConfigUpgrade', err)
    })
  }

  // 自动刷新文件夹大小，10s检查一次
  if (settingStore.uiFolderSize
    && !lockBackupDirSizeTime
    && nowTime - runTime > 50
    && chkBackupDirSizeTime >= 10) {
    lockBackupDirSizeTime = true
    PanDAL.aUpdateDirFileSize(usePanTreeStore().backup_drive_id)
      .catch((err: any) => {
        DebugLog.mSaveDanger('aUpdateBackupDirFileSize', err)
      })
      .then(() => {
        chkBackupDirSizeTime = 0
        lockBackupDirSizeTime = false
      })
  } else chkBackupDirSizeTime++
  // 自动刷新文件夹大小，15s检查一次
  if (settingStore.uiFolderSize
    && !lockResourceDirSizeTime
    && nowTime - runTime > 50
    && chkResourceDirSizeTime >= 15) {
    lockResourceDirSizeTime = true

    PanDAL.aUpdateDirFileSize(usePanTreeStore().resource_drive_id)
      .catch((err: any) => {
        DebugLog.mSaveDanger('aUpdateResourceDirFileSize', err)
      })
      .then(() => {
        chkResourceDirSizeTime = 0
        lockResourceDirSizeTime = false
      })
  } else chkResourceDirSizeTime++

  // 自动清除上传下载日志，540s检查一次
  chkClearDownLogTime++
  if (nowTime - runTime > 60 && chkClearDownLogTime >= 540) {
    chkClearDownLogTime = 0
    UploadDAL.aClearUploaded().catch((err: any) => {
      DebugLog.mSaveDanger('aClearUploaded ', err)
    })
    DownDAL.aClearDowned().catch((err: any) => {
      DebugLog.mSaveDanger('aClearDowned ', err)
    })
  }

  // 自动刷新Token，600s检查一次
  chkTokenTime++
  if (nowTime - runTime > 10 && chkTokenTime >= 600) {
    chkTokenTime = 0
    UserDAL.aRefreshAllUserToken().catch((err: any) => {
      DebugLog.mSaveDanger('aRefreshAllUserToken', err)
    })
  }

  // 异步任务，2s检查一次
  chkTaskTime++
  if (nowTime - runTime > 6 && chkTaskTime >= 2) {
    chkTaskTime = 0
    useFootStore().aUpdateTask()
  }

  // 清理弹幕缓存，300s检查一次
  chkDanmuTime++
  if (nowTime - runTime > 6 && chkDanmuTime >= 60 * 5) {
    chkDanmuTime = 0
    cache.clearOutDate()
  }

  // 刷新下载速度
  if (!window.WebIsE2E || window.WebE2EAllowTransfers) {
    DownDAL.aSpeedEvent().catch((err: any) => {
      DebugLog.mSaveDanger('aSpeedEvent', err)
    })
  }

  // 没有下载和上传时触发自动关闭
  if (settingStore.downAutoShutDown == 2) {
    if (!DownDAL.QueryIsDowning() && !UploadingDAL.QueryIsUploading()) {
      settingStore.downAutoShutDown = 0
      useAppStore().appShutDown = true
    }
  }

  setTimeout(timeEvent, 1000)
}
