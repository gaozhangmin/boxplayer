/** Download history presentation boundary. No transfer engine or record database here. */
import {inject,provide,type InjectionKey} from 'vue'
import type useOriginalDownedStore from './electron/down/DownedStore'
import type {IStateDownFile} from './electron/down/downloadTaskModels'
import {message} from './ports'
import {t} from '@/features/files/electron/i18n'
import {createTaskKeyboard,createTaskMouse} from './taskPorts'
export type {KeyboardState,MouseState} from './ports'
export interface DownedTaskController {
 read():Promise<{rows:IStateDownFile[];count:number}>
 remove(id:string,removeFiles:boolean):Promise<boolean>
 open(id:string,directory:boolean):Promise<boolean>
}
export interface DownedTaskPane {store:ReturnType<typeof useOriginalDownedStore>;height:number;controller?:DownedTaskController;check():void;accounts:Array<{user_id:string;nick_name?:string;user_name?:string;name?:string}>;keyboard:ReturnType<typeof createTaskKeyboard>;mouse:ReturnType<typeof createTaskMouse>}
const key:InjectionKey<DownedTaskPane>=Symbol('downed-task-pane')
export const provideDownedTaskPane=(pane:DownedTaskPane)=>provide(key,pane)
export function useDownedTaskPane(){const pane=inject(key);if(!pane)throw Error('下载记录页面已关闭');return pane}
export const useKeyboardStore=()=>useDownedTaskPane().keyboard
export const useMouseStore=()=>useDownedTaskPane().mouse
export const useAppStore=()=>({appTab:'down',GetAppTabMenu:'DownedRight'})
export const useWinStore=()=>{const pane=useDownedTaskPane();return {get GetListHeight(){return `${pane.height}px`},get GetListHeightNumber(){return pane.height}}}
export const useDownedStore=()=>useDownedTaskPane().store
const controllers=new WeakMap<DownedTaskPane,ReturnType<typeof makeDownedDAL>>()
export function createDownedDAL(pane:DownedTaskPane){let value=controllers.get(pane);if(!value){value=makeDownedDAL(pane);controllers.set(pane,value)}return value}
function makeDownedDAL(pane:DownedTaskPane){
 let generation=0,busy=false
 function report(error:unknown){try{pane.check();message.error(error instanceof Error?error.message:'下载记录操作失败')}catch{}}
 async function read(){const current=++generation
  try{pane.check();pane.store.ListLoading=true
   const snapshot=pane.controller?await pane.controller.read():{rows:[],count:0};pane.check();if(current!==generation)return false
   if(!Array.isArray(snapshot.rows)||!Number.isSafeInteger(snapshot.count)||snapshot.count<snapshot.rows.length)throw Error('下载记录列表响应无效')
   const ids=new Set<string>()
   for(const row of snapshot.rows){if(typeof row.DownID!=='string'||!row.DownID||ids.has(row.DownID)||!row.Info||typeof row.Info.name!=='string'||!Number.isFinite(row.Info.size)||row.Info.size<0||!row.Down||row.Down.IsCompleted!==true)throw Error('已下载记录标识或完成状态无效');ids.add(row.DownID)}
   pane.store.aLoadListData(snapshot.rows,snapshot.count);return true
  }catch(error){if(current===generation)report(error);return false}
  finally{try{pane.check();if(current===generation)pane.store.ListLoading=false}catch{}}
 }
 function requested(ids:string[]){if(new Set(ids).size!==ids.length)throw Error('重复的下载记录');const rows=ids.map(id=>pane.store.ListDataRaw.find(row=>row.DownID===id));if(rows.some(row=>!row))throw Error('下载记录已变化');return rows as IStateDownFile[]}
 async function remove(ids:string[],removeFiles:boolean){
  if(busy||!ids.length)return false;busy=true
  try{pane.check();const rows=requested(ids);if(!pane.controller){message.warning('传输服务尚未启用，未修改任务');return false}
   let changed=false,failed=false
   for(const row of rows){pane.check();try{
    if(removeFiles&&(row.Info.offlineProvider||row.Info.ariaRemote||row.Info.isDir))throw Error('远程任务或文件夹请在文件管理器中删除，记录已保留')
    const accepted=(await pane.controller.remove(row.DownID,removeFiles))===true;pane.check();changed=accepted||changed;failed=!accepted||failed
   }catch(error){pane.check();failed=true;report(error)}}
   if(changed){const refreshed=await read();return refreshed&&!failed}return false
  }catch(error){report(error);return false}finally{busy=false}
 }
 async function open(ids:string[],directory:boolean){
  if(busy||!ids.length)return false;busy=true
  try{pane.check();const rows=requested(ids);if(!pane.controller){message.warning('传输服务尚未启用，未修改任务');return false}
   if(rows.length>10)message.info(t('transfer.openFirstTenOnly'))
   let accepted=false
   for(const row of rows.slice(0,10)){pane.check();if(row.Info.offlineProvider)continue;if(row.Info.ariaRemote){message.error(t('transfer.remoteDownloadUnsupported'));continue}
    accepted=((await pane.controller.open(row.DownID,directory))===true)||accepted;pane.check()}
   return accepted
  }catch(error){report(error);return false}finally{busy=false}
 }
 return {read,remove,open}
}
