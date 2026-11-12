import type {Account,SourceDriver,SourceEntry} from './contracts'
import {endpoint,json} from './transport'
import {originalAListModels,readonlySourceCheck,readonlyAListApiBase} from '@/features/files/drive/readonlyDavMapping'
interface Envelope<T>{code:number;message:string;data:T}
function unwrap<T>(value:Envelope<T>):T{if(!value||typeof value!=='object'||![0,200].includes(value.code)||!value.data||typeof value.data!=='object'||Array.isArray(value.data))throw Error(`AList 请求失败（${value?.code??'无效响应'}）`);return value.data}
function location(value:string){const path=['','root','backup_root'].includes(value)?'/':value;if(!path.startsWith('/')||/[\u0000-\u001f\\]/.test(path)||path.split('/').slice(1).some((part,index,parts)=>part==='.'||part==='..'||!part&&index!==parts.length-1))throw Error('AList目录路径无效');return path.replace(/\/+$/,'')||'/'}
export const alist:SourceDriver={
 async list(account,parent,cursor){
  const check=readonlySourceCheck(account);check();if(account.providerId!=='alist'||cursor)throw Error('AList来源或分页位置无效')
  const path=location(parent)
  // Retain Electron's complete readonly listing request. Pagination belongs to
  // the transport boundary, not a different UI sort/model implementation.
  const data=unwrap(await json<Envelope<{content:any[]|null;total?:number}>>(account,'POST',endpoint(account,'api/fs/list'),{path,password:'',page:1,per_page:0,refresh:false}));check()
  if(data.content!==undefined&&data.content!==null&&!Array.isArray(data.content))throw Error('AList目录响应无效')
  const raw=data.content||[]
  if(typeof data.total==='number'&&Number.isSafeInteger(data.total)&&data.total>raw.length)throw Error('AList未返回完整目录，请检查服务端分页配置')
  for(const item of raw){
   if(!item||typeof item!=='object'||Array.isArray(item)||item.name!==undefined&&item.name!==null&&typeof item.name!=='string'||item.path!==undefined&&typeof item.path!=='string'||item.is_dir!==undefined&&typeof item.is_dir!=='boolean'||!Number.isSafeInteger(Number(item.size||0))||Number(item.size||0)<0)throw Error('AList文件字段无效')
   for(const field of ['modified','created'])if(item[field]!==undefined&&item[field]!==null&&(typeof item[field]!=='string'||item[field]&&!Number.isFinite(Date.parse(item[field]))))throw Error('AList文件时间无效')
   if(item.thumb!==undefined&&item.thumb!==null&&typeof item.thumb!=='string'||item.hash_info!==undefined&&item.hash_info!==null&&(!item.hash_info||typeof item.hash_info!=='object'||Array.isArray(item.hash_info)||item.hash_info.md5!==undefined&&item.hash_info.md5!==null&&typeof item.hash_info.md5!=='string'))throw Error('AList缩略图或摘要无效')
  }
  const models=await originalAListModels(account,path,data);check()
  const seen=new Set<string>()
  const entries=models.map((model,index)=>{
   const item=raw[index],id=(path==='/'?'':path)+'/'+model.name
   if(!model.name||['.','..'].includes(model.name)||/[\u0000-\u001f/\\]/.test(model.name)||model.isDir!==!!item.is_dir||model.size!==Number(item.size||0)||!Number.isFinite(model.time))throw Error('AList原文件模型身份无效')
   if(seen.has(model.name))throw Error('AList目录存在重复文件标识')
   seen.add(model.name)
   if(model.thumbnail){const thumb=new URL(model.thumbnail);if(!['http:','https:'].includes(thumb.protocol)||thumb.username||thumb.password)throw Error('AList缩略图地址无效')}
   return {id,name:model.name,isDirectory:model.isDir,size:model.size,modified:model.time,playable:!model.isDir&&['video','video2'].includes(model.category),electronModel:{...model,drive_id:account.id,file_id:id,parent_file_id:parent}} as SourceEntry
  })
  return {entries}
 },
 async resolve(account,entry){
  const check=readonlySourceCheck(account);check();if(account.providerId!=='alist'||entry.isDirectory)throw Error('AList文件无效')
  const data=unwrap(await json<Envelope<{raw_url:string}>>(account,'POST',endpoint(account,'api/fs/get'),{path:location(entry.id),password:''}));check()
  if(typeof data.raw_url!=='string'||!data.raw_url)throw Error('AList未返回播放地址')
  const url=new URL(data.raw_url,readonlyAListApiBase(account));if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('AList返回的播放地址无效')
  return {schemaVersion:1,sourceId:account.id,accountId:account.id,fileId:entry.id,url:url.href,headers:{}}
 }
}
