import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {rawRequest as request,json} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {createRemoteText} from '@/features/files/drive/textCreation'
vi.mock('@/features/sources/transport',()=>({rawRequest:vi.fn(),request:vi.fn(),json:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
const account={id:'fixture',providerId:'dropbox' as const,name:'Fixture',baseUrl:'',authOrigins:['https://api.dropboxapi.com']},content='中文🎬',name='电影.txt'
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let detail:any,parent:any
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];detail={id:'id:created','.tag':'file',name,path_display:'/电影.txt',size:new TextEncoder().encode(content).length};parent={id:'id:parent','.tag':'folder',path_display:'/Parent'};vi.mocked(json).mockImplementation(async(_account,_method,_url,body)=>((body as any).path==='id:created'?detail:parent));vi.mocked(request).mockResolvedValue(response({id:'id:created'}))})
it('retains the original refuse commit mode and sends ASCII-safe Unicode API arguments',async()=>{expect(await createRemoteText(account,'dropbox_root',name,content)).toBe('success');const call=vi.mocked(request).mock.calls[0]!;expect(call.slice(0,4)).toEqual([account,'POST','https://content.dropboxapi.com/2/files/upload',content]);const arg=call[4]!['Dropbox-API-Arg']!;expect(arg).not.toMatch(/[^\x00-\x7f]/);expect(JSON.parse(arg)).toEqual({path:'/电影.txt',mode:'add',autorename:false,mute:false,strict_conflict:false});expect(call[4]).not.toHaveProperty('Authorization')})
it('resolves an id parent and confirms the actual returned path',async()=>{detail.path_display='/Parent/电影.txt';expect(await createRemoteText(account,'id:parent',name,content)).toBe('success');expect(json).toHaveBeenCalledWith(account,'POST','https://api.dropboxapi.com/2/files/get_metadata',{path:'id:parent'})})
it.each([{id:'wrong'},{'.tag':'folder'},{name:'wrong'},{path_display:'/Elsewhere/电影.txt'},{size:1}])('rejects conflicting created metadata %j',async patch=>{detail={...detail,...patch};await expect(createRemoteText(account,'',name,content)).rejects.toThrow('未确认')})
it('rejects a conflicting parent identity before creating content',async()=>{parent.id='id:wrong';await expect(createRemoteText(account,'id:parent',name,content)).rejects.toThrow('目标');expect(request).not.toHaveBeenCalled()})
it('does not accept a missing id or persistent business error as successful creation',async()=>{
 vi.useFakeTimers()
 try{
  vi.mocked(request).mockResolvedValue(response({error_summary:'path/conflict/file'}))
  const operation=createRemoteText(account,'',name,content),failure=expect(operation).rejects.toThrow('未确认文本创建')
  await vi.runAllTimersAsync();await failure;expect(request).toHaveBeenCalledTimes(3)
  vi.mocked(request).mockResolvedValueOnce(response({path_display:'/电影.txt'}));await expect(createRemoteText(account,'',name,content)).rejects.toThrow('未确认文本创建')
 }finally{vi.useRealTimers()}
})
it('does not submit if the account disappears during parent lookup',async()=>{vi.mocked(json).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[];return parent});await expect(createRemoteText(account,'id:parent',name,content)).rejects.toThrow('来源不匹配');expect(request).not.toHaveBeenCalled()})

it('retains original three-attempt timing and stops immediately after the first successful response',async()=>{
 vi.useFakeTimers()
 try{
  vi.mocked(request).mockResolvedValueOnce({...response({error_summary:'temporary'}),status:503}).mockResolvedValueOnce({...response({error_summary:'temporary'}),status:503})
  const operation=createRemoteText(account,'',name,content)
  await vi.advanceTimersByTimeAsync(0);expect(request).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(799);expect(request).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1);expect(request).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1599);expect(request).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1);expect(await operation).toBe('success');expect(request).toHaveBeenCalledTimes(3)
  expect(vi.mocked(request).mock.calls[0]).toEqual(vi.mocked(request).mock.calls[2])
 }finally{vi.useRealTimers()}
})
it('does not send a retry with another or removed account after waiting',async()=>{
 vi.useFakeTimers()
 try{
  vi.mocked(request).mockRejectedValueOnce(Error('Temporary network failure'))
  const operation=createRemoteText(account,'',name,content),failure=expect(operation).rejects.toThrow('来源不匹配')
  await vi.advanceTimersByTimeAsync(0);expect(request).toHaveBeenCalledTimes(1)
  useFileSourcesStore().accounts=[]
  await vi.runAllTimersAsync();await failure;expect(request).toHaveBeenCalledTimes(1)
 }finally{vi.useRealTimers()}
})
