import {cloud189,cloud189NativeScope} from '@/features/sources/cloud189'
import {cloud189FolderId} from './cloud189FolderTransport'
import {apiGuangyaFileDetail,getGuangyaFileId,getGuangyaFileName,isGuangyaDir,guangyaApiParentId,mapGuangyaFileToAliModel} from './electron/providers/guangyaMetadata'
import {guangyaId,withGuangyaDetailGuard} from './guangyaFileTransport'
import type {Account} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import {mutationAccount} from './providerTransport'
import {apiQuarkFileDetail} from './electron/providers/quarkMetadata'
import {quarkEntry} from './quarkListing'
import {quarkId} from './quarkFileTransport'
import {quarkTrashPage} from './quarkTrash'
import {baiduFileMetadata} from './baiduMetadata'
import {mapBaiduFileToAliModel,type BaiduFileItem} from './electron/providers/baiduListing'
function date(value:unknown,milliseconds=false){
 if(value===undefined||value===null||value===''||value===0)return ''
 const time=typeof value==='number'?value*(milliseconds&&value>100000000000?1:1000):typeof value==='string'?Date.parse(value):NaN
 if(!Number.isFinite(time)||time<0||!Number.isFinite(new Date(time).getTime()))throw Error('属性日期无效')
 return new Date(time).toISOString()
}
export async function readOriginalProviderProperties(account:Account,file:IAliGetFileModel,trash:boolean,check:()=>void){
 const owner=(value:Account)=>JSON.stringify([value.providerId,value.userId||'',value.deviceId||'',value.baseUrl]),identity=owner(account)
 const current=()=>{check();if(owner(mutationAccount(account.id,account.providerId))!==identity)throw Error('属性账号身份已变化')}
 current()
 if(account.providerId==='189'){
  if(trash)throw Error('天翼回收属性接口尚未接入')
  const location=cloud189NativeScope(file.file_id),parent=cloud189NativeScope(file.parent_file_id)
  if(location.families||parent.families||(location.familyId||'')!==(parent.familyId||''))throw Error('天翼属性文件与父目录空间不匹配')
  cloud189FolderId(location.fileId)
  let cursor:string|undefined,count=0
  do{
   current();const page=await cloud189.list(account,file.parent_file_id,cursor);current()
   count+=page.entries.length;if(count>100000)throw Error('天翼属性确认目录过大')
   const row=page.entries.find(value=>value.id===file.file_id)
   if(row){
    const model='electronModel'in row?row.electronModel as IAliGetFileModel:undefined
    if(!model||model.file_id!==file.file_id||model.parent_file_id!==file.parent_file_id||model.drive_id!==account.id||row.isDirectory!==file.isDir||model.isDir!==file.isDir)throw Error('天翼属性详情标识或类型不匹配')
    return {model,created:'',updated:model.time?new Date(model.time).toISOString():'',parent:file.parent_file_id}
   }
   cursor=page.nextCursor
  }while(cursor)
  throw Error('天翼属性文件已不存在，请刷新列表')
 }
 if(account.providerId==='guangya'){
  if(trash)throw Error('光鸭回收属性接口尚未接入')
  const id=guangyaId(file.file_id),raw=await withGuangyaDetailGuard(account.id,current,user=>apiGuangyaFileDetail(user,id));current()
  if(!raw||getGuangyaFileId(raw)!==id||isGuangyaDir(raw)!==file.isDir)throw Error('光鸭属性详情标识或类型不匹配')
  const name=raw.name||raw.fileName||raw.filename||raw.dirName||raw.title
  if(typeof name!=='string'||!getGuangyaFileName(raw))throw Error('光鸭属性名称无效')
  const resType=String(raw.resType??raw.res_type??'')
  if(resType==='1'&&isGuangyaDir(raw)||resType==='2'&&!isGuangyaDir(raw))throw Error('光鸭属性类型冲突')
  const location=raw.parentId??raw.parentFileId??raw.parent_id??raw.parent_file_id
  if(location===undefined)throw Error('光鸭属性实际父目录缺失')
  if(!file.isDir&&raw.size===undefined&&raw.fileSize===undefined&&raw.file_size===undefined)throw Error('光鸭属性文件大小未知')
  const parent=guangyaApiParentId(guangyaId(location,true)),model=mapGuangyaFileToAliModel(raw,account.id,parent||'guangya_root')
  if(!Number.isSafeInteger(model.size)||model.size<0||!Number.isFinite(model.time)||typeof model.thumbnail!=='string'||typeof model.content_hash!=='string'||typeof model.mime_type!=='string')throw Error('光鸭属性媒体字段无效')
  const iso=(value:unknown)=>{if(!value)return '';if(typeof value!=='string'&&typeof value!=='number')throw Error('光鸭属性日期无效');const instant=new Date(value);if(!Number.isFinite(instant.getTime())||instant.getTime()<0)throw Error('光鸭属性日期无效');return instant.toISOString()}
  const created=iso(raw.createAt||raw.createdAt||raw.created_at||raw.createTime),updated=iso(raw.updatedAt||raw.updateAt||raw.updated_at||raw.updateTime||raw.createAt||raw.createdAt||raw.created_at||raw.createTime)
  // Generic contentHash has no declared algorithm. Only label explicitly named
  // md5/sha1 fields when they are the original mapper's selected hash source.
  if(!raw.contentHash&&!raw.content_hash)model.content_hash_name=raw.md5?'md5':raw.sha1?'sha1':''
  return {model,created,updated,parent}
 }
 if(account.providerId==='quark'){
  const id=quarkId(file.file_id)
  if(trash){
   let cursor:string|undefined;const seen=new Set<string>()
   do{
    const page=await quarkTrashPage(account,cursor);current()
    for(const row of page.entries){
     if(seen.has(row.id))throw Error('夸克属性回收列表存在重复标识');seen.add(row.id)
     if(row.id===id){if(row.isDirectory!==file.isDir)throw Error('夸克属性类型不匹配');return {model:row.electronModel,created:'',updated:row.modified?new Date(row.modified).toISOString():'',parent:row.originalParent}}
    }
    cursor=page.nextCursor
   }while(cursor)
   throw Error('夸克回收文件已不存在，请刷新列表')
  }
  const raw=await apiQuarkFileDetail(account.id,id);current()
  if(!raw||quarkId(raw.fid)!==id||raw.pdir_fid===undefined)throw Error('夸克属性详情标识或父目录不匹配')
  const parent=quarkId(raw.pdir_fid,true),created=date(raw.created_at,true),updated=date(raw.updated_at||raw.created_at,true),row=quarkEntry(account,raw,parent)
  if(row.isDirectory!==file.isDir)throw Error('夸克属性类型不匹配')
  return {model:row.electronModel,created,updated,parent:parent==='0'?'':parent}
 }
 if(account.providerId==='baidu'){
  if(trash)throw Error('百度回收属性接口尚未接入')
  const raw=await baiduFileMetadata(account,file.file_id);current()
  if((raw.isdir===1)!==file.isDir||raw.size===undefined&&!file.isDir||raw.size!==undefined&&(!Number.isSafeInteger(raw.size)||raw.size<0)||raw.md5!==undefined&&typeof raw.md5!=='string')throw Error('百度属性类型、大小或摘要无效')
  const created=date(raw.server_ctime||raw.local_ctime),updated=date(raw.server_mtime||raw.server_ctime||raw.local_mtime||raw.local_ctime)
  const parent=raw.path!.slice(0,raw.path!.lastIndexOf('/'))||'/'
  // The upstream list type declares numeric fs_id; runtime strings have already
  // been validated without Number conversion and are passed through unchanged.
  const item={...raw,fs_id:raw.fs_id,server_filename:raw.filename!,server_mtime:raw.server_mtime??0,server_ctime:raw.server_ctime??0,size:raw.size??0,isdir:raw.isdir!,path:raw.path!} as unknown as BaiduFileItem
  const model=mapBaiduFileToAliModel(item,account.id,parent)
  if(model.file_id!==file.file_id||model.isDir!==file.isDir||typeof model.thumbnail!=='string')throw Error('百度属性原模型不匹配')
  if(raw.duration!==undefined&&(!Number.isFinite(raw.duration)||raw.duration<0))throw Error('百度属性媒体时长无效')
  return {model,created,updated,parent,path:parent,...(raw.duration!==undefined?{duration:String(raw.duration)}:{})}
 }
 throw Error('来源属性适配不匹配')
}
