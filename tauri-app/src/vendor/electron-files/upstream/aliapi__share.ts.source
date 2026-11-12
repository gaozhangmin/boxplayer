import DebugLog from '../utils/debuglog'
import { humanDateTime, humanDateTimeDateStr, humanExpiration, humanSize } from '../utils/format'
import message from '../utils/message'
import AliHttp, { IUrlRespData } from './alihttp'
import ServerHttp from './server'
import { ApiBatch, ApiBatchMaker, ApiBatchSuccess } from './utils'
import { useSettingStore } from '../store'
import { IAliFileItem, IAliShareAnonymous, IAliShareBottleFish, IAliShareFileItem, IAliShareItem } from './alimodels'
import getFileIcon from './fileicon'
import { IAliBatchResult } from './models'
import UserDAL from '../user/userdal'
import { resolveDriveProvider } from '../utils/driveProvider'
import { cancelProviderShares, getProviderShareAnonymous, getProviderShareFiles, getProviderShareToken, getProviderShareUpdateNotice, getSharedProvider, saveProviderShareFiles, updateProviderShares } from '../drive/providerShare'

export interface IAliShareFileResp {
  items: IAliShareFileItem[]
  itemsKey: Set<string>
  punished_file_count: number

  next_marker: string

  m_user_id: string
  m_share_id: string
  dirID: string
  dirName: string
}

export interface UpdateShareModel {
  share_id: string
  share_pwd: string
  expiration: string
  share_name: string
}

export default class AliShare {

