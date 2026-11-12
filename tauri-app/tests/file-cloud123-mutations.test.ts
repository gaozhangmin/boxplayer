import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {createRemoteFolder} from '@/features/files/drive/folderMutations'
import {renameRemoteFile} from '@/features/files/drive/renameMutations'
import {relocateRemoteFiles,supportsRemoteCopy} from '@/features/files/drive/relocationMutations'
import {mutateTrash,supportsRemoteTrash,supportsRemoteTrashMove} from '@/features/files/drive/trashMutations'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(row:{body:number[]})=>new TextDecoder().decode(new Uint8Array(row.body)),playable:()=>false}))
const account={id:'second',providerId:'123' as const,name:'Fixture',baseUrl:'',authOrigins:[]},file={file_id:'42',parent_file_id:'12',drive_id:'second',isDir:false,name:'Movie.mkv'} as IAliGetFileModel
const response=(data:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];vi.mocked(request).mockResolvedValue(response({code:0,data:{dirID:99}}))})
describe('original 123 file commands through account-bound native transport',()=>{
 it('creates a folder using original parentID/name and no renderer token',async()=>{
  expect(await createRemoteFolder(account,'','Folder')).toEqual({file_id:'99',error:''})
  expect(request).toHaveBeenCalledExactlyOnceWith(account,'POST','https://open-api.123pan.com/upload/v1/file/mkdir',JSON.stringify({parentID:'0',name:'Folder'}),{'Content-Type':'application/json',Platform:'open_platform'})
 })
 it('renames with original PUT body and retains host file identity/type',async()=>{
  let filename=file.name;vi.mocked(request).mockImplementation(async(_account,method,_url,body)=>{if(method==='PUT')filename=JSON.parse(body!).fileName;return response({code:0,data:{fileId:42,parentFileId:12,type:0,filename}})})
  expect(await renameRemoteFile(account,file,'New.mkv')).toEqual({file_id:'42',parent_file_id:'12',isDir:false,name:'New.mkv'})
  expect(request).toHaveBeenCalledWith(account,'PUT','https://open-api.123pan.com/api/v1/file/name',JSON.stringify({fileId:42,fileName:'New.mkv'}),{'Content-Type':'application/json',Platform:'open_platform'})
 })
 it('moves to actual root with original numeric IDs and parent key',async()=>{
  expect(await relocateRemoteFiles(account,[file],'',false,()=>true)).toEqual({success:['42'],failures:[]})
  expect(request).toHaveBeenCalledExactlyOnceWith(account,'POST','https://open-api.123pan.com/api/v1/file/move',JSON.stringify({fileIDs:[42],toParentFileID:0}),{'Content-Type':'application/json',Platform:'open_platform'})
 })
 it('moves selected files to recycle bin with original fileIDs body',async()=>{
  expect(supportsRemoteTrashMove(account)).toBe(true);expect(supportsRemoteTrash(account)).toBe(true)
  expect(await mutateTrash(account,[file],'trash',()=>true)).toEqual({success:['42'],failures:[]})
  expect(request).toHaveBeenCalledExactlyOnceWith(account,'POST','https://open-api.123pan.com/api/v1/file/trash',JSON.stringify({fileIDs:[42]}),{'Content-Type':'application/json',Platform:'open_platform'})
 })
 it.each(['NaN','1e3','0042','9007199254740993','-1','0'])('rejects lossy/non-file numeric identity %s before writes',async id=>{
  await expect(renameRemoteFile(account,{...file,file_id:id},'New.mkv')).rejects.toThrow('标识');expect(request).not.toHaveBeenCalled()
 })
 it('does not count HTTP 202 or business error as completion',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response({code:0},202)).mockResolvedValueOnce(response({code:9,message:'conflict'}))
  expect((await relocateRemoteFiles(account,[file],'5',false,()=>true)).success).toEqual([])
  await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow()
 })
 it('retains confirmed IDs on partial failure and stops when context changes',async()=>{
  let current=true;vi.mocked(request).mockImplementationOnce(async()=>{current=false;return response({code:0})})
  const output=await relocateRemoteFiles(account,[file,{...file,file_id:'43'}],'5',false,()=>current);expect(output.success).toEqual(['42']);expect(output.failures).toHaveLength(1);expect(request).toHaveBeenCalledTimes(1)
 })
 it('rejects batch copy without an open source browser and unsupported trash management',async()=>{
  expect(supportsRemoteCopy(account)).toBe(true);await expect(relocateRemoteFiles(account,[file,{...file,file_id:'43'}],'5',true,()=>true)).rejects.toThrow('source browser is closed')
  for(const operation of ['purge','permanent'] as const)await expect(mutateTrash(account,[file],operation,()=>true)).rejects.toThrow('不支持')
  expect(request).not.toHaveBeenCalled()
 })
 it('rejects account substitution and invalid new folder receipt',async()=>{
  await expect(createRemoteFolder({...account,providerId:'box'},'','Folder')).rejects.toThrow('来源不匹配')
  expect(request).not.toHaveBeenCalled();vi.mocked(request).mockResolvedValue(response({code:0,data:{dirID:'9007199254740993'}}));await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('标识')
 })
})
