import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {json,request} from '@/features/sources/transport'
import {trashPage,mutateTrash,emptyGoogleTrash} from '@/features/files/drive/trashMutations'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:(response:{body:number[]})=>new TextDecoder().decode(new Uint8Array(response.body)),playable:(name:string)=>name.endsWith('.mkv')}))
const google={id:'second-google',providerId:'google' as const,name:'Google',baseUrl:'',authOrigins:[]},box={...google,id:'second-box',providerId:'box' as const}
const file=(id:string,source=google.id)=>({file_id:id,drive_id:source,name:id+'.mkv',isDir:false} as IAliGetFileModel)
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[google,box]})
describe('original trash protocols through native account transport',()=>{
 it('requires matching Google IDs and the requested trash/restore state',async()=>{
  vi.mocked(json).mockResolvedValueOnce({id:'a',trashed:true}).mockResolvedValueOnce({id:'b',trashed:true})
  expect((await mutateTrash(google,[file('a')],'trash',()=>true)).success).toEqual(['a'])
  expect((await mutateTrash(google,[file('b')],'restore',()=>true)).success).toEqual([])
  expect(vi.mocked(json).mock.calls[0]?.[3]).toEqual({trashed:true});expect(vi.mocked(json).mock.calls[1]?.[3]).toEqual({trashed:false})
 })
 it('recognizes a bodyless 204 delete and rejects ambiguous empty 200 responses',async()=>{
  vi.mocked(request).mockResolvedValueOnce({status:204,headers:{},body:[],finalUrl:''}).mockResolvedValueOnce({status:200,headers:{},body:[],finalUrl:''})
  expect((await mutateTrash(google,[file('a')],'permanent',()=>true)).success).toEqual(['a'])
  expect((await mutateTrash(google,[file('b')],'permanent',()=>true)).success).toEqual([])
  expect(json).not.toHaveBeenCalled();expect(vi.mocked(request).mock.calls[0]?.[0].id).toBe(google.id)
 })
 it('does not report an accepted asynchronous delete as completed',async()=>{
  vi.mocked(request).mockResolvedValue({status:202,headers:{},body:Array.from(new TextEncoder().encode('{"status":"pending"}')),finalUrl:''})
  const result=await mutateTrash(google,[file('a')],'permanent',()=>true)
  expect(result.success).toEqual([]);expect(result.failures[0]).toContain('尚未确认删除完成')
 })
 it('accepts Google documented empty JSON success without accepting a pending object',async()=>{
  const response=(body:string)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(body)),finalUrl:''})
  vi.mocked(request).mockResolvedValueOnce(response('{}')).mockResolvedValueOnce(response('{"status":"pending"}'))
  expect((await mutateTrash(google,[file('a')],'permanent',()=>true)).success).toEqual(['a'])
  expect((await mutateTrash(google,[file('b')],'permanent',()=>true)).success).toEqual([])
 })
 it('keeps Box purge distinct from normal deletion and validates restore identity',async()=>{
  vi.mocked(request).mockResolvedValue({status:204,headers:{},body:[],finalUrl:''})
  expect((await mutateTrash(box,[file('a',box.id)],'purge',()=>true)).success).toEqual(['a'])
  expect(request).toHaveBeenCalledWith(expect.objectContaining({id:box.id}),'DELETE','https://api.box.com/2.0/files/a/trash')
  vi.mocked(json).mockResolvedValue({id:'other'});expect((await mutateTrash(box,[file('a',box.id)],'restore',()=>true)).success).toEqual([])
  await expect(mutateTrash(box,[file('a',box.id)],'permanent',()=>true)).rejects.toThrow('不支持')
 })
 it('uses the original Google clear endpoint with native 204 handling',async()=>{
  vi.mocked(request).mockResolvedValue({status:204,headers:{},body:[],finalUrl:''});await emptyGoogleTrash(google)
  expect(request).toHaveBeenCalledWith(expect.objectContaining({id:google.id}),'DELETE','https://www.googleapis.com/drive/v3/files/trash?supportsAllDrives=true')
 })
 it('rejects malformed trash listings instead of reporting an empty bin',async()=>{
  vi.mocked(json).mockResolvedValue({});await expect(trashPage(box)).rejects.toThrow('响应无效');await expect(trashPage(google)).rejects.toThrow('响应无效')
  vi.mocked(json).mockResolvedValue({files:[{id:'a',name:'a.mkv',trashed:false}]});await expect(trashPage(google)).rejects.toThrow('非回收')
 })
 it('preserves provider cursors, actual folder types and original parents',async()=>{
  vi.mocked(json).mockResolvedValueOnce({entries:[{id:'f',name:'Folder',type:'folder',parent:{id:'0'}}],next_marker:'next'}).mockResolvedValueOnce({files:[{id:'a',name:'a.mkv',mimeType:'video/mp4',trashed:true,parents:['old']}],nextPageToken:'token'})
  expect(await trashPage(box,'first')).toMatchObject({entries:[{id:'f',isDirectory:true,originalParent:''}],nextCursor:'next'})
  expect(await trashPage(google,'first')).toMatchObject({entries:[{id:'a',isDirectory:false,originalParent:'old'}],nextCursor:'token'})
  expect(new URL(vi.mocked(json).mock.calls[0]![2]).searchParams.get('marker')).toBe('first');expect(new URL(vi.mocked(json).mock.calls[1]![2]).searchParams.get('pageToken')).toBe('first')
 })
})
