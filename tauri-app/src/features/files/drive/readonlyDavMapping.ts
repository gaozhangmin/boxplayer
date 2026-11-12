import type {Account} from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
import {listWebDavDirectory,toAliModel,getApiBaseUrl,type WebDavConnectionConfig} from './electron/providers/readonlyDav'
import {withReadonlyDavPayload,type ReadonlyDavStat} from './readonlyDavPorts'
export function readonlySourceCheck(account:Account){
 const owner=(value:Account)=>JSON.stringify([value.providerId,value.userId||'',value.deviceId||'',value.baseUrl]),expected=owner(account)
 return ()=>{if(!['webdav','alist'].includes(account.providerId)||owner(mutationAccount(account.id,account.providerId))!==expected)throw Error('只读文件来源账号身份已变化')}
}
export function readonlyDavConfig(account:Account):WebDavConnectionConfig{
 return {id:account.id,kind:account.providerId==='alist'?'alist':'webdav',name:account.name,url:account.baseUrl.replace(/\/+$/,'')+(account.providerId==='alist'?'/dav':''),rootPath:'/',username:'',password:'',createdAt:''}
}
export function originalDavModel(account:Account,stat:ReadonlyDavStat){return toAliModel(readonlyDavConfig(account),stat)}
export async function originalAListModels(account:Account,parent:string,data:unknown){
 const config=readonlyDavConfig(account)
 return withReadonlyDavPayload(config,{path:parent,data},()=>listWebDavDirectory(config,parent))
}

export const readonlyAListApiBase=(account:Account)=>getApiBaseUrl(readonlyDavConfig(account))
