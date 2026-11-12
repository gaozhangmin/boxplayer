import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {bindDrivePane,type DrivePanePort} from '@/features/files/drive/ports'
import {createFileProperties} from '@/features/files/drive/fileProperties'
import {useFileSourcesStore} from '@/stores/fileSources'
import {nativeCall} from '@/platform/native'
import {json,request} from '@/features/sources/transport'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:(r:{body:number[]})=>new TextDecoder().decode(new Uint8Array(r.body)),playable:()=>true}))
const row={drive_id:'s',file_id:'movie',parent_file_id:'',name:'old.mkv',isDir:false,size:1,category:'video',ext:'mkv'} as any
let unbind:()=>void
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});setActivePinia(createPinia())})
afterEach(()=>unbind?.())
function pane(provider?:'box'|'google'|'onedrive'|'dropbox'){
 const account=provider?{id:'s',providerId:provider,name:'Fixture',baseUrl:'',authOrigins:[]}:undefined
 if(account)useFileSourcesStore().accounts=[account]
 const port={sourceId:'s',local:!provider,context:1,account,file:()=>row,list:vi.fn().mockResolvedValue([])} as unknown as DrivePanePort
 unbind=bindDrivePane(port);return port
}
const response=(value:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(value))),finalUrl:''})
describe('source-bound live file properties',()=>{
 it('reads local live metadata and aggregates descendants rather than stale selected size',async()=>{
  const port=pane();vi.mocked(nativeCall).mockResolvedValue({sourceId:'s',entries:[{relativePath:'movie',name:'new',size:42,isDirectory:false,modified:1700000000}]})
  const properties=createFileProperties();expect((await properties.read(row)).fileInfo).toMatchObject({name:'new',size:42,updated_at:'2023-11-14T22:13:20.000Z'})
  vi.mocked(nativeCall).mockResolvedValue({sourceId:'s',entries:[{relativePath:'movie',name:'folder',isDirectory:true}]})
  vi.mocked(port.list).mockResolvedValue([{...row,file_id:'child',size:17}])
  expect((await properties.read({...row,isDir:true})).dirInfo).toEqual({size:17,file_count:1,folder_count:0});properties.dispose()
 })
 it('preserves the original Box representation header and rejects mismatched metadata',async()=>{
  pane('box');vi.mocked(request).mockResolvedValue(response({id:'movie',type:'file',name:'actual',size:32,sha1:'abc'}))
  const properties=createFileProperties();expect((await properties.read(row)).fileInfo).toMatchObject({name:'actual',size:32,content_hash:'abc'})
  expect(request).toHaveBeenCalledWith(expect.objectContaining({id:'s'}),'GET',expect.stringContaining('/files/movie?'),undefined,expect.objectContaining({'x-rep-hints':'[jpg?dimensions=320x320]'}))
  vi.mocked(request).mockResolvedValue(response({id:'wrong',type:'file',name:'other'}));await expect(properties.read(row)).rejects.toThrow('不匹配')
  await expect(properties.downloadUrl('movie')).rejects.toThrow('鉴权');properties.dispose()
 })
 it('distinguishes real Google root identity and rejects the wrong detail id',async()=>{
  pane('google');vi.mocked(json).mockImplementation(async(_account,_method,url)=>url.includes('/root?')?{id:'real-root',name:'My Drive'}:{id:'movie',name:'actual',parents:['real-root'],mimeType:'video/mp4',size:'25'})
  const properties=createFileProperties(),result=await properties.read(row);expect(result.dirPath).toBe('/');expect(result.fileInfo.size).toBe(25)
  vi.mocked(json).mockResolvedValue({id:'wrong'});await expect(properties.read(row)).rejects.toThrow('不匹配');properties.dispose()
 })
 it('does not publish pending metadata or execute old confirmation commands after close',async()=>{
  pane('box');let finish!:(value:any)=>void;vi.mocked(request).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const properties=createFileProperties(),pending=properties.read(row);properties.dispose();finish(response({id:'movie',type:'file',name:'actual'}))
  await expect(pending).rejects.toThrow('关闭');await expect(properties.command('boxDeleteVersion','s','movie','version')).rejects.toThrow('关闭');expect(request).toHaveBeenCalledTimes(1)
 })
 it('binds OneDrive detail to native account and reports a provider response error',async()=>{
  pane('onedrive');vi.mocked(json).mockResolvedValue({id:'movie',name:'actual',size:6,parentReference:{path:'/drive/root:/TV'}})
  const properties=createFileProperties();expect((await properties.read(row)).dirPath).toBe('/TV');expect(json).toHaveBeenCalledWith(expect.objectContaining({id:'s',providerId:'onedrive'}),'GET',expect.stringContaining('/me/drive/items/movie'),undefined)
  vi.mocked(json).mockResolvedValue({error:{code:'denied'}});await expect(properties.read(row)).rejects.toThrow('失败');properties.dispose()
 })
 it('rejects repeated Google revision cursors and does not report an incomplete list',async()=>{
  pane('google');vi.mocked(json).mockResolvedValue({revisions:[{id:'v1'}],nextPageToken:'again'})
  const properties=createFileProperties();await expect(properties.command('googleListRevisions','s','movie')).rejects.toThrow('游标');expect(json).toHaveBeenCalledTimes(2);properties.dispose()
 })
 it('rejects wrong revision updates and blocks confirmation after a source context change',async()=>{
  const port=pane('google');vi.mocked(json).mockResolvedValue({id:'wrong',keepForever:true})
  const properties=createFileProperties();await expect(properties.command('googleUpdateRevision','s','movie','v1',true)).rejects.toThrow('不匹配')
  port.context=2;await expect(properties.command('googleDeleteRevision','s','movie','v1')).rejects.toThrow('切换');expect(json).toHaveBeenCalledTimes(1);properties.dispose()
 })

 it('reads Dropbox stable identity and restores only the path read from metadata',async()=>{
  pane('dropbox');vi.mocked(json).mockResolvedValue({id:'movie','.tag':'file',name:'actual.mkv',size:21,path_display:'/TV/actual.mkv',content_hash:'abc'})
  const properties=createFileProperties();expect((await properties.read(row)).fileInfo).toMatchObject({path:'/TV/actual.mkv',content_hash:'abc',size:21})
  await expect(properties.command('dropboxRestoreRevision','s','/unread/file','v')).rejects.toThrow('不匹配');expect(json).toHaveBeenCalledTimes(1)
  expect(await properties.command('dropboxRestoreRevision','s','/TV/actual.mkv','v')).toMatchObject({id:'movie'})
  expect(json).toHaveBeenLastCalledWith(expect.objectContaining({id:'s'}),'POST','https://api.dropboxapi.com/2/files/restore',{path:'/TV/actual.mkv',rev:'v'})
  vi.mocked(json).mockResolvedValue({id:'wrong','.tag':'file'});await expect(properties.command('dropboxRestoreRevision','s','/TV/actual.mkv','v')).rejects.toThrow('不匹配');properties.dispose()
 })
 it('does not treat malformed Dropbox revisions as no history',async()=>{
  pane('dropbox');vi.mocked(json).mockResolvedValue({})
  const properties=createFileProperties();await expect(properties.command('dropboxListRevisions','s','movie',20)).rejects.toThrow('响应无效');properties.dispose()
 })
 it('follows OneDrive versions on the same native account and accepts only confirmed restore',async()=>{
  pane('onedrive');vi.mocked(json).mockResolvedValueOnce({value:[{id:'v1'}],'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/drive/items/movie/versions?$skiptoken=next'}).mockResolvedValueOnce({value:[{id:'v2'}]})
  const properties=createFileProperties();expect(await properties.command('oneDriveListVersions','s','movie')).toEqual([{id:'v1'},{id:'v2'}])
  vi.mocked(request).mockResolvedValue({status:204,body:[],headers:{},finalUrl:''});await expect(properties.command('oneDriveRestoreVersion','s','movie','v1')).resolves.toBe(true)
  vi.mocked(request).mockResolvedValue({status:202,body:[],headers:{},finalUrl:''});await expect(properties.command('oneDriveRestoreVersion','s','movie','v1')).rejects.toThrow('尚未确认');properties.dispose()
 })
 it('rejects OneDrive foreign pagination and stops subsequent pages after close',async()=>{
  pane('onedrive');vi.mocked(json).mockResolvedValue({value:[{id:'v1'}],'@odata.nextLink':'https://wrong.example/v1.0/me/drive/items/movie/versions'})
  const properties=createFileProperties();await expect(properties.command('oneDriveListVersions','s','movie')).rejects.toThrow('地址无效');expect(json).toHaveBeenCalledTimes(1)
  let finish!:(value:any)=>void;vi.mocked(json).mockImplementation(()=>new Promise(resolve=>{finish=resolve}));const pending=properties.command('oneDriveListVersions','s','movie');properties.dispose()
  finish({value:[],'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/drive/items/movie/versions?$skiptoken=next'});await expect(pending).rejects.toThrow('关闭');expect(json).toHaveBeenCalledTimes(2)
 })
 it('loads all Box version pages and all Google permission pages',async()=>{
  pane('box');vi.mocked(json).mockResolvedValueOnce({entries:[{id:'v1'}],total_count:2,limit:1,offset:0}).mockResolvedValueOnce({entries:[{id:'v2'}],total_count:2,limit:1,offset:1})
  const box=createFileProperties();expect(await box.command('boxListVersions','s','movie')).toEqual([{id:'v1'},{id:'v2'}]);expect(vi.mocked(json).mock.calls[1]![2]).toContain('offset=1');box.dispose();unbind()
  pane('google');vi.mocked(json).mockResolvedValueOnce({permissions:[{id:'p1',type:'anyone'}],nextPageToken:'next'}).mockResolvedValueOnce({permissions:[{id:'p2',type:'user'}]})
  const google=createFileProperties();expect(await google.command('googleListPermissions','s','movie')).toEqual([{id:'p1',type:'anyone'},{id:'p2',type:'user'}]);expect(vi.mocked(json).mock.calls.at(-1)![2]).toContain('pageToken=next');google.dispose()
 })
 it('rejects duplicate Box versions and cyclic permission pages',async()=>{
  pane('box');vi.mocked(json).mockResolvedValue({entries:[{id:'same'}],total_count:2,limit:1})
  const box=createFileProperties();await expect(box.command('boxListVersions','s','movie')).rejects.toThrow('重复');box.dispose();unbind()
  pane('google');vi.mocked(json).mockResolvedValue({permissions:[],nextPageToken:'same'})
  const google=createFileProperties();await expect(google.command('googleListPermissions','s','movie')).rejects.toThrow('重复');google.dispose()
 })

})
