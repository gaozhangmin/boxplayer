import { nativeCall } from '@/platform/native'
import type { SourceDriver, SourceEntry, SourcePage, ResolvedMedia } from './contracts'
export const networkShare: SourceDriver = {
 async list(account,parent,cursor):Promise<SourcePage>{
  if(cursor)throw Error('网络共享不支持此分页位置')
  return nativeCall('network_share_list',{accountId:account.id,parent:['root','/','backup_root'].includes(parent)?'':parent})
 },
 async resolve(account,entry:SourceEntry):Promise<ResolvedMedia>{
  if(entry.isDirectory)throw Error('不能播放文件夹')
  return nativeCall('network_share_resolve',{accountId:account.id,fileId:entry.id})
 }
}
