import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {guangya} from '@/features/sources/guangya'
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
const account={id:'fixture',providerId:'guangya' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
const reply=(items:unknown[])=>vi.mocked(request).mockResolvedValueOnce(response({code:0,data:{list:items}}))
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account]})
it('retains original wildcard request, case-insensitive filter and model while binding real account identity',async()=>{reply([{fileId:'movie',name:'Movie.MKV',resType:1,parentId:'parent',fileSize:42,thumbnailUrl:'https://fixture.test/cover',md5:'hash'},{fileId:'other',name:'Other.txt',resType:1}]);const result=await guangya.search!(account,'  MOVIE ');expect(result.entries).toHaveLength(1);expect(result.entries[0]).toMatchObject({id:'movie',name:'Movie.MKV',originalParent:'parent',playable:true,electronModel:{drive_id:account.id,file_id:'movie',description:'guangya_id:movie',content_hash:'hash',thumbnail:'https://fixture.test/cover'}});expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!)).toEqual({parentId:'*',page:0,pageSize:100,orderBy:0,sortType:0});expect(result.nextCursor).toBeUndefined()})
it('retains the original thirty-result limit and does not advertise unbounded server search',async()=>{reply(Array.from({length:40},(_,i)=>({fileId:`file-${i}`,name:`Movie${i}.mkv`,resType:1})));expect((await guangya.search!(account,'Movie')).entries).toHaveLength(30)})
it('does not convert a protocol failure into empty successful search results',async()=>{vi.mocked(request).mockResolvedValueOnce(response({code:403}));await expect(guangya.search!(account,'Movie')).rejects.toThrow('未确认成功')})
it('allows a genuinely empty result and ignores whitespace-only input without network calls',async()=>{expect((await guangya.search!(account,'  ')).entries).toEqual([]);expect(request).not.toHaveBeenCalled();reply([]);expect((await guangya.search!(account,'missing')).entries).toEqual([])})
it('rejects account mismatches and unsupported cursors before network calls',async()=>{await expect(guangya.search!({...account,providerId:'139'},'Movie')).rejects.toThrow('来源不匹配');await expect(guangya.search!(account,'Movie','1')).rejects.toThrow('不支持继续分页');expect(request).not.toHaveBeenCalled()})
it.each([{fileSize:-1},{updatedAt:'invalid'},{thumbnail:42}])('rejects malformed original models %j',async patch=>{reply([{fileId:'file',name:'Movie.mkv',resType:1,...patch}]);await expect(guangya.search!(account,'Movie')).rejects.toThrow('元数据无效')})
it('rejects duplicate search identities',async()=>{reply([{fileId:'file',name:'Movie1.mkv',resType:1},{fileId:'file',name:'Movie2.mkv',resType:1}]);await expect(guangya.search!(account,'Movie')).rejects.toThrow('重复')})
it('does not return a response to an account removed during the request',async()=>{vi.mocked(request).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[];return response({code:0,data:{list:[]}})});await expect(guangya.search!(account,'Movie')).rejects.toThrow('来源不匹配')})
