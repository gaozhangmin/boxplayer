import {beforeEach,describe,it,expect,vi} from 'vitest'
import {readAliSizeDirectoryIndex,AliDirectoryIndexHttp} from '@/features/files/drive/aliDirectoryIndexPorts'
import {request} from '@/features/sources/transport'
const state=vi.hoisted(()=>({account:{id:'ali',providerId:'aliyun',name:'Fixture',baseUrl:'',authOrigins:[]} as any,pane:{sourceId:'ali',context:1} as any}))
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>state.pane}))
vi.mock('@/features/files/drive/aliFolderTransport',()=>({aliFolderAccount:()=>state.account}))
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),text:(response:any)=>new TextDecoder().decode(new Uint8Array(response.body))}))
const node=(id:string,parent='root')=>({drive_id:'resource',file_id:id,parent_file_id:parent,name:id,updated_at:'2026-11-09T00:00:00Z',size:0})
const response=(a:any[],b:any[],markerA='',markerB='')=>({status:200,headers:{},finalUrl:'',body:Array.from(new TextEncoder().encode(JSON.stringify({responses:[{id:'id1',status:200,body:{items:a,next_marker:markerA}},{id:'id2',status:200,body:{items:b,next_marker:markerB}}]})))})
beforeEach(()=>{vi.resetAllMocks();state.account={id:'ali',providerId:'aliyun',name:'Fixture',baseUrl:'',authOrigins:[]};state.pane={sourceId:'ali',context:1}})
describe('original bidirectional Ali directory size index',()=>{
 it('retains original dual-direction request and deduplicates intersecting results',async()=>{
  vi.mocked(request).mockResolvedValue(response([node('a'),node('b','a')],[node('b','a'),node('a')]))
  expect((await readAliSizeDirectoryIndex(state.account,'resource',()=>{})).map(row=>row.file_id)).toEqual(['a','b'])
  const body=JSON.parse(vi.mocked(request).mock.calls[0]![3]!)
  expect(body.resource).toBe('file');expect(body.requests.map((row:any)=>[row.id,row.body.order_by,row.body.limit,row.url])).toEqual([['id1','name ASC',100,'/file/search'],['id2','name DESC',100,'/file/search']])
 })
 it('merges both advancing pages until original overlap completion',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response([node('a')],[node('c')],'asc2','desc2')).mockResolvedValueOnce(response([node('b')],[node('b')],'asc3','desc3'))
  expect((await readAliSizeDirectoryIndex(state.account,'resource',()=>{})).map(row=>row.file_id).sort()).toEqual(['a','b','c']);expect(request).toHaveBeenCalledTimes(2)
 })
 it('rejects repeated page cursors instead of looping',async()=>{vi.mocked(request).mockResolvedValue(response([],[],'same','same'));await expect(readAliSizeDirectoryIndex(state.account,'resource',()=>{})).rejects.toThrow('游标重复');expect(request).toHaveBeenCalledTimes(2)})
 it('rejects conflicting identity across the original ascending and descending pages',async()=>{vi.mocked(request).mockResolvedValue(response([node('a')],[{...node('a'),parent_file_id:'other'}]));await expect(readAliSizeDirectoryIndex(state.account,'resource',()=>{})).rejects.toThrow('身份冲突')})
 it('rejects a page belonging to another drive',async()=>{vi.mocked(request).mockResolvedValue(response([{...node('a'),drive_id:'backup'}],[]));await expect(readAliSizeDirectoryIndex(state.account,'resource',()=>{})).rejects.toThrow('身份无效')})
 it('rejects duplicate nodes within one page before the original overlap shortcut can truncate the index',async()=>{vi.mocked(request).mockResolvedValue(response([node('a'),node('a')],[],'next','other'));await expect(readAliSizeDirectoryIndex(state.account,'resource',()=>{})).rejects.toThrow('单页项目重复')})
 it('rejects a late index after account replacement and clears the read scope',async()=>{
  let finish!:(value:any)=>void;vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));const pending=readAliSizeDirectoryIndex(state.account,'resource',()=>{});state.account={...state.account,userId:'new'};finish(response([],[]));await expect(pending).rejects.toThrow('来源已切换')
  vi.mocked(request).mockResolvedValue(response([],[]));expect(await readAliSizeDirectoryIndex(state.account,'resource',()=>{})).toEqual([])
 })
 it('rejects Open tokens and unscoped calls before sending a web query',async()=>{state.account.providerId='alipan-open';await expect(readAliSizeDirectoryIndex(state.account,'resource',()=>{})).rejects.toThrow();await expect(AliDirectoryIndexHttp.Post('', '{}','ali','')).rejects.toThrow('作用域');expect(request).not.toHaveBeenCalled()})
})
