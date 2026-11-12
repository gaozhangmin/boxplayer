import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {createRemoteFolder} from '@/features/files/drive/folderMutations'
import {renameRemoteFile} from '@/features/files/drive/renameMutations'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(value:{body:number[]})=>new TextDecoder().decode(new Uint8Array(value.body))}))
const account={id:'source',providerId:'115' as const,name:'Fixture',baseUrl:'',authOrigins:[]},file={file_id:'1234567890123456789',parent_file_id:'12',isDir:false},response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let detail:any,write:any
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];detail={file_id:file.file_id,file_name:'New.mkv',file_category:'1'};write={code:0,data:{file_id:file.file_id,file_name:'New.mkv'}};vi.mocked(request).mockImplementation(async(_a,_m,url)=>response(url.includes('get_info')?{code:0,data:detail}:write))})
describe('original 115 new folder and rename with native receipt confirmation',()=>{
 it('keeps large string IDs and original rename form without exposing Authorization',async()=>{expect(await renameRemoteFile(account,file,'New.mkv')).toEqual({...file,name:'New.mkv'});expect(vi.mocked(request).mock.calls[0]).toEqual([account,'POST','https://proapi.115.com/open/ufile/update','file_id=1234567890123456789&file_name=New.mkv',{'Content-Type':'application/x-www-form-urlencoded'}]);expect(request).toHaveBeenCalledTimes(2)})
 it.each(['','root','backup_root','drive115_root'])('maps only exact root alias %s to pid=0',async parent=>{detail={file_id:file.file_id,file_name:'Folder',file_category:'0'};expect(await createRemoteFolder(account,parent,'Folder')).toEqual({file_id:file.file_id,error:''});expect(vi.mocked(request).mock.calls[0]![3]).toBe('pid=0&file_name=Folder')});
 it('does not treat an ID containing root as a root alias',async()=>{await expect(createRemoteFolder(account,'child_root_12','Folder')).rejects.toThrow('标识');expect(request).not.toHaveBeenCalled()});
 it.each([{file_id:'other',file_name:'New.mkv',file_category:'1'},{file_id:file.file_id,file_name:'Old.mkv',file_category:'1'},{file_id:file.file_id,file_name:'New.mkv',file_category:'0'}])('rejects mismatched rename detail %j',async value=>{detail=value;await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow(/详情|未确认/)});
 it('rejects failed provider rename without treating success=false as confirmed',async()=>{write={code:403,message:'拒绝'};await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('未确认');expect(request).toHaveBeenCalledTimes(1)});
 it('rejects unsafe numeric new IDs instead of stringifying lost precision',async()=>{write={code:0,data:{file_id:Number(file.file_id)}};await expect(createRemoteFolder(account,'0','Folder')).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1)});
 it('verifies actual new folder type and name before returning a receipt',async()=>{detail={file_id:file.file_id,file_name:'Folder',file_category:'1'};await expect(createRemoteFolder(account,'0','Folder')).rejects.toThrow('类型未确认')});
 it('does not issue requests for a removed account',async()=>{useFileSourcesStore().accounts=[];await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('已移除');expect(request).not.toHaveBeenCalled()});
})
