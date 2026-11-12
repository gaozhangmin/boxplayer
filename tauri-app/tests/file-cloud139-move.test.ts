import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {json,SourceHttpError} from '@/features/sources/transport'
import {relocateRemoteFiles,supportsRemoteCopy,supportsRemoteRelocation} from '@/features/files/drive/relocationMutations'
import {renameRemoteFile} from '@/features/files/drive/renameMutations'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
import type {Account} from '@/features/sources/contracts'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn()}))
let account:Account,moved:boolean,accept:boolean,current:boolean,count=0,targetType:string
const file={file_id:'movie',parent_file_id:'old',name:'Movie.mkv',isDir:false} as IAliGetFileModel
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());moved=false;accept=true;current=true;targetType='folder'
 account={id:'move139-'+(++count),providerId:'139',name:'Fixture',baseUrl:'https://personal.yun.139.com/hcy',userId:'owner',authOrigins:[]};file.drive_id=account.id;useFileSourcesStore().accounts=[account]
 vi.mocked(json).mockImplementation(async(_account,_method,url,body:any)=>{
  if(url.endsWith('/batchMove')){if(accept)moved=true;return {success:true}}
  const parent=body.parentFileId
  const items=parent==='/'?[{fileId:'target',name:'Target',type:targetType},{fileId:'old',name:'Old',type:'folder'}]:parent==='old'?!moved?[{fileId:'movie',name:file.name,type:'file'}]:[]:parent==='target'&&moved?[{fileId:'movie',name:file.name,type:'file'}]:[]
  return {data:{items}}
 })
})
const move=(destination='target',ancestors=['','target'])=>relocateRemoteFiles(account,[file],destination,false,()=>current,ancestors)
const posts=()=>vi.mocked(json).mock.calls.filter(call=>call[2].endsWith('/batchMove'))
it('retains the original batch body and confirms matching target plus absent source',async()=>{
 expect(supportsRemoteRelocation(account)).toBe(true);expect(supportsRemoteCopy(account)).toBe(true)
 expect(await move()).toEqual({success:['movie'],failures:[]})
 expect(posts()[0]).toEqual([account,'POST',account.baseUrl+'/file/batchMove',{fileIds:['movie'],parentFileId:'target'}])
 const reads=vi.mocked(json).mock.calls.filter(call=>call[2].endsWith('/file/list')).map(call=>(call[3] as any).parentFileId)
 expect(reads).toEqual(['old','/','/','target','old','/'])
})
it('only queries after an accepted but not yet observable move',async()=>{
 accept=false;expect((await move()).success).toEqual([]);expect(posts()).toHaveLength(1)
 moved=true;expect((await move()).success).toEqual(['movie']);expect(posts()).toHaveLength(1)
})
it('confirms an ambiguous network result without reposting',async()=>{
 const original=vi.mocked(json).getMockImplementation()!
 vi.mocked(json).mockImplementation(async(...args)=>{if(args[2].endsWith('/batchMove')){moved=true;throw Error('disconnected')}return original(...args)})
 expect((await move()).success).toEqual(['movie']);expect(posts()).toHaveLength(1)
})
it.each(['file','missing'])('does not submit to an unconfirmed target type %s',async type=>{
 targetType=type==='file'?'file':'folder';const original=vi.mocked(json).getMockImplementation()!
 if(type==='missing')vi.mocked(json).mockImplementation(async(...args)=>(args[3] as any).parentFileId==='/'?{data:{items:[]}}:original(...args))
 expect((await move()).success).toEqual([]);expect(posts()).toHaveLength(0)
})
it('rejects a changed hierarchy after submission instead of trusting the old picker path',async()=>{
 const original=vi.mocked(json).getMockImplementation()!
 vi.mocked(json).mockImplementation(async(...args)=>{if(moved&&(args[3] as any).parentFileId==='/')return {data:{items:[]}};return original(...args)})
 expect((await move()).success).toEqual([]);expect(posts()).toHaveLength(1)
})
it('does not accept a stale source listing as a completed move',async()=>{
 const original=vi.mocked(json).getMockImplementation()!
 vi.mocked(json).mockImplementation(async(...args)=>moved&&(args[3] as any).parentFileId==='old'?{data:{items:[{fileId:'movie',name:file.name,type:'file'}]}}:original(...args))
 expect((await move()).success).toEqual([])
})
it.each(['wrong-name','wrong-type','wrong-id'])('rejects conflicting target metadata %s',async patch=>{
 const original=vi.mocked(json).getMockImplementation()!
 vi.mocked(json).mockImplementation(async(...args)=>moved&&(args[3] as any).parentFileId==='target'?{data:{items:[{fileId:patch==='wrong-id'?'other':'movie',name:patch==='wrong-name'?'Other.mkv':file.name,type:patch==='wrong-type'?'folder':'file'}]}}:original(...args))
 expect((await move()).success).toEqual([])
})
it('rejects same parent, self, descendants and missing picker context before submitting',async()=>{
 expect((await move('old',['','old'])).success).toEqual([])
 const folder={...file,isDir:true}
 expect((await relocateRemoteFiles(account,[folder],'movie',false,()=>true,['','movie'])).success).toEqual([])
 expect((await relocateRemoteFiles(account,[folder],'target',false,()=>true,['','movie','target'])).success).toEqual([])
 expect((await relocateRemoteFiles(account,[file],'target',false,()=>true)).success).toEqual([]);expect(posts()).toHaveLength(0)
})
it('stops before writing when the source changes during hierarchy verification',async()=>{
 const original=vi.mocked(json).getMockImplementation()!
 vi.mocked(json).mockImplementation(async(...args)=>{const result=await original(...args);if((args[3] as any).parentFileId==='/')current=false;return result})
 expect((await move()).success).toEqual([]);expect(posts()).toHaveLength(0)
})
it('blocks rename and a different destination while the old move is unknown',async()=>{
 accept=false;await move()
 await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('此前操作')
 expect((await move('/',[''])).success).toEqual([]);expect(posts()).toHaveLength(1)
})
it('does not confirm an account owner replacement after submission',async()=>{
 const original=vi.mocked(json).getMockImplementation()!
 vi.mocked(json).mockImplementation(async(...args)=>{const result=await original(...args);if(args[2].endsWith('/batchMove'))useFileSourcesStore().accounts=[{...account,userId:'different'}];return result})
 expect((await move()).success).toEqual([])
})
it('coalesces duplicate calls before preflight finishes',async()=>{
 const first=move(),second=move();expect((await Promise.all([first,second])).map(row=>row.success)).toEqual([['movie'],['movie']]);expect(posts()).toHaveLength(1)
})

