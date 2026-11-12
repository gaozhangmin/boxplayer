import type {Account} from '@/features/sources/contracts'
import {getDrivePane} from './ports'
import {updateOpenFavorite} from './aliOpenFavorites'
import {ApiFavorBatch} from './electron/providers/aliFileCmd'
export async function favorAliFile(account:Account,id:string,starred:boolean,showMessage:boolean){
 const pane=getDrivePane(),epoch=pane.context,file=pane.file?.(id)
 if(!['aliyun','alipan-open'].includes(account.providerId)||pane.sourceId!==account.id||!file)throw Error('收藏文件来源不匹配')
 let location:any;try{location=JSON.parse(id)}catch{throw Error('收藏文件位置无效')}
 if(typeof location?.driveId!=='string'||!location.driveId||typeof location?.fileId!=='string'||!location.fileId||location.fileId==='root')throw Error('不能收藏虚拟根或网盘根目录')
 if(account.providerId==='alipan-open'){await updateOpenFavorite(account,location.driveId,location.fileId,starred);return id}
 const result=await ApiFavorBatch(account.id,location.driveId,starred,showMessage,[location.fileId])
 if(getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id)throw Error('收藏来源已切换')
 if(!result.includes(location.fileId))throw Error('提供商未确认收藏更新')
 return id
}
