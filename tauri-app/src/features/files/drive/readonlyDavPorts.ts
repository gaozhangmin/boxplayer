import type {WebDavConnectionConfig} from './electron/providers/readonlyDav'
export interface ReadonlyDavStat{filename:string;basename:string;type:'file'|'directory';size:number;mime?:string;lastmod?:string}
// The native boundary admits canonical absolute paths and single file names.
// Supply the POSIX operations used by the unchanged Electron model mapper.
const trimEnd=(value:string)=>value.replace(/\/+$/,'')
const basename=(value:string)=>trimEnd(value).split('/').at(-1)||''
const dirname=(value:string)=>{if(/^\/+$/u.test(value))return '/';const path=trimEnd(value),last=path.lastIndexOf('/');return last<0?'.':last===0?'/':path.slice(0,last)}
const extname=(value:string)=>{const name=basename(value),last=name.lastIndexOf('.');return last<=0||name==='..'?'':name.slice(last)}
export const posixPath={posix:{basename,dirname},extname}
interface Payload{path:string;data:unknown;stats?:ReadonlyDavStat[]}
const payloads=new WeakMap<WebDavConnectionConfig,Payload>()
export async function withReadonlyDavPayload<T>(config:WebDavConnectionConfig,payload:Payload,run:()=>Promise<T>){
 if(payloads.has(config))throw Error('只读目录映射上下文重复')
 payloads.set(config,payload);try{return await run()}finally{payloads.delete(config)}
}
export function createWebDavClient(config:WebDavConnectionConfig){return {async getDirectoryContents(path:string){const payload=payloads.get(config);if(!payload?.stats||path!==payload.path)throw Error('WebDAV只读目录映射上下文不匹配');return payload.stats}}}
export async function requestAListApi<T>(config:WebDavConnectionConfig,endpoint:string,body:unknown):Promise<T>{
 const payload=payloads.get(config)
 if(!payload||endpoint!=='/api/fs/list'||JSON.stringify(body)!==JSON.stringify({path:payload.path,password:'',page:1,per_page:0,refresh:false}))throw Error('AList只读目录映射上下文不匹配')
 return payload.data as T
}
