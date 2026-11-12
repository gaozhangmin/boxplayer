import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {copyGuangyaFile} from '@/features/files/drive/guangyaCopy'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
let serial=0,account:any,file:IAliGetFileModel,copied:boolean,rows:any[],before:any[],business:number
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());account={id:`copy-${++serial}`,providerId:'guangya',name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore().accounts=[account];file={drive_id:account.id,file_id:'original',name:'Movie.mkv',isDir:false,size:42,content_hash:'hash'} as IAliGetFileModel;copied=false;before=[];rows=[{fileId:'new',name:file.name,resType:1,size:42,md5:'hash'}];business=0;vi.mocked(request).mockImplementation(async(_account,_method,url)=>{if(url.endsWith('/copy_file')){copied=true;return response({code:business,data:{}})}return response({code:0,data:{list:copied?rows:before}})})})
it('preserves original copy body and confirms a new matching destination entry',async()=>{expect(await copyGuangyaFile(account,file,'backup_root',()=>true)).toEqual(['original']);expect(vi.mocked(request).mock.calls[1]).toEqual([account,'POST','https://api.guangyapan.com/nd.bizuserres.s/v1/file/copy_file','{"fileIds":["original"],"parentId":""}',{'Content-Type':'application/json'}]);expect(request).toHaveBeenCalledTimes(3)})
it('shares a concurrent submission instead of creating duplicate copies',async()=>{expect(await Promise.all([copyGuangyaFile(account,file,'',()=>true),copyGuangyaFile(account,file,'',()=>true)])).toEqual([['original'],['original']]);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/copy_file'))).toHaveLength(1)})
it('does not confuse preexisting matching files with a new copy and rechecks without resubmitting',async()=>{before=[rows[0]];await expect(copyGuangyaFile(account,file,'',()=>true)).rejects.toThrow('尚未唯一确认');rows.push({...rows[0],fileId:'newer'});expect(await copyGuangyaFile(account,file,'',()=>true)).toEqual(['original']);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/copy_file'))).toHaveLength(1)})
it.each([{size:43},{md5:'different'},{resType:2},{name:'Wrong.mkv'},{fileId:'original'}])('does not accept conflicting copied metadata %j',async patch=>{rows=[{...rows[0],...patch}];await expect(copyGuangyaFile(account,file,'',()=>true)).rejects.toThrow('尚未唯一确认')})
it('does not infer success from unrelated new entries after a failed acknowledgment',async()=>{business=500;await expect(copyGuangyaFile(account,file,'',()=>true)).rejects.toThrow('受理状态未知');await expect(copyGuangyaFile(account,file,'',()=>true)).rejects.toThrow('受理状态未知');expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/copy_file'))).toHaveLength(1)})
it('requires a unique candidate',async()=>{rows.push({...rows[0],fileId:'other-new'});await expect(copyGuangyaFile(account,file,'',()=>true)).rejects.toThrow('唯一确认')})
it('does not submit if the pane changes during the preflight listing',async()=>{await expect(copyGuangyaFile(account,file,'',()=>vi.mocked(request).mock.calls.length===0)).rejects.toThrow('来源已切换');expect(copied).toBe(false)})
it('requires a confirmed destination folder',async()=>{vi.mocked(request).mockResolvedValueOnce(response({code:0,data:{fileId:'target',name:'target',resType:1}}));await expect(copyGuangyaFile(account,file,'target',()=>true)).rejects.toThrow('目标');expect(copied).toBe(false)})
it('freezes the selected metadata before asynchronous preflight work',async()=>{
 const handler=vi.mocked(request).getMockImplementation()!
 let release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve})
 vi.mocked(request).mockImplementationOnce(async(...args)=>{await gate;return handler(...args)})
 const copying=copyGuangyaFile(account,file,'',()=>true)
 file.name='Changed.mkv';file.size=999
 release();expect(await copying).toEqual(['original'])
})
it('does not let a late confirmation erase a newer in-flight copy receipt',async()=>{
 let lists=0,copies=0,releaseLate!:(value:any)=>void,releaseNew!:(value:any)=>void
 const late=new Promise<any>(resolve=>{releaseLate=resolve}),newPreflight=new Promise<any>(resolve=>{releaseNew=resolve})
 const item=(id:string)=>({fileId:id,name:'Movie.mkv',resType:1,size:42,md5:'hash'})
 const listing=(items:any[])=>response({code:0,data:{list:items}})
 vi.mocked(request).mockImplementation(async(_account,_method,url)=>{
  if(url.endsWith('/copy_file')){copies++;return response({code:0,data:{}})}
  lists++
  if(lists===1)return listing([])
  if(lists===2)return listing([item('copy-1')])
  if(lists===3)return late
  if(lists===4)return newPreflight
  return listing([item('copy-1'),item('copy-2')])
 })
 const first=copyGuangyaFile(account,file,'',()=>true),second=copyGuangyaFile(account,file,'',()=>true)
 expect(await first).toEqual(['original'])
 await vi.waitFor(()=>expect(lists).toBe(3))
 const third=copyGuangyaFile(account,file,'',()=>true)
 await vi.waitFor(()=>expect(lists).toBe(4))
 releaseLate(listing([item('copy-1')]))
 expect(await second).toEqual(['original'])
 const fourth=copyGuangyaFile(account,file,'',()=>true)
 await Promise.resolve();await Promise.resolve()
 expect(lists).toBe(4)
 releaseNew(listing([item('copy-1')]))
 expect(await Promise.all([third,fourth])).toEqual([['original'],['original']])
 expect(copies).toBe(2)
})
