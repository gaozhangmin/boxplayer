import {beforeEach,describe,it,expect,vi} from 'vitest'
import {nativeCall} from '@/platform/native'
import {recoverLocalOperations} from '@/features/files/localRecovery'
import {renameLocalFile} from '@/features/files/drive/localRename'
import {emptyFilePreferences} from '@/features/files/preferences'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn()}))
vi.mock('@/features/files/localRecovery',()=>({recoverLocalOperations:vi.fn()}))
const store={preferences:emptyFilePreferences()},entry={id:'job',sourceId:'source',from:'old.mkv',to:'new.mkv',directory:false,applied:true}
beforeEach(()=>{vi.resetAllMocks();vi.mocked(recoverLocalOperations).mockResolvedValueOnce([]).mockResolvedValue([entry]);vi.mocked(nativeCall).mockResolvedValue({schemaVersion:1,sourceId:'source',from:'old.mkv',to:'new.mkv',directory:false,operationId:'job'})})
describe('original local rename native boundary',()=>{
 it('supplies current preferences for native preflight and only succeeds after durable recovery acknowledgement',async()=>{const recovered=vi.fn();expect(await renameLocalFile(store,'source','old.mkv','new.mkv',false,recovered)).toEqual({path:'new.mkv',name:'new.mkv'});expect(nativeCall).toHaveBeenCalledWith('local_file_rename',{sourceId:'source',operation:{path:'old.mkv',name:'new.mkv',preferences:store.preferences}});expect(recovered).toHaveBeenCalledWith(entry)})
 it('resumes an already-applied transition without issuing another rename',async()=>{vi.mocked(recoverLocalOperations).mockReset().mockResolvedValue([entry]);expect((await renameLocalFile(store,'source','old.mkv','new.mkv',false)).path).toBe('new.mkv');expect(nativeCall).not.toHaveBeenCalled()})
 it('recovers an accepted rename when its IPC response is lost',async()=>{vi.mocked(nativeCall).mockRejectedValueOnce(Error('IPC lost'));expect((await renameLocalFile(store,'source','old.mkv','new.mkv',false)).path).toBe('new.mkv')})
 it('does not turn an unconfirmed failure into success',async()=>{vi.mocked(nativeCall).mockRejectedValueOnce(Error('Denied'));vi.mocked(recoverLocalOperations).mockReset().mockResolvedValue([]);await expect(renameLocalFile(store,'source','old.mkv','new.mkv',false)).rejects.toThrow('Denied')})
 it.each([{sourceId:'other'},{from:'other.mkv'},{to:'other.mkv'},{directory:true}])('rejects a conflicting native receipt %j',async patch=>{vi.mocked(nativeCall).mockResolvedValueOnce({schemaVersion:1,sourceId:'source',from:'old.mkv',to:'new.mkv',directory:false,operationId:'job',...patch});await expect(renameLocalFile(store,'source','old.mkv','new.mkv',false)).rejects.toThrow('回执')})
 it('retains pending preference failure instead of reporting rename completed',async()=>{vi.mocked(recoverLocalOperations).mockReset().mockResolvedValueOnce([]).mockRejectedValueOnce(Error('Disk full'));await expect(renameLocalFile(store,'source','old.mkv','new.mkv',false)).rejects.toThrow('Disk full')})
 it.each(['../bad','a/b','.',String.fromCharCode(0)])('rejects invalid target names before IPC %s',async name=>{await expect(renameLocalFile(store,'source','old.mkv',name,false)).rejects.toThrow('无效');expect(nativeCall).not.toHaveBeenCalled()})
 it('uses the recovered current path when the retry requests a different name',async()=>{vi.mocked(recoverLocalOperations).mockReset().mockResolvedValueOnce([entry]).mockResolvedValueOnce([{...entry,id:'next',from:'new.mkv',to:'next.mkv'}]);vi.mocked(nativeCall).mockResolvedValueOnce({schemaVersion:1,sourceId:'source',from:'new.mkv',to:'next.mkv',directory:false,operationId:'next'});expect((await renameLocalFile(store,'source','old.mkv','next.mkv',false)).path).toBe('next.mkv');expect((vi.mocked(nativeCall).mock.calls[0]![1]!.operation as any).path).toBe('new.mkv')})

})
