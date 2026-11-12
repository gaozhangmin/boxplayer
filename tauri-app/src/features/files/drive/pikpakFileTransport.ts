import {pikpakBatchFetch} from './pikpakBatchTransport'
import {request,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
export const pikpakFileCheck=(user:string)=>mutationAccount(user,'pikpak')
export function pikpakId(value:string){if(typeof value!=='string'||!value||value.length>4096||/[\u0000-\u001f]/.test(value))throw Error('PikPak 文件标识无效');return value}
export function pikpakParent(value:string){return ['','root','backup_root','pikpak_root'].includes(value)?'pikpak_root':pikpakId(value)}

export async function pikpakFileFetch(user:string,url:string,init:RequestInit){
 const account=pikpakFileCheck(user),target=new URL(url)
 if(['/drive/v1/files:batchMove','/drive/v1/files:batchCopy','/drive/v1/files:batchTrash','/drive/v1/files:batchUntrash','/drive/v1/files:batchDelete'].includes(target.pathname))return pikpakBatchFetch(user,url,init)
 const body=typeof init.body==='string'?JSON.parse(init.body):null
 const mkdir=target.pathname==='/drive/v1/files'&&init.method==='POST',rename=/^\/drive\/v1\/files\/[^/]+$/.test(target.pathname)&&init.method==='PATCH'
 if(target.origin!=='https://api-drive.mypikpak.com'||target.search||(!mkdir&&!rename))throw Error('PikPak 文件请求尚未适配')
 if(!body||typeof body.name!=='string'||!body.name)throw Error('PikPak 文件名称无效')
 if(mkdir){if(body.kind!=='drive#folder')throw Error('PikPak 创建类型无效');if(body.parent_id!==undefined)pikpakId(body.parent_id)}else pikpakId(decodeURIComponent(target.pathname.split('/').at(-1)!))
 const response=await request(account,init.method!,url,init.body as string,{'Content-Type':'application/json'})
 const data=JSON.parse(text(response));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('PikPak 文件响应无效')
 if(rename){const file=data.file||data;if(file.id!==undefined&&file.id!==decodeURIComponent(target.pathname.split('/').at(-1)!))throw Error('PikPak 重命名响应标识不匹配')}
 return {ok:response.status>=200&&response.status<300,json:async()=>data}
}
let detailScope:{user:string;trashed:boolean}|undefined
export function withPikpakDetailScope<T>(user:string,trashed:boolean,run:()=>T){const old=detailScope;detailScope={user,trashed};try{return run()}finally{detailScope=old}}
export async function pikpakFileDetailFetch(user:string,id:string){
 const allowTrashed=detailScope?.user===user&&detailScope.trashed
 const account=pikpakFileCheck(user);pikpakId(id)
 const response=await request(account,'GET','https://api-drive.mypikpak.com/drive/v1/files/'+encodeURIComponent(id)+'?thumbnail_size=SIZE_LARGE'),data=JSON.parse(text(response))
 if(!data?.error&&(data?.id!==id||typeof data.name!=='string'||!data.name||!['drive#file','drive#folder'].includes(data.kind)||data.parent_id!=null&&typeof data.parent_id!=='string'||(allowTrashed?data.trashed===false:data.trashed===true)||data.phase&&data.phase!=='PHASE_TYPE_COMPLETE'))throw Error('PikPak 文件详情身份或状态无效')
 if(!data?.error){if(data.size!=null&&(!Number.isSafeInteger(Number(data.size))||Number(data.size)<0))throw Error('PikPak 文件大小无效');for(const key of ['created_time','modified_time'])if(data[key]!=null&&(typeof data[key]!=='string'||data[key]&&!Number.isFinite(Date.parse(data[key]))))throw Error('PikPak 文件时间无效')}
 return {ok:response.status>=200&&response.status<300,json:async()=>data}
}
