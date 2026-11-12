import {nativeCall} from '@/platform/native'
import {getDrivePane,message} from './ports'
import {mutationAccount} from './providerTransport'
import type {Account} from '@/features/sources/contracts'

export type TransferIntent={kind:'upload'|'download';account:Account;parent:string;paths?:string[];files?:Array<{id:string;name:string;isDirectory:boolean}>;destination?:string;conflict?:string;zip?:boolean}
export interface TransferEntryExecutor {submit(intent:TransferIntent,check:()=>void):Promise<boolean>}
let executor:TransferEntryExecutor|undefined
/** M6 installs execution. M5 keeps the original entries without inventing tasks. */
export function registerTransferEntryExecutor(value:TransferEntryExecutor){if(executor)throw Error('传输服务已经注册');executor=value;return ()=>{if(executor===value)executor=undefined}}
export async function submitTransferEntry(intent:TransferIntent,check:()=>void){
 check()
 if(!executor){message.warning('传输服务尚未启用，未创建任务');return false}
 const accepted=await executor.submit(intent,check);check();return accepted===true
}
export function transferEntryScope(){
 const pane=getDrivePane(),source=pane.sourceId,context=pane.context,account=pane.account,identity=JSON.stringify(account)
 const check=()=>{if(!account||pane.local||getDrivePane()!==pane||pane.sourceId!==source||pane.context!==context||JSON.stringify(mutationAccount(source,account.providerId))!==identity)throw Error('传输来源已关闭、切换或账号已变化')}
 check();return {pane,account:account!,check}
}
export async function chooseTransferPaths(kind:'files'|'folders'|'destination',check:()=>void){
 check();const paths=await nativeCall<string[]>('choose_transfer_paths',{kind});check()
 if(!Array.isArray(paths)||paths.length>10000||paths.some(path=>typeof path!=='string'||!path||path.length>32768||/[\u0000-\u001f]/.test(path))||new Set(paths).size!==paths.length||kind==='destination'&&paths.length>1)throw Error('传输文件选择结果无效')
 return paths
}
export function showTransferFileDialog(options:{properties:string[];[key:string]:unknown},callback:(paths:string[])=>unknown){
 const scope=transferEntryScope(),kind=options.properties.includes('openDirectory')?'folders':'files'
 void chooseTransferPaths(kind,scope.check).then(async paths=>{if(paths.length){scope.check();await callback(paths)}}).catch(error=>{try{scope.check();message.error(error instanceof Error?error.message:'文件选择失败')}catch{}})
}
export async function chooseDownloadDirectory(check:()=>void){const paths=await chooseTransferPaths('destination',check);return paths[0]}
export const submitDownload=()=>getDrivePane().action('downloadConfirmed',[])
