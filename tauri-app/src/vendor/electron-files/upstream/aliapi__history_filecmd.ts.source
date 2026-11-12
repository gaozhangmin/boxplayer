import DebugLog from '../utils/debuglog'
import AliHttp from './alihttp'
import { IAliFileItem, IAliGetFileModel } from './alimodels'
import AliDirFileList from './dirfilelist'
import { ApiBatch, ApiBatchMaker, ApiBatchMaker2, ApiBatchSuccess, EncodeEncName } from './utils'
import { IDownloadUrl } from './models'
import AliFile from './file'
import message from '../utils/message'
import usePanFileStore from '../pan/panfilestore'
import { isWebDavDrive } from '../utils/webdavClient'
import UserDAL from '../user/userdal'
import { resolveDriveProvider } from '../utils/driveProvider'
import { cleanProviderTrash, copyProviderFiles, createProviderFolder, deleteProviderFiles, getProviderFileCommandContext, getProviderFileCommandNotice, getProviderFilesInfo, getProviderFolderCommandContext, moveProviderFiles, renameProviderFiles, restoreProviderTrash, trashProviderFiles, type ProviderFileCommandOptions } from '../drive/providerFileCmd'

export default class AliFileCmd {
  static async ApiCreatNewForder(
    user_id: string, drive_id: string,
    parent_file_id: string, creatDirName: string,
    encType: string = '', check_name_mode: string = 'refuse', providerOptions: ProviderFileCommandOptions = {}
  ): Promise<{ file_id: string; error: string }> {
    const result = { file_id: '', error: '新建文件夹失败' }
    if (!user_id || !drive_id || !parent_file_id) return result
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid) return { file_id: '', error: route.error }
    if (isWebDavDrive(drive_id)) {
      return { file_id: '', error: 'WebDAV / AList 文件源为只读' }
    }
    if (route.provider !== 'aliyun') return createProviderFolder(route.provider, user_id, parent_file_id, creatDirName, { checkNameMode: check_name_mode, ...getProviderFolderCommandContext(route.provider, parent_file_id), ...providerOptions })
    if (parent_file_id.includes('root')) parent_file_id = 'root'
    const url = 'adrive/v2/file/createWithFolders'
    const name = EncodeEncName(user_id, creatDirName, true, encType)
    const postData = JSON.stringify({
      drive_id: drive_id,
      parent_file_id: parent_file_id,
      name: name,
      check_name_mode: check_name_mode,
      type: 'folder',
      description: encType
    })
    const resp = await AliHttp.Post(url, postData, user_id, '')
    if (AliHttp.IsSuccess(resp.code)) {
      const file_id = resp.body.file_id as string | undefined
      if (file_id) return { file_id, error: '' }
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiCreatNewForder err=' + parent_file_id + ' ' + (resp.code || ''), resp.body)
    }
    if (resp.body?.code == 'QuotaExhausted.Drive') return { file_id: '', error: '网盘空间已满,无法创建' }
    if (resp.body?.code) return { file_id: '', error: resp.body?.code }
    return result
  }


  static async ApiTrashBatch(user_id: string, drive_id: string, file_idList: string[]): Promise<string[]> {
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid) return []
    if (isWebDavDrive(drive_id)) {
      return []
    }
    if (route.provider !== 'aliyun') return trashProviderFiles(route.provider, user_id, file_idList, getProviderFileCommandContext(route.provider, file_idList))
    const batchList = ApiBatchMaker('/recyclebin/trash', file_idList, (file_id: string) => {
      return { drive_id: drive_id, file_id: file_id }
    })
    return ApiBatchSuccess('放入回收站', batchList, user_id, '')
  }


  static async ApiDeleteBatch(user_id: string, drive_id: string, file_idList: string[]): Promise<string[]> {
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid) return []
    if (isWebDavDrive(drive_id)) {
      return []
    }
    const notice = getProviderFileCommandNotice(route.provider, 'delete')
    if (notice) {
      message.info(notice)
      return []
    }
    if (route.provider !== 'aliyun') return deleteProviderFiles(route.provider, user_id, file_idList, getProviderFileCommandContext(route.provider, file_idList))
    const batchList = ApiBatchMaker('/file/delete', file_idList, (file_id: string) => {
      return { drive_id: drive_id, file_id: file_id }
    })
    return ApiBatchSuccess('彻底删除', batchList, user_id, '')
  }


  static async ApiRenameBatch(user_id: string, drive_id: string, file_idList: string[], names: string[]): Promise<{
    file_id: string;
    parent_file_id: string;
    name: string;
    isDir: boolean
  }[]> {
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid) return []
    if (isWebDavDrive(drive_id)) {
      return []
    }
    if (route.provider !== 'aliyun') return renameProviderFiles(route.provider, user_id, file_idList, names, getProviderFileCommandContext(route.provider, file_idList))
    const batchList = ApiBatchMaker2('/file/update', file_idList, names, (file_id: string, name: string) => {
      return { drive_id: drive_id, file_id: file_id, name: name, check_name_mode: 'refuse' }
    })

    if (batchList.length == 0) return Promise.resolve([])
    const successList: { file_id: string; parent_file_id: string; name: string; isDir: boolean }[] = []
    const result = await ApiBatch(file_idList.length <= 1 ? '' : '批量重命名', batchList, user_id, '')
    result.reslut.map((t) => successList.push({
      file_id: t.file_id!,
      name: t.name!,
      parent_file_id: t.parent_file_id!,
      isDir: t.type !== 'folder'
    }))
    return successList
  }


  static async ApiFavorBatch(user_id: string, drive_id: string, isfavor: boolean, ismessage: boolean, file_idList: string[]): Promise<string[]> {
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid || route.provider !== 'aliyun') {
      if (ismessage) message.info('当前网盘暂不支持收藏操作')
      return []
    }
    const batchList = ApiBatchMaker('/file/update', file_idList, (file_id: string) => {
      return { drive_id: drive_id, file_id: file_id, custom_index_key: isfavor ? 'starred_yes' : '', starred: isfavor }
    })
    return ApiBatchSuccess(ismessage ? (isfavor ? '收藏文件' : '取消收藏') : '', batchList, user_id, '')
  }


  static async ApiTrashCleanBatch(user_id: string, drive_id: string, ismessage: boolean, file_idList: string[]): Promise<string[]> {
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid) return []
    if (route.provider !== 'aliyun') {
      const result = await cleanProviderTrash(route.provider, user_id, file_idList, getProviderFileCommandContext(route.provider, file_idList))
      if (result.length || !ismessage) return result
      message.info(getProviderFileCommandNotice(route.provider, 'trashClean') || '当前网盘暂不支持彻底删除回收站文件')
      return result
    }
    const batchList = ApiBatchMaker('/file/delete', file_idList, (file_id: string) => {
      return { drive_id: drive_id, file_id: file_id }
    })
    return ApiBatchSuccess(ismessage ? '从回收站删除' : '', batchList, user_id, '')
  }


  static async ApiTrashRestoreBatch(user_id: string, drive_id: string, ismessage: boolean, file_idList: string[]): Promise<string[]> {
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid) return []
    if (route.provider !== 'aliyun') {
      const result = await restoreProviderTrash(route.provider, user_id, file_idList, getProviderFileCommandContext(route.provider, file_idList))
      if (result.length || !ismessage) return result
      message.info(getProviderFileCommandNotice(route.provider, 'trashRestore') || '当前网盘暂不支持恢复回收站文件')
      return result
    }
    const batchList = ApiBatchMaker('/recyclebin/restore', file_idList, (file_id: string) => {
      return { drive_id: drive_id, file_id: file_id }
    })
    return ApiBatchSuccess(ismessage ? '从回收站还原' : '', batchList, user_id, '')
  }

  static async ApiFileHistoryBatch(user_id: string, drive_id: string, file_idList: string[]) {
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid || route.provider !== 'aliyun') return []
    let allTask = []
    const loadingKey = 'filehistorybatch' + Date.now().toString()
    message.loading('清除历史 执行中...', 60, loadingKey)
    for (const file_id of file_idList) {
      allTask.push(AliFile.ApiUpdateVideoTime(user_id, drive_id, file_id, 0))
      if (allTask.length >= 3) {
        await Promise.all(allTask).catch()
        allTask = []
      }
    }
    if (allTask.length > 0) {
      await Promise.all(allTask).catch()
    }
    message.success('成功执行 清除历史', 1, loadingKey)
  }

  static async ApiFileColorBatch(user_id: string, drive_id: string, description: string, color: string, file_idList: string[]) {
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid) return []
    if (isWebDavDrive(drive_id)) return
    if (route.provider !== 'aliyun') return
    // 防止加密标记清空
    let parts = description.split(',') || []
    let encryptPart = parts.find((part: any) => part.includes('xbyEncrypt')) || ''
    let colorPart = parts.find((part: any) => /c.{6}$/.test(part)) || ''
    if (color) {
      if (color.includes('xbyEncrypt')) {
        encryptPart = color
      } else if (color === 'notEncrypt') {
        encryptPart = ''
      } else {
        colorPart = color
      }
    }
    color = color ? [encryptPart, colorPart].filter(Boolean).join(',') : encryptPart
    let batchList = ApiBatchMaker('/file/update', file_idList, (file_id: string) => {
      return { drive_id: drive_id, file_id: file_id, description: color }
    })
    let title = ''
    if (color == '' || color == 'notEncrypt') {
      title = '清除标记'
    } else if (color.includes('ce74c3c')) {
      title = ''
    } else if (color.includes('xbyEncrypt')) {
      title = '标记加密'
    }
    let successList = await ApiBatchSuccess(title, batchList, user_id, '')
    usePanFileStore().mColorFiles(color, successList)
  }


  static async ApiRecoverBatch(user_id: string, resumeList: {
    drive_id: string;
    file_id: string;
    content_hash: string;
    size: number;
    name: string
  }[]): Promise<string[] | string> {
    const successList: string[] = []
    if (!resumeList || resumeList.length == 0) return Promise.resolve(successList)
    const route = resolveDriveProvider(user_id, '', UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid || route.provider !== 'aliyun') return successList

    const url = 'adrive/v1/file/resumeDeleted'
    const postData = JSON.stringify({ resume_file_list: resumeList })
    const resp = await AliHttp.Post(url, postData, user_id, '')
    if (AliHttp.IsSuccess(resp.code)) {
      const task_id = resp.body.task_id as string
      if (!user_id || !task_id) return []
      for (let j = 0; j < 100; j++) {
        const url2 = 'adrive/v1/file/checkResumeTask'
        const resp2 = await AliHttp.Post(url2, { task_id }, user_id, '')
        if (AliHttp.IsSuccess(resp2.code)) {

          if (resp2.body.state == 'running') continue
          if (resp2.body.state == 'done') {
            const results = resp2.body.results as any[]
            if (results) {
              results.map((t: any) => {
                if (t.status && t.status == 200) successList.push(t.file_id)
                return true
              })
            }
            return successList
          }
        }
      }
    } else if (resp.code && resp.code == 403) {
      if (resp.body?.code == 'UserNotVip') return '文件恢复功能需要开通阿里云盘会员'
      else return resp.body?.code || '拒绝访问'
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiRecoverBatch err=' + (resp.code || ''), resp.body)
      return '操作失败'
    }
    return successList
  }


  static async ApiMoveBatch(user_id: string, drive_id: string, file_idList: string[], to_drive_id: string, to_parent_file_id: string, to_parent_description: string = ''): Promise<string[]> {
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    const targetRoute = resolveDriveProvider(user_id, to_drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid || !targetRoute.isValid) return []
    if (isWebDavDrive(drive_id)) {
      return []
    }
    if (route.provider !== 'aliyun') {
      return moveProviderFiles(route.provider, user_id, file_idList, to_parent_file_id, { parentDescription: to_parent_description, ...getProviderFileCommandContext(route.provider, file_idList, to_parent_file_id, to_parent_description) })
    }
    if (to_parent_file_id.includes('root')) to_parent_file_id = 'root'
    const batchList = ApiBatchMaker('/file/move', file_idList, (file_id: string) => {
      if (drive_id == to_drive_id) return {
        drive_id: drive_id,
        file_id: file_id,
        to_parent_file_id: to_parent_file_id,
        auto_rename: true
      }
      else return {
        drive_id: drive_id,
        file_id: file_id,
        to_drive_id: to_drive_id,
        to_parent_file_id: to_parent_file_id,
        auto_rename: true
      }
    })
    return ApiBatchSuccess(file_idList.length <= 1 ? '移动' : '批量移动', batchList, user_id, '')
  }


  static async ApiCopyBatch(user_id: string, drive_id: string, file_idList: string[], to_drive_id: string, to_parent_file_id: string, to_parent_description: string = ''): Promise<string[]> {
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    const targetRoute = resolveDriveProvider(user_id, to_drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid || !targetRoute.isValid) return []
    if (isWebDavDrive(drive_id)) {
      return []
    }
    const notice = getProviderFileCommandNotice(route.provider, 'copy')
    if (notice) {
      message.info(notice)
      return []
    }
    if (route.provider !== 'aliyun') {
      const selectedNames = new Map(usePanFileStore().GetSelected().map((item) => [item.file_id, item.name]))
      return copyProviderFiles(route.provider, user_id, file_idList, to_parent_file_id, { parentDescription: to_parent_description, names: selectedNames, ...getProviderFileCommandContext(route.provider, file_idList, to_parent_file_id, to_parent_description) })
    }
    if (to_parent_file_id.includes('root')) to_parent_file_id = 'root'
    const batchList = ApiBatchMaker('/file/copy', file_idList, (file_id: string) => {
      if (drive_id == to_drive_id) return {
        drive_id: drive_id,
        file_id: file_id,
        to_parent_file_id: to_parent_file_id,
        auto_rename: true
      }
      else return {
        drive_id: drive_id,
        file_id: file_id,
        to_drive_id: to_drive_id,
        to_parent_file_id: to_parent_file_id,
        auto_rename: true
      }
    })
    return ApiBatchSuccess(file_idList.length <= 1 ? '复制' : '批量复制', batchList, user_id, '')
  }


  static async ApiGetFileBatch(user_id: string, drive_id: string, file_idList: string[]): Promise<IAliGetFileModel[]> {
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid) return []
    if (route.provider !== 'aliyun') return getProviderFilesInfo(route.provider, user_id, file_idList)
    const batchList = ApiBatchMaker('/file/get', file_idList, (file_id: string) => {
      return {
        drive_id: drive_id,
        file_id: file_id,
        url_expire_sec: 14400,
        office_thumbnail_process: 'image/resize,w_400/format,jpeg',
        image_thumbnail_process: 'image/resize,w_400/format,jpeg',
        image_url_process: 'image/resize,w_1920/format,jpeg',
        video_thumbnail_process: 'video/snapshot,t_106000,f_jpg,ar_auto,m_fast,w_400'
      }
    })
    const successList: IAliGetFileModel[] = []
    const result = await ApiBatch('', batchList, user_id, '')
    result.reslut.map((t) => {
      if (t.body) successList.push(AliDirFileList.getFileInfo(user_id, t.body as IAliFileItem, 'download_url'))
      return true
    })
    return successList
  }

  static async ApiGetFileDownloadUrlBatch(user_id: string, drive_id: string, file_idList: string[]): Promise<IDownloadUrl[]> {
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid || route.provider !== 'aliyun') return []
    const batchList = ApiBatchMaker('/file/get_download_url', file_idList, (file_id: string) => {
      return {
        drive_id: drive_id,
        file_id: file_id,
        expire_sec: 14400
      }
    })
    const successList: IDownloadUrl[] = []
    const result = await ApiBatch('', batchList, user_id, '')
    result.reslut.map((t) => {
      if (t.body) successList.push(t.body as IDownloadUrl)
      return true
    })
    return successList
  }
}
