import type {Account} from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
import {guangyaId} from './guangyaFileTransport'
import {apiGuangyaFileListPage,guangyaApiParentId,getGuangyaFileId,getGuangyaFileName,mapGuangyaFileToAliModel} from './electron/providers/guangyaMetadata'
export async function listGuangya(account:Account,parent:string,cursor?:string){
 if(account.providerId!=='guangya')throw Error('光鸭来源不匹配')
 mutationAccount(account.id,'guangya');const location=guangyaApiParentId(['root','backup_root'].includes(parent)?'':parent);guangyaId(location,true)
 let page=0,previous:string[]=[],hashes:string[]=[]
 if(cursor){let data:any;try{data=JSON.parse(cursor)}catch{throw Error('光鸭列表游标无效')}
  if(data?.source!==account.id||data.parent!==location||!Number.isSafeInteger(data.page)||data.page<1||!Array.isArray(data.previous)||data.previous.length!==100||data.previous.some((id:unknown)=>typeof id!=='string'||!id)||new Set(data.previous).size!==data.previous.length||!Array.isArray(data.hashes)||data.hashes.length!==data.page||data.hashes.some((hash:unknown)=>typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)))throw Error('光鸭列表游标范围无效')
  page=data.page;previous=data.previous;hashes=data.hashes
 }
 const result=await apiGuangyaFileListPage(account.id,location,page,100);mutationAccount(account.id,'guangya')
 if(result.items.length>100)throw Error('光鸭列表超过请求页大小')
 const ids=result.items.map(item=>guangyaId(getGuangyaFileId(item))),seen=new Set(previous)
 if(new Set(ids).size!==ids.length||ids.some(id=>seen.has(id)))throw Error('光鸭列表重复文件标识')
 const entries=result.items.map(item=>{
  if(!getGuangyaFileName(item)||typeof(item.name||item.fileName||item.filename||item.dirName||item.title)!=='string')throw Error('光鸭文件缺少名称')
  const actualParent=item.parentId??item.parentFileId??item.parent_id??item.parent_file_id
  if(actualParent!==undefined&&guangyaApiParentId(guangyaId(actualParent,true))!==location)throw Error('光鸭列表父目录不匹配')
  const electronModel=mapGuangyaFileToAliModel(item,account.id,location||'guangya_root')
  if(!Number.isSafeInteger(electronModel.size)||electronModel.size<0||!Number.isFinite(electronModel.time)||typeof electronModel.thumbnail!=='string')throw Error('光鸭列表大小、时间或缩略图无效')
  return {id:electronModel.file_id,name:electronModel.name,isDirectory:electronModel.isDir,size:electronModel.size,modified:electronModel.time,playable:!electronModel.isDir&&['video','video2'].includes(electronModel.category),originalParent:location,electronModel}
 })
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([...ids].sort()))),hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')
 if(ids.length&&hashes.includes(hash))throw Error('光鸭分页重复整页')
 return {entries,nextCursor:result.hasMore?JSON.stringify({source:account.id,parent:location,page:page+1,previous:ids,hashes:[...hashes,hash]}):undefined}
}
