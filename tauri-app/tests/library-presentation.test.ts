import {expect,it} from 'vitest'
import {videoGroups} from '@/features/library/presentation'
import type {VideoItem} from '@/features/library/catalog'
const item=(id:string,patch:Partial<VideoItem>={}):VideoItem=>({id,sourceId:'a',fileId:id,fileName:id,name:'same title',type:'tv',local:false,addedAt:'2026',genres:[],size:0,...patch})
it('groups known TV identities and orders episodes, without merging guessed names or server accounts',()=>{
 const rows=[item('e2',{tmdbId:12,seasonNumber:1,episodeNumber:2}),item('e1',{tmdbId:12,seasonNumber:1,episodeNumber:1}),item('unknown1'),item('unknown2'),item('a',{seriesId:'42'}),item('b',{seriesId:'42',sourceId:'b'})]
 const groups=videoGroups(rows)
 expect(groups).toHaveLength(5)
 expect(groups[0]!.files.map(item=>item.id)).toEqual(['e1','e2'])
})
it('keeps movie versions separate from a TV series with the same TMDB number',()=>{
 const groups=videoGroups([item('tv',{tmdbId:12}),item('movie1',{type:'movie',tmdbId:12}),item('movie2',{type:'movie',tmdbId:12})])
 expect(groups).toHaveLength(2)
 expect(groups[1]!.files).toHaveLength(2)
})
