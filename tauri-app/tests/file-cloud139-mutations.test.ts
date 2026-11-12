import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {json,SourceHttpError} from '@/features/sources/transport'
import {createRemoteFolder,supportsRemoteFolderCreation} from '@/features/files/drive/folderMutations'
import {renameRemoteFile,supportsRemoteRename} from '@/features/files/drive/renameMutations'
import {cloud139Request} from '@/features/files/drive/cloud139FileTransport'
import type {Account} from '@/features/sources/contracts'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn()}))
let account:Account,sequence=0,created:any,rows:any[],renamed:boolean,updateResponse:any
const file={file_id:'movie',name:'Movie.mkv',parent_file_id:'parent',isDir:false}
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia())
 account={id:'cloud139-'+(++sequence),providerId:'139',name:'Fixture',baseUrl:'https://personal-kd-njs.yun.139.com/hcy',userId:'owner',authOrigins:[]}
 useFileSourcesStore().accounts=[account];created={success:true,data:{fileId:'folder'}};rows=[{fileId:'folder',name:'Folder',type:'folder'}];renamed=false;updateResponse={success:true}
 vi.mocked(json).mockImplementation(async(_account,_method,url)=>{
  if(url.endsWith('/file/create'))return created
  if(url.endsWith('/file/update')){renamed=true;return updateResponse}
  return {success:true,data:{items:rows}}
 })
})
const writes=()=>vi.mocked(json).mock.calls.filter(call=>/\/file\/(create|update)$/.test(call[2]))
describe('original 139 create and rename native boundaries',()=>{
 it('retains original force_rename create body and validates actual returned folder in its parent',async()=>{
  expect(supportsRemoteFolderCreation(account)).toBe(true)
  expect(await createRemoteFolder(account,'parent','Folder')).toEqual({file_id:'folder',error:''})
  expect(writes()[0]).toEqual([account,'POST',account.baseUrl+'/file/create',{parentFileId:'parent',name:'Folder',description:'',type:'folder',fileRenameMode:'force_rename'}])
  expect(vi.mocked(json).mock.calls[1]![3]).toMatchObject({parentFileId:'parent'})
 })
 it.each(['','root','backup_root','cloud139_root','0','/'])('normalizes root alias %j before the original create function',async parent=>{
  await createRemoteFolder(account,parent,'Folder');expect(writes()[0]![3]).toMatchObject({parentFileId:'/'})
 })
 it('accepts the provider actual conflict-renamed folder identity without inventing a path',async()=>{
  rows=[{fileId:'folder',name:'Folder (1)',type:'folder'}]
  expect((await createRemoteFolder(account,'','Folder')).file_id).toBe('folder')
 })
 it.each([{success:false,code:'9008'},{success:true,data:{fileId:9007199254740992}},{success:true,data:{}}])('rejects rejected or unsafe create receipt %j',async value=>{
  created=value;await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow();expect(vi.mocked(json).mock.calls).toHaveLength(1)
 })
 it.each([{value:[]},{value:[{fileId:'foreign',name:'Folder',type:'folder'}]},{value:[{fileId:'folder',name:'Folder',type:'file'}]}])('does not mistake absent or wrong-type directory rows for creation completion',async({value})=>{
  rows=value;await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('未在目标目录确认')
 })
 it('uses fallback routing only for a missing route, preserving the original create payload',async()=>{
  const original=vi.mocked(json).getMockImplementation()!
  vi.mocked(json).mockImplementationOnce(async()=>{throw Error('来源请求失败（404）')}).mockImplementation(original)
  await createRemoteFolder(account,'','Folder')
  expect(writes().map(call=>call[2])).toEqual([account.baseUrl+'/file/create','https://personal-kd-njs.yun.139.com/orchestration/file/create'])
 })
 it('confirms the same stable file in the original parent after rename',async()=>{
  rows=[{fileId:'movie',name:'Movie.mkv',type:'file'}]
  const original=vi.mocked(json).getMockImplementation()!
  vi.mocked(json).mockImplementation(async(...args)=>{if(renamed&&args[2].endsWith('/file/list'))rows=[{fileId:'movie',name:'New.mkv',type:'file'}];return original(...args)})
  expect(supportsRemoteRename(account)).toBe(true)
  expect(await renameRemoteFile(account,file,'New.mkv')).toEqual({file_id:'movie',name:'New.mkv',parent_file_id:'parent',isDir:false})
  expect(writes()[0]![3]).toEqual({fileId:'movie',fileName:'New.mkv'})
 })
 it('keeps an uncertain update and queries on retry without another update',async()=>{
  rows=[{fileId:'movie',name:'Movie.mkv',type:'file'}]
  await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('尚未确认')
  rows=[{fileId:'movie',name:'New.mkv',type:'file'}]
  expect((await renameRemoteFile(account,file,'New.mkv')).name).toBe('New.mkv');expect(writes()).toHaveLength(1)
 })
 it('does not write after a source switch while reading the preflight directory',async()=>{
  let current=true;rows=[{fileId:'movie',name:'Movie.mkv',type:'file'}]
  const original=vi.mocked(json).getMockImplementation()!
  vi.mocked(json).mockImplementation(async(...args)=>{const result=await original(...args);current=false;return result})
  await expect(renameRemoteFile(account,file,'New.mkv',()=>current)).rejects.toThrow('切换');expect(writes()).toHaveLength(0)
 })
 it('refuses owner replacement during creation',async()=>{
  vi.mocked(json).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'another'}];return created})
  await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('身份');expect(vi.mocked(json).mock.calls).toHaveLength(1)
 })
 it('reads later directory pages before confirming a created folder',async()=>{
  const original=vi.mocked(json).getMockImplementation()!
  vi.mocked(json).mockImplementation(async(...args)=>args[2].endsWith('/file/list')&&!(args[3] as any).pageInfo.pageCursor?{data:{items:[{fileId:'other',name:'Other',type:'folder'}],pageInfo:{nextPageCursor:'next'}}}:original(...args))
  expect((await createRemoteFolder(account,'','Folder')).file_id).toBe('folder')
  expect(vi.mocked(json).mock.calls[2]![3]).toMatchObject({pageInfo:{pageCursor:'next'}})
 })
 it('rejects repeated directory identities and unsafe numeric IDs',async()=>{
  rows=[{fileId:'folder',name:'Folder',type:'folder'},{fileId:'folder',name:'Folder',type:'folder'}]
  await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('重复')
  rows=[{fileId:9007199254740992,name:'Folder',type:'folder'}]
  await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('安全范围')
 })
 it('does not expose other operations or invalid names at the native command boundary',async()=>{
  await expect(cloud139Request(account.id,'/file/batchCopy',{})).rejects.toThrow('未适配')
  await expect(createRemoteFolder(account,'','../Folder')).rejects.toThrow('无效');expect(json).not.toHaveBeenCalled()
 })
})

it.each(['business',403])('releases an explicit rename refusal %s so the original name can be retried',async failure=>{
 rows=[{fileId:'movie',name:'Movie.mkv',type:'file'}]
 const original=vi.mocked(json).getMockImplementation()!;let rejected=true
 vi.mocked(json).mockImplementation(async(...args)=>{
  if(args[2].endsWith('/file/update')){
   if(rejected){if(failure==='business')return {success:false,code:'9008'};throw new SourceHttpError(failure as number,'refused')}
   rows=[{fileId:'movie',name:'New.mkv',type:'file'}]
  }
  return original(...args)
 })
 await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow()
 rejected=false;expect((await renameRemoteFile(account,file,'New.mkv')).name).toBe('New.mkv');expect(writes()).toHaveLength(2)
})
