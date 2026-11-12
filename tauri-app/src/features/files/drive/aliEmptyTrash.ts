import type {Account} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import {trashPage,mutateTrash,type TrashEntry} from './trashMutations'
// Electron clears the first page repeatedly. Do not delete while walking a live
// provider cursor; a changed recycle bin can invalidate that cursor.
export async function emptyAliTrash(account:Account,current:()=>boolean,remember:(row:TrashEntry)=>IAliGetFileModel){
 if(account.providerId!=='aliyun')throw Error('清空回收站来源不匹配')
 const success:string[]=[],seen=new Set<string>()
 const check=()=>{if(!current())throw Error('来源已切换，停止清空回收站')}
 try{
  for(let iteration=0;iteration<10000;iteration++){
   check();let cursor:string|undefined;const cursors=new Set<string>();let found:TrashEntry[]=[]
   do{
    const page=await trashPage(account,cursor);check()
    if(page.entries.length){found=page.entries;break}
    cursor=page.nextCursor;if(cursor){if(cursors.has(cursor))throw Error('回收站分页游标重复');cursors.add(cursor)}
   }while(cursor)
   if(!found.length)return {success,failures:[] as string[]}
   if(found.some(row=>seen.has(row.id)))throw Error('提供商仍返回已确认删除的项目，请刷新确认，停止重复删除')
   const files=found.map(remember);check()
   const result=await mutateTrash(account,files,'purge',current)
   for(const id of result.success){seen.add(id);success.push(id)}
   if(result.failures.length||result.success.length!==files.length)return {success,failures:result.failures.length?result.failures:['部分回收站项目尚未确认删除']}
  }
  throw Error('回收站仍有项目，已停止本轮清空，请刷新后继续')
 }catch(error){return {success,failures:[error instanceof Error?error.message:'清空回收站失败']}}
}
