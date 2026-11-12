import {ApiCreatShare,ApiUpdateShareBatch} from './electron/providers/aliShare'
import {ApiCreatTransferShare} from './electron/providers/aliTransferShare'
import {apiPikPakShareCreate} from './electron/providers/pikpakShare'
import {apiQuarkShareCreate} from './electron/providers/quarkShare'
import {apiDropboxShareCreate} from './electron/providers/dropboxShare'
import {apiGuangyaShareCreate} from './electron/providers/guangyaShare'
import {apiCloud123ShareCreate,apiCloud123PaidShareCreate,getCloud123ShareUrl} from './electron/providers/cloud123Share'
import {toExpireDays} from './electron/providers/cloud123ShareExpiry'
import {getDrivePane} from './ports'
import {mutationAccount} from './providerTransport'
import {apiOneDriveShareCreate} from './electron/providers/oneDriveShare'
import {apiGoogleShareCreate} from './electron/providers/googleShare'
import {apiBoxShareCreate} from './electron/providers/boxShare'
import {createSourceShare} from '@/features/sources/share'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
export interface PaidShareOptions {amount:number;description:string;reward:boolean}
export function createDriveShare(files:IAliGetFileModel[]){
 const pane=getDrivePane(),source=pane.sourceId,context=pane.context,selected=new Map(files.map(file=>[file.file_id,{...file}]))
 const accountOwner=pane.account?JSON.stringify(pane.account):undefined,provider=pane.account?.providerId
 let closed=false
 const aliCreated=new Map<string,import('./electron/aliapi/alimodels').IAliShareItem>()
 function check(){
  if(closed||getDrivePane()!==pane||pane.sourceId!==source||pane.context!==context)throw Error('分享窗口已关闭或来源已切换')
  if(provider&&(JSON.stringify(pane.account)!==accountOwner||JSON.stringify(mutationAccount(source,provider))!==accountOwner))throw Error('分享账号已变化，请关闭窗口后重新选择文件')
 }
 return {check,dispose(){closed=true},async create(ids:string[],title:string,expiration:string,password:string,transfer=false,paid?:PaidShareOptions){
  check();const account=pane.account;if(!account||pane.local)throw Error('本地来源不能创建网盘分享')
  mutationAccount(source,account.providerId)
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!selected.has(id)||selected.get(id)!.drive_id!==source))throw Error('分享选择或来源不匹配')
  if(paid&&(account.providerId!=='123'||transfer))throw Error('当前来源不支持123付费分享')
  if(paid&&(typeof paid.description!=='string'||paid.description.length>200||typeof paid.reward!=='boolean'))throw Error('付费分享说明或打赏选项无效')
  if(transfer&&account.providerId!=='aliyun')throw Error('当前来源不能通过阿里网页通道创建快传')
  if(account.providerId==='alipan-open')throw Error('阿里开放通道未接分享，请使用网页通道')
  if(account.providerId==='aliyun'){
   const locations=ids.map(id=>{let value:unknown;try{value=JSON.parse(id)}catch{throw Error('阿里分享文件位置无效')};const item=value as {driveId?:unknown;fileId?:unknown}|null;if(!item||typeof item.driveId!=='string'||!item.driveId||typeof item.fileId!=='string'||!item.fileId||item.fileId==='root')throw Error('请选择阿里盘内的实际文件或文件夹');return {driveId:item.driveId,fileId:item.fileId}})
   const drive=locations[0]!.driveId
   if(locations.some(location=>location.driveId!==drive))throw Error('阿里分享一次只能选择同一个盘的文件')
   const rawIds=locations.map(location=>location.fileId)
   if(new Set(rawIds).size!==rawIds.length)throw Error('阿里分享选择重复')
   const key=JSON.stringify([drive,rawIds,transfer,expiration,password,title])
   const result=aliCreated.get(key)||(transfer?await ApiCreatTransferShare(source,drive,rawIds):await ApiCreatShare(source,drive,expiration,password,title,rawIds,selected.get(ids[0]!)!.isDir));check()
   if(typeof result==='string')throw Error(result)
   if(!result.share_id||!result.share_url)throw Error('阿里未返回完整分享标识')
   if(result.drive_id&&result.drive_id!==drive||result.file_id_list&&(result.file_id_list.length!==rawIds.length||!rawIds.every(id=>result.file_id_list.includes(id))))throw Error('阿里分享结果文件或盘标识不匹配')
   const url=new URL(result.share_url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('阿里分享链接无效')
   if(!transfer&&password&&result.share_pwd!==password)throw Error('阿里未确认提取码生效')
   aliCreated.set(key,result)
   if(!transfer&&result.share_name!==title){
    const updates=await ApiUpdateShareBatch(source,[result.share_id],[expiration],[password],[title]);check()
    const updated=updates.find(item=>item.share_id===result.share_id)
    if(!updated||updated.share_name!==title||password&&updated.share_pwd!==password)throw Error('阿里分享已创建，但标题更新未确认，请使用原选项重试')
    Object.assign(result,updated)
   }
   return {url:result.share_url,password:result.share_pwd||''}
  }
  if(account.providerId==='pikpak'){
   const result=await apiPikPakShareCreate(source,ids,!!password,expiration);check()
   if(result.error||!result.shareId||!result.shareUrl)throw Error(result.error||'PikPak 未返回完整分享结果')
   const url=new URL(result.shareUrl);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('PikPak 分享链接无效')
   if(password&&!result.passCode)throw Error('PikPak 未返回生成的提取码')
   return {url:result.shareUrl,password:result.passCode}
  }
  if(account.providerId==='quark'){
   const result=await apiQuarkShareCreate(source,expiration,password,title,ids,check);check()
   if(typeof result==='string')throw Error(result)
   if(!result.share_url||!result.share_id||result.share_id==='quark:')throw Error('夸克未返回完整分享结果')
   const url=new URL(result.share_url);if(url.protocol!=='https:'||url.hostname!=='pan.quark.cn'||!/^\/s\/[A-Za-z0-9]+\/?$/.test(url.pathname)||url.username||url.password)throw Error('夸克分享链接无效')
   if(password&&result.share_pwd!==password)throw Error('夸克未确认提取码生效')
   return {url:result.share_url,password:result.share_pwd}
  }
  if(account.providerId==='123'){
   const uid=account.userId?.replace(/^cloud123_/,'')
   if(!uid||!/^\d+$/.test(uid)||ids.some(id=>!/^\d+$/.test(id)))throw Error('123 分享缺少有效的用户或文件标识')
   const result=paid?await apiCloud123PaidShareCreate(source,title,ids,paid.amount,paid.description,paid.reward?1:0):await apiCloud123ShareCreate(source,title,toExpireDays(expiration),ids,password);check()
   if(result.error||!result.shareId||!result.shareKey)throw Error(result.error||'123 未返回完整分享标识')
   if(!/^[A-Za-z0-9_-]+$/.test(result.shareKey))throw Error('123 分享标识无效')
   return {url:getCloud123ShareUrl('cloud123_'+uid,result.shareKey),password:paid?'':password}
  }
  if(['box','google','onedrive','guangya','dropbox'].includes(account.providerId)){
   if(account.providerId==='onedrive'&&(expiration||password))throw Error('OneDrive 分享暂不支持提取码或有效期，请清空后重试')
   const result=account.providerId==='dropbox'
    ?await apiDropboxShareCreate(source,source,ids,expiration,password,title,check)
    :account.providerId==='guangya'
    ?await apiGuangyaShareCreate(source,expiration,password,title,ids)
    :account.providerId==='box'
    ?await apiBoxShareCreate(source,source,ids,title,selected.get(ids[0]!)!.isDir,expiration,password)
    :account.providerId==='google'
    ?await apiGoogleShareCreate(source,source,ids,title,expiration,password,check)
    :await apiOneDriveShareCreate(source,source,ids,title)
   check()
   if(result.error||!result.item)throw Error(result.error||'创建分享失败')
   if(result.item.file_id_list.length!==ids.length||!ids.every(id=>result.item!.file_id_list.includes(id)))throw Error('分享结果文件标识不匹配')
   const url=new URL(result.item.share_url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('分享链接无效')
   return {url:result.item.share_url,password:result.item.share_pwd||password}
  }
  if(ids.length!==1)throw Error('此来源组合分享尚未接入；可选择为每个文件单独创建')
  if(expiration||password)throw Error('此来源提取码与有效期选项尚未接入，请清空后重试')
  const result=await createSourceShare(account,ids[0]!,title);check();return result
 }}
}
