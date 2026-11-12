/** Original download-list presentation; native M6 executor remains uninstalled. */
import {inject,provide,type InjectionKey} from 'vue'
import type useOriginalDowningStore from './electron/down/DowningStore'
import type {IStateDownFile} from './electron/down/downloadTaskModels'
import type {DownloadTaskCommand} from './downloadingActions'
import {message} from './ports'
import {createTaskKeyboard,createTaskMouse} from './taskPorts'
export type {KeyboardState,MouseState} from './ports'
export interface DownloadingTaskController {read():Promise<IStateDownFile[]>;command(command:DownloadTaskCommand,ids:string[],all:boolean):Promise<boolean>}
export interface DownloadingTaskPane {store:ReturnType<typeof useOriginalDowningStore>;height:number;controller?:DownloadingTaskController;check():void;accounts:Array<{user_id:string;nick_name?:string;user_name?:string;name?:string}>;keyboard:ReturnType<typeof createTaskKeyboard>;mouse:ReturnType<typeof createTaskMouse>}
const key:InjectionKey<DownloadingTaskPane>=Symbol('downloading-task-pane')
export const provideDownloadingTaskPane=(pane:DownloadingTaskPane)=>provide(key,pane)
export function useDownloadingTaskPane(){const pane=inject(key);if(!pane)throw Error('下载任务页面已关闭');return pane}
export const useKeyboardStore=()=>useDownloadingTaskPane().keyboard
export const useMouseStore=()=>useDownloadingTaskPane().mouse
export const useAppStore=()=>({appTab:'down',GetAppTabMenu:'DowningRight'})
export const useWinStore=()=>{const pane=useDownloadingTaskPane();return {get GetListHeight(){return `${pane.height}px`},get GetListHeightNumber(){return pane.height}}}
export const useDowningStore=()=>useDownloadingTaskPane().store
const controllers=new WeakMap<DownloadingTaskPane,ReturnType<typeof makeDownloadingDAL>>()
export function createDownloadingDAL(pane:DownloadingTaskPane){let value=controllers.get(pane);if(!value){value=makeDownloadingDAL(pane);controllers.set(pane,value)}return value}
function makeDownloadingDAL(pane:DownloadingTaskPane){
 let generation=0,busy=false
 function report(error:unknown){try{pane.check();message.error(error instanceof Error?error.message:'下载任务操作失败')}catch{}}
 async function read(){const current=++generation
  try{pane.check();pane.store.ListLoading=true;const rows=pane.controller?await pane.controller.read():[];pane.check();if(current!==generation)return false
   if(!Array.isArray(rows))throw Error('下载任务列表响应无效')
   const ids=new Set<string>()
   for(const row of rows){if(typeof row.DownID!=='string'||!row.DownID||ids.has(row.DownID)||!row.Info||typeof row.Info.name!=='string'||!Number.isFinite(row.Info.size)||row.Info.size<0||row.Info.ariaRemote||row.Info.offlineProvider||row.Info.sourceType||!row.Down||row.Down.IsCompleted!==false||!Number.isFinite(row.Down.DownProcess)||row.Down.DownProcess<0||row.Down.DownProcess>100)throw Error('下载任务标识、类型或进度无效');ids.add(row.DownID)}
   pane.store.aLoadListData(rows);return true
  }catch(error){if(current===generation)report(error);return false}
  finally{try{pane.check();if(current===generation)pane.store.ListLoading=false}catch{}}
 }
 async function command(command:DownloadTaskCommand,ids:string[],all:boolean){
  if(busy)return false;busy=true
  try{pane.check();if(!pane.controller){message.warning('传输服务尚未启用，未修改任务');return false}
   if(!['start','pause','remove','prioritize'].includes(command)||new Set(ids).size!==ids.length||all&&ids.length||!all&&(!ids.length||ids.some(id=>!pane.store.ListDataRaw.some(row=>row.DownID===id))))return false
   if(!pane.store.ListDataRaw.length)return false
   const accepted=(await pane.controller.command(command,[...ids],all))===true;pane.check();if(!accepted)return false
   return await read()
  }catch(error){report(error);return false}finally{busy=false}
 }
 return {read,command}
}
