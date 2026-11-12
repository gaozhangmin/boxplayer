import {dropboxRpc} from './providerTransport'
import {getDrivePane} from './ports'
import {dropboxPathIdentity} from './dropboxRenamePorts'
let receipt:{id:string;name:string}|undefined
export const dropboxRelocationReceipt=(id:string)=>receipt?.id===id?receipt:undefined
export async function resolveDropboxCommandName(user:string,id:string){const pane=getDrivePane();if(pane.sourceId!==user)throw Error('来源已切换');const file=pane.file?.(id);if(!file?.name)throw Error('文件不在当前来源记录中');return file.name}
export async function completeDropboxBatch(user:string,launch:string,poll:string,body:any,check?:()=>void){
 const pane=getDrivePane(),epoch=pane.context
 const current=()=>{check?.();if(getDrivePane()!==pane||pane.sourceId!==user||pane.context!==epoch)throw Error('来源已关闭或切换')}
 current()
 receipt=undefined
 const allowed:Record<string,string>={'/files/move_batch_v2':'/files/move_batch/check_v2','/files/copy_batch_v2':'/files/copy_batch/check_v2','/files/delete_batch':'/files/delete_batch/check'}
 if(allowed[launch]!==poll||!Array.isArray(body?.entries)||!body.entries.length||body.entries.length>1000)throw Error('Dropbox 批量操作参数无效')
 const originals=body.entries.map((entry:any)=>{const identity=dropboxPathIdentity(entry.from_path||entry.path||'');if(!identity)throw Error('Dropbox 缺少已确认的源文件位置');return identity})
 const call=async(path:string,value:unknown)=>{current();const result=await dropboxRpc<any>(user,path,value,'Dropbox 批量操作');current();if(result.error)throw Error(result.error);return result.data}
 let result=await call(launch,body)
 if(result?.['.tag']==='async_job_id'){
  const job=result.async_job_id;if(typeof job!=='string'||!job)throw Error('Dropbox 缺少批量任务标识')
  for(let attempt=0;attempt<60;attempt++){
   result=await call(poll,{async_job_id:job});if(result?.['.tag']!=='in_progress')break
   if(attempt===59)throw Error('Dropbox 批量任务仍在处理，请刷新确认，勿重复提交')
   await new Promise(resolve=>setTimeout(resolve,1000));current()
  }
 }
 if(result?.['.tag']!=='complete'||!Array.isArray(result.entries)||result.entries.length!==body.entries.length)throw Error('Dropbox 批量操作未取得完整完成回执')
 // Official v2 responses preserve request order. Normalize only verified successes;
 // ambiguous entries remain failures so original index mapping cannot remove them.
 result.entries=result.entries.map((entry:any,index:number)=>{
  if(entry?.['.tag']!=='success')return {'.tag':'failure'}
  const deleting=launch==='/files/delete_batch',metadata=deleting?entry.metadata:entry.success,input=body.entries[index]
  const path=metadata?.path_display||metadata?.path_lower,expected=deleting?input.path:input.to_path
  if(!metadata||typeof path!=='string'||typeof expected!=='string'||!['file','folder',...(deleting?['deleted']:[])].includes(metadata['.tag']))return {'.tag':'failure'}
  const parent=(value:string)=>value.slice(0,value.lastIndexOf('/')).toLowerCase()
  if(deleting?path.toLowerCase()!==expected.toLowerCase():parent(path)!==parent(expected)||!metadata.name||metadata.name!==path.split('/').at(-1))return {'.tag':'failure'}
  if(!deleting&&(typeof metadata.id!=='string'||!metadata.id))return {'.tag':'failure'}
  const original=originals[index]
  if(deleting?metadata.id&&metadata.id!==original.id:metadata['.tag']!==original.tag||(launch==='/files/move_batch_v2'?metadata.id!==original.id:metadata.id===original.id))return {'.tag':'failure'}
  if(!deleting)receipt={id:original.id,name:metadata.name}
  return entry
 })
 return result
}
