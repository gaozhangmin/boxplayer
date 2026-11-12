import type { PlaybackProgress } from './client'
import type { VideoItem } from '@/features/library/catalog'
// Host owns catalog writes. Never infer external IDs from titles or file IDs.
export function playbackPatches(items:VideoItem[],records:PlaybackProgress[],range=-1,now=Date.now()){
 const latest=new Map<string,PlaybackProgress>()
 for(const record of records){const at=Date.parse(record.pausedAt);if(!Number.isFinite(at)||!Number.isSafeInteger(record.tmdbId)||record.tmdbId<=0||!Number.isFinite(record.progress)||record.progress<=0||record.progress>=100||range>0&&at<now-range*86400000)continue
 const key=JSON.stringify([record.type,record.tmdbId,record.season,record.episode]);if(at>Date.parse(latest.get(key)?.pausedAt||'')||!latest.has(key))latest.set(key,record)}
 return items.flatMap(item=>{const record=[...latest.values()].find(record=>item.tmdbId===record.tmdbId&&(record.type==='movie'?item.type==='movie':item.type==='tv'&&item.seasonNumber===record.season&&item.episodeNumber===record.episode));if(!record||Date.parse(item.lastWatched||'')>Date.parse(record.pausedAt))return[];return[{id:item.id,patch:{progress:record.progress,lastWatched:record.pausedAt,continueHidden:false} satisfies Partial<VideoItem>}]})
}
