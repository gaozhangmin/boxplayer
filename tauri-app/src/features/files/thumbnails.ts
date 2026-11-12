import { nativeCall } from '@/platform/native'
// One native mpv thumbnail worker serves the entire Files surface. Keep serialization
// across component/route generations: abandoning a row must not release the native slot.
const cache=new Map<string,string|null>()
let tail:Promise<unknown>=Promise.resolve()
const cacheLimit=128
const characterBudget=8*1024*1024
let cachedCharacters=0
function remember(key:string,value:string|null){cachedCharacters-=cache.get(key)?.length||0;cache.delete(key);cache.set(key,value);cachedCharacters+=value?.length||0;while(cache.size>cacheLimit||cachedCharacters>characterBudget){const oldest=cache.keys().next().value!;cachedCharacters-=cache.get(oldest)?.length||0;cache.delete(oldest)}}
export async function fileThumbnail(sourceId:string,relativePath:string,local:boolean,active:()=>boolean):Promise<string|null>{
 const key=JSON.stringify([local,sourceId,relativePath])
 if(cache.has(key))return cache.get(key)!
 const work=tail.then(async()=>{
  if(!active())return null
  if(cache.has(key))return cache.get(key)!
  try{const result=await nativeCall<string|null>(local?'local_thumbnail':'source_thumbnail',local?{sourceId,relativePath}:{sourceId,fileId:relativePath,local:false});const image=typeof result==='string'&&result.startsWith('data:image/png;base64,')?result:null;remember(key,image);return image}catch{return null}
 })
 tail=work.catch(()=>null)
 return work
}

export const localThumbnail=(sourceId:string,path:string,active:()=>boolean)=>fileThumbnail(sourceId,path,true,active)
export const remoteThumbnail=(sourceId:string,path:string,active:()=>boolean)=>fileThumbnail(sourceId,path,false,active)
