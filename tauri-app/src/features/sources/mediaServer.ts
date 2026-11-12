import { plexFavorite, plexReport } from './plex'
import { serverItemId } from './playlists'
import { nativeCall, getSettings } from '@/platform/native'
import { defaultServerPlayback } from '@/platform/contracts'
import { buildMediaServerDeviceProfile, getMediaServerMaxStreamingBitrate } from './playbackQuality'
import type { Account, SourceDriver, SourceEntry } from './contracts'
import { endpoint, json, request } from './transport'
import {getServerPlaybackSource} from './serverVersions'
export {setServerPlaybackSource,getServerPlaybackSource} from './serverVersions'
const segment=encodeURIComponent
interface Item { Id:string; Name:string; IsFolder?:boolean; Type?:string; Size?:number; UserData?:{IsFavorite?:boolean} }
interface Items { Items:Item[]; TotalRecordCount:number }
const entry=(item:Item):SourceEntry=>({serverType:item.Type,favorite:item.UserData?.IsFavorite,id:item.Type==='Playlist'?'playlist:'+item.Id:item.Id,name:item.Name,isDirectory:!!item.IsFolder||['Folder','CollectionFolder','UserView','Series','Season','BoxSet','MusicAlbum','MusicArtist','Playlist'].includes(item.Type||''),size:item.Size||0,playable:!item.IsFolder&&['Movie','Episode','Video','MusicVideo'].includes(item.Type||'')})
export const mediaServer:SourceDriver={
 async search(account,query,cursor){
  if(!account.userId)throw new Error('服务器账号缺少用户标识，请重新登录')
  const term=query.trim();if(!term)return{entries:[]}
  const start=Number(cursor||0);if(!Number.isSafeInteger(start)||start<0)throw new Error('搜索分页参数无效')
  const params=new URLSearchParams({SearchTerm:term,Recursive:'true',IncludeItemTypes:'Movie,Series,Season,Episode,BoxSet,Folder,Playlist',Fields:'Size',EnableUserData:'true',StartIndex:String(start),Limit:'100',SortBy:'SortName',SortOrder:'Ascending'})
  const data=await json<Items>(account,'GET',endpoint(account,`Users/${segment(account.userId)}/Items?${params}`))
  if(!Array.isArray(data.Items))throw new Error('服务器搜索响应无效')
  return{entries:data.Items.map(entry),nextCursor:data.Items.length>0&&start+data.Items.length<data.TotalRecordCount?String(start+data.Items.length):undefined}
 },
 async list(account,parent,cursor){
  if(!account.userId)throw new Error('服务器账号缺少用户标识，请重新登录')
  if(!parent){const data=await json<Items>(account,'GET',endpoint(account,`Users/${segment(account.userId)}/Views`));return{entries:data.Items.map(entry)}}
  const start=Number(cursor||0);if(!Number.isSafeInteger(start)||start<0)throw new Error('分页参数无效')
  const playlist=parent.startsWith('playlist:');const params=new URLSearchParams({...(playlist?{UserId:account.userId}:{ParentId:parent}),StartIndex:String(start),Limit:'100',Fields:'Size',EnableUserData:'true'})
  const data=await json<Items>(account,'GET',endpoint(account,`${playlist?'Playlists/'+segment(serverItemId(parent))+'/Items':'Users/'+segment(account.userId)+'/Items'}?${params}`))
  return{entries:data.Items.map(entry),nextCursor:data.Items.length>0&&start+data.Items.length<data.TotalRecordCount?String(start+data.Items.length):undefined}
 },
 async resolve(account,item){
  const preferences=(await getSettings()).serverPlayback||defaultServerPlayback()
  const max=getMediaServerMaxStreamingBitrate(preferences.quality)
  const result=await nativeCall<{media:import('./contracts').ResolvedMedia;context:{mediaSourceId:string;playSessionId:string;playMethod:string}}>('server_resolve',{accountId:account.id,itemId:item.id,profile:buildMediaServerDeviceProfile(max,preferences.compatibility,preferences.customProfile),maxBitrate:max??null,directOnly:preferences.compatibility==='directPlay',autoBitrate:preferences.quality==='auto',preferredSourceId:getServerPlaybackSource(account.id,item.id)})
  playbackContexts.set(`${account.id}:${item.id}`,result.context)
  return result.media
 }
}
const playbackContexts=new Map<string,{mediaSourceId:string;playSessionId:string;playMethod:string}>()
export async function serverFavorite(account:Account,itemId:string,value:boolean){itemId=serverItemId(itemId);if(account.providerId==='plex'){await plexFavorite(account,itemId,value);return}await request(account,value?'POST':'DELETE',endpoint(account,`Users/${segment(account.userId||'')}/FavoriteItems/${segment(itemId)}`))}
export async function serverReport(account:Account,itemId:string,state:'start'|'progress'|'stop',position:number,paused=false){
 if(account.providerId==='plex'){await plexReport(account,itemId,state,position,paused);return}
 const context=playbackContexts.get(`${account.id}:${itemId}`);if(!context)return
 await request(account,'POST',endpoint(account,`Sessions/Playing${state==='start'?'':state==='stop'?'/Stopped':'/Progress'}`),JSON.stringify({ItemId:itemId,MediaSourceId:context.mediaSourceId,PlaySessionId:context.playSessionId,PositionTicks:Math.round(position*10000000),IsPaused:paused,CanSeek:true,PlayMethod:context.playMethod}),{'Content-Type':'application/json'})
 if(state==='stop')playbackContexts.delete(`${account.id}:${itemId}`)
}
