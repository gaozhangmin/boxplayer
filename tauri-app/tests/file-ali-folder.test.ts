import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {createRemoteFolder,supportsRemoteFolderCreation} from '@/features/files/drive/folderMutations'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(row:{body:number[]})=>new TextDecoder().decode(new Uint8Array(row.body))}))
const {pane}=vi.hoisted(()=>({pane:{sourceId:'source',context:0,file:vi.fn(),tree:{selectDir:{file_id:'',isDir:true}}}}))
vi.mock('@/features/files/drive/ports',()=>({getDrivePane:()=>pane}))
const account={id:'source',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]},location=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId})
const response=(body:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(body))),finalUrl:''})
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];pane.sourceId='source';pane.context++;pane.file.mockReturnValue({isDir:true});pane.tree.selectDir={file_id:'',isDir:true}})
describe('original Ali plain folder method through native locations',()=>{
 it.each(['resources','backup'])('uses real %s drive, never the account UUID',async drive=>{
  vi.mocked(request).mockResolvedValue(response({file_id:'new',drive_id:drive,parent_file_id:'root',type:'folder',name:'Folder'}))
  expect(supportsRemoteFolderCreation(account)).toBe(true);expect(await createRemoteFolder(account,location(drive,'root'),'Folder')).toEqual({file_id:location(drive,'new'),error:''})
  expect(request).toHaveBeenCalledExactlyOnceWith(account,'POST','https://api.aliyundrive.com/adrive/v2/file/createWithFolders',JSON.stringify({drive_id:drive,parent_file_id:'root',name:'Folder',check_name_mode:'refuse',type:'folder',description:''}),{'Content-Type':'application/json'})
 })
 it('does not rewrite a real parent ID containing root',async()=>{
  vi.mocked(request).mockResolvedValue(response({file_id:'new',drive_id:'drive',parent_file_id:'real-root-folder',type:'folder',name:'Folder'}));await createRemoteFolder(account,location('drive','real-root-folder'),'Folder')
  expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!)).toMatchObject({parent_file_id:'real-root-folder'})
 })
 it('accepts the successfully read current directory when opened directly from a favorite',async()=>{
  const parent=location('drive','favorite');pane.file.mockReturnValue(undefined);pane.tree.selectDir={file_id:parent,isDir:true};vi.mocked(request).mockResolvedValue(response({file_id:'new',drive_id:'drive',parent_file_id:'favorite',type:'folder',name:'Folder'}));expect((await createRemoteFolder(account,parent,'Folder')).file_id).toBe(location('drive','new'))
 })
 it.each(['','backup_root','root','{"driveId":"drive"}'])('rejects virtual/invalid location %s without writing',async parent=>{
  await expect(createRemoteFolder(account,parent,'Folder')).rejects.toThrow();expect(request).not.toHaveBeenCalled()
 })
 it.each([{file_id:'new'}, {file_id:'new',drive_id:'wrong',parent_file_id:'root',type:'folder',name:'Folder'},{file_id:'new',drive_id:'drive',parent_file_id:'wrong',type:'folder',name:'Folder'}])('rejects mismatched creation receipt %j',async body=>{
  vi.mocked(request).mockResolvedValue(response(body));await expect(createRemoteFolder(account,location('drive','root'),'Folder')).rejects.toThrow('不匹配')
 })
 it('keeps original quota/business errors and does not use web API for open channel',async()=>{
  vi.mocked(request).mockResolvedValue(response({code:'QuotaExhausted.Drive'}));await expect(createRemoteFolder(account,location('drive','root'),'Folder')).rejects.toThrow('网盘空间已满')
  expect(supportsRemoteFolderCreation({...account,providerId:'alipan-open'})).toBe(true)
 })
 it('rejects unread or non-directory targets and source switches',async()=>{
  pane.file.mockReturnValue({isDir:false});await expect(createRemoteFolder(account,location('drive','root'),'Folder')).rejects.toThrow('已读取');expect(request).not.toHaveBeenCalled()
  pane.file.mockReturnValue({isDir:true});vi.mocked(request).mockImplementationOnce(async()=>{pane.context++;return response({file_id:'new',drive_id:'drive',parent_file_id:'root',type:'folder',name:'Folder'})});await expect(createRemoteFolder(account,location('drive','root'),'Folder')).rejects.toThrow('已切换')
 })
})

describe('open channel native endpoint adaptation with unchanged original folder method',()=>{
 const open={...account,providerId:'alipan-open' as const},detail={file_id:'new',drive_id:'drive',parent_file_id:'root',type:'folder',name:'Folder'}
 beforeEach(()=>{useFileSourcesStore().accounts=[open]})
 it('uses only the open create/get endpoints with the selected real drive',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response({file_id:'new'})).mockResolvedValueOnce(response(detail))
  expect(await createRemoteFolder(open,location('drive','root'),'Folder')).toEqual({file_id:location('drive','new'),error:''})
  expect(request).toHaveBeenNthCalledWith(1,open,'POST','https://openapi.alipan.com/adrive/v1.0/openFile/create',JSON.stringify({drive_id:'drive',parent_file_id:'root',name:'Folder',check_name_mode:'refuse',type:'folder'}),{'Content-Type':'application/json'})
  expect(request).toHaveBeenNthCalledWith(2,open,'POST','https://openapi.alipan.com/adrive/v1.0/openFile/get',JSON.stringify({drive_id:'drive',file_id:'new'}),{'Content-Type':'application/json'})
 })
 it.each([{file_id:'other'},{drive_id:'other'},{parent_file_id:'other'},{type:'file'},{name:'Other'},{code:'InvalidAccessToken'}])('does not accept an unverified open folder %j',async patch=>{
  vi.mocked(request).mockResolvedValueOnce(response({file_id:'new'})).mockResolvedValueOnce(response({...detail,...patch}))
  await expect(createRemoteFolder(open,location('drive','root'),'Folder')).rejects.toThrow('不匹配')
 })
 it('retains original business error handling without fallback to web APIs',async()=>{
  vi.mocked(request).mockResolvedValueOnce(response({code:'QuotaExhausted.Drive'}))
  await expect(createRemoteFolder(open,location('drive','root'),'Folder')).rejects.toThrow('网盘空间已满');expect(request).toHaveBeenCalledTimes(1)
 })
 it.each([{}, {file_id:'root'}])('does not request details for a missing or parent-equal returned ID %j',async data=>{
  vi.mocked(request).mockResolvedValueOnce(response(data));await expect(createRemoteFolder(open,location('drive','root'),'Folder')).rejects.toThrow('不匹配');expect(request).toHaveBeenCalledTimes(1)
 })
 it('stops before reading details after a same-ID account replacement',async()=>{
  vi.mocked(request).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...open,userId:'other'}];return response({file_id:'new'})})
  await expect(createRemoteFolder(open,location('drive','root'),'Folder')).rejects.toThrow('账号已变化');expect(request).toHaveBeenCalledTimes(1)
 })
 it('stops before reading details if the source pane changes',async()=>{
  vi.mocked(request).mockImplementationOnce(async()=>{pane.context++;return response({file_id:'new'})})
  await expect(createRemoteFolder(open,location('drive','root'),'Folder')).rejects.toThrow('已切换');expect(request).toHaveBeenCalledTimes(1)
 })
 it('does not submit if the original caller has already been cancelled',async()=>{
  await expect(createRemoteFolder(open,location('drive','root'),'Folder',()=>false)).rejects.toThrow('已切换');expect(request).not.toHaveBeenCalled()
 })
})
