import {watchEffect} from 'vue'
import type {Account} from '@/features/sources/contracts'
import {nativeCall} from '@/platform/native'
import {getDrivePane} from './ports'
import {checkTextCreation,onTextCreationCancel} from './textCreationScope'
interface CreatedText {schemaVersion:number;accountId:string;driveId:string;parentId:string;fileId:string;name:string;size:number}
export async function createAliText(account:Account,parent:string,name:string,content:string){
 const pane=getDrivePane(),context=pane.context,owner=JSON.stringify(account)
 const check=()=>{if(account.providerId!=='aliyun'||getDrivePane()!==pane||pane.context!==context||pane.sourceId!==account.id||JSON.stringify(checkTextCreation(account.id,'aliyun'))!==owner)throw Error('文本创建窗口已关闭、来源或账号已变化')}
 check();const directory=pane.file?.(parent)||(pane.tree.selectDir.file_id===parent?pane.tree.selectDir:undefined)
 if(!directory?.isDir)throw Error('请选择已读取的资源盘、备份盘或盘内文件夹')
 let target:{driveId:string;fileId:string};try{target=JSON.parse(parent)}catch{throw Error('请选择实际网盘位置')}
 if(!target||typeof target.driveId!=='string'||!target.driveId||typeof target.fileId!=='string'||!target.fileId)throw Error('阿里文本目标位置无效')
 const requestId=crypto.randomUUID();let settled=false,cancelled=false
 const cancel=()=>{if(!settled&&!cancelled){cancelled=true;void nativeCall('ali_text_cancel',{requestId,accountId:account.id}).catch(()=>{})}}
 const unregister=onTextCreationCancel(account.id,cancel)
 const stop=watchEffect(()=>{try{check()}catch{cancel()}},{flush:'sync'})
 try{
  check();if(cancelled)throw Error('文本创建已取消')
  const result=await nativeCall<CreatedText>('ali_text_create',{request:{requestId,account:{...account,authOrigins:[...account.authOrigins]},driveId:target.driveId,parentId:target.fileId,name,content}})
  settled=true;check()
  if(!result||result.schemaVersion!==1||result.accountId!==account.id||result.driveId!==target.driveId||result.parentId!==target.fileId||result.name!==name||result.size!==new TextEncoder().encode(content).length||typeof result.fileId!=='string'||!result.fileId||result.fileId===target.fileId||/[\u0000-\u001f/\\]/.test(result.fileId))throw Error('阿里文本创建回执身份或长度未确认，请刷新目标确认')
  return 'success'
 }finally{settled=true;stop();unregister()}
}
