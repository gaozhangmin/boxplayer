import {dropboxRpc,mutationAccount} from './providerTransport'
import {getDrivePane} from './ports'
let identities:{pane:ReturnType<typeof getDrivePane>;context:unknown;items:Map<string,{id:string;tag:string}>}|undefined
export function dropboxPathIdentity(path:string){const pane=getDrivePane();return identities?.pane===pane&&identities.context===pane.context?identities.items.get(path.toLowerCase()):undefined}
export async function resolveDropboxRenamePath(user:string,id:string,expectedDirectory=false){
 const pane=getDrivePane(),context=pane.context
 if(pane.sourceId!==user||!pane.file?.(id))throw Error('Dropbox 文件已不在当前来源记录中')
 mutationAccount(user,'dropbox')
 if(!id||['root','backup_root','dropbox_root'].includes(id))throw Error('不能重命名 Dropbox 根目录')
 const response=await dropboxRpc<{id?:string;'.tag'?:string;path_display?:string;path_lower?:string}>(user,'/files/get_metadata',{path:id},'读取 Dropbox 文件位置')
 if(getDrivePane()!==pane||pane.context!==context||pane.sourceId!==user)throw Error('文件浏览器已切换')
 if(response.error)throw Error(response.error)
 const row=response.data,path=row?.path_display||row?.path_lower
 if(!row||!['file','folder'].includes(row['.tag']||'')||id.startsWith('id:')&&row.id!==id||!path?.startsWith('/'))throw Error('Dropbox 文件位置或标识不匹配')
 if(id.startsWith('/')&&path.toLowerCase()!==id.toLowerCase())throw Error('Dropbox 文件路径不匹配')
 if(expectedDirectory&&row['.tag']!=='folder')throw Error('Dropbox 目标不是文件夹')
 if(typeof row.id!=='string'||!row.id)throw Error('Dropbox 文件缺少持久标识')
 if(!identities||identities.pane!==pane||identities.context!==context)identities={pane,context,items:new Map()}
 identities.items.set(path.toLowerCase(),{id:row.id,tag:row['.tag']!})
 return path
}
