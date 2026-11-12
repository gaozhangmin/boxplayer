import {request,text} from '@/features/sources/transport'
import type {IAliFileItem,IAliGetFileModel} from './electron/aliapi/alimodels'
import {mutationAccount} from './providerTransport'
export interface IUrlRespData{code:number;body:any}
export {resolveAliFileDriveId} from './electron/providers/aliFileModelDrive'
// Encryption is excluded by D6. Keep the original undecoded display branch.
export function DecodeEncName(_user:string,item:IAliFileItem|IAliGetFileModel){return {name:item.name,mine_type:item.mime_type,ext:'file_extension'in item?item.file_extension||'':'ext'in item?item.ext:''}}
// Virtual account-wide video views have no physical-directory size cache.
export const TreeStore={GetDriver:(_drive:string):{DirFileSizeMap?:Record<string,number>;DirTotalSizeMap?:Record<string,number>}|undefined=>undefined}
export const DebugLog={mSaveWarning:(_message:string,_body:unknown)=>{},mSaveDanger:(_message:string,_error:unknown)=>{}}
export const message={warning:(_message:string,_duration?:number)=>{}}
export const AliVideoHttp={IsSuccess:(code:number)=>code===200,HttpCodeBreak:(_code:number)=>false,async Post(path:string,body:Record<string,unknown>,user:string,share:string):Promise<IUrlRespData>{
 const account=mutationAccount(user,'aliyun')
 if(share||!['adrive/v1.1/openFile/video/recentList','adrive/v2/video/list','adrive/v2/video/compilation/list'].includes(path)||!body||typeof body!=='object'||Array.isArray(body))throw Error('阿里视频列表请求未适配')
 if(path.endsWith('/recentList')){if(Object.keys(body).length)throw Error('阿里正在观看参数无效')}
 else if(body.use_compilation!==true||body.duration!==0||body.order_by!=='updated_at desc'||body.hidden_type!=='NO_HIDDEN'||body.limit!==100||typeof body.marker!=='string'||body.url_expire_sec!==14400||Object.keys(body).some(key=>!['name','use_compilation','duration','order_by','hidden_type','limit','marker','url_expire_sec'].includes(key))||path.includes('/compilation/')&&(typeof body.name!=='string'||!body.name))throw Error('阿里专辑列表参数无效')
 const response=await request(account,'POST','https://api.aliyundrive.com/'+path,JSON.stringify(body),{'Content-Type':'application/json'}),data=JSON.parse(text(response))
 if(response.status!==200||!data||typeof data!=='object'||Array.isArray(data)||data.code||!Array.isArray(data.items)||data.next_marker!==undefined&&typeof data.next_marker!=='string')throw Error('阿里视频列表响应无效')
 const seen=new Set<string>(),validId=(value:unknown):value is string=>typeof value==='string'&&!!value&&value.length<=4096&&!/[\u0000-\u001f/\\]/.test(value)
 for(const row of data.items){
  const group=row?.video_type==='COMPILATION'
  if(!row||typeof row.name!=='string'||!row.name||(!group&&(!validId(row.drive_id)||!validId(row.file_id)))||group&&(!validId(row.compilation_id)||row.compilation_id.split('_').length!==2||row.compilation_id.split('_').some((part:string)=>!part))||row.size!==undefined&&(!Number.isSafeInteger(row.size)||row.size<0))throw Error('阿里视频项目身份或大小无效')
  const identity=group?row.compilation_id:JSON.stringify([row.drive_id,row.file_id]);if(seen.has(identity))throw Error('阿里视频列表重复项目');seen.add(identity)
 }

 return {code:response.status,body:data}
}}
