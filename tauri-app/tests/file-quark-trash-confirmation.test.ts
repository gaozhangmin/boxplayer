import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {trashQuarkFile} from '@/features/files/drive/quarkTrashMutation'
import {apiQuarkTrashBatch} from '@/features/files/drive/electron/providers/quarkFileCmd'
import {quarkTrashPage} from '@/features/files/drive/quarkTrash'
import {QuarkRequestRejected} from '@/features/files/drive/quarkFileTransport'
import type {Account} from '@/features/sources/contracts'
vi.mock('@/features/files/drive/electron/providers/quarkFileCmd',()=>({apiQuarkTrashBatch:vi.fn()}))
vi.mock('@/features/files/drive/quarkTrash',()=>({quarkTrashPage:vi.fn()}))
let account:Account,sequence=0,current:boolean
const file={file_id:'movie',name:'Movie.mkv',isDir:false}
const row=(id='movie')=>({id,name:file.name,isDirectory:false,electronModel:{description:`quark_fid:${id};quark_pdir:old;quark_record:record-${id}`}})
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());current=true
 account={id:'confirm-'+(++sequence),providerId:'quark',name:'Fixture',baseUrl:'',userId:'owner',authOrigins:[]}
 useFileSourcesStore().accounts=[account]
 vi.mocked(apiQuarkTrashBatch).mockResolvedValue(['movie'])
 vi.mocked(quarkTrashPage).mockResolvedValue({entries:[row()],nextCursor:undefined} as any)
})
describe('Quark recycle completion confirmation',()=>{
 it('requires a matching actual recycle record after request acceptance',async()=>{
  expect(await trashQuarkFile(account,file,()=>current)).toBe(true)
  expect(apiQuarkTrashBatch).toHaveBeenCalledOnce();expect(quarkTrashPage).toHaveBeenCalledOnce()
 })
 it('retains an absent result and only queries on retry',async()=>{
  vi.mocked(quarkTrashPage).mockResolvedValueOnce({entries:[],nextCursor:undefined})
  await expect(trashQuarkFile(account,file,()=>true)).rejects.toThrow('尚未确认')
  expect(await trashQuarkFile(account,file,()=>true)).toBe(true)
  expect(apiQuarkTrashBatch).toHaveBeenCalledOnce()
 })
 it('confirms an unknown network submission by reading actual state',async()=>{
  vi.mocked(apiQuarkTrashBatch).mockRejectedValue(Error('connection lost'))
  expect(await trashQuarkFile(account,file,()=>true)).toBe(true)
 })
 it('releases a definite rejection so an intentional retry can submit',async()=>{
  vi.mocked(apiQuarkTrashBatch).mockRejectedValueOnce(new QuarkRequestRejected('rejected'))
  await expect(trashQuarkFile(account,file,()=>true)).rejects.toThrow('rejected')
  expect(quarkTrashPage).not.toHaveBeenCalled()
  expect(await trashQuarkFile(account,file,()=>true)).toBe(true)
  expect(apiQuarkTrashBatch).toHaveBeenCalledTimes(2)
 })
 it.each([{name:'Other.mkv'},{isDirectory:true},{electronModel:{description:'quark_fid:movie'}}])('rejects a mismatched recycle record %j',async patch=>{
  vi.mocked(quarkTrashPage).mockResolvedValue({entries:[{...row(),...patch}],nextCursor:undefined} as any)
  await expect(trashQuarkFile(account,file,()=>true)).rejects.toThrow('不匹配')
 })
 it('reads later pages without reposting the delete',async()=>{
  vi.mocked(quarkTrashPage).mockResolvedValueOnce({entries:[row('other')],nextCursor:'next'} as any)
  expect(await trashQuarkFile(account,file,()=>true)).toBe(true)
  expect(quarkTrashPage).toHaveBeenLastCalledWith(account,'next');expect(apiQuarkTrashBatch).toHaveBeenCalledOnce()
 })
 it('rejects repeated identities across nonadjacent pages',async()=>{
  vi.mocked(quarkTrashPage).mockResolvedValueOnce({entries:[row('a')],nextCursor:'two'} as any).mockResolvedValueOnce({entries:[row('b')],nextCursor:'three'} as any).mockResolvedValueOnce({entries:[row('a')],nextCursor:'four'} as any)
  await expect(trashQuarkFile(account,file,()=>true)).rejects.toThrow('跨页重复')
 })
 it('does not finish or read further after a source switch',async()=>{
  vi.mocked(apiQuarkTrashBatch).mockImplementation(async()=>{current=false;return ['movie']})
  await expect(trashQuarkFile(account,file,()=>current)).rejects.toThrow('切换')
  expect(quarkTrashPage).not.toHaveBeenCalled()
  current=true;expect(await trashQuarkFile(account,file,()=>current)).toBe(true)
  expect(apiQuarkTrashBatch).toHaveBeenCalledOnce()
 })
 it('rejects an account owner replacement after submission',async()=>{
  vi.mocked(apiQuarkTrashBatch).mockImplementation(async()=>{useFileSourcesStore().accounts=[{...account,userId:'another'}];return ['movie']})
  await expect(trashQuarkFile(account,file,()=>true)).rejects.toThrow('身份')
  expect(quarkTrashPage).not.toHaveBeenCalled()
 })
 it('coalesces concurrent identical operations',async()=>{
  let finish!:(value:string[])=>void
  vi.mocked(apiQuarkTrashBatch).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const first=trashQuarkFile(account,file,()=>true),second=trashQuarkFile(account,file,()=>true)
  finish(['movie']);expect(await Promise.all([first,second])).toEqual([true,true]);expect(apiQuarkTrashBatch).toHaveBeenCalledOnce()
 })
})
