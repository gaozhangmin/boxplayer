import {beforeEach,describe,it,expect,vi} from 'vitest'
import {readAliMoveSnapshot,pairObservedAliMoveNodes} from '@/features/files/drive/aliMoveSnapshot'
import {driver} from '@/features/sources/drivers'
import {ApiFileInfo} from '@/features/files/drive/electron/providers/aliMetadata'
const state=vi.hoisted(()=>({account:{id:'ali',providerId:'aliyun',name:'Fixture',baseUrl:'',authOrigins:[]} as any,pane:{sourceId:'ali',context:1} as any}))
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>state.pane}))
vi.mock('@/features/files/drive/aliFolderTransport',()=>({aliFolderAccount:()=>state.account}))
vi.mock('@/features/files/drive/aliMetadataPorts',()=>({withAliMetadataContext:async(_user:string,check:()=>void,work:()=>Promise<any>)=>{check();const result=await work();check();return result}}))
vi.mock('@/features/files/drive/electron/providers/aliMetadata',()=>({ApiFileInfo:vi.fn()}))
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn()}))
const id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),old=(file:string)=>id('resource',file),next=(file:string)=>id('backup',file)
function entry(file:string,parent:string,isDirectory=false){const name=file+'.mkv',size=isDirectory?0:10;return {id:old(file),name,isDirectory,size,playable:!isDirectory,electronModel:{file_id:old(file),drive_id:'ali',parent_file_id:old(parent),name,isDir:isDirectory,size,content_hash:isDirectory?'':'hash-'+file}}}
let list:ReturnType<typeof vi.fn>
beforeEach(()=>{vi.resetAllMocks();state.account={id:'ali',providerId:'aliyun',name:'Fixture',baseUrl:'',authOrigins:[]};state.pane={sourceId:'ali',context:1};vi.mocked(ApiFileInfo).mockResolvedValue({file_id:'folder',drive_id:'resource',parent_file_id:'root',type:'folder',name:'Folder',size:0});list=vi.fn().mockResolvedValue({entries:[]});vi.mocked(driver).mockReturnValue({list,resolve:vi.fn()})})
const snapshot=()=>readAliMoveSnapshot(state.account,[{id:old('folder'),parent:old('root')}],()=>{})
describe('exhaustive source-bound Ali move observations',()=>{
 it('reads all pages and nested children without changing the source records',async()=>{
  list.mockImplementation(async(_account,path,cursor)=>path===old('folder')?cursor?{entries:[entry('b','folder')]}:{entries:[entry('child','folder',true)],nextCursor:'page2'}:{entries:[entry('a','child')]})
  const result=await snapshot();expect(result.map(row=>row.id)).toEqual([old('folder'),old('child'),old('b'),old('a')]);expect(list.mock.calls.map(call=>[call[1],call[2]])).toEqual([[old('folder'),undefined],[old('folder'),'page2'],[old('child'),undefined]]);expect(result.at(-1)).toMatchObject({parent:old('child'),contentHash:'hash-a',size:10});expect(ApiFileInfo).toHaveBeenCalledWith('ali','resource','folder',true)
 })
 it('rejects repeated pagination markers before claiming a complete snapshot',async()=>{list.mockResolvedValue({entries:[],nextCursor:'same'});await expect(snapshot()).rejects.toThrow('游标重复');expect(list).toHaveBeenCalledTimes(2)})
 it('rejects duplicate rows rather than silently deduplicating an incomplete observation',async()=>{list.mockResolvedValue({entries:[entry('a','folder'),entry('a','folder')]});await expect(snapshot()).rejects.toThrow('重复')})
 it('rejects mismatched actual parent, source and file-type projections',async()=>{list.mockResolvedValue({entries:[entry('a','other')]});await expect(snapshot()).rejects.toThrow('原目录模型身份');list.mockResolvedValue({entries:[{...entry('a','folder'),isDirectory:true}]});await expect(snapshot()).rejects.toThrow('原目录模型身份')})
 it('rejects a selected root that moved before the preflight read',async()=>{vi.mocked(ApiFileInfo).mockResolvedValue({file_id:'folder',drive_id:'resource',parent_file_id:'elsewhere',type:'folder',name:'Folder',size:0});await expect(snapshot()).rejects.toThrow('所选根身份');expect(list).not.toHaveBeenCalled()})
 it('stops before the next page after same-ID account replacement',async()=>{list.mockImplementationOnce(async()=>{state.account={...state.account,userId:'different'};return {entries:[],nextCursor:'page2'}});await expect(snapshot()).rejects.toThrow('账号已变化');expect(list).toHaveBeenCalledOnce()})
 it('rejects virtual roots before invoking metadata or directory APIs',async()=>{await expect(readAliMoveSnapshot(state.account,[{id:old('root'),parent:old('root')}],()=>{})).rejects.toThrow('虚拟盘根');expect(ApiFileInfo).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled()})
})
describe('observed ID matching after an accepted root receipt',()=>{
 const before=[{id:old('folder'),parent:old('root'),name:'Folder',isDirectory:true,size:0},{id:old('video'),parent:old('folder'),name:'same.mkv',isDirectory:false,size:10,contentHash:'sha'}]
 const after=[{id:next('new-folder'),parent:next('target'),name:'Folder (1)',isDirectory:true,size:0},{id:next('video'),parent:next('new-folder'),name:'same.mkv',isDirectory:false,size:10,contentHash:'sha'}]
 it('uses the actual observed descendant ID and explicit renamed-root receipt',()=>{expect(pairObservedAliMoveNodes(before,after,[{from:old('folder'),to:next('new-folder')}],next('target'))).toEqual([{from:old('folder'),to:next('new-folder')},{from:old('video'),to:next('video')}])})
 it('does not guess a renamed descendant ID from identical name/size/hash',()=>{const changed=after.map(row=>({...row}));changed[1]!.id=next('different');expect(()=>pairObservedAliMoveNodes(before,changed,[{from:old('folder'),to:next('new-folder')}],next('target'))).toThrow('不能按名称推测')})
 it('rejects extra target nodes and changed child content',()=>{expect(()=>pairObservedAliMoveNodes(before,[...after,{...after[1]!,id:next('extra')}],[{from:old('folder'),to:next('new-folder')}],next('target'))).toThrow('完整根或后代');const changed=after.map(row=>({...row}));changed[1]!.contentHash='other';expect(()=>pairObservedAliMoveNodes(before,changed,[{from:old('folder'),to:next('new-folder')}],next('target'))).toThrow('目标身份')})
})
