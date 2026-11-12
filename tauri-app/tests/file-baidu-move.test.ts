import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {rawRequest} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {relocateRemoteFiles,supportsRemoteCopy,supportsRemoteRelocation} from '@/features/files/drive/relocationMutations'
import {acknowledgeBaiduMove} from '@/features/files/drive/baiduMoveMutations'
import {renameRemoteFile} from '@/features/files/drive/renameMutations'
vi.mock('@/features/sources/transport',()=>({rawRequest:vi.fn(),json:vi.fn(),request:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
const response=(data:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let index=0,account:any,file:any,actual:any,target:any,ack:any,apply:boolean,current:boolean
const posts=()=>vi.mocked(rawRequest).mock.calls.filter(call=>call[1]==='POST')
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());account={id:'move-'+ ++index,providerId:'baidu',userId:'owner',name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore().accounts=[account]
 file={drive_id:account.id,file_id:'101',parent_file_id:'11',name:'Movie.mkv',isDir:false,path:'/Old/Movie.mkv'};actual={fs_id:'101',path:file.path,filename:file.name,isdir:0};target={fs_id:'12',path:'/Dest',filename:'Dest',isdir:1};ack={errno:0,info:[{errno:0,path:file.path}]};apply=true;current=true
 vi.mocked(rawRequest).mockImplementation(async(_account,method,raw,body)=>{
  const url=new URL(raw)
  if(method==='GET')return response({errno:0,list:[url.searchParams.get('fsids')==='[12]'?target:actual]})
  if(apply&&ack.errno===0&&!(ack.info||[]).some((row:any)=>row.errno!==0)){const row=JSON.parse(new URLSearchParams(body).get('filelist')!)[0];actual={...actual,path:row.dest!==undefined?(row.dest==='/'?'':row.dest)+'/'+actual.filename:actual.path.slice(0,actual.path.lastIndexOf('/')+1)+row.newname,filename:row.newname||actual.filename}}
  return response(ack)
 })
})
const run=(destination='12',files=[file])=>relocateRemoteFiles(account,files,destination,false,()=>current)
it('retains original move form and verifies actual stable identity at the destination',async()=>{
 expect(supportsRemoteRelocation(account)).toBe(true);expect(supportsRemoteCopy(account)).toBe(true)
 const result=await run();expect(result).toMatchObject({success:['101'],failures:[],baidu:[{file_id:'101',parent_file_id:'12',path:'/Dest/Movie.mkv',previousPath:file.path,destinationPath:'/Dest'}]})
 const call=posts()[0]!,form=new URLSearchParams(call[3]);expect(new URL(call[2]).searchParams.toString()).toBe('method=filemanager&opera=move');expect(form.get('async')).toBe('1');expect(form.get('ondup')).toBe('fail');expect(JSON.parse(form.get('filelist')!)).toEqual([{path:file.path,dest:'/Dest'}]);acknowledgeBaiduMove(account.id,result.baidu![0]!)
})
it('maps root destination aliases without querying a fake root file ID',async()=>{
 const result=await run('baidu_root');expect(result.success).toEqual(['101']);expect(result.baidu![0]).toMatchObject({parent_file_id:'',path:'/Movie.mkv',destinationPath:'/'});expect(rawRequest).toHaveBeenCalledTimes(3)
})
it.each([{isdir:0},{fs_id:'other'}])('rejects unconfirmed destination %j before writing',async patch=>{
 target={...target,...patch};expect((await run()).success).toEqual([]);expect(posts()).toHaveLength(0)
})
it('rejects same-parent and descendant targets before writing',async()=>{
 target={...target,path:'/Old',filename:'Old'};expect((await run()).success).toEqual([]);expect(posts()).toHaveLength(0)
 actual={...actual,path:'/Old',filename:'Old',isdir:1};file={...file,path:'/Old',name:'Old',isDir:true};target={...target,path:'/Old/Sub',filename:'Sub'};expect((await run()).success).toEqual([]);expect(posts()).toHaveLength(0)
})
it('keeps accepted or unknown moves query-only until actual metadata confirms completion',async()=>{
 apply=false;ack={errno:0,info:[],taskid:123};expect((await run()).success).toEqual([]);actual={...actual,path:'/Dest/Movie.mkv'};expect((await run()).success).toEqual(['101']);expect(posts()).toHaveLength(1)
})
it('does not infer completion from a changed name or a wrong final parent',async()=>{
 apply=false;expect((await run()).success).toEqual([]);actual={...actual,path:'/Other/Movie.mkv'};expect((await run()).success).toEqual([]);actual={...actual,path:'/Dest/Other.mkv',filename:'Other.mkv'};expect((await run()).success).toEqual([]);expect(posts()).toHaveLength(1)
})
it.each([{errno:403},{errno:0,info:[{errno:-8,path:'/Old/Movie.mkv'}]}])('permits retry after a definite rejection %j',async value=>{
 ack=value;expect((await run()).success).toEqual([]);ack={errno:0,info:[{errno:0,path:file.path}]};expect((await run()).success).toEqual(['101']);expect(posts()).toHaveLength(2)
})
it('preserves per-file partial failures',async()=>{
 const result=await run('12',[file,{...file,file_id:'102',name:'Other.mkv',path:'/Old/Other.mkv'}]);expect(result.success).toEqual(['101']);expect(result.failures).toHaveLength(1);expect(posts()).toHaveLength(1)
})
it('stops before POST when the pane switches while resolving a destination',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementation(async(...args)=>{const value=await original(...args);if(new URL(args[2]).searchParams.get('fsids')==='[12]')current=false;return value});expect((await run()).success).toEqual([]);expect(posts()).toHaveLength(0)
})
it('retains a submitted move after pane closure and queries only on retry',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementation(async(...args)=>{const value=await original(...args);if(args[1]==='POST')current=false;return value});expect((await run()).success).toEqual([]);current=true;expect((await run()).success).toEqual(['101']);expect(posts()).toHaveLength(1)
})
it('prevents a conflicting rename until the confirmed move is synchronized',async()=>{
 const result=await run();await expect(renameRemoteFile(account,{...file,path:actual.path,parent_file_id:'12'},'New.mkv')).rejects.toThrow('此前');expect(posts()).toHaveLength(1)
 acknowledgeBaiduMove(account.id,result.baidu![0]!);expect(await renameRemoteFile(account,{...file,path:actual.path,parent_file_id:'12'},'New.mkv')).toMatchObject({name:'New.mkv',path:'/Dest/New.mkv'});expect(posts()).toHaveLength(2)
})
it('does not submit a move over an unconfirmed rename',async()=>{
 apply=false;await expect(renameRemoteFile(account,{...file,parent_file_id:'/Old'},'New.mkv')).rejects.toThrow('尚未确认');expect((await run()).success).toEqual([]);expect(posts()).toHaveLength(1)
})
it('does not submit a move when copy metadata preflight fails',async()=>{
 expect((await relocateRemoteFiles(account,[file],'12',true,()=>true)).success).toEqual([]);expect(posts()).toHaveLength(0)
})
it('checks the selected target identity again instead of trusting an old path reused by a different folder',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementation(async(...args)=>{const value=await original(...args);if(args[1]==='POST')target={...target,path:'/Else/Dest'};return value})
 expect((await run()).success).toEqual([]);expect(posts()).toHaveLength(1);target={...target,path:'/Dest'};expect((await run()).success).toEqual(['101']);expect(posts()).toHaveLength(1)
})
it('does not submit against a destination whose recorded hierarchy no longer matches its current path',async()=>{
 target={...target,path:'/Other/Dest'};const result=await relocateRemoteFiles(account,[file],'12',false,()=>true,['','12']);expect(result.success).toEqual([]);expect(result.failures[0]).toContain('层级已变化');expect(posts()).toHaveLength(0)
})
