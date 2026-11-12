import type {Account} from '@/features/sources/contracts'
import {apiDrive115FileList,mapDrive115FileToAliModel} from './electron/providers/drive115List'
import {drive115Check,drive115Parent,drive115Id} from './drive115FileTransport'
export async function listDrive115(account:Account,parent:string,cursor?:string){
 if(account.providerId!=='115')throw Error('115 列表来源不匹配');drive115Check(account.id)
 const id=drive115Parent(parent);let offset=0,previous:string[]=[],hashes:string[]=[]
 if(cursor){let value:any;try{value=JSON.parse(cursor)}catch{throw Error('115 列表游标无效')};if(value?.source!==account.id||value.parent!==id||!Number.isSafeInteger(value.offset)||value.offset<=0||value.offset%200!==0||!Array.isArray(value.previous)||value.previous.length!==200||value.previous.some((id:unknown)=>typeof id!=='string')||new Set(value.previous).size!==200||!Array.isArray(value.hashes)||value.hashes.length!==value.offset/200||value.hashes.some((hash:unknown)=>typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))||new Set(value.hashes).size!==value.hashes.length)throw Error('115 列表游标范围不匹配');offset=value.offset;previous=value.previous.map((id:string)=>drive115Id(id));hashes=value.hashes}
 const items=await apiDrive115FileList(account.id,id,200,offset,true,{strict:true,silent:true})
 const ids=items.map(item=>String(item.fid)),prior=new Set(previous)
 if(ids.some(id=>prior.has(id)))throw Error('115 列表分页出现重复项目')
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([...ids].sort())))
 const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')
 if(items.length&&hashes.includes(hash))throw Error('115 列表分页重复整页')
 if(!Number.isSafeInteger(offset+items.length))throw Error('115 列表分页超出有效范围')
 return {entries:items.map(item=>{const electronModel=mapDrive115FileToAliModel(item,account.id);return {id:electronModel.file_id,name:electronModel.name,isDirectory:electronModel.isDir,size:electronModel.size,playable:!electronModel.isDir&&['video','video2'].includes(electronModel.category),originalParent:electronModel.parent_file_id,modified:electronModel.time,electronModel}}),nextCursor:items.length===200?JSON.stringify({source:account.id,parent:id,offset:offset+items.length,previous:ids,hashes:[...hashes,hash]}):undefined}
}
