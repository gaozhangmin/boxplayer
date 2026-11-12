import {createGuangyaText} from './guangyaText'
import {createAliText} from './aliText'
import {createBoxText} from './boxText'
import {createDropboxText} from './dropboxText'
import {createOneDriveText} from './oneDriveText'
import type {Account} from '@/features/sources/contracts'
import {request,text,json} from '@/features/sources/transport'
import {checkTextCreation as mutationAccount,withTextCreationScope} from './textCreationScope'
import {buildGoogleMultipartUploadBody} from './electron/providers/googleText'
export const supportsRemoteTextCreation=(account:Account)=>['google','onedrive','dropbox','box','aliyun','guangya'].includes(account.providerId)
export async function createRemoteText(account:Account,parent:string,name:string,content:string,stillCurrent:()=>boolean=()=>true){
 if(!supportsRemoteTextCreation(account))throw Error('此来源新建文本接口尚未接入')
 return withTextCreationScope(account,stillCurrent,()=>createRemoteTextBody(account,parent,name,content))
}
async function createRemoteTextBody(account:Account,parent:string,name:string,content:string){
 mutationAccount(account.id,account.providerId)
 if(typeof name!=='string'||!name.trim()||name.length>100||/[\u0000-\u001f/\\]/.test(name)||['.','..'].includes(name)||typeof content!=='string')throw Error('文本文件参数无效')
 if(account.providerId==='guangya')return createGuangyaText(account,parent,name,content)
 if(account.providerId==='aliyun')return createAliText(account,parent,name,content)
 if(account.providerId==='box')return createBoxText(account,parent,name,content)
 if(account.providerId==='dropbox')return createDropboxText(account,parent,name,content)
 if(account.providerId==='onedrive')return createOneDriveText(account,parent,name,content)
 const bytes=new TextEncoder().encode(content)
 parent=['','root','backup_root','google_root'].includes(parent)?'root':parent
 if(parent.length>4096||/[\u0000-\u001f/\\]/.test(parent))throw Error('Google Drive 父目录标识无效')
 const target=await json<{id:string;mimeType:string;trashed?:boolean}>(account,'GET',`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(parent)}?fields=id,mimeType,trashed&supportsAllDrives=true`)
 mutationAccount(account.id,'google')
 if(typeof target?.id!=='string'||!target.id||target.id.length>4096||/[\u0000-\u001f/\\]/.test(target.id)||target.mimeType!=='application/vnd.google-apps.folder'||target.trashed||parent!=='root'&&target.id!==parent)throw Error('Google Drive 目标不是已确认的文件夹')
 const boundary=`boxplayer_${crypto.randomUUID().replace(/-/g,'')}`
 const body=await buildGoogleMultipartUploadBody(target.id,name,'application/octet-stream',bytes,boundary).text()
 mutationAccount(account.id,'google')
 const response=await request(account,'POST','https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id',body,{'Content-Type':`multipart/related; boundary=${boundary}`})
 const result=JSON.parse(text(response))
 if(response.status<200||response.status>=300||result?.error||typeof result?.id!=='string'||!result.id||result.id.length>4096||/[\u0000-\u001f/\\]/.test(result.id))throw Error('Google Drive 未确认文本创建，请刷新目标确认')
 mutationAccount(account.id,'google')
 const detail=await json<{id:string;name:string;parents:string[];size:string;trashed?:boolean;mimeType:string}>(account,'GET',`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(result.id)}?fields=id,name,parents,size,trashed,mimeType&supportsAllDrives=true`)
 mutationAccount(account.id,'google')
 if(!detail||detail.id!==result.id||detail.name!==name||!Array.isArray(detail.parents)||!detail.parents.includes(target.id)||detail.trashed||detail.mimeType==='application/vnd.google-apps.folder'||typeof detail.size!=='string'||!/^\d+$/.test(detail.size)||Number(detail.size)!==bytes.length)throw Error('Google Drive 已创建文本的名称、目录或长度未确认，请刷新目标确认')
 return 'success'
}
