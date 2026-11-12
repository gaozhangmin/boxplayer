import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {trashPage,mutateTrash,restoredDetails,supportsRemoteTrashDelete,supportsRemoteTrashEmpty,emptyCloud123Trash} from '@/features/files/drive/trashMutations'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(row:{body:number[]})=>new TextDecoder().decode(new Uint8Array(row.body)),playable:(name:string)=>name.endsWith('.mkv')}))
const account={id:'source',providerId:'123' as const,name:'Fixture',baseUrl:'',authOrigins:[]},file={file_id:'42',drive_id:'source',parent_file_id:'12',name:'Movie.mkv',isDir:false} as IAliGetFileModel
const row={fileId:42,parentFileId:12,filename:'Movie.mkv',type:0,size:4,trashed:1,updateAt:'2026-11-08T00:00:00Z'},response=(data:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account]})
describe('123 original recycle list/restore through native ports',()=>{
 it('retains original paged query and maps actual parent/type/date',async()=>{
  vi.mocked(request).mockResolvedValue(response({code:0,data:{fileList:[row],lastFileId:42}}));const page=await trashPage(account)
  expect(page.entries[0]).toMatchObject({id:'42',originalParent:'12',isDirectory:false,name:'Movie.mkv',playable:true,modified:Date.parse(row.updateAt)});expect(page.nextCursor).toBe('42')
  const query=new URL(vi.mocked(request).mock.calls[0]![2]);expect(query.pathname).toBe('/api/v2/file/list');expect(Object.fromEntries(query.searchParams)).toEqual({parentFileId:'0',limit:'100',trashed:'1'})
  vi.mocked(request).mockResolvedValue(response({code:0,data:{fileList:[],lastFileId:-1}}));expect(await trashPage(account,'42')).toEqual({entries:[],nextCursor:undefined});expect(new URL(vi.mocked(request).mock.calls[1]![2]).searchParams.get('lastFileId')).toBe('42')
 })
 it.each([{...row,trashed:0},{...row,fileId:9007199254740992},{...row,filename:''},{...row,type:3}])('does not turn invalid trash data into an empty directory %j',async bad=>{
  vi.mocked(request).mockResolvedValue(response({code:0,data:{fileList:[bad],lastFileId:-1}}));await expect(trashPage(account)).rejects.toThrow()
 })
 it('rejects repeated cursors and business failures',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response({code:0,data:{fileList:[row],lastFileId:42}})).mockResolvedValueOnce(response({code:1,message:'denied'}))
  await expect(trashPage(account,'42')).rejects.toThrow('游标重复');await expect(trashPage(account)).rejects.toThrow()
 })
 it('restores with original fileIDs and filters abnormal IDs',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response({code:0,data:{abnormalFileIDs:[]}})).mockResolvedValueOnce(response({code:0,data:{abnormalFileIDs:[43]}}))
  const output=await mutateTrash(account,[file,{...file,file_id:'43'}],'restore',()=>true);expect(output.success).toEqual(['42']);expect(output.failures).toHaveLength(1)
  expect(request).toHaveBeenNthCalledWith(1,account,'POST','https://open-api.123pan.com/api/v1/file/recover',JSON.stringify({fileIDs:[42]}),{'Content-Type':'application/json',Platform:'open_platform'})
 })
 it.each([{}, {abnormalFileIDs:[99]}, {abnormalFileIDs:[42,42]}])('rejects ambiguous recovery receipt %j',async data=>{
  vi.mocked(request).mockResolvedValue(response({code:0,data}));expect((await mutateTrash(account,[file],'restore',()=>true)).success).toEqual([])
 })
 it('reads original details after recovery and verifies restored identity',async()=>{
  vi.mocked(request).mockResolvedValue(response({code:0,data:{...row,trashed:0,parentFileId:0}}));expect(await restoredDetails(account,[file])).toEqual([{...file,parent_file_id:''}]);expect(new URL(vi.mocked(request).mock.calls[0]![2]).searchParams.get('fileID')).toBe('42')
  vi.mocked(request).mockResolvedValue(response({code:0,data:{...row,fileId:43,trashed:0}}));await expect(restoredDetails(account,[file])).rejects.toThrow('不匹配')
 })
 it('keeps single permanent delete unexposed while enabling original global clear',async()=>{
  expect(supportsRemoteTrashDelete(account)).toBe(false);expect(supportsRemoteTrashEmpty(account)).toBe(true)
  await expect(mutateTrash(account,[file],'purge',()=>true)).rejects.toThrow('不支持');expect(request).not.toHaveBeenCalled()
 })
})

it('uses original web clear endpoint/body and confirms an empty native list',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response({code:0})).mockResolvedValueOnce(response({code:0,data:{fileList:[],lastFileId:-1}}))
 await emptyCloud123Trash(account,()=>true)
 const first=vi.mocked(request).mock.calls[0]!,url=new URL(first[2]);expect(url.origin+url.pathname).toBe('https://www.123pan.com/api/v1/file/trash_delete_all');expect(url.searchParams.get('t')).toMatch(/^\d+$/)
 expect(first.slice(0,2)).toEqual([account,'POST']);expect(JSON.parse(first[3]!)).toEqual({event:'recycleClear',RequestSource:null});expect(first[4]).toEqual({'Content-Type':'application/json'});expect(request).toHaveBeenCalledTimes(2)
})
it.each([{code:3},{}])('does not confirm rejected or malformed clear %j',async data=>{
 vi.mocked(request).mockResolvedValueOnce(response(data));await expect(emptyCloud123Trash(account,()=>true)).rejects.toThrow('未确认');expect(request).toHaveBeenCalledTimes(1)
})
it('does not clear local records solely from an accepted response',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response({code:0})).mockResolvedValueOnce(response({code:0,data:{fileList:[row],lastFileId:-1}}))
 await expect(emptyCloud123Trash(account,()=>true)).rejects.toThrow('仍有项目')
})
it('rejects unfinished empty pagination',async()=>{
 vi.mocked(request).mockResolvedValueOnce(response({code:0})).mockResolvedValueOnce(response({code:0,data:{fileList:[],lastFileId:0}}))
 await expect(emptyCloud123Trash(account,()=>true)).rejects.toThrow('未完成分页')
})
it('stops before and after submission on lifecycle changes',async()=>{
 await expect(emptyCloud123Trash(account,()=>false)).rejects.toThrow('已变化');expect(request).not.toHaveBeenCalled()
 let current=true;vi.mocked(request).mockImplementationOnce(async()=>{current=false;return response({code:0})})
 await expect(emptyCloud123Trash(account,()=>current)).rejects.toThrow('已变化');expect(request).toHaveBeenCalledTimes(1)
})
it('does not read a replacement account after the original clear receipt',async()=>{
 vi.mocked(request).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'other'}];return response({code:0})})
 await expect(emptyCloud123Trash(account,()=>true)).rejects.toThrow('已变化');expect(request).toHaveBeenCalledTimes(1)
})
