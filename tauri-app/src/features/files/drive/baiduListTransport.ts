import {parseBaiduJson} from './baiduJson'
import {rawRequest,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
import {baiduDirectoryPath} from './baiduFolderTransport'

export function baiduFileId(value:unknown):string{
 if(typeof value==='number'&&(!Number.isSafeInteger(value)||value<=0))throw Error('百度文件标识超出数值精度')
 if(typeof value!=='string'&&typeof value!=='number'||!/^[1-9]\d*$/.test(String(value)))throw Error('百度文件标识无效')
 return String(value)
}
export async function baiduListFetch(user:string,rawUrl:string,init:RequestInit){
 const account=mutationAccount(user,'baidu'),url=new URL(rawUrl),q=url.searchParams,method=q.get('method')
 if(url.origin!=='https://pan.baidu.com'||url.pathname!=='/rest/2.0/xpan/file'||url.username||url.password||url.hash||!['list','search'].includes(method||'')||Object.keys(init).some(key=>key!=='headers'))throw Error('百度列表请求未适配')
 const headers=Object.entries(init.headers||{})
 if(headers.length!==1||headers[0]![0].toLowerCase()!=='user-agent'||headers[0]![1]!=='pan.baidu.com')throw Error('百度列表请求头无效')
 if(q.get('dir')!==baiduDirectoryPath(q.get('dir')||'')||q.get('web')!=='1')throw Error('百度列表路径无效')
 if(method==='list'){
  if(q.size!==8||![...q.keys()].every(key=>['method','dir','order','start','limit','web','folder','desc'].includes(key))||!['name','time','size'].includes(q.get('order')||'')||!/^\d+$/.test(q.get('start')||'')||!Number.isSafeInteger(Number(q.get('start')))||q.get('limit')!=='1000'||q.get('folder')!=='0'||!['0','1'].includes(q.get('desc')||''))throw Error('百度列表分页或排序无效')
 }else if(q.size!==6||![...q.keys()].every(key=>['method','key','dir','num','web','recursion'].includes(key))||!q.get('key')?.trim()||q.get('dir')!=='/'||q.get('num')!=='500'||q.get('recursion')!=='1')throw Error('百度搜索参数无效')
 const response=await rawRequest(account,'GET',url.href,undefined,{'User-Agent':'pan.baidu.com'},15000)
 mutationAccount(user,'baidu')
 return {ok:response.status>=200&&response.status<300,status:response.status,json:async()=>{
  const data=parseBaiduJson(text(response))
  if(!data||typeof data!=='object'||Array.isArray(data)||!Number.isInteger(data.errno)||method==='search'&&data.errno!==0)throw Error('百度列表或搜索响应失败')
  if(data.errno===0){
   if(!Array.isArray(data.list)||data.list.length>(method==='list'?1000:500)||method==='list'&&data.has_more!==undefined&&![0,1].includes(data.has_more)||method==='list'&&data.has_more===1&&!data.list.length)throw Error('百度列表或分页响应无效')
   for(const item of data.list){if(!item||typeof item!=='object')throw Error('百度列表条目无效');baiduFileId(item.fs_id)}
  }
  return data
 }}
}
