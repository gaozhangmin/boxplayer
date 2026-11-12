import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {listGuangya} from '@/features/files/drive/guangyaListing'
import {mapGuangyaFileToAliModel} from '@/features/files/drive/electron/providers/guangyaMetadata'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
const account={id:'fixture',providerId:'guangya' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
const reply=(items:unknown[])=>vi.mocked(request).mockResolvedValueOnce(response({code:0,data:{list:items}}))
const page=Array.from({length:100},(_,i)=>({fileId:`file-${i}`,name:`视频${i}.mkv`,resType:1,dirType:1,fileSize:42}))
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account]})
it('retains the original file icon, pinyin, formatted values, MIME, thumbnail and content hash',async()=>{
 const item={...page[0],parentId:'parent',updatedAt:'2026-11-08T01:02:03Z',mimeType:'video/x-matroska',thumbnailUrl:'https://fixture.test/cover',md5:'fixture-hash'}
 reply([item]);const result=await listGuangya(account,'parent');expect(result.entries[0]!.electronModel).toEqual(mapGuangyaFileToAliModel(item,account.id,'parent'));expect(result.entries[0]).toMatchObject({originalParent:'parent',playable:true,size:42});expect(result.entries[0]!.electronModel).toMatchObject({description:'guangya_id:file-0',thumbnail:item.thumbnailUrl,content_hash:item.md5,mime_type:item.mimeType})
})
it.each(['','0','/','guangya_root','root','backup_root'])('normalizes root %s without changing the original request body',async root=>{
 reply([{resId:'folder',dirName:'Movies',resType:2}]);const result=await listGuangya(account,root);expect(result.entries[0]).toMatchObject({isDirectory:true,playable:false,originalParent:''});expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!)).toEqual({parentId:'',page:0,pageSize:100,orderBy:0,sortType:0})
})
it('continues a full page and stops on a valid empty list',async()=>{reply(page);reply([]);const first=await listGuangya(account,'parent');expect(first.nextCursor).toBeTruthy();const second=await listGuangya(account,'parent',first.nextCursor);expect(second).toEqual({entries:[],nextCursor:undefined});expect(JSON.parse(vi.mocked(request).mock.calls[1]![3]!)).toMatchObject({parentId:'parent',page:1})})
it('rejects cursors from another account or parent before making requests',async()=>{reply(page);const first=await listGuangya(account,'parent');vi.mocked(request).mockClear();await expect(listGuangya(account,'other',first.nextCursor)).rejects.toThrow('游标');const other={...account,id:'other'};useFileSourcesStore().accounts.push(other);await expect(listGuangya(other,'parent',first.nextCursor)).rejects.toThrow('游标');expect(request).not.toHaveBeenCalled()})
it('rejects repeated pages and duplicate identifiers',async()=>{reply(page);reply(page);const first=await listGuangya(account,'parent');await expect(listGuangya(account,'parent',first.nextCursor)).rejects.toThrow('重复');reply([page[0],page[0]]);await expect(listGuangya(account,'parent')).rejects.toThrow('重复')})
it.each([{parentId:'wrong'},{fileId:9007199254740992},{fileSize:-1},{updatedAt:'invalid'},{thumbnail:42},{name:42}])('rejects conflicting or malformed provider metadata %j',async patch=>{reply([{...page[0],...patch}]);await expect(listGuangya(account,'parent')).rejects.toThrow('光鸭')})
it.each([{},{list:{}},{list:null}])('does not silently interpret malformed lists as empty %j',async data=>{vi.mocked(request).mockResolvedValueOnce(response({code:0,data}));await expect(listGuangya(account,'')).rejects.toThrow('列表响应无效')})
it('rejects accounts removed while a request was in flight',async()=>{vi.mocked(request).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[];return response({code:0,data:{list:[]}})});await expect(listGuangya(account,'')).rejects.toThrow('来源不匹配')})
