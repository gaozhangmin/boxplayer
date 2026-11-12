import {request,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
export interface IAliFileResp {m_user_id:string;m_drive_id:string;dirID:string;next_marker:string;items:Record<string,any>[];drives:Record<string,string>}
// A short synchronous invocation scope supplies only already-read provider drive IDs.
// The original method builds its query before its first await.
let binding:IAliFileResp|undefined
export function withSearchScope<T>(dir:IAliFileResp,run:()=>T){const previous=binding;binding=dir;try{return run()}finally{binding=previous}}
export function GetDriveID(user:string,alias:string){if(!binding||binding.m_user_id!==user)throw Error('搜索盘范围未绑定');return binding.drives[alias]||''}
export const AliSearchHttp={async Post(path:string,value:any,user:string,_share:string){
 const account=mutationAccount(user,'aliyun')
 if(!['adrive/v3/file/search','adrive/v1.0/openFile/search'].includes(path))throw Error('搜索请求路径无效')
 const response=await request(account,'POST','https://api.aliyundrive.com/'+path,JSON.stringify(value),{'Content-Type':'application/json'})
 return {code:response.status,body:JSON.parse(text(response))}
}}
export const AliDirFileList={_FileListOnePage(_by:string,_direction:string,dir:IAliFileResp,response:{code:number;body:any},_page:number){
 const data=response.body,allowed=new Set(Object.values(dir.drives)),seen=new Set<string>()
 if(response.code!==200||data?.code||!Array.isArray(data?.items)||data.next_marker!==undefined&&typeof data.next_marker!=='string')throw Error('阿里搜索回执无效')
 for(const row of data.items){const key=JSON.stringify([row?.drive_id,row?.file_id]);if(!allowed.has(row?.drive_id)||typeof row?.file_id!=='string'||!row.file_id||seen.has(key)||typeof row.name!=='string'||!row.name||typeof row.parent_file_id!=='string'||!row.parent_file_id||!['file','folder'].includes(row.type))throw Error('阿里搜索项目身份无效');seen.add(key)}
 if(data.next_marker&&data.next_marker===dir.next_marker)throw Error('阿里搜索游标重复')
 dir.items=data.items;dir.next_marker=data.next_marker||'';return true
}}
