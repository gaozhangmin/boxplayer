import {h} from 'vue'
import IconFont from '../electron/IconFont.vue'
import {getDrivePane,PanDAL as browserDAL} from './ports'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
export interface TreeNodeData {__v_skip:true;key:string;drive_id?:string;parent_file_id?:string;path?:string;title:string;namesearch?:string;description?:string;children:TreeNodeData[];icon?:any;isLeaf?:boolean;isDir?:boolean}
import {directoryRootKeys as roots,remoteDirectoryPath} from './directoryRoots'
export const Sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))
export const fileiconfn=(name:string)=>h(IconFont,{name})
export function createDirectoryPickerPorts(filter:(row:IAliGetFileModel)=>boolean){
 const pane=getDrivePane(),sourceId=pane.sourceId
 const rootKey=(pane.account?roots[pane.account.providerId]:undefined)||'backup_root'
 const rootTitle=pane.tree.selectDirPath[0]?.name||pane.account?.name||pane.tree.selectDir.name||'文件'
 const cache=new Map<string,TreeNodeData[]>(),rows=new Map<string,IAliGetFileModel>()
 let disposed=false
 function assertBound(user=sourceId,drive=sourceId){if(disposed||getDrivePane()!==pane||pane.sourceId!==sourceId||user!==sourceId||drive!==sourceId)throw Error('目录选择器来源已切换')}
 function location(key:string){return key===rootKey?'':pane.account?remoteDirectoryPath(pane.account.providerId,key):['root','backup_root'].includes(key)?'':key}
 const root=()=>({__v_skip:true as const,key:rootKey,title:rootTitle,drive_id:sourceId,parent_file_id:'',isDir:true,isLeaf:false,children:cache.get(rootKey)||[],icon:()=>fileiconfn('iconfile-folder')})
 async function read(user:string,drive:string,key:string){
  assertBound(user,drive)
  const result=await pane.list(user,drive,location(key));assertBound(user,drive)
  const seen=new Set<string>()
  for(const row of result){if(!row.file_id||seen.has(row.file_id)||row.file_id===key||row.file_id===rootKey)throw Error('目录列表包含重复或循环标识');seen.add(row.file_id)}
  const children=result.filter(filter).map(row=>{rows.set(row.file_id,row);return {__v_skip:true as const,key:row.file_id,title:row.name,drive_id:drive,parent_file_id:key,path:'',description:row.description,isDir:row.isDir,isLeaf:!row.isDir,children:cache.get(row.file_id)||[],icon:()=>fileiconfn(row.isDir?'iconfile-folder':row.icon)}})
  cache.set(key,children);return {items:result,children}
 }
 const GetDriveType=(_user:string,_drive:string)=>({key:rootKey,title:rootTitle,name:'backup'})
 const GetDriveID=(user:string,_key:string)=>{assertBound(user);return sourceId}
 const TreeStore={GetDirPath(drive:string,key:string){
  assertBound(sourceId,drive)
  const rootRow={...pane.tree.selectDirPath[0]!,file_id:rootKey,drive_id:sourceId,name:rootTitle,parent_file_id:'',path:''}
  const path:IAliGetFileModel[]=[];const seen=new Set<string>();let current=location(key)===''?rootKey:key
  while(current&&current!==rootKey){
   if(seen.has(current))return [];seen.add(current)
   const row=rows.get(current)||pane.file?.(current)
   if(!row?.isDir)return []
   path.unshift(row);current=location(row.parent_file_id)===''?rootKey:row.parent_file_id
  }
  return [rootRow,...path]
 }}
 const PanDAL={
  ...browserDAL,
  GetPanTreeAllNode(user:string,drive:string,_expanded:string[],_folders?:boolean,_files?:boolean){assertBound(user,drive);return [root()]},
  async GetDirFileList(user:string,drive:string,key:string,..._args:unknown[]){return read(user,drive,key)}
 }
 return {TreeStore,PanDAL,GetDriveType,GetDriveID,isSingleRootDriveUser:(_user:string)=>true,
  tree:{...pane.tree,backup_drive_id:sourceId,resource_drive_id:''},
  async prepare(selected=''){
   await read(sourceId,sourceId,rootKey)
   const path=TreeStore.GetDirPath(sourceId,selected)
   for(const row of path.slice(1))await read(sourceId,sourceId,row.file_id)
   // Attach the already loaded breadcrumb chain to the synchronous original tree cache.
   for(const children of cache.values())for(const child of children)child.children=cache.get(child.key)||[]
  },
  async load(key:string){return (await read(sourceId,sourceId,key)).children},
  isCurrentDirectory(key:string){return location(key)===(pane.tree.selectDir.path||'')},
  dispose(){disposed=true;cache.clear();rows.clear()}
 }
}
