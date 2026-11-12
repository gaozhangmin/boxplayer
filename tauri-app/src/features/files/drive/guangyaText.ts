import {watchEffect} from 'vue'
import type {Account} from '@/features/sources/contracts'
import {nativeCall} from '@/platform/native'
import {checkTextCreation,onTextCreationCancel} from './textCreationScope'
import {guangyaId} from './guangyaFileTransport'
import {apiGuangyaFileDetail,getGuangyaFileId,getGuangyaFileName,isGuangyaDir,guangyaApiParentId} from './electron/providers/guangyaMetadata'
import {apiGuangyaUploadBuffer} from './electron/providers/guangyaTextFlow'
export async function createGuangyaText(account:Account,parent:string,name:string,content:string){
 const check=()=>checkTextCreation(account.id,'guangya')
 check();parent=guangyaApiParentId(['root','backup_root'].includes(parent)?'':parent);guangyaId(parent,true)
 if(parent){const target=await apiGuangyaFileDetail(account.id,parent);check();if(!target||getGuangyaFileId(target)!==parent||!isGuangyaDir(target))throw Error('光鸭目标不是已确认的文件夹')}
 const bytes=new TextEncoder().encode(content)
 const begun=await nativeCall<{handle:string;md5:string}>('guangya_text_begin',{request:{account:{...account,authOrigins:[...account.authOrigins]},parent,name,content}})
 let closed=false
 const close=()=>{if(!closed&&begun?.handle){closed=true;void nativeCall('guangya_text_close',{handle:begun.handle}).catch(()=>{})}}
 let unregister=()=>{},stop=()=>{}
 try{
  check();if(!begun||typeof begun.handle!=='string'||!begun.handle||typeof begun.md5!=='string'||!begun.md5)throw Error('光鸭文本创建上下文无效')
  unregister=onTextCreationCancel(account.id,close)
  stop=watchEffect(()=>{try{check()}catch{close()}},{flush:'sync'})
  const step=async<T>(action:string)=>{check();if(closed)throw Error('文本创建已取消');const result=await nativeCall<T>('guangya_text_step',{handle:begun.handle,action});check();return result}
  let task=''
  const result=await apiGuangyaUploadBuffer(account.id,parent,name,bytes,{
   md5:async()=>{check();return begun.md5},
   token:async()=>{const result=await step<{data?:{taskId:string};error:string}>('token');task=result.data?.taskId??'';return result},
   info:async id=>{if(id!==task||!task)throw Error('文本上传任务不匹配');return step<{fileId:string;uploading:boolean;error:string}>('info')},
   put:async id=>{if(id!==task||!task)throw Error('文本上传任务不匹配');return step<string>('put')},
   sleep:async ms=>{await new Promise(resolve=>setTimeout(resolve,ms));check()}
  })
  check();if(result.error||!result.file_id)throw Error(result.error||'光鸭未确认文本创建，请刷新目标确认');guangyaId(result.file_id)
  const detail=await apiGuangyaFileDetail(account.id,result.file_id);check()
  const actualParent=detail?.parentId??detail?.parentFileId??detail?.parent_file_id
  const size=detail?.fileSize??detail?.size??detail?.file_size??detail?.resSize??detail?.res?.fileSize
  if(!detail||getGuangyaFileId(detail)!==result.file_id||getGuangyaFileName(detail)!==name||isGuangyaDir(detail)||actualParent===undefined||guangyaApiParentId(guangyaId(actualParent,true))!==parent||!/^\d+$/.test(String(size))||Number(size)!==bytes.length)throw Error('光鸭已创建文本的名称、目录或长度未确认，请刷新目标确认')
  return 'success'
 }finally{stop();unregister();close()}
}
