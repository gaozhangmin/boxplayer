import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {cloud139} from '@/features/sources/cloud139'
import {json} from '@/features/sources/transport'
import {mapCloud139FileToAliModel} from '@/features/files/drive/electron/providers/cloud139Metadata'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn()}))
const account={id:'model139',providerId:'139' as const,name:'Fixture',baseUrl:'https://personal.yun.139.com/hcy',userId:'owner',authOrigins:[]}
const movie={fileId:'movie',parentFileId:'parent',name:'电影.mkv',type:'file',size:42,updated_at:'2026-11-01T01:02:03Z',thumbnailUrls:[{url:'https://fixture.test/image'}]}
let rows:any[],next:string|undefined
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];rows=[movie];next=undefined;vi.mocked(json).mockImplementation(async()=>({data:{items:rows,pageInfo:{nextPageCursor:next}}}))})
it('preserves the exact original mapper fields and actual parent instead of generic text icons',async()=>{
 const row=(await cloud139.list(account,'parent')).entries[0] as any
 expect(row.electronModel).toEqual(mapCloud139FileToAliModel(movie,account.id,'parent'))
 expect(row).toMatchObject({id:'movie',originalParent:'parent',modified:Date.parse(movie.updated_at),playable:true})
 expect(row.electronModel.icon).not.toBe('iconfile-txt');expect(row.electronModel.namesearch).toBeTruthy();expect(row.electronModel.timeStr).toBeTruthy();expect(row.electronModel.sizeStr).toBeTruthy()
})
it.each([{fileId:undefined,catalogID:'folder',catalogName:'目录',name:undefined,type:undefined,parentFileId:'parent'},{fileId:undefined,contentID:'clip',contentName:'Clip.mkv',name:undefined,type:undefined,parentFileId:'parent'}])('retains legacy aliases and original media classification',async patch=>{
 rows=[{...movie,...patch}];const result=(await cloud139.list(account,'parent')).entries[0] as any
 expect(result.electronModel).toEqual(mapCloud139FileToAliModel(rows[0],account.id,'parent'));expect(result.isDirectory).toBe(!!patch.catalogID)
})
it.each([{parentFileId:'other'},{fileId:9007199254740992},{size:-1},{size:'NaN'},{updated_at:'not-a-date'},{thumbnailUrls:[{url:42}]},{type:'file',catalogID:'folder'},{name:42}])('rejects conflicting or unsafe original metadata %j',async patch=>{
 rows=[{...movie,...patch}];await expect(cloud139.list(account,'parent')).rejects.toThrow()
})
it('binds cursors to owner, route and physical parent before any request',async()=>{
 next='two';const first=await cloud139.list(account,'parent'),count=vi.mocked(json).mock.calls.length
 for(const args of [[{...account,id:'another'},'parent'],[{...account,userId:'another'},'parent'],[{...account,baseUrl:'https://other.yun.139.com/hcy'},'parent'],[account,'another']] as const)await expect(cloud139.list(args[0],args[1],first.nextCursor)).rejects.toThrow()
 expect(json).toHaveBeenCalledTimes(count)
})
it('rejects nonadjacent cursor cycles and repeated file IDs',async()=>{
 next='two';const first=await cloud139.list(account,'parent');rows=[{...movie,fileId:'second'}];next='three';const second=await cloud139.list(account,'parent',first.nextCursor)
 rows=[{...movie,fileId:'third'}];next='two';await expect(cloud139.list(account,'parent',second.nextCursor)).rejects.toThrow('游标重复')
 rows=[movie];next=undefined;await expect(cloud139.list(account,'parent',second.nextCursor)).rejects.toThrow('重复文件')
})
it('does not return old-account results after removal or owner replacement',async()=>{
 vi.mocked(json).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[];return {data:{items:[movie]}}})
 await expect(cloud139.list(account,'parent')).rejects.toThrow('账号')
 useFileSourcesStore().accounts=[account]
 vi.mocked(json).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'other'}];return {data:{items:[movie]}}})
 await expect(cloud139.list(account,'parent')).rejects.toThrow('身份')
})
it.each([{},null,{data:{items:{}}},{data:{items:[],getDiskResult:{contentList:{}}}}])('does not silently turn malformed response %j into an empty directory',async value=>{
 vi.mocked(json).mockResolvedValue(value as any);await expect(cloud139.list(account,'parent')).rejects.toThrow()
})
it('merges legacy folders and content using the original extraction and mapper',async()=>{
 vi.mocked(json).mockRejectedValueOnce(Error('来源请求失败（404）')).mockRejectedValueOnce(Error('来源请求失败（404）')).mockResolvedValueOnce({data:{getDiskResult:{catalogList:[{catalogID:'folder',catalogName:'目录'}],contentList:[{contentID:'movie',contentName:'Movie.mkv',contentSize:42}]}}})
 const result=await cloud139.list(account,'/')
 expect(result.entries.map(row=>[row.id,row.isDirectory])).toEqual([['folder',true],['movie',false]])
 expect((result.entries[1] as any).electronModel.icon).not.toBe('iconfile-txt')
})
