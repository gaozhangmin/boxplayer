import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {mutateTrash,supportsRemoteTrashMove,supportsRemoteTrash,supportsRemoteTrashRestore,supportsRemoteTrashEmpty} from '@/features/files/drive/trashMutations'
import {openAliTrashBatch,acknowledgeOpenAliTrash} from '@/features/files/drive/aliOpenTrash'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(row:{body:number[]})=>new TextDecoder().decode(new Uint8Array(row.body)),playable:()=>true}))
const {pane}=vi.hoisted(()=>({pane:{sourceId:'',context:0,file:vi.fn()}}));vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>pane}))
const id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),response=(data:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let account:{id:string;providerId:'alipan-open';name:string;baseUrl:string;authOrigins:string[]},file:IAliGetFileModel
const batch=(fileId='movie')=>[JSON.stringify({url:'/recyclebin/trash',id:fileId,method:'POST',body:{drive_id:'resource',file_id:fileId}})]
function before(){return {drive_id:'resource',file_id:'movie',parent_file_id:'root',name:'Movie.mkv',type:'file'}}
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());account={id:crypto.randomUUID(),providerId:'alipan-open',name:'Fixture',baseUrl:'',authOrigins:['https://openapi.alipan.com']};useFileSourcesStore().accounts=[account];pane.sourceId=account.id;pane.context++;file={file_id:id('resource','movie'),drive_id:account.id,name:'Movie.mkv',isDir:false,parent_file_id:id('resource','root')} as IAliGetFileModel;pane.file.mockReturnValue(file)})
afterEach(()=>vi.useRealTimers())
it('reuses original trash body through the Open channel and verifies known file before/after',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response(before())).mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({...before(),trashed:true}))
 expect(await mutateTrash(account,[file],'trash',()=>true)).toEqual({success:[file.file_id],failures:[]})
 expect(vi.mocked(request).mock.calls.map(call=>call[2])).toEqual(['get','recyclebin/trash','get'].map(path=>'https://openapi.alipan.com/adrive/v1.0/openFile/'+path));expect(JSON.parse(vi.mocked(request).mock.calls[1]![3]!)).toEqual({drive_id:'resource',file_id:'movie'})
 expect(supportsRemoteTrashMove(account)).toBe(true);expect(supportsRemoteTrash(account)).toBe(false);expect(supportsRemoteTrashRestore(account)).toBe(false);expect(supportsRemoteTrashEmpty(account)).toBe(false);acknowledgeOpenAliTrash(account,file.file_id)
})
it('keeps verified receipt until catalog acknowledgement without issuing duplicate POST',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response(before())).mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({code:'FileIdNotFound'},404))
 expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([file.file_id]);expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([file.file_id]);expect(request).toHaveBeenCalledTimes(3);acknowledgeOpenAliTrash(account,file.file_id)
})
it.each([{name:'Changed'}, {parent_file_id:'other'}, {drive_id:'other'}, {file_id:'other'}, {type:'folder'}])('rejects stale preflight %j before sending trash',async mismatch=>{
 vi.mocked(request).mockResolvedValue(response({...before(),...mismatch}));expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([]);expect(request).toHaveBeenCalledTimes(1)
})
it('does not accept an empty acknowledgement while the file remains active',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response(before())).mockResolvedValueOnce(response({})).mockResolvedValueOnce(response(before()));expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([])
})
it('does not relaunch an ambiguously submitted mutation after network failure',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response(before())).mockRejectedValueOnce(Error('offline'));expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([]);expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([]);expect(request).toHaveBeenCalledTimes(2)
})
it('resumes only the accepted async task on retry',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response(before())).mockResolvedValueOnce(response({async_task_id:'task'},202)).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(response({state:'Succeed'})).mockResolvedValueOnce(response({code:'FileIdNotFound'},404))
 expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([]);expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([file.file_id]);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/recyclebin/trash'))).toHaveLength(1);acknowledgeOpenAliTrash(account,file.file_id)
})
it('validates every raw batch entry before any request',async()=>{
 await expect(openAliTrashBatch(account,[...batch(),JSON.stringify({url:'/recyclebin/restore',method:'POST',id:'other',body:{drive_id:'resource',file_id:'other'}})],'')).rejects.toThrow('请求无效');expect(request).not.toHaveBeenCalled()
})
it('stops before mutation when caller context closes during preflight',async()=>{
 let current=true;vi.mocked(request).mockImplementationOnce(async()=>{current=false;return response(before())});expect((await mutateTrash(account,[file],'trash',()=>current)).success).toEqual([]);expect(request).toHaveBeenCalledTimes(1)
})
it('stops same-ID account replacement without using its new token channel',async()=>{
 vi.mocked(request).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'other'}];return response(before())});expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([]);expect(request).toHaveBeenCalledTimes(1)
})
it('does not expose restore, purge or unsupported paths via an Open fallback',async()=>{
 await expect(openAliTrashBatch(account,batch(),'share')).rejects.toThrow('分享');await expect(mutateTrash(account,[file],'restore',()=>true)).rejects.toThrow('不支持');await expect(mutateTrash(account,[file],'purge',()=>true)).rejects.toThrow('不支持');expect(request).not.toHaveBeenCalled()
})
it('permits an explicit retry after an authoritative quota rejection, without automatic resubmission',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response(before())).mockResolvedValueOnce(response({code:'QuotaExhausted.Drive'},403)).mockResolvedValueOnce(response(before())).mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({...before(),trashed:true}))
 expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([]);expect(request).toHaveBeenCalledTimes(2);expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([file.file_id]);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/recyclebin/trash'))).toHaveLength(2);acknowledgeOpenAliTrash(account,file.file_id)
})
it('waits through Running and confirms completion before removing the original row',async()=>{
 vi.useFakeTimers();vi.mocked(request).mockResolvedValueOnce(response(before())).mockResolvedValueOnce(response({async_task_id:'task'},202)).mockResolvedValueOnce(response({state:'Running'})).mockResolvedValueOnce(response({state:'Succeed'})).mockResolvedValueOnce(response({...before(),trashed:true}))
 const task=mutateTrash(account,[file],'trash',()=>true);await vi.advanceTimersByTimeAsync(1000);expect((await task).success).toEqual([file.file_id]);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/recyclebin/trash'))).toHaveLength(1);acknowledgeOpenAliTrash(account,file.file_id)
})
it('uses the same original trash declaration for a verified folder',async()=>{
 file={...file,isDir:true,name:'Folder'};pane.file.mockReturnValue(file);vi.mocked(request).mockResolvedValueOnce(response({...before(),type:'folder',name:'Folder'})).mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({code:'FileIdNotFound'},404));expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([file.file_id]);acknowledgeOpenAliTrash(account,file.file_id)
})

