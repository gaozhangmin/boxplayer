import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {renameRemoteFile} from '@/features/files/drive/renameMutations'
import {ApiRenameBatch} from '@/features/files/drive/electron/providers/aliFileCmd'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(row:{body:number[]})=>new TextDecoder().decode(new Uint8Array(row.body))}))
const {pane}=vi.hoisted(()=>({pane:{sourceId:'open',context:0,file:vi.fn()}}))
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>pane}))
const account={id:'open',providerId:'alipan-open' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId})
const file={file_id:id('drive','file'),drive_id:'open',parent_file_id:id('drive','root'),name:'Old.mkv',isDir:false}
const response=(data:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let actual:string,patch:any
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];pane.context++;pane.sourceId=account.id;pane.file.mockReturnValue(file);actual='Old.mkv';patch={}
 vi.mocked(request).mockImplementation(async(_account,_method,url,body)=>{
  const input=JSON.parse(body!);if(url.endsWith('/update')){actual=input.name;return response({})}
  return response({file_id:input.file_id,drive_id:input.drive_id,parent_file_id:'root',name:actual,type:'file',...patch})
 })
})
it('adapts the original rename builder to fixed open get/update/get with refuse semantics',async()=>{
 expect(await renameRemoteFile(account,file,'New.mkv')).toEqual({file_id:file.file_id,parent_file_id:file.parent_file_id,name:'New.mkv',isDir:false})
 expect(vi.mocked(request).mock.calls.map(call=>call[2])).toEqual(['get','update','get'].map(path=>'https://openapi.alipan.com/adrive/v1.0/openFile/'+path))
 expect(JSON.parse(vi.mocked(request).mock.calls[1]![3]!)).toEqual({drive_id:'drive',file_id:'file',name:'New.mkv',check_name_mode:'refuse'})
})
it.each([{file_id:'wrong'},{drive_id:'wrong'},{parent_file_id:'wrong'},{type:'folder'},{name:'stale'},{trashed:true},{code:'InvalidToken'}])('does not write after an incompatible preflight %j',async value=>{
 patch=value;await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('已变化');expect(request).toHaveBeenCalledTimes(1)
})
it('does not report completion solely from a successful update response',async()=>{
 vi.mocked(request).mockImplementation(async(_account,_method,url)=>response(url.endsWith('/update')?{}:{file_id:'file',drive_id:'drive',parent_file_id:'root',name:'Old.mkv',type:'file'}))
 await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('未确认')
})
it('stops before update on same-ID account replacement during preflight',async()=>{
 vi.mocked(request).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'other'}];return response({})})
 await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('账号已变化');expect(request).toHaveBeenCalledTimes(1)
})
it('stops before detail verification on a pane switch after update',async()=>{
 vi.mocked(request).mockImplementation(async(_account,_method,url)=>{if(url.endsWith('/update')){pane.context++;return response({})}return response({file_id:'file',drive_id:'drive',parent_file_id:'root',name:'Old.mkv',type:'file'})})
 await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('已切换');expect(request).toHaveBeenCalledTimes(2)
})
it('does not submit a cancelled caller or stale selected type',async()=>{
 await expect(renameRemoteFile(account,file,'New.mkv',()=>false)).rejects.toThrow('已切换');expect(request).not.toHaveBeenCalled()
 await expect(renameRemoteFile(account,{...file,isDir:true},'New.mkv')).rejects.toThrow('身份已变化');expect(request).not.toHaveBeenCalled()
})
it('retains the original batch success mapping for a partial open response',async()=>{
 pane.file.mockImplementation((encoded:string)=>({...file,file_id:encoded}))
 vi.mocked(request).mockImplementation(async(_account,_method,url,body)=>{
  const input=JSON.parse(body!);if(url.endsWith('/update'))return response(input.file_id==='other'?{code:'AlreadyExists'}:{})
  return response({file_id:input.file_id,drive_id:'drive',parent_file_id:'root',name:input.file_id==='file'&&vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/update')).length?'New.mkv':'Old.mkv',type:'file'})
 })
 const rows=await ApiRenameBatch(account.id,'drive',['file','other'],['New.mkv','Other.mkv'])
 expect(rows.map(row=>row.file_id)).toEqual(['file']);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/update'))).toHaveLength(2)
})
it('stops the original caller before update when its generation changes without replacing the pane',async()=>{
 let current=true;vi.mocked(request).mockImplementationOnce(async()=>{current=false;return response({file_id:'file',drive_id:'drive',parent_file_id:'root',name:'Old.mkv',type:'file'})})
 await expect(renameRemoteFile(account,file,'New.mkv',()=>current)).rejects.toThrow('已切换');expect(request).toHaveBeenCalledTimes(1)
})
it('rejects an old Account object before issuing requests for a same-ID replacement',async()=>{
 useFileSourcesStore().accounts=[{...account,userId:'other'}]
 await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('账号已变化');expect(request).not.toHaveBeenCalled()
})
