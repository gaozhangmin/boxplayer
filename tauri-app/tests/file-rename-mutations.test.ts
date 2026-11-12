import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {json} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {renameRemoteFile} from '@/features/files/drive/renameMutations'
import type {Account} from '@/features/sources/contracts'
vi.mock('@/features/sources/transport',()=>({json:vi.fn()}))
const file={file_id:'opaque/id',parent_file_id:'parent',isDir:false}
function selected(providerId:Account['providerId']){const account={id:'second',providerId,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore().accounts=[account];return account}
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia())})
describe('original rename protocols through account-bound transport',()=>{
 it('binds OneDrive opaque ID and requires the actual returned name',async()=>{
  const account=selected('onedrive');vi.mocked(json).mockResolvedValue({id:file.file_id,name:'New.mkv'})
  expect(await renameRemoteFile(account,file,'New.mkv')).toEqual({...file,name:'New.mkv'})
  expect(json).toHaveBeenCalledExactlyOnceWith(account,'PATCH','https://graph.microsoft.com/v1.0/me/drive/items/opaque%2Fid',{name:'New.mkv'})
 })
 it.each([{}, {id:'wrong',name:'New.mkv'},{id:file.file_id},{id:file.file_id,name:'Old.mkv'}])('rejects ambiguous OneDrive receipts %j',async receipt=>{
  const account=selected('onedrive');vi.mocked(json).mockResolvedValue(receipt)
  await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('标识或名称')
 })
 it('retains Google shared-drive parameters and rejects mismatched identities',async()=>{
  const account=selected('google');vi.mocked(json).mockResolvedValue({id:file.file_id,name:'New.mkv'})
  await renameRemoteFile(account,file,'New.mkv')
  const call=vi.mocked(json).mock.calls[0]!;const url=new URL(call[2]);expect(url.pathname).toBe('/drive/v3/files/opaque%2Fid');expect(url.searchParams.get('supportsAllDrives')).toBe('true');expect(call[0]).toEqual(account);expect(call[3]).toEqual({name:'New.mkv'})
  vi.mocked(json).mockResolvedValue({id:'other',name:'New.mkv'})
  await expect(renameRemoteFile(account,file,'New.mkv')).rejects.toThrow('标识不匹配')
 })
 it('rejects invalid names and changed account identity before sending a write',async()=>{
  const account=selected('google')
  await expect(renameRemoteFile(account,file,'../escape')).rejects.toThrow('无效')
  await expect(renameRemoteFile({...account,providerId:'onedrive'},file,'New')).rejects.toThrow('来源不匹配')
  expect(json).not.toHaveBeenCalled()
 })
})
