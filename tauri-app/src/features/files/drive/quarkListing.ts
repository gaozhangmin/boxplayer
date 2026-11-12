import type {Account} from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
import {quarkId} from './quarkFileTransport'
import {apiQuarkFileList,apiQuarkSearch,mapQuarkFileToAliModel,type QuarkFileItem} from './electron/providers/quarkMetadata'

export function quarkEntry(account:Account,item:QuarkFileItem,parent:string){
 quarkId(item.fid)
 if(typeof item.file_name!=='string'||!item.file_name||item.file_type!==undefined&&![0,1].includes(item.file_type)||item.dir!==undefined&&typeof item.dir!=='boolean'||item.file_type===undefined&&item.dir===undefined||item.file_type!==undefined&&item.dir!==undefined&&item.dir!==(item.file_type===0))throw Error('夸克文件名称或类型无效')
 if(item.pdir_fid!==undefined)quarkId(item.pdir_fid,true)
 const electronModel=mapQuarkFileToAliModel({...item,file_type:item.file_type??(item.dir?0:1)},account.id,parent==='0'?'quark_root':parent)
 if(!Number.isSafeInteger(electronModel.size)||electronModel.size<0||!Number.isFinite(electronModel.time)||typeof electronModel.thumbnail!=='string')throw Error('夸克文件媒体字段无效')
 return {id:electronModel.file_id,name:electronModel.name,isDirectory:electronModel.isDir,size:electronModel.size,modified:electronModel.time,playable:!electronModel.isDir&&['video','video2'].includes(electronModel.category),originalParent:item.pdir_fid===undefined?parent==='0'?'':parent:quarkId(item.pdir_fid,true)==='0'?'':String(item.pdir_fid),electronModel}
}
export async function listQuark(account:Account,parent:string,cursor?:string){
 mutationAccount(account.id,'quark');parent=quarkId(parent,true)
 let page=1,previous:string[]=[],hashes:string[]=[]
 if(cursor){
  let value:any;try{value=JSON.parse(cursor)}catch{throw Error('夸克列表游标无效')}
  if(value?.account!==account.id||value.view!=='files'||value.parent!==parent||!Number.isSafeInteger(value.page)||value.page<2||!Array.isArray(value.previous)||value.previous.length!==100||value.previous.some((id:unknown)=>typeof id!=='string'||!id)||new Set(value.previous).size!==100||!Array.isArray(value.hashes)||value.hashes.length!==value.page-1||value.hashes.some((hash:unknown)=>typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)))throw Error('夸克列表游标范围无效')
  page=value.page;previous=value.previous;hashes=value.hashes
 }
 const result=await apiQuarkFileList(account.id,parent,100,page,true)
 mutationAccount(account.id,'quark')
 const ids=result.items.map(item=>quarkId(item.fid))
 if(new Set(ids).size!==ids.length||ids.some(id=>previous.includes(id)))throw Error('夸克列表重复文件标识')
 if(!Number.isSafeInteger(result.total)||result.total<0||result.total<(page-1)*100+ids.length||ids.length<100&&result.total>(page-1)*100+ids.length)throw Error('夸克列表分页总数无效')
 const entries=result.items.map(item=>{
  if(item.pdir_fid!==undefined&&quarkId(item.pdir_fid,true)!==parent)throw Error('夸克列表父目录不匹配')
  return quarkEntry(account,item,parent)
 })
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([...ids].sort()))),hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')
 if(ids.length&&hashes.includes(hash))throw Error('夸克列表重复整页')
 return {entries,nextCursor:page*100<result.total?JSON.stringify({account:account.id,view:'files',parent,page:page+1,previous:ids,hashes:[...hashes,hash]}):undefined}
}
export async function searchQuark(account:Account,query:string,cursor?:string){
 mutationAccount(account.id,'quark')
 if(cursor)throw Error('夸克原搜索不支持后续分页')
 if(!query.trim())return {entries:[]}
 const items=await apiQuarkSearch(account.id,query,200)
 mutationAccount(account.id,'quark')
 const ids=items.map(item=>quarkId(item.fid))
 if(new Set(ids).size!==ids.length)throw Error('夸克搜索重复文件标识')
 return {entries:items.map(item=>{
  if(item.pdir_fid===undefined)throw Error('夸克搜索缺少实际父目录')
  return quarkEntry(account,item,quarkId(item.pdir_fid,true))
 })}
}
