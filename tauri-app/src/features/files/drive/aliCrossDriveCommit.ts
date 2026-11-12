import {nativeCall} from '@/platform/native'
import type {Account} from '@/features/sources/contracts'
import type {VideoItem} from '@/features/library/catalog'
import {readFilePreferences,type FilePreferences} from '../preferences'
import {preferencesFingerprint} from '../remoteRecovery'
import {recoverRemoteOperationsWithPrompt as recoverRemoteOperations} from '../remoteRecoveryPrompt'
import {prepareAliCrossDriveReferences} from './aliCrossDriveReferences'
import type {AliCrossDriveReceipt} from './aliRelocationTransport'

interface Catalog {schemaVersion:1;revision:number;items:VideoItem[];playlists:Record<string,string[]>;series:Record<string,string[]>}
interface Operation {id:string;sourceId:string;expectedRevision:number;catalog:Catalog;beforePreferences:FilePreferences;afterPreferences:FilePreferences;moves:{from:string;to:string}[]}
interface Job {owner:string;observation:string;operation:Operation}
const jobs=new Map<string,Job>()
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value))
/** The caller supplies the original transport's verified exhaustive receipt.
 * Retry retains the exact local transaction payload; it never submits a cloud move. */
export async function commitAliCrossDrive(account:Account,file:string,receipt:AliCrossDriveReceipt,ancestors:readonly string[],store:{preferences:FilePreferences},check:()=>void){
 check();if(account.providerId!=='aliyun'||!receipt.before.some(row=>row.id===file))throw Error('跨盘移动回执来源无效')
 const owner=JSON.stringify(account),key=JSON.stringify([account.id,file,receipt.destination]),observation=JSON.stringify(receipt)
 let job=jobs.get(key)
 if(job&&(job.owner!==owner||job.observation!==observation))throw Error('待同步跨盘移动身份已变化，请先完成原操作恢复')
 if(!job){
  if(jobs.size>=128)throw Error('待同步跨盘移动过多，请先恢复')
  await recoverRemoteOperations(store);check()
  const beforePreferences=clone(store.preferences)
  const catalog=await nativeCall<Catalog>('catalog_load');check()
  if(JSON.stringify(store.preferences)!==JSON.stringify(beforePreferences))throw Error('文件收藏正在修改，请重试跨盘同步')
  const raw=localStorage.getItem('tauri.filePreferences');if(raw!==null){try{JSON.parse(raw)}catch{throw Error('文件收藏持久设置损坏')}}
  if(preferencesFingerprint(readFilePreferences())!==preferencesFingerprint(beforePreferences))throw Error('文件收藏持久设置已变化，未覆盖同步')
  const draft=prepareAliCrossDriveReferences(catalog,beforePreferences,{sourceId:account.id,...receipt,selected:[file],destinationAncestors:[...ancestors]})
  // Normalize the previously persisted shape before native commit so recovery
  // can compare exact before/after states even after a process restart.
  const serialized=JSON.stringify(beforePreferences);localStorage.setItem('tauri.filePreferences',serialized)
  if(localStorage.getItem('tauri.filePreferences')!==serialized)throw Error('文件收藏尚未持久保存')
  check()
  job={owner,observation,operation:{id:crypto.randomUUID(),sourceId:account.id,expectedRevision:catalog.revision,catalog:draft.catalog,beforePreferences,afterPreferences:draft.preferences,moves:draft.identityMoves.map(({from,to})=>({from,to}))}}
  jobs.set(key,job)
 }
 const operation=job.operation
 let result:{id:string;sourceId:string;revision:number;acknowledged:boolean}
 try {result=await nativeCall('remote_identity_commit',{account:clone(account),operation:clone(operation)})}
 catch(cause){if(cause&&typeof cause==='object'&&'code'in cause&&cause.code==='REMOTE_IDENTITY_REVISION')jobs.delete(key);throw cause}
 check()
 if(result?.id!==operation.id||result.sourceId!==account.id||result.revision!==operation.expectedRevision+1||typeof result.acknowledged!=='boolean')throw Error('跨盘移动原生事务回执不匹配')
 await recoverRemoteOperations(store);check()
 return result
}
export function acknowledgeAliCrossDriveCommit(account:Account,file:string,destination:string){
 const key=JSON.stringify([account.id,file,destination]),job=jobs.get(key)
 if(job?.owner===JSON.stringify(account))jobs.delete(key)
}
