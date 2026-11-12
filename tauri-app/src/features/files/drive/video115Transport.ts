import type {Account} from '@/features/sources/contracts'
import {request,text,playable} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
import {getDrivePane} from './ports'
import {DRIVE115_DOWN_AGENT} from './electron/providers/drive115Constants'
export const video115Headers={'User-Agent':DRIVE115_DOWN_AGENT}
export function video115Scope(user:string){
 const pane=getDrivePane(),context=pane.context
 const check=()=>{if(getDrivePane()!==pane||pane.sourceId!==user||pane.context!==context||pane.account?.providerId!=='115')throw Error('115 转码来源已切换')}
 check();return {check}
}
export function video115Account(user:string){video115Scope(user).check();return mutationAccount(user,'115')}
export async function video115Fetch(account:Account,url:string,options:{method:string;headers:Record<string,string>;body:URLSearchParams}){
 const scope=video115Scope(account.id);if(url!=='https://proapi.115.com/open/video/video_push'||options.method!=='POST')throw Error('115 转码请求无效')
 const response=await request(account,options.method,url,options.body.toString(),options.headers);scope.check()
 return {ok:response.status>=200&&response.status<300,json:async()=>JSON.parse(text(response))}
}
export async function getDrive115PickCode(user:string,fileId:string){
 const scope=video115Scope(user),account=video115Account(user),file=getDrivePane().store.GetSelected()[0]
 if(!file||file.file_id!==fileId||file.isDir||!playable(file.name))throw Error('请选择一个 115 视频文件')
 const response=await request(account,'GET','https://proapi.115.com/open/folder/get_info?'+new URLSearchParams({file_id:fileId}));scope.check()
 const body=JSON.parse(text(response)),info=body?.data
 if(body?.code!==0||body.state===false)return {pick_code:'',play_long:0,error:typeof body?.message==='string'?body.message:'获取文件详情失败'}
 if(!info||String(info.file_id)!==fileId||String(info.file_category)!=='1'||typeof info.pick_code!=='string'||!info.pick_code)throw Error('115 视频详情身份或提取码无效')
 return {pick_code:info.pick_code,play_long:Number(info.play_long)||0,error:''}
}
