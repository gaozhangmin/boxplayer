import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {json} from '@/features/sources/transport'
import {relocateRemoteFiles} from '@/features/files/drive/relocationMutations'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({json:vi.fn()}))
const source={id:'second-google',providerId:'google' as const,name:'Google',baseUrl:'',authOrigins:[]}
const file={file_id:'opaque/id',drive_id:source.id,parent_file_id:'stale-parent',name:'Movie.mkv',isDir:false} as IAliGetFileModel
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[source]})
describe('Google Drive read-only relocation guard',()=>{
 it.each([true,false])('rejects relocation before network access (copy: %s)',async(copy)=>{
  await expect(relocateRemoteFiles(source,[file],'target',copy,()=>true)).rejects.toThrow('移动/复制接口尚未接入')
  expect(json).not.toHaveBeenCalled()
 })
})
