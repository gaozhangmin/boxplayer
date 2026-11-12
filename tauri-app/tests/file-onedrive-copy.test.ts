import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {json,request} from '@/features/sources/transport'
import {nativeCall} from '@/platform/native'
import {useFileSourcesStore} from '@/stores/fileSources'
import {relocateRemoteFiles} from '@/features/files/drive/relocationMutations'
import {oneDriveCopy} from '@/features/files/drive/oneDriveCopyTransport'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:(row:{body:number[]})=>new TextDecoder().decode(new Uint8Array(row.body)),playable:()=>false}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn()}))
const {pane}=vi.hoisted(()=>({pane:{sourceId:'source',context:0,file:vi.fn()}}))
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>pane}))
const account={id:'source',providerId:'onedrive' as const,name:'Fixture',baseUrl:'',authOrigins:[]},file={file_id:'opaque/id',drive_id:'source',name:'Movie.mkv',parent_file_id:'old',isDir:false} as IAliGetFileModel
const path='/me/drive/items/opaque%2Fid/copy',body={parentReference:{id:'target'},name:'Movie.mkv'},url='https://api.onedrive.com/monitor/fixture'
const response=(status:number,data:unknown,headers:Record<string,string>={})=>({status,headers,body:data===undefined?[]:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:url})
const result={id:'new-copy',name:'Movie.mkv',file:{},parentReference:{id:'target'}}
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];pane.context++;pane.sourceId='source';pane.file.mockReturnValue(file);vi.mocked(request).mockResolvedValue(response(202,undefined,{Location:url}));vi.mocked(nativeCall).mockResolvedValue(response(202,{status:'completed',resourceId:'new-copy'}));vi.mocked(json).mockResolvedValue(result)})
afterEach(()=>vi.useRealTimers())
describe('original OneDrive copy with native monitored completion',()=>{
 it('retains original request and confirms result before returning original selected ID',async()=>{
  expect(await relocateRemoteFiles(account,[file],'target',true,()=>true)).toEqual({success:[file.file_id],failures:[]})
  expect(request).toHaveBeenCalledExactlyOnceWith(account,'POST','https://graph.microsoft.com/v1.0'+path,JSON.stringify(body),{'Content-Type':'application/json'})
  const native=vi.mocked(nativeCall).mock.calls[0]![1] as any;expect(native.request).toMatchObject({accountId:'',providerId:'onedrive',url,method:'GET',headers:{},body:null})
  expect(json).toHaveBeenCalledWith(account,'GET',expect.stringContaining('/items/new-copy?$select='))
 })
 it('waits for terminal status, never treats 100 percent inProgress as complete',async()=>{
  vi.useFakeTimers();vi.mocked(nativeCall).mockResolvedValueOnce(response(202,{status:'inProgress',percentageComplete:100})).mockResolvedValueOnce(response(200,{status:'completed',resourceId:'new-copy'}))
  const pending=oneDriveCopy(account,path,body);await vi.advanceTimersByTimeAsync(999);expect(json).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(await pending).toEqual(result);expect(request).toHaveBeenCalledTimes(1)
 })
 it.each(['http://api.onedrive.com/monitor/x','https://evil.example/monitor/x','https://api.onedrive.com.evil.example/x','https://user@api.onedrive.com/x'])('rejects untrusted monitor address %s without sending credentials or polling',async location=>{
  vi.mocked(request).mockResolvedValue(response(202,undefined,{location}));await expect(oneDriveCopy(account,path,body)).rejects.toThrow();expect(nativeCall).not.toHaveBeenCalled();expect(json).not.toHaveBeenCalled()
 })
 it('keeps the accepted job when monitoring fails and resumes without another POST',async()=>{
  vi.mocked(nativeCall).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(response(200,{status:'completed',resourceId:'new-copy'}))
  await expect(oneDriveCopy(account,path,body)).rejects.toThrow('offline');expect(await oneDriveCopy(account,path,body)).toEqual(result);expect(request).toHaveBeenCalledTimes(1)
 })
 it('does not resubmit when the launch response was lost or missing Location',async()=>{
  vi.mocked(request).mockResolvedValue(response(202,undefined));await expect(oneDriveCopy(account,path,body)).rejects.toThrow();await expect(oneDriveCopy(account,path,body)).rejects.toThrow('未知');expect(request).toHaveBeenCalledTimes(1)
 })
 it.each([{...result,id:file.file_id},{...result,parentReference:{id:'wrong'}},{...result,name:'Wrong.mkv'},{...result,file:undefined,folder:{}},{...result,deleted:{}}])('rejects mismatched completed result %j',async metadata=>{
  vi.mocked(json).mockResolvedValue(metadata);const output=await relocateRemoteFiles(account,[file],'target',true,()=>true);expect(output.success).toEqual([]);expect(output.failures).toHaveLength(1)
 })
 it('stops verification and following items after source changes during monitoring',async()=>{
  vi.mocked(nativeCall).mockImplementationOnce(async()=>{pane.context++;return response(200,{status:'completed',resourceId:'new-copy'})})
  const output=await relocateRemoteFiles(account,[file],'target',true,()=>true);expect(output.success).toEqual([]);expect(json).not.toHaveBeenCalled()
 })
 it('confirms folder copies with the original folder type',async()=>{
  pane.file.mockReturnValue({...file,isDir:true});vi.mocked(json).mockResolvedValue({...result,file:undefined,folder:{childCount:0}})
  expect((await oneDriveCopy(account,path,body)).id).toBe('new-copy')
 })
 it('stops immediately after account removal during monitoring',async()=>{
  vi.mocked(nativeCall).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[];return response(200,{status:'completed',resourceId:'new-copy'})})
  await expect(oneDriveCopy(account,path,body)).rejects.toThrow('已关闭或切换');expect(json).not.toHaveBeenCalled()
 })
 it('rejects failed job and missing completed resource identity',async()=>{
  vi.mocked(nativeCall).mockResolvedValue(response(200,{status:'failed'}));await expect(oneDriveCopy(account,path,body)).rejects.toThrow('任务失败')
  pane.context++;vi.mocked(nativeCall).mockResolvedValue(response(200,{status:'completed'}));await expect(oneDriveCopy(account,path,body)).rejects.toThrow('新文件标识');expect(json).not.toHaveBeenCalled()
 })
})
