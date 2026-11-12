import type {Account,SourceEntry} from '@/features/sources/contracts'
import {playable} from '@/features/sources/transport'
import {getFileInfo} from './electron/providers/aliVideoList'
import type {IAliFileItem,IAliGetFileModel} from './electron/aliapi/alimodels'
import {aliVideoArtwork} from './privateArtwork'

export function aliDirectoryEntry(account:Account,drive:string,parent:string,value:unknown):SourceEntry&{electronModel:IAliGetFileModel}{
 if(!['aliyun','alipan-open'].includes(account.providerId)||!value||typeof value!=='object'||Array.isArray(value))throw Error('阿里目录模型来源无效')
 const row=value as Partial<IAliFileItem>
 if(typeof row.file_id!=='string'||!row.file_id||row.file_id==='root'||typeof row.name!=='string'||!row.name||!['file','folder'].includes(row.type||'')||row.drive_id!==undefined&&row.drive_id!==drive||row.parent_file_id!==undefined&&row.parent_file_id!==parent)throw Error('阿里目录文件身份或父目录不匹配')
 if(row.size!==undefined&&(!Number.isSafeInteger(row.size)||row.size<0))throw Error('阿里目录文件大小无效')
 for(const key of ['created_at','updated_at'] as const)if(row[key]!==undefined&&(typeof row[key]!=='string'||row[key]!==''&&!Number.isFinite(Date.parse(row[key]!))))throw Error('阿里目录日期无效')
 if(row.user_meta){try{JSON.parse(row.user_meta)}catch{throw Error('阿里目录媒体元数据无效')}}
 const ext=row.file_extension??(row.type==='folder'?'':row.name.includes('.')?row.name.split('.').at(-1)||'':'')
 const input={...row,drive_id:drive,parent_file_id:parent,file_extension:ext} as IAliFileItem
 let model=getFileInfo(account.id,input,'',drive)
 // Preserve the original authenticated video snapshot recipe through native cache.
 // Open accounts must never send their token to the web-only snapshot endpoint.
 if(account.providerId==='aliyun'&&!model.isDir&&model.category.startsWith('video')){
  model=getFileInfo(account.id,input,'https://api.aliyundrive.com/v2/file/download?t='+Date.now(),drive)
  model.thumbnail=aliVideoArtwork(account,model)
 }
 const fileId=JSON.stringify({driveId:drive,fileId:row.file_id}),parentId=JSON.stringify({driveId:drive,fileId:parent})
 const native={...model,time:Number.isFinite(model.time)?model.time:0,drive_id:account.id,file_id:fileId,parent_file_id:parentId}
 return {id:fileId,name:model.name,isDirectory:model.isDir,size:model.size,favorite:model.starred,playable:!model.isDir&&playable(model.name),electronModel:native}
}
