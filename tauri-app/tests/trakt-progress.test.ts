import {expect,it} from 'vitest'
import {playbackPatches} from '@/features/trakt/progress'
import type {VideoItem} from '@/features/library/catalog'
const video=(id:string,extra:Partial<VideoItem>={}):VideoItem=>({id,sourceId:'s',fileId:id,fileName:id,name:id,type:'movie',local:true,addedAt:'2026',genres:[],size:0,tmdbId:42,...extra})
it('updates exact episode identity and all file versions without confusing films or newer local progress',()=>{
 const items=[video('film'),video('episode-a',{type:'tv',seasonNumber:1,episodeNumber:2}),video('episode-b',{type:'tv',seasonNumber:1,episodeNumber:2}),video('other-season',{type:'tv',seasonNumber:2,episodeNumber:2}),video('newer',{type:'tv',seasonNumber:1,episodeNumber:2,lastWatched:'2026-11-07T12:00:00Z',progress:80})]
 const patches=playbackPatches(items,[{type:'episode',tmdbId:42,season:1,episode:2,progress:50,pausedAt:'2026-11-07T10:00:00Z'}])
 expect(patches.map(p=>p.id)).toEqual(['episode-a','episode-b']);expect(patches[0]!.patch).toMatchObject({progress:50,continueHidden:false});expect(patches[0]!.patch).not.toHaveProperty('watched')
})
it('filters invalid progress and applies sync range and the newest duplicate remote record',()=>{
 const now=Date.parse('2026-11-07T12:00:00Z'),rows=[{type:'movie' as const,tmdbId:42,progress:20,pausedAt:'2026-11-06T10:00:00Z'},{type:'movie' as const,tmdbId:42,progress:60,pausedAt:'2026-11-07T10:00:00Z'},{type:'movie' as const,tmdbId:42,progress:100,pausedAt:'2026-11-07T11:00:00Z'}]
 expect(playbackPatches([video('film')],rows,7,now)[0]!.patch.progress).toBe(60)
 expect(playbackPatches([video('film')],rows,7,now+30*86400000)).toEqual([])
})
