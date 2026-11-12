import type {IAliShareItem} from '../aliapi/alimodels'
import {humanDateTime,humanExpiration} from '../utils/format'
import {AliHttp,DebugLog,ApiBatch} from '../../aliShareTransport'
import {mutationAccount} from '../../providerTransport'
export async function ApiCreatShare(user_id: string, drive_id: string, expiration: string, share_pwd: string, share_name: string, file_id_list: string[], isFolder = false): Promise<string | IAliShareItem> {
    if (!user_id || !drive_id || file_id_list.length == 0) return '创建分享链接失败数据错误'
    mutationAccount(user_id,'aliyun')
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

    if (resp.body?.code?.startsWith('UserPunished')) return '账号分享行为异常，无法分享'
    else if (resp.body?.code == 'InvalidParameter.FileIdList') return '选择文件过多，无法分享'
    else if (resp.body?.message && resp.body.message.indexOf('size of file_id_list') >= 0) return '选择文件过多，无法分享'
    else if (resp.body?.code == 'FileShareNotAllowed') return '这个文件禁止分享'
    else if (resp.body?.code == 'SharelinkCreateExceedDailyLimit') return '今日分享次数过多，请明天再试'
    else if (resp.body?.code == 'FeatureTemporaryDisabled') return '分享功能维护中'
    else if (resp.body?.code) return resp.body.code.toString()
    else return '创建分享链接失败'
  }

export interface UpdateShareModel {
  share_id: string
  share_pwd: string
  expiration: string
  share_name: string
}

export async function ApiUpdateShareBatch(user_id: string, share_idList: string[], expirationList: string[], share_pwdList: string[], share_nameList: string[] | undefined): Promise<UpdateShareModel[]> {
    if (!share_idList || share_idList.length == 0) return []
    mutationAccount(user_id,'aliyun')
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
