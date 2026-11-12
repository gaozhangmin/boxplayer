import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {mutateTrash,supportsRemoteTrashMove,supportsRemoteTrash} from '@/features/files/drive/trashMutations'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),playable:()=>true,text:(value:{body:number[]})=>new TextDecoder().decode(new Uint8Array(value.body))}))
const account={id:'source',providerId:'115' as const,name:'Fixture',baseUrl:'',authOrigins:[]},file={file_id:'1234567890123456789',drive_id:'source',parent_file_id:'12',name:'Movie.mkv',isDir:false} as any,response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];vi.mocked(request).mockResolvedValue(response({code:0,state:true}))})
describe('original 115 trash move request',()=>{
 it('preserves original delete form and confirms only successful IDs',async()=>{expect(supportsRemoteTrashMove(account)).toBe(true);expect(supportsRemoteTrash(account)).toBe(true);expect(await mutateTrash(account,[file],'trash',()=>true)).toEqual({success:[file.file_id],failures:[]});expect(request).toHaveBeenCalledWith(account,'POST','https://proapi.115.com/open/ufile/delete','file_ids='+file.file_id,{'Content-Type':'application/x-www-form-urlencoded'})});
 it('retains failed files on partial provider rejection',async()=>{vi.mocked(request).mockImplementation(async(_a,_m,_u,body)=>response(body==='file_ids=2'?{code:403,message:'拒绝'}:{code:0}));const result=await mutateTrash(account,[file,{...file,file_id:'2',name:'Second'}],'trash',()=>true);expect(result.success).toEqual([file.file_id]);expect(result.failures).toHaveLength(1)});
 it.each(['permanent'] as const)('does not misroute %s into ordinary trash',async op=>{await expect(mutateTrash(account,[file],op,()=>true)).rejects.toThrow('不支持');expect(request).not.toHaveBeenCalled()});
 it('does not accept code zero paired with state false',async()=>{vi.mocked(request).mockResolvedValue(response({code:0,state:false}));const result=await mutateTrash(account,[file],'trash',()=>true);expect(result.success).toEqual([]);expect(result.failures).toHaveLength(1)});
 it('stops the next write after the active context changes',async()=>{let current=true;vi.mocked(request).mockImplementation(async()=>{current=false;return response({code:0})});const result=await mutateTrash(account,[file,{...file,file_id:'2'}],'trash',()=>current);expect(result.success).toEqual([file.file_id]);expect(request).toHaveBeenCalledOnce();expect(result.failures).toHaveLength(1)});
})
