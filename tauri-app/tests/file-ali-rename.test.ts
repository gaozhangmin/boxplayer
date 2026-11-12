import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {renameRemoteFile} from '@/features/files/drive/renameMutations'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(row:{body:number[]})=>new TextDecoder().decode(new Uint8Array(row.body))}))
const {pane}=vi.hoisted(()=>({pane:{sourceId:'source',context:0,file:vi.fn()}}))
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>pane}))
const account={id:'source',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),file={file_id:id('drive','movie'),parent_file_id:id('drive','root'),isDir:false},body={file_id:'movie',drive_id:'drive',parent_file_id:'root',name:'New.mkv',type:'file'}
const response=(value:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(value))),finalUrl:''}),receipt=(value=body,status=200)=>({responses:[{id:'movie',status,body:value}]})
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];pane.context++;pane.sourceId='source';pane.file.mockReturnValue(file)})
describe('original Ali rename method and request builder through native transport',()=>{
 it('keeps original batch recipe and returns the original encoded identity/type',async()=>{
  vi.mocked(request).mockResolvedValue(response(receipt()));expect(await renameRemoteFile(account,file,'New.mkv')).toEqual({...file,name:'New.mkv'})
  expect(request).toHaveBeenCalledExactlyOnceWith(account,'POST','https://api.aliyundrive.com/adrive/v4/batch',JSON.stringify({requests:[{body:{drive_id:'drive',file_id:'movie',name:'New.mkv',check_name_mode:'refuse'},headers:{'Content-Type':'application/json'},id:'movie',method:'POST',url:'/file/update'}],resource:'file'}),{'Content-Type':'application/json'})
 })
 it('preserves folder type at the adapter despite original inverted isDir mapping',async()=>{
  vi.mocked(request).mockResolvedValue(response(receipt({...body,type:'folder'})));expect((await renameRemoteFile(account,{...file,isDir:true},'New.mkv')).isDir).toBe(true)
 })
 it.each([{...body,file_id:'wrong'},{...body,drive_id:'wrong'},{...body,name:'Wrong'},{...body,parent_file_id:'wrong'},{...body,type:'folder'}])('rejects mismatched result %j',async value=>{
  vi.mocked(request).mockResolvedValue(response(receipt(value)));await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow()
 })
 it.each([{responses:[]},{responses:[{id:'other',status:200,body}]},{responses:[{id:'movie',status:200,body},{id:'movie',status:200,body}]},receipt(body,202),receipt({...body,async_task_id:'pending'} as any)])('rejects missing, duplicate, async or unrelated receipts %j',async value=>{
  vi.mocked(request).mockResolvedValue(response(value));await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow()
 })
 it('rejects virtual roots and invalid parent location before writing',async()=>{
  await expect(renameRemoteFile(account,{...file,file_id:id('drive','root')},'New')).rejects.toThrow('根目录')
  await expect(renameRemoteFile(account,{...file,parent_file_id:''},'New')).rejects.toThrow('父目录');expect(request).not.toHaveBeenCalled()
 })
 it('stops stale completion and rejects files absent from current records',async()=>{
  pane.file.mockReturnValue(undefined);await expect(renameRemoteFile(account,file,'New')).rejects.toThrow('记录');expect(request).not.toHaveBeenCalled()
  pane.file.mockReturnValue(file);vi.mocked(request).mockImplementationOnce(async()=>{pane.context++;return response(receipt())});await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('已切换')
 })
})
