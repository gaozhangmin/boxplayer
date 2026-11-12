import {beforeEach,expect,it,vi} from 'vitest'
import path from 'node:path'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {webdav,parseDav} from '@/features/sources/webdav'
import {alist} from '@/features/sources/alist'
import {json,request} from '@/features/sources/transport'
import {posixPath} from '@/features/files/drive/readonlyDavPorts'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn(),request:vi.fn()}))
const dav={id:'dav-model',providerId:'webdav' as const,name:'Fixture',baseUrl:'https://fixture.test/dav/',userId:'owner',authOrigins:[]},list={...dav,id:'alist-model',providerId:'alist' as const,baseUrl:'https://fixture.test/alist'}
const encode=(body:string)=>({status:207,headers:{},body:Array.from(new TextEncoder().encode(body)),finalUrl:''})
const response=(href:string,properties:string)=>`<d:response><d:href>${href}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
const xml=(body:string)=>`<d:multistatus xmlns:d="DAV:">${body}</d:multistatus>`
let content:any[],code:number,total:number|undefined
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[dav,list]
 content=[{name:'Movie.MKV',is_dir:false,size:4096,modified:'2026-11-01T00:00:00Z',thumb:'posters/movie.jpg',hash_info:{md5:'fixture-md5'}}];code=200;total=1
 vi.mocked(json).mockImplementation(async()=>({code,data:{content,total}}))
 vi.mocked(request).mockResolvedValue(encode(xml(response('/dav/Movie.MKV','<d:getcontentlength>4096</d:getcontentlength><d:getlastmodified>Sun, 01 Nov 2026 00:00:00 GMT</d:getlastmodified><d:getcontenttype>video/x-matroska</d:getcontenttype>'))))
})
it('retains original WebDAV model fields while adapting native URL/account identities',async()=>{
 const result=await webdav.list(dav,''),row=result.entries[0] as any
 expect(row).toMatchObject({id:'https://fixture.test/dav/Movie.MKV',name:'Movie.MKV',size:4096,playable:true,modified:1793491200000,electronModel:{drive_id:dav.id,file_id:'https://fixture.test/dav/Movie.MKV',parent_file_id:'',path:'/Movie.MKV',name:'Movie.MKV',namesearch:'movie.mkv',ext:'mkv',icon:'iconfile_video',mime_type:'video/x-matroska',size:4096,time:1793491200000}})
 expect(request).toHaveBeenCalledWith(dav,'PROPFIND',dav.baseUrl,expect.stringContaining('getlastmodified'),{Depth:'1','Content-Type':'application/xml'})
})
it.each([['Folder','<d:resourcetype><d:collection/></d:resourcetype>','iconfile-folder'],['song.mp3','','iconfile-audio'],['picture.jpg','','iconfile-img'],['book.pdf','','iconfile-pdf']])('uses the original icon for %s',async(name,properties,icon)=>{
 const row=parseDav(dav,'',xml(response('/dav/'+name,properties))).entries[0] as any
 expect(row.electronModel.icon).toBe(icon);expect(row.isDirectory).toBe(name==='Folder')
})
it.each([0,200])('retains original AList code=%s and complete listing request/model',async status=>{
 code=status;const row=(await alist.list(list,'')).entries[0] as any
 expect(json).toHaveBeenCalledWith(list,'POST','https://fixture.test/alist/api/fs/list',{path:'/',password:'',page:1,per_page:0,refresh:false})
 expect(row).toMatchObject({id:'/Movie.MKV',playable:true,electronModel:{drive_id:list.id,file_id:'/Movie.MKV',parent_file_id:'',path:'/Movie.MKV',icon:'iconfile_video',size:4096,time:1793491200000,thumbnail:'https://fixture.test/alist/posters/movie.jpg',description:'md5:fixture-md5',content_hash:'fixture-md5'}})
 expect(json).toHaveBeenCalledOnce()
})
it('retains nested parent identity and relative preview URLs',async()=>{
 const row=(await alist.list(list,'/Movies')).entries[0] as any;expect(row).toMatchObject({id:'/Movies/Movie.MKV',electronModel:{parent_file_id:'/Movies',path:'/Movies/Movie.MKV'}})
})
it('handles an empty original AList directory without inventing another page',async()=>{
 content=null as any;total=0;expect(await alist.list(list,'')).toEqual({entries:[]})
})
it.each([{total:2},{content:undefined},{content:[{name:'../escape',is_dir:false,size:1}]},{content:[{name:'bad',is_dir:false,size:-1}]},{content:[{name:'bad',is_dir:false,size:1,modified:'invalid'}]},{content:[{name:'bad',is_dir:false,size:1,thumb:'javascript:alert(1)'}]}])('rejects incomplete or malformed AList data %j',async patch=>{
 vi.mocked(json).mockResolvedValue({code:200,data:{content,total,...patch}});await expect(alist.list(list,'')).rejects.toThrow()
})
it('rejects duplicate AList names instead of assigning duplicate native identities',async()=>{
 content=[content[0],content[0]];total=2;await expect(alist.list(list,'')).rejects.toThrow('标识')
})
it('isolates original mapper payloads during concurrent reads of one account',async()=>{
 vi.mocked(json).mockImplementation(async(_account,_method,_url,body:any)=>({code:200,data:{total:1,content:[{name:body.path==='/one'?'First.mkv':'Second.mkv',is_dir:false,size:1}]}}))
 const [one,two]=await Promise.all([alist.list(list,'/one'),alist.list(list,'/two')]);expect(one.entries[0]?.id).toBe('/one/First.mkv');expect(two.entries[0]?.id).toBe('/two/Second.mkv')
})
it.each([['alist',alist,list],['webdav',webdav,dav]] as const)('discards %s responses after account identity replacement',async(_name,driver,account)=>{
 const replace=()=>{useFileSourcesStore().accounts=useFileSourcesStore().accounts.map(row=>row.id===account.id?{...row,userId:'replacement'}:row)}
 if(account.providerId==='alist')vi.mocked(json).mockImplementationOnce(async()=>{replace();return {code:200,data:{content,total}}})
 else vi.mocked(request).mockImplementationOnce(async()=>{replace();return encode(xml(''))})
 await expect(driver.list(account,'')).rejects.toThrow('身份')
})
it.each(['/dav/a%2Fchild.mkv','/dav/sub/movie.mkv','/dav/../escape.mkv','https://other.test/dav/movie.mkv'])('rejects escaped/non-child WebDAV href %s',async href=>{
 expect(()=>parseDav(dav,'',xml(response(href,'<d:getcontentlength>1</d:getcontentlength>')))).toThrow()
})
it('keeps encoded Unicode roots within the original account scope',()=>{
 const account={...dav,baseUrl:'https://fixture.test/dav/%E7%94%B5%E5%BD%B1/'}
 const row=parseDav(account,'',xml(response('/dav/%E7%94%B5%E5%BD%B1/Film.mkv',''))).entries[0] as any;expect(row.name).toBe('Film.mkv');expect(row.electronModel.path).toBe('/Film.mkv')
})
it.each(['/','/dav/movie.mkv','/dav/a.b.c','/dav/.hidden','/dav/folder/','/dav/中文.txt','/dav/trailing.'])('matches Node POSIX mapping operations for admitted path %s',value=>{
 expect(posixPath.posix.basename(value)).toBe(path.posix.basename(value));expect(posixPath.posix.dirname(value)).toBe(path.posix.dirname(value));expect(posixPath.extname(value)).toBe(path.posix.extname(value))
})
it('preserves original optional-field fallbacks instead of rejecting a path-only file',async()=>{
 content=[{path:'/Film.mkv',modified:null,thumb:null,hash_info:{md5:null}}];total=0
 const row=(await alist.list(list,'')).entries[0] as any;expect(row).toMatchObject({id:'/Film.mkv',name:'Film.mkv',isDirectory:false,size:0,playable:true,electronModel:{icon:'iconfile_video',thumbnail:'',content_hash:''}})
})
it('resolves a relative AList raw_url using the original API-base helper',async()=>{
 vi.mocked(json).mockResolvedValue({code:0,data:{raw_url:'stream/movie.mkv'}})
 expect((await alist.resolve(list,{id:'/Movie.mkv',name:'Movie.mkv',isDirectory:false,size:1,playable:true})).url).toBe('https://fixture.test/alist/stream/movie.mkv')
})
