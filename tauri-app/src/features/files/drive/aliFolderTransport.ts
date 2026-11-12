import {request,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {getDrivePane} from './ports'
export type ProviderFileCommandOptions=Record<string,unknown>
export const DebugLog={mSaveWarning:(_message:string,_body:unknown)=>{}}
export function EncodeEncName(_user:string,name:string,_folder:boolean,enc:string){if(enc)throw Error('此来源浏览器不支持加密创建');return name}
export function aliFolderAccount(user:string){const account=useFileSourcesStore().accounts.find(row=>row.id===user);if(!account||!['aliyun','alipan-open'].includes(account.providerId))throw Error('阿里文件夹账号来源不匹配');return mutationAccount(user,account.providerId)}
export const AliFolderHttp={
 IsSuccess:(status:number)=>status===200,
 HttpCodeBreak:(_status:number)=>false,
 async Post(path:string,body:string,user:string,_drive:string){
  const account=aliFolderAccount(user),owner=JSON.stringify(account),value=JSON.parse(body),pane=getDrivePane(),context=pane.context
  const check=()=>{if(getDrivePane()!==pane||pane.context!==context||pane.sourceId!==user||JSON.stringify(aliFolderAccount(user))!==owner)throw Error('阿里文件夹创建来源已切换或账号已变化')}
  check()
  if(path!=='adrive/v2/file/createWithFolders'||!value.drive_id||!value.parent_file_id||value.type!=='folder'||value.check_name_mode!=='refuse'||value.description!=='')throw Error('阿里文件夹创建参数无效')
  const open=account.providerId==='alipan-open',openBody={drive_id:value.drive_id,parent_file_id:value.parent_file_id,name:value.name,check_name_mode:value.check_name_mode,type:value.type}
  const response=await request(account,'POST',open?'https://openapi.alipan.com/adrive/v1.0/openFile/create':'https://api.aliyundrive.com/'+path,open?JSON.stringify(openBody):body,{'Content-Type':'application/json'})
  check()
  const data=JSON.parse(text(response));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('阿里文件夹回执无效')
  if(open&&response.status===200&&!data.code){
   if(typeof data.file_id!=='string'||!data.file_id||data.file_id===value.parent_file_id)throw Error('阿里文件夹回执标识不匹配')
   const detail=await request(account,'POST','https://openapi.alipan.com/adrive/v1.0/openFile/get',JSON.stringify({drive_id:value.drive_id,file_id:data.file_id}),{'Content-Type':'application/json'});check()
   const confirmed=JSON.parse(text(detail))
   if(detail.status!==200||confirmed?.code||confirmed?.file_id!==data.file_id||confirmed?.drive_id!==value.drive_id||confirmed?.parent_file_id!==value.parent_file_id||confirmed?.type!=='folder'||confirmed?.name!==value.name)throw Error('阿里文件夹详情标识、名称或目标不匹配')
   return {code:response.status,body:confirmed}
  }
  if(response.status===200&&!data.code&&(typeof data.file_id!=='string'||!data.file_id||data.file_id===value.parent_file_id||data.drive_id!==value.drive_id||data.parent_file_id!==value.parent_file_id||data.type!=='folder'||data.name!==value.name))throw Error('阿里文件夹回执标识、名称或目标不匹配')
  return {code:response.status,body:data}
 }
}
