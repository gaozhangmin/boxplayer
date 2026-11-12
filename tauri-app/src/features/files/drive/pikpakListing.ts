import type {Account} from '@/features/sources/contracts'
import {apiPikPakFileList,mapPikPakFileToAliModel} from './electron/providers/pikpakMetadata'
import {pikpakFileCheck,pikpakParent,pikpakId} from './pikpakFileTransport'
export async function listPikPak(account:Account,parent:string,cursor?:string,trashed=false){
 if(account.providerId!=='pikpak')throw Error('PikPak 来源不匹配');pikpakFileCheck(account.id)
 const location=trashed?'pikpak_root':pikpakParent(parent);let token='',tokens:string[]=[],hashes:string[]=[],previous:string[]=[]
 if(cursor){let value:any;try{value=JSON.parse(cursor)}catch{throw Error('PikPak 列表游标无效')};if(value?.source!==account.id||value.parent!==location||value.trashed!==trashed||typeof value.token!=='string'||!value.token||!Array.isArray(value.tokens)||value.tokens.at(-1)!==value.token||value.tokens.some((token:unknown)=>typeof token!=='string'||!token)||new Set(value.tokens).size!==value.tokens.length||!Array.isArray(value.previous)||value.previous.length>100||value.previous.some((id:unknown)=>typeof id!=='string')||!Array.isArray(value.hashes)||value.hashes.some((hash:unknown)=>typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)))throw Error('PikPak 列表游标范围无效');token=value.token;tokens=value.tokens;hashes=value.hashes;previous=value.previous.map((id:string)=>pikpakId(id))}
 const page=await apiPikPakFileList(account.id,location,100,token,trashed,true),ids=page.items.map(item=>item.id),old=new Set(previous)
 if(page.nextPageToken&&tokens.includes(page.nextPageToken)||ids.some(id=>old.has(id)))throw Error('PikPak 分页重复游标或项目')
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([...ids].sort()))),hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')
 if(ids.length&&hashes.includes(hash))throw Error('PikPak 分页重复整页')
 return {entries:page.items.map(item=>{const electronModel=mapPikPakFileToAliModel(item,account.id,location==='pikpak_root'?'':location);return {id:electronModel.file_id,name:electronModel.name,isDirectory:electronModel.isDir,size:electronModel.size,playable:!electronModel.isDir&&['video','video2'].includes(electronModel.category),originalParent:electronModel.parent_file_id,modified:electronModel.time,electronModel}}),nextCursor:page.nextPageToken?JSON.stringify({source:account.id,parent:location,trashed,token:page.nextPageToken,tokens:[...tokens,page.nextPageToken],previous:ids,hashes:ids.length?[...hashes,hash]:hashes}):undefined}
}
