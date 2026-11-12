import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {request,json} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import {createRemoteText} from '@/features/files/drive/textCreation'
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
const account={id:'fixture',providerId:'onedrive' as const,name:'Fixture',baseUrl:'',authOrigins:[]},content='中文\n🎬',name='My 电影 #%.txt'
const response=(data:unknown)=>({status:201,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let target:any,detail:any
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account];target={id:'actual-root',folder:{}};detail={id:'created',name,parentReference:{id:'actual-root'},size:new TextEncoder().encode(content).length,file:{}};vi.mocked(json).mockImplementation(async(_account,_method,url)=>url.includes('/created?')?detail:target);vi.mocked(request).mockResolvedValue(response({id:'created'}))})
it('preserves original encoded upload path, PUT content and owning account',async()=>{expect(await createRemoteText(account,'onedrive_root',name,content)).toBe('success');expect(request).toHaveBeenCalledWith(account,'PUT','https://graph.microsoft.com/v1.0/me/drive/items/actual-root:/My%20%E7%94%B5%E5%BD%B1%20%23%25.txt:/content',content,{'Content-Type':'application/octet-stream'});expect(json).toHaveBeenCalledTimes(2)})
it.each([{id:'wrong'},{name:'wrong'},{parentReference:{id:'wrong'}},{size:1},{file:undefined},{folder:{}},{deleted:{}}])('does not accept conflicting created metadata %j',async patch=>{detail={...detail,...patch};await expect(createRemoteText(account,'',name,content)).rejects.toThrow('未确认')})
it('validates a non-root folder identity before PUT',async()=>{await expect(createRemoteText(account,'other',name,content)).rejects.toThrow('目标');expect(request).not.toHaveBeenCalled()})
it('rejects provider errors even if an id is returned',async()=>{vi.mocked(request).mockResolvedValueOnce({...response({id:'created'}),status:403});await expect(createRemoteText(account,'',name,content)).rejects.toThrow('未确认文本创建');vi.mocked(request).mockResolvedValueOnce(response({error:{message:'Denied'}}));await expect(createRemoteText(account,'',name,content)).rejects.toThrow('未确认文本创建')})
it('stops before PUT when the account disappears during preflight',async()=>{vi.mocked(json).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[];return target});await expect(createRemoteText(account,'',name,content)).rejects.toThrow('来源不匹配');expect(request).not.toHaveBeenCalled()})
it('rejects invalid path-bearing filenames through the shared text boundary',async()=>{await expect(createRemoteText(account,'','../bad',content)).rejects.toThrow('参数无效');expect(json).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled()})
