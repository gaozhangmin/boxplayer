import type {Account} from '@/features/sources/contracts'
import {apiDrive115Search,mapDrive115SearchToAliModel} from './electron/providers/drive115Search'
import {drive115Check} from './drive115FileTransport'
export async function searchDrive115(account:Account,query:string,cursor?:string){
 if(account.providerId!=='115'||!query.trim())throw Error('115 搜索来源或关键字无效');drive115Check(account.id)
 const word=query.trim();let offset=0
 if(cursor){let value:any;try{value=JSON.parse(cursor)}catch{throw Error('115 搜索游标无效')};if(value?.source!==account.id||value.query!==word||!Number.isSafeInteger(value.offset)||value.offset<0)throw Error('115 搜索游标范围不匹配');offset=value.offset}
 const page=await apiDrive115Search(account.id,word,200,offset)
 return {entries:page.items.map(item=>{const electronModel=mapDrive115SearchToAliModel(item,account.id);return {id:electronModel.file_id,name:electronModel.name,isDirectory:electronModel.isDir,size:electronModel.size,playable:!electronModel.isDir&&['video','video2'].includes(electronModel.category),originalParent:electronModel.parent_file_id,modified:electronModel.time,electronModel}}),nextCursor:offset+page.items.length<page.total?JSON.stringify({source:account.id,query:word,offset:offset+page.items.length}):undefined}
}
