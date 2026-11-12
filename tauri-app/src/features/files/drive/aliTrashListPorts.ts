import {request,text} from '@/features/sources/transport'
import {aliFolderAccount} from './aliFolderTransport'
import {getDrivePane} from './ports'
import {ItemJsonmask} from './electron/providers/aliTrashList'
export interface IAliFileResp {m_user_id:string;m_drive_id:string;next_marker:string;items:Record<string,any>[];recover?:boolean;favorite?:boolean}
export const AliTrashHttp={async Post(path:string,body:unknown,user:string,_share:string){
 const account=aliFolderAccount(user),pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account)
 const check=()=>{if(getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==user||JSON.stringify(aliFolderAccount(user))!==owner)throw Error('阿里列表来源已切换或账号已变化')}
 check()
 if(!path.startsWith('v2/recyclebin/list?jsonmask=')&&path!=='adrive/v1/file/listDeleted'&&!path.startsWith('v2/file/list_by_custom_index_key?jsonmask='))throw Error('阿里回收站列表路径无效')
 let url='https://api.aliyundrive.com/'+path,input=body
 if(account.providerId==='alipan-open'){
  if(!path.startsWith('v2/file/list_by_custom_index_key?jsonmask='))throw Error('阿里开放账号仅接入收藏列表')
  const value=body as Record<string,unknown>
  if(value.custom_index_key!=='starred_yes'||value.parent_file_id!=='root')throw Error('阿里收藏列表参数无效')
  url='https://openapi.alipan.com/adrive/v1.0/openFile/starredList'
  input={drive_id:value.drive_id,marker:value.marker,limit:value.limit,order_by:value.order_by,order_direction:value.order_direction}
 }
 const response=await request(account,'POST',url,JSON.stringify(input),{'Content-Type':'application/json'});check()
 return {code:response.status,body:JSON.parse(text(response))}
}}
export const AliDirFileList={get ItemJsonmask(){return ItemJsonmask},_FileListOnePage(_order:string,_direction:string,dir:IAliFileResp,response:{code:number;body:any},_index:number){
 const data=response.body
 if(response.code!==200||data?.code||!Array.isArray(data?.items)||data.next_marker!==undefined&&typeof data.next_marker!=='string')throw Error('阿里回收站列表回执无效')
 const ids=new Set<string>()
 for(const row of data.items){if(typeof row?.file_id!=='string'||!row.file_id||ids.has(row.file_id)||row.drive_id!==dir.m_drive_id||typeof row.name!=='string'||!row.name||(!dir.recover&&(typeof row.parent_file_id!=='string'||!row.parent_file_id))||!['file','folder'].includes(row.type))throw Error('阿里回收站项目身份无效');if(dir.recover&&(typeof row.content_hash!=='string'||!row.content_hash))throw Error('恢复文件缺少内容哈希');if(dir.favorite&&row.starred!==true)throw Error('收藏夹返回非收藏项目');ids.add(row.file_id)}
 if(data.next_marker&&data.next_marker===dir.next_marker)throw Error('阿里回收站分页游标重复')
 dir.items=data.items;dir.next_marker=data.next_marker||'';return true
}}
