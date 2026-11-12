import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {drive115} from '@/features/sources/cloud'
import {searchDrive115} from '@/features/files/drive/drive115Search'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),playable:()=>true,text:(value:{body:number[]})=>new TextDecoder().decode(new Uint8Array(value.body))}))
const account={id:'source',providerId:'115' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id='1234567890123456789',row={file_id:id,parent_id:'12',file_name:'电影 Movie.mkv',file_size:'1024',file_category:'1',user_utime:'1700000000',thumb:'https://example.test/preview.jpg'},response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let body:any
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];body={code:0,state:true,count:1,data:[row]};vi.mocked(request).mockImplementation(async()=>response(body))})
describe('original 115 search query and model through SourceDriver',()=>{
 it('preserves keyword case/encoding and original result icon, pinyin, thumbnail and parent',async()=>{const result=await drive115.search!(account,' Movie & 电影 ');expect(vi.mocked(request).mock.calls[0]!.slice(1,3)).toEqual(['GET','https://proapi.115.com/open/ufile/search?search_value=Movie+%26+%E7%94%B5%E5%BD%B1&limit=200&offset=0']);expect(result.entries[0]).toMatchObject({id,playable:true,originalParent:'12',modified:1700000000000,electronModel:{file_id:id,drive_id:account.id,parent_file_id:'12',sizeStr:'1.00KB',category:'video2',thumbnail:row.thumb}});const model=(result.entries[0] as any).electronModel;expect(model.namesearch).toContain('dian');expect(model.icon).not.toBe('iconfile-txt')});
 it('binds pagination to account and complete case-sensitive query',async()=>{body.count=2;const first=await searchDrive115(account,'Movie');expect(first.nextCursor).toBeDefined();body.data=[{...row,file_id:'2'}];expect((await searchDrive115(account,'Movie',first.nextCursor)).nextCursor).toBeUndefined();expect(vi.mocked(request).mock.calls[1]![2]).toContain('offset=1');await expect(searchDrive115(account,'movie',first.nextCursor)).rejects.toThrow('范围不匹配');useFileSourcesStore().accounts.push({...account,id:'other'});await expect(searchDrive115({...account,id:'other'},'Movie',first.nextCursor)).rejects.toThrow('范围不匹配')});
 it('keeps folder/root-parent model semantics',async()=>{body.data=[{...row,parent_id:'0',file_category:'0',file_name:'Folder'}];expect((await searchDrive115(account,'Folder')).entries[0]).toMatchObject({isDirectory:true,playable:false,originalParent:'0',electronModel:{icon:'iconfile-folder'}})});
 it.each([{...row,file_id:Number(id)},{...row,parent_id:''},{...row,file_category:'bad'},{...row,file_name:''}])('rejects malformed identity or precision %j',async value=>{body.data=[value];await expect(searchDrive115(account,'Movie')).rejects.toThrow()});
 it('rejects duplicate IDs within a search page',async()=>{body.count=2;body.data=[row,row];await expect(searchDrive115(account,'Movie')).rejects.toThrow('身份')});
 it.each([{code:403,data:[]},{code:0,count:2,data:[]},{code:0,data:[row]},{code:0,count:-1,data:[]}])('does not report denied or incomplete search as an empty result %j',async value=>{body=value;await expect(searchDrive115(account,'Movie')).rejects.toThrow()});
 it('rejects empty queries before a native request',async()=>{await expect(searchDrive115(account,' ')).rejects.toThrow('关键字');expect(request).not.toHaveBeenCalled()});
})
