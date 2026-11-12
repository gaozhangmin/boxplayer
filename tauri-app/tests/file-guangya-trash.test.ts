import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {mutateTrash,supportsRemoteTrashMove,supportsRemoteTrash,supportsRemoteTrashDelete,supportsRemoteTrashEmpty} from '@/features/files/drive/trashMutations'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
const account={id:'fixture',providerId:'guangya' as const,name:'Fixture',baseUrl:'',authOrigins:[]},file={drive_id:'fixture',file_id:'file',name:'Movie.mkv',isDir:false} as IAliGetFileModel
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];vi.mocked(request).mockResolvedValue(response({code:0,data:{}}))})
it('retains the original recycle request without exposing unsupported recycle-bin management',async()=>{expect(supportsRemoteTrashMove(account)).toBe(true);expect(supportsRemoteTrash(account)).toBe(false);expect(supportsRemoteTrashDelete(account)).toBe(false);expect(supportsRemoteTrashEmpty(account)).toBe(false);expect(await mutateTrash(account,[file],'trash',()=>true)).toEqual({success:['file'],failures:[]});expect(request).toHaveBeenCalledWith(account,'POST','https://api.guangyapan.com/nd.bizuserres.s/v1/file/delete_file','{"fileIds":["file"]}',{'Content-Type':'application/json'})})
it.each(['restore','purge','permanent'] as const)('rejects unsupported %s before requests',async operation=>{await expect(mutateTrash(account,[file],operation,()=>true)).rejects.toThrow('不支持');expect(request).not.toHaveBeenCalled()})
it('preserves partial failures and stops after a source switch',async()=>{vi.mocked(request).mockResolvedValueOnce(response({code:403}));const result=await mutateTrash(account,[file,{...file,file_id:'second'}],'trash',()=>true);expect(result.success).toEqual(['second']);expect(result.failures[0]).toContain('未确认');vi.mocked(request).mockClear();expect((await mutateTrash(account,[file],'trash',()=>false)).success).toEqual([]);expect(request).not.toHaveBeenCalled()})
it('rejects wrong-source selections and invalid IDs',async()=>{await expect(mutateTrash(account,[{...file,drive_id:'other'}],'trash',()=>true)).rejects.toThrow('来源');expect((await mutateTrash(account,[{...file,file_id:'../bad'}],'trash',()=>true)).success).toEqual([]);expect(request).not.toHaveBeenCalled()})
