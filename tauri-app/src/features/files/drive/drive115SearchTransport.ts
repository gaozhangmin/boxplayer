import {request,text} from '@/features/sources/transport'
import {drive115Check,drive115Id} from './drive115FileTransport'
export async function drive115SearchRequest(user:string,url:string){
 const account=drive115Check(user),target=new URL(url),offset=Number(target.searchParams.get('offset')),limit=Number(target.searchParams.get('limit'))
 if(target.origin!=='https://proapi.115.com'||target.pathname!=='/open/ufile/search'||!target.searchParams.get('search_value')?.trim()||!target.searchParams.has('offset')||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200||[...target.searchParams.keys()].some(key=>!['search_value','offset','limit'].includes(key)))throw Error('115 搜索参数无效')
 const response=await request(account,'GET',url),data=JSON.parse(text(response))
 if(data?.code!==0||data.state===false||!Array.isArray(data.data)||(data.count===undefined||!Number.isSafeInteger(Number(data.count))||Number(data.count)<0))throw Error('115 搜索响应无效')
 const seen=new Set<string>()
 if(data.data.length&&offset+data.data.length>Number(data.count))throw Error('115 搜索总数不匹配')
 if(data.data.length>limit||data.data.length===0&&data.count!==undefined&&offset<Number(data.count))throw Error('115 搜索分页未前进')
 for(const row of data.data){if(typeof row?.file_id==='number'&&!Number.isSafeInteger(row.file_id)||typeof row?.parent_id==='number'&&!Number.isSafeInteger(row.parent_id))throw Error('115 搜索标识精度无效');const id=drive115Id(String(row?.file_id));drive115Id(String(row?.parent_id),true);if(seen.has(id)||typeof row.file_name!=='string'||!row.file_name||!['0','1'].includes(String(row.file_category)))throw Error('115 搜索项目身份无效');seen.add(id)}
 return {ok:response.status>=200&&response.status<300,json:async()=>data}
}
