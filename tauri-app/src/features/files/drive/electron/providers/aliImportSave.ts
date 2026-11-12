import {ApiBatch,type AliCopyContext} from '../../aliImportMutations'
import {mutationAccount} from '../../providerTransport'
export async function ApiSaveShareFilesBatch(share_id: string, share_token: string, user_id: string, drive_id: string, parent_file_id: string, file_idList: string[],context?:AliCopyContext): Promise<string> {
    if (!share_id || !share_token || !user_id || !drive_id || !parent_file_id) return 'error'
    mutationAccount(user_id,'aliyun')
    if(!file_idList.length)return 'success'
    if (parent_file_id==='root') parent_file_id = 'root'
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
    const result = await ApiBatch('', batchList, user_id, share_token,context)
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
