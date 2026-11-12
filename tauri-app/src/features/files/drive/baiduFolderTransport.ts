import type {Account} from '@/features/sources/contracts'
import {parseBaiduJson} from './baiduJson'
import {rawRequest,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'

export function baiduDirectoryPath(value:string){
 if(typeof value!=='string')throw Error('百度目录路径无效')
 if(['','root','backup_root','baidu_root','/'].includes(value))return '/'
 if(!value.startsWith('/')||value.endsWith('/')||value.split('/').slice(1).some(part=>!part||part==='.'||part==='..')||/[\u0000-\u001f\\]/.test(value))throw Error('百度目录路径无效')
 return value
}
interface FolderScope{account:Account;path:string;check:()=>void;created:(id:string)=>void}
const scopes=new Map<string,FolderScope>()
export async function withBaiduFolderScope<T>(scope:FolderScope,run:(user:string)=>Promise<T>){
 scope.check();if(scopes.size>=128)throw Error('百度新建会话过多')
 const key=`baidu-folder:${crypto.randomUUID()}`;scopes.set(key,scope)
 try{return await run(key)}finally{scopes.delete(key)}
}
export async function baiduFolderFetch(user:string,rawUrl:string,init:RequestInit){
 const scope=scopes.get(user),account=scope?.account||mutationAccount(user,'baidu'),url=new URL(rawUrl)
 const owner=JSON.stringify([account.userId||'',account.deviceId||'',account.baseUrl])
 const check=()=>{scope?.check();const current=mutationAccount(account.id,'baidu');if(JSON.stringify([current.userId||'',current.deviceId||'',current.baseUrl])!==owner)throw Error('百度账号身份已变化')}
 check()
 if(url.origin!=='https://pan.baidu.com'||url.pathname!=='/rest/2.0/xpan/file'||url.username||url.password||url.hash||url.searchParams.size!==1||url.searchParams.get('method')!=='create'||init.method!=='POST'||typeof init.body!=='string'||Object.keys(init).some(key=>!['method','body','headers'].includes(key)))throw Error('百度创建目录请求未适配')
 const entries=Object.entries(init.headers||{}),headers=Object.fromEntries(entries.map(([key,value])=>[key.toLowerCase(),value]))
 if(entries.length!==2||headers['content-type']!=='application/x-www-form-urlencoded'||headers['user-agent']!=='pan.baidu.com'||Object.keys(headers).some(key=>!['content-type','user-agent'].includes(key)))throw Error('百度创建目录请求头无效')
 const form=new URLSearchParams(init.body),path=form.get('path')
 if(form.size!==5||[...form.keys()].some(key=>!['path','isdir','rtype','local_ctime','local_mtime'].includes(key))||!path||baiduDirectoryPath(path)==='/'||form.get('isdir')!=='1'||form.get('rtype')!=='0'||!/^\d+$/.test(form.get('local_ctime')||'')||form.get('local_ctime')!==form.get('local_mtime'))throw Error('百度创建目录参数无效')
 if(scope&&path!==scope.path)throw Error('百度新建上下文路径不匹配')
 check();const response=await rawRequest(account,'POST',url.href,init.body,headers)
 const ok=response.status>=200&&response.status<300
 if(!ok){check();return {ok:false,status:response.status,json:async()=>({})}}
 const data=parseBaiduJson(text(response))
 if(!data||typeof data!=='object'||Array.isArray(data)||!Number.isInteger(data.errno))throw Error('百度创建目录响应无效')
 if(data.errno===0){
  if(data.path!==path||data.isdir!==1)throw Error('百度未确认目录路径或类型，请刷新确认')
  if(typeof data.fs_id==='number'&&(!Number.isSafeInteger(data.fs_id)||data.fs_id<=0)||typeof data.fs_id!=='number'&&(typeof data.fs_id!=='string'||!/^[1-9]\d*$/.test(data.fs_id)))throw Error('百度创建目录标识无效或超出数值精度')
  scope?.created(String(data.fs_id))
 }
 check();return {ok:true,status:response.status,json:async()=>data}
}
