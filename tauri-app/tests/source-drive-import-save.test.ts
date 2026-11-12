import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {bindDrivePane,type DrivePanePort} from '@/features/files/drive/ports'
import {createShareImportSession} from '@/features/files/drive/importShareSession'
import {createShareImportWriter} from '@/features/files/drive/importShareWriter'
import {useFileSourcesStore} from '@/stores/fileSources'
import {nativeCall} from '@/platform/native'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn()}))
let unbind:()=>void
const share='abcdefghijk',source='account',target=JSON.stringify({driveId:'drive',fileId:'folder'}),response=(body:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(body))),finalUrl:''})
const body=(args:unknown)=>JSON.parse(new TextDecoder().decode(new Uint8Array((args as any).request.body)))
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});setActivePinia(createPinia())})
afterEach(()=>unbind?.())
async function setup(ids=['a','b']){
 const account={id:source,providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore().accounts=[account]
 const pane={sourceId:source,local:false,context:1,account,file:(id:string)=>id===target?{file_id:target,isDir:true}:undefined} as unknown as DrivePanePort;unbind=bindDrivePane(pane)
 vi.mocked(nativeCall).mockResolvedValueOnce(response({share_token:'cap'})).mockResolvedValueOnce(response({items:ids.map(file_id=>({file_id,name:file_id,type:'file',size:1})),next_marker:''}))
 const reading=createShareImportSession(),token=await reading.token(share,'');await reading.list(share,token,'root');return {reading,writer:createShareImportWriter(reading),pane,token}
}
const done=(id:string)=>({id,status:200,body:{file_id:'copied-'+id,drive_id:'drive',parent_file_id:'folder'}})
describe('source-bound original share-copy mutations',()=>{
 it('retains the original copy body while separating share token and native account scope',async()=>{
  const {reading,writer,token}=await setup();vi.mocked(nativeCall).mockResolvedValue(response({responses:[done('a'),done('b')]}));expect(await writer.save(share,token,source,source,target,['a','b'])).toBe('success')
  const args=vi.mocked(nativeCall).mock.calls.at(-1)![1] as any;expect(args.request).toMatchObject({accountId:source,providerId:'aliyun',url:'https://api.aliyundrive.com/adrive/v4/batch',headers:{'X-Share-Token':'cap'}})
  expect(body(args)).toMatchObject({resource:'file',requests:[{id:'a',url:'/file/copy',body:{share_id:share,file_id:'a',to_drive_id:'drive',to_parent_file_id:'folder',auto_rename:true}},{id:'b',url:'/file/copy',body:{file_id:'b'}}]});reading.dispose()
 })
 it('retries failed items without resubmitting confirmed copies',async()=>{
  const {reading,writer,token}=await setup();vi.mocked(nativeCall).mockResolvedValueOnce(response({responses:[done('a'),{id:'b',status:403,body:{code:'Denied'}}]})).mockResolvedValueOnce(response({responses:[done('b')]}))
  await expect(writer.save(share,token,source,source,target,['a','b'])).rejects.toThrow('部分失败');expect(await writer.save(share,token,source,source,target,['a','b'])).toBe('success');expect(body(vi.mocked(nativeCall).mock.calls.at(-1)![1]).requests.map((row:any)=>row.id)).toEqual(['b']);reading.dispose()
 })
 it('keeps an asynchronous receipt pending and does not duplicate it on retry',async()=>{
  const {reading,writer,token}=await setup();vi.mocked(nativeCall).mockResolvedValue(response({responses:[{id:'a',status:202,body:{async_task_id:'server-task'}}]}))
  expect(await writer.save(share,token,source,source,target,['a'])).toBe('async');expect(await writer.save(share,token,source,source,target,['a'])).toBe('async');expect(nativeCall).toHaveBeenCalledTimes(3);reading.dispose()
 })
 it('rejects unknown files, targets and cross-account calls before writing',async()=>{
  const {reading,writer,token}=await setup();await expect(writer.save(share,token,source,source,target,['unknown'])).rejects.toThrow('选择不匹配');await expect(writer.save(share,token,'other','other',target,['a'])).rejects.toThrow('账号');await expect(writer.save(share,token,source,source,'unread',['a'])).rejects.toThrow('已读取');expect(nativeCall).toHaveBeenCalledTimes(2);reading.dispose()
 })
 it('does not count a bare 202 or mismatched batch id as a completed copy',async()=>{
  const {reading,writer,token}=await setup();vi.mocked(nativeCall).mockResolvedValueOnce(response({responses:[{id:'a',status:202,body:{file_id:'pending'}}]})).mockResolvedValueOnce(response({responses:[done('wrong')]}))
  await expect(writer.save(share,token,source,source,target,['a'])).rejects.toThrow('部分失败');await expect(writer.save(share,token,source,source,target,['a'])).rejects.toThrow('不匹配');reading.dispose()
 })
 it('creates scoped intermediate folders and reuses confirmed folders on retry',async()=>{
  const {reading,writer,token}=await setup();vi.mocked(nativeCall).mockResolvedValueOnce(response({file_id:'new-folder',drive_id:'drive',parent_file_id:'folder'})).mockResolvedValueOnce(response({responses:[{id:'a',status:200,body:{file_id:'copy',drive_id:'drive',parent_file_id:'new-folder'}}]}))
  const created=await writer.createFolder(source,source,target,'Nested');expect(created.file_id).toBe(JSON.stringify({driveId:'drive',fileId:'new-folder'}));expect(await writer.createFolder(source,source,target,'Nested')).toEqual(created)
  expect(await writer.save(share,token,source,source,created.file_id,['a'])).toBe('success');expect(nativeCall).toHaveBeenCalledTimes(4);reading.dispose()
 })
 it('stops future batches when the source changes during the first request',async()=>{
  const ids=Array.from({length:101},(_,i)=>String(i)),{reading,writer,token,pane}=await setup(ids);let finish!:(value:any)=>void;vi.mocked(nativeCall).mockImplementation(()=>new Promise(resolve=>{finish=resolve}));const pending=writer.save(share,token,source,source,target,ids);pane.context=2;finish(response({responses:ids.slice(0,100).map(done)}));await expect(pending).rejects.toThrow('切换');expect(nativeCall).toHaveBeenCalledTimes(3);reading.dispose()
 })
})
