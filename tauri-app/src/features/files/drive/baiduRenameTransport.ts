import {parseBaiduJson} from './baiduJson'
import {rawRequest,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
import {baiduDirectoryPath} from './baiduFolderTransport'
export class BaiduRenameRejected extends Error {}
export async function baiduRenameFetch(user:string,rawUrl:string,init:RequestInit){
 const account=mutationAccount(user,'baidu'),url=new URL(rawUrl),q=url.searchParams
 if(url.origin!=='https://pan.baidu.com'||url.pathname!=='/rest/2.0/xpan/file'||url.username||url.password||url.hash||q.size!==2||q.get('method')!=='filemanager'||q.get('opera')!=='rename'||init.method!=='POST'||!(init.body instanceof URLSearchParams)||Object.keys(init).some(key=>!['method','body','headers'].includes(key)))throw new BaiduRenameRejected('百度重命名请求未适配')
 const headers=Object.fromEntries(Object.entries(init.headers||{}).map(([key,value])=>[key.toLowerCase(),value]))
 if(Object.keys(headers).length!==2||headers['user-agent']!=='pan.baidu.com'||headers['content-type']!=='application/x-www-form-urlencoded')throw new BaiduRenameRejected('百度重命名请求头无效')
 const form=init.body
 let rows:any;try{rows=JSON.parse(form.get('filelist')||'')}catch{throw new BaiduRenameRejected('百度重命名文件列表无效')}
 if(form.size!==3||form.get('async')!=='1'||form.get('ondup')!=='overwrite'||!Array.isArray(rows)||rows.length!==1||!rows[0]||Object.keys(rows[0]).length!==2||typeof rows[0].path!=='string'||baiduDirectoryPath(rows[0].path)==='/'||typeof rows[0].newname!=='string'||!rows[0].newname.trim()||/[\u0000-\u001f/\\]/.test(rows[0].newname)||['.','..'].includes(rows[0].newname))throw new BaiduRenameRejected('百度重命名参数无效')
 const response=await rawRequest(account,'POST',url.href,form.toString(),headers)
 mutationAccount(user,'baidu')
 if(response.status>=400&&response.status<500&&response.status!==408)throw new BaiduRenameRejected(`百度拒绝重命名（HTTP ${response.status}）`)
 if(response.status<200||response.status>=300)throw Error('百度重命名响应不确定，请查询确认')
 const data=parseBaiduJson(text(response))
 if(!data||typeof data!=='object'||Array.isArray(data)||!Number.isInteger(data.errno))throw Error('百度重命名回执无效，请查询确认')
 if(data.errno!==0)throw new BaiduRenameRejected(`百度拒绝重命名（errno ${data.errno}）`)
 const before=rows[0].path,after=before.slice(0,before.lastIndexOf('/')+1)+rows[0].newname
 if(data.info!==undefined){
  if(!Array.isArray(data.info)||data.info.length>1)throw Error('百度重命名回执身份不确定')
  for(const row of data.info){
   if(!row||!Number.isInteger(row.errno))throw Error('百度重命名逐项回执无效')
   if(row.errno!==0)throw new BaiduRenameRejected(`百度拒绝单项重命名（errno ${row.errno}）`)
   if(row.path!==before&&row.path!==after)throw Error('百度重命名回执路径不匹配')
  }
 }
 return {ok:true,json:async()=>data}
}
