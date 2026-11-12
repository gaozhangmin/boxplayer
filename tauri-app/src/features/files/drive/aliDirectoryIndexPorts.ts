import type {Account} from '@/features/sources/contracts'
import {request,text} from '@/features/sources/transport'
import {getDrivePane} from './ports'
import {aliFolderAccount} from './aliFolderTransport'
import {ApiFastAllDirList} from './electron/providers/aliDirectoryIndex'
interface IndexRead {account:Account;drive:string;check():void;pages:Set<string>;identities:Map<string,string>}
const reads=new Map<string,IndexRead>()
export async function readAliSizeDirectoryIndex(account:Account,drive:string,stillCurrent:()=>void){
 const pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account)
 const check=()=>{stillCurrent();if(account.providerId!=='aliyun'||pane!==getDrivePane()||pane.context!==epoch||pane.sourceId!==account.id||JSON.stringify(aliFolderAccount(account.id))!==owner)throw Error('目录大小索引来源已切换')}
 check();if(!drive||/[\u0000-\u001f"\\]/.test(drive)||reads.has(account.id))throw Error('目录大小索引参数无效或正在读取')
 const scope:IndexRead={account,drive,check,pages:new Set(),identities:new Map()};reads.set(account.id,scope)
 try{const result=await ApiFastAllDirList(account.id,drive);check();if(result.next_marker||!scope.pages.size)throw Error('目录大小索引未完整读取');return result.items}finally{if(reads.get(account.id)===scope)reads.delete(account.id)}
}
export const AliDirectoryIndexHttp={
 IsSuccess:(status:number)=>status===200,
 HttpCodeBreak:(_status:number)=>true,
 async Post(path:string,body:string,user:string,share:string){
  const scope=reads.get(user);if(!scope)throw Error('目录大小索引缺少作用域');scope.check()
  const value=JSON.parse(body),rows=value?.requests
  if(share||path!=='adrive/v4/batch?jsonmask=responses(id%2Cstatus%2Cbody(next_marker%2Citems(name%2Cfile_id%2Cdrive_id%2Cupdated_at%2Csize%2Cdescription%2Cparent_file_id)))'||value.resource!=='file'||!Array.isArray(rows)||rows.length!==2)throw Error('目录大小索引请求无效')
  for(let i=0;i<2;i++){
   const row=rows[i],input=row?.body
   if(row?.id!=='id'+(i+1)||row.url!=='/file/search'||row.method!=='POST'||input?.drive_id!==scope.drive||input.limit!==100||input.fields!=='thumbnail'||input.order_by!==(i===0?'name ASC':'name DESC')||typeof input.query!=='string'||input.query.replaceAll('\\','')!=='type = "folder"'||input.marker!==undefined&&typeof input.marker!=='string')throw Error('目录大小索引查询无效')
  }
  const key=JSON.stringify(rows.map(row=>row.body.marker||''));if(scope.pages.has(key))throw Error('目录大小索引游标重复');scope.pages.add(key)
  const response=await request(scope.account,'POST','https://api.aliyundrive.com/'+path,body,{'Content-Type':'application/json'});scope.check()
  const data=JSON.parse(text(response))
  if(response.status!==200||!data||data.code||!Array.isArray(data.responses)||data.responses.length!==2)throw Error('目录大小索引响应无效')
  const identities=scope.identities
  for(let i=0;i<2;i++){
   const row=data.responses[i],page=row?.body
   if(row?.id!=='id'+(i+1)||row.status!==200||page?.code||!Array.isArray(page?.items)||page.items.length>100||typeof page.next_marker!=='string')throw Error('目录大小索引分页无效')
   const pageIds=new Set<string>()
   for(const item of page.items){
    if(!item||item.drive_id!==scope.drive||typeof item.file_id!=='string'||!item.file_id||item.file_id==='root'||typeof item.parent_file_id!=='string'||!item.parent_file_id||item.parent_file_id===item.file_id||typeof item.name!=='string'||!item.name||item.size!==undefined&&(!Number.isSafeInteger(item.size)||item.size<0))throw Error('目录大小索引身份无效')
    if(pageIds.has(item.file_id))throw Error('目录大小索引单页项目重复');pageIds.add(item.file_id)
    const identity=JSON.stringify([item.parent_file_id,item.name]);if(identities.has(item.file_id)&&identities.get(item.file_id)!==identity)throw Error('目录大小索引身份冲突');identities.set(item.file_id,identity)
   }
  }
  return {code:response.status,body:data}
 }
}
