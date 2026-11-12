import {AliMetadataHttp as AliHttp,aliMetadataAccount,GetDriveType} from '../../aliMetadataPorts'
import {DecodeEncName,DebugLog} from '../../aliVideoPorts'
import type {IAliGetForderSizeModel,IAliFileItem} from '../aliapi/alimodels'
export async function ApiFileInfo(user_id: string, drive_id: string, file_id: string, ispic: boolean = false): Promise<any | undefined> {
    if (!drive_id || !file_id) return undefined
    aliMetadataAccount(user_id)
    let url = ''
    let postData = {}
    if (!ispic) {
      url = 'adrive/v1.0/openFile/get'
      postData = {
        drive_id: drive_id,
        file_id: file_id,
        image_thumbnail_width: 100,
        video_thumbnail_width: 100,
        video_thumbnail_time: 120000
      }
    } else {
      url = 'v2/file/get'
      postData = {
        drive_id: drive_id,
        file_id: file_id,
        url_expire_sec: 14400,
        office_thumbnail_process: 'image/resize,w_400/format,jpeg',
        image_thumbnail_process: 'image/resize,w_400/format,jpeg',
        image_url_process: 'image/resize,w_1920/format,jpeg',
        video_thumbnail_process: 'video/snapshot,t_106000,f_jpg,ar_auto,m_fast,w_400'
      }
    }
    const resp = await AliHttp.Post(url, postData, user_id, '')

    if (AliHttp.IsSuccess(resp.code)) {
      let fileInfo = resp.body as IAliFileItem
      if (fileInfo.name.toLowerCase() === 'default') {
        fileInfo.name = '备份盘'
      } else if (fileInfo.name.toLowerCase() === 'resource') {
        fileInfo.name = '资源盘'
      } else if (fileInfo.name.toLowerCase() === 'alibum') {
        fileInfo.name = '相册'
      } else {
        fileInfo.name = DecodeEncName(user_id, fileInfo).name
      }
      return fileInfo
    } else if (AliHttp.HttpCodeBreak(resp.code)) {
      return (resp.body.message || resp.body) as string
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiFileInfo err=' + file_id + ' ' + (resp.code || ''), resp.body)
    }
    return '网络错误'
  }

export async function ApiFileGetFolderSize(user_id: string, drive_id: string, file_id: string): Promise<IAliGetForderSizeModel | undefined> {
    if (!user_id || !drive_id || !file_id) return undefined
    if (aliMetadataAccount(user_id).providerId !== 'aliyun') throw Error('Folder statistics require the web account channel')
    const url = 'adrive/v1/file/get_folder_size_info'

    const postData = {
      drive_id: drive_id,
      file_id: file_id
    }
    const resp = await AliHttp.Post(url, postData, user_id, '')

    if (AliHttp.IsSuccess(resp.code)) {
      return resp.body as IAliGetForderSizeModel
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiFileGetFolderSize err=' + file_id + ' ' + (resp.code || ''), resp.body)
    }
    return { size: 0, folder_count: 0, file_count: 0, reach_limit: false }
  }

export async function ApiFileGetPathString(user_id: string, drive_id: string, file_id: string, dirsplit: string): Promise<string> {
    if (!user_id || !drive_id || !file_id) return ''
    if (aliMetadataAccount(user_id).providerId !== 'aliyun') throw Error('Path lookup requires the web account channel')
    if (file_id.includes('root')) {
      if (file_id.startsWith('backup')) {
        return '备份盘'
      } else if (file_id.startsWith('resource')) {
        return '资源盘'
      } else if (file_id.startsWith('pic')) {
        return '相册'
      }
    }
    const url = 'adrive/v1/file/get_path'
    const postData = {
      drive_id: drive_id,
      file_id: file_id
    }
    const resp = await AliHttp.Post(url, postData, user_id, '')
    if (AliHttp.IsSuccess(resp.code) && resp.body.items && resp.body.items.length > 0) {
      const driveType = GetDriveType(user_id, drive_id)
      const list: string[] = [driveType.title]
      for (let i = resp.body.items.length - 1; i >= 0; i--) {
        const item = resp.body.items[i]
        list.push(DecodeEncName(user_id, item).name)
      }
      return list.join(dirsplit)
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiFileGetPathString err=' + file_id + ' ' + (resp.code || ''), resp.body)
    }
    return ''
  }
