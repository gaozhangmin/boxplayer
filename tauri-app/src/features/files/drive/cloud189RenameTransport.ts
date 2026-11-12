import type {Account} from '@/features/sources/contracts'
import {rawRequest,text} from '@/features/sources/transport'
import {CLOUD189_API_URL,CLOUD189_WEB_URL,CLOUD189_USER_AGENT} from './electron/providers/cloud189Constants'
import {cloud189Scope,forgetCloud189Files,preserveCloud189LargeIds,type Cloud189FileItem} from './electron/providers/cloud189Identity'
export class Cloud189RenameRejected extends Error {}
interface Context{account:Account;originalId:string;name:string;file:Cloud189FileItem;check:()=>void;onSubmit:()=>void}
const contexts=new Map<string,Context>()
export async function withCloud189RenameScope<T>(context:Context,read:(user:string)=>Promise<T>){
 context.check();if(contexts.size>=128)throw Error('天翼重命名请求过多')
 const key=`cloud189-rename:${crypto.randomUUID()}`;contexts.set(key,context)
 try{return await read(key)}finally{forgetCloud189Files(key);contexts.delete(key)}
}
function bound(user:string){const context=contexts.get(user);if(!context)throw Error('天翼重命名会话已关闭');context.check();return context}
export async function apiCloud189FileDetail(user:string,id:string){const context=bound(user);if(id!==context.originalId)throw Error('天翼详情请求标识不匹配');return {...context.file}}
async function send(user:string,method:'GET'|'POST',action:string,params:Record<string,string>,family:boolean){
 const context=bound(user),scope=cloud189Scope(context.originalId),folder=!!context.file.isFolder,keys=Object.keys(params)
 if(family!==!!scope.familyId||method!==(family?'GET':'POST')||action!==(family?'family/file/':'')+(folder?'renameFolder.action':'renameFile.action')||keys.length!==(family?3:2)||keys.some(key=>![folder?'folderId':'fileId',folder?'destFolderName':'destFileName',...(family?['familyId']:[])].includes(key))||params[folder?'folderId':'fileId']!==scope.rawId||params[folder?'destFolderName':'destFileName']!==context.name||family&&params.familyId!==scope.familyId)throw Error('天翼重命名请求未适配或空间不匹配')
 context.check();context.onSubmit()
 const response=await rawRequest(context.account,method,CLOUD189_API_URL+'/'+action+'?'+new URLSearchParams(params),undefined,{Accept:'application/json;charset=UTF-8','User-Agent':CLOUD189_USER_AGENT,Referer:CLOUD189_WEB_URL});context.check()
 if(response.status>=400&&response.status<500&&response.status!==408)throw new Cloud189RenameRejected(`天翼拒绝重命名（HTTP ${response.status}）`)
 if(response.status<200||response.status>=300)throw Error('天翼重命名结果不确定')
 const data=JSON.parse(preserveCloud189LargeIds(text(response)))
 if(!data||typeof data!=='object'||Array.isArray(data)||data.success!==undefined&&typeof data.success!=='boolean'||['errorCode','res_code','code'].some(key=>data[key]!==undefined&&!['string','number'].includes(typeof data[key])))throw Error('天翼重命名回执无效')
 if(data.errorCode||data.success===false||Number(data.res_code||0)!==0||data.code&&data.code!=='SUCCESS')throw new Cloud189RenameRejected('天翼拒绝重命名')
 return data
}
export const cloud189Request=(user:string,action:string,params:Record<string,string>,family=false)=>send(user,'GET',action,params,family)
export const cloud189PostRequest=(user:string,action:string,params:Record<string,string>,family=false)=>send(user,'POST',action,params,family)
