import {nativeCall} from '@/platform/native'
import {json,request,text,type ResponseData} from '@/features/sources/transport'
import type {Account} from '@/features/sources/contracts'
import {getDrivePane} from './ports'
import {useFileSourcesStore} from '@/stores/fileSources'
type Job={url:string;resource?:string}
const sessions=new WeakMap<object,{epoch:unknown;jobs:Map<string,Job>}>()
function monitor(value:string){
 let url:URL;try{url=new URL(value)}catch{throw Error('OneDrive 复制缺少有效监测地址')}
 const host=url.hostname.toLowerCase()
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!(host==='api.onedrive.com'||host==='graph.microsoft.com'||host.endsWith('.sharepoint.com')))throw Error('OneDrive 复制监测地址不可信')
 return url.href
}
export async function oneDriveCopy(account:Account,path:string,body:any){
 const pane=getDrivePane(),epoch=pane.context,match=path.match(/^\/me\/drive\/items\/([^/?]+)\/copy$/),id=match?decodeURIComponent(match[1]!):''
 const source=pane.file?.(id),parent=body?.parentReference?.id
 const check=()=>{if(getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id||!useFileSourcesStore().accounts.some(row=>row.id===account.id&&row.providerId==='onedrive'))throw Error('来源已关闭或切换，停止复制监测')}
 check()
 if(account.providerId!=='onedrive'||!id||!source||typeof parent!=='string'||!parent||typeof body.name!=='string'||body.name!==source.name)throw Error('OneDrive 复制来源或目标无效')
 let session=sessions.get(pane);if(!session||session.epoch!==epoch){session={epoch,jobs:new Map()};sessions.set(pane,session)}
 const key=JSON.stringify([account.id,id,parent,body.name]);let job=session.jobs.get(key)
 if(!job){
  if(session.jobs.size>=128)throw Error('OneDrive 待确认复制任务过多，请先刷新确认')
  job={url:''};session.jobs.set(key,job)
  const launched=await request(account,'POST','https://graph.microsoft.com/v1.0'+path,JSON.stringify(body),{'Content-Type':'application/json'});check()
  if(launched.status!==202)throw Error('OneDrive 未返回复制受理回执')
  const location=Object.entries(launched.headers).find(([name])=>name.toLowerCase()==='location')?.[1]
  job.url=monitor(location||'')
 }
 if(!job.url)throw Error('OneDrive 复制受理状态未知，请刷新目标目录确认，勿重复提交')
 for(let attempt=0;!job.resource&&attempt<60;attempt++){
  check()
  // The monitor URL is a short-lived capability, never receives account credentials.
  const report=await nativeCall<ResponseData>('http_request',{request:{requestId:crypto.randomUUID(),providerId:'onedrive',accountId:'',method:'GET',url:job.url,headers:{},body:null,timeoutMs:30000,proxy:null}});check()
  if(report.status!==200&&report.status!==202)throw Error('OneDrive 复制监测失败，请刷新确认，勿重复提交')
  let data:any;try{data=JSON.parse(text(report))}catch{throw Error('OneDrive 复制监测回执无效')}
  if(data?.error||['failed','deleteFailed','cancelled','canceled'].includes(data?.status))throw Error('OneDrive 复制任务失败')
  if(data?.status==='completed'){
   if(typeof data.resourceId!=='string'||!data.resourceId||data.resourceId===id)throw Error('OneDrive 复制缺少新文件标识')
   job.resource=data.resourceId;break
  }
  if(!['inProgress','notStarted','waiting','updating'].includes(data?.status))throw Error('OneDrive 复制任务状态无效')
  if(attempt<59){await new Promise(resolve=>setTimeout(resolve,1000));check()}
 }
 if(!job.resource)throw Error('OneDrive 复制仍在处理，请刷新确认；重试将继续监测原任务')
 check();const result=await json<any>(account,'GET',`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(job.resource)}?$select=id,name,parentReference,file,folder,deleted`);check()
 const facet=source.isDir?result?.folder:result?.file
 if(!result||result.id!==job.resource||result.name!==body.name||result.parentReference?.id!==parent||result.deleted||!facet||typeof facet!=='object'||Array.isArray(facet))throw Error('OneDrive 复制结果身份、名称、类型或目标不匹配')
 session.jobs.delete(key)
 return result
}
