import {getDrivePane} from './ports'
import type {Account} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import {ApiFileHistoryBatch} from './electron/providers/aliHistoryBatch'
import {mutationAccount} from './providerTransport'
export async function clearAliHistory(account:Account,files:IAliGetFileModel[],check:()=>void){
 if(account.providerId!=='aliyun')throw Error('清除历史来源不匹配')
 mutationAccount(account.id,'aliyun');check()
 if(!getDrivePane().settings.uiAutoPlaycursorVideo)throw Error('当前已关闭云盘播放进度写入，未提交清除历史请求')
 if(!files.length||new Set(files.map(file=>file.file_id)).size!==files.length||files.some(file=>file.drive_id!==account.id))throw Error('清除历史来源或选择无效')
 const groups=new Map<string,string[]>()
 for(const file of files){let location:any;try{location=JSON.parse(file.file_id)}catch{throw Error('清除历史文件位置无效')}
  if(typeof location?.driveId!=='string'||!location.driveId||typeof location.fileId!=='string'||!location.fileId||location.fileId==='root'||/[\u0000-\u001f/\\]/.test(location.driveId+location.fileId))throw Error('清除历史文件位置无效')
  const ids=groups.get(location.driveId)||[];ids.push(location.fileId);groups.set(location.driveId,ids)
 }
 for(const [drive,ids]of groups){check();await ApiFileHistoryBatch(account.id,drive,ids,check);check()}
 return files.map(file=>file.file_id)
}
