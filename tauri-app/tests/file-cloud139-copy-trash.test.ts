import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {json,SourceHttpError} from '@/features/sources/transport'
import {copyCloud139File,trashCloud139File,pendingCloud139Trash,acknowledgeCloud139Trash} from '@/features/files/drive/cloud139BatchMutations'
import {supportsRemoteCopy} from '@/features/files/drive/relocationMutations'
import {supportsRemoteTrashMove,supportsRemoteTrash,mutateTrash} from '@/features/files/drive/trashMutations'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn()}))
let account:any,count=0,removed:boolean,copies:any[],apply:boolean,current:boolean,folder:boolean,refusal:boolean
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());account={id:'batch139-'+(++count),providerId:'139',name:'Fixture',baseUrl:'https://personal.yun.139.com/hcy',userId:'owner',authOrigins:[]};useFileSourcesStore().accounts=[account]
 removed=false;copies=[];apply=true;current=true;folder=false;refusal=false
 vi.mocked(json).mockImplementation(async(_account,_method,url,body:any)=>{
  if(url.endsWith('/batchCopy')||url.endsWith('/batchTrash')){
   if(refusal)throw new SourceHttpError(403,'denied')
   if(apply){if(url.endsWith('/batchTrash'))removed=true;else copies=[{fileId:'copied',name:'Movie.mkv',type:folder?'folder':'file',size:42}]}
   return {success:true}
  }
  const parent=body.parentFileId
  return {data:{items:parent==='/'?[{fileId:'target',name:'Target',type:'folder'}]:parent==='old'?!removed?[{fileId:'movie',name:'Movie.mkv',type:folder?'folder':'file',size:42}]:[]:parent==='target'?copies:[]}}
 })
})
const file=()=>({file_id:'movie',parent_file_id:'old',name:'Movie.mkv',isDir:folder,drive_id:account.id} as any)
const copy=()=>copyCloud139File(account,file(),'target',()=>current,['','target'])
const trash=()=>trashCloud139File(account,file(),()=>current)
const writes=(kind:'copy'|'trash')=>vi.mocked(json).mock.calls.filter(call=>call[2].endsWith(kind==='copy'?'/batchCopy':'/batchTrash'))
it.each([false,true])('retains original copy body for directory=%s',async directory=>{
 folder=directory;expect(supportsRemoteCopy(account)).toBe(true);expect(await copy()).toEqual(['movie'])
 expect(writes('copy')[0]).toEqual([account,'POST',account.baseUrl+'/file/batchCopy',{fileIds:['movie'],parentFileId:'target'}]);expect(removed).toBe(false)
})
it.each([false,true])('retains original recycle body for directory=%s',async directory=>{
 folder=directory;expect(supportsRemoteTrashMove(account)).toBe(true);expect(supportsRemoteTrash(account)).toBe(false);expect(await trash()).toBe(true)
 expect(writes('trash')[0]).toEqual([account,'POST',account.baseUrl+'/recyclebin/batchTrash',{fileIds:['movie']}]);expect(pendingCloud139Trash(account)).toHaveLength(1)
 acknowledgeCloud139Trash(account.id,'movie');expect(pendingCloud139Trash(account)).toEqual([])
})
it('does not trust accepted copy or trash until actual directory state matches',async()=>{
 apply=false;await expect(copy()).rejects.toThrow('尚未确认');copies=[{fileId:'copied',name:'Movie.mkv',type:'file',size:42}];expect(await copy()).toEqual(['movie']);expect(writes('copy')).toHaveLength(1)
 await expect(trash()).rejects.toThrow('尚未确认');removed=true;expect(await trash()).toBe(true);expect(writes('trash')).toHaveLength(1)
})
it.each(['copy','trash'] as const)('keeps %s submission unknown after a lost receipt even when external state changes',async kind=>{
 const original=vi.mocked(json).getMockImplementation()!;vi.mocked(json).mockImplementation(async(...args)=>args[2].endsWith(kind==='copy'?'/batchCopy':'/batchTrash')?Promise.reject(Error('lost response')):original(...args))
 const run=kind==='copy'?copy:trash;await expect(run()).rejects.toThrow('尚未确认')
 if(kind==='copy')copies=[{fileId:'copied',name:'Movie.mkv',type:'file',size:42}];else removed=true
 await expect(run()).rejects.toThrow('尚未确认');expect(writes(kind)).toHaveLength(1)
})
it.each(['copy','trash'] as const)('allows intentional %s retry only after definite refusal',async kind=>{
 refusal=true;const run=kind==='copy'?copy:trash;await expect(run()).rejects.toThrow('denied');refusal=false;await run();expect(writes(kind)).toHaveLength(2)
})
it('rejects preexisting copy conflict and ambiguous new identities',async()=>{
 copies=[{fileId:'existing',name:'Movie.mkv',type:'file',size:42}];await expect(copy()).rejects.toThrow('同名');expect(writes('copy')).toHaveLength(0)
 copies=[];apply=false;await expect(copy()).rejects.toThrow('尚未确认');copies=[{fileId:'c1',name:'Movie.mkv',type:'file',size:42},{fileId:'c2',name:'Movie.mkv',type:'file',size:42}];await expect(copy()).rejects.toThrow('尚未确认')
})
it('does not mark a copy successful when original disappears or copied size mismatches',async()=>{
 apply=false;await expect(copy()).rejects.toThrow('尚未确认');copies=[{fileId:'copied',name:'Movie.mkv',type:'file',size:43}];await expect(copy()).rejects.toThrow('尚未确认')
 copies[0].size=42;removed=true;await expect(copy()).rejects.toThrow('尚未确认')
})
it.each(['copy','trash'] as const)('retains the accepted %s receipt on close without updating the closed page',async kind=>{
 const original=vi.mocked(json).getMockImplementation()!;vi.mocked(json).mockImplementation(async(...args)=>{const result=await original(...args);if(args[2].endsWith(kind==='copy'?'/batchCopy':'/batchTrash'))current=false;return result})
 const run=kind==='copy'?copy:trash;await expect(run()).rejects.toThrow('切换');current=true;await run();expect(writes(kind)).toHaveLength(1)
})
it('does not try another mutation route after source closure on a missing primary route',async()=>{
 vi.mocked(json).mockImplementation(async(_account,_method,url,body:any)=>{
  if(url.endsWith('/batchTrash')){current=false;throw new SourceHttpError(404,'not found')}
  return {data:{items:[{fileId:'movie',name:'Movie.mkv',type:'file',size:42}]}}
 })
 await expect(trash()).rejects.toThrow('切换');expect(writes('trash')).toHaveLength(1)
})
it('preserves original primary/fallback route behavior when the source remains active',async()=>{
 const original=vi.mocked(json).getMockImplementation()!;vi.mocked(json).mockImplementation(async(...args)=>args[2]===account.baseUrl+'/recyclebin/batchTrash'?Promise.reject(new SourceHttpError(404,'not found')):original(...args))
 expect(await trash()).toBe(true);expect(writes('trash').map(call=>call[2])).toEqual([account.baseUrl+'/recyclebin/batchTrash','https://personal.yun.139.com/orchestration/recyclebin/batchTrash'])
})
it('coalesces same-operation requests and prevents conflicting mutations',async()=>{
 expect(await Promise.all([trash(),trash()])).toEqual([true,true]);expect(writes('trash')).toHaveLength(1)
 await expect(copy()).rejects.toThrow('此前操作')
 const {renameRemoteFile}=await import('@/features/files/drive/renameMutations');await expect(renameRemoteFile(account,file(),'New.mkv')).rejects.toThrow('此前操作')
})
it('rejects stale source names and source descendant copy paths before submitting',async()=>{
 await expect(copyCloud139File(account,{...file(),name:'Changed.mkv'},'target',()=>current,['','target'])).rejects.toThrow('已变化')
 await expect(copyCloud139File(account,{...file(),isDir:true},'target',()=>current,['','movie','target'])).rejects.toThrow('内部');expect(writes('copy')).toHaveLength(0)
})
it('keeps original unsupported permanent/restore operations closed',async()=>{
 for(const operation of ['permanent','restore','purge'] as const)await expect(mutateTrash(account,[file()],operation,()=>current)).rejects.toThrow('不支持')
})
it.each(['rename','move','folder'] as const)('also stops original %s fallback after source closure',async operation=>{
 const endpoint=operation==='rename'?'/file/update':operation==='move'?'/file/batchMove':'/file/create'
 const original=vi.mocked(json).getMockImplementation()!
 vi.mocked(json).mockImplementation(async(...args)=>{
  if(args[2].endsWith(endpoint)){current=false;throw new SourceHttpError(404,'not found')}
  return original(...args)
 })
 let task:Promise<unknown>
 if(operation==='rename'){const {renameRemoteFile}=await import('@/features/files/drive/renameMutations');task=renameRemoteFile(account,file(),'New.mkv',()=>current)}
 else if(operation==='move'){const {moveCloud139File}=await import('@/features/files/drive/cloud139Move');task=moveCloud139File(account,file(),'target',()=>current,['','target'])}
 else{const {createRemoteFolder}=await import('@/features/files/drive/folderMutations');task=createRemoteFolder(account,'old','New',()=>current)}
 await expect(task).rejects.toThrow('切换')
 expect(vi.mocked(json).mock.calls.filter(call=>call[2].endsWith(endpoint))).toHaveLength(1)
})
