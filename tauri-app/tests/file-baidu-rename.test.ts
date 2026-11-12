import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {rawRequest} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {renameRemoteFile,supportsRemoteRename} from '@/features/files/drive/renameMutations'
import {acknowledgeBaiduRename,type BaiduRenameResult} from '@/features/files/drive/baiduRenameMutations'
vi.mock('@/features/sources/transport',()=>({rawRequest:vi.fn(),json:vi.fn(),request:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
const response=(data:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let index=0,account:any,file:any,actual:any,ack:any,apply:boolean,current:boolean
const posts=()=>vi.mocked(rawRequest).mock.calls.filter(call=>call[1]==='POST')
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());account={id:'rename-'+ ++index,providerId:'baidu',userId:'owner',name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore().accounts=[account]
 file={file_id:'101',parent_file_id:'/Movie',isDir:false,path:'/Movie/Old.mkv',name:'Old.mkv'};actual={fs_id:'101',path:file.path,filename:file.name,isdir:0};ack={errno:0,info:[{errno:0,path:file.path}]};apply=true;current=true
 vi.mocked(rawRequest).mockImplementation(async(_account,method,_url,body)=>{
  if(method==='GET')return response({errno:0,list:[actual]})
  if(apply&&ack.errno===0&&!(ack.info||[]).some((row:any)=>row.errno!==0)){const name=JSON.parse(new URLSearchParams(body).get('filelist')!)[0].newname;actual={...actual,path:'/Movie/'+name,filename:name}}
  return response(ack)
 })
})
const run=(name='New.mkv')=>renameRemoteFile(account,file,name,()=>current)
it('retains original rename form, overwrite/async settings and confirms stable identity, name, type and path',async()=>{
 expect(supportsRemoteRename(account)).toBe(true);const result=await run('新名字.mkv')
 expect(result).toMatchObject({file_id:'101',name:'新名字.mkv',isDir:false,previousPath:'/Movie/Old.mkv',path:'/Movie/新名字.mkv'})
 const call=posts()[0]!,url=new URL(call[2]),form=new URLSearchParams(call[3]);expect(url.searchParams.toString()).toBe('method=filemanager&opera=rename');expect(form.get('async')).toBe('1');expect(form.get('ondup')).toBe('overwrite');expect(JSON.parse(form.get('filelist')!)).toEqual([{path:file.path,newname:'新名字.mkv'}]);expect(call[4]).toEqual({'user-agent':'pan.baidu.com','content-type':'application/x-www-form-urlencoded'})
 expect(rawRequest).toHaveBeenCalledTimes(3);acknowledgeBaiduRename(account.id,result as BaiduRenameResult)
})
it('retains a real folder type instead of returning the original adapter hardcoded folder flag for all files',async()=>{
 file={...file,isDir:true,path:'/Movie/Folder',name:'Folder'};actual={...actual,isdir:1,path:file.path,filename:file.name};ack.info[0].path=file.path
 expect(await run('Renamed')).toMatchObject({file_id:'101',isDir:true,path:'/Movie/Renamed',previousPath:'/Movie/Folder'})
})
it('requires actual metadata completion even if the response contains an accepted task ID',async()=>{
 apply=false;ack={errno:0,info:[],taskid:123};await expect(run()).rejects.toThrow('尚未确认');expect(posts()).toHaveLength(1)
 actual={...actual,path:'/Movie/New.mkv',filename:'New.mkv'};expect(await run()).toMatchObject({path:actual.path,previousPath:file.path});expect(posts()).toHaveLength(1)
})
it('does not blindly repost after an unknown network result',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementation((...args)=>args[1]==='POST'?Promise.reject(Error('network lost')):original(...args))
 await expect(run()).rejects.toThrow('尚未确认');actual={...actual,path:'/Movie/New.mkv',filename:'New.mkv'};expect(await run()).toMatchObject({name:'New.mkv'});expect(posts()).toHaveLength(1)
})
it.each([{errno:403},{errno:0,info:[{errno:-8,path:'/Movie/Old.mkv'}]}])('rejects definitive business/row failure %j and permits a later genuine retry',async value=>{
 ack=value;await expect(run()).rejects.toThrow('拒绝');expect(posts()).toHaveLength(1);ack={errno:0,info:[{errno:0,path:file.path}]};expect(await run()).toMatchObject({name:'New.mkv'});expect(posts()).toHaveLength(2)
})
it('rejects conflicting post-operation metadata without another write on retry',async()=>{
 apply=false;await expect(run()).rejects.toThrow('尚未确认');actual={...actual,path:'/Else/New.mkv',filename:'New.mkv'};await expect(run()).rejects.toThrow('尚未确认');expect(posts()).toHaveLength(1)
})
it.each([{isdir:1},{path:'/Movie/Other.mkv',filename:'Other.mkv'},{fs_id:'102'}])('checks pre-operation identity before issuing POST %j',async patch=>{
 actual={...actual,...patch};await expect(run()).rejects.toThrow('百度');expect(posts()).toHaveLength(0)
})
it('stops before writing if the source switches during preflight',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementation(async(...args)=>{const result=await original(...args);current=false;return result})
 await expect(run()).rejects.toThrow('切换');expect(posts()).toHaveLength(0)
})
it('keeps the submitted receipt if the pane closes after POST and queries only on retry',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementation(async(...args)=>{const result=await original(...args);if(args[1]==='POST')current=false;return result})
 await expect(run()).rejects.toThrow('切换');current=true;expect(await run()).toMatchObject({name:'New.mkv'});expect(posts()).toHaveLength(1)
})
it('rejects a changed account identity before writing',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementation(async(...args)=>{const result=await original(...args);useFileSourcesStore().accounts=[{...account,userId:'different'}];return result})
 await expect(run()).rejects.toThrow('身份已变化');expect(posts()).toHaveLength(0)
})
it('coalesces simultaneous rename requests while metadata is loading',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;let finish!:(value:any)=>void
 vi.mocked(rawRequest).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve)).mockImplementation(original)
 const first=run(),second=run();expect(rawRequest).toHaveBeenCalledTimes(1);finish(response({errno:0,list:[actual]}));expect(await first).toMatchObject({name:'New.mkv'});expect(await second).toMatchObject({name:'New.mkv'});expect(posts()).toHaveLength(1)
})
it('keeps confirmed receipts until local sync acknowledges them and can repair sync without another write',async()=>{
 const first=await run();expect(await run()).toMatchObject({previousPath:file.path});expect(posts()).toHaveLength(1);acknowledgeBaiduRename(account.id,first as BaiduRenameResult)
 file={...file,path:'/Movie/New.mkv',name:'New.mkv'};expect(await run('Later.mkv')).toMatchObject({previousPath:'/Movie/New.mkv',path:'/Movie/Later.mkv'});expect(posts()).toHaveLength(2)
})
it('does not submit another name while an earlier result remains unknown',async()=>{
 apply=false;await expect(run()).rejects.toThrow('尚未确认');await expect(run('Another.mkv')).rejects.toThrow('此前重命名');expect(posts()).toHaveLength(1)
})
it('treats an unchanged name as a verified no-op',async()=>{expect(await run('Old.mkv')).toMatchObject({path:file.path,previousPath:file.path});expect(posts()).toHaveLength(0)})
it('distinguishes a definite HTTP refusal from an unknown server error',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;let rejected=false
 vi.mocked(rawRequest).mockImplementation((...args)=>{if(args[1]==='POST'&&!rejected){rejected=true;return Promise.resolve(response({},403))}return original(...args)})
 await expect(run()).rejects.toThrow('拒绝');expect(await run()).toMatchObject({name:'New.mkv'});expect(posts()).toHaveLength(2)
})
it('does not repost after HTTP 503 even when the server did not return a usable receipt',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementation((...args)=>args[1]==='POST'?Promise.resolve(response({},503)):original(...args))
 await expect(run()).rejects.toThrow('尚未确认');actual={...actual,path:'/Movie/New.mkv',filename:'New.mkv'};expect(await run()).toMatchObject({name:'New.mkv'});expect(posts()).toHaveLength(1)
})