it.each(['business',400,401,403,409,429])('releases explicit move refusal %s for an intentional retry',async failure=>{
 const original=vi.mocked(json).getMockImplementation()!;let rejected=true
 vi.mocked(json).mockImplementation(async(...args)=>{
  if(rejected&&args[2].endsWith('/batchMove')){if(failure==='business')return {success:false,code:'9008'};throw new SourceHttpError(failure as number,'refused')}
  return original(...args)
 })
 expect((await move()).success).toEqual([]);expect(posts()).toHaveLength(1)
 rejected=false;expect((await move()).success).toEqual(['movie']);expect(posts()).toHaveLength(2)
})
it.each([408,500])('retains uncertain HTTP %s and never automatically submits again',async status=>{
 const original=vi.mocked(json).getMockImplementation()!
 vi.mocked(json).mockImplementation(async(...args)=>{if(args[2].endsWith('/batchMove'))throw new SourceHttpError(status,'uncertain');return original(...args)})
 expect((await move()).success).toEqual([]);expect((await move()).success).toEqual([]);expect(posts()).toHaveLength(1)
 moved=true;expect((await move()).success).toEqual(['movie']);expect(posts()).toHaveLength(1)
})

it('tries only alternate missing routes and releases a terminal 404 for a later intentional retry',async()=>{
 const original=vi.mocked(json).getMockImplementation()!;let missing=true
 vi.mocked(json).mockImplementation(async(...args)=>{if(missing&&args[2].endsWith('/batchMove'))throw new SourceHttpError(404,'missing');return original(...args)})
 expect((await move()).success).toEqual([]);expect(posts()).toHaveLength(2)
 missing=false;expect((await move()).success).toEqual(['movie']);expect(posts()).toHaveLength(3)
})
