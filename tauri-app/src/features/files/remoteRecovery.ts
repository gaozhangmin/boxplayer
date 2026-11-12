import {nativeCall} from '@/platform/native'
import {emptyFilePreferences,type FilePreferences} from './preferences'

interface Pending {
 receipt:{id:string;sourceId:string;revision:number;acknowledged:boolean}
 beforePreferences:FilePreferences
 afterPreferences:FilePreferences
}
export interface RemoteRecoveryConflict {operationId:string;sourceId:string;corruptStorage:boolean}
export type ResolveRemoteRecoveryConflict=(conflict:RemoteRecoveryConflict)=>Promise<boolean>
const key='tauri.filePreferences'
const running=new WeakMap<object,Promise<Pending[]>>()
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}'
 return JSON.stringify(value)
}
export {canonical as preferencesFingerprint}
function preferences(value:unknown):value is FilePreferences {
 if(!value||typeof value!=='object'||Array.isArray(value))return false
 const row=value as FilePreferences
 return typeof row.grid==='boolean'&&typeof row.showPreviews==='boolean'&&typeof row.descending==='boolean'&&['name','size','modified'].includes(row.sort)&&
  ['names','covers','hiddenOnHome','hiddenLocalRoots'].every(k=>{const v=(row as unknown as Record<string,unknown>)[k];return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.values(v).every(item=>typeof item===(['names','covers'].includes(k)?'string':'boolean'))})&&Array.isArray(row.order)&&row.order.every(v=>typeof v==='string')&&Array.isArray(row.favorites)&&row.favorites.every(v=>v&&typeof v.id==='string'&&typeof v.sourceId==='string'&&typeof v.path==='string'&&typeof v.name==='string'&&typeof v.local==='boolean')
}
/** Recover a committed native transition only; never replay the remote move.
 * Conflicting edits leave the durable receipt pending instead of overwriting them. */
export function recoverRemoteOperations(store:{preferences:FilePreferences},resolveConflict?:ResolveRemoteRecoveryConflict):Promise<Pending[]> {
 const existing=running.get(store);if(existing)return existing
 const work=(async()=>{
  const entries=await nativeCall<Pending[]>('remote_operations_pending')
  if(!Array.isArray(entries)||entries.some(entry=>!entry?.receipt||!entry.receipt.id||typeof entry.receipt.id!=='string'||!entry.receipt.sourceId||typeof entry.receipt.sourceId!=='string'||!Number.isSafeInteger(entry.receipt.revision)||entry.receipt.revision<0||entry.receipt.acknowledged!==false||!preferences(entry.beforePreferences)||!preferences(entry.afterPreferences))||new Set(entries.map(entry=>entry.receipt.id)).size!==entries.length)throw Error('远端身份恢复回执无效')
  for(const entry of entries){
   const before=canonical(entry.beforePreferences),after=canonical(entry.afterPreferences)
   const persisted=localStorage.getItem(key)
   let stored:unknown,corruptStorage=false
   try{stored=persisted===null?emptyFilePreferences():JSON.parse(persisted)}catch{corruptStorage=true}
   if(corruptStorage||![before,after].includes(canonical(store.preferences))||![before,after].includes(canonical(stored))){
    if(!resolveConflict)throw Error(corruptStorage?'文件收藏持久设置损坏，未覆盖恢复':'文件收藏已变化，请先解决远端移动恢复冲突')
    const live=JSON.stringify(store.preferences)
    if(!await resolveConflict({operationId:entry.receipt.id,sourceId:entry.receipt.sourceId,corruptStorage}))throw Error('已保留当前收藏设置，文件移动恢复仍待处理')
    if(JSON.stringify(store.preferences)!==live||localStorage.getItem(key)!==persisted)throw Error('确认期间收藏设置再次变化，请重新恢复')
    const backupKey=key+'.recoveryBackup.'+entry.receipt.id+'.'+crypto.randomUUID()
    // Never replace a prior backup if settings were edited again before retry.
    const backup=JSON.stringify({schemaVersion:1,operationId:entry.receipt.id,sourceId:entry.receipt.sourceId,preferences:JSON.parse(live),persistedPreferences:persisted})
    localStorage.setItem(backupKey,backup)
    if(localStorage.getItem(backupKey)!==backup)throw Error('当前收藏设置尚未备份，未覆盖恢复')
   }
   const serialized=JSON.stringify(entry.afterPreferences)
   localStorage.setItem(key,serialized)
   if(localStorage.getItem(key)!==serialized)throw Error('远端移动收藏尚未持久化')
   store.preferences=JSON.parse(serialized)
   // A synchronous store watcher must not silently replace what we acknowledge.
   if(canonical(store.preferences)!==after||localStorage.getItem(key)!==serialized)throw Error('文件收藏在恢复期间发生变化，未确认回执')
   await nativeCall('remote_operation_ack',{id:entry.receipt.id,sourceId:entry.receipt.sourceId,persistedPreferences:JSON.parse(serialized)})
  }
  return entries
 })()
 running.set(store,work)
 return work.finally(()=>{if(running.get(store)===work)running.delete(store)})
}
