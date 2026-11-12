import {nativeCall} from '@/platform/native'
import type {FilePreferences} from './preferences'
export interface Recovery {id:string;sourceId:string;applied:boolean;from?:string;to?:string;directory?:boolean}
let running:Promise<Recovery[]>|undefined
/** Replay only applied native transitions. Persist current preferences before ack;
 * a failed write or lost response leaves the native journal available on restart. */
export function recoverLocalOperations(store:{preferences:FilePreferences}){
 if(running)return running
 const work=(async()=>{
  const entries=await nativeCall<Recovery[]>('local_operations_recover')
  if(!Array.isArray(entries)||entries.some(row=>!row||typeof row.id!=='string'||!row.id||typeof row.sourceId!=='string'||!row.sourceId||row.applied!==true))throw Error('本地恢复回执无效')
  for(const entry of entries){
   let persisted=false
   for(let attempt=0;attempt<3;attempt++){
    const before=JSON.stringify(store.preferences)
    const result=await nativeCall<{id:string;sourceId:string;preferences:FilePreferences}>('local_operation_preferences',{id:entry.id,sourceId:entry.sourceId,preferences:JSON.parse(before)})
    if(result?.id!==entry.id||result.sourceId!==entry.sourceId||!result.preferences||typeof result.preferences!=='object'||Array.isArray(result.preferences))throw Error('本地收藏恢复来源不匹配')
    if(JSON.stringify(store.preferences)!==before)continue
    const serialized=JSON.stringify(result.preferences)
    localStorage.setItem('tauri.filePreferences',serialized)
    if(localStorage.getItem('tauri.filePreferences')!==serialized)throw Error('本地收藏恢复尚未持久化')
    store.preferences=result.preferences
    persisted=true;break
   }
   if(!persisted)throw Error('文件收藏正在修改，请稍后重试本地恢复')
   await nativeCall('local_operation_ack',{id:entry.id,sourceId:entry.sourceId})
  }
  return entries
 })()
 running=work
 return work.finally(()=>{if(running===work)running=undefined})
}
