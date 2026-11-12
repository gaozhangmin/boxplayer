import {request,text} from '@/features/sources/transport'
import {aliFolderAccount as aliRenameAccount} from './aliFolderTransport'
import {getDrivePane} from './ports'
import {checkAliRenameContext} from './aliRenameContext'
export async function ApiBatch(_title:string,batchList:string[],user:string,share:string){
 const account=aliRenameAccount(user),pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account)
 const check=()=>{checkAliRenameContext(user);if(getDrivePane()!==pane||pane.sourceId!==user||pane.context!==epoch||JSON.stringify(aliRenameAccount(user))!==owner)throw Error('阿里重命名来源已切换或账号已变化')}
 check();if(share)throw Error('重命名不允许使用分享令牌')
 const rows=batchList.map(raw=>JSON.parse(raw)),ids=new Set<string>()
 for(const row of rows){if(!row||row.url!=='/file/update'||row.method!=='POST'||!row.id||ids.has(row.id)||row.body?.file_id!==row.id||!row.body?.drive_id||typeof row.body?.name!=='string'||!row.body.name.trim()||row.body.check_name_mode!=='refuse')throw Error('阿里重命名请求无效');ids.add(row.id)}
 const reslut:Array<{id:string;file_id:string;parent_file_id:string;name:string;type:string}>=[]
 if(account.providerId==='alipan-open'){
  const call=async(path:string,body:unknown)=>{check();const response=await request(account,'POST','https://openapi.alipan.com/adrive/v1.0/openFile/'+path,JSON.stringify(body),{'Content-Type':'application/json'});check();const data=JSON.parse(text(response));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('阿里开放重命名响应无效');return {status:response.status,data}}
  for(const row of rows){
   check();const input=row.body,encoded=JSON.stringify({driveId:input.drive_id,fileId:input.file_id}),known=pane.file?.(encoded)
   if(!known||known.file_id!==encoded)throw Error('阿里开放重命名文件不在当前来源记录中')
   let parent:any;try{parent=JSON.parse(known.parent_file_id)}catch{throw Error('阿里开放重命名父目录无效')}
   if(parent?.driveId!==input.drive_id||typeof parent?.fileId!=='string'||!parent.fileId||input.file_id==='root')throw Error('阿里开放重命名位置无效')
   const matches=(value:any,name:string)=>value?.file_id===input.file_id&&value.drive_id===input.drive_id&&value.parent_file_id===parent.fileId&&value.type===(known.isDir?'folder':'file')&&value.name===name&&!value.code&&!value.trashed
   const before=await call('get',{drive_id:input.drive_id,file_id:input.file_id})
   if(before.status!==200||!matches(before.data,known.name))throw Error('阿里开放重命名原文件身份或位置已变化')
   const result=await call('update',{drive_id:input.drive_id,file_id:input.file_id,name:input.name,check_name_mode:'refuse'})
   if(result.status!==200||result.data.code||result.data.async_task_id)continue
   const detail=await call('get',{drive_id:input.drive_id,file_id:input.file_id})
   if(detail.status!==200||!matches(detail.data,input.name))continue
   reslut.push({id:row.id,file_id:input.file_id,parent_file_id:parent.fileId,name:input.name,type:detail.data.type})
  }
  return {reslut}
 }
 for(let offset=0;offset<rows.length;offset+=100){
  check();const requests=rows.slice(offset,offset+100),expected=new Map(requests.map(row=>[row.id,row]))
  const response=await request(account,'POST','https://api.aliyundrive.com/adrive/v4/batch',JSON.stringify({requests,resource:'file'}),{'Content-Type':'application/json'});check()
  const data=JSON.parse(text(response));if(response.status!==200||data?.code||!Array.isArray(data?.responses))throw Error('阿里重命名缺少完成回执')
  const seen=new Set<string>()
  for(const row of data.responses){
   if(!row||!expected.has(row.id)||seen.has(row.id))throw Error('阿里重命名回执重复或标识不匹配');seen.add(row.id)
   const input=expected.get(row.id)!.body,body=row.body
   if(row.status!==200||body?.code||body?.async_task_id)continue
   if(body?.file_id!==input.file_id||body?.drive_id!==input.drive_id||body?.name!==input.name||typeof body.parent_file_id!=='string'||!body.parent_file_id||!['file','folder'].includes(body.type))continue
   reslut.push({id:row.id,file_id:body.file_id,parent_file_id:body.parent_file_id,name:body.name,type:body.type})
  }
 }
 return {reslut}
}
