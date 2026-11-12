import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {json,request,rawRequest} from '@/features/sources/transport'
import {createRemoteText} from '@/features/files/drive/textCreation'
import {withTextCreationScope,checkTextCreation} from '@/features/files/drive/textCreationScope'
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),rawRequest:vi.fn(),text:vi.fn()}))
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia())})
const cases=[
 {providerId:'google' as const,parent:'',target:{id:'root-id',mimeType:'application/vnd.google-apps.folder'}},
 {providerId:'onedrive' as const,parent:'',target:{id:'root-id',folder:{}}},
 {providerId:'box' as const,parent:'',target:{id:'0',type:'folder'}},
 {providerId:'dropbox' as const,parent:'id:folder',target:{id:'id:folder','.tag':'folder',path_display:'/Folder'}}
]
it.each(cases)('stops $providerId before writing when the source window changes during preflight',async({providerId,parent,target})=>{
 const account={id:'scope-'+providerId,providerId,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore().accounts=[account];let current=true
 vi.mocked(json).mockImplementationOnce(async()=>{current=false;return target})
 await expect(createRemoteText(account,parent,'Film.txt','content',()=>current)).rejects.toThrow('窗口已关闭')
 expect(request).not.toHaveBeenCalled();expect(rawRequest).not.toHaveBeenCalled()
})
it.each(cases)('stops $providerId before writing after same-ID account replacement',async({providerId,parent,target})=>{
 const account={id:'owner-'+providerId,providerId,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore().accounts=[account]
 vi.mocked(json).mockImplementationOnce(async()=>{useFileSourcesStore().accounts=[{...account,userId:'replacement'}];return target})
 await expect(createRemoteText(account,parent,'Film.txt','content')).rejects.toThrow('账号已变化')
 expect(request).not.toHaveBeenCalled();expect(rawRequest).not.toHaveBeenCalled()
})
it('blocks a second same-source text command while the first preflight is pending, then releases the scope',async()=>{
 const account={id:'concurrent',providerId:'google' as const,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore().accounts=[account];let finish!:(value:string)=>void
 const first=withTextCreationScope(account,()=>true,()=>new Promise<string>(resolve=>finish=resolve))
 await expect(withTextCreationScope(account,()=>true,async()=>'second')).rejects.toThrow('正在进行')
 finish('first');expect(await first).toBe('first');expect(await withTextCreationScope(account,()=>true,async()=>'next')).toBe('next')
})
it('releases failed scopes and permits independent account commands',async()=>{
 const account={id:'failed',providerId:'box' as const,name:'Fixture',baseUrl:'',authOrigins:[]},other={...account,id:'independent'};useFileSourcesStore().accounts=[account,other]
 await expect(withTextCreationScope(account,()=>true,async()=>{expect(await withTextCreationScope(other,()=>true,async()=>'other')).toBe('other');throw Error('failed')})).rejects.toThrow('failed')
 expect(await withTextCreationScope(account,()=>true,async()=>'retry')).toBe('retry')
})
it('checks account identity after a late result and prevents a follow-up retry request',async()=>{
 const account={id:'late',providerId:'dropbox' as const,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore().accounts=[account];let current=true
 await expect(withTextCreationScope(account,()=>current,async()=>{current=false;checkTextCreation(account.id,'dropbox');return 'success'})).rejects.toThrow('窗口已关闭')
 await expect(withTextCreationScope(account,()=>true,async()=>{useFileSourcesStore().accounts=[{...account,userId:'changed'}];return 'success'})).rejects.toThrow('账号已变化')
})
