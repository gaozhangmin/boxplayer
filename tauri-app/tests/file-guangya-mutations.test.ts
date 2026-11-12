import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {createRemoteFolder} from '@/features/files/drive/folderMutations'
import {renameRemoteFile} from '@/features/files/drive/renameMutations'
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
const account={id:'fixture',providerId:'guangya' as const,name:'Fixture',baseUrl:'',authOrigins:[]},file={file_id:'file',parent_file_id:'parent',isDir:false},response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let detail:any,create:any,business:any
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];detail={fileId:'new',name:'Folder',resType:2,parentId:''};create={fileId:'new',resType:2};business={code:0,data:{}};vi.mocked(request).mockImplementation(async(_account,_method,url)=>response(url.endsWith('/create_dir')?{code:0,data:create}:url.endsWith('/get_file_detail')?{code:0,data:detail}:business))})
describe('original Guangya mkdir and rename with native metadata confirmation',()=>{
 it('retains the original create body and confirms the actual new folder',async()=>{expect(await createRemoteFolder(account,'guangya_root','Folder')).toEqual({file_id:'new',error:''});expect(request).toHaveBeenNthCalledWith(1,account,'POST','https://api.guangyapan.com/nd.bizuserres.s/v1/file/create_dir','{"dirName":"Folder","parentId":"","failIfNameExist":true}',{'Content-Type':'application/json'});expect(vi.mocked(request).mock.calls[1]![3]).toBe('{"fileId":"new"}')})
 it('retains the original rename body and treats resType=1 as a file even with dirType=1',async()=>{detail={fileId:'file',fileName:'New.mkv',resType:1,dirType:1,parentId:'parent'};expect(await renameRemoteFile(account,file,'New.mkv')).toMatchObject({file_id:'file',name:'New.mkv',isDir:false});expect(vi.mocked(request).mock.calls[0]![3]).toBe('{"fileId":"file","newName":"New.mkv"}')})
 it.each([{fileId:'wrong'},{name:'Wrong'},{resType:1},{parentId:'wrong'}])('does not confirm a create with conflicting metadata %j',async patch=>{detail={...detail,...patch};await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('光鸭')})
 it('rejects a same-name file returned by create_dir',async()=>{create={fileId:'existing',resType:1,type:'file'};await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('同名资源');expect(request).toHaveBeenCalledTimes(1)})
 it('rejects unsafe numeric IDs instead of rounding a provider identity',async()=>{create={fileId:9007199254740992,resType:2};await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('安全范围')})
 it('does not interpret a successful HTTP status with a business failure as a rename',async()=>{business={code:403,message:'Denied'};await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('未确认');expect(request).toHaveBeenCalledTimes(1)})
 it('preserves the original root-list fallback after a failed detail read',async()=>{vi.mocked(request).mockResolvedValueOnce(response({code:0,data:create})).mockResolvedValueOnce(response({code:500})).mockResolvedValueOnce(response({code:0,data:{list:[detail]}}));expect((await createRemoteFolder(account,'','Folder')).file_id).toBe('new');expect(vi.mocked(request).mock.calls[2]![2]).toContain('/get_file_list');expect(JSON.parse(vi.mocked(request).mock.calls[2]![3]!)).toMatchObject({parentId:'',page:0,pageSize:100})})
 it('requires a matching account before issuing provider mutations',async()=>{useFileSourcesStore().accounts=[];await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('来源不匹配');expect(request).not.toHaveBeenCalled()})
 it('preserves successful 201 responses supported by the original fetch.ok path',async()=>{vi.mocked(request).mockResolvedValueOnce({...response({code:0,data:create}),status:201}).mockResolvedValueOnce(response({code:0,data:detail}));expect((await createRemoteFolder(account,'','Folder')).file_id).toBe('new')})

})
