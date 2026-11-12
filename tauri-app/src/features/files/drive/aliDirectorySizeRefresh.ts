import type {Account} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import {alipan} from '@/features/sources/alipan'
import {DriverData,installAliSizeIndex,_RefreshAllDirTotalSize} from './aliDirectoryCachePorts'
import {GetDirSizeNeedRefresh,SaveDirSizeNeedRefresh} from './electron/providers/aliDirectorySizeCache'
import {readAliSizeDirectoryIndex} from './aliDirectoryIndexPorts'
import {readAliDirectFolderSize} from './aliDirectorySizePorts'
import {humanSize} from './electron/utils/format'

let nextSizeSession=0
export function startAliDirectorySizeRefresh(account:Account,checkSource:()=>void,publish:()=>void){
 if(account.providerId!=='aliyun')throw Error('此账号不使用网页目录大小统计')
 const owner=JSON.stringify(account),session=++nextSizeSession,keys=new Map<string,string>(),published=new Map<string,Record<string,number>>(),indexed=new Set<string>(),attempts=new Map<string,number>(),saves=new Map<string,ReturnType<typeof setTimeout>>()
 let rootsCache:Awaited<ReturnType<typeof alipan.list>>|undefined
 let stopped=false,revision=0,timer:ReturnType<typeof setTimeout>|undefined,lastError=''
 const keyFor=(drive:string)=>{const key=JSON.stringify([session,drive]);keys.set(drive,key);return key}
 const storageKey=(key:string)=>'tauri.aliDirectorySizes.v1:'+JSON.stringify([owner,JSON.parse(key)[1]])
 const check=()=>{if(stopped)throw Error('目录大小统计已关闭');checkSource()}
 function save(key:string){
  const data=DriverData.get(key);if(!data)return
  try{localStorage.setItem(storageKey(key),JSON.stringify({version:1,entries:Object.keys(data.DirFileSizeMap).map(id=>[id,data.DirFileSizeMap[id],data.DirFileSizeTimeMap[id]||0])}))}catch{lastError='无法持久保存目录大小缓存'}
 }
 function restore(key:string){
  const data=DriverData.get(key);if(!data)return
  const previous={direct:{...data.DirFileSizeMap},time:{...data.DirFileSizeTimeMap},totals:{...data.DirTotalSizeMap}}
  try{
   const raw=JSON.parse(localStorage.getItem(storageKey(key))||'null');if(!raw||raw.version!==1||!Array.isArray(raw.entries))return
   const seen=new Set<string>(),now=Math.floor(Date.now()/1000)-1654500000
   for(const row of raw.entries){if(!Array.isArray(row)||row.length!==3||typeof row[0]!=='string'||seen.has(row[0])||!Number.isSafeInteger(row[1])||row[1]<0||!Number.isSafeInteger(row[2])||row[2]<0||row[2]>now)throw Error('缓存无效');seen.add(row[0])}
   for(const [id,size,time] of raw.entries)if(data.DirMap.has(id)){data.DirFileSizeMap[id]=size;data.DirFileSizeTimeMap[id]=time}
   _RefreshAllDirTotalSize(key)
  }catch{data.DirFileSizeMap=previous.direct;data.DirFileSizeTimeMap=previous.time;data.DirTotalSizeMap=previous.totals}
 }
 function deferSave(key:string){if(saves.has(key))return;saves.set(key,setTimeout(()=>{saves.delete(key);save(key)},5000))}
 async function tick(){
  const epoch=revision,active=()=>{check();if(revision!==epoch)throw Error('目录大小缓存已失效')}
  try{
   active();const roots=rootsCache||await alipan.list(account,'');active();rootsCache=roots
   const seen=new Set<string>()
   for(const root of roots.entries){
    active();const location=JSON.parse(root.id),drive=location.driveId
    if(!root.isDirectory||location.fileId!=='root'||typeof drive!=='string'||!drive||seen.has(drive))throw Error('目录大小统计盘根无效');seen.add(drive)
    const interval=root.name==='资源盘'?15000:10000
    if(attempts.has(drive)&&Date.now()-attempts.get(drive)!<interval)continue
    attempts.set(drive,Date.now());const key=keyFor(drive)
    if(!indexed.has(drive)){
     const nodes=await readAliSizeDirectoryIndex(account,drive,active);active()
     const existing=DriverData.has(key),data=installAliSizeIndex(key,nodes);if(!existing)restore(key);data.persist=()=>deferSave(key);indexed.add(drive)
    }
    for(const file of GetDirSizeNeedRefresh(key)){
     active();const result=await readAliDirectFolderSize(account,drive,file,active);active()
     SaveDirSizeNeedRefresh(key,[{dirID:file,size:result.size}])
    }
    active();const data=DriverData.get(key)!
    published.set(drive,{...data.DirTotalSizeMap});publish();lastError=''
   }
  }catch(cause){if(!stopped)lastError=cause instanceof Error?cause.message:'目录大小统计失败'}
  finally{if(!stopped)timer=setTimeout(()=>void tick(),1000)}
 }
 // Original PageMain starts automatic size reads after its 50-second warmup.
 timer=setTimeout(()=>void tick(),50000)
 return {
  get lastError(){return lastError},
  apply(file:IAliGetFileModel){
   if(!file.isDir)return file
   let location:any;try{location=JSON.parse(file.file_id)}catch{return file}
   const total=published.get(location.driveId)?.[location.fileId]
   return total===undefined?file:{...file,size:total,sizeStr:humanSize(total)}
  },
  invalidate(){revision++;rootsCache=undefined;indexed.clear();attempts.clear();published.clear();for(const key of keys.values()){const data=DriverData.get(key);if(!data)continue;for(const id of data.DirMap.keys())data.DirFileSizeTimeMap[id]=0;deferSave(key)}},
  stop(){stopped=true;revision++;if(timer!==undefined)clearTimeout(timer);for(const [key,handle] of saves){clearTimeout(handle);save(key)}saves.clear();for(const key of keys.values())DriverData.delete(key)}
 }
}
