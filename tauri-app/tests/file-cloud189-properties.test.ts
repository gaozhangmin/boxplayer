import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {bindDrivePane,type DrivePanePort} from '@/features/files/drive/ports'
import {createFileProperties} from '@/features/files/drive/fileProperties'
import {json} from '@/features/sources/transport'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn()}))
const account={id:'189-properties',providerId:'189' as const,name:'Fixture',baseUrl:'https://api.cloud.189.cn',userId:'owner',authOrigins:[]}
const id=(fileId:string,familyId?:string)=>JSON.stringify({fileId,...(familyId?{familyId}:{})})
let unbind:()=>void,port:DrivePanePort,rows:any[],file:any
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account]
 file={file_id:id('9007199254740997'),drive_id:account.id,parent_file_id:id('-11'),name:'Old.mkv',isDir:false,size:1,category:'video',ext:'mkv'}
 rows=[{id:'9007199254740997',name:'Actual.mkv',size:4096,lastOpTime:'2026-11-01 00:00:00'}]
 vi.mocked(json).mockImplementation(async()=>({fileListAO:{folderList:[],fileList:rows}}))
 port={sourceId:account.id,context:1,local:false,account,file:()=>undefined,list:vi.fn().mockResolvedValue([])} as unknown as DrivePanePort
 unbind=bindDrivePane(port)
})
afterEach(()=>unbind())
it.each([undefined,'9007199254740999'])('reads current original fields without converting long IDs (family %s)',async family=>{
 file.file_id=id('9007199254740997',family);file.parent_file_id=id(family?'':'-11',family)
 const reader=createFileProperties();try{
  const result=await reader.read(file)
  expect(result.fileInfo).toMatchObject({file_id:file.file_id,parent_file_id:file.parent_file_id,drive_id:account.id,name:'Actual.mkv',type:'file',size:4096,icon:'iconfile_video'})
  const url=new URL(vi.mocked(json).mock.calls[0][2]);expect(url.searchParams.get('familyId')).toBe(family??null)
  expect(result.dirInfo).toBeUndefined()
 }finally{reader.dispose()}
})
it('rejects a cross-space parent before requesting metadata',async()=>{
 file.parent_file_id=id('','123');const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('空间不匹配');expect(json).not.toHaveBeenCalled()}finally{reader.dispose()}
})
it('does not report stale selected metadata when the file disappeared',async()=>{
 rows=[];const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('已不存在')}finally{reader.dispose()}
})
it('rejects a file that changed type',async()=>{
 file.isDir=true;const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('不匹配')}finally{reader.dispose()}
})
it('does not request normal metadata for recycled items',async()=>{
 port.store={SelectDirType:'trash'} as any;const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('回收');expect(json).not.toHaveBeenCalled()}finally{reader.dispose()}
})
it('computes full folder totals through the retained walker',async()=>{
 file.isDir=true;vi.mocked(json).mockResolvedValue({fileListAO:{folderList:rows,fileList:[]}})
 vi.mocked(port.list).mockImplementation(async(_user,_drive,parent)=>parent===file.file_id?[{...file,file_id:'child',isDir:false,size:17},{...file,file_id:'sub',isDir:true,size:0}]:[{...file,file_id:'nested',isDir:false,size:25}])
 const reader=createFileProperties();try{const result=await reader.read(file);expect(result.dirInfo).toEqual({size:42,file_count:2,folder_count:1});expect(result.fileInfo).toMatchObject({size:42,file_count:2})}finally{reader.dispose()}
})
it('discards late results on source switch',async()=>{
 let finish!:(value:any)=>void;vi.mocked(json).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve))
 const reader=createFileProperties(),pending=reader.read(file);port.context=2;finish({fileListAO:{fileList:rows}})
 await expect(pending).rejects.toThrow('来源已切换');reader.dispose()
})
it('rejects replaced account identity after metadata returns',async()=>{
 vi.mocked(json).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'other'}];return {fileListAO:{fileList:rows}}})
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('身份')}finally{reader.dispose()}
})
it('continues scoped pagination to locate the selected item',async()=>{
 const fillers=Array.from({length:100},(_,index)=>({id:String(index+1),name:`file-${index}.txt`,size:1}))
 vi.mocked(json).mockResolvedValueOnce({fileListAO:{fileList:fillers}}).mockResolvedValueOnce({fileListAO:{fileList:rows}})
 const reader=createFileProperties();try{expect((await reader.read(file)).fileInfo.name).toBe('Actual.mkv');expect(new URL(vi.mocked(json).mock.calls[1][2]).searchParams.get('pageNum')).toBe('2')}finally{reader.dispose()}
})
it('propagates folder traversal failure instead of partial totals',async()=>{
 file.isDir=true;vi.mocked(json).mockResolvedValue({fileListAO:{folderList:rows,fileList:[]}});vi.mocked(port.list).mockRejectedValue(Error('directory unavailable'))
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('unavailable')}finally{reader.dispose()}
})
