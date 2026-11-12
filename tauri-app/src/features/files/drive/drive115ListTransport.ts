import {nativeCall} from '@/platform/native'
import type {ResponseData} from '@/features/sources/transport'
import {drive115Check,drive115Id} from './drive115FileTransport'
export async function drive115ListRequest(user:string,url:string){
 const account=drive115Check(user),target=new URL(url),parent=drive115Id(target.searchParams.get('cid')||'',true),offset=Number(target.searchParams.get('offset')),limit=Number(target.searchParams.get('limit'))
 if(target.origin!=='https://proapi.115.com'||target.pathname!=='/open/ufile/files'||!target.searchParams.has('offset')||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200||target.searchParams.get('cur')!=='1'||!['0','1'].includes(target.searchParams.get('show_dir')||'')||[...target.searchParams.keys()].some(key=>!['cid','offset','limit','cur','show_dir'].includes(key)))throw Error('115 列表请求参数无效')
 // Keep HTTP 429 and Retry-After visible to the original queue; native credentials
 // and the original 30-second timeout remain in the existing protected backend.
 const response=await nativeCall<ResponseData>('http_request',{request:{requestId:crypto.randomUUID(),providerId:'115',accountId:account.id,method:'GET',url,headers:{},body:null,timeoutMs:30000,proxy:null}})
 const ok=response.status>=200&&response.status<300
 let data:any
 if(ok){data=JSON.parse(new TextDecoder().decode(new Uint8Array(response.body)));if(data?.state===false&&data?.code===0)throw Error('115 列表回执无效');if(data?.code===0){if(!Array.isArray(data.data)||data.data.length>limit)throw Error('115 列表数据无效');const seen=new Set<string>();for(const row of data.data){if(typeof row?.fid==='number'&&!Number.isSafeInteger(row.fid)||typeof row?.pid==='number'&&!Number.isSafeInteger(row.pid))throw Error('115 列表标识精度无效');const id=drive115Id(String(row?.fid));if(String(row?.pid)!==parent||id===parent||seen.has(id)||typeof row.fn!=='string'||!row.fn||!['0','1'].includes(String(row.fc))||target.searchParams.get('show_dir')==='0'&&String(row.fc)==='0')throw Error('115 列表项目身份或父目录无效');seen.add(id)}}}
 return {ok,status:response.status,headers:{get:(name:string)=>Object.entries(response.headers).find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1]||null},json:async()=>data}
}
