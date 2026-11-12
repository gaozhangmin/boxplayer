import type {Account} from '@/features/sources/contracts'
import {alipan} from '@/features/sources/alipan'
import {playable} from '@/features/sources/transport'
import {getDrivePane} from './ports'
import {ApiSearchFileListOnePage} from './electron/providers/aliSearch'
import {withSearchScope,type IAliFileResp} from './aliSearchPorts'
export async function aliColorPage(account:Account,path:string,cursor?:string){
 if(!/^color#[0-9a-f]{6}$/i.test(path))throw Error('颜色筛选范围无效')
 return aliSearchPage(account,path,cursor)
}
export async function aliSearchPage(account:Account,path:string,cursor?:string){
 if(account.providerId!=='aliyun'||!(/^color#[0-9a-f]{6}$/i.test(path)||path.startsWith('search')&&path.length>6))throw Error('颜色筛选范围无效')
 const pane=getDrivePane(),epoch=pane.context,check=()=>{if(getDrivePane()!==pane||pane.sourceId!==account.id||pane.context!==epoch)throw Error('颜色筛选来源已切换')};check()
 const roots=await alipan.list(account,'');check();const drives:Record<string,string>={}
 for(const root of roots.entries){const position=JSON.parse(root.id);if(typeof position.driveId!=='string'||!position.driveId||position.fileId!=='root')throw Error('网盘根信息无效');if(root.name==='备份盘')drives.backup=position.driveId;else if(root.name==='资源盘')drives.resource=position.driveId;else drives.resource ||=position.driveId}
 if(!drives.backup&&!drives.resource)throw Error('颜色筛选缺少实际盘范围')
 const ranges=path.startsWith('search')?path.slice(6).split(' ').filter(token=>token.startsWith('range:')):[]
 if(path.startsWith('search')){if(ranges.length!==1)throw Error('搜索范围不能为空或重复');const aliases=ranges[0]!.slice(6).split(',');if(aliases.some(alias=>!drives[alias]))throw Error('搜索范围不可用');for(const alias of Object.keys(drives))if(!aliases.includes(alias))delete drives[alias]}
 let marker='';if(cursor){let value:any;try{value=JSON.parse(cursor)}catch{throw Error('颜色筛选游标无效')};if(value.scope!==path||typeof value.marker!=='string')throw Error('颜色筛选游标范围不匹配');marker=value.marker}
 const dir:IAliFileResp={m_user_id:account.id,m_drive_id:drives.resource||drives.backup!,dirID:path.startsWith('color')?path.toLowerCase():path,next_marker:marker,items:[],drives}
 await withSearchScope(dir,()=>ApiSearchFileListOnePage('updated_at','DESC',dir,0));check()
 return {entries:dir.items.map(row=>({id:JSON.stringify({driveId:row.drive_id,fileId:row.file_id}),name:row.name,isDirectory:row.type==='folder',size:Number(row.size)||0,playable:row.type==='file'&&playable(row.name),originalParent:JSON.stringify({driveId:row.drive_id,fileId:row.parent_file_id}),description:row.description||'',favorite:row.starred===true,modified:Date.parse(row.updated_at||row.created_at)||0})),nextCursor:dir.next_marker?JSON.stringify({scope:path,marker:dir.next_marker}):undefined}
}
