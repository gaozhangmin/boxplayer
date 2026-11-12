import type { Account, SourceDriver, SourceEntry } from './contracts'
import { json } from './transport'
import {aliDirectoryEntry} from '@/features/files/drive/aliDirectoryModel'
const openApi='https://openapi.alipan.com'
function channel(account:Account){if(account.providerId==='aliyun')return{api:'https://api.aliyundrive.com',info:'https://user.aliyundrive.com/v2/user/get',list:'/adrive/v3/file/list',download:'/v2/file/get_download_url',web:true};if(account.providerId==='alipan-open')return{api:openApi,info:openApi+'/adrive/v1.0/user/getDriveInfo',list:'/adrive/v1.0/openFile/list',download:'/adrive/v1.0/openFile/getDownloadUrl',web:false};throw new Error('阿里云盘通道不匹配')}
interface Location { driveId:string; fileId:string }
function id(driveId:string,fileId:string){return JSON.stringify({driveId,fileId})}
function location(value:string):Location {
 const result=JSON.parse(value) as Location
 if(typeof result.driveId!=='string'||!result.driveId||typeof result.fileId!=='string'||!result.fileId)throw new Error('阿里云盘文件位置无效')
 return result
}
function check<T extends {code?:unknown}>(data:T):T {if(data.code!==undefined)throw new Error('阿里云盘请求失败，请检查账号权限');return data}
export const alipan:SourceDriver={
 async list(account,parent,cursor){
  const endpoint=channel(account)
  if(!parent){
   const data=check(await json<{code?:string;resource_drive_id?:string;backup_drive_id?:string;default_drive_id?:string}>(account,'POST',endpoint.info,{}))
   const seen=new Set<string>();const entries:SourceEntry[]=[]
   for(const [driveId,name] of [[data.resource_drive_id,'资源盘'],[data.backup_drive_id,'备份盘'],[data.default_drive_id,'网盘']] as const){if(driveId&&!seen.has(driveId)){seen.add(driveId);entries.push({id:id(driveId,'root'),name,isDirectory:true,size:0,playable:false})}}
   return{entries}
  }
  const {driveId,fileId}=location(parent)
  const data=check(await json<{code?:string;items:{file_id:string;name:string;type:string;size?:number;starred?:boolean;description?:string}[];next_marker?:string}>(account,'POST',endpoint.api+endpoint.list,{drive_id:driveId,parent_file_id:fileId,marker:cursor||'',limit:100,order_by:'name',order_direction:'ASC',...(endpoint.web?{all:false,url_expire_sec:14400,fields:'*'}:{})}))
  if(!Array.isArray(data.items)||data.next_marker!==undefined&&typeof data.next_marker!=='string'||data.next_marker&&data.next_marker===cursor)throw Error('阿里目录分页响应无效或游标重复')
  const entries=data.items.map(item=>aliDirectoryEntry(account,driveId,fileId,item))
  if(new Set(entries.map(row=>row.id)).size!==entries.length)throw Error('阿里目录返回重复文件')
  return{entries,nextCursor:data.next_marker||undefined}
 },
 async resolve(account,item){
  const endpoint=channel(account)
  const {driveId,fileId}=location(item.id)
  const data=check(await json<{code?:string;url?:string;cdn_url?:string;expiration?:string}>(account,'POST',endpoint.api+endpoint.download,{drive_id:driveId,file_id:fileId,...(endpoint.web?{}:{expire_sec:14400})}))
  const url=new URL(data.cdn_url||data.url||'');if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('阿里云盘下载地址无效')
  return{schemaVersion:1,sourceId:account.id,accountId:account.id,fileId:item.id,url:url.href,headers:{Referer:'https://www.aliyundrive.com/'}}
 }
}
