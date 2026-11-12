import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {renameRemoteFile,supportsRemoteRename} from '@/features/files/drive/renameMutations'
import {pendingCloud189RenameName,acknowledgeCloud189Rename} from '@/features/files/drive/cloud189Rename'
import {rawRequest,json} from '@/features/sources/transport'
import type {Account} from '@/features/sources/contracts'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),rawRequest:vi.fn(),json:vi.fn()}))
const response=(data:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let count=0,account:Account,actual:string,result:any,status:number,current:boolean,apply:boolean
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());account={id:'rename189-'+(++count),providerId:'189',name:'Fixture',userId:'owner',baseUrl:'https://api.cloud.189.cn',authOrigins:[]};useFileSourcesStore().accounts=[account];actual='Old.mkv';result={};status=200;current=true;apply=true
 vi.mocked(rawRequest).mockImplementation(async()=>{if(apply&&status===200)actual='New.mkv';return response(result,status)})
 vi.mocked(json).mockImplementation(async(_a,_m,url)=>({fileListAO:{folderList:[],fileList:[{id:'9007199254740997',name:actual,size:42}]}}))
})
function file(family=false,folder=false){return {file_id:JSON.stringify({fileId:'9007199254740997',...(family?{familyId:'9007199254740999'}:{})}),parent_file_id:JSON.stringify({fileId:family?'':'-11',...(family?{familyId:'9007199254740999'}:{})}),name:'Old.mkv',isDir:folder}}
it.each([{family:false,folder:false},{family:false,folder:true},{family:true,folder:false},{family:true,folder:true}])('retains original personal/family and file/folder rename protocol %j',async({family,folder})=>{
 const selected=file(family,folder)
 if(folder)vi.mocked(json).mockImplementation(async()=>({fileListAO:{folderList:[{id:'9007199254740997',name:actual}],fileList:[]}}))
 expect(supportsRemoteRename(account)).toBe(true);const renamed=await renameRemoteFile(account,selected,'New.mkv')
 expect(renamed).toMatchObject({file_id:selected.file_id,parent_file_id:selected.parent_file_id,isDir:folder,name:'New.mkv'})
 const call=vi.mocked(rawRequest).mock.calls[0]!,url=new URL(call[2]);expect(call[0]).toEqual(account);expect(call[1]).toBe(family?'GET':'POST');expect(call[3]).toBeUndefined();expect(url.pathname).toBe((family?'/family/file/':'/')+(folder?'renameFolder.action':'renameFile.action'))
 expect(Object.fromEntries(url.searchParams)).toEqual({[folder?'folderId':'fileId']:'9007199254740997',[folder?'destFolderName':'destFileName']:'New.mkv',...(family?{familyId:'9007199254740999'}:{})})
 expect(pendingCloud189RenameName(account.id,selected.file_id)).toBe('New.mkv');acknowledgeCloud189Rename(account.id,renamed);expect(pendingCloud189RenameName(account.id,selected.file_id)).toBeUndefined()
})
it('does not trust original success receipt without the actual new name',async()=>{
 apply=false;const selected=file();await expect(renameRemoteFile(account,selected,'New.mkv')).rejects.toThrow('尚未确认');expect(rawRequest).toHaveBeenCalledOnce()
 actual='New.mkv';expect((await renameRemoteFile(account,selected,'New.mkv')).name).toBe('New.mkv');expect(rawRequest).toHaveBeenCalledOnce()
})
it('queries actual state after an ambiguous submission and never reposts during retry',async()=>{
 apply=false;vi.mocked(rawRequest).mockRejectedValue(Error('lost response'));const selected=file()
 await expect(renameRemoteFile(account,selected,'New.mkv')).rejects.toThrow('尚未确认');await expect(renameRemoteFile(account,selected,'New.mkv')).rejects.toThrow('尚未确认')
 actual='New.mkv';expect((await renameRemoteFile(account,selected,'New.mkv')).name).toBe('New.mkv');expect(rawRequest).toHaveBeenCalledOnce()
})
it.each([403,409,429])('releases explicit HTTP %s refusal for intentional retry',async denied=>{
 status=denied;const selected=file();await expect(renameRemoteFile(account,selected,'New.mkv')).rejects.toThrow('拒绝');status=200
 expect((await renameRemoteFile(account,selected,'New.mkv')).name).toBe('New.mkv');expect(rawRequest).toHaveBeenCalledTimes(2)
})
it.each([408,500])('keeps HTTP %s uncertain and queries instead of resubmitting',async uncertain=>{
 status=uncertain;const selected=file();await expect(renameRemoteFile(account,selected,'New.mkv')).rejects.toThrow('尚未确认');await expect(renameRemoteFile(account,selected,'New.mkv')).rejects.toThrow('尚未确认');expect(rawRequest).toHaveBeenCalledOnce()
})
it.each([{success:false},{errorCode:'InvalidSessionKey'},{res_code:'1'},{code:'DENIED'}])('releases explicit business refusal %j',async failure=>{
 apply=false;result=failure;const selected=file();await expect(renameRemoteFile(account,selected,'New.mkv')).rejects.toThrow('拒绝')
 result={};apply=true;expect((await renameRemoteFile(account,selected,'New.mkv')).name).toBe('New.mkv');expect(rawRequest).toHaveBeenCalledTimes(2)
})
it('does not re-submit after a malformed response that could have followed a successful write',async()=>{
 apply=false;result={res_code:{invalid:true}};const selected=file();await expect(renameRemoteFile(account,selected,'New.mkv')).rejects.toThrow('尚未确认');await expect(renameRemoteFile(account,selected,'New.mkv')).rejects.toThrow('尚未确认');expect(rawRequest).toHaveBeenCalledOnce()
})
it('rejects changed original metadata or cross-family parent before writing',async()=>{
 actual='External.mkv';await expect(renameRemoteFile(account,file(),'New.mkv')).rejects.toThrow('已变化');expect(rawRequest).not.toHaveBeenCalled()
 const selected={...file(true),parent_file_id:JSON.stringify({fileId:'',familyId:'7'})};await expect(renameRemoteFile(account,selected,'New.mkv')).rejects.toThrow('空间不匹配')
})
it('coalesces concurrent identical renames and blocks another name until sync',async()=>{
 const selected=file(),results=await Promise.all([renameRemoteFile(account,selected,'New.mkv'),renameRemoteFile(account,selected,'New.mkv')]);expect(results[0]).toEqual(results[1]);expect(rawRequest).toHaveBeenCalledOnce()
 await expect(renameRemoteFile(account,selected,'Other.mkv')).rejects.toThrow('此前重命名')
})
it('stops on source close or account replacement before confirmation',async()=>{
 const selected=file();vi.mocked(rawRequest).mockImplementationOnce(async()=>{current=false;return response({})})
 await expect(renameRemoteFile(account,selected,'New.mkv',()=>current)).rejects.toThrow('切换')
 current=true;useFileSourcesStore().accounts=[{...account,userId:'different'}];await expect(renameRemoteFile(account,selected,'New.mkv')).rejects.toThrow()
})

it('releases an unsubmitted intent when its source closes during preflight',async()=>{
 const original=vi.mocked(json).getMockImplementation()!,selected=file()
 vi.mocked(json).mockImplementationOnce(async(...args)=>{const value=await original(...args);current=false;return value})
 await expect(renameRemoteFile(account,selected,'New.mkv',()=>current)).rejects.toThrow('切换');expect(rawRequest).not.toHaveBeenCalled();expect(pendingCloud189RenameName(account.id,selected.file_id)).toBeUndefined()
 current=true;expect((await renameRemoteFile(account,selected,'New.mkv',()=>current)).name).toBe('New.mkv');expect(rawRequest).toHaveBeenCalledOnce()
})
