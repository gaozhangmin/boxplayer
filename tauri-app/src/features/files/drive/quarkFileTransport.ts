import {request,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
import {quarkParams} from './electron/providers/quarkMetadata'

export class QuarkRequestRejected extends Error {}

export function quarkId(value:unknown,root=false):string{
 if(root&&['','root','backup_root','quark_root','0'].includes(String(value)))return '0'
 if(typeof value==='number'&&(!Number.isSafeInteger(value)||value<=0))throw Error('夸克文件标识超出安全范围')
 if(typeof value!=='string'&&typeof value!=='number')throw Error('夸克文件标识无效')
 const id=String(value)
 if(!id||['0','root','backup_root','quark_root'].includes(id)||id.length>4096||/[\u0000-\u0020/\\]/.test(id))throw Error('夸克文件标识无效')
 return id
}
export async function quarkRequest<T=any>(user:string,path:string,init:RequestInit={},params:Record<string,string|number|undefined>={},_silent=false):Promise<T>{
 const account=mutationAccount(user,'quark'),method=init.method||'GET'
 if(init.headers||init.credentials||Object.keys(init).some(key=>!['method','body'].includes(key)))throw Error('夸克请求选项未适配')
 const data=init.body===undefined?undefined:typeof init.body==='string'?JSON.parse(init.body):null
 const keys=data&&typeof data==='object'&&!Array.isArray(data)?Object.keys(data):[]
 if(path==='file'&&method==='GET'){
  if(data!==undefined||Object.keys(params).length!==1||!('fids'in params))throw Error('夸克详情参数无效')
  quarkId(params.fids)
 }else if(path==='file/recycle/list'&&method==='GET'){
  if(data!==undefined||Object.keys(params).length!==3||params._fetch_total!==1||!Number.isSafeInteger(params._page)||Number(params._page)<1||params._size!==100)throw Error('夸克回收站分页参数无效')
 }else if(path==='file/sort'&&method==='GET'){
  if(data!==undefined||Object.keys(params).length!==7||params._fetch_total!==1||!Number.isSafeInteger(params._page)||Number(params._page)<1||params._size!==100||params.fetch_all_file!==1||params.fetch_risk_file_name!==1||params._sort!=='file_name:asc')throw Error('夸克列表分页参数无效')
  quarkId(params.pdir_fid,true)
 }else if(path==='file/search'&&method==='GET'){
  if(data!==undefined||Object.keys(params).length!==6||typeof params.q!=='string'||!params.q.trim()||params._page!==1||params._size!==200||params._fetch_total!==1||params._sort!=='file_type:desc,updated_at:desc'||params._is_hl!==1)throw Error('夸克搜索参数无效')
 }else if((path==='file/move'||path==='file/delete')&&method==='POST'){
  const move=path==='file/move',allowed=move?['action_type','to_pdir_fid','filelist','exclude_fids']:['action_type','filelist','exclude_fids']
  if(keys.length!==allowed.length||keys.some(key=>!allowed.includes(key))||data.action_type!==(move?1:2)||!Array.isArray(data.exclude_fids)||data.exclude_fids.length||!Array.isArray(data.filelist)||!data.filelist.length||data.filelist.length>100||new Set(data.filelist).size!==data.filelist.length)throw Error('夸克移动或回收参数无效')
  data.filelist.forEach((id:unknown)=>quarkId(id));if(move)quarkId(data.to_pdir_fid,true)
 }else if(path==='file'&&method==='POST'){
  if(keys.length!==4||keys.some(key=>!['pdir_fid','file_name','dir_init_lock','dir_path'].includes(key))||data.dir_init_lock!==false||data.dir_path!=='')throw Error('夸克新建参数无效')
  quarkId(data.pdir_fid,true)
 }else if(path==='file/rename'&&method==='POST'){
  if(keys.length!==2||keys.some(key=>!['fid','file_name'].includes(key)))throw Error('夸克重命名参数无效')
  quarkId(data.fid)
 }else throw Error('夸克文件请求未适配')
 if(method==='POST'){
  if(Object.keys(params).length)throw Error('夸克请求参数无效')
  if(['file','file/rename'].includes(path)&&(typeof data.file_name!=='string'||!data.file_name.trim()||/[\u0000-\u001f/\\]/.test(data.file_name)||['.','..'].includes(data.file_name)))throw Error('夸克文件名或请求参数无效')
 }
 const response=await request(account,method,`https://drive-pc.quark.cn/1/clouddrive/${path}?${quarkParams(params)}`,init.body as string|undefined,{'Content-Type':'application/json'})
 mutationAccount(user,'quark')
 if(response.status>=400&&response.status<500)throw new QuarkRequestRejected(`夸克拒绝文件请求（HTTP ${response.status}）`)
 if(response.status<200||response.status>=300)throw Error('夸克文件请求结果不确定')
 const result=JSON.parse(text(response))
 if(result&&typeof result==='object'&&Number.isInteger(result.code)&&result.code!==0)throw new QuarkRequestRejected('夸克文件操作未确认成功')
 if(!result||typeof result!=='object'||Array.isArray(result)||result.__error||result.status==='error'||result.success===false||result.code!==undefined&&result.code!==0)throw Error('夸克文件操作未确认成功')
 if(['file/move','file/delete'].includes(path)&&result.code!==0)throw Error('夸克未确认移动或回收请求')
 if(['file/recycle/list','file/sort','file/search'].includes(path)){
  const rows=result.data?.list??result.data,total=result.metadata?._total??result.data?.metadata?._total
  const limit=path==='file/search'?200:100
  if(!Array.isArray(rows)||rows.length>limit||total!==undefined&&(!Number.isSafeInteger(total)||total<0)||path!=='file/search'&&total===undefined&&rows.length===limit)throw Error('夸克列表或总数无效')
 }
 const validate=(value:unknown):void=>{
  if(!value||typeof value!=='object')return
  if(Array.isArray(value)){value.forEach(validate);return}
  for(const [key,field] of Object.entries(value)){
   if(['fid','pdir_fid','record_id'].includes(key)&&field!==undefined&&field!==null)quarkId(field,key==='pdir_fid')
   else if(field&&typeof field==='object')validate(field)
  }
 }
 validate(result.data)
 return result as T
}
