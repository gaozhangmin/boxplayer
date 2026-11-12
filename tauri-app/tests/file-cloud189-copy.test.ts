import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {copyCloud189File} from '@/features/files/drive/cloud189Copy'
import {relocateRemoteFiles,supportsRemoteCopy} from '@/features/files/drive/relocationMutations'
import {rawRequest,json} from '@/features/sources/transport'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),rawRequest:vi.fn(),json:vi.fn()}))
const response=(value:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(value))),finalUrl:''})
const native=(fileId:string,familyId?:string)=>JSON.stringify({fileId,...(familyId?{familyId}:{})})
let account:any,count=0,copies:any[],apply:boolean,current:boolean,family:string|undefined,folder:boolean,status:number,state:any,sourcePresent:boolean,copySize:number
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());account={id:'copy189-'+(++count),providerId:'189',name:'Fixture',baseUrl:'https://api.cloud.189.cn',userId:'owner',authOrigins:[]};useFileSourcesStore().accounts=[account]
 copies=[];apply=true;current=true;family=undefined;folder=false;status=200;state={taskStatus:4};sourcePresent=true;copySize=42
 vi.mocked(json).mockImplementation(async(_account,_method,url)=>{
  const parsed=new URL(url),parent=parsed.searchParams.get('folderId')
  if(parsed.pathname==='/family/manage/getFamilyList.action')return {familyInfoResp:[{familyId:family}]}
  const folders=parent===(family?'':'-11')?[{id:'target',name:'Target'}]:[]
  const items=parent==='target'?copies:parent===(family?'':'-11')&&sourcePresent?[{id:'9007199254740997',name:'Movie.mkv',size:42}]:[]
  return {fileListAO:{folderList:[...folders,...(folder?items:[])],fileList:folder?[]:items}}
 })
 vi.mocked(rawRequest).mockImplementation(async(_account,_method,url)=>{
  if(url.endsWith('createBatchTask.action'))return response({taskId:'9007199254740998'},status)
  if(apply&&Number(state.taskStatus)===4)copies=[{id:'9007199254740996',name:'Movie.mkv',size:copySize}]
  return response(state)
 })
})
function setup(){const root=native(family?'':'-11',family),target=native('target',family);return {file:{drive_id:account.id,file_id:native('9007199254740997',family),parent_file_id:root,name:'Movie.mkv',isDir:folder} as any,target,path:['',...(family?[JSON.stringify({fileId:'',families:true})]:[]),root,target]}}
it.each([{f:false,d:false},{f:false,d:true},{f:true,d:false},{f:true,d:true}])('retains COPY form for family=$f directory=$d and confirms a new identity',async({f,d})=>{
 family=f?'9007199254740999':undefined;folder=d;const {file,target,path}=setup()
 expect(supportsRemoteCopy(account)).toBe(true)
 expect((await relocateRemoteFiles(account,[file],target,true,()=>current,path)).success).toEqual([file.file_id])
 expect(Object.fromEntries(new URLSearchParams(vi.mocked(rawRequest).mock.calls[0][3]))).toEqual({type:'COPY',taskInfos:JSON.stringify([{fileId:'9007199254740997',fileName:'Movie.mkv',isFolder:d?1:0}]),targetFolderId:'target',...(family?{familyId:family}:{})})
 expect(Object.fromEntries(new URLSearchParams(vi.mocked(rawRequest).mock.calls[1][3]))).toEqual({type:'COPY',taskId:'9007199254740998'})
 expect(sourcePresent).toBe(true)
})
it('waits for actual copy visibility after a confirmed task without creating or polling again',async()=>{
 apply=false;const {file,target,path}=setup();await expect(copyCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认')
 copies=[{id:'9007199254740996',name:'Movie.mkv',size:42}]
 expect(await copyCloud189File(account,file,target,()=>current,path)).toEqual([file.file_id]);expect(rawRequest).toHaveBeenCalledTimes(2)
})
it('rejects existing same-name destinations before submitting and permits retry after conflict removal',async()=>{
 copies=[{id:'existing',name:'Movie.mkv',size:42}];const {file,target,path}=setup()
 await expect(copyCloud189File(account,file,target,()=>current,path)).rejects.toThrow('同名');expect(rawRequest).not.toHaveBeenCalled()
 copies=[];expect(await copyCloud189File(account,file,target,()=>current,path)).toEqual([file.file_id])
})
it('does not infer copy success from a new file without a confirmed task',async()=>{
 vi.mocked(rawRequest).mockRejectedValue(Error('lost create'));const {file,target,path}=setup();await expect(copyCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认')
 copies=[{id:'external',name:'Movie.mkv',size:42}];await expect(copyCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认');expect(rawRequest).toHaveBeenCalledOnce()
})
it('resumes the original task after a lost polling response',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;let first=true
 vi.mocked(rawRequest).mockImplementation(async(...args)=>{if(args[2].endsWith('checkBatchTask.action')&&first){first=false;throw Error('lost poll')}return original(...args)})
 const {file,target,path}=setup();await expect(copyCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认')
 expect(await copyCloud189File(account,file,target,()=>current,path)).toEqual([file.file_id]);expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(1)
})
it.each([403,409,429])('releases definite create refusal HTTP %s for intentional retry',async denied=>{
 status=denied;const {file,target,path}=setup();await expect(copyCloud189File(account,file,target,()=>current,path)).rejects.toThrow('拒绝')
 status=200;expect(await copyCloud189File(account,file,target,()=>current,path)).toEqual([file.file_id]);expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(2)
})
it('rejects a skipped task even when an unrelated matching file appears',async()=>{
 state={taskStatus:4,skipCount:1};const {file,target,path}=setup();await expect(copyCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认')
})
it('requires the original source to remain present',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementation(async(...args)=>{const result=await original(...args);if(args[2].endsWith('checkBatchTask.action'))sourcePresent=false;return result})
 const {file,target,path}=setup();await expect(copyCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认')
})
it('rejects mismatched size and ambiguous new identities after task success',async()=>{
 copySize=43;const {file,target,path}=setup();await expect(copyCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认')
 copies=[{id:'copy1',name:'Movie.mkv',size:42},{id:'copy2',name:'Movie.mkv',size:42}];await expect(copyCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认')
 expect(rawRequest).toHaveBeenCalledTimes(2)
})
it('rejects copying into another space or a source descendant before submission',async()=>{
 const {file,target,path}=setup();await expect(copyCloud189File(account,file,native('target','9'),()=>current,path)).rejects.toThrow('空间不匹配')
 await expect(copyCloud189File(account,{...file,isDir:true},target,()=>current,['',file.file_id,target])).rejects.toThrow('内部');expect(rawRequest).not.toHaveBeenCalled()
})
it('coalesces simultaneous identical requests',async()=>{
 const {file,target,path}=setup();const results=await Promise.all([copyCloud189File(account,file,target,()=>current,path),copyCloud189File(account,file,target,()=>current,path)])
 expect(results[0]).toEqual(results[1]);expect(rawRequest).toHaveBeenCalledTimes(2)
})
it('retains a returned task ID when the source closes before its create response is consumed',async()=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementationOnce(async(...args)=>{const result=await original(...args);current=false;return result})
 const {file,target,path}=setup();await expect(copyCloud189File(account,file,target,()=>current,path)).rejects.toThrow('切换')
 current=true;expect(await copyCloud189File(account,file,target,()=>current,path)).toEqual([file.file_id]);expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(1)
})
it('prevents rename or move while a copy remains unconfirmed',async()=>{
 apply=false;const {file,target,path}=setup();await expect(copyCloud189File(account,file,target,()=>current,path)).rejects.toThrow('尚未确认')
 const {renameRemoteFile}=await import('@/features/files/drive/renameMutations'),{moveCloud189File}=await import('@/features/files/drive/cloud189Move')
 await expect(renameRemoteFile(account,file,'Other.mkv')).rejects.toThrow('此前操作')
 await expect(moveCloud189File(account,file,target,()=>current,path)).rejects.toThrow('此前操作')
})
