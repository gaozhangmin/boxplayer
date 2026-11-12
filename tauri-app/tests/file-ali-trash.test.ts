import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {trashPage,mutateTrash,restoredDetails,supportsRemoteTrashEmpty} from '@/features/files/drive/trashMutations'
import {alipan} from '@/features/sources/alipan'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(row:{body:number[]})=>new TextDecoder().decode(new Uint8Array(row.body)),playable:(value:string)=>value.endsWith('.mkv')}))
vi.mock('@/features/sources/alipan',()=>({alipan:{list:vi.fn()}}))
const {pane}=vi.hoisted(()=>({pane:{sourceId:'source',context:0,file:vi.fn()}}))
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>pane}))
const account={id:'source',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),file={file_id:id('resource','movie'),drive_id:'source',name:'Movie.mkv',isDir:false,parent_file_id:id('resource','root')} as IAliGetFileModel
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''}),batch=(body:unknown={},status=204)=>({responses:[{id:'movie',status,body}]}),row={file_id:'movie',drive_id:'resource',parent_file_id:'root',name:'Movie.mkv',type:'file',size:2}
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];pane.sourceId='source';pane.context++;pane.file.mockReturnValue(file);vi.mocked(alipan.list).mockResolvedValue({entries:['resource','backup'].map(drive=>({id:id(drive,'root'),name:drive,isDirectory:true,size:0,playable:false}))})})
afterEach(()=>vi.useRealTimers())
describe('Ali original recycle list and file commands',()=>{
 it('retains original list mask/body and paginates both actual drives',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response({items:[row],next_marker:'next'})).mockResolvedValueOnce(response({items:[],next_marker:''})).mockResolvedValueOnce(response({items:[{...row,drive_id:'backup'}],next_marker:''}))
  const first=await trashPage(account);expect(first.entries[0]).toMatchObject({id:file.file_id,originalParent:file.parent_file_id,playable:true});expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!)).toEqual({drive_id:'resource',marker:'',limit:100,all:false,url_expire_sec:14400,fields:'thumbnail',order_by:'updated_at',order_direction:'DESC'});expect(vi.mocked(request).mock.calls[0]![2]).toContain('/v2/recyclebin/list?jsonmask=')
  const second=await trashPage(account,first.nextCursor);expect(JSON.parse(second.nextCursor!)).toEqual({drive:'backup',marker:''});const last=await trashPage(account,second.nextCursor);expect(last.entries[0]!.id).toBe(id('backup','movie'));expect(last.nextCursor).toBeUndefined()
 })
 it.each([{...row,drive_id:'wrong'},{...row,file_id:''},{...row,type:'bad'}])('rejects invalid trash identity %j',async value=>{vi.mocked(request).mockResolvedValue(response({items:[value],next_marker:''}));await expect(trashPage(account)).rejects.toThrow('身份')})
 it('rejects repeated cursor and foreign-drive cursors',async()=>{
  vi.mocked(request).mockResolvedValue(response({items:[row],next_marker:'next'}));await expect(trashPage(account,JSON.stringify({drive:'resource',marker:'next'}))).rejects.toThrow('游标重复');await expect(trashPage(account,JSON.stringify({drive:'foreign',marker:''}))).rejects.toThrow('来源不匹配')
 })
 it.each([['trash','/recyclebin/trash'],['restore','/recyclebin/restore'],['purge','/file/delete'],['permanent','/file/delete']] as const)('uses original %s body and confirmed original ID',async(operation,url)=>{
  vi.mocked(request).mockResolvedValue(response(batch()));expect(await mutateTrash(account,[file],operation,()=>true)).toEqual({success:[file.file_id],failures:[]});expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!).requests[0]).toMatchObject({url,id:'movie',body:{drive_id:'resource',file_id:'movie'}})
 })
 it('waits for deletion task, then stops pending retries from issuing another mutation',async()=>{
  vi.useFakeTimers();vi.mocked(request).mockResolvedValueOnce(response(batch({async_task_id:'task'},202))).mockResolvedValueOnce(response({state:'Running'})).mockResolvedValueOnce(response({state:'Succeed'}))
  const result=mutateTrash(account,[file],'trash',()=>true);await vi.advanceTimersByTimeAsync(1000);expect((await result).success).toEqual([file.file_id]);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1)
 })
 it('resumes the same accepted task after network failure',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response(batch({async_task_id:'task'},202))).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(response({state:'done'}))
  expect((await mutateTrash(account,[file],'restore',()=>true)).success).toEqual([]);expect((await mutateTrash(account,[file],'restore',()=>true)).success).toEqual([file.file_id]);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1)
 })
 it('does not confirm a bare 202 or relaunch its ambiguous mutation',async()=>{
  vi.mocked(request).mockResolvedValue(response(batch({},202)));expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([]);expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([]);expect(request).toHaveBeenCalledTimes(1)
 })
 it('reads verified restored details rather than dispatching to another provider',async()=>{
  vi.mocked(request).mockResolvedValue(response(row));expect(await restoredDetails(account,[file])).toEqual([file]);expect(vi.mocked(request).mock.calls[0]![2]).toBe('https://api.aliyundrive.com/v2/file/get')
 })
 it('rejects source change and exposes the wired whole-bin empty port',async()=>{
  expect(supportsRemoteTrashEmpty(account)).toBe(true);vi.mocked(request).mockImplementationOnce(async()=>{pane.context++;return response(batch())});expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([])
 })
})
it('stops web batch completion after a same-ID account identity replacement',async()=>{
 vi.mocked(request).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'other-user'}];return response(batch())})
 expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([]);expect(request).toHaveBeenCalledTimes(1)
})
