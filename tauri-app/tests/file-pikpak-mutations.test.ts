import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {createRemoteFolder} from '@/features/files/drive/folderMutations'
import {renameRemoteFile} from '@/features/files/drive/renameMutations'
import {supportsRemoteRelocation} from '@/features/files/drive/relocationMutations'
import {apiPikPakCopyBatch} from '@/features/files/drive/electron/providers/pikpakFileCmd'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(value:{body:number[]})=>new TextDecoder().decode(new Uint8Array(value.body))}))
const account={id:'source',providerId:'pikpak' as const,name:'Fixture',baseUrl:'',authOrigins:[]},file={file_id:'file',parent_file_id:'parent',isDir:false},response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let write:any,detail:any
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];write={file:{id:'file',name:'New.mkv',kind:'drive#file',parent_id:'parent'}};detail={id:'file',name:'New.mkv',kind:'drive#file',parent_id:'parent',phase:'PHASE_TYPE_COMPLETE'};vi.mocked(request).mockImplementation(async(_a,method)=>response(method==='GET'?detail:write))})
describe('original PikPak mkdir/rename with native detail confirmation',()=>{
 it.each(['','root','backup_root','pikpak_root'])('omits parent_id for exact root alias %s',async parent=>{write={file:{id:'new'}};detail={id:'new',name:'Folder',kind:'drive#folder',parent_id:''};expect(await createRemoteFolder(account,parent,'Folder')).toEqual({file_id:'new',error:''});expect(vi.mocked(request).mock.calls[0]).toEqual([account,'POST','https://api-drive.mypikpak.com/drive/v1/files',JSON.stringify({kind:'drive#folder',name:'Folder'}),{'Content-Type':'application/json'}])});
 it('does not replace an ordinary parent containing root with the account root',async()=>{write={id:'new'};detail={id:'new',name:'Folder',kind:'drive#folder',parent_id:'child-root-name'};await createRemoteFolder(account,'child-root-name','Folder');expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!)).toMatchObject({parent_id:'child-root-name'})});
 it('uses original rename PATCH and confirms actual live name, kind and parent',async()=>{expect(await renameRemoteFile(account,file,'New.mkv')).toEqual({...file,name:'New.mkv'});expect(vi.mocked(request).mock.calls[0]).toEqual([account,'PATCH','https://api-drive.mypikpak.com/drive/v1/files/file','{"name":"New.mkv"}',{'Content-Type':'application/json'}]);expect(vi.mocked(request).mock.calls[1]!.slice(1,3)).toEqual(['GET','https://api-drive.mypikpak.com/drive/v1/files/file?thumbnail_size=SIZE_LARGE'])});
 it('does not accept the original rename fallback name as proof of a successful change',async()=>{write={};detail={...detail,name:'Old.mkv'};await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('未确认')});
 it.each([{id:'foreign'},{kind:'drive#folder'},{parent_id:'foreign'},{trashed:true},{phase:'PHASE_TYPE_RUNNING'}])('rejects wrong identity/type/location or unready detail %j',async value=>{detail={...detail,...value};await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow()});
 it('rejects a conflicting PATCH identity before trusting followup details',async()=>{write={file:{id:'foreign',name:'New.mkv'}};await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('标识');expect(request).toHaveBeenCalledOnce()});
 it('keeps provider failures explicit without creating followup requests',async()=>{write={error:'permission_denied',error_description:'Provider denied'};await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('Provider denied');expect(request).toHaveBeenCalledOnce()});
 it('does not send batch writes without a caller-bound lifecycle guard',async()=>{expect(supportsRemoteRelocation(account)).toBe(true);await expect(apiPikPakCopyBatch(account.id,['file'],'pikpak_root')).rejects.toThrow('未绑定');expect(request).not.toHaveBeenCalled()});
})
