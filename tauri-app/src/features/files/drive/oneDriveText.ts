import type {Account} from '@/features/sources/contracts'
import {request,text,json} from '@/features/sources/transport'
import {checkTextCreation as mutationAccount} from './textCreationScope'
import {buildOneDriveSmallUploadPath} from './electron/providers/onedriveText'
const origin='https://graph.microsoft.com/v1.0'
function id(value:unknown):value is string{return typeof value==='string'&&!!value&&value.length<=4096&&!/[\u0000-\u001f/\\]/.test(value)}
export async function createOneDriveText(account:Account,parent:string,name:string,content:string){
 mutationAccount(account.id,'onedrive')
 const size=new TextEncoder().encode(content).length
 if(size>250*1024*1024)throw Error('OneDrive 新建文本文件超过 250MB 限制')
 parent=['','root','backup_root','onedrive_root'].includes(parent)?'':parent
 if(parent&&!id(parent))throw Error('OneDrive 父目录标识无效')
 const target=await json<{id:string;folder?:unknown;deleted?:unknown}>(account,'GET',origin+(parent?`/me/drive/items/${encodeURIComponent(parent)}`:'/me/drive/root')+'?$select=id,folder,deleted')
 mutationAccount(account.id,'onedrive')
 if(!target||!id(target.id)||!target.folder||target.deleted||parent&&target.id!==parent)throw Error('OneDrive 目标不是已确认的文件夹')
 const response=await request(account,'PUT',origin+buildOneDriveSmallUploadPath(target.id,name),content,{'Content-Type':'application/octet-stream'})
 const result=JSON.parse(text(response))
 mutationAccount(account.id,'onedrive')
 if(response.status<200||response.status>=300||result?.error||!id(result?.id))throw Error('OneDrive 未确认文本创建，请刷新目标确认')
 const detail=await json<{id:string;name:string;parentReference?:{id?:string};size:number;file?:unknown;folder?:unknown;deleted?:unknown}>(account,'GET',origin+`/me/drive/items/${encodeURIComponent(result.id)}?$select=id,name,parentReference,size,file,folder,deleted`)
 mutationAccount(account.id,'onedrive')
 if(!detail||detail.id!==result.id||detail.name!==name||detail.parentReference?.id!==target.id||!detail.file||detail.folder||detail.deleted||!Number.isSafeInteger(detail.size)||detail.size!==size)throw Error('OneDrive 已创建文本的名称、目录或长度未确认，请刷新目标确认')
 return 'success'
}
