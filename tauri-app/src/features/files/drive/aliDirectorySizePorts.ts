import type {Account} from '@/features/sources/contracts'
import {request,text} from '@/features/sources/transport'
import {getDrivePane} from './ports'
import {aliFolderAccount} from './aliFolderTransport'
import {ApiDirFileSize} from './electron/providers/aliDirectorySize'

interface SizeRead {account:Account;drive:string;file:string;check():void;truncated:boolean;confirmed:boolean}
const reads=new Map<string,SizeRead>()

/** Original direct-file estimate, not a recursive/complete folder byte count. */
export async function readAliDirectFolderSize(account:Account,drive:string,file:string,stillCurrent:()=>void){
 const pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account)
 const check=()=>{stillCurrent();if(account.providerId!=='aliyun'||pane!==getDrivePane()||pane.context!==epoch||pane.sourceId!==account.id||JSON.stringify(aliFolderAccount(account.id))!==owner)throw Error('文件夹大小统计来源已切换')}
 check()
 if(!drive||!file||/[\u0000-\u001f"\\]/.test(file)||file!=='root'&&file.includes('root'))throw Error('文件夹大小统计标识无效')
 if(reads.has(account.id))throw Error('文件夹大小统计正在进行')
 const scope:SizeRead={account,drive,file,check,truncated:false,confirmed:false};reads.set(account.id,scope)
 try{
  const result=await ApiDirFileSize(account.id,drive,[file]);check()
  if(!scope.confirmed||!result||result.length!==1||result[0]?.dirID!==file||!Number.isSafeInteger(result[0].size)||result[0].size<0)throw Error('文件夹大小统计未返回有效结果')
  return {size:result[0].size,truncated:scope.truncated}
 }finally{if(reads.get(account.id)===scope)reads.delete(account.id)}
}

export const AliDirectorySizeHttp={
 IsSuccess:(status:number)=>status===200,
 async Post(path:string,body:Record<string,unknown>,user:string,share:string){
  const scope=reads.get(user);if(!scope)throw Error('文件夹大小统计缺少来源作用域')
  scope.check()
  if(share||path!=='adrive/v3/file/search?jsonmask=next_marker%2Citems(size)'||body.drive_id!==scope.drive||body.limit!==100||body.query!==`parent_file_id="${scope.file}" and type="file"`||body.fields!=='thumbnail'||body.order_by!=='size DESC'||Object.keys(body).length!==5)throw Error('文件夹大小统计请求无效')
  const response=await request(scope.account,'POST','https://api.aliyundrive.com/'+path,JSON.stringify(body),{'Content-Type':'application/json'});scope.check()
  const data=JSON.parse(text(response))
  if(response.status!==200||!data||data.code||!Array.isArray(data.items)||data.items.length>100||data.next_marker!==undefined&&typeof data.next_marker!=='string')throw Error('文件夹大小统计响应无效')
  let sum=0
  for(const row of data.items){if(!row||!Number.isSafeInteger(row.size)||row.size<0||!Number.isSafeInteger(sum+=row.size))throw Error('文件夹大小统计字节数无效')}
  scope.truncated=!!data.next_marker
  scope.confirmed=true
  return {code:response.status,body:data}
 }
}
