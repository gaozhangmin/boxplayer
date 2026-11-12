import {CheckFileName} from './creationPorts'
export interface FolderCreationResult {name:string;id?:string;error?:string}
export function parseFolderNames(value:string):string[]{
 const names=value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean)
 if(!names.length)throw Error('请至少输入一个文件夹名')
 const seen=new Set<string>()
 for(const name of names){if(name.length>100)throw Error('文件夹名太长(100)');const error=CheckFileName(name);if(error)throw Error(`${name}：${error}`);if(seen.has(name))throw Error(`文件夹名重复：${name}`);seen.add(name)}
 return names
}
export async function createFolderBatch(names:string[],create:(name:string)=>Promise<{file_id?:string;error?:string}>,completed:Map<string,string>,signal?:AbortSignal):Promise<FolderCreationResult[]>{
 const results:FolderCreationResult[]=[]
 for(const name of names){
  if(signal?.aborted)break
  const id=completed.get(name)
  if(id){results.push({name,id});continue}
  try{
   const result=await create(name)
   if(result.error||typeof result.file_id!=='string'||!result.file_id)throw Error(result.error||'未返回文件夹标识，请刷新确认')
   completed.set(name,result.file_id);results.push({name,id:result.file_id})
  }catch(error){results.push({name,error:error instanceof Error?error.message:'创建失败'})}
 }
 return results
}
