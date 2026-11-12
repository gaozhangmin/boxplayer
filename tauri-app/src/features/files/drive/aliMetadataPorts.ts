import {request,text} from '@/features/sources/transport'
import type {IAliFileItem} from './electron/aliapi/alimodels'
import type {IUrlRespData} from './aliVideoPorts'
import {aliFolderAccount as aliMetadataAccount} from './aliFolderTransport'
import {getDrivePane} from './ports'
import {alipan} from '@/features/sources/alipan'
export {aliMetadataAccount}
export function GetDriveType(user:string,drive:string){
 contexts.get(user)?.()
 const pane=getDrivePane(),root=pane.file?.(JSON.stringify({driveId:drive,fileId:'root'}))
 if(pane.sourceId!==user||!root?.isDir||!root.name)throw Error('阿里盘根名称尚未读取，请从盘根重新打开')
 return {title:root.name}
}
const contexts=new Map<string,()=>void>()
export async function withAliMetadataContext<T>(user:string,check:()=>void,work:()=>Promise<T>){
 if(contexts.has(user))throw Error('阿里属性正在读取，请稍后重试')
 contexts.set(user,check)
 try{check();const result=await work();check();return result}finally{contexts.delete(user)}
}
export const AliMetadataHttp={
 IsSuccess:(status:number)=>status===200,
 HttpCodeBreak:(_status:number)=>false,
 async Post(path:string,body:Record<string,unknown>,user:string,share:string):Promise<IUrlRespData>{
  const check=contexts.get(user);if(!check)throw Error('阿里属性读取作用域不存在');check()
  const account=aliMetadataAccount(user),open=account.providerId==='alipan-open'
  const stats=!open&&path==='adrive/v1/file/get_folder_size_info'
  const lookup=!open&&path==='adrive/v1/file/get_path'
  if(share||!stats&&!lookup&&path!==(open?'adrive/v1.0/openFile/get':'v2/file/get')||typeof body.drive_id!=='string'||!body.drive_id||typeof body.file_id!=='string'||!body.file_id)throw Error('阿里属性请求通道或标识不匹配')
  // Native root entries come from the account's actual drive-info response.
  // A synthetic root must not be sent to a normal file-detail endpoint.
  if(!stats&&!lookup&&body.file_id==='root'){
   const roots=await alipan.list(account,'');check()
   const identity=JSON.stringify({driveId:body.drive_id,fileId:'root'}),matches=roots.entries.filter(row=>row.id===identity)
   if(matches.length!==1||!matches[0]!.isDirectory||!matches[0]!.name)throw Error('阿里属性盘根不属于当前账号')
   return {code:200,body:{drive_id:body.drive_id,file_id:'root',parent_file_id:'',name:matches[0]!.name,type:'folder',size:0}}
  }
  const response=await request(account,'POST',(open?'https://openapi.alipan.com/':'https://api.aliyundrive.com/')+path,JSON.stringify(body),{'Content-Type':'application/json'});check()
  const data=JSON.parse(text(response))
  if(response.status!==200||!data||typeof data!=='object'||Array.isArray(data)||data.code)throw Error('阿里属性读取失败')
  if(lookup){
   if(!Array.isArray(data.items)||!data.items.length)throw Error('阿里属性路径缺失')
   const seen=new Set<string>()
   const items=data.items.map((row:any)=>{
    if(!row||typeof row.file_id!=='string'||!row.file_id||seen.has(row.file_id)||typeof row.name!=='string'||!row.name||row.drive_id!==undefined&&row.drive_id!==body.drive_id)throw Error('阿里属性路径无效')
    seen.add(row.file_id);return {file_id:row.file_id,name:row.name,mime_type:''}
   })
   if(items[0].file_id!==body.file_id)throw Error('阿里属性路径与文件不匹配')
   return {code:response.status,body:{items}}
  }
  if(stats){
   for(const key of ['size','file_count','folder_count'])if(!Number.isSafeInteger(data[key])||data[key]<0)throw Error('阿里目录统计字段无效')
   if(data.reach_limit!==undefined&&typeof data.reach_limit!=='boolean')throw Error('阿里目录统计范围无效')
   return {code:response.status,body:{size:data.size,file_count:data.file_count,folder_count:data.folder_count,reach_limit:data.reach_limit}}
  }
  if(data.drive_id!==body.drive_id||data.file_id!==body.file_id||typeof data.parent_file_id!=='string'||!data.parent_file_id||!['file','folder'].includes(data.type)||typeof data.name!=='string'||!data.name||data.trashed)throw Error('阿里属性身份或类型不匹配')
  if(data.size!==undefined&&(!Number.isSafeInteger(data.size)||data.size<0))throw Error('阿里属性大小无效')
  const projected:Record<string,unknown>={drive_id:data.drive_id,file_id:data.file_id,parent_file_id:data.parent_file_id,type:data.type,name:data.name,size:data.size??0}
  for(const key of ['created_at','updated_at','content_hash','content_hash_name','crc64_hash','mime_type','mime_extension','category','duration']){
   if(data[key]===undefined)continue
   if(typeof data[key]!=='string'||(key.endsWith('_at')&&!Number.isFinite(Date.parse(data[key]))))throw Error('阿里属性字段无效')
   projected[key]=data[key]
  }
  return {code:response.status,body:projected as Partial<IAliFileItem>&{message?:string}}
 }
}
