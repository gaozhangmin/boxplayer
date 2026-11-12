import {getDrivePane} from './ports'
/** Bind an original multi-step tool to the pane that accepted its confirmation. */
export function captureDriveToolPort(){
 const pane=getDrivePane(),source=pane.sourceId,context=pane.context,identity=JSON.stringify(pane.account)
 function check(){
  let current;try{current=getDrivePane()}catch{throw Error('整理窗口已关闭或来源已切换')}
  if(current!==pane||pane.sourceId!==source||pane.context!==context||JSON.stringify(pane.account)!==identity)throw Error('整理窗口已关闭、来源或账号已变化')
 }
 function owner(user:string,drive:string){check();if(user!==source||drive!==source)throw Error('整理来源账号不匹配')}
 async function move(user:string,drive:string,ids:string[],toDrive:string,parent:string){owner(user,drive);if(toDrive!==source)throw Error('整理目标来源不匹配');const result=await pane.action('moveBatch',[user,drive,ids,toDrive,parent]);check();return result as string[]}
 async function create(user:string,drive:string,parent:string,name:string,...options:unknown[]){
  owner(user,drive)
  try{const result=await pane.action('createFolderDirect',[user,drive,parent,name,...options]);check();return result as {file_id?:string;error?:string}}
  catch(error){check();return {file_id:'',error:error instanceof Error?error.message:String(error)}}
 }
 return {check,commands:{ApiMoveBatch:move,ApiCreatNewForder:create},async list(user:string,drive:string,parent:string){owner(user,drive);const rows=await pane.list(user,drive,parent,check);check();return rows}}
}
