import {withBaiduFolderScope} from './baiduFolderTransport'
import type {Account} from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
import {baiduDirectoryLocation} from './baiduMetadata'
import {apiBaiduCreateDir,buildBaiduUploadPath} from './electron/providers/baiduFolder'

export async function createBaiduFolder(account:Account,parent:string,name:string,stillCurrent:()=>boolean=()=>true){
 const owner=JSON.stringify([account.userId||'',account.deviceId||'',account.baseUrl])
 const check=()=>{const current=mutationAccount(account.id,'baidu');if(!stillCurrent()||JSON.stringify([current.userId||'',current.deviceId||'',current.baseUrl])!==owner)throw Error('百度创建来源已关闭、切换或账号身份已变化')}
 check();parent=await baiduDirectoryLocation(account,parent);check()
 const path=buildBaiduUploadPath(parent,name);let id=''
 const result=await withBaiduFolderScope({account,path,check,created:value=>{id=value}},user=>apiBaiduCreateDir(user,path,0));check()
 if(result.error||result.path!==path||!id)throw Error(result.error||'百度返回目录路径或标识不匹配')
 return {file_id:id,error:''}
}
