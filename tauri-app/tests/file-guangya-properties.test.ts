import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {bindDrivePane,type DrivePanePort} from '@/features/files/drive/ports'
import {createFileProperties} from '@/features/files/drive/fileProperties'
import {request} from '@/features/sources/transport'
import {withGuangyaDetailGuard} from '@/features/files/drive/guangyaFileTransport'
import {apiGuangyaFileDetail} from '@/features/files/drive/electron/providers/guangyaMetadata'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),request:vi.fn()}))
const account={id:'guangya-properties',providerId:'guangya' as const,name:'Fixture',baseUrl:'',userId:'owner',authOrigins:[]},file={file_id:'movie',drive_id:account.id,parent_file_id:'parent',name:'Old.mkv',isDir:false,size:1,category:'video',ext:'mkv'} as any
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let raw:any,port:DrivePanePort,unbind:()=>void
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account]
 raw={fileId:'movie',name:'Actual.mkv',resType:1,dirType:1,parentId:'parent',fileSize:4096,createAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-02T00:00:00Z',thumbnailUrl:'https://fixture.test/thumb',md5:'fixture-md5',private_token:'fixture-hidden'}
 vi.mocked(request).mockImplementation(async()=>response({code:0,data:raw}))
 port={sourceId:account.id,context:1,local:false,account,file:(id:string)=>id==='parent'?{file_id:'parent',name:'Movies',isDir:true,parent_file_id:''}:file,list:vi.fn().mockResolvedValue([])} as unknown as DrivePanePort
 unbind=bindDrivePane(port)
})
afterEach(()=>unbind())
it('preserves original live metadata and native account binding without exposing raw private fields',async()=>{
 const reader=createFileProperties()
 try{
  const result=await reader.read(file)
  expect(result.fileInfo).toMatchObject({file_id:'movie',drive_id:account.id,name:'Actual.mkv',size:4096,icon:'iconfile_video',thumbnail:raw.thumbnailUrl,description:'guangya_id:movie',content_hash:'fixture-md5',content_hash_name:'md5',created_at:'2026-11-01T00:00:00.000Z',updated_at:'2026-11-02T00:00:00.000Z'})
  expect(result.dirPath).toBe('/Movies');expect(JSON.stringify(result.fileInfo)).not.toContain('fixture-hidden')
  expect(vi.mocked(request).mock.calls[0]![0]).toEqual(account)
 }finally{reader.dispose()}
})
it.each([{fileId:'wrong'},{resType:2},{parentId:undefined},{fileSize:undefined},{fileSize:-1},{thumbnailUrl:42},{md5:42},{mimeType:42},{createAt:'bad-time'},{name:42},{resType:1,isDir:true}])('rejects conflicting or malformed detail %j',async patch=>{
 raw={...raw,...patch};const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow()}finally{reader.dispose()}
})
it('does not guess the algorithm of a generic contentHash',async()=>{
 raw.contentHash='generic';const reader=createFileProperties();try{expect((await reader.read(file)).fileInfo).toMatchObject({content_hash:'generic',content_hash_name:''})}finally{reader.dispose()}
})
it('labels an explicitly selected SHA-1 while preserving original date fallback',async()=>{
 delete raw.md5;delete raw.updatedAt;raw.sha1='fixture-sha1';const reader=createFileProperties()
 try{expect((await reader.read(file)).fileInfo).toMatchObject({content_hash:'fixture-sha1',content_hash_name:'sha1',updated_at:'2026-11-01T00:00:00.000Z'})}finally{reader.dispose()}
})
it('computes complete folder totals instead of using mapper placeholders',async()=>{
 raw.resType=2;vi.mocked(port.list).mockResolvedValue([{...file,file_id:'child',isDir:false,size:42}])
 const reader=createFileProperties();try{const result=await reader.read({...file,isDir:true});expect(result.dirInfo).toEqual({size:42,file_count:1,folder_count:0});expect(result.fileInfo).toMatchObject({size:42,file_count:1})}finally{reader.dispose()}
})
it('discards late metadata on close without issuing the original root-list fallback',async()=>{
 let done!:(value:any)=>void;vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>done=resolve))
 const reader=createFileProperties(),pending=reader.read(file);reader.dispose();done(response({code:0,data:raw}))
 await expect(pending).rejects.toThrow('关闭');expect(request).toHaveBeenCalledOnce()
})
it('does not start a fallback with replacement-account credentials',async()=>{
 vi.mocked(request).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'different'}];throw Error('connection lost')})
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('身份');expect(request).toHaveBeenCalledOnce()}finally{reader.dispose()}
})
it('retains the original root fallback when its read session is still current',async()=>{
 vi.mocked(request).mockRejectedValueOnce(Error('detail unavailable')).mockResolvedValueOnce(response({code:0,data:{list:[raw]}}))
 const reader=createFileProperties();try{expect((await reader.read(file)).fileInfo.name).toBe('Actual.mkv');expect(request).toHaveBeenCalledTimes(2);expect(vi.mocked(request).mock.calls[1]![2]).toContain('/get_file_list')}finally{reader.dispose()}
})
it('keeps concurrent same-account detail guards independent',async()=>{
 let active=true,finish!:(value:any)=>void;const check=()=>{if(!active)throw Error('closed')}
 vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve)).mockResolvedValue(response({code:0,data:raw}))
 const first=withGuangyaDetailGuard(account.id,check,user=>apiGuangyaFileDetail(user,'movie'));active=false
 const second=withGuangyaDetailGuard(account.id,()=>{},user=>apiGuangyaFileDetail(user,'movie'))
 expect((await second)?.name).toBe('Actual.mkv');finish(response({code:0,data:raw}));await expect(first).rejects.toThrow('closed');expect(request).toHaveBeenCalledTimes(2)
})
