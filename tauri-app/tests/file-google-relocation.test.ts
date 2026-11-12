import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {json} from '@/features/sources/transport'
import {relocateRemoteFiles} from '@/features/files/drive/relocationMutations'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({json:vi.fn()}))
const source={id:'second-google',providerId:'google' as const,name:'Google',baseUrl:'',authOrigins:[]}
const file={file_id:'opaque/id',drive_id:source.id,parent_file_id:'stale-parent',name:'Movie.mkv',isDir:false} as IAliGetFileModel
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[source]})
describe('original Google move/copy protocols with native response validation',()=>{
 it('moves using the actual parent from source metadata and retains shared-drive query flags',async()=>{
  vi.mocked(json).mockResolvedValueOnce({id:file.file_id,parents:['actual-parent']}).mockResolvedValueOnce({id:file.file_id,parents:['target']})
  expect(await relocateRemoteFiles(source,[file],'target',false,()=>true)).toEqual({success:[file.file_id],failures:[]})
  const call=vi.mocked(json).mock.calls[1]!,url=new URL(call[2]);expect(call[0]).toEqual(source);expect(call[1]).toBe('PATCH');expect(url.pathname).toBe('/drive/v3/files/opaque%2Fid')
  expect(url.searchParams.get('addParents')).toBe('target');expect(url.searchParams.get('removeParents')).toBe('actual-parent');expect(url.searchParams.get('supportsAllDrives')).toBe('true')
 })
 it('resolves the real Google root ID before validating a root move receipt',async()=>{
  vi.mocked(json).mockResolvedValueOnce({id:'real-root',mimeType:'application/vnd.google-apps.folder'}).mockResolvedValueOnce({id:file.file_id,parents:['old']}).mockResolvedValueOnce({id:file.file_id,parents:['real-root']})
  expect((await relocateRemoteFiles(source,[file],'',false,()=>true)).success).toEqual([file.file_id])
  expect(new URL(vi.mocked(json).mock.calls[0]![2]).pathname).toBe('/drive/v3/files/root')
  expect(new URL(vi.mocked(json).mock.calls[2]![2]).searchParams.get('addParents')).toBe('real-root')
 })
 it('copies with the original body and requires a new ID in the confirmed target',async()=>{
  vi.mocked(json).mockResolvedValue({id:'copied',parents:['target']})
  expect((await relocateRemoteFiles(source,[file],'target',true,()=>true)).success).toEqual([file.file_id])
  expect(vi.mocked(json).mock.calls[0]?.[3]).toEqual({parents:['target']})
  vi.mocked(json).mockResolvedValue({id:file.file_id,parents:['target']})
  expect((await relocateRemoteFiles(source,[file],'target',true,()=>true)).success).toEqual([])
 })
 it('rejects wrong metadata and mismatched move parents without claiming success',async()=>{
  vi.mocked(json).mockResolvedValue({id:'wrong',parents:['old']})
  expect((await relocateRemoteFiles(source,[file],'target',false,()=>true)).success).toEqual([]);expect(json).toHaveBeenCalledTimes(1)
  vi.mocked(json).mockReset().mockResolvedValueOnce({id:file.file_id,parents:['old']}).mockResolvedValueOnce({id:file.file_id,parents:['wrong']})
  expect((await relocateRemoteFiles(source,[file],'target',false,()=>true)).failures[0]).toContain('目标目录')
 })
 it('reports unsupported directory copies and stops future writes after a source change',async()=>{
  expect((await relocateRemoteFiles(source,[{...file,isDir:true}],'target',true,()=>true)).failures[0]).toContain('不支持直接复制文件夹');expect(json).not.toHaveBeenCalled()
  expect((await relocateRemoteFiles(source,[file],'target',false,()=>false)).success).toEqual([]);expect(json).not.toHaveBeenCalled()
 })
})
