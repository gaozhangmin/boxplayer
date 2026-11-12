import {getDrivePane} from './ports'
import type {createShareImportSession} from './importShareSession'
import {apiGuangyaSaveShareFilesBatch} from './electron/providers/guangyaImport'
import {createRemoteFolder} from './folderMutations'
import {guangyaId} from './guangyaFileTransport'
import {guangyaApiParentId} from './electron/providers/guangyaMetadata'
export function createGuangyaImportWriter(reading:ReturnType<typeof createShareImportSession>){
 const pane=getDrivePane(),source=pane.sourceId,owned=new Set<string>(),created=new Map<string,string>()
 const done=new Set<string>(),fileKey=(id:string,parent:string,file:string)=>JSON.stringify([id,parent,file])
 const saves=new Map<string,{files:string[];result?:'success'|'async';pending?:Promise<string>;unknown?:boolean}>()
 function target(user:string,drive:string,parent:string){reading.check();reading.guangyaScope().check();if(user!==source||drive!==source||pane.account?.providerId!=='guangya')throw Error('转存目标账号或通道不匹配');const location=guangyaApiParentId(['root','backup_root'].includes(parent)?'':parent);guangyaId(location,true);if(location&&!pane.file?.(parent)?.isDir&&!owned.has(parent))throw Error('请选择已读取的目标文件夹');return location}
 return {
  async save(id:string,token:string,user:string,drive:string,parent:string,ids:string[]){
   reading.selection(id,token,ids);if(!id.startsWith('guangya:'))throw Error('分享与目标提供商不匹配');const destination=target(user,drive,parent)
   const todo=ids.filter(file=>!done.has(fileKey(id,destination,file)));if(!todo.length)return 'success'
   const keys=todo.map(file=>fileKey(id,destination,file)),key=JSON.stringify([id,destination,[...todo].sort()]);let state=saves.get(key)
   for(const [other,entry] of saves)if(other!==key&&(entry.pending||entry.files.some(file=>keys.includes(file))&&(entry.result==='async'||entry.unknown)))throw Error('所选文件已有在途或未知转存，请先核对原操作')
   if(state?.pending)return state.pending;if(state?.result)return state.result;if(state?.unknown)throw Error('转存结果不确定，请检查目标文件夹；不会重复提交')
   if(!state){state={files:keys};saves.set(key,state)}const active=state,scope=reading.guangyaScope()
   const pending=(async()=>{scope.beginSave();try{
    const result=await apiGuangyaSaveShareFilesBatch(id,token,scope.id,destination,todo);reading.check();if(result!=='success')throw Error(result)
    const receipt=scope.receipt();if(receipt.ack==='none')throw Error('光鸭未确认转存回执')
    active.result=receipt.ack==='pending'?'async':'success';if(active.result==='success')keys.forEach(file=>done.add(file));return active.result
   }catch(error){if(scope.receipt().submitted)active.unknown=true;throw error}})();active.pending=pending
   try{return await pending}finally{active.pending=undefined}
  },
  async createFolder(user:string,drive:string,parent:string,name:string){target(user,drive,parent);const key=JSON.stringify([parent,name]);if(created.has(key))return {file_id:created.get(key),error:''};const result=await createRemoteFolder(pane.account!,parent,name);reading.check();reading.guangyaScope().check();if(!result.file_id)throw Error('新建转存文件夹缺少标识');owned.add(result.file_id);created.set(key,result.file_id);return result}
 }
}
