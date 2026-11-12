import type {Account} from '@/features/sources/contracts'
import {request,text} from '@/features/sources/transport'
import {aliFolderAccount} from './aliFolderTransport'
import {getDrivePane} from './ports'

// Official Aliyunpan Android SDK AliyunpanFileScope.UpdateFile/GetFile.
// Open credentials must never fall back to the web batch endpoint.
export async function updateOpenFavorite(account:Account,drive:string,file:string,starred:boolean){
 const pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account),id=JSON.stringify({driveId:drive,fileId:file}),known=pane.file?.(id)
 const check=()=>{if(account.providerId!=='alipan-open'||getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id||JSON.stringify(aliFolderAccount(account.id))!==owner)throw Error('收藏来源已切换或账号已变化')}
 check()
 let parent:any;try{parent=JSON.parse(known?.parent_file_id||'')}catch{throw Error('收藏原文件位置无效')}
 if(!known||!drive||!file||file==='root'||parent?.driveId!==drive||typeof parent.fileId!=='string'||!parent.fileId)throw Error('收藏原文件身份无效')
 const call=async(path:string,body:unknown)=>{
  check();const response=await request(account,'POST','https://openapi.alipan.com/adrive/v1.0/openFile/'+path,JSON.stringify(body),{'Content-Type':'application/json'});check()
  const data=JSON.parse(text(response))
  if(response.status!==200||!data||typeof data!=='object'||Array.isArray(data)||data.code||data.async_task_id)throw Error('提供商未确认收藏更新')
  return data
 }
 const matches=(value:any)=>value.file_id===file&&value.drive_id===drive&&value.parent_file_id===parent.fileId&&value.type===(known.isDir?'folder':'file')&&value.name===known.name&&!value.trashed
 const identity={drive_id:drive,file_id:file},before=await call('get',identity)
 if(!matches(before))throw Error('收藏原文件身份或位置已变化')
 if(before.starred!==starred){
  await call('update',{...identity,starred})
  const after=await call('get',identity)
  if(!matches(after)||after.starred!==starred)throw Error('收藏操作未确认完成，请刷新确认')
 }
 check()
}
