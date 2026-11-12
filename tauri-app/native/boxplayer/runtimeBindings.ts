import type {LanguageModel} from 'ai'
import type {BoxPlayerRuntimeConfig,BoxPlayerDriveTarget} from './boxplayer'
import type {StorageExecutor} from './upstream/ports'

/** Private host ports. Only trusted native initialization may bind these; the
 * WebView protocol deliberately has no set-config or set-credentials method. */
export interface BoxPlayerRuntimeBindings {
 requestConfig():Promise<BoxPlayerRuntimeConfig|null>
 resolveStorage(target:BoxPlayerDriveTarget):StorageExecutor
 requestResource(input:{url:string;method:string;headers?:Record<string,string>;body?:string}):Promise<{ok:boolean;status:number;data:unknown}>
 createModel?:(config:BoxPlayerRuntimeConfig)=>LanguageModel
}
let bindings:BoxPlayerRuntimeBindings|undefined
export function bindBoxPlayerRuntime(value:BoxPlayerRuntimeBindings){
 if(bindings)throw new Error('BoxPlayer runtime already bound')
 bindings=value
}
export function unbindBoxPlayerRuntime(){bindings=undefined}
export function runtimeBound(){return !!bindings}
export function requestBoxPlayerRuntimeConfig(){return bindings?.requestConfig()??Promise.resolve(null)}
export function createStorageExecutor(target:BoxPlayerDriveTarget):StorageExecutor{
 if(!bindings)throw new Error('BoxPlayer native execution ports are not configured')
 return bindings.resolveStorage(target)
}
export function requestPanHub(input:Parameters<BoxPlayerRuntimeBindings['requestResource']>[0]){
 if(!bindings)throw new Error('BoxPlayer native resource port is not configured')
 return bindings.requestResource(input)
}
export function modelOverride(config:BoxPlayerRuntimeConfig){return bindings?.createModel?.(config)}
