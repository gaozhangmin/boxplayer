import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {trashCloud189File,acknowledgeCloud189Trash,pendingCloud189Trash} from '@/features/files/drive/cloud189Trash'
import {mutateTrash,supportsRemoteTrashMove,supportsRemoteTrash,supportsRemoteTrashDelete,supportsRemoteTrashRestore,supportsRemoteTrashEmpty} from '@/features/files/drive/trashMutations'
import {rawRequest,json} from '@/features/sources/transport'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),rawRequest:vi.fn(),json:vi.fn()}))
const response=(value:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(value))),finalUrl:''})
const native=(fileId:string,familyId?:string)=>JSON.stringify({fileId,...(familyId?{familyId}:{})})
let account:any,count=0,removed:boolean,apply:boolean,current:boolean,family:string|undefined,folder:boolean,status:number,state:any
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());account={id:'trash189-'+(++count),providerId:'189',name:'Fixture',baseUrl:'https://api.cloud.189.cn',userId:'owner',authOrigins:[]};useFileSourcesStore().accounts=[account]
 removed=false;apply=true;current=true;family=undefined;folder=false;status=200;state={taskStatus:4}
 vi.mocked(json).mockImplementation(async()=>({fileListAO:{folderList:!removed&&folder?[{id:'9007199254740997',name:'Movie.mkv'}]:[],fileList:!removed&&!folder?[{id:'9007199254740997',name:'Movie.mkv',size:42}]:[]}}))
 vi.mocked(rawRequest).mockImplementation(async(_account,_method,url)=>{
  if(url.endsWith('createBatchTask.action'))return response({taskId:'9007199254740998'},status)
  if(apply&&Number(state.taskStatus)===4)removed=true
  return response(state)
 })
})
function setup(){return {drive_id:account.id,file_id:native('9007199254740997',family),parent_file_id:native(family?'':'-11',family),name:'Movie.mkv',isDir:folder} as any}
it.each([{f:false,d:false},{f:false,d:true},{f:true,d:false},{f:true,d:true}])('retains original DELETE task form in family=$f directory=$d',async({f,d})=>{
 family=f?'9007199254740999':undefined;folder=d;const file=setup()
 expect(supportsRemoteTrashMove(account)).toBe(true)
 for(const supports of [supportsRemoteTrash,supportsRemoteTrashDelete,supportsRemoteTrashRestore,supportsRemoteTrashEmpty])expect(supports(account)).toBe(false)
 expect((await mutateTrash(account,[file],'trash',()=>current)).success).toEqual([file.file_id])
 expect(Object.fromEntries(new URLSearchParams(vi.mocked(rawRequest).mock.calls[0][3]))).toEqual({type:'DELETE',taskInfos:JSON.stringify([{fileId:'9007199254740997',fileName:'Movie.mkv',isFolder:d?1:0}]),...(family?{familyId:family}:{})})
 expect(Object.fromEntries(new URLSearchParams(vi.mocked(rawRequest).mock.calls[1][3]))).toEqual({type:'DELETE',taskId:'9007199254740998'})
 expect(pendingCloud189Trash(account)).toHaveLength(1);acknowledgeCloud189Trash(account.id,file.file_id);expect(pendingCloud189Trash(account)).toEqual([])
})
it('does not trust completed task status while the item remains in its original directory',async()=>{
 apply=false;const file=setup();await expect(trashCloud189File(account,file,()=>current)).rejects.toThrow('尚未确认')
 removed=true;expect(await trashCloud189File(account,file,()=>current)).toBe(true);expect(rawRequest).toHaveBeenCalledTimes(2)
})
it('does not infer recycling from absence alone after a lost create response',async()=>{
 vi.mocked(rawRequest).mockRejectedValue(Error('lost create'));const file=setup();await expect(trashCloud189File(account,file,()=>current)).rejects.toThrow('尚未确认')
 removed=true;await expect(trashCloud189File(account,file,()=>current)).rejects.toThrow('尚未确认');expect(rawRequest).toHaveBeenCalledOnce()
})
it('resumes polling the original task after a lost query response',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;let first=true
 vi.mocked(rawRequest).mockImplementation(async(...args)=>{if(args[2].endsWith('checkBatchTask.action')&&first){first=false;throw Error('lost poll')}return original(...args)})
 const file=setup();await expect(trashCloud189File(account,file,()=>current)).rejects.toThrow('尚未确认')
 expect(await trashCloud189File(account,file,()=>current)).toBe(true);expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(1)
})
it.each([403,409,429])('releases definite create refusal HTTP %s for intentional retry',async denied=>{
 status=denied;const file=setup();await expect(trashCloud189File(account,file,()=>current)).rejects.toThrow('拒绝')
 status=200;expect(await trashCloud189File(account,file,()=>current)).toBe(true);expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(2)
})
it('keeps failed/skipped task results unconfirmed even if the item disappeared externally',async()=>{
 state={taskStatus:4,failedCount:1};const file=setup();await expect(trashCloud189File(account,file,()=>current)).rejects.toThrow('尚未确认')
})
it('refuses changed source metadata, virtual roots and cross-space parents before submission',async()=>{
 const file=setup();await expect(trashCloud189File(account,{...file,name:'Changed.mkv'},()=>current)).rejects.toThrow('已变化')
 await expect(trashCloud189File(account,{...file,file_id:native('-11')},()=>current)).rejects.toThrow('标识')
 await expect(trashCloud189File(account,{...file,parent_file_id:native('','9')},()=>current)).rejects.toThrow('空间不匹配');expect(rawRequest).not.toHaveBeenCalled()
})
it('coalesces duplicate requests without reposting a delete task',async()=>{
 const file=setup();expect(await Promise.all([trashCloud189File(account,file,()=>current),trashCloud189File(account,file,()=>current)])).toEqual([true,true]);expect(rawRequest).toHaveBeenCalledTimes(2)
})
it('preserves task identity when the source closes during create response delivery',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementationOnce(async(...args)=>{const value=await original(...args);current=false;return value})
 const file=setup();await expect(trashCloud189File(account,file,()=>current)).rejects.toThrow('切换')
 current=true;expect(await trashCloud189File(account,file,()=>current)).toBe(true);expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(1)
})
it('blocks rename/move/copy until recycling and local sync are acknowledged',async()=>{
 const file=setup();await trashCloud189File(account,file,()=>current)
 const {renameRemoteFile}=await import('@/features/files/drive/renameMutations'),{moveCloud189File}=await import('@/features/files/drive/cloud189Move'),{copyCloud189File}=await import('@/features/files/drive/cloud189Copy')
 await expect(renameRemoteFile(account,file,'Other.mkv')).rejects.toThrow('此前操作')
 await expect(moveCloud189File(account,file,native('target'),()=>current,['',native('-11'),native('target')])).rejects.toThrow('此前操作')
 await expect(copyCloud189File(account,file,native('target'),()=>current,['',native('-11'),native('target')])).rejects.toThrow('此前操作')
})
it('rejects account replacement before returning a remote result',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementationOnce(async(...args)=>{const value=await original(...args);useFileSourcesStore().accounts=[{...account,userId:'other'}];return value})
 await expect(trashCloud189File(account,setup(),()=>current)).rejects.toThrow('身份')
})
it('does not expose unimplemented permanent-delete or restore commands',async()=>{
 for(const operation of ['permanent','restore','purge'] as const)await expect(mutateTrash(account,[setup()],operation,()=>current)).rejects.toThrow('不支持')
 expect(rawRequest).not.toHaveBeenCalled()
})
