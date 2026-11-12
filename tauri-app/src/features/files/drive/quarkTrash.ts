import {quarkEntry} from './quarkListing'
import type {Account} from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
import {quarkId} from './quarkFileTransport'
import {apiQuarkTrashList} from './electron/providers/quarkMetadata'

export async function quarkTrashPage(account:Account,cursor?:string){
 mutationAccount(account.id,'quark')
 let page=1,previous:string[]=[]
 if(cursor){
  let value:any;try{value=JSON.parse(cursor)}catch{throw Error('夸克回收站游标无效')}
  if(value?.account!==account.id||value.view!=='trash'||!Number.isSafeInteger(value.page)||value.page<2||!Array.isArray(value.previous)||value.previous.length!==100||value.previous.some((id:unknown)=>typeof id!=='string'||!id)||new Set(value.previous).size!==100)throw Error('夸克回收站游标范围无效')
  page=value.page;previous=value.previous
 }
 const result=await apiQuarkTrashList(account.id,100,page,true)
 mutationAccount(account.id,'quark')
 const ids=result.items.map(item=>quarkId(item.fid))
 if(new Set(ids).size!==ids.length||ids.some(id=>previous.includes(id)))throw Error('夸克回收站重复文件标识')
 if(!Number.isSafeInteger(result.total)||result.total<0||result.total<(page-1)*100+ids.length||ids.length<100&&result.total>(page-1)*100+ids.length)throw Error('夸克回收站分页总数无效')
 const entries=result.items.map(item=>quarkEntry(account,item,'0'))
 return {entries,nextCursor:page*100<result.total?JSON.stringify({account:account.id,view:'trash',page:page+1,previous:ids}):undefined}
}
