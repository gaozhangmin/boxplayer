import type {Account} from '@/features/sources/contracts'
import {json} from '@/features/sources/transport'
import {checkTextCreation as mutationAccount} from './textCreationScope'
import {apiBoxUploadBuffer,BOX_DIRECT_UPLOAD_LIMIT} from './electron/providers/boxText'
export async function createBoxText(account:Account,parent:string,name:string,content:string){
 mutationAccount(account.id,'box')
 const bytes=new TextEncoder().encode(content)
 if(bytes.length>BOX_DIRECT_UPLOAD_LIMIT)throw Error('Box 新建文件超过 50MB 限制')
 parent=['','root','backup_root','box_root'].includes(parent)?'0':parent
 if(!/^\d{1,128}$/.test(parent))throw Error('Box 父目录标识无效')
 const target=await json<{id:string;type:string}>(account,'GET',`https://api.box.com/2.0/folders/${parent}?fields=id,type`)
 mutationAccount(account.id,'box')
 if(!target||target.id!==parent||target.type!=='folder')throw Error('Box 目标不是已确认的文件夹')
 const result=await apiBoxUploadBuffer(account.id,parent,name,bytes,'refuse')
 mutationAccount(account.id,'box')
 if(result.error||!/^\d{1,128}$/.test(result.file_id))throw Error('Box 未确认文本创建，请刷新目标确认：'+result.error)
 const detail=await json<{id:string;type:string;name:string;parent?:{id:string};size:number;trashed_at?:unknown;item_status?:string}>(account,'GET',`https://api.box.com/2.0/files/${result.file_id}?fields=id,type,name,parent,size,trashed_at,item_status`)
 mutationAccount(account.id,'box')
 if(!detail||detail.id!==result.file_id||detail.type!=='file'||detail.name!==name||detail.parent?.id!==parent||detail.trashed_at||detail.item_status&&detail.item_status!=='active'||!Number.isSafeInteger(detail.size)||detail.size!==bytes.length)throw Error('Box 已创建文本的名称、目录或长度未确认，请刷新目标确认')
 return 'success'
}
