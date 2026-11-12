import {graphJson} from './providerTransport'
export const graphPost=<T>(user:string,path:string,body:unknown,fallback:string)=>graphJson<T>(user,path,'POST',body,fallback)

import {mutationAccount} from './providerTransport'
import {request,text} from '@/features/sources/transport'
export async function cloud123ShareRequest(user:string,url:string,init:RequestInit){
 if(!['https://open-api.123pan.com/api/v1/share/create','https://open-api.123pan.com/api/v1/share/content-payment/create'].includes(url)||init.method!=='POST'||typeof init.body!=='string')throw Error('123 分享请求无效')
 const result=await request(mutationAccount(user,'123'),'POST',url,init.body,{'Content-Type':'application/json',Platform:'open_platform'})
 return {ok:result.status>=200&&result.status<300,status:result.status,json:async()=>JSON.parse(text(result))}
}

import {json} from '@/features/sources/transport'
export async function guangyaRequest(user:string,path:string,body:unknown){
 if(path!=='/nd.bizuserres.s/v1/share_file')throw Error('光鸭分享请求路径无效')
 const data=await json<Record<string,any>>(mutationAccount(user,'guangya'),'POST','https://api.guangyapan.com'+path,body)
 const code=Number(data?.code)
 if(!data||data.success===false||Number.isFinite(code)&&code!==0)throw Error('光鸭分享请求失败')
 const result=data.data||data,id=result.shareId||result.id||result.share_id
 if(!id||!['string','number'].includes(typeof id))throw Error('光鸭未返回有效分享标识')
 return data
}

import {dropboxRpc} from './providerTransport'
export const dropboxShareRpc=dropboxRpc
export function validateDropboxSharedLink(link:import('./electron/providers/dropboxShare').DropboxSharedLinkMetadata,path:string,expiration:string,password:string){
 if(path.startsWith('/')?link.path_lower!==path.toLowerCase():link.id!==path)throw Error('Dropbox 分享文件标识不匹配')
 const url=new URL(link.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Dropbox 分享链接无效')
 const permissions=link.link_permissions as {require_password?:boolean;resolved_visibility?:{'.tag'?:string}}|undefined
 if(password&&permissions?.require_password!==true&&permissions?.resolved_visibility?.['.tag']!=='password')throw Error('Dropbox 未确认密码保护生效')
 if(expiration&&Date.parse(link.expires||'')!==Math.floor(Date.parse(expiration)/1000)*1000)throw Error('Dropbox 未确认有效期生效')
 return link
}
export async function prepareDropboxSharedLink(user:string,link:import('./electron/providers/dropboxShare').DropboxSharedLinkMetadata,expiration:string,password:string,check:()=>void){
 check()
 if(!link.url)throw Error('Dropbox 分享链接无效')
 if(!expiration&&!password)return link
 const settings:Record<string,unknown>={}
 if(password){settings.require_password=true;settings.link_password=password}
 if(expiration)settings.expires=new Date(expiration).toISOString().replace(/\.\d{3}Z$/,'Z')
 const response=await dropboxRpc<typeof link>(user,'/sharing/modify_shared_link_settings',{url:link.url,settings},'更新 Dropbox 分享选项失败');check()
 if(response.error||!response.data)throw Error(response.error||'Dropbox 分享选项未确认')
 const updated=response.data,permissions=updated.link_permissions as {require_password?:boolean;resolved_visibility?:{'.tag'?:string}}|undefined
 if(link.id&&updated.id!==link.id||updated.url!==link.url)throw Error('Dropbox 分享选项更新目标不匹配')
 if(password&&permissions?.require_password!==true&&permissions?.resolved_visibility?.['.tag']!=='password')throw Error('Dropbox 未确认密码保护生效')
 if(expiration&&Date.parse(updated.expires||'')!==Date.parse(String(settings.expires)))throw Error('Dropbox 未确认有效期生效')
 return updated
}

export async function quarkShareFetch(user:string,url:string,init:RequestInit){
 const parsed=new URL(url)
 if(parsed.origin!=='https://drive-pc.quark.cn'||!['/1/clouddrive/share','/1/clouddrive/share/password','/1/clouddrive/task'].includes(parsed.pathname))throw Error('夸克分享请求地址无效')
 const method=init.method||'GET'
 if(parsed.pathname.endsWith('/task')?method!=='GET':method!=='POST')throw Error('夸克分享请求方法无效')
 const result=await request(mutationAccount(user,'quark'),method,url,typeof init.body==='string'?init.body:undefined,{'Content-Type':'application/json'})
 return {ok:result.status>=200&&result.status<300,status:result.status,json:async()=>JSON.parse(text(result))}
}

import {nativeCall} from '@/platform/native'
export async function pikpakShareFetch(user:string,url:string,init:RequestInit){
 if(url!=='https://api-drive.mypikpak.com/drive/v1/share'||init.method!=='POST'||typeof init.body!=='string')throw Error('PikPak 分享请求无效')
 mutationAccount(user,'pikpak')
 const body=JSON.parse(init.body),needPassword=body.share_to==='encryptedlink'
 if(!Array.isArray(body.file_ids)||body.file_ids.some((id:unknown)=>typeof id!=='string')||!['publiclink','encryptedlink'].includes(body.share_to)||body.pass_code_option!==(needPassword?'REQUIRED':'NOT_REQUIRED')||!Number.isSafeInteger(body.expiration_days))throw Error('PikPak 分享参数无效')
 const data=await nativeCall<{share_id?:string|number;id?:string|number;share_url?:string;share_link?:string;pass_code?:string;passcode?:string;error?:string;message?:string;error_description?:string}>('pikpak_create_share',{accountId:user,fileIds:body.file_ids,needPassword,expirationDays:body.expiration_days})
 if(!data||typeof data!=='object'||['share_url','share_link','pass_code','passcode'].some(key=>(data as Record<string,unknown>)[key]!=null&&typeof (data as Record<string,unknown>)[key]!=='string'))throw Error('PikPak 分享结果格式无效')
 return {ok:true,json:async()=>data}
}
