import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {renameRemoteFile} from '@/features/files/drive/renameMutations'
import {apiCloud123RenameBatch} from '@/features/files/drive/batchRenamePorts'
import {getDrivePane} from '@/features/files/drive/ports'
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(v:{body:number[]})=>new TextDecoder().decode(new Uint8Array(v.body))}))
const account={id:'source',providerId:'123' as const,name:'Fixture',baseUrl:'',authOrigins:[]},file={file_id:'12',parent_file_id:'4',isDir:true,name:'Old'},response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let row:any,current:boolean
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];current=true;row={fileId:12,parentFileId:4,type:1,filename:'Old',trashed:0};vi.mocked(request).mockImplementation(async(_a,method,_url,body)=>{if(method==='PUT')row.filename=JSON.parse(body!).fileName;return response({code:0,data:row})})})
it('connects the original 123 batch branch to the bound host and preserves partial receipts',async()=>{
 const action=vi.fn().mockResolvedValue([{file_id:'12',parent_file_id:'4',isDir:true,name:'New'}]);vi.mocked(getDrivePane).mockReturnValue({local:false,sourceId:account.id,account,action} as any)
 expect(await apiCloud123RenameBatch(account.id,['12','13'],['New','Other'])).toEqual([{file_id:'12',parent_file_id:'4',isDir:true,name:'New'}]);expect(action).toHaveBeenCalledWith('renameBatch',[account.id,account.id,['12','13'],['New','Other'],'123-batch'])
})
it('rejects the batch branch for another source before dispatch',async()=>{const action=vi.fn();vi.mocked(getDrivePane).mockReturnValue({local:false,sourceId:'another',account,action} as any);await expect(apiCloud123RenameBatch(account.id,['12'],['New'])).rejects.toThrow('来源');expect(action).not.toHaveBeenCalled()})
it('verifies parent, folder type and resulting name using original single rename protocol',async()=>{expect(await renameRemoteFile(account,file,'New',()=>current)).toEqual({...file,name:'New'});expect(vi.mocked(request).mock.calls.map(c=>c[1])).toEqual(['GET','PUT','GET']);expect(vi.mocked(request).mock.calls[1]![3]).toBe(JSON.stringify({fileId:12,fileName:'New'}))})
it('recovers already renamed items without repeating the mutation',async()=>{row.filename='New';expect(await renameRemoteFile(account,file,'New')).toEqual({...file,name:'New'});expect(request).toHaveBeenCalledTimes(1)})
it.each([{parentFileId:5},{type:0},{fileId:13},{filename:'Changed'},{trashed:1}])('rejects changed remote identity or state %j',async change=>{Object.assign(row,change);await expect(renameRemoteFile(account,file,'New')).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1)})
it('does not write after source changes during detail read',async()=>{vi.mocked(request).mockImplementationOnce(async()=>{current=false;return response({code:0,data:row})});await expect(renameRemoteFile(account,file,'New',()=>current)).rejects.toThrow('已变化');expect(request).toHaveBeenCalledTimes(1)})
it('does not write after same-ID account replacement',async()=>{vi.mocked(request).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,name:'Replacement'}];return response({code:0,data:row})});await expect(renameRemoteFile(account,file,'New')).rejects.toThrow('已变化');expect(request).toHaveBeenCalledTimes(1)})
it('does not acknowledge a successful code with unchanged remote name',async()=>{vi.mocked(request).mockImplementation(async()=>response({code:0,data:row}));await expect(renameRemoteFile(account,file,'New')).rejects.toThrow('未确认');expect(request).toHaveBeenCalledTimes(3)})
