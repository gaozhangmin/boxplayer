import {getDrivePane} from './ports'
export default {
 async ApiDirFileListNoLock(user:string,drive:string,parent:string,_marker:string,_order:string){
  const pane=getDrivePane()
  return {items:await pane.list(user,drive,parent),next_marker:''}
 }
}
export const DebugLog={mSaveDanger(_message:string,_cause:unknown){/* Errors are displayed by the account-bound operation host; never log provider response bodies. */}}
export const copyToClipboard=(text:string)=>navigator.clipboard.writeText(text)
export const apiCloud123RenameBatch=async(user:string,ids:string[],names:string[]):Promise<Array<{file_id:string;name:string;parent_file_id:string;isDir:boolean}>>=>{
 const pane=getDrivePane()
 if(pane.local||pane.sourceId!==user||pane.account?.providerId!=='123')throw Error('123 重命名来源不匹配')
 return pane.action('renameBatch',[user,user,ids,names,'123-batch'])
}
// This original dialog only calls path.parse(...).name. Match Node's POSIX
// basename/ext rules without exposing a Node or Electron module to the WebView.
export const path={parse(value:string){const base=value.replace(/\/+$/,'').split('/').at(-1)||'';const index=base.lastIndexOf('.');return {name:index>0&&base!=='..'?base.slice(0,index):base}}}
// The original preview algorithm emits i/s highlight tags. Keep those exact
// tags while rendering names/replacement text as inert text, without attributes.
export function safeRenamePreview(value:unknown){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/&lt;(\/?[is])&gt;/g,'<$1>')}
