import type {Account} from '@/features/sources/contracts'
import type {VideoItem} from '@/features/library/catalog'
import type {FilePreferences} from '../preferences'
import {mutationAccount} from './providerTransport'
import {pendingBaiduMoves,confirmPendingBaiduMove,acknowledgeBaiduMove,type BaiduMoveResult} from './baiduMoveMutations'
import {updateMovedCatalogItems} from './relocationCatalog'
import {updateBaiduMoveCatalog,baiduRenamedPreferences} from './baiduRenameReferences'
interface Catalog {scanning?:boolean;scanSource?:string;cancelScan?():void;update(action:(draft:{items:VideoItem[]})=>void,stillCurrent?:()=>boolean):Promise<unknown>}
export async function recoverBaiduMoves(account:Account,catalog:Catalog,readPreferences:()=>FilePreferences,stillCurrent:()=>boolean){
 const owner=JSON.stringify([account.userId||'',account.deviceId||'',account.baseUrl])
 const check=()=>{const actual=mutationAccount(account.id,'baidu');if(JSON.stringify([actual.userId||'',actual.deviceId||'',actual.baseUrl])!==owner||!stillCurrent())throw Error('恢复来源或账号身份已变化')}
 const observed:BaiduMoveResult[]=[],confirmed:BaiduMoveResult[]=[],failures:string[]=[]
 const jobs=pendingBaiduMoves(account)
 for(const job of jobs){
  check()
  try{
   if(!job.ancestors)throw Error('缺少原目标目录上下文，请重新选择原目标以确认')
   const result=await confirmPendingBaiduMove(account,job.fileId,stillCurrent);check();observed.push(result)
   if(catalog.scanning&&catalog.scanSource===account.id)catalog.cancelScan?.()
   await catalog.update(draft=>{check();updateMovedCatalogItems(draft.items,account.id,[result],result.parent_file_id,job.ancestors!);updateBaiduMoveCatalog(draft.items,account.id,[result])},stillCurrent)
   check();const preferences=readPreferences();Object.assign(preferences,baiduRenamedPreferences(preferences,account.id,[result]));acknowledgeBaiduMove(account.id,result);confirmed.push(result)
  }catch(cause){check();failures.push(job.name+'：'+(cause instanceof Error?cause.message:'移动同步未完成'))}
 }
 return {observed,confirmed,failures,attempted:jobs.length}
}
export function recoveredBaiduLocation(path:string,moves:ReadonlyArray<BaiduMoveResult>){
 let value=path
 for(const move of moves){if(!move.isDir)continue;if(value===move.previousPath||value.startsWith(move.previousPath+'/'))value=move.path+value.slice(move.previousPath.length)}
 return value
}
