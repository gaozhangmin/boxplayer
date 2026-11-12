import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {createRemoteFolder,supportsRemoteFolderCreation} from '@/features/files/drive/folderMutations'
import {renameRemoteFile,supportsRemoteRename} from '@/features/files/drive/renameMutations'
import {quarkRequest} from '@/features/files/drive/quarkFileTransport'
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
const account={id:'fixture',providerId:'quark' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
const file={file_id:'file',parent_file_id:'parent',isDir:false}
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let detail:any,created:any,business:any
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account]
 detail={fid:'new',file_name:'Folder',file_type:0,pdir_fid:'0'};created={fid:'new'};business={code:0,data:{}}
 vi.mocked(request).mockImplementation(async(_account,method,url)=>response(method==='GET'?{code:0,data:{list:[detail]}}:new URL(url).pathname.endsWith('/rename')?business:{code:0,data:created}))
})
describe('original Quark folder creation and rename through native account transport',()=>{
 it('exposes the implemented operations and retains the original root create body and query',async()=>{
  expect(supportsRemoteFolderCreation(account)).toBe(true);expect(supportsRemoteRename(account)).toBe(true)
  expect(await createRemoteFolder(account,'quark_root','Folder')).toEqual({file_id:'new',error:''})
  const call=vi.mocked(request).mock.calls[0]!,url=new URL(call[2])
  expect(call[0]).toEqual(account);expect(call[1]).toBe('POST');expect(url.origin+url.pathname).toBe('https://drive-pc.quark.cn/1/clouddrive/file')
  expect(Object.fromEntries(url.searchParams)).toMatchObject({pr:'ucpro',fr:'pc',uc_param_str:'',__dt:'1000'});expect(Number(url.searchParams.get('__t'))).toBeGreaterThan(0)
  expect(JSON.parse(call[3]!)).toEqual({pdir_fid:'0',file_name:'Folder',dir_init_lock:false,dir_path:''})
  expect(new URL(vi.mocked(request).mock.calls[1]![2]).searchParams.get('fids')).toBe('new')
 })
 it('retains nested Unicode names and numeric safe identities',async()=>{
  created={file:{fid:123}};detail={fid:123,file_name:'电影',dir:true,pdir_fid:'parent'}
  expect(await createRemoteFolder(account,'parent','电影')).toEqual({file_id:'123',error:''})
 })
 it('confirms rename using detail even when the original rename acknowledgment omits metadata',async()=>{
  detail={fid:'file',file_name:'新名字.mkv',file_type:1,pdir_fid:'parent'}
  expect(await renameRemoteFile(account,file,'新名字.mkv')).toMatchObject({file_id:'file',name:'新名字.mkv',isDir:false})
  expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!)).toEqual({fid:'file',file_name:'新名字.mkv'})
  expect(new URL(vi.mocked(request).mock.calls[0]![2]).pathname).toBe('/1/clouddrive/file/rename')
 })
 it('does not inherit the original rename file_type=0 falsy coercion',async()=>{
  detail={fid:'file',file_name:'Folder',file_type:0,pdir_fid:'parent'}
  expect(await renameRemoteFile(account,{...file,isDir:true},'Folder')).toMatchObject({isDir:true})
 })
 it.each([{code:403},{status:'error'},{success:false},{__error:true},null,[]])('rejects business or malformed response %j',async value=>{
  business=value;await expect(renameRemoteFile(account,file,'New')).rejects.toThrow('夸克');expect(request).toHaveBeenCalledTimes(1)
 })
 it.each([{fid:'wrong'},{file_name:'wrong'},{pdir_fid:'wrong'},{file_type:1},{file_type:undefined},{dir:false},{file_type:2}])('requires matching create detail %j',async patch=>{
  detail={...detail,...patch};await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('夸克')
 })
 it('rejects an unrelated first detail row even though the original detail function falls back to it',async()=>{
  detail={...detail,fid:'other'};await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('标识')
 })
 it('rejects unsafe numeric identities before querying potentially rounded detail',async()=>{
  created={fid:9007199254740992};await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('安全范围');expect(request).toHaveBeenCalledTimes(1)
 })
 it('does not continue metadata confirmation after account removal',async()=>{
  vi.mocked(request).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[];return response({code:0,data:created})})
  await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('来源不匹配');expect(request).toHaveBeenCalledTimes(1)
 })
 it('requires a matching account before network',async()=>{
  useFileSourcesStore().accounts=[{...account,providerId:'box'}];await expect(renameRemoteFile(account,file,'New')).rejects.toThrow('来源不匹配');expect(request).not.toHaveBeenCalled()
 })
 it.each(['../bad','bad/name','bad\\name','..','\u0000bad'])('rejects invalid names %j',async name=>{
  await expect(createRemoteFolder(account,'',name)).rejects.toThrow();expect(request).not.toHaveBeenCalled()
 })
 it('limits the adapter to the original declared operations without renderer credentials',async()=>{
  await expect(quarkRequest(account.id,'file/purge',{method:'POST',body:'{}'})).rejects.toThrow('未适配')
  await expect(quarkRequest(account.id,'file',{headers:{Cookie:'fixture'}},{fids:'file'})).rejects.toThrow('未适配')
  expect(request).not.toHaveBeenCalled()
 })
})
