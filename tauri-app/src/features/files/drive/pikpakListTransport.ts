import {request,text} from '@/features/sources/transport'
import {pikpakFileCheck,pikpakId} from './pikpakFileTransport'
export async function pikpakListFetch(user:string,url:string){
 const account=pikpakFileCheck(user),target=new URL(url),limit=Number(target.searchParams.get('limit'));let filter:any
 try{filter=JSON.parse(target.searchParams.get('filters')||'')}catch{throw Error('PikPak 列表筛选参数无效')}
 if(target.origin!=='https://api-drive.mypikpak.com'||target.pathname!=='/drive/v1/files'||!Number.isSafeInteger(limit)||limit<1||limit>100||typeof filter?.trashed?.eq!=='boolean'||filter.phase?.eq!=='PHASE_TYPE_COMPLETE'||target.searchParams.get('thumbnail_size')!=='SIZE_MEDIUM'||target.searchParams.get('with_audit')!=='true'||[...target.searchParams.keys()].some(key=>!['limit','filters','thumbnail_size','with_audit','parent_id','page_token'].includes(key)))throw Error('PikPak 列表请求参数无效')
 const parent=target.searchParams.get('parent_id')||'',trashed=filter.trashed.eq;if(parent)pikpakId(parent);if(trashed&&parent)throw Error('PikPak 回收站不能限定普通父目录')
 const response=await request(account,'GET',url),data=JSON.parse(text(response))
 if(!data?.error){if(!Array.isArray(data?.files)||data.files.length>limit||data.next_page_token!=null&&typeof data.next_page_token!=='string'||data.next_page_token&&data.next_page_token===target.searchParams.get('page_token'))throw Error('PikPak 列表回执无效');const seen=new Set<string>();for(const row of data.files){const id=pikpakId(row?.id);if(seen.has(id)||typeof row.name!=='string'||!row.name||!['drive#file','drive#folder'].includes(row.kind)||row.parent_id!=null&&typeof row.parent_id!=='string'||!trashed&&(row.parent_id||'')!==parent||!trashed&&id===parent||row.trashed!==undefined&&row.trashed!==trashed||row.phase&&row.phase!=='PHASE_TYPE_COMPLETE'||row.size!==undefined&&(!Number.isSafeInteger(Number(row.size))||Number(row.size)<0))throw Error('PikPak 列表项目身份、父目录或状态无效');seen.add(id)}}
 return {ok:response.status>=200&&response.status<300,json:async()=>data}
}
