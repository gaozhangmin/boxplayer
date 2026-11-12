import type { Account } from './contracts'
import { nativeCall } from '@/platform/native'
import { text,type ResponseData } from './transport'
export interface SignResult {day:number;count:number;reward:string;officialClaim:boolean}
const MEMBER='https://member.aliyundrive.com'
export function createAutoSigner(report:(message:string)=>void){
 const pending=new Set<string>(),attempted=new Set<string>()
 return async(accounts:Account[],enabled:boolean)=>{
  if(!enabled)return
  for(const account of accounts.filter(a=>a.providerId==='aliyun')){
   const now=new Date(),key=`${account.id}:${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`
   if(pending.has(account.id)||attempted.has(key))continue
   pending.add(account.id);attempted.add(key)
   try{
    if(await nativeCall<boolean>('auto_sign_date',{accountId:account.id,completed:false}))continue
    const result=await signAliyun(account,now)
    // Do not stamp a different day if a request crossed midnight.
    if(new Date().toDateString()===now.toDateString())await nativeCall('auto_sign_date',{accountId:account.id,completed:true})
    report(`${account.name}：签到成功${result.officialClaim?'，奖励请前往官方客户端领取':''}`)
   }catch{report(`${account.name}：签到未确认，请稍后在官方客户端查看`)}finally{pending.delete(account.id)}
  }
 }
}
export async function signAliyun(account:Account, now=new Date()):Promise<SignResult>{
 if(account.providerId!=='aliyun')throw new Error('此来源不支持阿里网页签到')
 const post=async(path:string,body:unknown)=>{
  const response=await nativeCall<ResponseData>('http_request',{request:{requestId:crypto.randomUUID(),providerId:account.providerId,accountId:account.id,method:'POST',url:MEMBER+path,headers:{'Content-Type':'application/json'},body:Array.from(new TextEncoder().encode(JSON.stringify(body))),timeoutMs:30000,proxy:null}})
  const data=JSON.parse(text(response)) as Record<string,unknown>
  if(response.status===403&&path.endsWith('sign_in_reward')&&String(data.message||'').includes('升级最新客户端'))return{officialClaim:true}
  if(response.status<200||response.status>=300)throw new Error('签到请求失败，请稍后重试')
  return data
 }
 const response=await post('/v1/activity/sign_in_list',{})
 const result=response.result as {signInCount?:number;signInLogs?:Array<{calendarDay:string|number;isReward?:boolean;reward?:{notice?:string}}> }|undefined
 if(!result||response.success===false||!Number.isInteger(result.signInCount)||Number(result.signInCount)<1||!Array.isArray(result.signInLogs))throw new Error('签到响应无效，请稍后重试')
 const today=now.getDate(),entry=result.signInLogs.find(row=>Number(row.calendarDay)===today)
 if(!entry)throw new Error('未返回今日签到记录，请在官方客户端确认')
 if(entry.isReward)return{day:today,count:result.signInCount!,reward:entry.reward?.notice||'',officialClaim:false}
 const reward=await post('/v1/activity/sign_in_reward',{signInDay:result.signInCount})
 if(reward.officialClaim)return{day:today,count:result.signInCount!,reward:'奖励请前往官方客户端领取',officialClaim:true}
 if(reward.success!==true||!reward.result)throw new Error('签到已提交，奖励请在官方客户端确认')
 return{day:today,count:result.signInCount!,reward:String((reward.result as {notice?:unknown}).notice||''),officialClaim:false}
}
