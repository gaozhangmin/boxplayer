import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {bindDrivePane,type DrivePanePort} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {createFileProperties} from '@/features/files/drive/fileProperties'
import {request,rawRequest} from '@/features/sources/transport'
import type {Account} from '@/features/sources/contracts'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),request:vi.fn(),rawRequest:vi.fn()}))
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let account:Account,file:any,port:DrivePanePort,unbind:()=>void,quark:any,baidu:any,trash:boolean
function setup(provider:'quark'|'baidu'='quark'){
 account={id:'properties-'+provider,providerId:provider,name:'Fixture',baseUrl:'',userId:'owner',authOrigins:[]};useFileSourcesStore().accounts=[account]
 file={drive_id:account.id,file_id:provider==='quark'?'movie':'9007199254740997',parent_file_id:'parent',name:'Old.mkv',isDir:false,size:1,category:'video',ext:'mkv'}
 port={sourceId:account.id,account,local:false,context:1,store:{SelectDirType:trash?'trash':'pan'},file:(id:string)=>id==='parent'?{file_id:'parent',name:'Movies',parent_file_id:'',isDir:true}:file,list:vi.fn().mockResolvedValue([])} as unknown as DrivePanePort
 unbind=bindDrivePane(port)
}
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());trash=false
 quark={fid:'movie',file_name:'Actual.mkv',file_type:1,pdir_fid:'parent',size:4096,created_at:1700000000,updated_at:1700000100000,thumbnail:'https://fixture.test/thumb'}
 baidu={fs_id:'9007199254740997',filename:'Actual.mkv',path:'/Moved/Actual.mkv',isdir:0,size:4096,server_ctime:1700000000,server_mtime:1700000100,md5:'fixture-md5',duration:42,thumbs:{url2:'https://fixture.test/thumb'},dlink:'https://fixture.test/private'}
 vi.mocked(request).mockImplementation(async()=>response({code:0,data:{list:[quark]},metadata:{_total:1}}))
 vi.mocked(rawRequest).mockImplementation(async()=>response({errno:0,list:[baidu]}))
})
afterEach(()=>unbind?.())
it('keeps live Quark original icon, name, dates, thumbnail and known parent',async()=>{
 setup();const reader=createFileProperties()
 try{
  const result=await reader.read(file)
  expect(result.fileInfo).toMatchObject({file_id:'movie',name:'Actual.mkv',size:4096,type:'file',icon:'iconfile_video',thumbnail:quark.thumbnail,description:'quark_fid:movie;quark_pdir:parent',created_at:'2023-11-14T22:13:20.000Z',updated_at:'2023-11-14T22:15:00.000Z'})
  expect(result.dirPath).toBe('/Movies')
 }finally{reader.dispose()}
})
it('does not reuse a stale parent path when Quark metadata shows an external move',async()=>{
 setup();quark.pdir_fid='unknown-parent';const reader=createFileProperties()
 try{const result=await reader.read(file);expect(result.dirPath).toBe('路径暂不可用');expect(result.fileInfo.parent_file_id).toBe('unknown-parent')}finally{reader.dispose()}
})
it.each([{fid:'wrong'},{pdir_fid:undefined},{file_type:0},{size:-1},{created_at:'bad-date'},{updated_at:-1},{thumbnail:42}])('rejects conflicting or invalid Quark metadata %j',async patch=>{
 setup();quark={...quark,...patch};const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow()}finally{reader.dispose()}
})
it('normalizes explicit dir=false using the original Quark mapper',async()=>{
 setup();quark={...quark,file_type:undefined,dir:false};const reader=createFileProperties();try{expect((await reader.read(file)).fileInfo.type).toBe('file')}finally{reader.dispose()}
})
it('reads Quark recycle properties from the recycle endpoint without normal file detail',async()=>{
 trash=true;setup();quark.record_id='record';const reader=createFileProperties()
 try{
  expect((await reader.read(file)).fileInfo.description).toContain('quark_record:record')
  expect(request).toHaveBeenCalledTimes(1);expect(new URL(vi.mocked(request).mock.calls[0]![2]).pathname).toBe('/1/clouddrive/file/recycle/list')
 }finally{reader.dispose()}
})
it('verifies an empty Quark folder instead of trusting count placeholders',async()=>{
 setup();file.isDir=true;quark.file_type=0;const reader=createFileProperties()
 try{const result=await reader.read(file);expect(result.dirInfo).toEqual({size:0,file_count:0,folder_count:0});expect(port.list).toHaveBeenCalledOnce()}finally{reader.dispose()}
})
it('retains exact Baidu stable ID, actual path, dates, hash and duration without copying private links',async()=>{
 setup('baidu');const reader=createFileProperties()
 try{
  const result=await reader.read(file)
  expect(result.dirPath).toBe('/Moved');expect(result.fileInfo).toMatchObject({file_id:'9007199254740997',name:'Actual.mkv',size:4096,path:'/Moved/Actual.mkv',parent_file_id:'/Moved',content_hash:'fixture-md5',content_hash_name:'md5',created_at:'2023-11-14T22:13:20.000Z',updated_at:'2023-11-14T22:15:00.000Z',duration:'42',thumbnail:baidu.thumbs.url2})
  const url=new URL(vi.mocked(rawRequest).mock.calls[0]![2]);expect(url.searchParams.get('fsids')).toBe('[9007199254740997]');expect(url.searchParams.get('dlink')).toBe('0')
  expect(JSON.stringify(result.fileInfo)).not.toContain('/private')
 }finally{reader.dispose()}
})
it.each([{fs_id:'other'},{isdir:1},{size:undefined},{size:-1},{md5:42},{server_ctime:-1},{duration:-1},{path:'/WrongName.mkv'}])('rejects conflicting or invalid Baidu metadata %j',async patch=>{
 setup('baidu');baidu={...baidu,...patch};const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow()}finally{reader.dispose()}
})
it('verifies an empty Baidu folder instead of trusting count placeholders',async()=>{
 setup('baidu');file.isDir=true;baidu={...baidu,isdir:1,size:undefined};const reader=createFileProperties()
 try{const result=await reader.read(file);expect(result.dirInfo).toEqual({size:0,file_count:0,folder_count:0});expect(port.list).toHaveBeenCalledOnce()}finally{reader.dispose()}
})
it('rejects late metadata after close and after account replacement',async()=>{
 setup();let finish!:(value:any)=>void;vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve))
 const reader=createFileProperties(),pending=reader.read(file);reader.dispose();finish(response({code:0,data:{list:[quark]}}));await expect(pending).rejects.toThrow('关闭')
 const next=createFileProperties();vi.mocked(request).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'different'}];return response({code:0,data:{list:[quark]}})})
 try{await expect(next.read(file)).rejects.toThrow('身份')}finally{next.dispose()}
})

