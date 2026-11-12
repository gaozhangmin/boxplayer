import type {Account} from '@/features/sources/contracts'
import {json} from '@/features/sources/transport'
import {checkTextCreation as mutationAccount} from './textCreationScope'
import {buildDropboxCommitInfo,uploadBufferWithRetry} from './electron/providers/dropboxText'
import {buildDropboxChildPath} from './electron/providers/dropbox'
function path(value:unknown):value is string{return typeof value==='string'&&value.startsWith('/')&&!/[\u0000-\u001f\\]/.test(value)&&!value.split('/').some(part=>part==='.'||part==='..')}
export async function createDropboxText(account:Account,parent:string,name:string,content:string){
 mutationAccount(account.id,'dropbox')
 const size=new TextEncoder().encode(content).length
 if(size>150*1024*1024)throw Error('Dropbox 新建文本超过150MB限制')
 parent=['','root','backup_root','dropbox_root'].includes(parent)?'':parent
 if(parent){
  const metadata=await json<{id:string;'.tag':string;path_display?:string;path_lower?:string}>(account,'POST','https://api.dropboxapi.com/2/files/get_metadata',{path:parent})
  mutationAccount(account.id,'dropbox')
  if(!metadata||metadata['.tag']!=='folder'||parent.startsWith('id:')&&metadata.id!==parent)throw Error('Dropbox 目标不是已确认的文件夹')
  const resolved=metadata.path_display||metadata.path_lower
  if(!path(resolved))throw Error('Dropbox 目标路径无效')
  parent=resolved
 }
 const destination=buildDropboxChildPath(parent||'dropbox_root',name),commit=buildDropboxCommitInfo(destination,'refuse')
 const response=await uploadBufferWithRetry<{id?:string}>(account.id,'/files/upload',commit,new TextEncoder().encode(content),'创建 Dropbox 文件失败')
 mutationAccount(account.id,'dropbox')
 const result=response.data
 if(response.error||typeof result?.id!=='string'||!result.id.startsWith('id:'))throw Error('Dropbox 未确认文本创建，请刷新目标确认：'+response.error)
 const detail=await json<{id:string;'.tag':string;name:string;path_display?:string;path_lower?:string;size:number}>(account,'POST','https://api.dropboxapi.com/2/files/get_metadata',{path:result.id})
 mutationAccount(account.id,'dropbox')
 const actual=detail?.path_display||detail?.path_lower
 if(!detail||detail.id!==result.id||detail['.tag']!=='file'||detail.name!==name||!path(actual)||actual.toLowerCase()!==destination.toLowerCase()||!Number.isSafeInteger(detail.size)||detail.size!==size)throw Error('Dropbox 已创建文本的名称、目录或长度未确认，请刷新目标确认')
 return 'success'
}
