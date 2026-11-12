import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createFolderBatch,parseFolderNames} from '@/features/files/drive/batchFolders'
import {createDriveSettings} from '@/features/files/drive/settings'
beforeEach(()=>{const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)})})
describe('batch folder creation',()=>{
 it('validates all names before writes and rejects duplicate names',()=>{
  expect(parseFolderNames('Folder A\r\n\r\nFolder B')).toEqual(['Folder A','Folder B'])
  expect(()=>parseFolderNames('Valid\n../outside')).toThrow('不能包含')
  expect(()=>parseFolderNames('Same\nSame')).toThrow('重复')
  expect(()=>parseFolderNames('x'.repeat(101))).toThrow('太长')
 })
 it('records real partial results and retries only failed names',async()=>{
  const completed=new Map<string,string>(),create=vi.fn().mockResolvedValueOnce({file_id:'a'}).mockRejectedValueOnce(Error('fixture failure'))
  const first=await createFolderBatch(['A','B'],create,completed)
  expect(first).toEqual([{name:'A',id:'a'},{name:'B',error:'fixture failure'}])
  create.mockClear().mockResolvedValueOnce({file_id:'b'})
  const retried=await createFolderBatch(['A','B'],create,completed)
  expect(create).toHaveBeenCalledExactlyOnceWith('B');expect(retried).toEqual([{name:'A',id:'a'},{name:'B',id:'b'}])
 })
 it('does not treat an empty response as success',async()=>{
  const completed=new Map<string,string>();const result=await createFolderBatch(['A'],async()=>({}),completed)
  expect(result[0]?.error).toContain('未返回');expect(completed.size).toBe(0)
 })
 it('stops future requests when the parent closes without claiming the remaining names',async()=>{
  const controller=new AbortController(),create=vi.fn(async()=>{controller.abort();return {file_id:'first'}})
  const results=await createFolderBatch(['A','B','C'],create,new Map(),controller.signal)
  expect(create).toHaveBeenCalledTimes(1);expect(results).toEqual([{name:'A',id:'first'}])
 })
})
it('persists original folder date/sequence and view preferences without persisting security fields',()=>{
 const settings=createDriveSettings();expect(settings.uiTimeFolderFormate).toBe('yyyy-MM-dd HH-mm-ss');expect(settings.uiFileColorArray[0]).toEqual({key:'#df5659',title:'鹅冠红'})
 settings.updateStore({uiTimeFolderFormate:'yyyy-MM-dd ###',uiTimeFolderIndex:42,uiFileListMode:'image',securityPassword:'do-not-persist'})
 const saved=createDriveSettings();expect(saved.uiTimeFolderIndex).toBe(42);expect(saved.uiTimeFolderFormate).toBe('yyyy-MM-dd ###');expect(saved.uiFileListMode).toBe('image')
 expect(localStorage.getItem('tauri.driveSettings')).not.toContain('do-not-persist')
 localStorage.setItem('tauri.driveSettings','null');expect(createDriveSettings().uiTimeFolderIndex).toBe(1)
})
