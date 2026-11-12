import {aliVideoArtwork} from './privateArtwork'
import type {Account} from '@/features/sources/contracts'
import {_ApiVideoListRecent,_ApiVideoListOnePage,_ApiVideoFileListOnePage,NewIAliFileResp} from './electron/providers/aliVideoList'
import {mutationAccount} from './providerTransport'
import {getDrivePane} from './ports'
export async function aliVideoPage(account:Account,view:string,cursor?:string){
 if(account.providerId!=='aliyun'||!view.startsWith('video'))throw Error('阿里视频视图来源不匹配')
 const pane=getDrivePane(),epoch=pane.context,check=()=>{mutationAccount(account.id,'aliyun');if(getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id)throw Error('阿里视频来源已切换')};check()
 const recent=['video','video.recentplay'].includes(view)
 if(!recent&&view!=='video.compilation'&&!/^video[^\u0000-\u001f/\\]+_[^\u0000-\u001f/\\]+$/.test(view))throw Error('阿里专辑视图无效')
 let marker='',count=0
 if(cursor){let data:any;try{data=JSON.parse(cursor)}catch{throw Error('阿里视频分页游标无效')};if(recent||data.source!==account.id||data.view!==view||typeof data.marker!=='string'||!data.marker||!Number.isSafeInteger(data.count)||data.count<0||data.count>=500)throw Error('阿里视频分页范围无效');marker=data.marker;count=data.count}
 const dir=NewIAliFileResp(account.id,'',view,view);dir.next_marker=marker
 const success=await (recent?_ApiVideoListRecent:view==='video.compilation'?_ApiVideoListOnePage:_ApiVideoFileListOnePage)('updated_at','DESC',dir,-1);check()
 if(!success||dir.next_marker.startsWith('error ')||dir.next_marker==='cancel'||dir.next_marker&&dir.next_marker===marker)throw Error('阿里视频列表未确认或分页重复')
 if(recent&&dir.next_marker)throw Error('原正在观看接口不支持分页游标')
 const seen=new Set<string>()
 const entries=dir.items.map(original=>{
  if(typeof original.drive_id!=='string'||!original.drive_id||typeof original.file_id!=='string'||!original.file_id||!original.name||!Number.isSafeInteger(original.size)||original.size<0)throw Error('阿里视频模型身份无效')
  const compilation=original.isDir&&original.compilation_id
  const id=compilation?'video'+compilation:JSON.stringify({driveId:original.drive_id,fileId:original.file_id})
  if(seen.has(id))throw Error('阿里视频列表重复身份');seen.add(id)
  const parent=original.parent_file_id?JSON.stringify({driveId:original.drive_id,fileId:original.parent_file_id}):''
  return {id,name:original.name,isDirectory:original.isDir,size:original.size,playable:!original.isDir,originalParent:parent,modified:original.time,electronModel:{...original,thumbnail:aliVideoArtwork(account,original),drive_id:account.id,file_id:id,parent_file_id:parent}}
 })
 count+=entries.length
 return {entries,nextCursor:dir.next_marker&&count<500?JSON.stringify({source:account.id,view,marker:dir.next_marker,count}):undefined}
}
