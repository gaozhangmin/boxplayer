import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {json} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {renameRemoteFile,supportsRemoteRename} from '@/features/files/drive/renameMutations'
vi.mock('@/features/sources/transport',()=>({json:vi.fn()}))
const {pane}=vi.hoisted(()=>({pane:{sourceId:'source',context:1,file:vi.fn()}}))
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>pane}))
const account={id:'source',providerId:'dropbox' as const,name:'Fixture',baseUrl:'',authOrigins:[]},file={file_id:'id:root-video',parent_file_id:'id:parent',isDir:false}
const metadata={id:file.file_id,'.tag':'file',path_display:'/Folder/Old.mkv',name:'Old.mkv'}
const receipt={metadata:{...metadata,path_display:'/Folder/New.mkv',name:'New.mkv'}}
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];pane.sourceId='source';pane.context=1;pane.file.mockReturnValue(file)})
describe('original Dropbox rename with native account path resolution',()=>{
 it('resolves opaque ID including root substring and preserves original body',async()=>{
  vi.mocked(json).mockResolvedValueOnce(metadata).mockResolvedValueOnce(receipt)
  expect(supportsRemoteRename(account)).toBe(true)
  expect(await renameRemoteFile(account,file,'New.mkv')).toEqual({...file,name:'New.mkv'})
  expect(json).toHaveBeenNthCalledWith(1,account,'POST','https://api.dropboxapi.com/2/files/get_metadata',{path:file.file_id})
  expect(json).toHaveBeenNthCalledWith(2,account,'POST','https://api.dropboxapi.com/2/files/move_v2',{from_path:'/Folder/Old.mkv',to_path:'/Folder/New.mkv',allow_shared_folder:true,autorename:true,allow_ownership_transfer:false})
 })
 it.each([{...metadata,id:'id:other'},{...metadata,path_display:undefined},{...metadata,'.tag':'deleted'}])('rejects invalid read receipt before mutation %j',async row=>{
  vi.mocked(json).mockResolvedValue(row);await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow();expect(json).toHaveBeenCalledTimes(1)
 })
 it('stops after account context changes during metadata read',async()=>{
  vi.mocked(json).mockImplementationOnce(async()=>{pane.context++;return metadata});await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('已切换');expect(json).toHaveBeenCalledTimes(1)
 })
 it.each([{}, {metadata:{...receipt.metadata,name:'New (1).mkv',path_display:'/Folder/New (1).mkv'}},{metadata:{...receipt.metadata,id:'id:other'}},{metadata:{...receipt.metadata,'.tag':'folder'}},{metadata:{...receipt.metadata,path_display:'/Wrong/New.mkv'}}])('does not claim completion for ambiguous or mismatched mutation %j',async result=>{
  vi.mocked(json).mockResolvedValueOnce(metadata).mockResolvedValueOnce(result);await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow()
 })
 it('rejects unknown file before reading and preserves provider failure',async()=>{
  pane.file.mockReturnValue(undefined);await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('记录');expect(json).not.toHaveBeenCalled()
  pane.file.mockReturnValue(file);vi.mocked(json).mockResolvedValueOnce(metadata).mockRejectedValueOnce(Error('conflict'));await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow()
 })
})
