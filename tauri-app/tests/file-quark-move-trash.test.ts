import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {json,request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {relocateRemoteFiles,supportsRemoteCopy,supportsRemoteRelocation} from '@/features/files/drive/relocationMutations'
import {mutateTrash,trashPage,supportsRemoteTrash,supportsRemoteTrashRestore,supportsRemoteTrashDelete,supportsRemoteTrashEmpty} from '@/features/files/drive/trashMutations'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body)),playable:(name:string)=>/\.mkv$/i.test(name)}))
import {quark} from '@/features/sources/cloud'
const account={id:'fixture',providerId:'quark' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
const file={file_id:'movie',drive_id:account.id,parent_file_id:'old',name:'Movie.mkv',isDir:false} as IAliGetFileModel
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let sequence=0
let business:any,detail:any,target:any,rows:any[],total:number|undefined,current:boolean
const posts=()=>vi.mocked(request).mock.calls.filter(call=>call[1]==='POST')
beforeEach(()=>{
 account.id='fixture-'+(++sequence);file.drive_id=account.id
 vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];current=true
 business={code:0,data:{}};detail={fid:'movie',file_name:'Movie.mkv',file_type:1,pdir_fid:'target'};target={fid:'target',file_name:'Target',file_type:0,pdir_fid:'0'}
 rows=[{fid:'movie',record_id:'record',file_name:'Movie.mkv',file_type:1,pdir_fid:'old',size:1024,updated_at:1700000000}];total=1
 vi.mocked(request).mockImplementation(async(_a,method,raw)=>{
  const url=new URL(raw)
  if(method==='POST')return response(business)
  if(url.pathname.endsWith('/recycle/list'))return response({code:0,data:{list:rows},...(total===undefined?{}:{metadata:{_total:total}})})
  return response({code:0,data:{list:[url.searchParams.get('fids')==='target'?target:detail]}})
 })
})
describe('original Quark move and recycle protocols',()=>{
 it.each(['','root','backup_root','quark_root','0'])('normalizes directory-picker root %j before listing destinations',async root=>{
  vi.mocked(request).mockResolvedValue(response({code:0,data:{list:[]},metadata:{_total:0}}))
  expect(await quark.list(account,root)).toEqual({entries:[],nextCursor:undefined})
  expect(new URL(vi.mocked(request).mock.calls[0]![2]).searchParams.get('pdir_fid')).toBe('0')
 })
 it('retains original move body, confirms target and actual final parent',async()=>{
  expect(supportsRemoteRelocation(account)).toBe(true);expect(supportsRemoteCopy(account)).toBe(false)
  expect(await relocateRemoteFiles(account,[file],'target',false,()=>current)).toEqual({success:['movie'],failures:[]})
  expect(JSON.parse(posts()[0]![3]!)).toEqual({action_type:1,to_pdir_fid:'target',filelist:['movie'],exclude_fids:[]})
  expect(new URL(posts()[0]![2]).pathname).toBe('/1/clouddrive/file/move');expect(request).toHaveBeenCalledTimes(3)
 })
 it('maps original virtual roots to zero without requesting a root detail',async()=>{
  detail.pdir_fid='0';expect((await relocateRemoteFiles(account,[file],'quark_root',false,()=>true)).success).toEqual(['movie']);expect(request).toHaveBeenCalledTimes(2)
 })
 it.each([{fid:'foreign'},{file_type:1},{dir:false}])('rejects unconfirmed destination %j before writing',async patch=>{
  target={...target,...patch};expect((await relocateRemoteFiles(account,[file],'target',false,()=>true)).success).toEqual([]);expect(posts()).toHaveLength(0)
 })
 it.each([{pdir_fid:'old'},{fid:'other'},{file_name:'Other.mkv'},{file_type:0}])('does not report a completed move with conflicting detail %j',async patch=>{
  detail={...detail,...patch};expect((await relocateRemoteFiles(account,[file],'target',false,()=>true)).success).toEqual([])
 })
 it('rejects copy and move-to-self without a write',async()=>{
  await expect(relocateRemoteFiles(account,[file],'target',true,()=>true)).rejects.toThrow('复制');expect((await relocateRemoteFiles(account,[file],'movie',false,()=>true)).success).toEqual([]);expect(posts()).toHaveLength(0)
 })
 it('stops before POST if the source changes while reading the destination',async()=>{
  const original=vi.mocked(request).getMockImplementation()!;vi.mocked(request).mockImplementation(async(...args)=>{const value=await original(...args);current=false;return value})
  expect((await relocateRemoteFiles(account,[file],'target',false,()=>current)).success).toEqual([]);expect(posts()).toHaveLength(0)
 })
 it('preserves confirmed partial moves while reporting a later failure',async()=>{
  const original=vi.mocked(request).getMockImplementation()!;vi.mocked(request).mockImplementation(async(...args)=>args[1]==='POST'&&JSON.parse(args[3]!).filelist[0]==='second'?response({code:403}):original(...args))
  const result=await relocateRemoteFiles(account,[file,{...file,file_id:'second',name:'Second.mkv'}],'target',false,()=>true)
  expect(result.success).toEqual(['movie']);expect(result.failures[0]).toContain('Second.mkv')
 })
 it('retains recycle action_type=2, without exposing unsupported restore/purge/clear',async()=>{
  expect(supportsRemoteTrash(account)).toBe(true);expect(supportsRemoteTrashRestore(account)).toBe(false);expect(supportsRemoteTrashDelete(account)).toBe(false);expect(supportsRemoteTrashEmpty(account)).toBe(false)
  expect(await mutateTrash(account,[file],'trash',()=>true)).toEqual({success:['movie'],failures:[]})
  expect(JSON.parse(posts()[0]![3]!)).toEqual({action_type:2,filelist:['movie'],exclude_fids:[]});expect(new URL(posts()[0]![2]).pathname).toBe('/1/clouddrive/file/delete')
 })
 it.each(['restore','purge','permanent'] as const)('rejects unsupported %s without network',async operation=>{
  await expect(mutateTrash(account,[file],operation,()=>true)).rejects.toThrow('不支持');expect(request).not.toHaveBeenCalled()
 })
 it.each([{code:403},{},{status:'error',code:0}])('does not mistake a truthy failed recycle response for success %j',async value=>{
  business=value;rows=[];total=0;expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([])
 })
 it('stops after source switch and preserves recycle partial failures',async()=>{
  const original=vi.mocked(request).getMockImplementation()!;let count=0
  rows=[{...rows[0],fid:'second'}]
  vi.mocked(request).mockImplementation(async(...args)=>args[1]==='POST'?response(++count===1?{code:403}:{code:0}):original(...args))
  const result=await mutateTrash(account,[file,{...file,file_id:'second'}],'trash',()=>true);expect(result.success).toEqual(['second']);expect(result.failures).toHaveLength(1)
  vi.mocked(request).mockClear();expect((await mutateTrash(account,[file],'trash',()=>false)).success).toEqual([]);expect(request).not.toHaveBeenCalled()
 })
})
describe('original Quark recycle listing and metadata mapping',()=>{
 it('uses the separate recycle endpoint and preserves original icon, time, pinyin and record metadata',async()=>{
  const result=await trashPage(account),entry=result.entries[0]!,original=(entry as any).electronModel
  expect(new URL(vi.mocked(request).mock.calls[0]![2]).pathname).toBe('/1/clouddrive/file/recycle/list')
  expect(Object.fromEntries(new URL(vi.mocked(request).mock.calls[0]![2]).searchParams)).toMatchObject({_page:'1',_size:'100',_fetch_total:'1'})
  expect(entry).toMatchObject({id:'movie',originalParent:'old',size:1024,modified:1700000000000,isDirectory:false})
  expect(original).toMatchObject({drive_id:account.id,file_id:'movie',description:'quark_fid:movie;quark_pdir:old;quark_record:record'});expect(original.icon).not.toBe('iconfile-txt');expect(original.sizeStr).toBeTruthy();expect(result.nextCursor).toBeUndefined()
 })
 it('maps an explicit dir=false without file_type through the original mapper as a file',async()=>{
  rows=[{...rows[0],file_type:undefined,dir:false}];expect((await trashPage(account)).entries[0]!.isDirectory).toBe(false)
 })
 it('binds subsequent pages to the account and recycle view',async()=>{
  rows=Array.from({length:100},(_,index)=>({...rows[0],fid:'file-'+index}));total=101
  const first=await trashPage(account);expect(first.nextCursor).toBeTruthy();rows=[{...rows[0],fid:'last'}]
  expect((await trashPage(account,first.nextCursor)).entries[0]!.id).toBe('last')
  const value=JSON.parse(first.nextCursor!);for(const patch of [{account:'other'},{view:'root'},{page:0},{previous:[]}])await expect(trashPage(account,JSON.stringify({...value,...patch}))).rejects.toThrow('游标')
 })
 it('rejects repeated page identities',async()=>{
  rows=Array.from({length:100},(_,index)=>({...rows[0],fid:'file-'+index}));total=200;const first=await trashPage(account);await expect(trashPage(account,first.nextCursor)).rejects.toThrow('重复')
 })
 it.each([{file_type:2},{file_type:undefined,dir:undefined},{file_type:0,dir:false},{size:-1},{fid:9007199254740992},{record_id:9007199254740992}])('rejects unsafe recycle metadata %j',async patch=>{
  rows=[{...rows[0],...patch}];await expect(trashPage(account)).rejects.toThrow('夸克')
 })
 it('does not turn malformed rows or conflicting totals into an empty successful listing',async()=>{
  rows={} as any;await expect(trashPage(account)).rejects.toThrow('列表');rows=[];total=10;await expect(trashPage(account)).rejects.toThrow('总数')
 })
 it('rejects a missing total on a full page rather than silently truncating records',async()=>{
  rows=Array.from({length:100},(_,index)=>({...rows[0],fid:'file-'+index}));total=undefined;await expect(trashPage(account)).rejects.toThrow('总数')
 })
})
