import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {relocateRemoteFiles} from '@/features/files/drive/relocationMutations'
import {acknowledgeWebAliMove} from '@/features/files/drive/aliRelocationTransport'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(row:{body:number[]})=>new TextDecoder().decode(new Uint8Array(row.body))}))
const {pane}=vi.hoisted(()=>({pane:{sourceId:'source',context:0,file:vi.fn()}}))
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>pane}))
const account={id:'source',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),file={file_id:id('drive','movie'),drive_id:'source',parent_file_id:id('drive','root'),name:'Movie.mkv',isDir:false} as IAliGetFileModel
const target=id('drive','target'),detail={file_id:'movie',drive_id:'drive',parent_file_id:'target',name:'Movie (1).mkv',type:'file'},response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''}),batch=(body:unknown,status=200)=>({responses:[{id:'movie',status,body}]})
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];pane.context++;pane.sourceId='source';pane.file.mockImplementation(value=>value===file.file_id?file:{isDir:true})})
afterEach(()=>vi.useRealTimers())
describe('Ali original movement/copy body and native completion',()=>{
 it('uses same-drive original move body and actual returned autorename',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response(batch(detail))).mockResolvedValueOnce(response(detail));expect(await relocateRemoteFiles(account,[file],target,false,()=>true)).toEqual({success:[file.file_id],failures:[],names:{[file.file_id]:'Movie (1).mkv'}})
  const body=JSON.parse(vi.mocked(request).mock.calls[0]![3]!);expect(body.requests[0]).toMatchObject({url:'/file/move',id:'movie',body:{drive_id:'drive',file_id:'movie',to_parent_file_id:'target',auto_rename:true}});expect(body.requests[0].body.to_drive_id).toBeUndefined()
 })
 it('uses original cross-drive copy body and confirms new target identity',async()=>{
  const copied={...detail,file_id:'copied',drive_id:'backup',parent_file_id:'root'};vi.mocked(request).mockResolvedValueOnce(response(batch(copied))).mockResolvedValueOnce(response(copied));expect((await relocateRemoteFiles(account,[file],id('backup','root'),true,()=>true)).success).toEqual([file.file_id]);expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!).requests[0].body).toEqual({drive_id:'drive',file_id:'movie',to_drive_id:'backup',to_parent_file_id:'root',auto_rename:true})
 })
 it('waits for async completion before reading target details',async()=>{
  vi.useFakeTimers();vi.mocked(request).mockResolvedValueOnce(response(batch({...detail,file_id:'copied',async_task_id:'task'},202))).mockResolvedValueOnce(response({state:'Running'})).mockResolvedValueOnce(response({state:'Succeed'})).mockResolvedValueOnce(response({...detail,file_id:'copied'}))
  const result=relocateRemoteFiles(account,[file],target,true,()=>true);await vi.advanceTimersByTimeAsync(999);expect(request).toHaveBeenCalledTimes(2);await vi.advanceTimersByTimeAsync(1);expect((await result).success).toEqual([file.file_id]);expect(JSON.parse(vi.mocked(request).mock.calls[1]![3]!)).toEqual({async_task_id:'task'})
 })
 it('resumes accepted task after monitor failure without resubmitting copy',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response(batch({...detail,file_id:'copied',async_task_id:'task'},202))).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(response({state:'done'})).mockResolvedValueOnce(response({...detail,file_id:'copied'}))
  expect((await relocateRemoteFiles(account,[file],target,true,()=>true)).success).toEqual([]);expect((await relocateRemoteFiles(account,[file],target,true,()=>true)).success).toEqual([file.file_id]);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1)
 })
 it.each([{...detail,parent_file_id:'wrong'},{...detail,type:'folder'},{...detail,drive_id:'wrong'}])('rejects destination detail mismatch %j',async value=>{
  vi.mocked(request).mockResolvedValueOnce(response(batch(detail))).mockResolvedValueOnce(response(value));expect((await relocateRemoteFiles(account,[file],target,false,()=>true)).success).toEqual([])
 })
 it('rejects missing async task receipt and does not relaunch ambiguous requests',async()=>{
  vi.mocked(request).mockResolvedValue(response(batch({...detail,file_id:'copied'},202)));expect((await relocateRemoteFiles(account,[file],target,true,()=>true)).success).toEqual([])
  vi.mocked(request).mockResolvedValue(response({...detail,file_id:'copied'}));expect((await relocateRemoteFiles(account,[file],target,true,()=>true)).success).toEqual([]);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1)
 })
 it('leaves cross-drive move identity reconciliation explicitly pending before any write',async()=>{
  const result=await relocateRemoteFiles(account,[file],id('backup','root'),false,()=>true);expect(result.success).toEqual([]);expect(result.failures[0]).toContain('跨盘移动');expect(request).not.toHaveBeenCalled()
 })
 it('does not confirm stale results after browser changes',async()=>{
  vi.mocked(request).mockImplementationOnce(async()=>{pane.context++;return response(batch(detail))});expect((await relocateRemoteFiles(account,[file],target,false,()=>true)).success).toEqual([]);expect(request).toHaveBeenCalledTimes(1)
 })
 it('retains a confirmed move until catalog acknowledgement and rereads detail without another POST',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response(batch(detail))).mockResolvedValue(response(detail))
  expect((await relocateRemoteFiles(account,[file],target,false,()=>true)).success).toEqual([file.file_id]);expect((await relocateRemoteFiles(account,[file],target,false,()=>true)).success).toEqual([file.file_id]);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1)
  acknowledgeWebAliMove(account,file.file_id,target)
  vi.mocked(request).mockResolvedValueOnce(response(batch(detail))).mockResolvedValueOnce(response(detail));expect((await relocateRemoteFiles(account,[file],target,false,()=>true)).success).toEqual([file.file_id]);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(2)
 })
 it('does not promote a retained receipt if its target was moved elsewhere before synchronization retry',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response(batch(detail))).mockResolvedValueOnce(response(detail)).mockResolvedValueOnce(response({...detail,parent_file_id:'elsewhere'}))
  expect((await relocateRemoteFiles(account,[file],target,false,()=>true)).success).toEqual([file.file_id]);expect((await relocateRemoteFiles(account,[file],target,false,()=>true)).success).toEqual([]);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1)
 })
 it('does not reuse an unresolved old-owner batch under a replacement account with the same ID',async()=>{
  vi.mocked(request).mockRejectedValueOnce(Error('fixture response lost'));expect((await relocateRemoteFiles(account,[file],target,false,()=>true)).success).toEqual([])
  const replacement={...account,name:'Replacement'};useFileSourcesStore().accounts=[replacement];expect((await relocateRemoteFiles(replacement,[file],target,false,()=>true)).success).toEqual([]);expect(request).toHaveBeenCalledTimes(1)
 })

 it('allows explicit retry after a matched subrequest is definitively rejected',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response(batch({code:'Forbidden'},403))).mockResolvedValueOnce(response(batch(detail))).mockResolvedValueOnce(response(detail))
  expect((await relocateRemoteFiles(account,[file],target,false,()=>true)).success).toEqual([]);expect((await relocateRemoteFiles(account,[file],target,false,()=>true)).success).toEqual([file.file_id]);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(2)
 })

})
