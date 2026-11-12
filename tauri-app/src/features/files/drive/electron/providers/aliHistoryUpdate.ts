import {AliHistoryHttp as AliHttp} from '../../aliHistoryTransport'
import {useSettingStore} from '../../ports'
import {DebugLog} from '../../aliFolderTransport'
type IAliFileItem=Record<string,unknown>
import {mutationAccount} from '../../providerTransport'
export async function ApiUpdateVideoTime(user_id: string, drive_id: string, file_id: string, play_cursor: number, check:()=>void=()=>{}): Promise<IAliFileItem | undefined> {
    if (!useSettingStore().uiAutoPlaycursorVideo) return
    if (!user_id || !drive_id || !file_id) return undefined
    mutationAccount(user_id,'aliyun')
    check()
    let url = ''
    let need_open_api = true
    if (need_open_api) {
      url = 'adrive/v1.0/openFile/video/updateRecord'
    } else {
      url = 'adrive/v2/video/update'
    }
    const postVideoData = {
      drive_id: drive_id,
      file_id: file_id,
      play_cursor: Math.trunc(play_cursor).toString()
    }
    const respvideo = await AliHttp.Post(url, postVideoData, user_id, '')
    check()
    if (AliHttp.IsSuccess(respvideo.code)) {
      return respvideo.body as IAliFileItem
    } else {
      DebugLog.mSaveWarning('ApiUpdateVideoTime err=' + file_id + ' ' + (respvideo.code || ''), respvideo.body)
    }
    return undefined
  }
