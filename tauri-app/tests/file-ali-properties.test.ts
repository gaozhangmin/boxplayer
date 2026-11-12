import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {bindDrivePane,type DrivePanePort} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {createFileProperties} from '@/features/files/drive/fileProperties'
import {request,json} from '@/features/sources/transport'
import type {Account} from '@/features/sources/contracts'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),request:vi.fn(),json:vi.fn()}))
const id=(fileId:string)=>JSON.stringify({driveId:'drive',fileId})
const response=(data:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let account:Account,file:any,port:DrivePanePort,unbind:()=>void,detail:any
function setup(provider:'aliyun'|'alipan-open'='alipan-open'){
 account={id:'ali-properties',providerId:provider,name:'Fixture',baseUrl:'',userId:'owner',authOrigins:[]};useFileSourcesStore().accounts=[account]
 file={drive_id:account.id,file_id:id('movie'),parent_file_id:id('parent'),name:'Old.mkv',isDir:false,size:1,category:'video',ext:'mkv'}
 port={sourceId:account.id,account,local:false,context:1,store:{SelectDirType:'pan'},file:(value:string)=>value===id('root')?{file_id:id('root'),name:'Resource Drive',parent_file_id:'',isDir:true}:value===id('parent')?{file_id:id('parent'),name:'Movies',parent_file_id:'',isDir:true}:file,list:vi.fn().mockResolvedValue([])} as unknown as DrivePanePort
 unbind=bindDrivePane(port)
}
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia())
 detail={drive_id:'drive',file_id:'movie',parent_file_id:'parent',name:'Actual.mkv',type:'file',size:4096,created_at:'2023-11-14T22:13:20.000Z',updated_at:'2023-11-14T22:15:00.000Z',content_hash:'hash',content_hash_name:'sha1',private_token:'fixture-hidden',download_url:'https://fixture.test/private'}
 vi.mocked(request).mockImplementation(async(_account,_method,url)=>response(url.endsWith('/get_path')?{items:[{file_id:'movie',name:'Actual.mkv'},{file_id:'parent',name:'Movies'}]}:detail))
})
afterEach(()=>unbind?.())
it.each(['aliyun','alipan-open'] as const)('uses original metadata body and isolated %s channel',async provider=>{
 setup(provider);const reader=createFileProperties()
 try{
  const result=await reader.read(file)
  expect(result.fileInfo).toMatchObject({drive_id:account.id,file_id:id('movie'),parent_file_id:id('parent'),name:'Actual.mkv',size:4096,content_hash:'hash',created_at:detail.created_at})
  expect(result.dirPath).toBe(provider==='aliyun'?'/Resource Drive/Movies/Actual.mkv':'/Movies');expect(JSON.stringify(result)).not.toContain('fixture-hidden');expect(JSON.stringify(result)).not.toContain('fixture.test/private')
  const call=vi.mocked(request).mock.calls[0]!
  expect(call[2]).toBe(provider==='aliyun'?'https://api.aliyundrive.com/v2/file/get':'https://openapi.alipan.com/adrive/v1.0/openFile/get')
  expect(JSON.parse(call[3]!)).toEqual(provider==='aliyun'?{drive_id:'drive',file_id:'movie',url_expire_sec:14400,office_thumbnail_process:'image/resize,w_400/format,jpeg',image_thumbnail_process:'image/resize,w_400/format,jpeg',image_url_process:'image/resize,w_1920/format,jpeg',video_thumbnail_process:'video/snapshot,t_106000,f_jpg,ar_auto,m_fast,w_400'}:{drive_id:'drive',file_id:'movie',image_thumbnail_width:100,video_thumbnail_width:100,video_thumbnail_time:120000})
 }finally{reader.dispose()}
})
it.each([{drive_id:'wrong'},{file_id:'wrong'},{type:'folder'},{parent_file_id:''},{name:''},{size:-1},{size:Number.MAX_SAFE_INTEGER+1},{created_at:'invalid'},{content_hash:42},{trashed:true},{code:'InvalidToken'}])('rejects invalid detail %j',async patch=>{
 setup();detail={...detail,...patch};const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow()}finally{reader.dispose()}
})
it('does not reuse stale parent paths after an external move',async()=>{
 setup();detail.parent_file_id='unknown';port.file=(value:string)=>value===file.file_id?file:undefined
 const reader=createFileProperties();try{expect((await reader.read(file)).dirPath).toBe('路径暂不可用')}finally{reader.dispose()}
})
it('walks actual folder contents rather than trusting metadata placeholder size',async()=>{
 setup();file.isDir=true;detail.type='folder';detail.name='default';detail.size=999
 const reader=createFileProperties();try{const result=await reader.read(file);expect(result.fileInfo.name).toBe('备份盘');expect(result.dirInfo).toEqual({size:0,file_count:0,folder_count:0});expect(result.fileInfo.size).toBe(0);expect(port.list).toHaveBeenCalledOnce()}finally{reader.dispose()}
})
it('rejects a late detail after closure',async()=>{
 setup();let finish!:(value:any)=>void;vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 const reader=createFileProperties(),pending=reader.read(file);reader.dispose();finish(response(detail));await expect(pending).rejects.toThrow('关闭')
})
it('sums nested real files with canonical identities and stops an incomplete walk',async()=>{
 setup();file.isDir=true;detail.type='folder';detail.size=999
 const rows=[{drive_id:account.id,file_id:id('first'),name:'First.mkv',isDir:false,size:10},{drive_id:account.id,file_id:id('sub'),name:'Sub',isDir:true,size:0}]
 vi.mocked(port.list).mockImplementation(async(_user,_drive,parent)=>parent===id('movie')?rows:[{drive_id:account.id,file_id:id('nested'),name:'Nested.mkv',isDir:false,size:20}] as any)
 const reader=createFileProperties()
 try{expect((await reader.read(file)).dirInfo).toEqual({size:30,file_count:2,folder_count:1});vi.mocked(port.list).mockRejectedValueOnce(Error('fixture listing failed'));await expect(reader.read(file)).rejects.toThrow('listing failed')}finally{reader.dispose()}
})
it('rejects same-ID account replacement during request',async()=>{
 setup();vi.mocked(request).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'other'}];return response(detail)})
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('身份已变化')}finally{reader.dispose()}
})
it('stops after pane generation changes',async()=>{
 setup();vi.mocked(request).mockImplementationOnce(async()=>{port.context=(port.context??0)+1;return response(detail)})
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('切换')}finally{reader.dispose()}
})
it('does not issue normal detail requests for recycle entries or malformed IDs',async()=>{
 setup();Object.assign(port.store!,{SelectDirType:'trash'});const reader=createFileProperties()
 try{await expect(reader.read(file)).rejects.toThrow('回收站');Object.assign(port.store!,{SelectDirType:'pan'});file.file_id='movie';await expect(reader.read(file)).rejects.toThrow('标识无效');expect(request).not.toHaveBeenCalled()}finally{reader.dispose()}
})
it('rejects overlapping detail scopes and releases after failure',async()=>{
 setup();let finish!:(value:any)=>void;vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 const reader=createFileProperties(),pending=reader.read(file)
 try{await expect(reader.read(file)).rejects.toThrow('正在读取');finish(response({},403));await expect(pending).rejects.toThrow('读取失败');expect((await reader.read(file)).fileInfo.name).toBe('Actual.mkv')}finally{reader.dispose()}
})

