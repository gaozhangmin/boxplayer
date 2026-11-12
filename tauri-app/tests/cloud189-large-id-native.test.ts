import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {nativeCall} from '@/platform/native'
import {useFileSourcesStore} from '@/stores/fileSources'
import {cloud189} from '@/features/sources/cloud189'
import {createRemoteFolder} from '@/features/files/drive/folderMutations'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn()}))
const account={id:'189-native-fixture',providerId:'189' as const,name:'Fixture',baseUrl:'https://api.cloud.189.cn',authOrigins:[]}
const response=(raw:string)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(raw)),finalUrl:''})
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account]})
it('uses original lossless JSON for raw numeric IDs in personal/family reads',async()=>{
 vi.mocked(nativeCall).mockResolvedValueOnce(response('{"familyInfoResp":[{"familyId":9007199254740999,"remarkName":"Family"}]}')).mockResolvedValueOnce(response('{"fileListAO":{"folderList":[],"fileList":[{"id":9007199254740997,"name":"Clip.mkv","size":"42"}]}}'))
 const families=await cloud189.list(account,JSON.stringify({fileId:'',families:true})),folder=families.entries[0]!
 expect(JSON.parse(folder.id).familyId).toBe('9007199254740999')
 expect(JSON.parse((await cloud189.list(account,folder.id)).entries[0]!.id)).toEqual({fileId:'9007199254740997',familyId:'9007199254740999'})
})
it('confirms original create through raw native POST and GET bytes without rounding either response',async()=>{
 vi.mocked(nativeCall).mockImplementation(async(command,args:any)=>{
  expect(command).toBe('http_request');expect(args.request.accountId).toBe(account.id)
  return args.request.method==='POST'?response('{"folderId":9007199254740997}'):response('{"fileListAO":{"folderList":[{"id":9007199254740997,"name":"Folder"}],"fileList":[]}}')
 })
 expect(JSON.parse((await createRemoteFolder(account,JSON.stringify({fileId:'-11'}),'Folder')).file_id)).toEqual({fileId:'9007199254740997'})
 expect(nativeCall).toHaveBeenCalledTimes(2)
})
