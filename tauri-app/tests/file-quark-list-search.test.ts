import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {quark} from '@/features/sources/cloud'
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
const account={id:'fixture',providerId:'quark' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
const movie={fid:'movie',file_name:'电影.mkv',file_type:1,pdir_fid:'0',size:42,updated_at:1700000000,format_type:'video/x-matroska',thumbnail:'https://fixture.test/image'}
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let rows:any[],total:number|undefined
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];rows=[movie];total=1;vi.mocked(request).mockImplementation(async()=>response({code:0,data:{list:rows},...(total===undefined?{}:{metadata:{_total:total}})}))})
describe('original Quark list and search through account-owned native HTTP',()=>{
 it('retains original sorting/pagination request and original metadata instead of generic text icons',async()=>{
  const result=await quark.list(account,''),row=result.entries[0] as any,url=new URL(vi.mocked(request).mock.calls[0]![2])
  expect(url.pathname).toBe('/1/clouddrive/file/sort');expect(Object.fromEntries(url.searchParams)).toMatchObject({pdir_fid:'0',_page:'1',_size:'100',_fetch_total:'1',fetch_all_file:'1',fetch_risk_file_name:'1',_sort:'file_name:asc'})
  expect(row).toMatchObject({id:'movie',name:'电影.mkv',isDirectory:false,playable:true,modified:1700000000000,electronModel:{drive_id:account.id,file_id:'movie',parent_file_id:'quark_root',mime_type:'video/x-matroska',size:42,thumbnail:movie.thumbnail}})
  expect(row.electronModel.icon).not.toBe('iconfile-txt');expect(row.electronModel.namesearch).toBeTruthy();expect(row.electronModel.timeStr).toBeTruthy();expect(result.nextCursor).toBeUndefined()
  expect(vi.mocked(request).mock.calls[0]![4]).toEqual({'Content-Type':'application/json'})
 })
 it('retains actual nested parents and normalizes explicit dir=false when file_type is omitted',async()=>{
  rows=[{...movie,pdir_fid:'parent',file_type:undefined,dir:false}];expect((await quark.list(account,'parent')).entries[0]).toMatchObject({originalParent:'parent',isDirectory:false})
 })
 it('scopes original page numbers to account, view and physical parent',async()=>{
  rows=Array.from({length:100},(_,i)=>({...movie,fid:'file-'+i}));total=101
  const first=await quark.list(account,'');rows=[{...movie,fid:'last'}];expect((await quark.list(account,'',first.nextCursor)).entries[0]!.id).toBe('last')
  expect(new URL(vi.mocked(request).mock.calls[1]![2]).searchParams.get('_page')).toBe('2')
  const value=JSON.parse(first.nextCursor!);for(const patch of [{account:'other'},{view:'trash'},{parent:'parent'},{page:0},{previous:[]},{hashes:[]}])await expect(quark.list(account,'',JSON.stringify({...value,...patch}))).rejects.toThrow('游标')
 })
 it('rejects repeated file identities, including repeated earlier nonadjacent pages',async()=>{
  rows=Array.from({length:100},(_,i)=>({...movie,fid:'first-'+i}));total=300;const first=await quark.list(account,'');const original=rows
  rows=Array.from({length:100},(_,i)=>({...movie,fid:'second-'+i}));const second=await quark.list(account,'',first.nextCursor)
  rows=original;await expect(quark.list(account,'',second.nextCursor)).rejects.toThrow('重复整页')
 })
 it.each([{pdir_fid:'wrong'},{fid:9007199254740992},{file_type:2},{file_type:0,dir:false},{size:-1},{thumbnail:42}])('rejects conflicting or unsafe model metadata %j',async patch=>{
  rows=[{...movie,...patch}];await expect(quark.list(account,'')).rejects.toThrow('夸克')
 })
 it('does not silently complete a truncated or malformed listing',async()=>{
  total=2;await expect(quark.list(account,'')).rejects.toThrow('总数');rows=Array.from({length:100},(_,i)=>({...movie,fid:'file-'+i}));total=undefined;await expect(quark.list(account,'')).rejects.toThrow('总数')
 })
 it.each([{code:403},{code:0,data:{}},null])('does not turn response %j into an empty successful list',async data=>{
  vi.mocked(request).mockResolvedValue(response(data));await expect(quark.list(account,'')).rejects.toThrow('夸克')
 })
 it('uses the original global search endpoint, size=200, highlight flag and original result parent',async()=>{
  rows=[{...movie,pdir_fid:'actual-parent'}];const result=await quark.search!(account,'电影'),url=new URL(vi.mocked(request).mock.calls[0]![2])
  expect(url.pathname).toBe('/1/clouddrive/file/search');expect(Object.fromEntries(url.searchParams)).toMatchObject({q:'电影',_page:'1',_size:'200',_fetch_total:'1',_sort:'file_type:desc,updated_at:desc',_is_hl:'1'})
  expect(result.entries[0]).toMatchObject({originalParent:'actual-parent',electronModel:{parent_file_id:'actual-parent',icon:'iconfile_video'}});expect(result.nextCursor).toBeUndefined()
 })
 it('keeps the original single search batch limit instead of claiming unbounded pagination',async()=>{
  rows=Array.from({length:200},(_,i)=>({...movie,fid:'file-'+i}));total=1000;expect((await quark.search!(account,'movie')).entries).toHaveLength(200)
  await expect(quark.search!(account,'movie','next')).rejects.toThrow('不支持')
 })
 it('allows real empty results, skips blank queries and rejects missing search parent identities',async()=>{
  expect((await quark.search!(account,' ')).entries).toEqual([]);expect(request).not.toHaveBeenCalled()
  rows=[];total=0;expect((await quark.search!(account,'missing')).entries).toEqual([])
  rows=[{...movie,pdir_fid:undefined}];await expect(quark.search!(account,'movie')).rejects.toThrow('父目录')
 })
 it('rejects duplicate search identities',async()=>{rows=[movie,movie];await expect(quark.search!(account,'movie')).rejects.toThrow('重复')})
 it('does not return results after account removal',async()=>{
  vi.mocked(request).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[];return response({code:0,data:{list:[movie]},metadata:{_total:1}})})
  await expect(quark.list(account,'')).rejects.toThrow('来源不匹配')
 })
})
