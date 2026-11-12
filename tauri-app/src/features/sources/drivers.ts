import type { SourceDriver, Account, SourceEntry } from './contracts'
import { networkShare } from './networkShare'
import { webdav } from './webdav'
import { onedrive, dropbox, box, google, cloud123, drive115, quark, baidu } from './cloud'
import { plex } from './plex'
import { mediaServer } from './mediaServer'
import { alipan } from './alipan'
import { alist } from './alist'
import { guangya } from './guangya'
import { pikpak } from './pikpak'
import { cloud139 } from './cloud139'
import { cloud189 } from './cloud189'
import { nativeCall } from '@/platform/native'
const drivers:Partial<Record<Account['providerId'],SourceDriver>>={smb:networkShare,nfs:networkShare,ftp:networkShare,webdav,alist,guangya,pikpak,'139':cloud139,'189':cloud189,'alipan-open':alipan,aliyun:alipan,jellyfin:mediaServer,emby:mediaServer,onedrive,dropbox,box,google,'123':cloud123,'115':drive115,quark,baidu,plex}
export function driver(account:Account):SourceDriver {const value=drivers[account.providerId];if(!value)throw new Error('此来源协议尚未接入');return value}
export async function playSource(account:Account,entry:SourceEntry,siblings?:SourceEntry[]){
 const entries=(siblings||[entry]).filter(item=>item.playable&&!item.isDirectory)
 const index=entries.findIndex(item=>item.id===entry.id)
 if(index<0)throw new Error('播放文件不在当前列表中')
 if(entries.length>1000)throw new Error('当前播放列表超过1000项，请缩小范围')
 await nativeCall('player_open_source_queue',{accountId:account.id,entries:entries.map(item=>({fileId:item.id,title:item.name})),index})
}
