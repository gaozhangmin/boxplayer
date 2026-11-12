import {getDrivePane,PanDAL as browserDAL} from './ports'
const nativePath=(key:string)=>['root','backup_root','box_root','google_root'].includes(key)?'':key
export const isDriveRoot=(key:string)=>nativePath(key)===''
export const GetDriveID=(user:string,_key:string)=>{const pane=getDrivePane();if(user!==pane.sourceId)throw Error('文件操作来源不匹配');return pane.sourceId}
export const TreeStore={ClearDirSize(_drive:string,_ids:string[]){/* The source browser reads sizes from each fresh listing; it has no legacy global directory-size cache. */}}
export const PanDAL={...browserDAL,
 GetPanSelectedData(istree:boolean){
  const pane=getDrivePane(),user=pane.sourceId,context=pane.context,files=istree?[pane.tree.selectDir]:pane.store.GetSelected()
  return {fileDescription:files.length===1?files[0]?.description||'':'',parentDirDescription:pane.tree.selectDir.description||'',user_id:user,drive_id:user,dirID:pane.store.DirID,albumId:'',selectedKeys:files.map(file=>file.file_id),parentDirID:pane.tree.selectDir.parent_file_id||'',isError:!user||!pane.tree.selectDir.file_id,isErrorSelected:!files.length,selectedParentKeys:[...new Set(files.map(file=>file.parent_file_id))],isCurrent(){try{return getDrivePane()===pane&&pane.sourceId===user&&pane.context===context}catch{return false}}}
 },
 async aReLoadOneDirToRefreshTree(user:string,drive:string,path:string,..._args:unknown[]){return getDrivePane().list(user,drive,nativePath(path))}
}
