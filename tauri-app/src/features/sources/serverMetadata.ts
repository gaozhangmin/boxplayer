import {nativeCall,isNative} from '@/platform/native'
import type {Account} from './contracts'
import {endpoint,json,request} from './transport'
export interface ServerMetadata {name:string;overview?:string;year?:string;rating?:number;genres:string[];certification?:string;type:'movie'|'tv'|'unmatched';watched:boolean;favorite:boolean;seriesId?:string;seriesName?:string;seasonNumber?:number;episodeNumber?:number;imagePath?:string;networks:string[]}
export async function serverMetadata(account:Account,id:string):Promise<ServerMetadata>{
 if(account.providerId==='plex'){
  const result=await json<{MediaContainer:{Metadata?:Record<string,any>[]}}>(account,'GET',endpoint(account,`library/metadata/${encodeURIComponent(id)}`));const item=result.MediaContainer?.Metadata?.[0];if(!item)throw new Error('服务器条目不存在')
  return {name:item.title,overview:item.summary,year:item.year?String(item.year):undefined,rating:item.rating,genres:(item.Genre||[]).map((genre:any)=>genre.tag),certification:item.contentRating,type:item.type==='movie'?'movie':['show','season','episode'].includes(item.type)?'tv':'unmatched',watched:Number(item.viewCount||0)>0,favorite:Number(item.userRating||0)>=9,seriesId:item.grandparentRatingKey,seriesName:item.grandparentTitle,seasonNumber:item.parentIndex,episodeNumber:item.index,imagePath:item.thumb,networks:item.studio?[item.studio]:[]}
 }
 const item=await json<Record<string,any>>(account,'GET',endpoint(account,`Users/${encodeURIComponent(account.userId||'')}/Items/${encodeURIComponent(id)}`))
 return{name:item.Name,overview:item.Overview,year:item.ProductionYear?String(item.ProductionYear):undefined,rating:item.CommunityRating,genres:item.Genres||[],certification:item.OfficialRating,type:item.Type==='Movie'?'movie':['Series','Season','Episode'].includes(item.Type)?'tv':'unmatched',watched:!!item.UserData?.Played,favorite:!!item.UserData?.IsFavorite,seriesId:item.SeriesId,seriesName:item.SeriesName,seasonNumber:item.ParentIndexNumber,episodeNumber:item.IndexNumber,imagePath:item.ImageTags?.Primary?`Items/${encodeURIComponent(id)}/Images/Primary?maxWidth=400&tag=${encodeURIComponent(item.ImageTags.Primary)}`:undefined,networks:(item.Studios||[]).map((studio:any)=>studio.Name)}
}
export async function serverArtwork(account:Account,path:string){
 // Fetch through the account-bound gateway; credentials never enter an image URL.
 if(/^https?:/i.test(path)||path.startsWith('//'))throw new Error('服务器封面地址无效')
 if(isNative()){const data=await nativeCall<string>('server_artwork',{accountId:account.id,path});const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(data);if(!match)throw new Error('服务器封面格式无效');const bytes=Uint8Array.from(atob(match[2]!),char=>char.charCodeAt(0));return URL.createObjectURL(new Blob([bytes],{type:match[1]}))}
 const response=await request(account,'GET',endpoint(account,path));const type=Object.entries(response.headers).find(([key])=>key.toLowerCase()==='content-type')?.[1]||'image/jpeg'
 if(!/^image\/(jpeg|png|webp|avif)(;|$)/i.test(type))throw new Error('服务器封面格式无效')
 return URL.createObjectURL(new Blob([new Uint8Array(response.body)],{type}))
}
