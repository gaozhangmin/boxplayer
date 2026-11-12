import {getDrivePane} from './ports'
import type {FolderPreviewParams} from './folderPreview'
const hosts=new WeakMap<object,number>()
let sequence=0
export function previewScopeKey(params:FolderPreviewParams){
 const pane=getDrivePane()
 if(params.user_id!==pane.sourceId||params.drive_id!==pane.sourceId)throw Error('文件夹预览来源不匹配')
 if(!hosts.has(pane))hosts.set(pane,++sequence)
 return JSON.stringify([hosts.get(pane),pane.context,pane.account||null,params.file_id])
}
