import type {Account} from '@/features/sources/contracts'
import {rawRequest,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
import {CLOUD189_API_URL,CLOUD189_WEB_URL,CLOUD189_USER_AGENT} from './electron/providers/cloud189Constants'
import {forgetCloud189Files,preserveCloud189LargeIds} from './electron/providers/cloud189Identity'
interface Scope{account:Account;parent:string;family:string;check:()=>void}
const scopes=new Map<string,Scope>()
export function cloud189FolderId(value:unknown):string{
 if(typeof value==='number'&&!Number.isSafeInteger(value)||typeof value!=='string'&&typeof value!=='number')throw Error('天翼文件夹标识超出安全范围')
 const id=String(value)
 if(!id||id.startsWith('cloud189_family:')||['0','/','root','cloud189_root'].includes(id)||/^-\d+$/.test(id)||/[\u0000-\u0020/\\]/.test(id)||id.length>4096)throw Error('天翼文件夹标识无效')
 return id
}
export async function withCloud189FolderScope<T>(scope:Scope,read:(key:string)=>Promise<T>){
 scope.check();mutationAccount(scope.account.id,'189')
 if(scopes.size>=128)throw Error('天翼新建请求过多')
 const key=`cloud189-create:${crypto.randomUUID()}`;scopes.set(key,scope)
 try{return await read(key)}finally{forgetCloud189Files(key);scopes.delete(key)}
}
export async function cloud189PostRequest(key:string,action:string,params:Record<string,string>,family=false):Promise<any>{
 const scope=scopes.get(key);if(!scope)throw Error('天翼新建会话已关闭')
 scope.check();const {account,parent}=scope,keys=Object.keys(params)
 if(family!==!!scope.family||action!==(family?'family/file/':'')+'createFolder.action'||keys.length!==(family?4:3)||keys.some(name=>!(family?['folderName','relativePath','familyId','parentId']:['folderName','relativePath','parentFolderId']).includes(name))||params.relativePath!==''||typeof params.folderName!=='string'||!params.folderName.trim()||['.','..'].includes(params.folderName)||/[\u0000-\u001f/\\]/.test(params.folderName)||params[family?'parentId':'parentFolderId']!==parent||family&&params.familyId!==scope.family)throw Error('天翼新建参数或空间不匹配')
 const url=CLOUD189_API_URL+'/'+action+'?'+new URLSearchParams(params)
 const response=await rawRequest(account,'POST',url,undefined,{Accept:'application/json;charset=UTF-8','User-Agent':CLOUD189_USER_AGENT,Referer:CLOUD189_WEB_URL})
 scope.check()
 if(response.status<200||response.status>=300)throw Error(`天翼新建请求未成功（HTTP ${response.status}）`)
 const data=JSON.parse(preserveCloud189LargeIds(text(response)))
 if(!data||typeof data!=='object'||Array.isArray(data)||data.errorCode||data.success===false||Number(data.res_code||0)!==0||data.code&&data.code!=='SUCCESS')throw Error('天翼云盘新建请求失败')
 const body=data.data||data,id=body.folderId||body.id||body.folder?.id
 cloud189FolderId(id)
 if(body.familyId!==undefined&&String(body.familyId)!==scope.family)throw Error('天翼返回了其他家庭空间的目录')
 return data
}
