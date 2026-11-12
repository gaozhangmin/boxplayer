import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {json} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {createRemoteFolder,supportsRemoteFolderCreation} from '@/features/files/drive/folderMutations'
import type {Account} from '@/features/sources/contracts'
vi.mock('@/features/sources/transport',()=>({json:vi.fn()}))
function selected(providerId:Account['providerId']){const store=useFileSourcesStore();store.accounts=[{id:'first',providerId,name:'First',baseUrl:'',authOrigins:[]},{id:'second',providerId,name:'Second',baseUrl:'',authOrigins:[]}];return store.accounts[1]!}
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}})})
describe('original provider folder recipes through native account transport',()=>{
 it('retains OneDrive conflict behavior and binds the second account',async()=>{
  const account=selected('onedrive');vi.mocked(json).mockResolvedValue({id:'new-id'})
  expect(await createRemoteFolder(account,'','Folder')).toEqual({file_id:'new-id',error:''})
  expect(json).toHaveBeenCalledExactlyOnceWith(account,'POST','https://graph.microsoft.com/v1.0/me/drive/root/children',{name:'Folder',folder:{},'@microsoft.graph.conflictBehavior':'rename'})
 })
 it('encodes OneDrive opaque parent IDs',async()=>{
  const account=selected('onedrive');vi.mocked(json).mockResolvedValue({id:'new-id'})
  await createRemoteFolder(account,'parent/opaque','Folder')
  expect(vi.mocked(json).mock.calls[0]?.[2]).toBe('https://graph.microsoft.com/v1.0/me/drive/items/parent%2Fopaque/children')
 })
 it('retains Box root normalization and Google shared-drive parameters',async()=>{
  const box=selected('box');vi.mocked(json).mockResolvedValue({id:'box-folder'})
  await createRemoteFolder(box,'','Box folder')
  expect(json).toHaveBeenCalledWith(box,'POST','https://api.box.com/2.0/folders',{name:'Box folder',parent:{id:'0'}})
  const google=selected('google');vi.mocked(json).mockResolvedValue({id:'google-folder'})
  await createRemoteFolder(google,'shared-parent','Google folder')
  const call=vi.mocked(json).mock.calls.at(-1)!;const url=new URL(call[2]);expect(call[0]).toBe(google)
  expect(url.origin+url.pathname).toBe('https://www.googleapis.com/drive/v3/files');expect(url.searchParams.get('supportsAllDrives')).toBe('true')
  expect(call[3]).toEqual({name:'Google folder',mimeType:'application/vnd.google-apps.folder',parents:['shared-parent']})
 })
 it('resolves Dropbox opaque parents without mistaking real paths containing root for the drive root',async()=>{
  const account=selected('dropbox');vi.mocked(json).mockResolvedValueOnce({'.tag':'folder',id:'id:parent',path_display:'/root collection'}).mockResolvedValueOnce({metadata:{id:'id:new'}})
  expect(await createRemoteFolder(account,'id:parent','Child')).toEqual({file_id:'id:new',error:''})
  expect(json).toHaveBeenNthCalledWith(1,account,'POST','https://api.dropboxapi.com/2/files/get_metadata',{path:'id:parent'})
  expect(json).toHaveBeenNthCalledWith(2,account,'POST','https://api.dropboxapi.com/2/files/create_folder_v2',{path:'/root collection/Child',autorename:false})
 })
 it('uses Dropbox actual root without a metadata request',async()=>{
  const account=selected('dropbox');vi.mocked(json).mockResolvedValue({metadata:{id:'id:new'}})
  await createRemoteFolder(account,'','Child')
  expect(json).toHaveBeenCalledExactlyOnceWith(account,'POST','https://api.dropboxapi.com/2/files/create_folder_v2',{path:'/Child',autorename:false})
 })
 it('rejects missing provider IDs and metadata before claiming success or sending a write',async()=>{
  const one=selected('onedrive');vi.mocked(json).mockResolvedValue({})
  await expect(createRemoteFolder(one,'','Folder')).rejects.toThrow('标识')
  const dropbox=selected('dropbox');vi.mocked(json).mockReset().mockResolvedValue({'.tag':'file',path_display:'/not-folder'})
  await expect(createRemoteFolder(dropbox,'id:parent','Folder')).rejects.toThrow('不是文件夹');expect(json).toHaveBeenCalledTimes(1)
 })
 it('rejects wrong-provider identity, unsupported providers and invalid names before network writes',async()=>{
  const source=selected('google')
  await expect(createRemoteFolder({...source,providerId:'box'},'','Folder')).rejects.toThrow('来源不匹配')
  expect(supportsRemoteFolderCreation({...source,providerId:'webdav'})).toBe(false)
  await expect(createRemoteFolder({...source,providerId:'webdav'},'','Folder')).rejects.toThrow('尚未接入')
  await expect(createRemoteFolder(source,'','../escape')).rejects.toThrow('名称无效');expect(json).not.toHaveBeenCalled()
 })
 it('rejects malformed Dropbox creation receipts and wrong metadata identity',async()=>{
  const source=selected('dropbox');vi.mocked(json).mockResolvedValue({metadata:{id:'',path_display:''}})
  await expect(createRemoteFolder(source,'','Folder')).rejects.toThrow('标识')
  vi.mocked(json).mockReset().mockResolvedValue({'.tag':'folder',id:'id:other',path_display:'/other'})
  await expect(createRemoteFolder(source,'id:expected','Folder')).rejects.toThrow('不匹配');expect(json).toHaveBeenCalledTimes(1)
 })

})
