import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onedrive, dropbox, box, google, cloud123, drive115, quark, baidu } from '@/features/sources/cloud'
import {nativeCall} from '@/platform/native'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import { json } from '@/features/sources/transport'
import type { Account } from '@/features/sources/contracts'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn()}))
vi.mock('@/platform/native',async original=>({...await original<typeof import('@/platform/native')>(),nativeCall:vi.fn()}))
const account=(providerId:Account['providerId']):Account=>({id:providerId,providerId,name:providerId,baseUrl:'https://unused.test',authOrigins:[]})
const item={id:'file/1',name:'movie.mp4',isDirectory:false,size:1,playable:true}
beforeEach(()=>vi.resetAllMocks())
describe('ported cloud protocol contracts',()=>{
 it('OneDrive maps folders and consumes only a Graph continuation URL',async()=>{
  vi.mocked(json).mockResolvedValue({value:[{id:'dir',name:'folder',folder:{}}],'@odata.nextLink':'https://graph.microsoft.com/v1.0/next'})
  const page=await onedrive.list(account('onedrive'),'')
  expect(page.entries[0]?.isDirectory).toBe(true);expect(page.nextCursor).toContain('/v1.0/next')
  await expect(onedrive.list(account('onedrive'),'','https://evil.test/next')).rejects.toThrow()
  expect(json).toHaveBeenCalledTimes(1)
 })
 it('Dropbox continuation uses its opaque cursor and preserves account identity',async()=>{
  vi.mocked(json).mockResolvedValueOnce({entries:[],cursor:'next',has_more:true}).mockResolvedValueOnce({link:'https://cdn.test/video'})
  expect((await dropbox.list(account('dropbox'),'','opaque')).nextCursor).toBe('next')
  expect(json).toHaveBeenNthCalledWith(1,account('dropbox'),'POST','https://api.dropboxapi.com/2/files/list_folder/continue',{cursor:'opaque'})
  expect(await dropbox.resolve(account('dropbox'),item)).toMatchObject({accountId:'dropbox',fileId:'file/1',headers:{}})
 })
 it('Box offset derives from returned item count and content uses header-bound API URL',async()=>{
  vi.mocked(json).mockResolvedValue({entries:[{id:'x',name:'a.mp4',type:'file',size:4}],total_count:3,limit:200})
  expect((await box.list(account('box'),'','1')).nextCursor).toBe('2')
  expect((await box.resolve(account('box'),item)).url).toBe('https://api.box.com/2.0/files/file%2F1/content')
 })
 it('Google escapes query parents and propagates its page token',async()=>{
  vi.mocked(json).mockResolvedValue({files:[{id:'d',name:'dir',mimeType:'application/vnd.google-apps.folder'}],nextPageToken:'next'})
  const page=await google.list(account('google'),"parent'one",'opaque')
  const url=new URL(vi.mocked(json).mock.calls[0]![2]);expect(url.searchParams.get('q')).toContain("parent\\'one");expect(url.searchParams.get('pageToken')).toBe('opaque');expect(page.entries[0]?.isDirectory).toBe(true)
 })
 it('123 maps last-file pagination and rejects business errors',async()=>{
  vi.mocked(json).mockResolvedValueOnce({code:0,data:{fileList:[{fileId:4,filename:'dir',type:1,size:0}],lastFileId:4}}).mockResolvedValueOnce({code:401,message:'expired'})
  expect((await cloud123.list(account('123'),'')).nextCursor).toBe('4')
  await expect(cloud123.resolve(account('123'),item)).rejects.toThrow('401')
 })
 it('115 preserves original category and continues without a provider total',async()=>{
  setActivePinia(createPinia());useFileSourcesStore().accounts=[account('115')]
  vi.mocked(nativeCall).mockResolvedValue({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify({code:0,data:Array.from({length:200},(_,n)=>({fid:String(n+1),pid:'0',fn:n===0?'folder':'movie.mp4',fc:n===0?'0':'1',fs:42}))}))),finalUrl:''})
  const page=await drive115.list(account('115'),'')
  expect(JSON.parse(page.nextCursor!).offset).toBe(200);expect(page.entries[0]?.isDirectory).toBe(true);expect(page.entries[1]?.playable).toBe(true)
 })

 it('Quark keeps its own page number, folder mapping and provider error handling',async()=>{
  setActivePinia(createPinia());useFileSourcesStore().accounts=[account('quark')]
  const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
  vi.mocked(nativeCall).mockResolvedValueOnce(response({code:0,data:{list:Array.from({length:100},(_,n)=>({fid:'next-'+n,file_name:n===0?'folder':'clip.mp4',file_type:n===0?0:1,pdir_fid:'parent'}))},metadata:{_total:250}})).mockResolvedValueOnce(response({code:31001,status:'error'}))
  const cursor=JSON.stringify({account:'quark',view:'files',parent:'parent',page:2,previous:Array.from({length:100},(_,n)=>'prior-'+n),hashes:['0'.repeat(64)]})
  const page=await quark.list(account('quark'),'parent',cursor)
  const url=new URL((vi.mocked(nativeCall).mock.calls[0]![1] as any).request.url)
  expect(url.searchParams.get('_page')).toBe('2');expect(url.searchParams.get('pdir_fid')).toBe('parent');expect(JSON.parse(page.nextCursor!).page).toBe(3);expect(page.entries[0]?.isDirectory).toBe(true);expect(page.entries[1]?.playable).toBe(true)
  await expect(quark.list(account('quark'),'')).rejects.toThrow('夸克文件操作未确认成功')
 })

 it('Baidu keeps directory paths distinct from file ids and passes native-only resolve context',async()=>{
  setActivePinia(createPinia());useFileSourcesStore().accounts=[account('baidu')]
  const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
  vi.mocked(nativeCall).mockResolvedValueOnce(response({errno:0,has_more:1,list:[{fs_id:5,path:'/Movie',server_filename:'Movie',isdir:1,size:0},{fs_id:'9007199254740997',path:'/clip.mp4',server_filename:'clip.mp4',isdir:0,size:42}]})).mockResolvedValueOnce(response({errno:110}))
  const page=await baidu.list(account('baidu'),'/')
  expect(page.entries[0]?.id).toBe('5');expect(page.entries[1]?.id).toBe('9007199254740997');expect(JSON.parse(page.nextCursor!).start).toBe(1000)
  const request=new URL((vi.mocked(nativeCall).mock.calls[0]![1] as any).request.url);expect(request.searchParams.has('access_token')).toBe(false);expect(request.searchParams.get('start')).toBe('0');expect(request.searchParams.get('limit')).toBe('1000')
  await expect(baidu.list(account('baidu'),'/')).rejects.toThrow('110')
  await expect(baidu.list(account('baidu'),'not-a-path')).rejects.toThrow()
 })
 it('Baidu preserves unquoted long file identifiers from native JSON bytes',async()=>{
  setActivePinia(createPinia());useFileSourcesStore().accounts=[account('baidu')]
  vi.mocked(nativeCall).mockResolvedValue({status:200,headers:{},body:Array.from(new TextEncoder().encode('{"errno":0,"list":[{"fs_id":9007199254740993,"path":"/clip.mp4","server_filename":"clip.mp4","isdir":0,"size":42}]}')),finalUrl:''})
  expect((await baidu.list(account('baidu'),'/')).entries[0]).toMatchObject({id:'9007199254740993',electronModel:{file_id:'9007199254740993'}})
 })


})
