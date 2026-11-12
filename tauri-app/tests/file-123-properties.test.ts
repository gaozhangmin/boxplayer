import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {bindDrivePane,type DrivePanePort} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {createFileProperties} from '@/features/files/drive/fileProperties'
import {request} from '@/features/sources/transport'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),request:vi.fn()}))
const response=(data:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
const account={id:'123-properties',providerId:'123' as const,name:'Fixture',baseUrl:'',authOrigins:[],userId:'owner'}
let file:any,port:DrivePanePort,detail:any,unbind:()=>void
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account]
 file={drive_id:account.id,file_id:'7',parent_file_id:'12',name:'Old.mkv',isDir:false,size:1,category:'video',ext:'mkv'}
 port={sourceId:account.id,account,local:false,context:1,store:{SelectDirType:'pan'},file:(id:string)=>id==='12'?{file_id:'12',name:'Movies',parent_file_id:'',isDir:true}:file,list:vi.fn()} as unknown as DrivePanePort;unbind=bindDrivePane(port)
 detail={fileId:7,parentFileId:12,filename:'Actual.mkv',type:0,size:4096,createAt:'2024-01-01T00:00:00Z',updateAt:'2025-01-01T00:00:00Z',thumbnailUrl:'https://fixture.test/thumb',private_token:'fixture-hidden'}
 vi.mocked(request).mockImplementation(async()=>response({code:0,data:detail}))
})
afterEach(()=>unbind?.())
it('uses original detail request/model with actual identity and public metadata',async()=>{
 const reader=createFileProperties()
 try{
  const result=await reader.read(file);expect(result.fileInfo).toMatchObject({drive_id:account.id,file_id:'7',parent_file_id:'12',name:'Actual.mkv',icon:'iconfile_video',size:4096,created_at:detail.createAt,updated_at:detail.updateAt,thumbnail:detail.thumbnailUrl});expect(result.dirPath).toBe('/Movies');expect(JSON.stringify(result)).not.toContain('fixture-hidden')
  expect(vi.mocked(request).mock.calls[0]).toEqual([account,'GET','https://open-api.123pan.com/api/v1/file/detail?fileID=7',undefined,{'Content-Type':'application/json',Platform:'open_platform'}])
 }finally{reader.dispose()}
})
it('preserves original detail aliases and normalizes native root parent',async()=>{
 detail={...detail,fileId:undefined,fileID:7,parentFileId:undefined,parentFileID:0,createAt:undefined,create_at:'2024-01-01T00:00:00Z',updateAt:undefined,update_at:'2025-01-01T00:00:00Z'}
 const reader=createFileProperties();try{const result=await reader.read(file);expect(result.dirPath).toBe('/');expect(result.fileInfo).toMatchObject({file_id:'7',parent_file_id:'',created_at:detail.create_at,updated_at:detail.update_at})}finally{reader.dispose()}
})
it('retains original folder details without inventing recursive totals',async()=>{
 file.isDir=true;detail.type=1;detail.filename='Folder'
 const reader=createFileProperties();try{const result=await reader.read(file);expect(result.fileInfo).toMatchObject({type:'folder',size:4096,icon:'iconfile-folder'});expect(result.dirInfo).toBeUndefined();expect(port.list).not.toHaveBeenCalled()}finally{reader.dispose()}
})
it.each([{fileId:9},{fileId:Number.MAX_SAFE_INTEGER+1},{parentFileId:-1},{type:1},{size:-1},{size:'4096'},{createAt:'not-a-date'},{filename:''},{trashed:1}])('rejects mismatched or invalid detail %j',async patch=>{
 detail={...detail,...patch};const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow()}finally{reader.dispose()}
})
it('does not show an old path after the detail indicates an external move',async()=>{
 detail.parentFileId=99;port.file=(id:string)=>id==='7'?file:undefined
 const reader=createFileProperties();try{expect((await reader.read(file)).dirPath).toBe('路径暂不可用')}finally{reader.dispose()}
})
it('rejects a late property read after closing',async()=>{
 let finish!:(value:any)=>void;vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 const reader=createFileProperties(),pending=reader.read(file);reader.dispose();finish(response({code:0,data:detail}));await expect(pending).rejects.toThrow('关闭')
})
it('rejects metadata after same-ID account replacement',async()=>{
 vi.mocked(request).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'other'}];return response({code:0,data:detail})})
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('身份')}finally{reader.dispose()}
})
it('rejects metadata after a source context change',async()=>{
 vi.mocked(request).mockImplementationOnce(async()=>{port.context=(port.context??0)+1;return response({code:0,data:detail})})
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('切换')}finally{reader.dispose()}
})
