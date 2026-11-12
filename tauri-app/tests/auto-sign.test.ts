import {expect,it,vi} from 'vitest'
import {signAliyun,createAutoSigner} from '@/features/sources/autoSign'
import {nativeCall} from '@/platform/native'
import type {Account} from '@/features/sources/contracts'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn()}))
const account={id:'own-ali',providerId:'aliyun'} as Account
const response=(status:number,data:unknown)=>({status,body:Array.from(new TextEncoder().encode(JSON.stringify(data)))})
it('does nothing when disabled and never stamps a failed sign-in',async()=>{
 vi.mocked(nativeCall).mockReset();const run=createAutoSigner(vi.fn());await run([account],false);expect(nativeCall).not.toHaveBeenCalled()
 vi.mocked(nativeCall).mockImplementation(async command=>{if(command==='auto_sign_date')return false;throw new Error('offline')})
 await run([account],true);await run([account],true)
 expect(nativeCall).toHaveBeenCalledWith('auto_sign_date',{accountId:account.id,completed:false});expect(nativeCall).not.toHaveBeenCalledWith('auto_sign_date',expect.objectContaining({completed:true}))
 expect(vi.mocked(nativeCall).mock.calls.filter(([command])=>command==='http_request')).toHaveLength(1)
})
it('claims today reward using cumulative count and bound account, not calendar day',async()=>{
 vi.mocked(nativeCall).mockResolvedValueOnce(response(200,{success:true,result:{signInCount:3,signInLogs:[{calendarDay:7,isReward:false}]}})).mockResolvedValueOnce(response(200,{success:true,result:{notice:'reward'}}))
 const result=await signAliyun(account,new Date(2026,10,7));expect(result).toMatchObject({day:7,count:3,reward:'reward'})
 const args=vi.mocked(nativeCall).mock.calls.at(-1)![1] as {request:{accountId:string;body:number[]}}
 expect(args.request.accountId).toBe('own-ali');expect(JSON.parse(new TextDecoder().decode(new Uint8Array(args.request.body)))).toEqual({signInDay:3})
})
it('rejects unsupported providers before sending and keeps failed dates unconfirmed',async()=>{
 vi.mocked(nativeCall).mockClear();await expect(signAliyun({...account,providerId:'alipan-open'})).rejects.toThrow();expect(nativeCall).not.toHaveBeenCalled()
 vi.mocked(nativeCall).mockResolvedValue(response(200,{result:{signInCount:3,signInLogs:[]}}));await expect(signAliyun(account,new Date(2026,10,7))).rejects.toThrow('今日')
})
it('retains official-client reward fallback without claiming a reward was received',async()=>{
 vi.mocked(nativeCall).mockResolvedValueOnce(response(200,{result:{signInCount:3,signInLogs:[{calendarDay:7,isReward:false}]}})).mockResolvedValueOnce(response(403,{message:'请升级最新客户端'}))
 expect(await signAliyun(account,new Date(2026,10,7))).toMatchObject({officialClaim:true,day:7})
})
