import DebugLog from '../utils/debuglog'
import { humanExpiration } from '../utils/format'
import AliHttp from './alihttp'
import { IAliShareItem } from './alimodels'

export default class AliTransferShare {

  static async ApiCreatTransferShare(user_id: string, drive_id: string, file_id_list: string[]): Promise<string | IAliShareItem> {
    if (!user_id || !drive_id || file_id_list.length == 0) return '快传分享链接失败数据错误'
    const drive_file_list = []
    for (let i = 0, maxi = file_id_list.length; i < maxi; i++) {
      drive_file_list.push({ drive_id, file_id: file_id_list[i] })
    }
    const url = 'adrive/v1/share/create'
    const postData = JSON.stringify({ drive_file_list })
    const resp = await AliHttp.Post(url, postData, user_id, '')
    if (AliHttp.IsSuccess(resp.code)) {
      const item = resp.body as IAliShareItem
      const add: IAliShareItem = Object.assign({}, item, { first_file: undefined, icon: 'iconwenjian' })
      add.share_msg = humanExpiration(item.expiration)
      return add
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiCreatShare err=' + (resp.code || ''), resp.body)
    }
    if (resp.body?.code.startsWith('UserPunished')) return '账号分享行为异常，无法分享'
    else if (resp.body?.code == 'InvalidParameter.FileIdList') return '选择文件过多，无法分享'
    else if (resp.body?.code == 'CreateShareCountExceed') return '今日快传已达上限，请明天再来'
    else if (resp.body?.message && resp.body.message.indexOf('size of file_id_list') >= 0) return '选择文件过多，无法分享'
    else if (resp.body?.code) return resp.body.code.toString()
    else return '创建快传链接失败'
  }

  static async ApiCancelTransferShareBatch(user_id: string, share_idList: string[]): Promise<any> {
    const url = 'adrive/v1/share/cancel'
    const success: string[] = []
    for (let share_id of share_idList) {
      let resp = await AliHttp.Post(url,  { share_id }, user_id, '')
      if (AliHttp.IsSuccess(resp.code)) {
        success.push(share_id)
      }
    }
    return success
  }
}
