import {mutationAccount} from './providerTransport'
import {request,text} from '@/features/sources/transport'
export const drive115Check=(user:string)=>mutationAccount(user,'115')
export function drive115Id(value:string,root=false){if(typeof value!=='string'||!/^(0|[1-9]\d*)$/.test(value)||!root&&value==='0')throw Error('115 文件标识无效');return value}
export function drive115Parent(value:string){return drive115Id(['','root','backup_root','drive115_root'].includes(value)?'0':value,true)}
export async function readDrive115Metadata(user:string,id:string){
 drive115Check(user);drive115Id(id)
 const {apiDrive115FileDetailResult}=await import('./electron/providers/drive115Folders')
 const result=await apiDrive115FileDetailResult(user,id)
 if(!result.detail||result.error)throw Error(result.error||'115 文件详情读取失败')
 return result.detail
}
export async function drive115Detail(user:string,id:string){const detail=await readDrive115Metadata(user,id);return {id:detail.file_id,name:detail.name,isDir:detail.isDir}}
export async function drive115DetailRequest(user:string,url:string){
 const account=drive115Check(user),target=new URL(url),id=target.searchParams.get('file_id')||'';drive115Id(id)
 if(target.origin!=='https://proapi.115.com'||target.pathname!=='/open/folder/get_info'||[...target.searchParams.keys()].some(key=>key!=='file_id'))throw Error('115 详情请求路径无效')
 const response=await request(account,'GET',url),data=JSON.parse(text(response)),info=data?.data
 if(data?.code!==0||data.state===false||!info||typeof info.file_id==='number'&&!Number.isSafeInteger(info.file_id)||String(info.file_id)!==id||typeof info.file_name!=='string'||!info.file_name||!['0','1'].includes(String(info.file_category)))throw Error('115 文件详情身份或状态无效')
 for(const key of ['size_byte','folder_count','count','play_long'])if(info[key]!==undefined&&(!Number.isSafeInteger(Number(info[key]))||Number(info[key])<0))throw Error('115 文件详情计数无效')
 if(info.paths!==undefined){if(!Array.isArray(info.paths))throw Error('115 文件详情路径无效');const seen=new Set<string>();for(const row of info.paths){if(typeof row?.file_id==='number'&&!Number.isSafeInteger(row.file_id))throw Error('115 路径标识精度无效');const pathId=drive115Id(String(row?.file_id),true);if(seen.has(pathId)||typeof row.file_name!=='string')throw Error('115 文件详情路径无效');seen.add(pathId)}}
 return {ok:response.status>=200&&response.status<300,json:async()=>data}
}

export async function drive115Request(user:string,url:string,options:{method:string;headers:Record<string,string>;body:URLSearchParams}){
 const account=drive115Check(user),allowed=new Set(['https://proapi.115.com/open/folder/add','https://proapi.115.com/open/ufile/update','https://proapi.115.com/open/ufile/move','https://proapi.115.com/open/ufile/copy','https://proapi.115.com/open/ufile/delete','https://proapi.115.com/open/rb/revert','https://proapi.115.com/open/rb/del'])
 if(!allowed.has(url)||options.method!=='POST')throw Error('115 文件请求路径无效')
 const body=options.body
 if(url.includes('/rb/')){if(body.has('tid')){const ids=body.get('tid')!.split(',');if(!ids.length||new Set(ids).size!==ids.length)throw Error('115 回收站选择无效');for(const id of ids)drive115Id(id)}else if(url.endsWith('/revert'))throw Error('115 还原选择为空')}
 else if(url.endsWith('/add')){drive115Id(body.get('pid')||'',true);if(!body.get('file_name'))throw Error('115 文件夹名称为空')}
 else if(url.endsWith('/delete')){const ids=(body.get('file_ids')||'').split(',');if(!ids.length||new Set(ids).size!==ids.length)throw Error('115 删除选择无效');for(const id of ids)drive115Id(id);if(body.has('parent_id'))drive115Id(body.get('parent_id')!,true)}
 else if(url.endsWith('/move')||url.endsWith('/copy')){const ids=(body.get(url.endsWith('/move')?'file_ids':'file_id')||'').split(',');if(!ids.length||new Set(ids).size!==ids.length)throw Error('115 文件选择无效');for(const id of ids)drive115Id(id);drive115Id(body.get(url.endsWith('/move')?'to_cid':'pid')||'',true)}
 else{drive115Id(body.get('file_id')||'');if(!body.get('file_name'))throw Error('115 文件名称为空')}
 const response=await request(account,'POST',url,body.toString(),{'Content-Type':'application/x-www-form-urlencoded'})
 const data=JSON.parse(text(response));if(typeof data?.code!=='number'||data.state===false&&data.code===0)throw Error('115 文件操作回执无效')
 if(url.endsWith('/add')&&data.code===0){const id=data?.data?.file_id;if(typeof id==='number'&&!Number.isSafeInteger(id))throw Error('115 文件夹标识精度无效');drive115Id(String(id))}
 return {ok:response.status>=200&&response.status<300,json:async()=>data}
}

export async function drive115TrashListRequest(user:string,url:string){
 const account=drive115Check(user),target=new URL(url),offset=Number(target.searchParams.get('offset')),limit=Number(target.searchParams.get('limit'))
 if(!target.searchParams.has('offset')||!target.searchParams.has('limit')||target.origin!=='https://proapi.115.com'||target.pathname!=='/open/rb/list'||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200||[...target.searchParams.keys()].some(key=>!['offset','limit'].includes(key)))throw Error('115 回收站分页参数无效')
 const response=await request(account,'GET',url),data=JSON.parse(text(response)),payload=data?.data
 if(data?.code!==0||data.state===false||!payload||typeof payload!=='object'||Array.isArray(payload)||!Number.isSafeInteger(Number(payload.count))||Number(payload.count)<0)throw Error('115 回收站列表响应无效')
 const rows=Object.entries(payload).filter(([key])=>!['offset','limit','count','rb_pass'].includes(key)).map(([,row])=>row as any),seen=new Set<string>()
 if(payload.offset!==undefined&&Number(payload.offset)!==offset||payload.limit!==undefined&&Number(payload.limit)!==limit)throw Error('115 回收站回执分页不匹配')
 if(rows.length&&offset+rows.length>Number(payload.count))throw Error('115 回收站总数不匹配')
 if(rows.length>limit||offset<Number(payload.count)&&!rows.length)throw Error('115 回收站分页未前进')
 for(const row of rows){if(typeof row?.id==='number'&&!Number.isSafeInteger(row.id)||row?.cid!==undefined&&typeof row.cid==='number'&&!Number.isSafeInteger(row.cid))throw Error('115 回收站标识精度无效');const id=drive115Id(String(row?.id));if(seen.has(id)||typeof row.file_name!=='string'||!row.file_name||!['1','2'].includes(String(row.type)))throw Error('115 回收站项目身份无效');seen.add(id);if(row.cid!==undefined)drive115Id(String(row.cid),true)}
 return {ok:true,json:async()=>data}
}
