import type {Account,SourceEntry} from '@/features/sources/contracts'
import {cloud189} from '@/features/sources/cloud189'
export async function cloud189Directory(account:Account,parent:string,check:()=>void){
 let cursor:string|undefined,count=0;const rows:SourceEntry[]=[]
 do{
  check();const page=await cloud189.list(account,parent,cursor);check()
  rows.push(...page.entries);count+=page.entries.length
  if(count>100000)throw Error('天翼操作确认目录过大')
  cursor=page.nextCursor
 }while(cursor)
 return rows
}
export async function verifyCloud189Path(account:Account,ancestors:ReadonlyArray<string>,check:()=>void){
 let previous=''
 for(const ancestor of ancestors.slice(1)){
  const row=(await cloud189Directory(account,previous,check)).find(value=>value.id===ancestor)
  if(!row?.isDirectory)throw Error('天翼目标目录层级已变化，请重新加载目录选择器')
  previous=ancestor
 }
}
