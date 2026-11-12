import type {Account} from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
import {baiduFileId} from './baiduListTransport'
import {baiduDirectoryPath} from './baiduFolderTransport'
import {apiBaiduFileMetas} from './electron/providers/baiduMetadata'

export async function baiduFileMetadata(account:Account,id:string){
 if(account.providerId!=='baidu')throw Error('文件操作来源不匹配')
 mutationAccount(account.id,'baidu');baiduFileId(id)
 const rows=await apiBaiduFileMetas(account.id,[id],0)
 mutationAccount(account.id,'baidu')
 const row=rows?.[0]
 if(!row||baiduFileId(row.fs_id)!==id||![0,1].includes(row.isdir!)||typeof row.path!=='string'||baiduDirectoryPath(row.path)==='/'||typeof row.filename!=='string'||row.path.split('/').at(-1)!==row.filename)throw Error('百度文件详情路径、名称或类型无效')
 return row
}
export async function baiduDirectoryLocation(account:Account,id:string){
 if(id.startsWith('/')||['','root','backup_root','baidu_root'].includes(id))return baiduDirectoryPath(id)
 if(!/^[1-9]\d*$/.test(id))throw Error('百度目录路径或标识无效')
 const row=await baiduFileMetadata(account,baiduFileId(id))
 if(row.isdir!==1)throw Error('百度目录标识实际指向文件')
 return row.path!
}