  static async ApiShareFileCheckAvailable(user_id: string, drive_id: string, file_id_list: string[]) {
    if (!user_id || !drive_id || !file_id_list) return []
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid || route.provider !== 'aliyun') return []
    const url = 'adrive/v2/share_link/check_available'
    const postData = { drive_id, file_id_list }
    const resp = await AliHttp.Post(url, postData, user_id, '')
    if (AliHttp.IsSuccess(resp.code)) {
      return resp.body.invalid_items as IAliFileItem[]
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiShareFileCheckAvailable err=' + (resp.code || ''))
    }
    return []
  }

  static async ApiGetShareAnonymous(share_id: string, share_pwd = ''): Promise<IAliShareAnonymous> {
    const providerShare = getProviderShareAnonymous(share_id, share_pwd)
    if (providerShare) return providerShare
    const share: IAliShareAnonymous = {
      shareinfo: {
        share_id: share_id,
        creator_id: '',
        creator_name: '',
        creator_phone: '',
        display_name: '',
        expiration: '',
        file_count: 0,
        share_name: '',
        created_at: '',
        updated_at: '',
        vip: '',
        is_photo_collection: false,
        album_id: ''
      },
      shareinfojson: '',
      error: '解析分享链接失败'
    }
    if (!share_id) return share
    const url = 'adrive/v3/share_link/get_share_by_anonymous?share_id=' + share_id
    const postData = { share_id: share_id }
    const resp = await AliHttp.Post(url, postData, '', '')
    if (AliHttp.IsSuccess(resp.code)) {
      if (resp.body.creator_id) {
        share.shareinfo.share_id = share_id
        share.shareinfo.creator_id = resp.body.creator_id || ''
        share.shareinfo.creator_name = resp.body.creator_name || ''
        share.shareinfo.creator_phone = resp.body.creator_phone || ''
        share.shareinfo.display_name = resp.body.display_name || ''
        share.shareinfo.expiration = resp.body.expiration || ''
        share.shareinfo.file_count = resp.body.file_count || 0
        share.shareinfo.share_name = resp.body.share_name || ''
        share.shareinfo.created_at = resp.body.created_at || ''
        share.shareinfo.updated_at = resp.body.updated_at || ''
        share.shareinfo.vip = resp.body.vip || ''
        share.shareinfo.is_photo_collection = resp.body.is_photo_collection || false
        share.shareinfo.album_id = resp.body.album_id || ''
        share.shareinfojson = JSON.stringify(resp.body)
        share.error = ''
        return share
      }
    } else if (resp.code != 429 && !AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiGetShareAnonymous err=' + share_id + ' ' + (resp.code || ''), resp.body)
    }

    if (resp.body?.code == 'TooManyRequests') share.error = '429'
    else if (resp.body?.code == 'ShareLink.Cancelled') share.error = '分享链接被取消分享了'
    else if (resp.body?.code == 'ShareLink.Expired') share.error = '分享链接过期失效了'
    else if (resp.body?.code == 'ShareLink.Forbidden') share.error = '分享链接违规禁止访问'
    else if (resp.body?.code) share.error = resp.body.code
    else share.error = '解析分享链接失败'
    return share
  }


  static async ApisSubscription(user_id: string, share_id: string): Promise<boolean> {
    if (!user_id || !share_id) return false
    const url = 'adrive/v1/share_link/subscription/update'
    const postData = { share_id: share_id, update_last_seen: true }
    const resp = await AliHttp.Post(url, postData, user_id, '')
    if (AliHttp.IsSuccess(resp.code)) {
      return true
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApisSubscription err=' + share_id + ' ' + (resp.code || ''), resp.body)
    }
    return false
  }


  static async ApiGetShareToken(share_id: string, pwd: string): Promise<string> {
    const providerToken = getProviderShareToken(share_id, pwd)
    if (providerToken) return providerToken
    if (!share_id) return '，分享链接错误'
    const url = 'v2/share_link/get_share_token'
    const postData = { share_id: share_id, share_pwd: pwd }

    let resp = await AliHttp.Post(url, postData, '', '')
    let isgetpwd = false

    if (resp.body?.code == 'InvalidResource.SharePwd') {
      if (useSettingStore().yinsiLinkPassword) {
        const serdata = await ServerHttp.PostToServer({ cmd: 'GetAliSharePwd', shareid: share_id })
        if (serdata.password) {
          isgetpwd = true
          postData.share_pwd = serdata.password
          resp = await AliHttp.Post(url, postData, '', '')
        }
      }
    }
    if (resp.body?.code == 'InvalidResource.SharePwd') return '，提取码错误'
    if (resp.body?.code == 'ShareLink.Cancelled') return '，分享链接被取消分享了'
    if (resp.body?.code == 'ShareLink.Expired') return '，分享链接过期失效了'
    if (resp.body?.code == 'ShareLink.Forbidden') return '，分享链接违规禁止访问'
    if (resp.body?.code) return '，' + resp.body.code

    if (AliHttp.IsSuccess(resp.code)) {
      if (useSettingStore().yinsiLinkPassword && !isgetpwd) ServerHttp.PostToServer({
        cmd: 'PostAliShare',
        shareid: share_id,
        password: postData.share_pwd
      })
      return (resp.body.share_token as string | undefined) || '，share_token错误'
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiGetShareToken err=' + share_id + ' ' + (resp.code || ''), resp.body)
    }
    return '，网络错误请重试'
  }


  static async ApiShareFileList(share_id: string, share_token: string, dirID: string): Promise<IAliShareFileResp> {
    const providerFiles = getProviderShareFiles(share_id, share_token, dirID)
    if (providerFiles) {
      const resp = await providerFiles
      if (resp.error) message.warning(resp.error, 2)
      return {
        items: resp.items,
        itemsKey: new Set(resp.items.map(item => item.file_id)),
        punished_file_count: 0,
        next_marker: resp.next_marker,
        m_user_id: '',
        m_share_id: share_id,
        dirID,
        dirName: ''
      }
    }
    const dir: IAliShareFileResp = {
      items: [],
      itemsKey: new Set(),
      punished_file_count: 0,
      next_marker: '',
      m_user_id: '',
      m_share_id: share_id,
      dirID: dirID,
      dirName: ''
    }
    do {
      const isGet = await AliShare.ApiShareFileListOnePage(dir, share_token)
      if (!isGet) {
        break
      }
    } while (dir.next_marker)

    return dir
  }


  static async ApiShareFileListOnePage(dir: IAliShareFileResp, share_token: string): Promise<boolean> {
    const url =
      'adrive/v3/file/list?jsonmask=next_marker%2Citems(category%2Ccreated_at%2Cdrive_id%2Cfile_extension%2Cfile_id%2Chidden%2Cmime_extension%2Cmime_type%2Cname%2Cparent_file_id%2Cpunish_flag%2Csize%2Cstarred%2Ctype%2Cupdated_at%2Cdescription)'
    let postData = {
      share_id: dir.m_share_id,
      parent_file_id: dir.dirID,
      limit: 100,
      url_expire_sec: 14400,
      fields: 'thumbnail',
      order_by: 'name',
      order_direction: 'DESC'
    }
    if (dir.next_marker) postData = Object.assign(postData, { marker: dir.next_marker })
    const resp = await AliHttp.Post(url, postData, '', share_token)
    return AliShare._ShareFileListOnePage(dir, resp)
  }

  private static _ShareFileListOnePage(dir: IAliShareFileResp, resp: IUrlRespData): boolean {
    try {
      if (AliHttp.IsSuccess(resp.code)) {
        dir.next_marker = resp.body.next_marker
        for (let i = 0, maxi = resp.body.items.length; i < maxi; i++) {
          const item = resp.body.items[i] as IAliShareFileItem
          if (dir.itemsKey.has(item.file_id)) continue
          const add: IAliShareFileItem = {
            drive_id: item.drive_id,
            file_id: item.file_id,
            name: item.name,
            type: item.type,
            parent_file_id: item.parent_file_id,
            file_extension: item.file_extension || '',
            mime_extension: item.mime_extension || '',
            mime_type: item.mime_type || '',
            size: item.size || 0,
            category: item.category || '',
            punish_flag: item.punish_flag || 0,
            isDir: item.type == 'folder',
            created_at: item.created_at,
            updated_at: item.updated_at,
            timeStr: humanDateTimeDateStr(item.updated_at || item.created_at),
            sizeStr: item.type == 'folder' ? '' : humanSize(item.size),
            icon: getFileIcon(item.category, item.file_extension, item.mime_extension, item.mime_type, item.size)[1]
          }
          dir.items.push(add)
          dir.itemsKey.add(add.file_id)
        }
        dir.punished_file_count += resp.body.punished_file_count || 0
        return true
      } else if (resp.code == 404) {

        dir.items.length = 0
        dir.next_marker = ''
        return true
      } else if (resp.body && resp.body.code) {
        dir.items.length = 0
        dir.next_marker = resp.body.code
        message.warning('列出分享链接内文件出错 ' + resp.body.code, 2)
        return false
      } else if (!AliHttp.HttpCodeBreak(resp.code)) {
        DebugLog.mSaveWarning('_ShareFileListOnePage err=' + (resp.code || ''), resp.body)
      }
    } catch (err: any) {
      DebugLog.mSaveDanger('_ShareFileListOnePage ' + dir.dirID, err)
    }
    dir.next_marker = 'error ' + resp.code
    return false
  }


  static async ApiCreatShare(user_id: string, drive_id: string, expiration: string, share_pwd: string, share_name: string, file_id_list: string[], isFolder = false): Promise<string | IAliShareItem> {
    if (!user_id || !drive_id || file_id_list.length == 0) return '创建分享链接失败数据错误'
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid) return route.error
    if (route.provider !== 'aliyun') return '请通过网盘分享入口创建链接'
    const url = 'adrive/v2/share_link/create'
    const postData = { drive_id, expiration, share_pwd, share_name, file_id_list }
    const resp = await AliHttp.Post(url, postData, user_id, '')
    if (AliHttp.IsSuccess(resp.code)) {
      const item = resp.body as IAliShareItem
      const add: IAliShareItem = Object.assign({}, item, { first_file: undefined, icon: 'iconwenjian' })
      if (item.created_at) add.created_at = humanDateTime(item.created_at)
      if (item.updated_at) add.updated_at = humanDateTime(item.updated_at)
      add.share_msg = humanExpiration(item.expiration)
      return add
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiCreatShare err=' + (resp.code || ''), resp.body)
    }

    if (resp.body?.code.startsWith('UserPunished')) return '账号分享行为异常，无法分享'
    else if (resp.body?.code == 'InvalidParameter.FileIdList') return '选择文件过多，无法分享'
    else if (resp.body?.message && resp.body.message.indexOf('size of file_id_list') >= 0) return '选择文件过多，无法分享'
    else if (resp.body?.code == 'FileShareNotAllowed') return '这个文件禁止分享'
    else if (resp.body?.code == 'SharelinkCreateExceedDailyLimit') return '今日分享次数过多，请明天再试'
    else if (resp.body?.code == 'FeatureTemporaryDisabled') return '分享功能维护中'
    else if (resp.body?.code) return resp.body.code.toString()
    else return '创建分享链接失败'
  }

  static async ApiCreatShareBatch(user_id: string, drive_id: string, expiration: string, share_pwd: string, file_id_list: string[]): Promise<IAliBatchResult> {
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid || route.provider !== 'aliyun') return { count: 0, error: [], reslut: [], async_task: [] }
    const batchList: string[] = []
    for (let i = 0, maxi = file_id_list.length; i < maxi; i++) {
      const postData: any = {
        body: {
          drive_id,
          expiration,
          share_pwd: share_pwd,
          file_id_list: [file_id_list[i]]
        },
        headers: {
          'Content-Type': 'application/json'
        },
        id: file_id_list[i],
        method: 'POST',
        url: '/share_link/create'
      }
      batchList.push(JSON.stringify(postData))
    }
    return await ApiBatch('', batchList, user_id, '')
  }


  static async ApiCancelShareBatch(user_id: string, share_idList: string[]): Promise<string[]> {
    const route = resolveDriveProvider(user_id, '', UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid) return []
    const result = await cancelProviderShares(route.provider, user_id, share_idList)
    if (result) return result
    if (route.provider !== 'aliyun') {
      message.info('当前网盘类型不支持')
      return []
    }
    const batchList = ApiBatchMaker('/share_link/cancel', share_idList, (share_id: string) => {
      return { share_id: share_id }
    })
    return ApiBatchSuccess(share_idList.length > 1 ? '批量取消分享' : '取消分享', batchList, user_id, '')
  }


  static async ApiUpdateShareBatch(user_id: string, share_idList: string[], expirationList: string[], share_pwdList: string[], share_nameList: string[] | undefined): Promise<UpdateShareModel[]> {
    if (!share_idList || share_idList.length == 0) return []
    const route = resolveDriveProvider(user_id, '', UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid) return []
    const notice = getProviderShareUpdateNotice(route.provider)
    if (notice) {
      message.info(notice)
      return []
    }
    const providerResult = await updateProviderShares(route.provider, user_id, share_idList, expirationList, share_pwdList, share_nameList)
    if (providerResult) return providerResult as UpdateShareModel[]
    if (route.provider !== 'aliyun') {
      message.info('当前网盘类型不支持')
      return []
    }
    const batchList: string[] = []
    if (share_nameList) {
      for (let i = 0, maxi = share_idList.length; i < maxi; i++) {
        batchList.push(
          JSON.stringify({
            body: {
              share_id: share_idList[i],
              share_pwd: share_pwdList[i],
              expiration: expirationList[i],
              share_name: share_nameList[i]
            },
            headers: { 'Content-Type': 'application/json' },
            id: share_idList[i],
            method: 'POST',
            url: '/share_link/update'
          })
        )
      }
    } else {
      for (let i = 0, maxi = share_idList.length; i < maxi; i++) {
        batchList.push(JSON.stringify({
          body: {
            share_id: share_idList[i],
            share_pwd: share_pwdList[i],
            expiration: expirationList[i]
          },
          headers: { 'Content-Type': 'application/json' },
          id: share_idList[i],
          method: 'POST',
          url: '/share_link/update'
        }))
      }
    }

    const successList: UpdateShareModel[] = []
    const batchResult = await ApiBatch(share_idList.length > 1 ? '批量更新分享链接' : '更新分享链接', batchList, user_id, '')
    batchResult.reslut.map((t) => successList.push({
      share_id: t.share_id!,
      share_pwd: t.share_pwd!,
      expiration: t.expiration!,
      share_name: t.share_name!
    } as UpdateShareModel))
    return successList
  }

  static async ApiSaveShareFilesBatch(share_id: string, share_token: string, user_id: string, drive_id: string, parent_file_id: string, file_idList: string[]): Promise<string> {
    if (!share_id || !share_token || !user_id || !drive_id || !parent_file_id) return 'error'
    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid) return 'error'
    if (!file_idList || file_idList.length == 0) return 'success'
    const sharedProvider = getSharedProvider(share_id)
    if (sharedProvider !== 'unknown' && sharedProvider !== route.provider) return 'error'
    if (route.provider !== 'aliyun') return saveProviderShareFiles(route.provider, share_id, share_token, user_id, parent_file_id, file_idList) || 'error'
    if (parent_file_id.includes('root')) parent_file_id = 'root'
    const batchList: string[] = []
    for (let i = 0, maxi = file_idList.length; i < maxi; i++) {
      const postData =
        '{"body":{"share_id":"' +
        share_id +
        '","file_id_list":["' +
        // files[i] +
        '"],"file_id":"' +
        file_idList[i] +
        '","to_drive_id":"' +
        drive_id +
        '","to_parent_file_id":"' +
        parent_file_id +
        '","auto_rename":true},"headers":{"Content-Type":"application/json"},"id":"' +
        file_idList[i] +
        '","method":"POST","url":"/file/copy"}'
      batchList.push(postData)
    }
    const result = await ApiBatch('', batchList, user_id, share_token)
    if (result.count == file_idList.length) {
      if (result.async_task.length > 0) return 'async'
      else return 'success'
    } else {
      if (result.error.length > 0) {
        if (result.error[0].code == 'QuotaExhausted.Drive') return '网盘空间已满'
        else return result.error[0].code
      }
      return 'error'
    }
  }

  static async ApiShareBottleFish(user_id: string) {
    if (!user_id) return '获取好运瓶失败'
    const url = 'adrive/v1/bottle/fish'
    const postData = {}
    const resp = await AliHttp.Post(url, postData, user_id, '')
    if (AliHttp.IsSuccess(resp.code)) {
      return resp.body as IAliShareBottleFish
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      return resp.body.display_message || '获取好运瓶失败'
    }
    return '获取好运瓶失败'
  }
}
