import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {relocateRemoteFiles} from '@/features/files/drive/relocationMutations'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(row:{body:number[]})=>new TextDecoder().decode(new Uint8Array(row.body))}))
const {pane}=vi.hoisted(()=>({pane:{sourceId:'source',context:0,file:vi.fn()}}))
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>pane}))
const id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),target=id('drive','target'),response=(body:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(body))),finalUrl:''})
let account:any,file:IAliGetFileModel,serial=0,parent:string,copyDrive:string,copyParent:string,asyncTask:boolean,states:string[],denied:boolean,failTask:boolean,detailPatch:any
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());account={id:'open-relocate-'+ ++serial,providerId:'alipan-open',name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore().accounts=[account];file={file_id:id('drive','movie'),drive_id:account.id,parent_file_id:id('drive','root'),name:'Old.mkv',isDir:false,size:42} as IAliGetFileModel
 pane.context++;pane.sourceId=account.id;pane.file.mockImplementation(value=>value===file.file_id?file:{file_id:value,drive_id:account.id,isDir:true})
 parent='root';copyDrive='drive';copyParent='target';asyncTask=false;states=['Succeed'];denied=false;failTask=false;detailPatch={}
 vi.mocked(request).mockImplementation(async(_account,_method,url,raw)=>{
  const body=JSON.parse(raw!)
  if(url.includes('/async_task/')){if(failTask){failTask=false;throw Error('offline')}return response({state:states.length>1?states.shift():states[0],async_task_id:'task'})}
  if(url.endsWith('/get')){
   if(body.file_id==='target')return response({file_id:'target',drive_id:body.drive_id,parent_file_id:'root',name:'Target',type:'folder'})
   if(body.file_id==='copied')return response({file_id:'copied',drive_id:copyDrive,parent_file_id:copyParent,name:'Copy (1).mkv',type:'file',...detailPatch})
   return response({file_id:'movie',drive_id:'drive',parent_file_id:parent,name:parent==='root'?'Old.mkv':'Moved (1).mkv',type:'file'})
  }
  if(denied)return response({code:'Forbidden'},403)
  const copy=url.endsWith('/copy');if(copy){copyDrive=body.to_drive_id;copyParent=body.to_parent_file_id}else parent=body.to_parent_file_id
  return response({file_id:copy?'copied':'movie',drive_id:copy?copyDrive:'drive',...(asyncTask?{async_task_id:'task'}:{})},asyncTask?202:200)
 })
})
afterEach(()=>vi.useRealTimers())
const writes=()=>vi.mocked(request).mock.calls.filter(call=>/\/(move|copy)$/.test(call[2]))
it('maps original same-drive move to open auto-rename and verifies stable identity and actual name',async()=>{
 expect(await relocateRemoteFiles(account,[file],target,false,()=>true)).toEqual({success:[file.file_id],failures:[],names:{[file.file_id]:'Moved (1).mkv'}})
 expect(JSON.parse(writes()[0]![3]!)).toEqual({drive_id:'drive',file_id:'movie',to_parent_file_id:'target',check_name_mode:'auto_rename'})
 expect(vi.mocked(request).mock.calls.every(call=>call[2].startsWith('https://openapi.alipan.com/adrive/v1.0/openFile/'))).toBe(true)
})
it.each([target,id('backup','root')])('preserves original copy semantics into %s and leaves source intact',async destination=>{
 expect((await relocateRemoteFiles(account,[file],destination,true,()=>true)).success).toEqual([file.file_id]);const location=JSON.parse(destination)
 expect(JSON.parse(writes()[0]![3]!)).toEqual({drive_id:'drive',file_id:'movie',to_drive_id:location.driveId,to_parent_file_id:location.fileId,auto_rename:true});expect(parent).toBe('root')
})
it('waits for the matching task terminal state before target proof',async()=>{
 vi.useFakeTimers();asyncTask=true;states=['Running','Succeed']
 const task=relocateRemoteFiles(account,[file],target,true,()=>true);await vi.advanceTimersByTimeAsync(999)
 expect(vi.mocked(request).mock.calls.some(call=>JSON.parse(call[3]!).file_id==='copied')).toBe(false)
 await vi.advanceTimersByTimeAsync(1);expect((await task).success).toEqual([file.file_id]);expect(writes()).toHaveLength(1)
})
it('resumes the acknowledged task after query failure without rePOSTing copy',async()=>{
 asyncTask=true;failTask=true;expect((await relocateRemoteFiles(account,[file],target,true,()=>true)).success).toEqual([])
 expect((await relocateRemoteFiles(account,[file],target,true,()=>true)).success).toEqual([file.file_id]);expect(writes()).toHaveLength(1)
})
it.each([{file_id:'wrong'},{drive_id:'wrong'},{parent_file_id:'wrong'},{type:'folder'},{name:''},{trashed:true}])('does not accept incompatible copy target metadata %j',async patch=>{
 detailPatch=patch;expect((await relocateRemoteFiles(account,[file],target,true,()=>true)).success).toEqual([])
 detailPatch={};expect((await relocateRemoteFiles(account,[file],target,true,()=>true)).success).toEqual([file.file_id]);expect(writes()).toHaveLength(1)
})
it('allows a fresh explicit attempt after definite rejection',async()=>{
 denied=true;expect((await relocateRemoteFiles(account,[file],target,true,()=>true)).success).toEqual([])
 denied=false;expect((await relocateRemoteFiles(account,[file],target,true,()=>true)).success).toEqual([file.file_id]);expect(writes()).toHaveLength(2)
})
it('does not resubmit an uncertain copy launch',async()=>{
 const original=vi.mocked(request).getMockImplementation()!
 vi.mocked(request).mockImplementation(async(...args)=>{if(args[2].endsWith('/copy'))throw Error('offline');return original(...args)})
 expect((await relocateRemoteFiles(account,[file],target,true,()=>true)).success).toEqual([]);expect((await relocateRemoteFiles(account,[file],target,true,()=>true)).success).toEqual([]);expect(writes()).toHaveLength(1)
})
it('does not treat 202 without task ID as completion or launch again',async()=>{
 const original=vi.mocked(request).getMockImplementation()!
 vi.mocked(request).mockImplementation(async(...args)=>args[2].endsWith('/copy')?response({file_id:'copied',drive_id:'drive'},202):original(...args))
 expect((await relocateRemoteFiles(account,[file],target,true,()=>true)).success).toEqual([]);expect((await relocateRemoteFiles(account,[file],target,true,()=>true)).success).toEqual([]);expect(writes()).toHaveLength(1)
})
it('retains the accepted target when the pane changes after submission and resumes proof only',async()=>{
 const original=vi.mocked(request).getMockImplementation()!
 vi.mocked(request).mockImplementation(async(...args)=>{const value=await original(...args);if(args[2].endsWith('/move'))pane.context++;return value})
 expect((await relocateRemoteFiles(account,[file],target,false,()=>true)).success).toEqual([])
 expect((await relocateRemoteFiles(account,[file],target,false,()=>true)).success).toEqual([file.file_id]);expect(writes()).toHaveLength(1)
})
it('stops before mutation on generation cancellation during source preflight',async()=>{
 let current=true;const original=vi.mocked(request).getMockImplementation()!
 vi.mocked(request).mockImplementationOnce(async(...args)=>{current=false;return original(...args)})
 expect((await relocateRemoteFiles(account,[file],target,true,()=>current)).success).toEqual([]);expect(writes()).toHaveLength(0)
})
it('rejects same-ID replacement accounts without a second mutation',async()=>{
 detailPatch={parent_file_id:'wrong'};await relocateRemoteFiles(account,[file],target,true,()=>true)
 account={...account,userId:'other'};useFileSourcesStore().accounts=[account]
 expect((await relocateRemoteFiles(account,[file],target,true,()=>true)).success).toEqual([]);expect(writes()).toHaveLength(1)
})
it('keeps cross-drive move reconciliation pending before any request',async()=>{
 const output=await relocateRemoteFiles(account,[file],id('backup','root'),false,()=>true);expect(output.success).toEqual([]);expect(output.failures[0]).toContain('跨盘移动');expect(request).not.toHaveBeenCalled()
})
