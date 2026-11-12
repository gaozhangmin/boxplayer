/** Completed-upload presentation only. Record persistence and execution are owned by M6. */
import {inject,provide,type InjectionKey} from 'vue'
import type useUploadedStore from './electron/down/UploadedStore'
import type {IStateUploadTask} from './electron/down/uploadTaskModels'
import {message} from './ports'
import {createTaskKeyboard,createTaskMouse} from './taskPorts'
export type {KeyboardState,MouseState} from './ports'
export interface UploadedTaskController {
 read():Promise<{rows:IStateUploadTask[];count:number}>
 clear(ids:number[],all:boolean):Promise<boolean>
 open(taskId:number,target:'pan'|'file'|'dir'):Promise<boolean>
}
export interface UploadedTaskPane {store:ReturnType<typeof useUploadedStore>;height:number;controller?:UploadedTaskController;check():void;keyboard:ReturnType<typeof createTaskKeyboard>;mouse:ReturnType<typeof createTaskMouse>}
const key:InjectionKey<UploadedTaskPane>=Symbol('uploaded-task-pane')
export const provideUploadedTaskPane=(pane:UploadedTaskPane)=>provide(key,pane)
export function useUploadedTaskPane(){const pane=inject(key);if(!pane)throw Error('已上传页面已关闭');return pane}
export const useKeyboardStore=()=>useUploadedTaskPane().keyboard
export const useMouseStore=()=>useUploadedTaskPane().mouse
export const useAppStore=()=>({appTab:'down',GetAppTabMenu:'UploadedRight'})
export const useWinStore=()=>{const pane=useUploadedTaskPane();return {get GetListHeight(){return `${pane.height}px`},get GetListHeightNumber(){return pane.height}}}
export const useOriginalUploadedStore=()=>useUploadedTaskPane().store
const controllers=new WeakMap<UploadedTaskPane,ReturnType<typeof makeUploadedDAL>>()
export function createUploadedDAL(pane:UploadedTaskPane){let value=controllers.get(pane);if(!value){value=makeUploadedDAL(pane);controllers.set(pane,value)}return value}
function makeUploadedDAL(pane:UploadedTaskPane){
 let generation=0,busy=false
 function report(error:unknown){try{pane.check();message.error(error instanceof Error?error.message:'读取已上传任务失败')}catch{}}
 async function read(){const current=++generation
  try{pane.check();pane.store.ListLoading=true
   const snapshot=pane.controller?await pane.controller.read():{rows:[],count:0};pane.check();if(current!==generation)return
   if(!Array.isArray(snapshot.rows)||!Number.isSafeInteger(snapshot.count)||snapshot.count<snapshot.rows.length)throw Error('已上传任务列表响应无效')
   const ids=new Set<number>()
   for(const row of snapshot.rows){if(!Number.isSafeInteger(row.TaskID)||row.TaskID<=0||ids.has(row.TaskID)||typeof row.TaskName!=='string'||typeof row.localFilePath!=='string'||!Number.isFinite(row.ChildTotalSize)||row.ChildTotalSize<0)throw Error('已上传任务条目标识或大小无效');ids.add(row.TaskID)}
   pane.store.aLoadListData(snapshot.rows,snapshot.count)
  }catch(error){if(current===generation)report(error)}
  finally{try{pane.check();if(current===generation)pane.store.ListLoading=false}catch{}}
 }
 async function control(action:(controller:UploadedTaskController)=>Promise<boolean>,refresh:boolean){
  if(busy)return false;busy=true
  try{pane.check();if(!pane.controller){message.warning('传输服务尚未启用，未修改任务');return false}
   const accepted=await action(pane.controller);pane.check();if(accepted&&refresh)await read();return accepted===true
  }catch(error){report(error);return false}finally{busy=false}
 }
 function clear(all:boolean,ids=Array.from(pane.store.ListSelected)){
  if(!all&&!ids.length)return Promise.resolve(false)
  return control(controller=>controller.clear([...ids],all),true)
 }
 return {aReloadUploaded:read,UploadedDelete:clear,open(taskId:number,target:string){
  const row=pane.store.ListDataShow.find(row=>row.TaskID===taskId)
  if(!row)return Promise.resolve(false)
  if(target==='delete')return clear(false,[taskId])
  if(target!=='pan'&&target!=='file'&&target!=='dir')return Promise.resolve(false)
  return control(controller=>controller.open(taskId,target),false)
 }}
}
