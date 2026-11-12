import {nativeCall} from '@/platform/native'
import {text,type ResponseData} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
export interface AliCopyContext {check():void;ack(id:string,state:'done'|'pending'):void}
export async function postAliImport(user:string,path:string,body:unknown,shareToken=''){
 mutationAccount(user,'aliyun')
 if(!['adrive/v4/batch','adrive/v2/file/createWithFolders'].includes(path))throw Error('分享转存请求路径无效')
 const headers:Record<string,string>={'Content-Type':'application/json'};if(shareToken)headers['X-Share-Token']=shareToken
 const response=await nativeCall<ResponseData>('http_request',{request:{requestId:crypto.randomUUID(),providerId:'aliyun',accountId:user,method:'POST',url:'https://api.aliyundrive.com/'+path,headers,body:Array.from(new TextEncoder().encode(JSON.stringify(body))),timeoutMs:30000,proxy:null}})
 const data=JSON.parse(text(response));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('分享转存响应无效')
 if(response.status<200||response.status>=300||data.code)throw Error(data.code==='QuotaExhausted.Drive'?'网盘空间已满':'分享转存请求失败')
 return data as Record<string,any>
}
// Implements the retained copy-only batch contract. Account credentials remain in
// the native gateway; a server task receipt is tracked as pending, never done.
export async function ApiBatch(_title:string,batchList:string[],user:string,token:string,context?:AliCopyContext){
 const all=batchList.map(raw=>JSON.parse(raw)),ids=new Set<string>()
 for(const row of all){if(!row||row.url!=='/file/copy'||row.method!=='POST'||typeof row.id!=='string'||!row.id||ids.has(row.id)||row.body?.file_id!==row.id||typeof row.body?.to_drive_id!=='string'||!row.body.to_drive_id||typeof row.body?.to_parent_file_id!=='string'||!row.body.to_parent_file_id||!/^[A-Za-z0-9_]{11,128}$/.test(row.body?.share_id)||!token)throw Error('分享转存子请求无效');ids.add(row.id)}
 const result={count:0,async_task:[] as Array<{file_id:string;task_id:string}>,error:[] as Array<{code:string;id:string}>,reslut:[] as Array<{id:string;file_id:string}>}
 for(let offset=0;offset<all.length;offset+=100){
  context?.check();const requests=all.slice(offset,offset+100),expected=new Map(requests.map(row=>[row.id,row]))
  const data=await postAliImport(user,'adrive/v4/batch',{requests,resource:'file'},token);context?.check()
  if(!Array.isArray(data.responses))throw Error('分享转存缺少批量回执')
  const seen=new Set<string>()
  for(const row of data.responses){
   if(!row||!expected.has(row.id)||seen.has(row.id))throw Error('分享转存回执标识重复或不匹配');seen.add(row.id)
   const request=expected.get(row.id)!,body=row.body
   if(!Number.isInteger(row.status)||row.status<200||row.status>205||!body||body.code){result.error.push({id:row.id,code:body?.code||'未确认'});continue}
   if(body.drive_id&&body.drive_id!==request.body.to_drive_id||body.parent_file_id&&body.parent_file_id!==request.body.to_parent_file_id){result.error.push({id:row.id,code:'目标目录不匹配'});continue}
   if(typeof body.async_task_id==='string'&&body.async_task_id){result.count++;result.async_task.push({file_id:row.id,task_id:body.async_task_id});context?.ack(row.id,'pending')}
   else if(row.status!==202&&typeof body.file_id==='string'&&body.file_id){result.count++;result.reslut.push({id:row.id,file_id:body.file_id});context?.ack(row.id,'done')}
   else result.error.push({id:row.id,code:'缺少完成或异步任务回执'})
  }
  for(const id of expected.keys())if(!seen.has(id))result.error.push({id,code:'缺少转存回执'})
 }
 return result
}
