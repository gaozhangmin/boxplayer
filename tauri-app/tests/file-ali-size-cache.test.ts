import {beforeEach,describe,it,expect,vi,afterEach} from 'vitest'
import {DriverData,installAliSizeIndex,_RefreshAllDirTotalSize} from '@/features/files/drive/aliDirectoryCachePorts'
import {GetDirSizeNeedRefresh,SaveDirSizeNeedRefresh} from '@/features/files/drive/electron/providers/aliDirectorySizeCache'
beforeEach(()=>{DriverData.clear();vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-09T00:00:00Z'))})
afterEach(()=>vi.useRealTimers())
describe('original Ali tree total and seven-day direct-size cache',()=>{
 it('aggregates known nested direct sizes along the indexed directory tree',()=>{
  const data=installAliSizeIndex('owner/resource',[{file_id:'a',parent_file_id:'root'},{file_id:'b',parent_file_id:'a'},{file_id:'c',parent_file_id:'root'}])
  SaveDirSizeNeedRefresh('owner/resource',[{dirID:'root',size:2},{dirID:'a',size:3},{dirID:'b',size:5},{dirID:'c',size:7}]);expect(data.DirTotalSizeMap).toEqual({root:17,a:8,b:5,c:7})
  expect(GetDirSizeNeedRefresh('owner/resource')).toEqual([])
 })
 it('uses the original seven-day refresh age and explicit invalidation',()=>{
  const data=installAliSizeIndex('owner/resource',[{file_id:'a',parent_file_id:'root'}]);SaveDirSizeNeedRefresh('owner/resource',[{dirID:'root',size:0},{dirID:'a',size:8}]);vi.advanceTimersByTime(604800000);expect(GetDirSizeNeedRefresh('owner/resource')).toEqual([]);vi.advanceTimersByTime(1000);expect(GetDirSizeNeedRefresh('owner/resource')).toEqual(['root','a']);data.DirFileSizeTimeMap.a=0;expect(GetDirSizeNeedRefresh('owner/resource',999999999)).toEqual(['a'])
 })
 it('preserves valid direct cache for refreshed indexes but drops removed directories',()=>{
  installAliSizeIndex('owner/resource',[{file_id:'a',parent_file_id:'root'},{file_id:'b',parent_file_id:'root'}]);SaveDirSizeNeedRefresh('owner/resource',[{dirID:'a',size:8},{dirID:'b',size:99}]);const data=installAliSizeIndex('owner/resource',[{file_id:'a',parent_file_id:'root'}]);expect(data.DirTotalSizeMap.root).toBe(8);expect(data.DirFileSizeMap.b).toBeUndefined()
 })
 it('keeps account/drive cache namespaces independent',()=>{
  installAliSizeIndex('owner1/resource',[]);installAliSizeIndex('owner2/resource',[]);SaveDirSizeNeedRefresh('owner1/resource',[{dirID:'root',size:8}]);expect(DriverData.get('owner2/resource')!.DirTotalSizeMap.root).toBe(0);expect(GetDirSizeNeedRefresh('owner2/resource')).toEqual(['root'])
 })
 it.each([
  {nodes:[{file_id:'a',parent_file_id:'missing'}],error:'父目录缺失'},
  {nodes:[{file_id:'a',parent_file_id:'b'},{file_id:'b',parent_file_id:'a'}],error:'成环'},
  {nodes:[{file_id:'a',parent_file_id:'root'},{file_id:'a',parent_file_id:'root'}],error:'重复'}
 ])('rejects invalid directory graph: $error',({nodes,error})=>{expect(()=>installAliSizeIndex('invalid',nodes)).toThrow(error)})

 it('rejects unsafe aggregate byte totals before replacing prior totals',()=>{const data=installAliSizeIndex('owner/resource',[{file_id:'a',parent_file_id:'root'}]);data.DirFileSizeMap.root=Number.MAX_SAFE_INTEGER;data.DirFileSizeMap.a=1;expect(()=>_RefreshAllDirTotalSize('owner/resource')).toThrow('超过');expect(data.DirTotalSizeMap.root).toBe(0)})
})
