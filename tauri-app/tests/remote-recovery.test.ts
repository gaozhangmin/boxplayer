import {beforeEach,describe,it,expect,vi} from 'vitest'
import {nativeCall} from '@/platform/native'
import {recoverRemoteOperations} from '@/features/files/remoteRecovery'
import {emptyFilePreferences,type FilePreferences} from '@/features/files/preferences'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn()}))
let store:{preferences:FilePreferences},before:FilePreferences,after:FilePreferences,values:Map<string,string>,set:ReturnType<typeof vi.fn>
const key='tauri.filePreferences'
function pending(){return {receipt:{id:'move',sourceId:'ali',revision:2,acknowledged:false},beforePreferences:before,afterPreferences:after}}
function ackCalls(){return vi.mocked(nativeCall).mock.calls.filter(c=>c[0]==='remote_operation_ack')}
beforeEach(()=>{
 vi.resetAllMocks();before=emptyFilePreferences();before.favorites=[{id:'old',sourceId:'ali',path:'old',name:'Custom',local:false}];after=JSON.parse(JSON.stringify(before));after.favorites[0]!.id='new';after.favorites[0]!.path='new';store={preferences:JSON.parse(JSON.stringify(before))};values=new Map([[key,JSON.stringify(before)]]);set=vi.fn((k:string,v:string)=>values.set(k,v));vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:set})
 vi.mocked(nativeCall).mockImplementation(async(command,args)=>{if(command==='remote_operations_pending')return [pending()];if(command==='remote_operation_ack'){expect(JSON.parse(values.get(key)!)).toEqual(after);expect(store.preferences).toEqual(after);expect(args).toEqual({id:'move',sourceId:'ali',persistedPreferences:after});return}throw Error(command)})
})
describe('durable remote preference recovery',()=>{
 it('backs up current settings before an explicitly approved conflicting restore',async()=>{
  store.preferences.grid=true;const current=JSON.parse(JSON.stringify(store.preferences)),confirm=vi.fn().mockResolvedValue(true)
  await recoverRemoteOperations(store,confirm)
  expect(confirm).toHaveBeenCalledWith({operationId:'move',sourceId:'ali',corruptStorage:false})
  const backup=[...values].find(([key])=>key.startsWith('tauri.filePreferences.recoveryBackup.move.'))!
  expect(JSON.parse(backup[1])).toMatchObject({preferences:current,persistedPreferences:JSON.stringify(before)})
  expect(set.mock.calls[0]![0]).toBe(backup[0]);expect(store.preferences).toEqual(after);expect(ackCalls()).toHaveLength(1)
 })
 it('defers conflicting restoration without changing settings or acknowledging',async()=>{store.preferences.grid=true;await expect(recoverRemoteOperations(store,async()=>false)).rejects.toThrow('仍待处理');expect(set).not.toHaveBeenCalled();expect(store.preferences.grid).toBe(true);expect(ackCalls()).toHaveLength(0)})
 it('refuses to overwrite edits made while the confirmation is open',async()=>{store.preferences.grid=true;await expect(recoverRemoteOperations(store,async()=>{store.preferences.names.other='New edit';return true})).rejects.toThrow('确认期间');expect(set).not.toHaveBeenCalled();expect(store.preferences.names.other).toBe('New edit');expect(ackCalls()).toHaveLength(0)})
 it('refuses a changed persisted snapshot after confirmation',async()=>{store.preferences.grid=true;await expect(recoverRemoteOperations(store,async()=>{values.set(key,'changed');return true})).rejects.toThrow('确认期间');expect(set).not.toHaveBeenCalled();expect(ackCalls()).toHaveLength(0)})
 it('keeps current settings when the backup cannot be saved',async()=>{store.preferences.grid=true;set.mockImplementation(()=>{throw Error('Quota exceeded')});await expect(recoverRemoteOperations(store,async()=>true)).rejects.toThrow('Quota exceeded');expect(store.preferences.grid).toBe(true);expect(values.get(key)).toBe(JSON.stringify(before));expect(ackCalls()).toHaveLength(0)})
 it('requires the backup write to be verified before replacing current settings',async()=>{store.preferences.grid=true;set.mockImplementation(()=>{});await expect(recoverRemoteOperations(store,async()=>true)).rejects.toThrow('尚未备份');expect(store.preferences.grid).toBe(true);expect(values.get(key)).toBe(JSON.stringify(before));expect(ackCalls()).toHaveLength(0)})
 it('backs up malformed persisted bytes verbatim only after explicit confirmation',async()=>{values.set(key,'{corrupt');const confirm=vi.fn().mockResolvedValue(true);await recoverRemoteOperations(store,confirm);expect(confirm).toHaveBeenCalledWith({operationId:'move',sourceId:'ali',corruptStorage:true});const backup=[...values].find(([key])=>key.startsWith('tauri.filePreferences.recoveryBackup.move.'))!;expect(JSON.parse(backup[1]).persistedPreferences).toBe('{corrupt');expect(store.preferences).toEqual(after)})
 it('retains separate backups if settings are edited again after a lost acknowledgement',async()=>{
  store.preferences.grid=true;const original=vi.mocked(nativeCall).getMockImplementation()!;let fail=true
  vi.mocked(nativeCall).mockImplementation(async(...args)=>{if(args[0]==='remote_operation_ack'&&fail){fail=false;throw Error('lost ack')}return original(...args)})
  await expect(recoverRemoteOperations(store,async()=>true)).rejects.toThrow('lost ack')
  store.preferences.names.other='Second edit';values.set(key,JSON.stringify(store.preferences));await recoverRemoteOperations(store,async()=>true)
  const backups=[...values].filter(([key])=>key.startsWith('tauri.filePreferences.recoveryBackup.move.'));expect(backups).toHaveLength(2);expect(backups.some(([,value])=>JSON.parse(value).preferences.names.other==='Second edit')).toBe(true)
 })

 it('leaves preferences and storage untouched when no native transition is pending',async()=>{vi.mocked(nativeCall).mockResolvedValueOnce([]);await expect(recoverRemoteOperations(store)).resolves.toEqual([]);expect(set).not.toHaveBeenCalled();expect(store.preferences).toEqual(before);expect(ackCalls()).toHaveLength(0)})
 it('persists the accepted native after-state before acknowledging',async()=>{await recoverRemoteOperations(store);expect(store.preferences).toEqual(after);expect(ackCalls()).toHaveLength(1)})
 it('does not acknowledge or change memory when storage fails',async()=>{set.mockImplementation(()=>{throw Error('Disk full')});await expect(recoverRemoteOperations(store)).rejects.toThrow('Disk full');expect(store.preferences).toEqual(before);expect(ackCalls()).toHaveLength(0)})
 it('requires verified storage persistence',async()=>{set.mockImplementation(()=>{});await expect(recoverRemoteOperations(store)).rejects.toThrow('持久化');expect(store.preferences).toEqual(before);expect(ackCalls()).toHaveLength(0)})
 it('retries lost acknowledgement using already persisted state without remote IO',async()=>{vi.mocked(nativeCall).mockRejectedValueOnce(Error('read failed'));await expect(recoverRemoteOperations(store)).rejects.toThrow('read failed');const original=vi.mocked(nativeCall).getMockImplementation()!;let fail=true;vi.mocked(nativeCall).mockImplementation(async(...args)=>{if(args[0]==='remote_operation_ack'&&fail){fail=false;throw Error('lost ack')}return original(...args)});await expect(recoverRemoteOperations(store)).rejects.toThrow('lost ack');await recoverRemoteOperations(store);expect(store.preferences).toEqual(after);expect(vi.mocked(nativeCall).mock.calls.every(c=>['remote_operations_pending','remote_operation_ack'].includes(c[0]))).toBe(true)})
 it.each(['memory','storage'])('preserves conflicting %s edits and leaves receipt pending',async where=>{const changed=JSON.parse(JSON.stringify(before));changed.names.other='Keep';if(where==='memory')store.preferences=changed;else values.set(key,JSON.stringify(changed));await expect(recoverRemoteOperations(store)).rejects.toThrow('冲突');expect(set).not.toHaveBeenCalled();expect(ackCalls()).toHaveLength(0)})
 it('detects edits made while pending receipts are being read',async()=>{vi.mocked(nativeCall).mockImplementationOnce(async()=>{store.preferences.grid=true;return [pending()]});await expect(recoverRemoteOperations(store)).rejects.toThrow('冲突');expect(store.preferences.grid).toBe(true);expect(set).not.toHaveBeenCalled()})
 it('accepts object key order changes without treating them as preference edits',async()=>{values.set(key,JSON.stringify(Object.fromEntries(Object.entries(before).reverse())));await recoverRemoteOperations(store);expect(ackCalls()).toHaveLength(1)})
 it('rejects malformed persisted JSON without overwriting it',async()=>{values.set(key,'{');await expect(recoverRemoteOperations(store)).rejects.toThrow('损坏');expect(set).not.toHaveBeenCalled()})
 it('rejects duplicate receipts before any write',async()=>{vi.mocked(nativeCall).mockResolvedValueOnce([pending(),pending()]);await expect(recoverRemoteOperations(store)).rejects.toThrow('回执无效');expect(set).not.toHaveBeenCalled()})
 it('rejects malformed preference payloads before any write',async()=>{vi.mocked(nativeCall).mockResolvedValueOnce([{...pending(),afterPreferences:{}}]);await expect(recoverRemoteOperations(store)).rejects.toThrow('回执无效');expect(set).not.toHaveBeenCalled()})
 it('rejects incorrectly typed preference dictionaries before any write',async()=>{vi.mocked(nativeCall).mockResolvedValueOnce([{...pending(),afterPreferences:{...after,hiddenOnHome:{target:'false'}}}]);await expect(recoverRemoteOperations(store)).rejects.toThrow('回执无效');expect(set).not.toHaveBeenCalled()})
 it('coalesces recovery only for the same store',async()=>{await Promise.all([recoverRemoteOperations(store),recoverRemoteOperations(store)]);expect(vi.mocked(nativeCall).mock.calls.filter(c=>c[0]==='remote_operations_pending')).toHaveLength(1);expect(ackCalls()).toHaveLength(1)})
 it('does not overwrite a synchronous watcher change or acknowledge it',async()=>{let current=store.preferences;Object.defineProperty(store,'preferences',{get:()=>current,set:(v:FilePreferences)=>{current={...v,grid:true};values.set(key,JSON.stringify(current))}});await expect(recoverRemoteOperations(store)).rejects.toThrow('恢复期间');expect(ackCalls()).toHaveLength(0)})
})
