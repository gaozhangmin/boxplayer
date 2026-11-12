import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {relocateRemoteFiles,supportsRemoteRelocation,supportsRemoteCopy} from '@/features/files/drive/relocationMutations'
import {moveCloud189File} from '@/features/files/drive/cloud189Move'
import {rawRequest,json} from '@/features/sources/transport'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),rawRequest:vi.fn(),json:vi.fn()}))
const response=(value:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(value))),finalUrl:''})
const native=(fileId:string,familyId?:string)=>JSON.stringify({fileId,...(familyId?{familyId}:{})})
let account:any,count=0,moved:boolean,apply:boolean,current:boolean,family:string|undefined,folder:boolean,status:number,state:any
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());account={id:'move189-'+(++count),providerId:'189',name:'Fixture',baseUrl:'https://api.cloud.189.cn',userId:'owner',authOrigins:[]};useFileSourcesStore().accounts=[account]
 moved=false;apply=true;current=true;family=undefined;folder=false;status=200;state={taskStatus:4}
 vi.mocked(json).mockImplementation(async(_account,_method,url)=>{
  const parsed=new URL(url),parent=parsed.searchParams.get('folderId')
  if(parsed.pathname==='/family/manage/getFamilyList.action')return {familyInfoResp:[{familyId:family}]}
  const folders=parent===(family?'':'-11')?[{id:'target',name:'Target'}]:[]
  const source=parent==='target'?moved:parent===(family?'':'-11')&&!moved
  const items=source?[{id:'9007199254740997',name:'Movie.mkv',size:42}]:[]
  return {fileListAO:{folderList:[...folders,...(folder?items:[])],fileList:folder?[]:items}}
 })
 vi.mocked(rawRequest).mockImplementation(async(_account,_method,url)=>{
  if(new URL(url).pathname.endsWith('createBatchTask.action'))return response({taskId:'9007199254740998'},status)
  if(apply&&Number(state.taskStatus)===4)moved=true
  return response(state)
 })
})
function setup(){
 const root=native(family?'':'-11',family),target=native('target',family)
 return {file:{drive_id:account.id,file_id:native('9007199254740997',family),parent_file_id:root,name:'Movie.mkv',isDir:folder} as any,target,path:['',...(family?[JSON.stringify({fileId:'',families:true})]:[]),root,target]}
}
it.each([{f:false,d:false},{f:false,d:true},{f:true,d:false},{f:true,d:true}])('retains original task protocol for family=$f directory=$d',async({f,d})=>{
 family=f?'9007199254740999':undefined;folder=d;const {file,target,path}=setup()
 expect(supportsRemoteRelocation(account)).toBe(true);expect(supportsRemoteCopy(account)).toBe(true)
 expect((await relocateRemoteFiles(account,[file],target,false,()=>current,path)).success).toEqual([file.file_id])
 const calls=vi.mocked(rawRequest).mock.calls;expect(calls).toHaveLength(2)
 expect(calls.every(call=>call[1]==='POST')).toBe(true)
 expect(Object.fromEntries(new URLSearchParams(calls[0][3]))).toEqual({type:'MOVE',taskInfos:JSON.stringify([{fileId:'9007199254740997',fileName:'Movie.mkv',isFolder:d?1:0}]),targetFolderId:'target',...(family?{familyId:family}:{})})
 expect(Object.fromEntries(new URLSearchParams(calls[1][3]))).toEqual({type:'MOVE',taskId:'9007199254740998'})
 expect(calls[0][4]?.['Content-Type']).toBe('application/x-www-form-urlencoded')
})
it('does not trust a finished task when actual directories disagree',async()=>{
 apply=false;const {file,target,path}=setup()
 await expect(moveCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认')
 apply=true;expect(await moveCloud189File(account,file,target,()=>current,path)).toEqual([file.file_id])
 expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(1)
 expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('checkBatchTask.action'))).toHaveLength(2)
})
it('retries only the original task after a lost polling response',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;let first=true
 vi.mocked(rawRequest).mockImplementation(async(...args)=>{if(args[2].endsWith('checkBatchTask.action')&&first){first=false;throw Error('lost poll')}return original(...args)})
 const {file,target,path}=setup();await expect(moveCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认')
 expect(await moveCloud189File(account,file,target,()=>current,path)).toEqual([file.file_id]);expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(1)
})
it('never reposts when submission produced no usable task ID',async()=>{
 vi.mocked(rawRequest).mockRejectedValue(Error('lost submit'));const {file,target,path}=setup()
 await expect(moveCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认')
 await expect(moveCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认');expect(rawRequest).toHaveBeenCalledOnce()
 moved=true;expect(await moveCloud189File(account,file,target,()=>current,path)).toEqual([file.file_id]);expect(rawRequest).toHaveBeenCalledOnce()
})
it.each([403,409,429])('permits intentional retry after definite HTTP %s refusal',async denied=>{
 status=denied;const {file,target,path}=setup();await expect(moveCloud189File(account,file,target,()=>current,path)).rejects.toThrow('拒绝')
 status=200;expect(await moveCloud189File(account,file,target,()=>current,path)).toEqual([file.file_id]);expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(2)
})
it('does not report a conflict or skipped task as successful',async()=>{
 state={taskStatus:2};const {file,target,path}=setup();await expect(moveCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认')
 state={taskStatus:4,failedCount:1,successedFileIdList:[]};apply=false;await expect(moveCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认')
 expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(1)
})
it('rejects cross-space and unverified descendant paths without writing',async()=>{
 const {file,target,path}=setup();await expect(moveCloud189File(account,file,native('target','9'),()=>current,path)).rejects.toThrow('空间不匹配')
 await expect(moveCloud189File(account,{...file,isDir:true},target,()=>current,['',file.file_id,target])).rejects.toThrow('内部')
 await expect(moveCloud189File(account,file,target,()=>current,['',native('-11'),'missing',target])).rejects.toThrow()
 expect(rawRequest).not.toHaveBeenCalled()
})
it('coalesces concurrent same-target operations',async()=>{
 const {file,target,path}=setup();const results=await Promise.all([moveCloud189File(account,file,target,()=>current,path),moveCloud189File(account,file,target,()=>current,path)])
 expect(results[0]).toEqual(results[1]);expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(1)
})
it('cancels before submission if source closes during preflight',async()=>{
 const original=vi.mocked(json).getMockImplementation()!;vi.mocked(json).mockImplementationOnce(async(...args)=>{const value=await original(...args);current=false;return value})
 const {file,target,path}=setup();await expect(moveCloud189File(account,file,target,()=>current,path)).rejects.toThrow('切换');expect(rawRequest).not.toHaveBeenCalled()
 current=true;expect(await moveCloud189File(account,file,target,()=>current,path)).toEqual([file.file_id])
})
it('rejects account replacement after task submission',async()=>{
 vi.mocked(rawRequest).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'other'}];return response({taskId:'task'})})
 const {file,target,path}=setup();await expect(moveCloud189File(account,file,target,()=>current,path)).rejects.toThrow('身份');expect(rawRequest).toHaveBeenCalledOnce()
})
it('blocks rename while a move is waiting for confirmation or catalog sync',async()=>{
 const {renameRemoteFile}=await import('@/features/files/drive/renameMutations'),{acknowledgeCloud189Move}=await import('@/features/files/drive/cloud189Move')
 const {file,target,path}=setup();await moveCloud189File(account,file,target,()=>current,path)
 await expect(renameRemoteFile(account,{...file,parent_file_id:target},'New.mkv')).rejects.toThrow('此前操作')
 acknowledgeCloud189Move(account.id,file.file_id,target)
 const original=vi.mocked(rawRequest).getMockImplementation()!
 vi.mocked(rawRequest).mockImplementation(async(...args)=>new URL(args[2]).pathname.endsWith('renameFile.action')?response({},403):original(...args))
 await expect(renameRemoteFile(account,{...file,parent_file_id:target},'New.mkv')).rejects.toThrow('拒绝重命名')
})
it('blocks move while a previous rename awaits local synchronization',async()=>{
 const {renameRemoteFile}=await import('@/features/files/drive/renameMutations'),{file,target,path}=setup()
 // A same-name rename still produces a retained confirmed receipt; the native
 // preflight and result reads use the actual selected file metadata.
 const original=vi.mocked(rawRequest).getMockImplementation()!
 vi.mocked(rawRequest).mockImplementation(async(...args)=>new URL(args[2]).pathname.endsWith('renameFile.action')?response({}):original(...args))
 await renameRemoteFile(account,file,'Movie.mkv')
 await expect(moveCloud189File(account,file,target,()=>current,path)).rejects.toThrow('此前操作')
 expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(0)
})
it('preserves original delayed progress polling until the actual final state',async()=>{
 vi.useFakeTimers()
 try{
  const original=vi.mocked(rawRequest).getMockImplementation()!;let polls=0
  vi.mocked(rawRequest).mockImplementation(async(...args)=>{if(args[2].endsWith('checkBatchTask.action')&&++polls===1)return response({taskStatus:1});return original(...args)})
  const {file,target,path}=setup(),pending=moveCloud189File(account,file,target,()=>current,path)
  await vi.advanceTimersByTimeAsync(499);expect(moved).toBe(false)
  await vi.advanceTimersByTimeAsync(1);expect(await pending).toEqual([file.file_id]);expect(polls).toBe(2)
 }finally{vi.useRealTimers()}
})
it('keeps a rejected poll query bound to its original task instead of creating another',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;let denied=true
 vi.mocked(rawRequest).mockImplementation(async(...args)=>args[2].endsWith('checkBatchTask.action')&&denied?response({},403):original(...args))
 const {file,target,path}=setup();await expect(moveCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认')
 denied=false;expect(await moveCloud189File(account,file,target,()=>current,path)).toEqual([file.file_id]);expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(1)
})
it('retains an unknown intent after a malformed create-task identity',async()=>{
 vi.mocked(rawRequest).mockResolvedValue(response({taskId:true}))
 const {file,target,path}=setup();await expect(moveCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认')
 await expect(moveCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认');expect(rawRequest).toHaveBeenCalledOnce()
})
