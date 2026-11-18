import { nativeCall } from '@/platform/native'
import type { Account, Credentials } from './contracts'
export const accountsList = () => nativeCall<Account[]>('accounts_list')
export const accountSave = (account: Account, credentials: Credentials) => nativeCall<Account>('account_save', { account, credentials })
export interface ResponseData { status: number; headers: Record<string,string>; body: number[]; finalUrl: string }
export async function rawRequest(account: Account, method: string, url: string, body?: string, headers: Record<string,string> = {}, timeoutMs = 30000, signal?:AbortSignal): Promise<ResponseData> {
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError')
  const requestId=crypto.randomUUID(),cancel=()=>void nativeCall('http_cancel',{requestId}).catch(()=>{})
  signal?.addEventListener('abort',cancel,{once:true})
  try{const result=await nativeCall<ResponseData>('http_request', { request: { requestId, providerId: account.providerId, accountId: account.id, method, url, headers, body: body === undefined ? null : Array.from(new TextEncoder().encode(body)), timeoutMs, proxy: null } });if(signal?.aborted)throw new DOMException('Cancelled','AbortError');return result}finally{signal?.removeEventListener('abort',cancel)}
}
export class SourceHttpError extends Error { constructor(readonly status:number,message:string){super(message)} }
export async function request(account: Account, method: string, url: string, body?: string, headers: Record<string,string> = {}, signal?:AbortSignal): Promise<ResponseData> {
  const result = await rawRequest(account, method, url, body, headers,30000,signal)
  if (result.status < 200 || result.status >= 300) throw new SourceHttpError(result.status,result.status === 401 || result.status === 403 ? '账号鉴权失败，请重新登录' : `来源请求失败（${result.status}）`)
  return result
}
export const text = (response: ResponseData) => new TextDecoder().decode(new Uint8Array(response.body))
export async function json<T>(account: Account, method: string, url: string, body?: unknown,decode:(value:string)=>T=JSON.parse,headers:Record<string,string>={},signal?:AbortSignal): Promise<T> { return decode(text(await request(account, method, url, body === undefined ? undefined : JSON.stringify(body), { 'Content-Type': 'application/json',...headers },signal))) }
export function endpoint(account: Account, path: string) { return `${account.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}` }
export const playable = (name: string) => /\.(mkv|mp4|mov|webm|avi|m4v|ts|m2ts|mpg|mpeg|flv|wmv)$/i.test(name)
