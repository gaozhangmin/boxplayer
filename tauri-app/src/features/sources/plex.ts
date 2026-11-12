import type { SourceDriver, Account } from './contracts'
import { endpoint, json, request } from './transport'
import {getServerPlaybackSource} from './serverVersions'
import { nativeCall } from '@/platform/native'
interface Metadata{ratingKey:string;title:string;type:string;userRating?:number;Media?:{Part:{key:string;size?:number}[]}[]}
const isFolder=(i:Metadata)=>['show','season','artist','album','collection','folder','playlist'].includes(i.type)
const mapped=(i:Metadata)=>({serverType:i.type,id:i.type==='playlist'?'playlist:'+i.ratingKey:i.ratingKey,name:i.title,isDirectory:isFolder(i),size:i.Media?.[0]?.Part?.[0]?.size||0,playable:['movie','episode','clip'].includes(i.type),favorite:(i.userRating||0)>=9})
export const plex:SourceDriver={
 async search(account,query,cursor){
  const term=query.trim();if(!term)return{entries:[]}
  if(cursor)throw new Error('Plex 搜索不支持此分页位置')
  const params=new URLSearchParams({query:term,limit:'60',includeCollections:'1',includeExternalMedia:'0',includeMeta:'1'})
  const data=await json<{MediaContainer:{Metadata?:Metadata[];Hub?:{Metadata?:Metadata[]}[]}}>(account,'GET',endpoint(account,`hubs/search?${params}`))
  if(!data.MediaContainer)throw new Error('Plex 搜索响应无效')
  const rows=data.MediaContainer.Metadata?.length?data.MediaContainer.Metadata:(data.MediaContainer.Hub||[]).flatMap(hub=>hub.Metadata||[])
  const seen=new Set<string>();return{entries:rows.filter(row=>{if(!row.ratingKey||seen.has(row.ratingKey))return false;seen.add(row.ratingKey);return true}).map(mapped)}
 },
 async list(account,parent,cursor){
  if(!parent){const data=await json<{MediaContainer:{Directory:{key:string;title:string}[]}}>(account,'GET',endpoint(account,'library/sections'));return{entries:(data.MediaContainer.Directory||[]).map(i=>({id:`section:${i.key}`,name:i.title,isDirectory:true,size:0,playable:false}))}}
  const start=Number(cursor||0);if(!Number.isSafeInteger(start)||start<0)throw new Error('Plex 分页参数无效')
  const path=parent.startsWith('playlist:')?`playlists/${encodeURIComponent(parent.slice(9))}/items`:parent.startsWith('section:')?`library/sections/${encodeURIComponent(parent.slice(8))}/all`:`library/metadata/${encodeURIComponent(parent)}/children`
  const q=new URLSearchParams({'X-Plex-Container-Start':String(start),'X-Plex-Container-Size':'100'})
  const data=await json<{MediaContainer:{Metadata?:Metadata[];totalSize?:number;size?:number}}>(account,'GET',endpoint(account,`${path}?${q}`))
  const rows=data.MediaContainer.Metadata||[]
  return{entries:rows.map(mapped),nextCursor:rows.length>0&&start+rows.length<(data.MediaContainer.totalSize||0)?String(start+rows.length):undefined}
 },
 async resolve(account,item){
  const result=await nativeCall<{media:import('./contracts').ResolvedMedia}>('server_resolve',{accountId:account.id,itemId:item.id,profile:{DirectPlayProfiles:[],TranscodingProfiles:[]},maxBitrate:null,directOnly:true,autoBitrate:false,preferredSourceId:getServerPlaybackSource(account.id,item.id)})
  return result.media
 }
}
export async function plexFavorite(account:Account,itemId:string,value:boolean){const q=new URLSearchParams({key:itemId,identifier:'com.plexapp.plugins.library',rating:value?'10':'-1'});await request(account,'PUT',endpoint(account,`:/rate?${q}`))}
export async function plexReport(account:Account,itemId:string,state:'start'|'progress'|'stop',position:number,paused:boolean){const q=new URLSearchParams({key:`/library/metadata/${itemId}`,ratingKey:itemId,state:state==='stop'?'stopped':paused?'paused':'playing',time:String(Math.max(0,Math.round(position*1000)))});await request(account,'GET',endpoint(account,`:/progress?${q}`))}
