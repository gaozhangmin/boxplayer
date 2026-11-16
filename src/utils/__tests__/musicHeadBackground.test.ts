import { beforeEach, expect, it, vi } from 'vitest'
const ports = vi.hoisted(() => ({read:vi.fn(),local:vi.fn(),source:vi.fn(),row:vi.fn(),update:vi.fn()}))
vi.mock('../proxyhelper',()=>({getRawUrl:ports.source}))
vi.mock('../db',()=>({default:{getMusicTrackById:ports.row}}))
vi.mock('../../store/musiclibrary',()=>({default:()=>({updateTrackEnrichment:ports.update})}))
import {scheduleTrackHeads,readTrackHead,enrichPlayingTrack,scheduleLocalTrackHeads,isLocalAudioURL} from '../musicHeadMetadata'
beforeEach(()=>{
  vi.clearAllMocks()
  vi.stubGlobal('window',{WebReadMusicHead:ports.read,WebReadMusicLocal:ports.local})
  ports.local.mockResolvedValue({size:4194304,version:'fixture',base64:'AA=='})
  vi.stubGlobal('Worker',class{
    onmessage:any;onerror:any;terminate(){};
    postMessage(data:any){queueMicrotask(()=>{
      if(data.mode==='local')this.onmessage({data:{mode:'local-range',id:data.id,requestId:data.id,position:2097152,length:64}})
      else this.onmessage({data:{id:data.requestId||data.id,result:{status:'parsed',tags:{title:'Embedded',durationSec:12}}}})
    })}
  })
})
it('full local IO is detached and a deleted row is never recreated',async()=>{
  let finish!:(value:unknown)=>void
  ports.local.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  const track={id:'local-row',user_id:'local',file_id:'file',file_name:'song.wav',head_tag_version:1} as any
  ports.row.mockResolvedValueOnce(track).mockResolvedValue(undefined)
  expect(scheduleTrackHeads([track,track],{url:'file:///music/song.wav'})).toBeUndefined()
  await vi.waitFor(()=>expect(ports.local).toHaveBeenCalledTimes(1))
  expect(ports.update).not.toHaveBeenCalled()
  finish({size:4194304,version:'fixture'})
  await vi.waitFor(()=>expect(ports.row).toHaveBeenCalledTimes(2))
  expect(ports.update).not.toHaveBeenCalled()
  expect(ports.read).not.toHaveBeenCalled()
})
it('remote audio is never read for metadata even on explicit playback',async()=>{
  const remote={id:'remote',user_id:'drive',file_id:'song'} as any
  expect(await readTrackHead(remote,{url:'https://example.test/song'})).toEqual({})
  expect(enrichPlayingTrack(remote,{url:'https://example.test/song'})).toBeUndefined()
  expect(ports.read).not.toHaveBeenCalled();expect(ports.local).not.toHaveBeenCalled();expect(ports.source).not.toHaveBeenCalled()
})
it('local imports upgrade head-only tags to full parsing and skip remote locators',async()=>{
  const first={user_id:'local',file_id:'a',file_name:'a.wav',local_url:'file:///music/a.wav',head_tag_version:1} as any
  const second={user_id:'local',file_id:'b',file_name:'b.wav',local_url:'file:///music/b.wav'} as any
  expect(scheduleLocalTrackHeads([first,second,{user_id:'drive',local_url:'https://example.test/audio'} as any,
    {user_id:'local',local_url:'file://nas/share/audio.wav'} as any])).toBeUndefined()
  await vi.waitFor(()=>expect(second.local_tag_version).toBe(1))
  expect(first.local_tag_version).toBe(1);expect(first.title).toBe('Embedded');expect(first.duration_ms).toBe(12000)
  expect(ports.local.mock.calls.filter(call=>call[0].offset!==undefined).map(call=>call[0].url)).toEqual(['file:///music/a.wav','file:///music/b.wav'])
  expect(ports.local.mock.calls.some(call=>call[0].offset>1048576)).toBe(true)
  expect(ports.source).not.toHaveBeenCalled();expect(ports.read).not.toHaveBeenCalled()
  expect(isLocalAudioURL('file://nas/music/song.flac')).toBe(false)
  expect(isLocalAudioURL('smb://nas/song.flac')).toBe(false)
})
