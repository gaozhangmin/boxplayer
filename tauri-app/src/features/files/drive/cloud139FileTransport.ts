import type {Account} from '@/features/sources/contracts'
import {Cloud139RequestRejected} from '@/features/sources/cloud139Errors'
import {cloud139Call,personalUrls,MissingRoute} from '@/features/sources/cloud139'
import {mutationAccount} from './providerTransport'
import {cloud139Id} from '@/features/sources/cloud139Identity'
export {cloud139Id} from '@/features/sources/cloud139Identity'
export const cloud139ApiParentId=(parent:string)=>cloud139Id(parent,true)
interface MutationScope{account:Account;endpoint:string;body:Record<string,unknown>;check:()=>void;onSubmit:()=>void;onAccepted?:()=>void}
const scopes=new Map<string,MutationScope>()
export async function withCloud139MutationScope<T>(scope:MutationScope,run:(user:string)=>Promise<T>){
 scope.check();if(scopes.size>=128)throw Error('139 文件操作会话过多')
 const key=`cloud139-operation:${crypto.randomUUID()}`;scopes.set(key,scope)
 try{return await run(key)}finally{scopes.delete(key)}
}
export async function cloud139Request(user:string,endpoint:string,body:Record<string,unknown>):Promise<any>{
 const scope=scopes.get(user),account=scope?.account||mutationAccount(user,'139'),keys=Object.keys(body)
 const owner=JSON.stringify([account.userId||'',account.deviceId||'',account.baseUrl])
 const check=()=>{scope?.check();const current=mutationAccount(account.id,'139');if(JSON.stringify([current.userId||'',current.deviceId||'',current.baseUrl])!==owner)throw Error('139 账号身份已变化')}
 check();if(scope&&(scope.endpoint!==endpoint||JSON.stringify(body)!==JSON.stringify(scope.body)))throw Error('139 文件操作上下文不匹配')
 if(endpoint==='/file/create'){
  if(keys.length!==5||keys.some(key=>!['parentFileId','name','description','type','fileRenameMode'].includes(key))||body.description!==''||body.type!=='folder'||body.fileRenameMode!=='force_rename')throw Error('139 新建请求未适配')
  cloud139Id(body.parentFileId,true)
 }else if(endpoint==='/file/update'){
  if(keys.length!==2||keys.some(key=>!['fileId','fileName'].includes(key)))throw Error('139 重命名请求未适配')
  cloud139Id(body.fileId)
 }else if(endpoint==='/file/batchMove'||endpoint==='/file/batchCopy'){
  if(keys.length!==2||keys.some(key=>!['fileIds','parentFileId'].includes(key))||!Array.isArray(body.fileIds)||body.fileIds.length!==1)throw Error('139 移动请求未适配')
  cloud139Id(body.fileIds[0]);cloud139Id(body.parentFileId,true)
 }else if(endpoint==='/recyclebin/batchTrash'){
  if(keys.length!==1||keys[0]!=='fileIds'||!Array.isArray(body.fileIds)||body.fileIds.length!==1)throw Error('139 回收请求未适配')
  cloud139Id(body.fileIds[0])
 }else throw Error('139 文件请求未适配')
 const name=body.name??body.fileName
 if(['/file/create','/file/update'].includes(endpoint)&&(typeof name!=='string'||!name.trim()||['.','..'].includes(name)||/[\u0000-\u001f/\\]/.test(name)))throw Error('139 文件名无效')
 const validate=(row:unknown):void=>{
  if(!row||typeof row!=='object')return
  if(Array.isArray(row)){row.forEach(validate);return}
  for(const [key,value] of Object.entries(row)){if(['fileId','catalogId','catalogID','contentID','parentFileId','parentCatalogId'].includes(key)&&value!==undefined&&value!==null)cloud139Id(value,key.startsWith('parent'));else if(value&&typeof value==='object')validate(value)}
 }

 check();scope?.onSubmit()
 const data=await cloud139Call(account,personalUrls(account.baseUrl,endpoint),body,check,data=>{validate(data);scope?.onAccepted?.()}).catch(cause=>{if(cause instanceof MissingRoute)throw new Cloud139RequestRejected('移动云盘接口路径不存在');throw cause})
 check()
 if(!data||typeof data!=='object'||Array.isArray(data)||data.success===false||['9000','9008','9100'].includes(String(data.code??'')))throw Error('139 文件操作回执未确认成功')

 return data
}
