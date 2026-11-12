import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {request} from '@/features/sources/transport'
import {relocateAliFile} from '@/features/files/drive/aliRelocationMutations'
import {relocateRemoteFiles} from '@/features/files/drive/relocationMutations'
import {ApiMoveBatch} from '@/features/files/drive/electron/providers/aliFileCmd'
import {withAliRelocationContext} from '@/features/files/drive/aliRelocationContext'
import {withAliCrossDriveObservation} from '@/features/files/drive/aliCrossDriveObservationScope'
import {aliRelocationReceipt} from '@/features/files/drive/aliRelocationTransport'
import {readAliMoveSnapshot} from '@/features/files/drive/aliMoveSnapshot'
const state=vi.hoisted(()=>({pane:{sourceId:'ali',context:1,file:vi.fn()} as any}))
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>state.pane}))
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(response:any)=>new TextDecoder().decode(new Uint8Array(response.body))}))
vi.mock('@/features/files/drive/aliMoveSnapshot',async original=>({...await original<typeof import('@/features/files/drive/aliMoveSnapshot')>(),readAliMoveSnapshot:vi.fn()}))
const account={id:'ali',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),from=id('resource','folder'),destination=id('backup','target')
const known={file_id:from,drive_id:'ali',parent_file_id:id('resource','root'),name:'Folder',isDir:true},before=[{id:from,parent:known.parent_file_id,name:'Folder',isDirectory:true,size:0},{id:id('resource','child'),parent:from,name:'movie.mkv',isDirectory:false,size:10,contentHash:'same'}]
const target=id('backup','new-folder'),after=[{id:target,parent:destination,name:'Folder (1)',isDirectory:true,size:0},{id:id('backup','child'),parent:target,name:'movie.mkv',isDirectory:false,size:10,contentHash:'same'}],detail={file_id:'new-folder',drive_id:'backup',parent_file_id:'target',name:'Folder (1)',type:'folder'}
const response=(body:unknown)=>({status:200,headers:{},finalUrl:'',body:Array.from(new TextEncoder().encode(JSON.stringify(body)))})
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];state.pane={sourceId:'ali',context:state.pane.context+1,file:vi.fn((value:string)=>value===from?known:{file_id:destination,drive_id:'ali',isDir:true})};vi.mocked(readAliMoveSnapshot).mockImplementation(async(_account,roots)=>roots[0]!.id===from?structuredClone(before):structuredClone(after));vi.mocked(request).mockImplementation(async(_account,_method,url)=>response(url.endsWith('/batch')?{responses:[{id:'folder',status:200,body:detail}]}:detail))})
const submit=()=>ApiMoveBatch('ali','resource',['folder'],'backup','target')
const observe=(check=()=>{})=>withAliRelocationContext('ali',check,()=>withAliCrossDriveObservation(account,from,destination,check,submit))
describe('original Ali move batch bound to complete observed cross-drive receipts',()=>{
 it('reports already-synchronized identities to the file-page batch coordinator',async()=>{const synchronize=vi.fn().mockResolvedValue(undefined);const result=await relocateRemoteFiles(account,[known as any],destination,false,()=>true,['',id('backup','root'),destination],synchronize);expect(result).toMatchObject({success:[from],failures:[],identitySynced:[from]});expect(synchronize).toHaveBeenCalledWith(known,expect.objectContaining({destination,pairs:expect.any(Array)}))})
 it('connects the original public move wrapper to complete synchronization before reporting success',async()=>{const synchronize=vi.fn().mockResolvedValue(undefined);const result=await relocateAliFile(account,known as any,destination,false,()=>true,synchronize);expect(result).toMatchObject({ids:[from],name:'Folder (1)',identitySynced:true});expect(synchronize).toHaveBeenCalledOnce();expect(synchronize.mock.calls[0]![0].pairs).toHaveLength(2)})
 it('retries only local synchronization after a failed commit without repeating the original move',async()=>{const synchronize=vi.fn().mockRejectedValueOnce(Error('local commit failed')).mockResolvedValue(undefined);await expect(relocateAliFile(account,known as any,destination,false,()=>true,synchronize)).rejects.toThrow('local commit failed');await relocateAliFile(account,known as any,destination,false,()=>true,synchronize);expect(synchronize).toHaveBeenCalledTimes(2);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1)})

 it('blocks a raw cross-drive mutation without an observation scope',async()=>{await expect(submit()).rejects.toThrow('完整前后快照');expect(request).not.toHaveBeenCalled();expect(readAliMoveSnapshot).not.toHaveBeenCalled()})
 it('keeps the exact original batch body and returns a complete source-bound snapshot receipt',async()=>{
  expect(await observe()).toEqual(['folder']);expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!).requests[0].body).toEqual({drive_id:'resource',file_id:'folder',to_drive_id:'backup',to_parent_file_id:'target',auto_rename:true})
  expect(readAliMoveSnapshot).toHaveBeenNthCalledWith(1,account,[{id:from,parent:known.parent_file_id}],expect.any(Function));expect(aliRelocationReceipt(from)?.crossDrive).toEqual({before,after,pairs:[{from,to:target},{from:id('resource','child'),to:id('backup','child')}],destination})
 })
 it('retries a failed target observation without repeating the POST or rereading the moved source',async()=>{
  let targetReads=0;vi.mocked(readAliMoveSnapshot).mockImplementation(async(_account,roots)=>{if(roots[0]!.id===from)return structuredClone(before);if(++targetReads===1)throw Error('offline');return structuredClone(after)})
  await expect(observe()).rejects.toThrow('offline');expect(await observe()).toEqual(['folder']);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1);expect(vi.mocked(readAliMoveSnapshot).mock.calls.filter(call=>call[1][0]!.id===from)).toHaveLength(1)
 })
 it('never treats a root-only confirmation as complete descendant identity',async()=>{
  vi.mocked(readAliMoveSnapshot).mockImplementation(async(_account,roots)=>roots[0]!.id===from?structuredClone(before):structuredClone(after.slice(0,1)))
  await expect(observe()).rejects.toThrow('不能按名称推测');await expect(observe()).rejects.toThrow();expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1)
 })
 it('fails preflight without a write and allows an explicit fresh read retry',async()=>{
  vi.mocked(readAliMoveSnapshot).mockRejectedValueOnce(Error('preflight offline'));await expect(observe()).rejects.toThrow('preflight');expect(request).not.toHaveBeenCalled();expect(await observe()).toEqual(['folder'])
 })
 it('does not launch again after losing a submission response',async()=>{
  vi.mocked(request).mockRejectedValueOnce(Error('response lost'));await expect(observe()).rejects.toThrow('lost');await expect(observe()).rejects.toThrow('受理未知');expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1)
 })
 it('does not publish a previous-owner receipt after same-ID replacement',async()=>{
  await observe();useFileSourcesStore().accounts=[{...account,userId:'replacement'}];expect(aliRelocationReceipt(from)).toBeUndefined();await expect(observe()).rejects.toThrow('来源已切换');expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1)
 })
 it('returns detached observation data that cannot alter a retained retry snapshot',async()=>{
  await observe();aliRelocationReceipt(from)!.crossDrive!.before[0]!.name='changed';await observe();expect(aliRelocationReceipt(from)!.crossDrive!.before[0]!.name).toBe('Folder');expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1)
 })
})
