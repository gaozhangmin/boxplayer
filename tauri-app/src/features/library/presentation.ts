import type {VideoItem} from './catalog'
export interface VideoGroup {key:string;item:VideoItem;files:VideoItem[]}
/** Group only by an authoritative metadata identity, never a title guess. */
export function videoGroups(items:VideoItem[]):VideoGroup[]{
 const groups=new Map<string,VideoGroup>()
 for(const item of items){
  const key=item.type==='unmatched'?item.id:item.tmdbId?`${item.type}:tmdb:${item.tmdbId}`:item.seriesId?`${item.sourceId}:series:${item.seriesId}`:item.id
  const group=groups.get(key)
  if(group)group.files.push(item)
  else groups.set(key,{key,item,files:[item]})
 }
 for(const group of groups.values()){
  if(group.item.type==='tv')group.files.sort((a,b)=>(a.seasonNumber||0)-(b.seasonNumber||0)||(a.episodeNumber||0)-(b.episodeNumber||0)||a.fileName.localeCompare(b.fileName,undefined,{numeric:true}))
 }
 return [...groups.values()]
}