it('uses original web folder statistics with its reach-limit flag instead of recursively estimating',async()=>{
 setup('aliyun');file.isDir=true;detail.type='folder'
 vi.mocked(request).mockImplementation(async(_account,_method,url)=>response(url.endsWith('/get_path')?{items:[{file_id:'movie',name:'Folder'}]}:url.endsWith('/get_folder_size_info')?{size:512,file_count:7,folder_count:3,reach_limit:true,private_token:'fixture-hidden'}:detail))
 const reader=createFileProperties()
 try{const result=await reader.read(file);expect(result.dirInfo).toEqual({size:512,file_count:7,folder_count:3,reach_limit:true});expect(result.fileInfo.size).toBe(512);expect(port.list).not.toHaveBeenCalled();expect(JSON.parse(vi.mocked(request).mock.calls.at(-1)![3]!)).toEqual({drive_id:'drive',file_id:'movie'})}finally{reader.dispose()}
})
it.each([{size:-1,file_count:0,folder_count:0},{size:0,file_count:1.5,folder_count:0},{size:0,file_count:0,folder_count:0,reach_limit:'yes'}])('does not publish malformed web folder statistics %j',async stats=>{
 setup('aliyun');file.isDir=true;detail.type='folder'
 vi.mocked(request).mockImplementation(async(_account,_method,url)=>response(url.endsWith('/get_path')?{items:[{file_id:'movie',name:'Folder'}]}:url.endsWith('/get_folder_size_info')?stats:detail))
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('统计')}finally{reader.dispose()}
})
it.each([[],[{file_id:'other',name:'Wrong'}],[{file_id:'movie',name:'A'},{file_id:'movie',name:'Loop'}],[{file_id:'movie',name:'A',drive_id:'other'}]].map(items=>({items})))('rejects incomplete or foreign web path %j',async ({items})=>{
 setup('aliyun');vi.mocked(request).mockImplementation(async(_account,_method,url)=>response(url.endsWith('/get_path')?{items}:detail))
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('路径')}finally{reader.dispose()}
})
it('does not read web folder statistics after its path request changes account identity',async()=>{
 setup('aliyun');file.isDir=true;detail.type='folder'
 vi.mocked(request).mockImplementation(async(_account,_method,url)=>{if(url.endsWith('/get_path')){useFileSourcesStore().accounts=[{...account,userId:'other'}];return response({items:[{file_id:'movie',name:'Folder'}]})}return response(detail)})
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('身份');expect(request).toHaveBeenCalledTimes(2)}finally{reader.dispose()}
})

