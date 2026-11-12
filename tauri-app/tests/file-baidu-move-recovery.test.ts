import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {rawRequest} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {relocateRemoteFiles} from '@/features/files/drive/relocationMutations'
import {recoverBaiduMoves,recoveredBaiduLocation} from '@/features/files/drive/baiduMoveRecovery'
import {pendingBaiduMoves} from '@/features/files/drive/baiduMoveMutations'
import {emptyFilePreferences} from '@/features/files/preferences'
vi.mock('@/features/sources/transport',()=>({rawRequest:vi.fn(),json:vi.fn(),request:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let sequence=0,account:any,file:any,actual:any,current:boolean,snapshot:any,preferences:any,apply:boolean
const posts=()=>vi.mocked(rawRequest).mock.calls.filter(call=>call[1]==='POST')
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());account={id:'recovery-'+ ++sequence,providerId:'baidu',userId:'owner',name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore().accounts=[account]
 file={drive_id:account.id,file_id:'101',name:'Movie.mkv',isDir:false,path:'/Movie.mkv',parent_file_id:''};actual={fs_id:'101',filename:'Movie.mkv',path:file.path,isdir:0};current=true;apply=true;preferences=emptyFilePreferences();snapshot={items:[{id:'stable',sourceId:account.id,fileId:'101',name:'Manual',fileName:'Movie.mkv',metadataSource:'manual',folderPath:'',folderAncestors:[''],progress:24}]}
 vi.mocked(rawRequest).mockImplementation(async(_account,method,raw)=>{const url=new URL(raw);if(method==='POST'){if(apply)actual={...actual,path:'/Dest/'+actual.filename};return response({errno:0,info:[],taskid:5})}return response({errno:0,list:[url.searchParams.get('fsids')==='[12]'?{fs_id:'12',filename:'Dest',path:'/Dest',isdir:1}:actual]})})
})
const run=()=>relocateRemoteFiles(account,[file],'12',false,()=>current,['','12'])
it('uses saved target ancestors to confirm and synchronize an already moved ID without the old listing',async()=>{
 expect((await run()).success).toEqual(['101']);expect(pendingBaiduMoves(account)[0]).toMatchObject({fileId:'101',ancestors:['','12']})
 const catalog={scanning:true,scanSource:account.id,cancelScan:vi.fn(),update:vi.fn(async(mutate:any)=>mutate(snapshot))}
 const result=await recoverBaiduMoves(account,catalog,()=>preferences,()=>true)
 expect(result.confirmed.map(row=>row.file_id)).toEqual(['101']);expect(result.failures).toEqual([]);expect(snapshot.items[0]).toMatchObject({id:'stable',name:'Manual',folderPath:'12',folderAncestors:['','12'],progress:24});expect(catalog.cancelScan).toHaveBeenCalledTimes(1);expect(posts()).toHaveLength(1);expect(pendingBaiduMoves(account)).toEqual([])
})
it('does not treat an uncompleted move as a successful recovery and never reposts it',async()=>{
 apply=false;expect((await run()).success).toEqual([]);const update=vi.fn();const first=await recoverBaiduMoves(account,{update},()=>preferences,()=>true);expect(first.confirmed).toEqual([]);expect(first.failures[0]).toContain('尚未确认');expect(update).not.toHaveBeenCalled()
 actual={...actual,path:'/Dest/Movie.mkv'};const second=await recoverBaiduMoves(account,{update:async mutate=>mutate(snapshot)},()=>preferences,()=>true);expect(second.confirmed).toHaveLength(1);expect(posts()).toHaveLength(1)
})
it('retains local sync failures for another recovery without changing remote state',async()=>{
 await run();const first=await recoverBaiduMoves(account,{update:vi.fn().mockRejectedValue(Error('local conflict'))},()=>preferences,()=>true);expect(first.observed).toHaveLength(1);expect(first.confirmed).toEqual([]);expect(first.failures[0]).toContain('local conflict');expect(pendingBaiduMoves(account)).toHaveLength(1)
 await recoverBaiduMoves(account,{update:async mutate=>mutate(snapshot)},()=>preferences,()=>true);expect(posts()).toHaveLength(1);expect(pendingBaiduMoves(account)).toEqual([])
})
it('does not recover another source or another login identity sharing an account UUID',async()=>{
 await run();const update=vi.fn();const other={...account,id:'different'};useFileSourcesStore().accounts.push(other);expect((await recoverBaiduMoves(other,{update},()=>preferences,()=>true)).attempted).toBe(0)
 const replaced={...account,userId:'different-owner'};useFileSourcesStore().accounts=[replaced];expect((await recoverBaiduMoves(replaced,{update},()=>preferences,()=>true)).attempted).toBe(0);expect(update).not.toHaveBeenCalled();expect(posts()).toHaveLength(1)
})
it('stops before catalog commit after the pane switches while checking metadata',async()=>{
 await run();const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementation(async(...args)=>{const result=await original(...args);current=false;return result});const update=vi.fn()
 await expect(recoverBaiduMoves(account,{update},()=>preferences,()=>current)).rejects.toThrow('变化');expect(update).not.toHaveBeenCalled();expect(posts()).toHaveLength(1);expect(pendingBaiduMoves(account)).toHaveLength(1)
})
it('redirects only confirmed physical folder locations and keeps stable IDs and similar prefixes',()=>{
 const move:any={file_id:'101',isDir:true,previousPath:'/Old',path:'/Dest/Old'}
 expect(recoveredBaiduLocation('/Old',[move])).toBe('/Dest/Old');expect(recoveredBaiduLocation('/Old/Sub',[move])).toBe('/Dest/Old/Sub');expect(recoveredBaiduLocation('101',[move])).toBe('101');expect(recoveredBaiduLocation('/OldOther',[move])).toBe('/OldOther')
})

it('merges the latest preference snapshot after asynchronous catalog synchronization',async()=>{
 file={...file,isDir:true,path:'/Folder',name:'Folder'};actual={...actual,isdir:1,path:'/Folder',filename:'Folder'};await run()
 const latest=emptyFilePreferences();latest.favorites=[{id:JSON.stringify([account.id,'/Folder']),sourceId:account.id,path:'/Folder',name:'Latest custom name',local:false},{id:'other',sourceId:'other',path:'/Other',name:'Keep',local:false}]
 await recoverBaiduMoves(account,{update:async mutate=>{mutate(snapshot);preferences=latest}},()=>preferences,()=>true)
 expect(latest.favorites[0]).toMatchObject({path:'/Dest/Folder',name:'Latest custom name'});expect(latest.favorites[1]).toMatchObject({id:'other',name:'Keep'});expect(posts()).toHaveLength(1)
})
