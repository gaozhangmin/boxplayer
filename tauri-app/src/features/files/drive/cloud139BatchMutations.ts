import type {Account} from '@/features/sources/contracts'
import {cloud139Guard,cloud139Directory} from './cloud139FileMutations'
import {cloud139Id,withCloud139MutationScope} from './cloud139FileTransport'
import {Cloud139RequestRejected} from '@/features/sources/cloud139Errors'
import {apiCloud139CopyBatch,apiCloud139TrashBatch} from './electron/providers/cloud139FileCmd'
import {assertCloud139Operation,beginCloud139Operation,endCloud139Operation} from './cloud139OperationScope'
interface File{file_id:string;parent_file_id:string;name:string;isDir:boolean}
type Kind='copy'|'trash'
interface Receipt{kind:Kind;owner:string;parent:string;target:string;name:string;isDir:boolean;ancestors:string[];submitted:boolean;accepted:boolean;before:string[];size?:number;promise?:Promise<string[]>}
const pending=new Map<string,Receipt>()
export function pendingCloud139Trash(account:Account){const prefix=JSON.stringify([account.id]).slice(0,-1)+',';return [...pending].filter(([key,row])=>key.startsWith(prefix)&&row.kind==='trash').map(([key,row])=>({file_id:JSON.parse(key)[1] as string,parent_file_id:row.parent,name:row.name,isDir:row.isDir}))}
export function acknowledgeCloud139Trash(account:string,id:string){const key=JSON.stringify([account,id]);if(pending.get(key)?.kind==='trash'){pending.delete(key);endCloud139Operation(account,id,'trash')}}
export const copyCloud139File=(account:Account,file:File,target:string,current:()=>boolean,ancestors?:ReadonlyArray<string>)=>run(account,file,'copy',target,current,ancestors)
export async function trashCloud139File(account:Account,file:File,current:()=>boolean){return (await run(account,file,'trash','',current)).includes(file.file_id)}
async function run(account:Account,file:File,kind:Kind,destination:string,stillCurrent:()=>boolean,ancestors?:ReadonlyArray<string>){
 const check=cloud139Guard(account,stillCurrent);check()
 const id=cloud139Id(file.file_id),parent=cloud139Id(file.parent_file_id,true),target=kind==='copy'?cloud139Id(destination,true):'',owner=JSON.stringify([account.userId||'',account.deviceId||'',account.baseUrl]),key=JSON.stringify([account.id,id])
 assertCloud139Operation(account.id,id,kind)
 const path=kind==='copy'?(ancestors?[...ancestors]:target==='/'?['']:undefined):[]
 if(kind==='copy'&&(target===parent||target===id))throw Error('139 不能复制到原位置或自身')
 if(!path||kind==='copy'&&(!path.length||path[0]!==''||cloud139Id(path.at(-1),true)!==target||new Set(path).size!==path.length||file.isDir&&path.includes(id)))throw Error('139 目标目录路径无效或位于源文件夹内部')
 let receipt=pending.get(key)
 if(receipt&&(receipt.kind!==kind||receipt.owner!==owner||receipt.parent!==parent||receipt.target!==target||receipt.name!==file.name||receipt.isDir!==file.isDir||JSON.stringify(receipt.ancestors)!==JSON.stringify(path)))throw Error('139 此前文件操作尚未确认，请重试原操作与目标')
 if(receipt?.promise)return receipt.promise
 if(!receipt){if(pending.size>=128)throw Error('139 待确认文件操作过多');receipt={kind,owner,parent,target,name:file.name,isDir:file.isDir,ancestors:path,submitted:false,accepted:false,before:[]};pending.set(key,receipt);beginCloud139Operation(account.id,id,kind)}
 const entry=receipt,directory=(location:string)=>cloud139Directory(account,location,check)
 const verifyPath=async()=>{
  let previous='/'
  for(const ancestor of entry.ancestors.slice(1)){
   if(cloud139Id(ancestor,true)==='/')throw Error('139 目标目录层级无效')
   const actual=(await directory(previous)).find(row=>row.id===ancestor)
   if(!actual?.isDirectory)throw Error('139 目标目录层级已变化，请重新加载目录选择器')
   previous=ancestor
  }
 }
 const work=(async()=>{
  if(!entry.submitted){
   const before=(await directory(parent)).find(row=>row.id===id)
   if(!before||before.name!==entry.name||before.isDirectory!==entry.isDir)throw Error('139 原文件详情已变化，请刷新确认')
   if(kind==='copy'){
    await verifyPath();const targetRows=await directory(target)
    if(targetRows.some(row=>row.name===entry.name))throw Error('139 目标存在同名项目，请处理冲突后重试')
    entry.before=targetRows.map(row=>row.id);entry.size=before.size
   }
   const endpoint=kind==='copy'?'/file/batchCopy':'/recyclebin/batchTrash',body=kind==='copy'?{fileIds:[id],parentFileId:target}:{fileIds:[id]}
   const result=await withCloud139MutationScope({account,endpoint,body,check,onSubmit:()=>{entry.submitted=true},onAccepted:()=>{entry.accepted=true}},user=>kind==='copy'?apiCloud139CopyBatch(user,[id],target):apiCloud139TrashBatch(user,[id]))
   entry.accepted=entry.accepted||result.includes(id)
  }
  if(kind==='copy')await verifyPath()
  const source=(await directory(parent)).find(row=>row.id===id)
  let confirmed=entry.accepted
  if(kind==='copy'){
   const candidates=(await directory(target)).filter(row=>!entry.before.includes(row.id)&&row.id!==id&&row.name===entry.name&&row.isDirectory===entry.isDir)
   confirmed=confirmed&&!!source&&source.name===entry.name&&source.isDirectory===entry.isDir&&candidates.length===1&&(entry.isDir||source.size===entry.size&&candidates[0]!.size===entry.size)
  }else confirmed=confirmed&&!source
  if(!confirmed)throw Error(`139 ${kind==='copy'?'复制':'移入回收站'}尚未确认；重试只查询目录，不会重复提交`)
  check();if(kind==='copy'){pending.delete(key);endCloud139Operation(account.id,id,kind)}
  return [id]
 })()
 entry.promise=work
 try{return await work}catch(cause){if(!entry.submitted||cause instanceof Cloud139RequestRejected){pending.delete(key);endCloud139Operation(account.id,id,kind)};throw cause}finally{if(entry.promise===work)entry.promise=undefined}
}