it('deletes through the official Open endpoint and confirms NotFound.FileId without offering recycle management',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response(before())).mockResolvedValueOnce(response({drive_id:'resource',file_id:'movie'})).mockResolvedValueOnce(response({code:'NotFound.FileId'},404))
 expect(await mutateTrash(account,[file],'permanent',()=>true)).toEqual({success:[file.file_id],failures:[]})
 expect(vi.mocked(request).mock.calls.map(call=>call[2])).toEqual(['get','delete','get'].map(path=>'https://openapi.alipan.com/adrive/v1.0/openFile/'+path))
 expect(JSON.parse(vi.mocked(request).mock.calls[1]![3]!)).toEqual({drive_id:'resource',file_id:'movie'})
 expect(supportsRemoteTrash(account)).toBe(false);expect(supportsRemoteTrashRestore(account)).toBe(false);expect(supportsRemoteTrashEmpty(account)).toBe(false)
 acknowledgeOpenAliTrash(account,file.file_id)
})
it('does not mistake merely trashed status for permanent deletion',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response(before())).mockResolvedValueOnce(response({drive_id:'resource',file_id:'movie'})).mockResolvedValueOnce(response({...before(),trashed:true}))
 expect((await mutateTrash(account,[file],'permanent',()=>true)).success).toEqual([])
})
it('retries accepted permanent deletion confirmation without another delete request',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response(before())).mockResolvedValueOnce(response({drive_id:'resource',file_id:'movie',async_task_id:'delete-task'},202)).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(response({state:'Succeed'})).mockResolvedValueOnce(response({code:'NotFound.FileId'},404))
 expect((await mutateTrash(account,[file],'permanent',()=>true)).success).toEqual([])
 expect((await mutateTrash(account,[file],'permanent',()=>true)).success).toEqual([file.file_id])
 expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/delete'))).toHaveLength(1);acknowledgeOpenAliTrash(account,file.file_id)
})
it('does not switch an unresolved trash intent into permanent deletion',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response(before())).mockRejectedValueOnce(Error('offline'))
 expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([])
 expect((await mutateTrash(account,[file],'permanent',()=>true)).success).toEqual([])
 expect(request).toHaveBeenCalledTimes(2)
})
it.each([{drive_id:'other',file_id:'movie'},{drive_id:'resource',file_id:'other'},{}])('rejects unmatched direct-delete acknowledgement %j',async body=>{
 vi.mocked(request).mockResolvedValueOnce(response(before())).mockResolvedValueOnce(response(body))
 expect((await mutateTrash(account,[file],'permanent',()=>true)).success).toEqual([]);expect(request).toHaveBeenCalledTimes(2)
})

it('accepts an empty synchronous delete task field only after proving the file absent',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response(before())).mockResolvedValueOnce(response({drive_id:'resource',file_id:'movie',async_task_id:''})).mockResolvedValueOnce(response({code:'NotFound.FileId'},404))
 expect((await mutateTrash(account,[file],'permanent',()=>true)).success).toEqual([file.file_id]);acknowledgeOpenAliTrash(account,file.file_id)
})
it('rejects an asynchronous delete acknowledgement without a task id',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response(before())).mockResolvedValueOnce(response({drive_id:'resource',file_id:'movie',async_task_id:''},202))
 expect((await mutateTrash(account,[file],'permanent',()=>true)).success).toEqual([]);expect(request).toHaveBeenCalledTimes(2)
})
