import type {Account} from '@/features/sources/contracts'
import {alipan} from '@/features/sources/alipan'
import {playable} from '@/features/sources/transport'
import {ApiTrashFileListOnePage,ApiDeletedFileListOnePage,ApiFavorFileListOnePage} from './electron/providers/aliTrashList'
import type {IAliFileResp} from './aliTrashListPorts'
import type {TrashEntry} from './trashMutations'
import {getDrivePane} from './ports'
import {aliFolderAccount} from './aliFolderTransport'
export async function aliTrashPage(account:Account,cursor?:string,recover=false,favorite=false){
 const pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account),check=()=>{if(getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id||JSON.stringify(aliFolderAccount(account.id))!==owner)throw Error('阿里回收站来源已切换')}
 check();const roots=await alipan.list(account,'');check()
 const drives=roots.entries.map(row=>JSON.parse(row.id).driveId as string);if(!drives.length||new Set(drives).size!==drives.length)throw Error('阿里网盘根信息无效')
 let index=0,marker=''
 if(cursor){let parsed:any;try{parsed=JSON.parse(cursor)}catch{throw Error('阿里回收站游标无效')};index=drives.indexOf(parsed.drive);if(index<0||typeof parsed.marker!=='string')throw Error('阿里回收站游标来源不匹配');marker=parsed.marker}
 const dir:IAliFileResp={m_user_id:account.id,m_drive_id:drives[index]!,next_marker:marker,items:[],recover,favorite}
 await (recover?ApiDeletedFileListOnePage:favorite?ApiFavorFileListOnePage:ApiTrashFileListOnePage)('updated_at','DESC',dir,0);check()
 const entries:TrashEntry[]=dir.items.map(row=>({id:JSON.stringify({driveId:dir.m_drive_id,fileId:row.file_id}),name:row.name,isDirectory:row.type==='folder',size:Number(row.size)||0,playable:row.type==='file'&&playable(row.name),originalParent:row.parent_file_id?JSON.stringify({driveId:dir.m_drive_id,fileId:row.parent_file_id}):'recover',...(recover?{contentHash:row.content_hash}:{}),...(favorite?{favorite:true}:{}),modified:Date.parse(row.updated_at||row.created_at)||0}))
 const nextCursor=dir.next_marker?JSON.stringify({drive:dir.m_drive_id,marker:dir.next_marker}):drives[index+1]?JSON.stringify({drive:drives[index+1],marker:''}):undefined
 return {entries,nextCursor}
}
