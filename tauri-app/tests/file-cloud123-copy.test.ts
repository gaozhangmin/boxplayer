import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {relocateRemoteFiles} from '@/features/files/drive/relocationMutations'
import {copyCloud123Single} from '@/features/files/drive/cloud123Copy'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(row:{body:number[]})=>new TextDecoder().decode(new Uint8Array(row.body)),playable:()=>false}))
const {state}=vi.hoisted(()=>({state:{pane:{sourceId:'source',context:0,file:vi.fn()}}}))
let pane=state.pane
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>state.pane}))
const account={id:'source',providerId:'123' as const,name:'Fixture',baseUrl:'',authOrigins:[]},file={file_id:'42',drive_id:'source',name:'Movie.mkv',isDir:false,parent_file_id:'5'} as IAliGetFileModel
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''}),detail={fileId:99,parentFileId:0,filename:'Movie.mkv',type:0,trashed:0}
let serial=0
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());account.id='copy-'+ ++serial;file.drive_id=account.id;useFileSourcesStore().accounts=[account];state.pane={sourceId:account.id,context:1,file:vi.fn()};pane=state.pane;pane.file.mockReturnValue(file)})
describe('123 original single-copy branch with target verification',()=>{
 it('retains the original synchronous endpoint/body and returns selected ID after verification',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response({code:0,data:{targetFileId:99}})).mockResolvedValueOnce(response({code:0,data:detail}))
  expect(await relocateRemoteFiles(account,[file],'',true,()=>true)).toEqual({success:['42'],failures:[]})
  expect(request).toHaveBeenNthCalledWith(1,account,'POST','https://open-api.123pan.com/api/v1/file/copy',JSON.stringify({fileId:42,targetDirId:0}),{'Content-Type':'application/json',Platform:'open_platform'})
  expect(new URL(vi.mocked(request).mock.calls[1]![2]).searchParams.get('fileID')).toBe('99')
 })
 it.each([{...detail,fileId:42},{...detail,parentFileId:3},{...detail,filename:'wrong.mkv'},{...detail,type:1},{...detail,trashed:1}])('rejects unconfirmed copy result %j',async row=>{
  vi.mocked(request).mockResolvedValueOnce(response({code:0,data:{targetFileId:99}})).mockResolvedValueOnce(response({code:0,data:row}));const output=await relocateRemoteFiles(account,[file],'',true,()=>true);expect(output.success).toEqual([]);expect(output.failures).toHaveLength(1)
 })
 it('does not resubmit copy when the detail confirmation needs retry',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response({code:0,data:{targetFileID:99}})).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(response({code:0,data:detail}))
  await expect(copyCloud123Single(account,file,'0',()=>true)).rejects.toThrow('不匹配');expect(await copyCloud123Single(account,file,'0',()=>true)).toEqual(['42']);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/copy'))).toHaveLength(1)
 })
 it('does not resubmit an ambiguous launch',async()=>{
  vi.mocked(request).mockResolvedValue(response({code:0,data:{}}));await expect(copyCloud123Single(account,file,'0',()=>true)).rejects.toThrow('新文件');await expect(copyCloud123Single(account,file,'0',()=>true)).rejects.toThrow('未知');expect(request).toHaveBeenCalledTimes(1)
 })
 it('rejects multi-selection when selected identities are not loaded',async()=>{
  await expect(relocateRemoteFiles(account,[file,{...file,file_id:'43'}],'0',true,()=>true)).rejects.toThrow('来源不匹配');expect(request).not.toHaveBeenCalled()
 })
 it('stops confirmation on source change',async()=>{
  vi.mocked(request).mockImplementationOnce(async()=>{pane.context++;return response({code:0,data:{targetFileId:99}})})
  expect((await relocateRemoteFiles(account,[file],'',true,()=>true)).success).toEqual([]);expect(request).toHaveBeenCalledTimes(1)
 })
 it('retains the returned target after source change and resumes from a new pane without POST',async()=>{
  vi.mocked(request).mockImplementationOnce(async()=>{pane.context++;return response({code:0,data:{targetFileId:99}})})
  await expect(copyCloud123Single(account,file,'0',()=>true)).rejects.toThrow('来源已切换')
  state.pane={sourceId:account.id,context:1,file:vi.fn().mockReturnValue(file)};pane=state.pane
  vi.mocked(request).mockResolvedValueOnce(response({code:0,data:detail}))
  expect(await copyCloud123Single(account,file,'0',()=>true)).toEqual(['42'])
  expect(vi.mocked(request).mock.calls.filter(call=>call[1]==='POST')).toHaveLength(1)
 })
 it('preserves an ambiguous launch after remount without issuing another copy',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response({code:0,data:{}}))
  await expect(copyCloud123Single(account,file,'0',()=>true)).rejects.toThrow('新文件')
  state.pane={sourceId:account.id,context:2,file:vi.fn().mockReturnValue(file)};pane=state.pane
  await expect(copyCloud123Single(account,file,'0',()=>true)).rejects.toThrow('未知')
  expect(request).toHaveBeenCalledTimes(1)
 })
 it('shares a concurrent original copy submission while independently confirming the target',async()=>{
  let done!:(value:any)=>void
  vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>done=resolve)).mockResolvedValue(response({code:0,data:detail}))
  const first=copyCloud123Single(account,file,'0',()=>true),second=copyCloud123Single(account,file,'0',()=>true)
  done(response({code:0,data:{targetFileId:99}}))
  expect(await first).toEqual(['42']);expect(await second).toEqual(['42'])
  expect(vi.mocked(request).mock.calls.filter(call=>call[1]==='POST')).toHaveLength(1)
 })
 it('does not confirm a copy against a replacement account with the same ID',async()=>{
  vi.mocked(request).mockImplementationOnce(async()=>{
   useFileSourcesStore().accounts=[{...account,userId:'another-user'}]
   return response({code:0,data:{targetFileId:99}})
  })
  await expect(copyCloud123Single(account,file,'0',()=>true)).rejects.toThrow('账号已变化')
  expect(request).toHaveBeenCalledTimes(1)
 })
 it('does not reuse an old receipt or resubmit after same-ID account replacement',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response({code:0,data:{targetFileId:99}})).mockRejectedValueOnce(Error('offline'))
  await expect(copyCloud123Single(account,file,'0',()=>true)).rejects.toThrow()
  const replacement={...account,userId:'another-user'}
  useFileSourcesStore().accounts=[replacement]
  await expect(copyCloud123Single(replacement,file,'0',()=>true)).rejects.toThrow('账号身份已变化')
  expect(request).toHaveBeenCalledTimes(2)
 })
 it.each([{parent_file_id:'7'},{isDir:true},{drive_id:'another-source'}])('rejects a stale selected file identity %j before submitting',async change=>{
  pane.file.mockReturnValue({...file,...change})
  await expect(copyCloud123Single(account,file,'0',()=>true)).rejects.toThrow('来源不匹配')
  expect(request).not.toHaveBeenCalled()
 })
 it('stops after detail returns if account identity changes during confirmation',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response({code:0,data:{targetFileId:99}})).mockImplementationOnce(async()=>{
   useFileSourcesStore().accounts=[{...account,userId:'another-user'}]
   return response({code:0,data:detail})
  })
  await expect(copyCloud123Single(account,file,'0',()=>true)).rejects.toThrow('账号已变化')
  expect(request).toHaveBeenCalledTimes(2)
 })

})
