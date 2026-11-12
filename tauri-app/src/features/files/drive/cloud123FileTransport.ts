import {mutationAccount} from './providerTransport'
import {request,text} from '@/features/sources/transport'
import {cloud123BatchScope} from './cloud123BatchScope'
import {cloud123RenameScope} from './cloud123RenameScope'
export function cloud123FileCheck(user:string){mutationAccount(user,'123')}
export function cloud123Id(id:string,root=false){
 if(!/^(0|[1-9]\d*)$/.test(id)||!Number.isSafeInteger(Number(id))||!root&&id==='0')throw Error('123 文件标识无效或超出安全整数范围')
 return id
}
export async function cloud123FileRequest(user:string,url:string,options:{method:string;headers:Record<string,string>;body?:string}){
 const account=mutationAccount(user,'123'),value=options.body?JSON.parse(options.body):{}
 const renameScope=cloud123RenameScope(user)
 renameScope?.check()
 const clearUrl=new URL(url)
 if(clearUrl.origin==='https://www.123pan.com'){
  if(clearUrl.pathname!=='/api/v1/file/trash_delete_all'||options.method!=='POST'||clearUrl.username||clearUrl.password||clearUrl.hash||[...clearUrl.searchParams.keys()].join()!=='t'||!/^\d+$/.test(clearUrl.searchParams.get('t')||'')||value.event!=='recycleClear'||value.RequestSource!==null||Object.keys(value).length!==2)throw Error('123 清空回收站请求无效')
  const response=await request(account,'POST',url,options.body,{'Content-Type':'application/json'})
  if(response.status!==200)throw Error('123 未确认清空回收站')
  const data=JSON.parse(text(response));if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.code!=='number')throw Error('123 清空回收站响应无效')
  return {ok:true,json:async()=>data}
 }
 const paths:Record<string,string>={'/upload/v1/file/mkdir':'POST','/api/v1/file/name':'PUT','/api/v1/file/rename':'POST','/api/v1/file/move':'POST','/api/v1/file/trash':'POST','/api/v1/file/recover':'POST','/api/v1/file/detail':'GET','/api/v1/file/copy':'POST','/api/v1/file/async/copy':'POST'},endpoint=new URL(url)
 if(endpoint.origin!=='https://open-api.123pan.com'||paths[endpoint.pathname]!==options.method||(options.method!=='GET'&&endpoint.search))throw Error('123 文件请求路径无效')
 if(options.method==='GET'){cloud123Id(endpoint.searchParams.get('fileID')||'');if([...endpoint.searchParams.keys()].some(key=>key!=='fileID'))throw Error('123 文件详情参数无效')}
 if(endpoint.pathname==='/api/v1/file/rename'){
  if(!renameScope||Object.keys(value).join()!=='renameList'||!Array.isArray(value.renameList)||!value.renameList.length||JSON.stringify(value.renameList)!==JSON.stringify(renameScope.renameList))throw Error('123 批量重命名请求不匹配')
 }
 const ids=value.fileIDs??value.fileIds??(value.fileId!==undefined?[value.fileId]:[])
 if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error('123 文件操作标识无效')
 if(endpoint.pathname==='/api/v1/file/async/copy'&&(ids.length<2||Object.keys(value).some(key=>!['fileIds','targetDirId'].includes(key))||!('targetDirId'in value)))throw Error('123 批量复制参数无效')
 for(const key of ['parentID','toParentFileID','targetDirId'])if(key in value)cloud123Id(String(value[key]),true)
 if('fileName'in value&&(!value.fileName||typeof value.fileName!=='string'))throw Error('123 文件名无效')
 const scope=endpoint.pathname==='/api/v1/file/async/copy'?cloud123BatchScope(user,value):undefined
 scope?.check()
 if(scope)scope.sent=true
 const response=await request(account,options.method,url,options.body,{'Content-Type':'application/json',Platform:'open_platform'})
 renameScope?.check()
 if(scope&&[400,401,403,404,422,429].includes(response.status))scope.rejected=true
 if(response.status!==200)throw Error('123 文件操作尚未确认完成')
 const data=JSON.parse(text(response));if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.code!=='number')throw Error('123 文件操作响应无效')
 if(scope&&data.code!==0)scope.rejected=true
 if(endpoint.pathname.endsWith('/recover')&&data.code===0){const abnormal=data.data?.abnormalFileIDs;if(!Array.isArray(abnormal)||abnormal.some(id=>!Number.isSafeInteger(Number(id))||!ids.includes(Number(id)))||new Set(abnormal.map(Number)).size!==abnormal.length)throw Error('123 还原回执异常文件集合无效')}
 return {ok:true,json:async()=>data}
}
export async function cloud123ListRequest(user:string,url:string){
 const account=mutationAccount(user,'123'),endpoint=new URL(url)
 if(endpoint.origin!=='https://open-api.123pan.com'||endpoint.pathname!=='/api/v2/file/list'||endpoint.searchParams.get('trashed')!=='1')throw Error('123 回收站列表路径无效')
 const response=await request(account,'GET',url,undefined,{'Content-Type':'application/json',Platform:'open_platform'})
 if(response.status!==200)throw Error('123 回收站列表未完成')
 const data=JSON.parse(text(response))
 if(data?.code!==0||!Array.isArray(data.data?.fileList)||!Number.isSafeInteger(data.data.lastFileId))throw Error('123 回收站列表回执无效')
 const seen=new Set<string>()
 for(const row of data.data.fileList){cloud123Id(String(row.fileId));cloud123Id(String(row.parentFileId),true);if(seen.has(String(row.fileId))||![0,1].includes(row.type)||row.trashed!==1||typeof row.filename!=='string'||!row.filename)throw Error('123 回收站项目身份或状态无效');seen.add(String(row.fileId))}
 return {response:{ok:true},data}
}
