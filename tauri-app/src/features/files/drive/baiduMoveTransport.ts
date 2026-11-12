import {parseBaiduJson} from './baiduJson'
import {rawRequest,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
import {baiduDirectoryPath} from './baiduFolderTransport'
import {BaiduRenameRejected} from './baiduRenameTransport'
export async function baiduMoveFetch(user:string,rawUrl:string,init:RequestInit){
 const account=mutationAccount(user,'baidu'),url=new URL(rawUrl),q=url.searchParams
 if(url.origin!=='https://pan.baidu.com'||url.pathname!=='/rest/2.0/xpan/file'||url.username||url.password||url.hash||q.size!==2||q.get('method')!=='filemanager'||q.get('opera')!=='move'||init.method!=='POST'||!(init.body instanceof URLSearchParams)||Object.keys(init).some(key=>!['method','body','headers'].includes(key)))throw new BaiduRenameRejected('百度移动请求未适配')
 const headers=Object.fromEntries(Object.entries(init.headers||{}).map(([key,value])=>[key.toLowerCase(),value]))
 if(Object.keys(headers).length!==2||headers['user-agent']!=='pan.baidu.com'||headers['content-type']!=='application/x-www-form-urlencoded')throw new BaiduRenameRejected('百度移动请求头无效')
 const form=init.body
 let rows:any;try{rows=JSON.parse(form.get('filelist')||'')}catch{throw new BaiduRenameRejected('百度移动文件列表无效')}
 if(form.size!==3||form.get('async')!=='1'||form.get('ondup')!=='fail'||!Array.isArray(rows)||rows.length!==1||!rows[0]||Object.keys(rows[0]).length!==2||typeof rows[0].path!=='string'||baiduDirectoryPath(rows[0].path)==='/'||typeof rows[0].dest!=='string'||rows[0].dest!==baiduDirectoryPath(rows[0].dest))throw new BaiduRenameRejected('百度移动参数无效')
 const response=await rawRequest(account,'POST',url.href,form.toString(),headers)
 mutationAccount(user,'baidu')
 if(response.status>=400&&response.status<500&&response.status!==408)throw new BaiduRenameRejected(`百度拒绝移动（HTTP ${response.status}）`)
 if(response.status<200||response.status>=300)throw Error('百度移动结果不确定')
 const data=parseBaiduJson(text(response))
 if(!data||typeof data!=='object'||Array.isArray(data)||!Number.isInteger(data.errno))throw Error('百度移动回执无效')
 if(data.errno!==0)throw new BaiduRenameRejected(`百度拒绝移动（errno ${data.errno}）`)
 const before=rows[0].path,after=(rows[0].dest==='/'?'':rows[0].dest)+before.slice(before.lastIndexOf('/'))
 if(data.info!==undefined){
  if(!Array.isArray(data.info)||data.info.length>1)throw Error('百度移动回执身份不确定')
  for(const row of data.info){if(!row||!Number.isInteger(row.errno))throw Error('百度移动逐项回执无效');if(row.errno!==0)throw new BaiduRenameRejected(`百度拒绝单项移动（errno ${row.errno}）`);if(row.path!==before&&row.path!==after)throw Error('百度移动回执路径不匹配')}
 }
 return {ok:true,json:async()=>data}
}
