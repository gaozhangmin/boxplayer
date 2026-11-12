import {beforeEach,describe,expect,it,vi} from 'vitest'
import {readAliDirectFolderSize,AliDirectorySizeHttp} from '@/features/files/drive/aliDirectorySizePorts'
import {request} from '@/features/sources/transport'
const state=vi.hoisted(()=>({account:{id:'ali',providerId:'aliyun',name:'Fixture',baseUrl:'',authOrigins:[]} as any,pane:{sourceId:'ali',context:1} as any}))
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>state.pane}))
vi.mock('@/features/files/drive/aliFolderTransport',()=>({aliFolderAccount:()=>state.account}))
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),text:(response:any)=>new TextDecoder().decode(new Uint8Array(response.body))}))
const response=(data:unknown,status=200)=>({status,headers:{},finalUrl:'',body:Array.from(new TextEncoder().encode(JSON.stringify(data)))})
beforeEach(()=>{vi.resetAllMocks();state.account={id:'ali',providerId:'aliyun',name:'Fixture',baseUrl:'',authOrigins:[]};state.pane={sourceId:'ali',context:1};vi.mocked(request).mockResolvedValue(response({items:[{size:10},{size:20}]}))})
describe('original Ali direct-folder size reader through source-bound native transport',()=>{
 it('retains original search body and sums direct files, not descendants',async()=>{
  expect(await readAliDirectFolderSize(state.account,'resource','folder',()=>{})).toEqual({size:30,truncated:false})
  const call=vi.mocked(request).mock.calls[0]!
  expect(call[2]).toBe('https://api.aliyundrive.com/adrive/v3/file/search?jsonmask=next_marker%2Citems(size)')
  expect(JSON.parse(call[3]!)).toEqual({drive_id:'resource',limit:100,query:'parent_file_id="folder" and type="file"',fields:'thumbnail',order_by:'size DESC'})
 })
 it('marks a limited first page as truncated without silently walking all files',async()=>{
  vi.mocked(request).mockResolvedValue(response({items:[{size:5}],next_marker:'more'}));expect(await readAliDirectFolderSize(state.account,'backup','folder',()=>{})).toEqual({size:5,truncated:true});expect(request).toHaveBeenCalledTimes(1)
 })
 it('accepts a confirmed empty directory as zero',async()=>{vi.mocked(request).mockResolvedValue(response({items:[]}));expect(await readAliDirectFolderSize(state.account,'resource','root',()=>{})).toEqual({size:0,truncated:false})})
 it.each([{items:[{size:-1}]},{items:[{size:'10'}]},{items:[{size:Number.MAX_SAFE_INTEGER},{size:1}]},{items:[] ,next_marker:1},{code:'Denied',items:[]},{items:Array.from({length:101},()=>({size:1}))}])('rejects malformed response without converting it to a confirmed zero',async data=>{
  vi.mocked(request).mockResolvedValue(response(data));await expect(readAliDirectFolderSize(state.account,'resource','folder',()=>{})).rejects.toThrow()
 })
 it('rejects unauthorized unscoped raw requests',async()=>{await expect(AliDirectorySizeHttp.Post('adrive/v3/file/search?jsonmask=next_marker%2Citems(size)',{},'ali','')).rejects.toThrow('作用域');expect(request).not.toHaveBeenCalled()})
 it('rejects Open credentials before sending web requests',async()=>{state.account.providerId='alipan-open';await expect(readAliDirectFolderSize(state.account,'resource','folder',()=>{})).rejects.toThrow();expect(request).not.toHaveBeenCalled()})
 it('rejects a late response after replacing the account with the same ID',async()=>{
  let finish!:(value:any)=>void;vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));const pending=readAliDirectFolderSize(state.account,'resource','folder',()=>{});state.account={...state.account,userId:'replacement'};finish(response({items:[{size:10}]}));await expect(pending).rejects.toThrow('来源已切换')
 })
 it('rejects stale browser lifetime and permits a fresh read afterward',async()=>{
  let finish!:(value:any)=>void;vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));const pending=readAliDirectFolderSize(state.account,'resource','folder',()=>{});state.pane.context++;finish(response({items:[{size:10}]}));await expect(pending).rejects.toThrow();expect(await readAliDirectFolderSize(state.account,'resource','folder',()=>{})).toEqual({size:30,truncated:false})
 })
})