it.each(['quark','baidu'] as const)('uses the original date fallback when %s modified time is zero',async provider=>{
 setup(provider);if(provider==='quark')quark.updated_at=0;else baidu.server_mtime=0
 const reader=createFileProperties();try{expect((await reader.read(file)).fileInfo.updated_at).toBe('2023-11-14T22:13:20.000Z')}finally{reader.dispose()}
})

it.each(['quark','baidu'] as const)('computes complete %s descendant totals and replaces stale folder size',async provider=>{
 setup(provider);file.isDir=true;if(provider==='quark')quark.file_type=0;else baidu.isdir=1
 vi.mocked(port.list).mockImplementation(async(_user,_drive,parent)=>parent===file.file_id?[{...file,file_id:'first',isDir:false,size:10},{...file,file_id:'sub',isDir:true,size:999}]:[{...file,file_id:'nested',isDir:false,size:20}])
 const reader=createFileProperties();try{const result=await reader.read(file);expect(result.dirInfo).toEqual({size:30,file_count:2,folder_count:1});expect(result.fileInfo).toMatchObject({size:30,file_count:2})}finally{reader.dispose()}
})
it.each(['quark','baidu'] as const)('does not return partial %s totals after a nested read fails',async provider=>{
 setup(provider);file.isDir=true;if(provider==='quark')quark.file_type=0;else baidu.isdir=1
 vi.mocked(port.list).mockResolvedValueOnce([{...file,file_id:'first',isDir:false,size:10},{...file,file_id:'sub',isDir:true,size:0}]).mockRejectedValueOnce(Error('nested directory unavailable'))
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('unavailable')}finally{reader.dispose()}
})
it.each([-1,NaN,Number.MAX_SAFE_INTEGER+1])('rejects invalid descendant size %s',async size=>{
 setup();file.isDir=true;quark.file_type=0;vi.mocked(port.list).mockResolvedValue([{...file,file_id:'child',isDir:false,size}])
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('统计大小')}finally{reader.dispose()}
})
it('rejects aggregate overflow even when every child size is safe',async()=>{
 setup();file.isDir=true;quark.file_type=0;vi.mocked(port.list).mockResolvedValue([{...file,file_id:'one',isDir:false,size:Number.MAX_SAFE_INTEGER},{...file,file_id:'two',isDir:false,size:1}])
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('安全范围')}finally{reader.dispose()}
})
it('refuses cyclic folders and item-limit truncation rather than returning plausible partial counts',async()=>{
 setup();file.isDir=true;quark.file_type=0;vi.mocked(port.list).mockResolvedValueOnce([{...file}])
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('重复或循环');vi.mocked(port.list).mockResolvedValueOnce(Array.from({length:5001},(_,index)=>({...file,file_id:'child-'+index,isDir:false,size:1})));await expect(reader.read(file)).rejects.toThrow('超过 5000')}finally{reader.dispose()}
})
it('stops traversal before the next folder after the account owner changes',async()=>{
 setup();file.isDir=true;quark.file_type=0
 vi.mocked(port.list).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'other'}];return [{...file,file_id:'sub',isDir:true}]})
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('身份');expect(port.list).toHaveBeenCalledOnce()}finally{reader.dispose()}
})
it('never traverses a recycled folder through normal directory APIs',async()=>{
 trash=true;setup();file.isDir=true;quark.file_type=0;quark.record_id='record'
 const reader=createFileProperties();try{expect((await reader.read(file)).dirInfo).toBeUndefined();expect(port.list).not.toHaveBeenCalled()}finally{reader.dispose()}
})
