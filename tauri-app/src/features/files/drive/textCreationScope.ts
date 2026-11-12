import type {Account} from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
interface Scope {owner:string;current:()=>boolean;cancelled:boolean;listeners:Set<()=>void>}
const active=new Map<string,Scope>()
export function cancelTextCreationScope(user:string){const scope=active.get(user);if(!scope||scope.cancelled)return;scope.cancelled=true;for(const listener of scope.listeners)listener()}
export function onTextCreationCancel(user:string,listener:()=>void){const scope=active.get(user);if(!scope)throw Error('文本创建作用域不存在');scope.listeners.add(listener);if(scope.cancelled)listener();return()=>scope.listeners.delete(listener)}
export function checkTextCreation(user:string,provider:Account['providerId']){
 const account=mutationAccount(user,provider),scope=active.get(user)
 if(scope&&(scope.cancelled||!scope.current()||JSON.stringify(account)!==scope.owner)){cancelTextCreationScope(user);throw Error('文本创建窗口已关闭、来源或账号已变化')}
 return account
}
export async function withTextCreationScope<T>(account:Account,current:()=>boolean,work:()=>Promise<T>){
 if(active.has(account.id))throw Error('此来源已有文本创建正在进行，请等待结果')
 const owner=JSON.stringify(account),scope:Scope={owner,current:()=>current()&&JSON.stringify(account)===owner,cancelled:false,listeners:new Set()}
 active.set(account.id,scope)
 try{checkTextCreation(account.id,account.providerId);const result=await work();checkTextCreation(account.id,account.providerId);return result}
 finally{if(active.get(account.id)===scope)active.delete(account.id)}
}
