/** Per-store native record actions, bound only while the presentation host is alive. */
export interface CompletedDownloadActions {remove(ids:string[],removeFiles:boolean):Promise<boolean>;open(ids:string[],directory:boolean):Promise<boolean>}
const bindings=new WeakMap<object,CompletedDownloadActions>()
export function bindCompletedDownloadActions(store:object,actions:CompletedDownloadActions){if(bindings.has(store))throw Error('下载记录页面已经绑定');bindings.set(store,actions);return()=>bindings.delete(store)}
const closedActions:CompletedDownloadActions=Object.freeze({remove:async()=>false,open:async()=>false})
export function completedDownloadActions(store:object){return bindings.get(store)??closedActions}
