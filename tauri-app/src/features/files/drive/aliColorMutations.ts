import type {Account} from '@/features/sources/contracts'
import {getDrivePane} from './ports'
import {ApiFileColorBatch} from './electron/providers/aliFileCmd'
export async function colorAliFile(account:Account,id:string,color:string){
 const pane=getDrivePane(),epoch=pane.context,file=pane.file?.(id)
 if(account.providerId!=='aliyun'||pane.sourceId!==account.id||!file||!/^$|^c[0-9a-f]{6}$/.test(color))throw Error('颜色标记来源或选项无效')
 let location:any;try{location=JSON.parse(id)}catch{throw Error('颜色标记文件位置无效')}
 if(typeof location?.driveId!=='string'||!location.driveId||typeof location?.fileId!=='string'||!location.fileId||location.fileId==='root')throw Error('不能标记网盘根目录')
 await ApiFileColorBatch(account.id,location.driveId,file.description||'',color,[location.fileId])
 if(getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id)throw Error('颜色标记来源已切换')
 return file.description
}
