import type {Account,SourceEntry} from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
import {baiduFileId} from './baiduListTransport'
import {baiduFileMetadata,baiduDirectoryLocation} from './baiduMetadata'
import {listBaidu} from './baiduListing'
import {verifyBaiduAncestors} from './baiduMoveMutations'
import {apiBaiduCopy,apiBaiduDelete} from './electron/providers/baiduRename'
import {BaiduRenameRejected} from './baiduRenameTransport'
import {withBaiduBatchScope} from './baiduBatchTransport'
import {assertBaiduOperation,beginBaiduOperation,endBaiduOperation} from './baiduOperationScope'
interface File{file_id:string;parent_file_id?:string;name:string;isDir:boolean;path?:string}
type Kind='copy'|'trash'
interface Receipt{kind:Kind;owner:string;parent:string;path:string;target:string;targetPath:string;name:string;isDir:boolean;ancestors?:string[];submitted:boolean;accepted:boolean;taskId?:string;before:string[];size?:number;md5?:string;promise?:Promise<string[]>}
const pending=new Map<string,Receipt>(),identity=(account:Account)=>JSON.stringify([account.userId||'',account.deviceId||'',account.baseUrl])
export function pendingBaiduTrash(account:Account){const prefix=JSON.stringify([account.id]).slice(0,-1)+',';return [...pending].filter(([key,row])=>key.startsWith(prefix)&&row.kind==='trash'&&row.owner===identity(account)).map(([key,row])=>({file_id:JSON.parse(key)[1] as string,parent_file_id:row.parent,name:row.name,isDir:row.isDir,path:row.path}))}
export function acknowledgeBaiduTrash(account:string,id:string){const key=JSON.stringify([account,id]);if(pending.get(key)?.kind==='trash'){pending.delete(key);endBaiduOperation(account,id,'trash')}}
export const copyBaiduFile=(account:Account,file:File,target:string,current:()=>boolean,ancestors?:ReadonlyArray<string>)=>run(account,file,'copy',target,current,ancestors)
export async function trashBaiduFile(account:Account,file:File,current:()=>boolean){return (await run(account,file,'trash','',current)).includes(file.file_id)}
async function run(account:Account,file:File,kind:Kind,destination:string,stillCurrent:()=>boolean,ancestors?:ReadonlyArray<string>){
 const owner=identity(account),id=baiduFileId(file.file_id),target=['','/','root','backup_root','baidu_root'].includes(destination)?'':destination,key=JSON.stringify([account.id,id])
 const check=()=>{if(account.providerId!=='baidu'||identity(mutationAccount(account.id,'baidu'))!==owner)throw Error('百度账号身份已变化');if(!stillCurrent())throw Error('来源已关闭或切换')}
 check();assertBaiduOperation(account.id,id,kind)
 if(ancestors&&(!ancestors.length||ancestors[0]!==''||ancestors.at(-1)!==target||new Set(ancestors).size!==ancestors.length||ancestors.some(value=>typeof value!=='string')))throw Error('百度目标目录祖先上下文无效')
 let receipt=pending.get(key)
 if(receipt&&(receipt.kind!==kind||receipt.owner!==owner||receipt.target!==target||receipt.name!==file.name||receipt.isDir!==file.isDir||file.path!==undefined&&file.path!==receipt.path||JSON.stringify(receipt.ancestors)!==JSON.stringify(ancestors)))throw Error('百度此前文件操作尚未确认，请重试原操作与目标')
 if(receipt?.promise)return receipt.promise
 if(!receipt){if(pending.size>=128)throw Error('百度待确认文件操作过多');receipt={kind,owner,parent:'',path:file.path||'',target,targetPath:'',name:file.name,isDir:file.isDir,ancestors:ancestors?[...ancestors]:undefined,submitted:false,accepted:false,before:[]};pending.set(key,receipt);beginBaiduOperation(account.id,id,kind)}
 const entry=receipt
 const directory=async(parent:string)=>{
  const rows:SourceEntry[]=[],ids=new Set<string>();let cursor:string|undefined
  do{check();const page=await listBaidu(account,parent,cursor);check();for(const row of page.entries){if(ids.has(row.id))throw Error('百度操作确认目录存在重复文件');ids.add(row.id);rows.push(row)}if(rows.length>100000)throw Error('百度操作确认目录过大');cursor=page.nextCursor}while(cursor)
  return rows
 }
 const verifyTarget=async()=>{const actual=await baiduDirectoryLocation(account,target);check();if(actual!==entry.targetPath)throw Error('百度目标目录位置已变化');await verifyBaiduAncestors(account,actual,entry.ancestors,check);check()}
 const work=(async()=>{
  if(!entry.submitted){
   const before=await baiduFileMetadata(account,id);check()
   if(before.isdir!==(entry.isDir?1:0)||before.filename!==entry.name||file.path!==undefined&&before.path!==file.path)throw Error('百度原文件详情已变化，请刷新确认')
   entry.path=before.path!;entry.parent=entry.path.slice(0,entry.path.lastIndexOf('/'))||'/'
   const listed=(await directory(entry.parent)).find(row=>row.id===id)
   if(!listed||listed.name!==entry.name||listed.isDirectory!==entry.isDir)throw Error('百度原文件目录信息已变化')
   entry.size=listed.size;entry.md5=typeof before.md5==='string'?before.md5:undefined
   if(kind==='copy'){
    entry.targetPath=await baiduDirectoryLocation(account,target);check();await verifyTarget()
    if(entry.parent===entry.targetPath||entry.isDir&&(entry.targetPath===entry.path||entry.targetPath.startsWith(entry.path+'/')))throw Error('不能复制到原位置、自己或子目录')
    const rows=await directory(entry.targetPath);if(rows.some(row=>row.name===entry.name))throw Error('百度目标存在同名项目，请处理冲突后重试');entry.before=rows.map(row=>row.id)
   }
   await withBaiduBatchScope({account,operation:kind==='copy'?'copy':'delete',path:entry.path,...(kind==='copy'?{target:entry.targetPath}:{}),check,onSubmit:()=>{entry.submitted=true},onReceipt:taskId=>{entry.accepted=true;entry.taskId=taskId}},user=>kind==='copy'?apiBaiduCopy(user,[entry.path],entry.targetPath):apiBaiduDelete(user,[entry.path]))
  }
  check();if(kind==='copy')await verifyTarget()
  const source=(await directory(entry.parent)).find(row=>row.id===id)
  let confirmed=entry.accepted
  if(kind==='copy'){
   const candidates=(await directory(entry.targetPath)).filter(row=>!entry.before.includes(row.id)&&row.id!==id&&row.name===entry.name&&row.isDirectory===entry.isDir)
   confirmed=confirmed&&!!source&&source.name===entry.name&&source.isDirectory===entry.isDir&&candidates.length===1&&(entry.isDir||source.size===entry.size&&candidates[0]!.size===entry.size)
   if(confirmed){
    const copied=await baiduFileMetadata(account,candidates[0]!.id);check()
    confirmed=copied.path===(entry.targetPath==='/'?'':entry.targetPath)+'/'+entry.name&&copied.filename===entry.name&&copied.isdir===(entry.isDir?1:0)&&(!entry.md5||copied.md5===entry.md5)
   }
  }else confirmed=confirmed&&!source
  if(!confirmed)throw Error(`百度${kind==='copy'?'复制':'移入回收站'}尚未确认；重试只查询目录，不会重复提交`)
  check();if(kind==='copy'){pending.delete(key);endBaiduOperation(account.id,id,kind)}return [id]
 })()
 entry.promise=work
 try{return await work}catch(cause){if(!entry.submitted||cause instanceof BaiduRenameRejected){pending.delete(key);endBaiduOperation(account.id,id,kind)};throw cause}finally{if(entry.promise===work)entry.promise=undefined}
}
