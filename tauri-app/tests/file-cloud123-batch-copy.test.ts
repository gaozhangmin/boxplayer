import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {request} from '@/features/sources/transport'
import {relocateRemoteFiles} from '@/features/files/drive/relocationMutations'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(row:{body:number[]})=>new TextDecoder().decode(new Uint8Array(row.body)),playable:()=>false}))
const {state}=vi.hoisted(()=>({state:{pane:{} as any}}))
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>state.pane}))
let serial=0,account:any,files:IAliGetFileModel[],targets:IAliGetFileModel[]
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
const detail=(id:string)=>{const row=targets.find(file=>file.file_id===id)!;return {fileId:Number(id),parentFileId:0,filename:row.name,type:0,trashed:0}}
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());account={id:'batch-'+ ++serial,providerId:'123',name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore().accounts=[account]
 files=['42','43'].map((id,i)=>({file_id:id,drive_id:account.id,name:'Film'+i+'.mkv',isDir:false,parent_file_id:'5',size:100+i,content_hash:'hash'+i} as IAliGetFileModel))
 targets=files.map((file,i)=>({...file,file_id:String(99+i),parent_file_id:'0'}))
 state.pane={sourceId:account.id,context:1,file:(id:string)=>files.find(file=>file.file_id===id),list:vi.fn().mockResolvedValueOnce([]).mockImplementation(async()=>targets)}
 vi.mocked(request).mockImplementation(async(_account,method,url)=>response(method==='POST'?{code:0,data:{}}:{code:0,data:detail(new URL(url).searchParams.get('fileID')!)}))
})
it('uses one original async request and confirms distinct new copies',async()=>{
 expect(await relocateRemoteFiles(account,files,'backup_root',true,()=>true)).toEqual({success:['42','43'],failures:[]})
 expect(request).toHaveBeenNthCalledWith(1,account,'POST','https://open-api.123pan.com/api/v1/file/async/copy',JSON.stringify({fileIds:[42,43],targetDirId:0}),{'Content-Type':'application/json',Platform:'open_platform'})
 expect(vi.mocked(request).mock.calls.filter(call=>call[1]==='POST')).toHaveLength(1)
})
it('retains partial confirmation and resumes a single pending selection without a second POST',async()=>{
 state.pane.list.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([targets[0]]).mockResolvedValue(targets)
 const first=await relocateRemoteFiles(account,files,'0',true,()=>true);expect(first.success).toEqual(['42']);expect(first.failures).toHaveLength(1)
 expect(await relocateRemoteFiles(account,[files[1]!],'0',true,()=>true)).toEqual({success:['43'],failures:[]})
 expect(vi.mocked(request).mock.calls.filter(call=>call[1]==='POST')).toHaveLength(1)
})
it('does not regard an accepted job without new files as completed',async()=>{
 state.pane.list.mockResolvedValue([])
 const result=await relocateRemoteFiles(account,files,'0',true,()=>true);expect(result.success).toEqual([]);expect(result.failures).toHaveLength(2)
 await relocateRemoteFiles(account,files,'0',true,()=>true)
 expect(vi.mocked(request).mock.calls.filter(call=>call[1]==='POST')).toHaveLength(1)
})
it('retains ambiguous launch and does not rePOST after remount',async()=>{
 vi.mocked(request).mockRejectedValueOnce(Error('offline'))
 await expect(relocateRemoteFiles(account,files,'0',true,()=>true)).rejects.toThrow('未知')
 state.pane={...state.pane,context:2}
 await expect(relocateRemoteFiles(account,files,'0',true,()=>true)).rejects.toThrow('未知');expect(request).toHaveBeenCalledTimes(1)
})
it('does not confirm preexisting destination objects',async()=>{
 state.pane.list.mockReset().mockResolvedValue(targets)
 expect((await relocateRemoteFiles(account,files,'0',true,()=>true)).success).toEqual([])
 expect(request).toHaveBeenCalledTimes(1)
})
it('stops after submission if account metadata changes',async()=>{
 vi.mocked(request).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'different'}];return response({code:0})})
 await expect(relocateRemoteFiles(account,files,'0',true,()=>true)).rejects.toThrow('账号已变化');expect(request).toHaveBeenCalledTimes(1)
})
it('does not reuse an old batch receipt with a same-ID replacement account',async()=>{
 state.pane.list.mockResolvedValue([]);await relocateRemoteFiles(account,files,'0',true,()=>true)
 account={...account,userId:'different'};useFileSourcesStore().accounts=[account]
 await expect(relocateRemoteFiles(account,files,'0',true,()=>true)).rejects.toThrow('身份');expect(request).toHaveBeenCalledTimes(1)
})
it('rejects overlapping expanded selection without submitting again',async()=>{
 state.pane.list.mockResolvedValue([]);await relocateRemoteFiles(account,files,'0',true,()=>true)
 files.push({...files[0]!,file_id:'44'})
 await expect(relocateRemoteFiles(account,files,'0',true,()=>true)).rejects.toThrow('选择已变化');expect(request).toHaveBeenCalledTimes(1)
})
it('does not pair identical selected names with the same new object',async()=>{
 files[1]={...files[0]!,file_id:'43'};targets=[{...files[0]!,file_id:'99',parent_file_id:'0'}]
 expect((await relocateRemoteFiles(account,files,'0',true,()=>true)).success).toEqual([])
})
it('stops scans when a pane is replaced',async()=>{
 state.pane.list.mockReset().mockImplementationOnce(async()=>{state.pane={...state.pane};return []})
 await expect(relocateRemoteFiles(account,files,'0',true,()=>true)).rejects.toThrow('来源已切换');expect(request).not.toHaveBeenCalled()
})
it('rejects mismatched detail parents',async()=>{
 vi.mocked(request).mockImplementation(async(_account,method,url)=>response(method==='POST'?{code:0}:{code:0,data:{...detail(new URL(url).searchParams.get('fileID')!),parentFileId:8}}))
 expect((await relocateRemoteFiles(account,files,'0',true,()=>true)).success).toEqual([])
})
it('allows retry after an explicit business rejection without treating it as completion',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response({code:7,message:'rejected'}))
 await expect(relocateRemoteFiles(account,files,'0',true,()=>true)).rejects.toThrow('明确拒绝')
 state.pane.list.mockReset().mockResolvedValueOnce([]).mockResolvedValue(targets)
 expect((await relocateRemoteFiles(account,files,'0',true,()=>true)).success).toEqual(['42','43'])
 expect(vi.mocked(request).mock.calls.filter(call=>call[1]==='POST')).toHaveLength(2)
})
it('releases a receipt when the initial target read fails before submission',async()=>{
 state.pane.list.mockReset().mockRejectedValueOnce(Error('read failed'))
 await expect(relocateRemoteFiles(account,files,'0',true,()=>true)).rejects.toThrow('read failed');expect(request).not.toHaveBeenCalled()
 state.pane.list.mockReset().mockResolvedValueOnce([]).mockResolvedValue(targets)
 expect((await relocateRemoteFiles(account,files,'0',true,()=>true)).success).toEqual(['42','43'])
})
it('shares one concurrent batch submission',async()=>{
 let done!:(value:any)=>void
 vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>done=resolve))
 const first=relocateRemoteFiles(account,files,'0',true,()=>true),second=relocateRemoteFiles(account,files,'0',true,()=>true)
 await vi.waitFor(()=>expect(done).toBeTypeOf('function'))
 done(response({code:0}))
 expect((await first).success).toEqual(['42','43']);expect((await second).success).toEqual(['42','43'])
 expect(vi.mocked(request).mock.calls.filter(call=>call[1]==='POST')).toHaveLength(1)
})
it('never assigns one observed target to two source files across confirmation retries',async()=>{
 files[0]={...files[0]!,content_hash:''};files[1]={...files[0]!,file_id:'43',content_hash:'strong-hash'}
 targets=[{...files[1]!,file_id:'99',parent_file_id:'0'}]
 const first=await relocateRemoteFiles(account,files,'0',true,()=>true);expect(first.success).toEqual(['42'])
 const retry=await relocateRemoteFiles(account,[files[1]!],'0',true,()=>true);expect(retry.success).toEqual([])
 expect(vi.mocked(request).mock.calls.filter(call=>call[1]==='POST')).toHaveLength(1)
})
it('does not retain an unsent receipt if the last lifecycle check cancels native submission',async()=>{
 let checks=0
 await expect(relocateRemoteFiles(account,files,'0',true,()=>++checks<5)).rejects.toThrow('提交前取消')
 expect(request).not.toHaveBeenCalled()
 state.pane.list.mockReset().mockResolvedValueOnce([]).mockResolvedValue(targets)
 expect((await relocateRemoteFiles(account,files,'0',true,()=>true)).success).toEqual(['42','43'])
})
