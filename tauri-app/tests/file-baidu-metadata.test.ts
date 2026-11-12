import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {rawRequest} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {baiduFileMetadata,baiduDirectoryLocation} from '@/features/files/drive/baiduMetadata'
import {createRemoteFolder} from '@/features/files/drive/folderMutations'
vi.mock('@/features/sources/transport',()=>({rawRequest:vi.fn(),json:vi.fn(),request:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
const account={id:'fixture',providerId:'baidu' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id='9007199254740997',response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let row:any
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];row={fs_id:id,path:'/Movie',filename:'Movie',isdir:1,dlink:'https://fixture.test/private'};vi.mocked(rawRequest).mockImplementation(async()=>response({errno:0,list:[row]}))})
it('serializes large decimal fs_id as exact JSON numeric literal and verifies the returned identity',async()=>{
 const result=await baiduFileMetadata(account,id),url=new URL(vi.mocked(rawRequest).mock.calls[0]![2]);expect(url.searchParams.get('fsids')).toBe('[9007199254740997]');expect(url.searchParams.get('dlink')).toBe('0');expect(url.searchParams.has('access_token')).toBe(false);expect(result.dlink).toBeUndefined();expect(await baiduDirectoryLocation(account,id)).toBe('/Movie')
})
it.each([{fs_id:'other'},{fs_id:9007199254740992},{path:'/Other'},{filename:'Wrong'},{isdir:2}])('rejects conflicting detail %j',async patch=>{
 row={...row,...patch};await expect(baiduFileMetadata(account,id)).rejects.toThrow('百度')
})
it('accepts the original info response alias without using a downloaded file URL',async()=>{
 vi.mocked(rawRequest).mockResolvedValueOnce(response({errno:0,info:[row]}));expect(await baiduFileMetadata(account,id)).toMatchObject({path:'/Movie',fs_id:id});expect((await baiduFileMetadata(account,id)).dlink).toBeUndefined()
})
it('rejects file IDs as directory destinations',async()=>{row.isdir=0;await expect(baiduDirectoryLocation(account,id)).rejects.toThrow('实际指向文件')})
it('allows existing physical bookmark paths without a metadata query',async()=>{
 expect(await baiduDirectoryLocation(account,'/Movie/root')).toBe('/Movie/root');expect(await baiduDirectoryLocation(account,'baidu_root')).toBe('/');expect(rawRequest).not.toHaveBeenCalled()
})
it('creates a child folder from a stable directory ID at its confirmed current physical path',async()=>{
 vi.mocked(rawRequest).mockImplementation(async(_account,method)=>response(method==='POST'?{errno:0,fs_id:7,isdir:1,path:'/Movie/Child'}:{errno:0,list:[row]}))
 expect(await createRemoteFolder(account,id,'Child')).toEqual({file_id:'7',error:''});expect(new URLSearchParams(vi.mocked(rawRequest).mock.calls[1]![3]).get('path')).toBe('/Movie/Child')
})
it('refuses wrong accounts and late metadata after account removal',async()=>{
 await expect(baiduFileMetadata({...account,providerId:'box'},id)).rejects.toThrow('来源不匹配');expect(rawRequest).not.toHaveBeenCalled()
 vi.mocked(rawRequest).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[];return response({errno:0,list:[row]})});await expect(baiduFileMetadata(account,id)).rejects.toThrow('来源不匹配')
})
it('does not issue a request with rounded numeric identifiers or a download-link flag',async()=>{
 const {apiBaiduFileMetas}=await import('@/features/files/drive/electron/providers/baiduMetadata')
 await expect(apiBaiduFileMetas(account.id,[9007199254740992],0)).rejects.toThrow('数值精度')
 await expect(apiBaiduFileMetas(account.id,[id],1)).rejects.toThrow('未适配');expect(rawRequest).not.toHaveBeenCalled()
})
