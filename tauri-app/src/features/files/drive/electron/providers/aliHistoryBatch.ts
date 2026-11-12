import * as AliFile from './aliHistoryUpdate'
const message={loading:(..._args:unknown[])=>{},success:(..._args:unknown[])=>{}}
import {mutationAccount} from '../../providerTransport'
export async function ApiFileHistoryBatch(user_id: string, drive_id: string, file_idList: string[], check:()=>void=()=>{}) {
    mutationAccount(user_id,'aliyun')
    check()
    let allTask = []
    const loadingKey = 'filehistorybatch' + Date.now().toString()
    message.loading('清除历史 执行中...', 60, loadingKey)
    for (const file_id of file_idList) {
      check()
      allTask.push(AliFile.ApiUpdateVideoTime(user_id, drive_id, file_id, 0,check))
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
