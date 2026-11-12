import {parseBaiduJson} from './baiduJson'
import type {Account} from '@/features/sources/contracts'
import {rawRequest,text} from '@/features/sources/transport'
import {baiduDirectoryPath} from './baiduFolderTransport'
import {BaiduRenameRejected} from './baiduRenameTransport'
interface Scope{account:Account;operation:'copy'|'delete';path:string;target?:string;check:()=>void;onSubmit:()=>void;onReceipt:(taskId?:string)=>void}
const scopes=new Map<string,Scope>()
export async function withBaiduBatchScope<T>(scope:Scope,run:(user:string)=>Promise<T>){
 scope.check();if(scopes.size>=128)throw Error('百度文件操作会话过多')
 const key=`baidu-batch:${crypto.randomUUID()}`;scopes.set(key,scope)
 try{return await run(key)}finally{scopes.delete(key)}
}
export async function baiduBatchFetch(user:string,rawUrl:string,init:RequestInit){
 const scope=scopes.get(user);if(!scope)throw Error('百度文件操作会话已关闭');scope.check()
 const url=new URL(rawUrl),query=url.searchParams,copy=scope.operation==='copy'
 if(url.origin!=='https://pan.baidu.com'||url.pathname!=='/rest/2.0/xpan/file'||url.username||url.password||url.hash||query.size!==2||query.get('method')!=='filemanager'||query.get('opera')!==scope.operation||init.method!=='POST'||!(init.body instanceof URLSearchParams)||Object.keys(init).some(key=>!['method','body','headers'].includes(key)))throw new BaiduRenameRejected('百度文件管理请求未适配')
 const headers=Object.fromEntries(Object.entries(init.headers||{}).map(([key,value])=>[key.toLowerCase(),value]))
 if(Object.keys(headers).length!==2||headers['user-agent']!=='pan.baidu.com'||headers['content-type']!=='application/x-www-form-urlencoded')throw new BaiduRenameRejected('百度文件管理请求头无效')
 baiduDirectoryPath(scope.path);if(scope.path==='/')throw new BaiduRenameRejected('不能修改百度根目录')
 const form=init.body,expected=copy?[{path:scope.path,dest:scope.target}]:[scope.path]
 if(copy&&(!scope.target||scope.target!==baiduDirectoryPath(scope.target)))throw new BaiduRenameRejected('百度复制目标无效')
 if(form.size!==(copy?3:2)||form.get('async')!==(copy?'1':'2')||copy&&form.get('ondup')!=='fail'||!copy&&form.has('ondup')||form.get('filelist')!==JSON.stringify(expected))throw new BaiduRenameRejected('百度文件管理表单或路径不匹配')
 scope.check();scope.onSubmit()
 const response=await rawRequest(scope.account,'POST',url.href,form.toString(),headers)
 if(response.status>=400&&response.status<500&&response.status!==408)throw new BaiduRenameRejected(`百度拒绝文件操作（HTTP ${response.status}）`)
 if(response.status<200||response.status>=300)throw Error('百度文件操作结果不确定')
 const data=parseBaiduJson(text(response))
 if(!data||typeof data!=='object'||Array.isArray(data)||!Number.isSafeInteger(data.errno))throw Error('百度文件管理回执无效')
 if(data.errno!==0)throw new BaiduRenameRejected(`百度拒绝文件操作（errno ${data.errno}）`)
 let taskId:string|undefined
 if(data.taskid){
  if(typeof data.taskid==='number'&&!Number.isSafeInteger(data.taskid)||!['number','string'].includes(typeof data.taskid)||!/^[1-9]\d*$/.test(String(data.taskid)))throw Error('百度任务标识无效或超出安全范围')
  taskId=String(data.taskid)
 }
 let matched=false
 if(data.info!==undefined){
  if(!Array.isArray(data.info)||data.info.length>1)throw Error('百度逐项回执身份不确定')
  const after=copy?(scope.target==='/'?'':scope.target)+scope.path.slice(scope.path.lastIndexOf('/')):scope.path
  for(const row of data.info){
   if(!row||!Number.isSafeInteger(row.errno))throw Error('百度逐项回执无效')
   if(row.errno!==0)throw new BaiduRenameRejected(`百度拒绝单项文件操作（errno ${row.errno}）`)
   if(row.path!==scope.path&&row.path!==after)throw Error('百度逐项回执路径不匹配')
   matched=true
  }
 }
 if(taskId||matched)scope.onReceipt(taskId)
 scope.check();return {ok:true,json:async()=>data}
}
