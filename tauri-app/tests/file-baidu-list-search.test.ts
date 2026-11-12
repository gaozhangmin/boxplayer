import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {rawRequest} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {baidu} from '@/features/sources/cloud'
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),rawRequest:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
const account={id:'fixture',providerId:'baidu' as const,name:'Fixture',baseUrl:'',authOrigins:[]},movie={fs_id:'9007199254740997',path:'/电影.mkv',server_filename:'电影.mkv',isdir:0,size:42,server_mtime:1700000000,md5:'hash',thumbs:{url2:'https://fixture.test/image'}}
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let rows:any[],more:number
beforeEach(()=>{vi.resetAllMocks();const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});setActivePinia(createPinia());useFileSourcesStore().accounts=[account];rows=[movie];more=0;vi.mocked(rawRequest).mockImplementation(async()=>response({errno:0,list:rows,has_more:more}))})
it('uses original 1000-entry paging, native User-Agent and the original 15-second timeout without renderer tokens',async()=>{
 const page=await baidu.list(account,'baidu_root'),call=vi.mocked(rawRequest).mock.calls[0]!,url=new URL(call[2])
 expect(Object.fromEntries(url.searchParams)).toEqual({method:'list',dir:'/',order:'name',start:'0',limit:'1000',web:'1',folder:'0',desc:'0'});expect(call[4]).toEqual({'User-Agent':'pan.baidu.com'});expect(call[5]).toBe(15000)
 expect(page.entries[0]).toMatchObject({id:movie.fs_id,playable:true,modified:1700000000000,electronModel:{file_id:movie.fs_id,drive_id:account.id,path:movie.path,icon:'iconfile_video',content_hash:'hash',thumbnail:movie.thumbs.url2,description:'baidu_fsid:9007199254740997;baidu_path:/电影.mkv'}})
})
it('keeps original stable folder identity while retaining its physical path and metadata',async()=>{
 rows=[{...movie,fs_id:5,path:'/root-library',server_filename:'root-library',isdir:1,size:0}]
 expect((await baidu.list(account,'')).entries[0]).toMatchObject({id:'5',isDirectory:true,electronModel:{file_id:'5',path:'/root-library',description:'baidu_fsid:5;baidu_path:/root-library',icon:'iconfile-folder'}})
})
it('binds original offsets to the current account and path and rejects reused pages',async()=>{
 more=1;const first=await baidu.list(account,'');rows=[{...movie,fs_id:6,path:'/Other.mkv',server_filename:'Other.mkv'}];more=0;expect((await baidu.list(account,'',first.nextCursor)).entries).toHaveLength(1)
 expect(new URL(vi.mocked(rawRequest).mock.calls[1]![2]).searchParams.get('start')).toBe('1000')
 for(const patch of [{source:'other'},{parent:'/Other'},{view:'trash'},{start:1},{hashes:[]}])await expect(baidu.list(account,'',JSON.stringify({...JSON.parse(first.nextCursor!),...patch}))).rejects.toThrow('游标')
 rows=[movie];await expect(baidu.list(account,'',first.nextCursor)).rejects.toThrow('重复')
})
it.each([{fs_id:1.5},{isdir:2},{path:'/Wrong.mkv'},{path:'/other/电影.mkv'},{size:-1},{thumbs:{url2:42}}])('rejects conflicting or unsafe metadata %j',async patch=>{
 rows=[{...movie,...patch}];await expect(baidu.list(account,'')).rejects.toThrow('百度')
})
it('does not return an empty success for invalid pagination, business failure or malformed results',async()=>{
 rows=[];more=1;await expect(baidu.list(account,'')).rejects.toThrow('分页');vi.mocked(rawRequest).mockResolvedValueOnce(response({errno:110}));await expect(baidu.list(account,'')).rejects.toThrow('110');vi.mocked(rawRequest).mockResolvedValueOnce(response({errno:0,list:{}}));await expect(baidu.list(account,'')).rejects.toThrow('列表')
})
it('retains original recursive 500-result search and actual result parents',async()=>{
 rows=[{...movie,path:'/nested/电影.mkv'}];const page=await baidu.search!(account,'电影'),url=new URL(vi.mocked(rawRequest).mock.calls[0]![2])
 expect(Object.fromEntries(url.searchParams)).toEqual({method:'search',key:'电影',dir:'/',num:'500',web:'1',recursion:'1'});expect(page.entries[0]).toMatchObject({originalParent:'/nested',electronModel:{parent_file_id:'/nested',path:'/nested/电影.mkv'}});expect(page.nextCursor).toBeUndefined()
})
it('does not swallow failed search as empty results and does not claim further search paging',async()=>{
 vi.mocked(rawRequest).mockResolvedValueOnce(response({errno:110}));await expect(baidu.search!(account,'电影')).rejects.toThrow('搜索响应失败');await expect(baidu.search!(account,'电影','1')).rejects.toThrow('不支持');vi.mocked(rawRequest).mockClear();expect((await baidu.search!(account,'  ')).entries).toEqual([]);expect(rawRequest).not.toHaveBeenCalled()
})
it('rejects duplicate provider identities even when folder paths differ',async()=>{
 rows=[{...movie,isdir:1},{...movie,isdir:1,path:'/Other',server_filename:'Other'}];await expect(baidu.list(account,'')).rejects.toThrow('重复')
})
it('rejects a late account response after removal',async()=>{
 vi.mocked(rawRequest).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[];return response({errno:0,list:[movie]})});await expect(baidu.search!(account,'电影')).rejects.toThrow('搜索百度网盘文件超时')
})

it.each([['name asc','name','0'],['name desc','name','1'],['updated_at asc','time','0'],['updated_at desc','time','1'],['size asc','size','0'],['size desc','size','1']])('preserves original sorting %s in all pages',async(saved,order,desc)=>{
 localStorage.setItem('tauri.driveOrder:'+JSON.stringify([account.id,'backup_root']),saved);more=1
 const first=await baidu.list(account,''),url=new URL(vi.mocked(rawRequest).mock.calls[0]![2]);expect(url.searchParams.get('order')).toBe(order);expect(url.searchParams.get('desc')).toBe(desc)
 localStorage.setItem('tauri.driveOrder:'+JSON.stringify([account.id,'backup_root']),saved==='name asc'?'size asc':'name asc');await expect(baidu.list(account,'',first.nextCursor)).rejects.toThrow('游标')
})
