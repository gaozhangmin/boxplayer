import type {Account} from '@/features/sources/contracts'
import type {VideoItem} from '@/features/library/catalog'
import {pendingCloud189Moves,moveCloud189File,acknowledgeCloud189Move} from './cloud189Move'
import {mutationAccount} from './providerTransport'
import {updateMovedCatalogItems} from './relocationCatalog'
interface Catalog{scanning?:boolean;scanSource?:string;cancelScan?():void;update(action:(draft:{items:VideoItem[]})=>void,stillCurrent?:()=>boolean):Promise<unknown>}
export async function recoverCloud189Moves(account:Account,catalog:Catalog,stillCurrent:()=>boolean){
 const owner=JSON.stringify([account.userId||'',account.deviceId||'',account.baseUrl])
 const check=()=>{const current=mutationAccount(account.id,'189');if(!stillCurrent()||JSON.stringify([current.userId||'',current.deviceId||'',current.baseUrl])!==owner)throw Error('天翼恢复来源或账号身份已变化')}
 const jobs=pendingCloud189Moves(account),failures:string[]=[]
 for(const job of jobs){
  check()
  try{
   await moveCloud189File(account,job,job.target,stillCurrent,job.ancestors);check()
   if(catalog.scanning&&catalog.scanSource===account.id)catalog.cancelScan?.()
   await catalog.update(draft=>{check();updateMovedCatalogItems(draft.items,account.id,[job],job.target,job.ancestors)},stillCurrent)
   check();acknowledgeCloud189Move(account.id,job.file_id,job.target)
  }catch(cause){check();failures.push(job.name+'：'+(cause instanceof Error?cause.message:'天翼移动同步未完成'))}
 }
 return {attempted:jobs.length,failures}
}
