import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {alipan} from '@/features/sources/alipan'
import {aliColorPage,aliSearchPage} from '@/features/files/drive/aliColorListing'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(value:{body:number[]})=>new TextDecoder().decode(new Uint8Array(value.body)),playable:()=>true}))
vi.mock('@/features/sources/alipan',()=>({alipan:{list:vi.fn()}}))
const {pane}=vi.hoisted(()=>({pane:{sourceId:'source',context:0}}));vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>pane}))
const account={id:'source',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),row={drive_id:'backup',file_id:'movie',parent_file_id:'parent',name:'Movie.mkv',type:'file',description:'c00bc99'},response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];pane.sourceId='source';pane.context++;vi.mocked(alipan.list).mockResolvedValue({entries:[{id:id('backup','root'),name:'备份盘',isDirectory:true,size:0,playable:false},{id:id('resource','root'),name:'资源盘',isDirectory:true,size:0,playable:false}]});vi.mocked(request).mockResolvedValue(response({items:[row],next_marker:'next'}))})
describe('original Ali dual-drive color query',()=>{
 it('retains original query/order and both actual drive IDs',async()=>{const result=await aliColorPage(account,'color#00bc99');expect(result.entries[0]).toMatchObject({id:id('backup','movie'),originalParent:id('backup','parent'),description:'c00bc99'});expect(request).toHaveBeenCalledExactlyOnceWith(account,'POST','https://api.aliyundrive.com/adrive/v3/file/search',JSON.stringify({marker:'',limit:100,fields:'*',query:'description="c00bc99"',order_by:'updated_at DESC',drive_id_list:['backup','resource']}),{'Content-Type':'application/json'})})
 it('binds cursor to color scope and preserves pagination',async()=>{const first=await aliColorPage(account,'color#00bc99');vi.mocked(request).mockResolvedValue(response({items:[],next_marker:''}));expect(await aliColorPage(account,'color#00bc99',first.nextCursor)).toEqual({entries:[],nextCursor:undefined});expect(JSON.parse(vi.mocked(request).mock.calls[1]![3]!).marker).toBe('next');await expect(aliColorPage(account,'color#42a5f5',first.nextCursor)).rejects.toThrow('范围不匹配')})
 it.each([{...row,drive_id:'foreign'},{...row,file_id:''},{...row,parent_file_id:''}])('rejects unknown result identity %j',async value=>{vi.mocked(request).mockResolvedValue(response({items:[value]}));await expect(aliColorPage(account,'color#00bc99')).rejects.toThrow('身份')})
 it('rejects unsupported provider and malformed colors before requests',async()=>{await expect(aliColorPage({...account,providerId:'alipan-open'},'color#00bc99')).rejects.toThrow('范围');await expect(aliColorPage(account,'color"query')).rejects.toThrow('范围');expect(request).not.toHaveBeenCalled()})
 it('rejects stale results after source changes',async()=>{vi.mocked(request).mockImplementationOnce(async()=>{pane.context++;return response({items:[row]})});await expect(aliColorPage(account,'color#00bc99')).rejects.toThrow('已切换')})
})

describe('original Ali ordinary and advanced search scopes',()=>{
 it('preserves case, type, extension, favorite and dates in original query',async()=>{
  const result=await aliSearchPage(account,'searchMovie type:video ext:mkv,mp4 fav:true begin:2025-01-01 end:2025-02-01 range:backup');
  expect(result.entries[0]?.originalParent).toBe(id('backup','parent'));
  const body=JSON.parse(vi.mocked(request).mock.calls[0]![3]!);
  expect(body.drive_id_list).toEqual(['backup']);expect(body.query).toContain('name match "Movie"');expect(body.query).toContain('category="video"');expect(body.query).toContain('file_extension in ["mkv","mp4"]');expect(body.query).toContain('starred = true');expect(body.query).toContain('created_at >= "2025-01-01T00:00:00"');
 });
 it.each(['searchMovie','searchMovie range:','searchMovie range:pic','searchMovie range:backup range:resource'])('rejects missing, unavailable or ambiguous scopes %s',async path=>{await expect(aliSearchPage(account,path)).rejects.toThrow('范围');expect(request).not.toHaveBeenCalled()});
 it('rejects results outside the selected physical drive',async()=>{vi.mocked(request).mockResolvedValue(response({items:[{...row,drive_id:'resource'}]}));await expect(aliSearchPage(account,'searchMovie range:backup')).rejects.toThrow('身份')});
 it('binds pagination to the full query including case and range',async()=>{const first=await aliSearchPage(account,'searchMovie range:backup');await expect(aliSearchPage(account,'searchmovie range:backup',first.nextCursor)).rejects.toThrow('范围不匹配')});
 it('does not route the open account through the web search endpoint',async()=>{await expect(aliSearchPage({...account,providerId:'alipan-open'},'searchMovie range:backup')).rejects.toThrow('范围');expect(request).not.toHaveBeenCalled()});
})
