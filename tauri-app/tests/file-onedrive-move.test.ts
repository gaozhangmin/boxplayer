import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {json,request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {relocateRemoteFiles,supportsRemoteCopy} from '@/features/files/drive/relocationMutations'
import {mutateTrash,supportsRemoteTrash,supportsRemoteTrashMove} from '@/features/files/drive/trashMutations'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:(value:{body:number[]})=>new TextDecoder().decode(new Uint8Array(value.body)),playable:()=>false}))
const account={id:'source',providerId:'onedrive' as const,name:'Fixture',baseUrl:'',authOrigins:[]},file={file_id:'opaque/id',drive_id:'source',name:'Movie.mkv',parent_file_id:'old',isDir:false} as IAliGetFileModel
const response=(status:number,body:unknown=undefined)=>({status,headers:{},body:body===undefined?[]:Array.from(new TextEncoder().encode(JSON.stringify(body))),finalUrl:''})
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account]})
describe('OneDrive original move/delete through verified native completion',()=>{
 it('moves opaque IDs with the original parentReference body',async()=>{
  vi.mocked(json).mockResolvedValue({id:file.file_id,parentReference:{id:'target'}})
  expect(await relocateRemoteFiles(account,[file],'target',false,()=>true)).toEqual({success:[file.file_id],failures:[]})
  expect(json).toHaveBeenCalledExactlyOnceWith(account,'PATCH','https://graph.microsoft.com/v1.0/me/drive/items/opaque%2Fid',{parentReference:{id:'target'}})
 })
 it('resolves real root identity before moving instead of assuming a parent ID',async()=>{
  vi.mocked(json).mockResolvedValueOnce({id:'actual-root',folder:{}}).mockResolvedValueOnce({id:file.file_id,parentReference:{id:'actual-root'}})
  expect((await relocateRemoteFiles(account,[file],'',false,()=>true)).success).toEqual([file.file_id])
  expect(vi.mocked(json).mock.calls[1]![3]).toEqual({parentReference:{id:'actual-root'}})
 })
 it.each([{}, {id:'other',parentReference:{id:'target'}},{id:file.file_id},{id:file.file_id,parentReference:{id:'wrong'}}])('rejects unconfirmed move %j',async row=>{
  vi.mocked(json).mockResolvedValue(row);const result=await relocateRemoteFiles(account,[file],'target',false,()=>true);expect(result.success).toEqual([]);expect(result.failures).toHaveLength(1)
 })
 it('preserves successful IDs and stops remaining batch after source changes',async()=>{
  let current=true;vi.mocked(json).mockImplementation(async()=>{current=false;return {id:file.file_id,parentReference:{id:'target'}}})
  const result=await relocateRemoteFiles(account,[file,{...file,file_id:'second'}],'target',false,()=>current)
  expect(result.success).toEqual([file.file_id]);expect(result.failures).toHaveLength(1);expect(json).toHaveBeenCalledTimes(1)
 })
 it('exposes copy after the monitored native completion port is wired',()=>{expect(supportsRemoteCopy(account)).toBe(true)})
 it('accepts only completed 204 deletion and exposes only trash move',async()=>{
  expect(supportsRemoteTrashMove(account)).toBe(true);expect(supportsRemoteTrash(account)).toBe(false)
  vi.mocked(request).mockResolvedValue(response(204))
  expect(await mutateTrash(account,[file],'trash',()=>true)).toEqual({success:[file.file_id],failures:[]})
  expect(request).toHaveBeenCalledExactlyOnceWith(account,'DELETE','https://graph.microsoft.com/v1.0/me/drive/items/opaque%2Fid')
 })
 it.each([200,202])('rejects non-terminal delete status %s',async status=>{
  vi.mocked(request).mockResolvedValue(response(status));const result=await mutateTrash(account,[file],'trash',()=>true);expect(result.success).toEqual([]);expect(result.failures).toHaveLength(1)
 })
 it('rejects stale account or unsupported permanent deletion without requests',async()=>{
  await expect(mutateTrash(account,[file],'permanent',()=>true)).rejects.toThrow('不支持')
  useFileSourcesStore().accounts=[];await expect(relocateRemoteFiles(account,[file],'target',false,()=>true)).rejects.toThrow('来源不匹配');expect(request).not.toHaveBeenCalled();expect(json).not.toHaveBeenCalled()
 })
})
