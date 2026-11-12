import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {bindDrivePane,type DrivePanePort} from '@/features/files/drive/ports'
import {createFileProperties} from '@/features/files/drive/fileProperties'
import {json} from '@/features/sources/transport'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn()}))
const account={id:'139-properties',providerId:'139' as const,name:'Fixture',baseUrl:'https://personal.yun.139.com/hcy',userId:'owner',authOrigins:[]}
const file={file_id:'movie',drive_id:account.id,parent_file_id:'parent',name:'Old.mkv',isDir:false,size:1,category:'video',ext:'mkv'} as any
let unbind:()=>void,port:DrivePanePort,rows:any[]
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account]
 rows=[{fileId:'movie',parentFileId:'parent',name:'Actual.mkv',type:'file',size:4096,updated_at:'2026-11-01T00:00:00Z',thumbnailURL:'https://fixture.test/thumb'}]
 vi.mocked(json).mockImplementation(async()=>({data:{items:rows}}))
 port={sourceId:account.id,context:1,local:false,account,file:(id:string)=>id==='parent'?{file_id:'parent',name:'Movies',parent_file_id:'',isDir:true}:file,list:vi.fn().mockResolvedValue([])} as unknown as DrivePanePort
 unbind=bindDrivePane(port)
})
afterEach(()=>unbind())
it('projects live original 139 fields and the known parent path into properties',async()=>{
 const reader=createFileProperties()
 try{
  const result=await reader.read(file)
  expect(result.fileInfo).toMatchObject({file_id:'movie',drive_id:account.id,name:'Actual.mkv',type:'file',size:4096,icon:'iconfile_video',thumbnail:rows[0].thumbnailURL,description:'cloud139_id:movie',updated_at:'2026-11-01T00:00:00.000Z'})
  expect(result.dirPath).toBe('/Movies');expect(result.dirInfo).toBeUndefined()
 }finally{reader.dispose()}
})
it.each([[],[{fileId:'wrong',name:'Other.mkv',type:'file'}],[{fileId:'movie',name:'Folder',type:'folder'}]].map(value=>({value})))('rejects absent or conflicting detail',async({value})=>{
 rows=value;const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('不匹配')}finally{reader.dispose()}
})
it('computes complete descendant counts using the existing source walker',async()=>{
 rows=[{fileId:'movie',name:'Folder',type:'folder'}]
 vi.mocked(port.list).mockImplementation(async(_user,_drive,parent)=>parent==='movie'?[{...file,file_id:'child',isDir:false,size:17},{...file,file_id:'sub',isDir:true,size:0}]:[{...file,file_id:'nested',isDir:false,size:25}])
 const reader=createFileProperties();try{expect((await reader.read({...file,isDir:true})).dirInfo).toEqual({size:42,file_count:2,folder_count:1})}finally{reader.dispose()}
})
it('does not convert incomplete folder traversal into zero or partial statistics',async()=>{
 rows=[{fileId:'movie',name:'Folder',type:'folder'}];vi.mocked(port.list).mockRejectedValue(Error('directory unavailable'))
 const reader=createFileProperties();try{await expect(reader.read({...file,isDir:true})).rejects.toThrow('unavailable')}finally{reader.dispose()}
})
it('discards late property responses after close or source change',async()=>{
 let finish!:(value:any)=>void;vi.mocked(json).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve))
 const reader=createFileProperties(),pending=reader.read(file);port.context=2
 finish({data:{items:rows}});await expect(pending).rejects.toThrow('来源已切换');reader.dispose()
})
it('rejects account replacement during live metadata reads',async()=>{
 vi.mocked(json).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'other'}];return {data:{items:rows}}})
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('身份')}finally{reader.dispose()}
})
