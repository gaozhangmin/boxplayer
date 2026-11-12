import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useVideoCatalog,type VideoItem} from '@/features/library/catalog'
import {nativeCall} from '@/platform/native'
const state=vi.hoisted(()=>({snapshot:{schemaVersion:1,revision:0,items:[] as any[],playlists:{} as Record<string,string[]>,series:{}}}))
vi.mock('@/platform/native',()=>({isNative:()=>true,nativeCall:vi.fn(async(command:string,args:any)=>{if(command==='catalog_load')return structuredClone(state.snapshot);if(command==='catalog_save'){state.snapshot={...structuredClone(args.catalog),revision:state.snapshot.revision+1};return structuredClone(state.snapshot)}return undefined}),localList:vi.fn(),localSources:vi.fn(async()=>[])}))
vi.mock('@/features/sources/transport',()=>({accountsList:vi.fn(async()=>[]),json:vi.fn(),request:vi.fn(),endpoint:vi.fn()}))
const video=(id:string,patch:Partial<VideoItem>={}):VideoItem=>({id:JSON.stringify(['s',id]),sourceId:'s',fileId:id,fileName:id,name:id,type:'movie',local:true,addedAt:'2026',genres:[],size:0,...patch})
beforeEach(()=>{setActivePinia(createPinia());state.snapshot={schemaVersion:1,revision:0,items:[],playlists:{},series:{}};vi.clearAllMocks()})
it('preserves media covered by another root when removing a folder favorite',async()=>{
 const covered=video('covered',{folderPath:'shows/one',folderAncestors:['','shows'],catalogRoots:['','shows']})
 const exclusive=video('exclusive',{folderPath:'shows/two',folderAncestors:['shows'],catalogRoots:['shows']})
 state.snapshot.items=[covered,exclusive];state.snapshot.playlists={mix:[covered.id,exclusive.id]}
 const catalog=useVideoCatalog();await catalog.load();await catalog.removeFolder('s','shows')
 expect(catalog.items.map(item=>item.id)).toEqual([covered.id]);expect(catalog.data.playlists.mix).toEqual([covered.id]);expect(catalog.items[0]!.catalogRoots).toEqual([''])
})
it('opens an exact mixed-source queue and preserves each account identity',async()=>{
 const catalog=useVideoCatalog();const first=video('local'),remote=video('remote',{sourceId:'other',local:false})
 await catalog.playMany([first,remote],'loop')
 expect(nativeCall).toHaveBeenLastCalledWith('player_open_catalog_queue',{entries:[{sourceId:'s',fileId:'local',title:'local',local:true},{sourceId:'other',fileId:'remote',title:'remote',local:false}],index:0,loopPlayback:true})
})
it('records progress for matching native local identity only',async()=>{
 const first=video('hash',{fileId:'folder/movie.mkv'});state.snapshot.items=[first];const catalog=useVideoCatalog();await catalog.load()
 await catalog.recordProgress({sourceId:'s',itemId:'hash',sessionId:'p',state:'paused',position:50,duration:100} as any)
 expect(catalog.items[0]).toMatchObject({progress:50,watched:undefined})
 await catalog.recordProgress({sourceId:'another',itemId:'hash',sessionId:'q',state:'ended',position:100,duration:100} as any)
 expect(catalog.items[0]!.progress).toBe(50)
})

it('cancels a scan while listing is in flight without scraping or saving stale results',async()=>{
 const {localList,localSources}=await import('@/platform/native')
 vi.mocked(localSources).mockResolvedValue([{id:'s',name:'Synthetic',path:'/synthetic'}])
 let finish!:(value:any)=>void
 vi.mocked(localList).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 const catalog=useVideoCatalog(),work=catalog.scan('s')
 for(let n=0;n<20&&!finish;n++)await Promise.resolve()
 expect(finish).toBeTypeOf('function')
 catalog.cancelScan()
 finish({entries:[{id:'file',name:'Movie.mkv',relativePath:'Movie.mkv',isDirectory:false,playable:true,size:1}]})
 await work
 expect(vi.mocked(nativeCall).mock.calls.filter(([command])=>command==='catalog_metadata'||command==='catalog_save')).toEqual([])
 expect(catalog.scanning).toBe(false)
})

it('does not persist a completed scan cancelled while its final source refresh is pending',async()=>{
 const {localList,localSources}=await import('@/platform/native')
 const folders=[{id:'s',name:'Synthetic',path:'/synthetic'}]
 let finish!:(value:any)=>void
 vi.mocked(localSources).mockResolvedValueOnce(folders).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 vi.mocked(localList).mockResolvedValue({sourceId:'s',relativePath:'',parentPath:null,entries:[]})
 const catalog=useVideoCatalog(),work=catalog.scan('s')
 for(let n=0;n<30&&!finish;n++)await Promise.resolve()
 expect(finish).toBeTypeOf('function');catalog.cancelScan();finish(folders);await work
 expect(vi.mocked(nativeCall).mock.calls.filter(([command])=>command==='catalog_save')).toEqual([])
})

