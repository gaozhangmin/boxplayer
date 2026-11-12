import type {Account} from '@/features/sources/contracts'
import type {VideoItem} from '@/features/library/catalog'
import {pendingCloud189Trash,trashCloud189File,acknowledgeCloud189Trash} from './cloud189Trash'
import {mutationAccount} from './providerTransport'
import {purgeDeletedCatalog} from './trashCatalog'
interface Snapshot{items:VideoItem[];playlists:Record<string,string[]>;series:Record<string,string[]>}
interface Catalog{scanning?:boolean;scanSource?:string;cancelScan?():void;update(action:(draft:Snapshot)=>void,stillCurrent?:()=>boolean):Promise<unknown>}
export async function recoverCloud189Trash(account:Account,catalog:Catalog,stillCurrent:()=>boolean){
 const owner=JSON.stringify([account.userId||'',account.deviceId||'',account.baseUrl])
 const check=()=>{const current=mutationAccount(account.id,'189');if(!stillCurrent()||JSON.stringify([current.userId||'',current.deviceId||'',current.baseUrl])!==owner)throw Error('天翼恢复来源或账号身份已变化')}
 const jobs=pendingCloud189Trash(account),failures:string[]=[]
 for(const job of jobs){
  check()
  try{
   await trashCloud189File(account,job,stillCurrent);check()
   if(catalog.scanning&&catalog.scanSource===account.id)catalog.cancelScan?.()
   await catalog.update(draft=>{check();purgeDeletedCatalog(draft,account.id,[job])},stillCurrent)
   check();acknowledgeCloud189Trash(account.id,job.file_id)
  }catch(cause){check();failures.push(job.name+'：'+(cause instanceof Error?cause.message:'天翼回收同步未完成'))}
 }
 return {attempted:jobs.length,failures}
}
