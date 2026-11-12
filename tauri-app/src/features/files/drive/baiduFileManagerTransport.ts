import {baiduBatchFetch} from './baiduBatchTransport'
import {baiduRenameFetch,BaiduRenameRejected} from './baiduRenameTransport'
import {baiduMoveFetch} from './baiduMoveTransport'
export function baiduFileManagerFetch(user:string,url:string,init:RequestInit){
 const operation=new URL(url).searchParams.get('opera')
 if(operation==='copy'||operation==='delete')return baiduBatchFetch(user,url,init)
 if(operation==='rename')return baiduRenameFetch(user,url,init)
 if(operation==='move')return baiduMoveFetch(user,url,init)
 throw new BaiduRenameRejected('百度文件管理操作尚未适配')
}
