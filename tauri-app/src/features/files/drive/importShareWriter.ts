import {getDrivePane} from './ports'
import {postAliImport} from './aliImportMutations'
import {ApiSaveShareFilesBatch} from './electron/providers/aliImportSave'
import type {createShareImportSession} from './importShareSession'
export function createShareImportWriter(reading:ReturnType<typeof createShareImportSession>){
 const pane=getDrivePane(),source=pane.sourceId,acknowledged=new Map<string,'done'|'pending'>(),created=new Map<string,string>(),owned=new Set<string>()
 function target(user:string,drive:string,parent:string){
  reading.check();if(pane.account?.providerId!=='aliyun'||user!==source||drive!==source)throw Error('转存目标账号或通道不匹配')
  const known=pane.file?.(parent);if(!known?.isDir&&!owned.has(parent))throw Error('请选择已读取的目标文件夹')
  let value:any;try{value=JSON.parse(parent)}catch{throw Error('请选择实际资源盘、备份盘或盘内文件夹')}
  if(typeof value?.driveId!=='string'||!value.driveId||typeof value?.fileId!=='string'||!value.fileId)throw Error('转存目标位置无效')
  return value as {driveId:string;fileId:string}
 }
 return {
  async save(id:string,token:string,user:string,drive:string,parent:string,ids:string[]){
   reading.selection(id,token,ids);const destination=target(user,drive,parent),key=(file:string)=>JSON.stringify([id,destination.driveId,destination.fileId,file])
   const todo=ids.filter(file=>!acknowledged.has(key(file)))
   if(todo.length){const result=await ApiSaveShareFilesBatch(id,token,user,destination.driveId,destination.fileId,todo,{check:reading.check,ack(file,state){reading.check();acknowledged.set(key(file),state)}});reading.check();if(!['success','async'].includes(result))throw Error('转存部分失败：'+result)}
   return ids.some(file=>acknowledged.get(key(file))==='pending')?'async':'success'
  },
  async createFolder(user:string,drive:string,parent:string,name:string){
   const destination=target(user,drive,parent);if(!name||/[\u0000-\u001f/\\]/.test(name)||name==='.'||name==='..')throw Error('转存文件夹名称无效')
   const key=JSON.stringify([parent,name]);if(created.has(key))return {file_id:created.get(key)!,error:''}
   const data=await postAliImport(user,'adrive/v2/file/createWithFolders',{drive_id:destination.driveId,parent_file_id:destination.fileId,name,check_name_mode:'refuse',type:'folder',description:''});reading.check()
   if(typeof data.file_id!=='string'||!data.file_id||data.file_id===destination.fileId||data.drive_id&&data.drive_id!==destination.driveId||data.parent_file_id&&data.parent_file_id!==destination.fileId)throw Error('新建转存文件夹结果不匹配')
   const encoded=JSON.stringify({driveId:destination.driveId,fileId:data.file_id});created.set(key,encoded);owned.add(encoded);return {file_id:encoded,error:''}
  }
 }
}
