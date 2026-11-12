export type DownloadTaskCommand='start'|'pause'|'remove'|'prioritize'
export interface DownloadingActions {command(command:DownloadTaskCommand,ids:string[],all:boolean):Promise<boolean>}
const bindings=new WeakMap<object,DownloadingActions>()
const closed:DownloadingActions={command:async()=>false}
export function bindDownloadingActions(store:object,actions:DownloadingActions){if(bindings.has(store))throw Error('下载任务页面已经绑定');bindings.set(store,actions);return()=>bindings.delete(store)}
export const downloadingActions=(store:object)=>bindings.get(store)??closed
