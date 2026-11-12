import type {Account} from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
import {TreeStore} from './ports'
import {baiduDirectoryPath} from './baiduFolderTransport'
import {baiduDirectoryLocation} from './baiduMetadata'
import {baiduFileId} from './baiduListTransport'
import {apiBaiduFileListPage,apiBaiduSearch,mapBaiduFileToAliModel,type BaiduFileItem} from './electron/providers/baiduListing'

function model(account:Account,item:BaiduFileItem,parent?:string,parentIdentity?:string){
 const fsid=baiduFileId(item.fs_id),path=baiduDirectoryPath(item.path)
 if(path==='/'||typeof item.server_filename!=='string'||!item.server_filename||path.split('/').at(-1)!==item.server_filename||![0,1].includes(item.isdir))throw Error('百度文件路径、名称或类型不匹配')
 const actualParent=path.slice(0,path.lastIndexOf('/'))||'/'
 if(parent!==undefined&&actualParent!==parent)throw Error('百度列表父目录不匹配')
 const original=mapBaiduFileToAliModel(item,account.id,actualParent)
 if(!Number.isSafeInteger(original.size)||original.size<0||!Number.isFinite(original.time)||typeof original.thumbnail!=='string')throw Error('百度文件媒体字段无效')
 // Preserve Electron's stable fs_id, while retaining the physical path independently.
 const id=fsid,electronModel={...original,file_id:id,parent_file_id:parentIdentity??actualParent}
 return {id,name:original.name,isDirectory:original.isDir,size:original.size,playable:!original.isDir&&['video','video2'].includes(original.category),modified:original.time,originalParent:actualParent,electronModel}
}
export async function listBaidu(account:Account,parent:string,cursor?:string){
 mutationAccount(account.id,'baidu');const identity=['','root','backup_root','baidu_root','/'].includes(parent)?'backup_root':parent;parent=await baiduDirectoryLocation(account,parent);mutationAccount(account.id,'baidu')
 // Original cloudbaidu/adapter.ts sort mapping; bind it to the native directory identity.
 const [sortKey, sortDirection] = TreeStore.GetDirOrder(account.id,identity).split(' ')
 const order = sortKey === 'updated_at' ? 'time' : sortKey === 'size' ? 'size' : 'name'
 const desc = sortDirection === 'desc' ? 1 : 0
 let start=0,previous:string[]=[],hashes:string[]=[]
 if(cursor){
  let value:any;try{value=JSON.parse(cursor)}catch{throw Error('百度列表游标无效')}
  if(value?.source!==account.id||value.parent!==parent||value.identity!==identity||value.view!=='files'||value.order!==order||value.desc!==desc||!Number.isSafeInteger(value.start)||value.start<1000||value.start%1000||!Array.isArray(value.previous)||!value.previous.length||value.previous.length>1000||value.previous.some((id:unknown)=>typeof id!=='string'||!id)||new Set(value.previous).size!==value.previous.length||!Array.isArray(value.hashes)||value.hashes.length!==value.start/1000||value.hashes.some((hash:unknown)=>typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)))throw Error('百度列表游标范围无效')
  start=value.start;previous=value.previous;hashes=value.hashes
 }
 const result=await apiBaiduFileListPage(account.id,parent,order,start,1000,desc,true)
 mutationAccount(account.id,'baidu')
 const entries=result.items.map(item=>model(account,item,parent,identity==='backup_root'?'':identity)),ids=entries.map(entry=>entry.id),fsids=result.items.map(item=>baiduFileId(item.fs_id))
 if(new Set(ids).size!==ids.length||new Set(fsids).size!==fsids.length||ids.some(id=>previous.includes(id)))throw Error('百度列表重复文件标识')
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([...ids].sort()))),hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')
 mutationAccount(account.id,'baidu')
 if(ids.length&&hashes.includes(hash))throw Error('百度列表重复整页')
 return {entries,nextCursor:result.hasMore?JSON.stringify({source:account.id,parent,identity,view:'files',order,desc,start:start+1000,previous:ids,hashes:[...hashes,hash]}):undefined}
}
export async function searchBaidu(account:Account,query:string,cursor?:string){
 mutationAccount(account.id,'baidu')
 if(cursor)throw Error('百度原搜索不支持后续分页')
 if(!query.trim())return {entries:[]}
 const items=await apiBaiduSearch(account.id,query,'/',true)
 mutationAccount(account.id,'baidu')
 const entries=items.map(item=>model(account,item)),ids=entries.map(entry=>entry.id),fsids=items.map(item=>baiduFileId(item.fs_id))
 if(new Set(ids).size!==ids.length||new Set(fsids).size!==fsids.length)throw Error('百度搜索重复文件标识')
 return {entries}
}
