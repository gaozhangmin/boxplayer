import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {cloud189} from '@/features/sources/cloud189'
import {json} from '@/features/sources/transport'
import {mapCloud189FileToAliModel} from '@/features/files/drive/electron/providers/cloud189Metadata'
import {cloud189FamilyId} from '@/features/files/drive/electron/providers/cloud189Identity'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn()}))
const account={id:'189-model',providerId:'189' as const,name:'Fixture',baseUrl:'https://api.cloud.189.cn',userId:'owner',authOrigins:[]}
const personal=JSON.stringify({fileId:'parent'}),family=JSON.stringify({fileId:'parent',familyId:'9007199254740999'})
const movie={id:'9007199254740997',name:'电影.mkv',size:'4096',lastOpTime:'2026-11-01T00:00:00Z',createDate:'2026-10-01T00:00:00Z',icon:{smallUrl:'https://fixture.test/small',max600:'https://fixture.test/large'}}
let files:any[],folders:any[]
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];files=[movie];folders=[];vi.mocked(json).mockImplementation(async()=>({fileListAO:{folderList:folders,fileList:files}}))})
it.each([personal,family])('uses the original complete mapper while adapting native scope IDs: %s',async parent=>{
 const scope=JSON.parse(parent),result=(await cloud189.list(account,parent)).entries[0] as any,originalParent=scope.familyId?cloud189FamilyId(scope.familyId,scope.fileId):scope.fileId
 const original=mapCloud189FileToAliModel({...movie,isFolder:false,familyId:scope.familyId||'',parentId:originalParent},account.id,originalParent)
 expect(result.electronModel).toEqual({...original,file_id:result.id,parent_file_id:parent})
 expect(result).toMatchObject({name:'电影.mkv',isDirectory:false,playable:true,size:4096,modified:Date.parse(movie.lastOpTime),originalParent:parent})
 expect(result.electronModel).toMatchObject({icon:'iconfile_video',thumbnail:movie.icon.max600});expect(result.electronModel.namesearch).toBeTruthy();expect(result.electronModel.timeStr).toBeTruthy()
 expect(JSON.parse(result.id)).toEqual({fileId:movie.id,...(scope.familyId?{familyId:scope.familyId}:{})})
})
it('retains original collection classification even if a raw isFolder flag disagrees',async()=>{
 files=[{...movie,isFolder:true}];folders=[{id:'folder',name:'目录',isFolder:false}]
 const result=await cloud189.list(account,personal);expect(result.entries.map(row=>row.isDirectory)).toEqual([true,false])
})
it.each(['','root','backup_root','cloud189_root'])('normalizes native aggregate root alias %j without requests',async parent=>{
 expect((await cloud189.list(account,parent)).entries.map(row=>JSON.parse(row.id))).toEqual([{fileId:'-11'},{fileId:'',families:true}]);expect(json).not.toHaveBeenCalled()
})
it.each([{id:9007199254740992},{id:{}},{size:-1},{size:NaN},{size:true},{name:42},{lastOpTime:'bad-date'},{icon:{max600:42}},{familyId:'foreign'}])('rejects invalid metadata %j instead of producing a generic row',async patch=>{
 files=[{...movie,...patch}];await expect(cloud189.list(account,personal)).rejects.toThrow()
})
it('scopes pagination to the account identity, physical folder and family',async()=>{
 files=Array.from({length:100},(_,index)=>({...movie,id:'page-'+index}));const first=await cloud189.list(account,family),calls=vi.mocked(json).mock.calls.length
 for(const [source,parent] of [[account,personal],[account,JSON.stringify({fileId:'other',familyId:'9007199254740999'})],[{...account,id:'other'},family],[{...account,userId:'another'},family]] as const)await expect(cloud189.list(source,parent,first.nextCursor)).rejects.toThrow()
 expect(json).toHaveBeenCalledTimes(calls)
})
it('rejects nonadjacent repeated IDs and duplicate IDs within a page',async()=>{
 files=Array.from({length:100},(_,index)=>({...movie,id:'first-'+index}));const first=await cloud189.list(account,personal),original=files
 files=Array.from({length:100},(_,index)=>({...movie,id:'second-'+index}));const second=await cloud189.list(account,personal,first.nextCursor)
 files=original;await expect(cloud189.list(account,personal,second.nextCursor)).rejects.toThrow('重复文件')
 files=[movie,movie];await expect(cloud189.list(account,personal)).rejects.toThrow('重复文件')
})
it('discards results after account deletion or owner replacement',async()=>{
 vi.mocked(json).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[];return {fileListAO:{fileList:files}}})
 await expect(cloud189.list(account,personal)).rejects.toThrow('账号')
 useFileSourcesStore().accounts=[account]
 vi.mocked(json).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'another'}];return {fileListAO:{fileList:files}}})
 await expect(cloud189.list(account,personal)).rejects.toThrow('身份')
})
it('preserves original fileId aliases when id is absent or empty',async()=>{
 files=[{...movie,id:'',fileId:'alternate'}];expect(JSON.parse((await cloud189.list(account,personal)).entries[0]!.id).fileId).toBe('alternate')
})
it('keeps thumbnail and creation-time fallback from the original mapper',async()=>{
 files=[{...movie,lastOpTime:undefined,icon:{mediumUrl:'https://fixture.test/medium'}}]
 const row=(await cloud189.list(account,personal)).entries[0] as any
 expect(row.modified).toBe(Date.parse(movie.createDate));expect(row.electronModel.thumbnail).toBe('https://fixture.test/medium')
})

it('does not silently accept a physical-directory cursor in either aggregate view',async()=>{
 files=Array.from({length:100},(_,index)=>({...movie,id:'page-'+index}));const first=await cloud189.list(account,personal),calls=vi.mocked(json).mock.calls.length
 await expect(cloud189.list(account,'',first.nextCursor)).rejects.toThrow('分页游标')
 await expect(cloud189.list(account,JSON.stringify({fileId:'',families:true}),first.nextCursor)).rejects.toThrow('分页游标')
 expect(json).toHaveBeenCalledTimes(calls)
})
