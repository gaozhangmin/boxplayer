import type {Account} from '@/features/sources/contracts'
import {getDrivePane} from './ports'
import {aliFolderAccount} from './aliFolderTransport'
interface Observation {account:Account;pane:object;epoch:unknown;owner:string;file:string;destination:string;check():void}
const observations=new Map<string,Observation>()
export async function withAliCrossDriveObservation<T>(account:Account,file:string,destination:string,stillCurrent:()=>void,work:()=>Promise<T>){
 const pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account)
 const check=()=>{stillCurrent();if(account.providerId!=='aliyun'||getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id||JSON.stringify(aliFolderAccount(account.id))!==owner)throw Error('跨盘移动观测来源已切换')}
 check();if(observations.has(account.id))throw Error('跨盘移动观测正在进行')
 const scope:Observation={account,pane,epoch,owner,file,destination,check};observations.set(account.id,scope)
 try{const result=await work();check();return result}finally{if(observations.get(account.id)===scope)observations.delete(account.id)}
}
export function requireAliCrossDriveObservation(account:Account,file:string,destination:string){
 const scope=observations.get(account.id)
 if(!scope||scope.file!==file||scope.destination!==destination||scope.owner!==JSON.stringify(account))throw Error('跨盘移动必须绑定完整前后快照及身份同步流程；未提交请求')
 scope.check()
}
