import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {json} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {relocateRemoteFiles} from '@/features/files/drive/relocationMutations'
import {mutateTrash,supportsRemoteTrash,supportsRemoteTrashMove} from '@/features/files/drive/trashMutations'
import {apiDropboxDeleteBatch} from '@/features/files/drive/electron/providers/dropbox'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),playable:()=>false}))
const {pane}=vi.hoisted(()=>({pane:{sourceId:'source',context:1,file:vi.fn()}}))
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>pane}))
const account={id:'source',providerId:'dropbox' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
const file={file_id:'id:movie',drive_id:'source',name:'Movie.mkv',isDir:false,parent_file_id:'id:old'} as IAliGetFileModel
const metadata={id:file.file_id,'.tag':'file',name:'Movie.mkv',path_display:'/Old/Movie.mkv'}
const moved={...metadata,path_display:'/Movie.mkv'},complete=(success:unknown)=>({'.tag':'complete',entries:[{'.tag':'success',success}]})
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];pane.sourceId='source';pane.context++;pane.file.mockImplementation(id=>id===file.file_id?file:id==='id:target'?{isDir:true,name:'Target'}:undefined)})
afterEach(()=>vi.useRealTimers())
describe('original Dropbox batch commands through native lifecycle ports',()=>{
 it('moves with original ordered batch request and authoritative ID/path',async()=>{
  vi.mocked(json).mockResolvedValueOnce(metadata).mockResolvedValueOnce(complete(moved))
  expect(await relocateRemoteFiles(account,[file],'',false,()=>true)).toMatchObject({success:[file.file_id],failures:[],names:{[file.file_id]:'Movie.mkv'}})
  expect(json).toHaveBeenLastCalledWith(account,'POST','https://api.dropboxapi.com/2/files/move_batch_v2',{entries:[{from_path:'/Old/Movie.mkv',to_path:'/Movie.mkv'}],autorename:true,allow_ownership_transfer:false})
 })
 it('retains original autorename behavior and returns the actual confirmed name',async()=>{
  vi.mocked(json).mockResolvedValueOnce(metadata).mockResolvedValueOnce(complete({...moved,name:'Movie (1).mkv',path_display:'/Movie (1).mkv'}))
  expect(await relocateRemoteFiles(account,[file],'',false,()=>true)).toMatchObject({success:[file.file_id],names:{[file.file_id]:'Movie (1).mkv'}})
 })
 it('resolves actual target folder ID and copies into it with a new ID',async()=>{
  vi.mocked(json).mockResolvedValueOnce({id:'id:target','.tag':'folder',path_display:'/Target'}).mockResolvedValueOnce(metadata).mockResolvedValueOnce(complete({...moved,id:'id:copy',path_display:'/Target/Movie.mkv'}))
  expect((await relocateRemoteFiles(account,[file],'id:target',true,()=>true)).success).toEqual([file.file_id])
  expect(vi.mocked(json).mock.calls.at(-1)![3]).toEqual({entries:[{from_path:'/Old/Movie.mkv',to_path:'/Target/Movie.mkv'}],autorename:true})
 })
 it('polls the same job without relaunching until confirmed complete',async()=>{
  vi.useFakeTimers();vi.mocked(json).mockResolvedValueOnce(metadata).mockResolvedValueOnce({'.tag':'async_job_id',async_job_id:'job'}).mockResolvedValueOnce({'.tag':'in_progress'}).mockResolvedValueOnce(complete(moved))
  const result=relocateRemoteFiles(account,[file],'',false,()=>true);await vi.advanceTimersByTimeAsync(1000);expect((await result).success).toEqual([file.file_id]);expect(vi.mocked(json).mock.calls.filter(call=>call[2].endsWith('/move_batch_v2'))).toHaveLength(1);expect(vi.mocked(json).mock.calls.at(-1)![3]).toEqual({async_job_id:'job'})
 })
 it.each([complete({...moved,id:'id:wrong'}),complete({...moved,path_display:'/Wrong/Movie.mkv'}),{'.tag':'complete',entries:[]},{'.tag':'failed'}, {'.tag':'async_job_id'},complete(undefined)])('rejects incomplete, wrong identity or target receipt %j',async receipt=>{
  vi.mocked(json).mockResolvedValueOnce(metadata).mockResolvedValueOnce(receipt);const result=await relocateRemoteFiles(account,[file],'',false,()=>true);expect(result.success).toEqual([]);expect(result.failures).toHaveLength(1)
 })
 it('stops pending polling when browser changes and never launches another item',async()=>{
  vi.useFakeTimers();vi.mocked(json).mockResolvedValueOnce(metadata).mockResolvedValueOnce({'.tag':'async_job_id',async_job_id:'job'}).mockImplementationOnce(async()=>{pane.context++;return {'.tag':'in_progress'}})
  const result=await relocateRemoteFiles(account,[file],'',false,()=>true);expect(result.success).toEqual([]);expect(json).toHaveBeenCalledTimes(3)
 })
 it('keeps original index mapping for partially successful delete batch',async()=>{
  const second={...file,file_id:'id:second',name:'Second.mkv'};pane.file.mockImplementation(id=>id===file.file_id?file:second)
  vi.mocked(json).mockResolvedValueOnce(metadata).mockResolvedValueOnce({...metadata,id:second.file_id,path_display:'/Old/Second.mkv'}).mockResolvedValueOnce({'.tag':'complete',entries:[{'.tag':'failure'},{'.tag':'success',metadata:{'.tag':'deleted',path_display:'/Old/Second.mkv'}}]})
  expect(await apiDropboxDeleteBatch(account.id,[file.file_id,second.file_id],()=>{})).toEqual([second.file_id])
 })
 it('exposes trash move only, and never opens unsupported permanent-delete/restore endpoints',async()=>{
  expect(supportsRemoteTrashMove(account)).toBe(true);expect(supportsRemoteTrash(account)).toBe(false)
  for(const operation of ['restore','purge','permanent'] as const)await expect(mutateTrash(account,[file],operation,()=>true)).rejects.toThrow('不支持')
  expect(json).not.toHaveBeenCalled()
  vi.mocked(json).mockResolvedValueOnce(metadata).mockResolvedValueOnce({'.tag':'complete',entries:[{'.tag':'success',metadata:{'.tag':'deleted',path_display:'/Old/Movie.mkv'}}]})
  expect((await mutateTrash(account,[file],'trash',()=>true)).success).toEqual([file.file_id]);expect(vi.mocked(json).mock.calls.at(-1)![3]).toEqual({entries:[{path:'/Old/Movie.mkv'}]})
 })
})
