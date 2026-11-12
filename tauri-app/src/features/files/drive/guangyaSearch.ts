import type {Account} from '@/features/sources/contracts'
import {apiGuangyaSearch} from './electron/providers/guangyaSearch'
import {guangyaApiParentId} from './electron/providers/guangyaMetadata'
import {guangyaId} from './guangyaFileTransport'
import {mutationAccount} from './providerTransport'
export async function searchGuangya(account:Account,query:string,cursor?:string){
 if(account.providerId!=='guangya')throw Error('光鸭搜索来源不匹配')
 mutationAccount(account.id,'guangya')
 if(cursor)throw Error('光鸭原搜索不支持继续分页')
 if(typeof query!=='string'||query.length>1024||/[\u0000-\u001f]/.test(query))throw Error('光鸭搜索词无效')
 const models=await apiGuangyaSearch(account.id,query);mutationAccount(account.id,'guangya')
 const seen=new Set<string>()
 const entries=models.map(original=>{
  const id=guangyaId(original.file_id),parent=guangyaApiParentId(guangyaId(original.parent_file_id,true))
  if(seen.has(id))throw Error('光鸭搜索重复文件标识');seen.add(id)
  if(!original.name||!Number.isSafeInteger(original.size)||original.size<0||!Number.isFinite(original.time)||typeof original.thumbnail!=='string')throw Error('光鸭搜索文件元数据无效')
  return {id,name:original.name,isDirectory:original.isDir,size:original.size,modified:original.time,originalParent:parent,playable:!original.isDir&&['video','video2'].includes(original.category),electronModel:{...original,drive_id:account.id}}
 })
 return {entries,nextCursor:undefined}
}
