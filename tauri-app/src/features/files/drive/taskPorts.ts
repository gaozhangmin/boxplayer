/** Presentation boundary for original Electron task pages. No M6 engine is installed here. */
import {inject,provide,reactive,watch,onScopeDispose,type InjectionKey} from 'vue'
import type {KeyboardState,MouseState} from './ports'
import {message} from './ports'
import type useUploadingStore from './electron/down/UploadingStore'
export interface UploadTaskSnapshot {taskId:number;name:string;rows:import('./electron/down/UploadingStore').IUploadingModel[];count:number}
export interface UploadTaskController {
 read(taskId:number):Promise<UploadTaskSnapshot>
 command(command:'start'|'pause'|'clear'|'toggle',taskId:number,ids:number[],all:boolean):Promise<boolean>
}
export interface UploadTaskPane {
 store:ReturnType<typeof useUploadingStore>;height:number;controller?:UploadTaskController;check():void
 keyboard:ReturnType<typeof createTaskKeyboard>;mouse:ReturnType<typeof createTaskMouse>
}
const key:InjectionKey<UploadTaskPane>=Symbol('upload-task-pane')
export const provideUploadTaskPane=(pane:UploadTaskPane)=>provide(key,pane)
export function useUploadTaskPane(){const pane=inject(key);if(!pane)throw Error('上传任务页面已关闭');return pane}
function subscribable<T extends object>(state:T){return Object.assign(state,{$subscribe(callback:(_mutation:unknown,value:T)=>void){const stop=watch(state,value=>callback(null,value),{deep:true,flush:'sync'});onScopeDispose(stop);return stop}})}
export const createTaskKeyboard=()=>subscribable(reactive<KeyboardState>({KeyDownEvent:{Code:'',Key:'',Ctrl:false,Shift:false,Alt:false,Repeat:false,IsInput:false,IsEnmpty:true}}))
export const createTaskMouse=()=>subscribable(reactive<MouseState>({MouseEvent:{isTrusted:false,Ctrl:false,Shift:false,Alt:false,button:-1,buttons:0,srcElement:null}}))
export const useKeyboardStore=()=>useUploadTaskPane().keyboard
export const useMouseStore=()=>useUploadTaskPane().mouse
export const useAppStore=()=>({appTab:'down',GetAppTabMenu:'UploadingRight'})
export const useWinStore=()=>{const pane=useUploadTaskPane();return {get GetListHeight(){return `${pane.height}px`},get GetListHeightNumber(){return pane.height}}}
export const useOriginalUploadingStore=()=>useUploadTaskPane().store
export type {KeyboardState,MouseState}
const controllers=new WeakMap<UploadTaskPane,ReturnType<typeof makeUploadingDAL>>()
export function createUploadingDAL(pane:UploadTaskPane){let controller=controllers.get(pane);if(!controller){controller=makeUploadingDAL(pane);controllers.set(pane,controller)}return controller}
function makeUploadingDAL(pane:UploadTaskPane){
 let revision=0,commandPending=false
 async function read(taskId:number){
  const current=++revision;pane.check();pane.store.ListLoading=true
  try{
   const snapshot=pane.controller?await pane.controller.read(taskId):{taskId:0,name:'',rows:[],count:0}
   pane.check();if(current!==revision)return
   if(snapshot.taskId!==taskId||!Array.isArray(snapshot.rows)||!Number.isSafeInteger(snapshot.count)||snapshot.count<snapshot.rows.length)throw Error('上传任务列表响应无效')
   const ids=new Set<number>()
   for(const row of snapshot.rows){const id=taskId?row.UploadID:row.TaskID;if(!Number.isSafeInteger(id)||id<=0||ids.has(id)||typeof row.name!=='string'||!Number.isFinite(row.Progress)||row.Progress<0||row.Progress>100)throw Error('上传任务条目标识或进度无效');ids.add(id)}
   pane.store.aLoadListData(snapshot.taskId,snapshot.name,snapshot.rows,snapshot.count)
  }catch(error){try{pane.check();if(current===revision)message.error(error instanceof Error?error.message:'读取上传任务失败')}catch{}}
  finally{try{pane.check();if(current===revision)pane.store.ListLoading=false}catch{}}
 }
 async function command(command:'start'|'pause'|'clear'|'toggle',all:boolean,ids?:number[]){
  if(commandPending)return false
  commandPending=true
  try{pane.check();if(!pane.controller){message.warning('传输服务尚未启用，未修改任务');return false}
   const taskId=pane.store.showTaskID,selected=ids??Array.from(pane.store.ListSelected)
   if(!all&&!selected.length)return false
   const accepted=await pane.controller.command(command,taskId,selected,all);pane.check()
   if(accepted)await read(pane.store.showTaskID)
   return accepted
  }catch(error){try{pane.check();message.error(error instanceof Error?error.message:'任务操作失败')}catch{}return false}
  finally{commandPending=false}
 }
 return {
  aReloadUploading:()=>read(pane.store.showTaskID),
  mUploadingShowTaskBack:()=>read(0),
  mUploadingShowTask:(taskId?:number)=>{const row=pane.store.GetSelectedFirst();return read(taskId??row?.TaskID??0)},
  aUploadingStart:(all:boolean,start:boolean)=>command(start?'start':'pause',all),
  aUploadingDelete:(all:boolean)=>command('clear',all),
  aUploadingStartOne:(id:number)=>command('toggle',false,[id])
 }
}
