import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {startAliDirectorySizeRefresh} from '@/features/files/drive/aliDirectorySizeRefresh'
import {readAliSizeDirectoryIndex} from '@/features/files/drive/aliDirectoryIndexPorts'
import {readAliDirectFolderSize} from '@/features/files/drive/aliDirectorySizePorts'
import {alipan} from '@/features/sources/alipan'
import {DriverData} from '@/features/files/drive/aliDirectoryCachePorts'
vi.mock('@/features/files/drive/aliDirectoryIndexPorts',()=>({readAliSizeDirectoryIndex:vi.fn()}))
vi.mock('@/features/files/drive/aliDirectorySizePorts',()=>({readAliDirectFolderSize:vi.fn()}))
vi.mock('@/features/sources/alipan',()=>({alipan:{list:vi.fn()}}))
const account={id:'ali',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]},location=(fileId:string)=>JSON.stringify({driveId:'resource',fileId})
let services:Array<ReturnType<typeof startAliDirectorySizeRefresh>>,values:Map<string,string>
beforeEach(()=>{vi.resetAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-09T00:00:00Z'));DriverData.clear();services=[];values=new Map();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)});vi.mocked(alipan.list).mockResolvedValue({entries:[{id:location('root'),name:'资源盘',isDirectory:true,size:0,playable:false}]});vi.mocked(readAliSizeDirectoryIndex).mockResolvedValue([{file_id:'a',parent_file_id:'root'},{file_id:'b',parent_file_id:'a'}] as any);vi.mocked(readAliDirectFolderSize).mockImplementation(async(_account,_drive,file)=>({size:file==='root'?2:file==='a'?3:5,truncated:false}))})
afterEach(()=>{for(const service of services)service.stop();vi.useRealTimers()})
function start(check=()=>{}){const publish=vi.fn(),service=startAliDirectorySizeRefresh(account,check,publish);services.push(service);return {service,publish}}
const row=(file:string)=>({file_id:location(file),isDir:true,size:0,sizeStr:'old'}) as any
describe('native lifecycle wiring for original folder size methods',()=>{
 it('waits original 50-second warmup, publishes nested totals and persists cache',async()=>{
  const {service,publish}=start();await vi.advanceTimersByTimeAsync(49999);expect(alipan.list).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1)
  expect(publish).toHaveBeenCalledOnce();expect(service.apply(row('a'))).toMatchObject({size:8,sizeStr:'8.00B'});expect(service.apply(row('root')).size).toBe(10);await vi.advanceTimersByTimeAsync(5000);expect(values.size).toBe(1)
  await vi.advanceTimersByTimeAsync(20000);expect(readAliDirectFolderSize).toHaveBeenCalledTimes(3);expect(alipan.list).toHaveBeenCalledOnce()
 })
 it('restores fresh seven-day cache after process-like memory reset without new direct-size reads',async()=>{
  const first=start();await vi.advanceTimersByTimeAsync(50000);first.service.stop();DriverData.clear();vi.mocked(readAliDirectFolderSize).mockClear();const next=start();await vi.advanceTimersByTimeAsync(50000);expect(readAliDirectFolderSize).not.toHaveBeenCalled();expect(next.service.apply(row('a')).size).toBe(8)
 })
 it('invalidates durable statistics and rereads after explicit refresh',async()=>{
  const {service}=start();await vi.advanceTimersByTimeAsync(50000);service.invalidate();vi.mocked(readAliDirectFolderSize).mockImplementation(async()=>({size:1,truncated:false}));await vi.advanceTimersByTimeAsync(1000);expect(service.apply(row('a')).size).toBe(2);expect(readAliSizeDirectoryIndex).toHaveBeenCalledTimes(2)
 })
 it('rejects corrupted durable cache and rereads instead of publishing cached zero',async()=>{
  const first=start();await vi.advanceTimersByTimeAsync(50000);first.service.stop();DriverData.clear()
  for(const key of values.keys())values.set(key,JSON.stringify({version:1,entries:[['root','bad',0],['a',0,1]]}))
  vi.mocked(readAliDirectFolderSize).mockClear();const next=start();await vi.advanceTimersByTimeAsync(50000)
  expect(readAliDirectFolderSize).toHaveBeenCalledTimes(3);expect(next.service.apply(row('a')).size).toBe(8)
 })
 it('stops pending work after browser disposal without publishing or making the next read',async()=>{
  let finish!:(value:any)=>void;vi.mocked(readAliSizeDirectoryIndex).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));const {service,publish}=start();await vi.advanceTimersByTimeAsync(50000);service.stop();finish([]);await vi.advanceTimersByTimeAsync(1000);expect(readAliDirectFolderSize).not.toHaveBeenCalled();expect(publish).not.toHaveBeenCalled()
 })
 it('rejects late results when the caller owner check changes',async()=>{
  let active=true,finish!:(value:any)=>void;vi.mocked(readAliDirectFolderSize).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));const {publish}=start(()=>{if(!active)throw Error('changed')});await vi.advanceTimersByTimeAsync(50000);active=false;finish({size:8,truncated:false});await vi.advanceTimersByTimeAsync(1000);expect(publish).not.toHaveBeenCalled();expect(readAliDirectFolderSize).toHaveBeenCalledOnce()
 })
 it('does not turn a failed size read into zero or publish partial totals',async()=>{
  vi.mocked(readAliDirectFolderSize).mockRejectedValueOnce(Error('network'));const {service,publish}=start();await vi.advanceTimersByTimeAsync(50000);expect(publish).not.toHaveBeenCalled();expect(service.apply(row('a')).sizeStr).toBe('old');expect(service.lastError).toContain('network');await vi.advanceTimersByTimeAsync(1000);expect(readAliDirectFolderSize).toHaveBeenCalledOnce()
 })
})
