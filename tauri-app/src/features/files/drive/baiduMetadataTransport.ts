import {parseBaiduJson} from './baiduJson'
import {rawRequest,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
import {baiduFileId} from './baiduListTransport'

export async function baiduMetaFetch(user:string,rawUrl:string,init:RequestInit){
 const account=mutationAccount(user,'baidu'),url=new URL(rawUrl),q=url.searchParams
 if(url.origin!=='https://pan.baidu.com'||url.pathname!=='/rest/2.0/xpan/multimedia'||url.username||url.password||url.hash||q.size!==7||q.get('method')!=='filemetas'||q.get('dlink')!=='0'||q.get('thumb')!=='1'||q.get('extra')!=='1'||q.get('needmedia')!=='1'||q.get('detail')!=='1'||!/^\[[1-9]\d*\]$/.test(q.get('fsids')||'')||[...q.keys()].some(key=>!['method','fsids','dlink','thumb','extra','needmedia','detail'].includes(key))||Object.keys(init).some(key=>key!=='headers'))throw Error('百度详情请求未适配')
 const headers=Object.entries(init.headers||{})
 if(headers.length!==1||headers[0]![0].toLowerCase()!=='user-agent'||headers[0]![1]!=='pan.baidu.com')throw Error('百度详情请求头无效')
 const response=await rawRequest(account,'GET',url.href,undefined,{'User-Agent':'pan.baidu.com'})
 mutationAccount(user,'baidu')
 return {ok:response.status>=200&&response.status<300,json:async()=>{
  const data=parseBaiduJson(text(response))
  if(!data||typeof data!=='object'||Array.isArray(data)||!Number.isInteger(data.errno))throw Error('百度详情响应无效')
  if(data.errno===0){
   const rows=data.list??data.info
   if(!Array.isArray(rows)||rows.length!==1||!rows[0]||baiduFileId(rows[0].fs_id)!==q.get('fsids')!.slice(1,-1))throw Error('百度详情文件标识不匹配')
   // Directory resolution does not expose provider download links to the renderer.
   delete rows[0].dlink
  }
  return data
 }}
}
