import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {rawRequest} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {createRemoteFolder,supportsRemoteFolderCreation} from '@/features/files/drive/folderMutations'
import {baiduFolderFetch} from '@/features/files/drive/baiduFolderTransport'
vi.mock('@/features/sources/transport',()=>({rawRequest:vi.fn(),json:vi.fn(),request:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
const account={id:'fixture',providerId:'baidu' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
const response=(data:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let result:any
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];result={errno:0,fs_id:'9007199254740997',isdir:1,path:'/Folder'};vi.mocked(rawRequest).mockImplementation(async()=>response(result))})
it('keeps the original create form, timestamps and native account credential boundary',async()=>{
 expect(supportsRemoteFolderCreation(account)).toBe(true);expect(await createRemoteFolder(account,'baidu_root','Folder')).toEqual({file_id:'9007199254740997',error:''})
 const call=vi.mocked(rawRequest).mock.calls[0]!,form=new URLSearchParams(call[3])
 expect(call.slice(0,3)).toEqual([account,'POST','https://pan.baidu.com/rest/2.0/xpan/file?method=create'])
 expect(Object.fromEntries(form)).toMatchObject({path:'/Folder',isdir:'1',rtype:'0'});expect(form.get('local_ctime')).toBe(form.get('local_mtime'));expect(Number(form.get('local_ctime'))).toBeGreaterThan(0)
 expect(call[2]).not.toContain('access_token');expect(call[4]).toEqual({'content-type':'application/x-www-form-urlencoded','user-agent':'pan.baidu.com'})
})
it.each(['','root','backup_root','baidu_root','/'])('normalizes only exact root alias %j',async parent=>{expect((await createRemoteFolder(account,parent,'Folder')).file_id).toBe('9007199254740997')})
it.each(['/root-library','/Movie/root','/backup_root/视频'])('preserves physical parent %j containing root instead of creating at drive root',async parent=>{
 result.path=parent+'/新目录';expect((await createRemoteFolder(account,parent,'新目录')).file_id).toBe(result.fs_id);expect(new URLSearchParams(vi.mocked(rawRequest).mock.calls[0]![3]).get('path')).toBe(result.path)
})
it.each([[-8,'文件夹已存在'],[-10,'云端容量已满'],[-7,'文件夹名错误或无权限'],[403,'创建文件夹失败']])('retains original error mapping for errno %s',async(errno,message)=>{
 result={errno};await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow(message as string)
})
it.each([{path:'/Other'},{isdir:0},{fs_id:0},{fs_id:''},{errno:undefined},null])('does not report success for conflicting or malformed receipt %j',async patch=>{
 result=patch===null?null:{...result,...patch};await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow()
})
it.each(['/folder/../other','/folder//other','/folder/','relative','/folder\\other'])('rejects unsafe parent %j before writing',async parent=>{
 await expect(createRemoteFolder(account,parent,'Folder')).rejects.toThrow('路径');expect(rawRequest).not.toHaveBeenCalled()
})
it('retains original non-2xx failure and rejects account removal during the request',async()=>{
 vi.mocked(rawRequest).mockResolvedValueOnce(response({},403));await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('创建文件夹失败')
 vi.mocked(rawRequest).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[];return response(result)});await expect(createRemoteFolder(account,'','Folder')).rejects.toThrow('来源不匹配')
})
it('refuses token-bearing URLs and file upload bodies at the folder-only boundary',async()=>{
 await expect(baiduFolderFetch(account.id,'https://pan.baidu.com/rest/2.0/xpan/file?method=create&access_token=fixture',{method:'POST',body:''})).rejects.toThrow('未适配')
 await expect(baiduFolderFetch(account.id,'https://pan.baidu.com/rest/2.0/xpan/file?method=precreate',{method:'POST',body:''})).rejects.toThrow('未适配');expect(rawRequest).not.toHaveBeenCalled()
})
