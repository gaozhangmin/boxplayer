import type {Account} from '@/features/sources/contracts'
import {getDrivePane} from './ports'
import {ApiCreatNewForder} from './electron/providers/aliFileCmd'
import {aliFolderAccount} from './aliFolderTransport'
export async function createAliFolder(account:Account,parent:string,name:string,stillCurrent:()=>boolean=()=>true){
 const pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account)
 const check=()=>{if(!stillCurrent()||getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id||!['aliyun','alipan-open'].includes(account.providerId)||JSON.stringify(account)!==owner||JSON.stringify(aliFolderAccount(account.id))!==owner)throw Error('阿里新建文件夹来源已切换或账号已变化')}
 check()
 const directory=pane.file?.(parent)||(pane.tree?.selectDir?.file_id===parent?pane.tree.selectDir:undefined)
 if(!directory?.isDir)throw Error('请选择已读取的资源盘、备份盘或盘内文件夹')
 let target:any;try{target=JSON.parse(parent)}catch{throw Error('请选择实际网盘位置')}
 if(typeof target?.driveId!=='string'||!target.driveId||typeof target?.fileId!=='string'||!target.fileId)throw Error('阿里目标位置无效')
 const result=await ApiCreatNewForder(account.id,target.driveId,target.fileId,name);check()
 if(result.error||!result.file_id)throw Error(result.error||'阿里未返回新文件夹标识')
 return {file_id:JSON.stringify({driveId:target.driveId,fileId:result.file_id}),error:''}
}