it('incremental rescans deduplicate file identity and preserve user progress, ratings and manual metadata',async()=>{
 const {localList,localSources}=await import('@/platform/native')
 vi.mocked(localSources).mockResolvedValue([{id:'s',name:'Synthetic',path:'/synthetic'}])
 const existing=video('file',{fileId:'Movie.mkv',name:'Edited title',metadataSource:'manual',watched:true,favorite:true,progress:61,personalRating:8,catalogRoots:[''],folderPath:'',folderAncestors:['']})
 state.snapshot.items=[existing];state.snapshot.playlists={mix:[existing.id]}
 vi.mocked(localList).mockResolvedValue({sourceId:'s',relativePath:'',parentPath:null,entries:[{id:'file',name:'Movie.mkv',relativePath:'Movie.mkv',isDirectory:false,playable:true,size:42,modified:0}]})
 const catalog=useVideoCatalog();await catalog.scan('s');await catalog.scan('s')
 expect(catalog.items).toHaveLength(1)
 expect(catalog.items[0]).toMatchObject({id:existing.id,name:'Edited title',metadataSource:'manual',progress:61,watched:true,favorite:true,personalRating:8,size:42,catalogRoots:['']})
 expect(catalog.data.playlists.mix).toEqual([existing.id])
})

it('complete rescans remove missing files only from the scanned root and clean memberships',async()=>{
 const {localList,localSources}=await import('@/platform/native');vi.mocked(localSources).mockResolvedValue([{id:'s',name:'Synthetic',path:'/synthetic'}]);vi.mocked(localList).mockResolvedValue({sourceId:'s',relativePath:'folder',parentPath:'',entries:[]})
 const exclusive=video('deleted',{catalogRoots:['folder']}),shared=video('shared',{catalogRoots:['folder','other']}),untouched=video('untouched',{catalogRoots:['other']})
 state.snapshot.items=[exclusive,shared,untouched];state.snapshot.playlists={mix:[exclusive.id,shared.id]};const catalog=useVideoCatalog();await catalog.scan('s','folder')
 expect(catalog.items.map(item=>item.id)).toEqual([shared.id,untouched.id]);expect(catalog.items[0]!.catalogRoots).toEqual(['other']);expect(catalog.data.playlists.mix).toEqual([shared.id])
})
it('listing errors never replace the last successful catalog',async()=>{
 const {localList,localSources}=await import('@/platform/native');vi.mocked(localSources).mockResolvedValue([{id:'s',name:'Synthetic',path:'/synthetic'}]);vi.mocked(localList).mockRejectedValue(Error('page failed'));state.snapshot.items=[video('kept')]
 const catalog=useVideoCatalog();await expect(catalog.scan('s')).rejects.toThrow('page failed');expect(state.snapshot.items).toHaveLength(1);expect(vi.mocked(nativeCall).mock.calls.some(([command])=>command==='catalog_save')).toBe(false)
})
it('incremental scans reuse successful metadata for unchanged files',async()=>{
 const {localList,localSources}=await import('@/platform/native');vi.mocked(localSources).mockResolvedValue([{id:'s',name:'Synthetic',path:'/synthetic'}]);const item=video('unchanged',{fileId:'Movie.mkv',size:42,metadataSource:'tmdb'});state.snapshot.items=[item];vi.mocked(localList).mockResolvedValue({sourceId:'s',relativePath:'',parentPath:null,entries:[{id:'unchanged',name:'Movie.mkv',relativePath:'Movie.mkv',isDirectory:false,playable:true,size:42,modified:0}]});await useVideoCatalog().scan('s');expect(vi.mocked(nativeCall).mock.calls.filter(([command])=>command==='catalog_metadata')).toEqual([]);expect(state.snapshot.items[0].metadataSource).toBe('tmdb')
})
it('never writes non-finite native progress values',async()=>{state.snapshot.items=[video('hash')];const catalog=useVideoCatalog();await catalog.load();await catalog.recordProgress({sourceId:'s',itemId:'hash',sessionId:'p',state:'paused',position:Number.NaN,duration:100} as any);expect(vi.mocked(nativeCall).mock.calls.some(([command])=>command==='catalog_save')).toBe(false)})
it('scrapes actual season and episode details while preserving expected coverage and cast',async()=>{
 const {localList,localSources}=await import('@/platform/native');vi.mocked(localSources).mockResolvedValue([{id:'s',name:'Synthetic',path:'/synthetic'}]);vi.mocked(localList).mockResolvedValue({sourceId:'s',relativePath:'',parentPath:null,entries:[{id:'episode',name:'Show.S01E02.mkv',relativePath:'Show.S01E02.mkv',isDirectory:false,playable:true,size:42,modified:0}]})
 vi.mocked(nativeCall).mockImplementation(async(command,args:any)=>{if(command==='catalog_load')return structuredClone(state.snapshot);if(command==='catalog_save'){state.snapshot={...structuredClone(args.catalog),revision:state.snapshot.revision+1};return structuredClone(state.snapshot)}if(command==='catalog_metadata')return args.season?{current_season:{id:10,season_number:1,name:'Season One',episodes:[{id:102,episode_number:2,name:'Actual Episode',runtime:50,still_path:'/still.jpg'}]}}:{tv:{id:42,name:'Show',seasons:[{season_number:1,episode_count:10}],credits:{cast:[{name:'Actor'}]}}}})
 const catalog=useVideoCatalog();await catalog.scan('s');expect(catalog.items[0]).toMatchObject({type:'tv',tmdbId:42,seasonNumber:1,episodeNumber:2,duration:3000,originalMetadata:{credits:{cast:[{name:'Actor'}]},expectedSeasons:[{seasonNumber:1,episodeCount:10}],seasons:[{seasonNumber:1,episodes:[{episodeNumber:2,name:'Actual Episode'}]}]}})
})
