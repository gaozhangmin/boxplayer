import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {createRemoteFolder,supportsRemoteFolderCreation} from '@/features/files/drive/folderMutations'
import {rawRequest,json} from '@/features/sources/transport'
import {cloud189PostRequest} from '@/features/files/drive/cloud189FolderTransport'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),rawRequest:vi.fn(),json:vi.fn()}))
const account={id:'189-create',providerId:'189' as const,name:'Fixture',baseUrl:'https://api.cloud.189.cn',userId:'owner',authOrigins:[]}
const personal=JSON.stringify({fileId:'-11'}),family=JSON.stringify({fileId:'',familyId:'9007199254740999'})
const response=(data:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(typeof data==='string'?data:JSON.stringify(data))),finalUrl:''})
let result:any,rows:any[],current:boolean
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];current=true
 result={folderId:'9007199254740997'};rows=[{id:'9007199254740997',name:'Folder'}]
 vi.mocked(rawRequest).mockImplementation(async()=>response(result))
 vi.mocked(json).mockImplementation(async()=>({fileListAO:{folderList:rows,fileList:[]}}))
})
it.each([personal,family])('retains the original createFolder POST query in scope %s and confirms actual target directory',async parent=>{
 expect(supportsRemoteFolderCreation(account)).toBe(true)
 const created=await createRemoteFolder(account,parent,'Folder'),location=JSON.parse(parent),call=vi.mocked(rawRequest).mock.calls[0]!,url=new URL(call[2])
 expect(call[0]).toEqual(account);expect(call[1]).toBe('POST');expect(call[3]).toBeUndefined();expect(url.pathname).toBe(location.familyId?'/family/file/createFolder.action':'/createFolder.action')
 expect(Object.fromEntries(url.searchParams)).toEqual(location.familyId?{folderName:'Folder',relativePath:'',familyId:location.familyId,parentId:''}:{folderName:'Folder',relativePath:'',parentFolderId:'-11'})
 expect(JSON.parse(created.file_id)).toEqual({fileId:'9007199254740997',...(location.familyId?{familyId:location.familyId}:{})});expect(created.error).toBe('')
 expect(call[4]).toMatchObject({Accept:'application/json;charset=UTF-8',Referer:'https://cloud.189.cn'});expect(Object.keys(call[4]!).some(key=>/session|signature|authorization/i.test(key))).toBe(false)
 const confirm=new URL(vi.mocked(json).mock.calls[0]![2]);expect(confirm.pathname).toBe(location.familyId?'/family/file/listFiles.action':'/listFiles.action')
})
it('preserves an unquoted large numeric folder ID with the original lossless parser',async()=>{
 result='{"folderId":9007199254740997}'
 expect(JSON.parse((await createRemoteFolder(account,personal,'Folder')).file_id).fileId).toBe('9007199254740997')
})
it.each([{errorCode:'InvalidSessionKey'},{success:false},{res_code:'1'},{code:'ERROR'},{folderId:''},{folderId:'-11'},{folderId:'cloud189_family:7:123'}])('rejects failed or invalid receipt %j without a confirmation read',async value=>{
 result=value;await expect(createRemoteFolder(account,personal,'Folder')).rejects.toThrow();expect(json).not.toHaveBeenCalled()
})
it.each(['',JSON.stringify({fileId:'',families:true}),JSON.stringify({fileId:'cloud189_family:7:123'}),JSON.stringify({fileId:'',familyId:'wrong'})])('refuses an aggregate, ambiguous or invalid destination %s before writing',async parent=>{
 await expect(createRemoteFolder(account,parent,'Folder')).rejects.toThrow();expect(rawRequest).not.toHaveBeenCalled()
})
it('does not confirm a folder in another family',async()=>{
 result={folderId:'9007199254740997',familyId:'different'}
 await expect(createRemoteFolder(account,family,'Folder')).rejects.toThrow('其他家庭');expect(json).not.toHaveBeenCalled()
})
it.each(['absent','wrong-name','file'])('does not report an accepted request as a confirmed folder: %s',async variation=>{
 if(variation==='absent')rows=[]
 else if(variation==='wrong-name')rows[0].name='Other'
 else vi.mocked(json).mockResolvedValue({fileListAO:{folderList:[],fileList:rows}})
 await expect(createRemoteFolder(account,personal,'Folder')).rejects.toThrow()
})
it('reads subsequent original list pages before confirming the new folder',async()=>{
 vi.mocked(json).mockResolvedValueOnce({fileListAO:{folderList:Array.from({length:100},(_,index)=>({id:'old-'+index,name:'Old'})),fileList:[]}}).mockResolvedValueOnce({fileListAO:{folderList:rows,fileList:[]}})
 expect((await createRemoteFolder(account,personal,'Folder')).error).toBe('');expect(new URL(vi.mocked(json).mock.calls[1]![2]).searchParams.get('pageNum')).toBe('2')
})
it('rejects repeated list pages instead of silently confirming a partial directory',async()=>{
 rows=Array.from({length:100},(_,index)=>({id:'old-'+index,name:'Old'}))
 await expect(createRemoteFolder(account,personal,'Folder')).rejects.toThrow('重复文件标识')
})
it('discards the result after account owner replacement and does not read the new account directory',async()=>{
 vi.mocked(rawRequest).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'another'}];return response(result)})
 await expect(createRemoteFolder(account,personal,'Folder')).rejects.toThrow('身份');expect(json).not.toHaveBeenCalled()
})
it('stops before submission or confirmation after its source closes',async()=>{
 await expect(createRemoteFolder(account,personal,'Folder',()=>false)).rejects.toThrow('关闭');expect(rawRequest).not.toHaveBeenCalled()
 vi.mocked(rawRequest).mockImplementationOnce(async()=>{current=false;return response(result)})
 await expect(createRemoteFolder(account,personal,'Folder',()=>current)).rejects.toThrow('关闭');expect(json).not.toHaveBeenCalled()
})
it('rejects an expired native create context and unsupported direct operations',async()=>{
 await expect(cloud189PostRequest('expired','createFolder.action',{folderName:'Folder'})).rejects.toThrow('关闭');expect(rawRequest).not.toHaveBeenCalled()
})
it('does not treat HTTP rejection as an empty success or run a confirmation lookup',async()=>{
 vi.mocked(rawRequest).mockResolvedValueOnce(response({},403));await expect(createRemoteFolder(account,personal,'Folder')).rejects.toThrow('403');expect(json).not.toHaveBeenCalled()
})

it('rejects a confirmation item explicitly belonging to another family',async()=>{
 rows[0].familyId='another'
 await expect(createRemoteFolder(account,family,'Folder')).rejects.toThrow('空间不匹配')
})
