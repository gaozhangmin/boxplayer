import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {bindDrivePane,type DrivePanePort} from '@/features/files/drive/ports'
import {createShareImportSession} from '@/features/files/drive/importShareSession'
import {nativeCall} from '@/platform/native'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn()}))
let unbind:()=>void
const shareId='abcdefghijk',response=(body:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(body))),finalUrl:''})
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});setActivePinia(createPinia())})
afterEach(()=>unbind?.())
function session(){const pane={sourceId:'native-uuid',context:1,local:false,account:{id:'native-uuid',providerId:'box'}} as unknown as DrivePanePort;unbind=bindDrivePane(pane);return {reading:createShareImportSession(),pane}}
const item=(id:string,type='file')=>({file_id:id,drive_id:'shared-drive',parent_file_id:'root',name:id+'.mkv',type,size:20,category:'video',file_extension:'mkv',updated_at:'2026-01-01T00:00:00Z'})
describe('original Ali anonymous import read ports',()=>{
 it('reads the original share token without attaching the current account credentials',async()=>{
  const {reading}=session();vi.mocked(nativeCall).mockResolvedValue(response({share_token:'share-capability'}));expect(await reading.token(shareId,'pass')).toBe('share-capability')
  const request=(vi.mocked(nativeCall).mock.calls[0]![1] as any).request;expect(request).toMatchObject({accountId:'',providerId:'aliyun',url:'https://api.aliyundrive.com/v2/share_link/get_share_token',method:'POST'});expect(request.headers).toEqual({'Content-Type':'application/json'});expect(JSON.parse(new TextDecoder().decode(new Uint8Array(request.body)))).toEqual({share_id:shareId,share_pwd:'pass'});reading.dispose()
 })
 it('retains original anonymous metadata mapping and provider error messages',async()=>{
  const {reading}=session();vi.mocked(nativeCall).mockResolvedValueOnce(response({creator_id:'creator',share_name:'Fixture',file_count:2})).mockResolvedValueOnce(response({code:'ShareLink.Expired'},400))
  expect((await reading.info(shareId,'')).shareinfo).toMatchObject({share_id:shareId,share_name:'Fixture',file_count:2});await expect(reading.info(shareId,'')).rejects.toThrow('过期');reading.dispose()
 })
 it('uses share-only headers and original icon/date/size mapping across pages',async()=>{
  const {reading}=session();vi.mocked(nativeCall).mockResolvedValueOnce(response({share_token:'share-capability'})).mockResolvedValueOnce(response({items:[item('a')],next_marker:'next'})).mockResolvedValueOnce(response({items:[item('b','folder')],next_marker:''}))
  const token=await reading.token(shareId,''),result=await reading.list(shareId,token,'root');expect(result.items.map(item=>[item.file_id,item.isDir])).toEqual([['a',false],['b',true]]);expect(result.items[0]!.icon).toBe('iconfile_video');expect(result.items[0]!.sizeStr).toBe('20.00B');expect(result.items[1]!.sizeStr).toBe('')
  for(const [,args] of vi.mocked(nativeCall).mock.calls.slice(1)){const request=(args as any).request;expect(request.accountId).toBe('');expect(request.headers).toEqual({'Content-Type':'application/json','X-Share-Token':'share-capability'})};reading.dispose()
 })
 it('rejects a repeated share page cursor instead of returning an incomplete list',async()=>{
  const {reading}=session();vi.mocked(nativeCall).mockResolvedValueOnce(response({share_token:'cap'})).mockResolvedValue(response({items:[],next_marker:'again'}));const token=await reading.token(shareId,'');await expect(reading.list(shareId,token,'root')).rejects.toThrow('分页重复');expect(nativeCall).toHaveBeenCalledTimes(3);reading.dispose()
 })
 it('does not list with an unverified token or fall through another provider to Ali',async()=>{
  const {reading}=session();await expect(reading.list(shareId,'unverified','root')).rejects.toThrow('不匹配');await expect(reading.token('quark:link','')).rejects.toThrow('尚未接入');expect(nativeCall).not.toHaveBeenCalled();reading.dispose()
 })
 it('keeps wrong-password failure out of the successful token registry',async()=>{
  const {reading}=session();vi.mocked(nativeCall).mockResolvedValue(response({code:'InvalidResource.SharePwd'},400));await expect(reading.token(shareId,'wrong')).rejects.toThrow('提取码错误');await expect(reading.list(shareId,'bad','root')).rejects.toThrow('不匹配');expect(nativeCall).toHaveBeenCalledTimes(1);reading.dispose()
 })
 it('rejects a missing share folder instead of showing a successful empty folder',async()=>{
  const {reading}=session();vi.mocked(nativeCall).mockResolvedValueOnce(response({share_token:'cap'})).mockResolvedValueOnce(response({},404));const token=await reading.token(shareId,'');await expect(reading.list(shareId,token,'removed')).rejects.toThrow('不存在');reading.dispose()
 })
 it('stops subsequent pages after closing while the first page is pending',async()=>{
  const {reading}=session();vi.mocked(nativeCall).mockResolvedValueOnce(response({share_token:'cap'}));const token=await reading.token(shareId,'');let finish!:(value:any)=>void;vi.mocked(nativeCall).mockImplementation(()=>new Promise(resolve=>{finish=resolve}));const pending=reading.list(shareId,token,'root');reading.dispose();finish(response({items:[],next_marker:'next'}));await expect(pending).rejects.toThrow('关闭');expect(nativeCall).toHaveBeenCalledTimes(2)
 })
})
