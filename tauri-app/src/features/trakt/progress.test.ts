import { describe,it,expect } from 'vitest'
import {playbackPatches} from './progress'
import type {VideoItem} from '@/features/library/catalog'
import type {PlaybackProgress} from './client'
const now=Date.parse('2026-11-07T00:00:00Z')
const movie=(id='movie',patch:Partial<VideoItem>={}):VideoItem=>({id,sourceId:'synthetic',fileId:id,fileName:'video.mp4',name:'Movie',type:'movie',local:true,addedAt:'2026-01-01',genres:[],size:1,tmdbId:42,...patch})
const record=(patch:Partial<PlaybackProgress>={}):PlaybackProgress=>({type:'movie',tmdbId:42,progress:35,pausedAt:'2026-11-06T00:00:00Z',...patch})
describe('Trakt progress import',()=>{
 it('imports percentage units, every exact file version, and clears continue suppression',()=>{const result=playbackPatches([movie('one'),movie('two')],[record()],-1,now);expect(result.map(row=>row.id)).toEqual(['one','two']);expect(result[0]!.patch).toEqual({progress:35,lastWatched:'2026-11-06T00:00:00Z',continueHidden:false})})
 it('never guesses identities from matching names or provider IDs',()=>{expect(playbackPatches([movie('42',{tmdbId:undefined}),movie('other',{tmdbId:43})],[record()])).toEqual([])})
 it('matches TV show ID plus exact season and episode, including specials season zero',()=>{const items=[movie('special',{type:'tv',seasonNumber:0,episodeNumber:1}),movie('different',{type:'tv',seasonNumber:1,episodeNumber:1}),movie('aggregate',{type:'tv'})];expect(playbackPatches(items,[record({type:'episode',season:0,episode:1})]).map(row=>row.id)).toEqual(['special'])})
 it('deduplicates by latest timestamp without overwriting newer local playback',()=>{const records=[record({progress:70}),record({pausedAt:'2026-11-05T00:00:00Z',progress:10})];expect(playbackPatches([movie()],records)[0]!.patch.progress).toBe(70);expect(playbackPatches([movie('newer',{lastWatched:'2026-11-07T00:00:00Z'})],records)).toEqual([])})
 it('applies the configured time range, preserves the boundary, and supports all time',()=>{const old=record({pausedAt:'2026-10-31T00:00:00Z'});expect(playbackPatches([movie()],[old],7,now)).toHaveLength(1);expect(playbackPatches([movie()],[record({pausedAt:'2026-10-30T23:59:59Z'})],7,now)).toEqual([]);expect(playbackPatches([movie()],[old],-1,now)).toHaveLength(1)})
 it('rejects invalid progress, timestamps and external identities',()=>{for(const bad of [record({progress:0}),record({progress:100}),record({progress:NaN}),record({progress:Infinity}),record({pausedAt:'bad'}),record({tmdbId:0}),record({tmdbId:1.5})])expect(playbackPatches([movie()],[bad])).toEqual([])})
})