it.each(['aliyun','alipan-open'] as const)('reads %s virtual drive roots from fresh drive info, not normal file metadata',async provider=>{
 setup(provider);file.file_id=id('root');file.parent_file_id='';file.name='Old root';file.isDir=true
 vi.mocked(json).mockResolvedValue({backup_drive_id:'drive'})
 vi.mocked(request).mockResolvedValue(response({size:77,file_count:2,folder_count:1,reach_limit:false}))
 const reader=createFileProperties()
 try{
  const result=await reader.read(file)
  expect(result.fileInfo).toMatchObject({file_id:id('root'),parent_file_id:'',name:'备份盘',type:'folder',drive_id:account.id,size:provider==='aliyun'?77:0})
  expect(result.dirPath).toBe('/备份盘');expect(json).toHaveBeenCalledTimes(1)
  expect(vi.mocked(json).mock.calls[0]![2]).toBe(provider==='aliyun'?'https://user.aliyundrive.com/v2/user/get':'https://openapi.alipan.com/adrive/v1.0/user/getDriveInfo')
  expect(vi.mocked(request).mock.calls.map(call=>new URL(call[2]).pathname)).toEqual(provider==='aliyun'?['/adrive/v1/file/get_folder_size_info']:[])
  if(provider==='alipan-open')expect(port.list).toHaveBeenCalledOnce()
 }finally{reader.dispose()}
})
it('rejects a removed drive root without sending normal file or statistics requests',async()=>{
 setup('aliyun');file.file_id=id('root');file.isDir=true;vi.mocked(json).mockResolvedValue({resource_drive_id:'other'})
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('盘根');expect(request).not.toHaveBeenCalled();expect(port.list).not.toHaveBeenCalled()}finally{reader.dispose()}
})
it('does not publish root info or request statistics after same-ID account replacement',async()=>{
 setup('aliyun');file.file_id=id('root');file.isDir=true
 vi.mocked(json).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'other'}];return {backup_drive_id:'drive'}})
 const reader=createFileProperties();try{await expect(reader.read(file)).rejects.toThrow('身份');expect(request).not.toHaveBeenCalled()}finally{reader.dispose()}
})
it('does not publish a late root read after the property window closes',async()=>{
 setup('alipan-open');file.file_id=id('root');file.isDir=true;let finish!:(value:any)=>void;vi.mocked(json).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 const reader=createFileProperties(),pending=reader.read(file);reader.dispose();finish({backup_drive_id:'drive'});await expect(pending).rejects.toThrow('关闭');expect(port.list).not.toHaveBeenCalled()
})
