import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {defineComponent} from 'vue'
import {mount,flushPromises} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {nativeCall} from '@/platform/native'
import {useNativeLogin} from '@/features/files/adapters/nativeLogin'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:String(cause)})}))
let wrapper:ReturnType<typeof mount>,login:ReturnType<typeof useNativeLogin>
const result=(status=207)=>({status,headers:{},finalUrl:'https://fixture.invalid/dav/',body:Array.from(new TextEncoder().encode('<d:multistatus xmlns:d="DAV:"/>'))})
function start(){const emit=vi.fn();wrapper=mount(defineComponent({setup(){login=useNativeLogin({provider:'webdav'},emit);return{}},template:'<div/>'}),{global:{plugins:[createPinia()]}});Object.assign(login.remoteDriveForm,{name:'Draft',url:'https://fixture.invalid/dav/',username:'fixture-user',password:'fixture-password',rootPath:'/'});return emit}
beforeEach(()=>{vi.clearAllMocks();const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)});vi.mocked(nativeCall).mockImplementation(async command=>command==='account_save'?{id:'saved',name:'Draft',providerId:'webdav',baseUrl:'https://fixture.invalid/dav/',authOrigins:[]}:true as never)})
afterEach(()=>wrapper?.unmount())
it('tests draft credentials before writing any account and saves only on success',async()=>{
 let resolve!:(value:unknown)=>void;vi.mocked(nativeCall).mockImplementation(async command=>command==='http_request'?await new Promise(done=>{resolve=done}):command==='account_save'?{id:'saved',name:'Draft',providerId:'webdav'}:true as never)
 const emit=start(),work=login.submitRemoteDrive();await flushPromises();expect(vi.mocked(nativeCall).mock.calls.some(([command])=>command==='account_save')).toBe(false)
 resolve(result());await work;expect(nativeCall).toHaveBeenCalledWith('http_request',expect.objectContaining({request:expect.objectContaining({method:'PROPFIND',accountId:''})}));expect(vi.mocked(nativeCall).mock.calls.some(([command])=>command==='account_save')).toBe(true);expect(emit).toHaveBeenCalledWith('connected')
})
it('retains the form and shows an authentication failure without saving',async()=>{
 vi.mocked(nativeCall).mockImplementation(async command=>command==='http_request'?result(401):true as never);const emit=start();await login.submitRemoteDrive();expect(login.connectionFailure.value).toContain('用户名或密码');expect(login.remoteDriveForm.password).toBe('fixture-password');expect(vi.mocked(nativeCall).mock.calls.some(([command])=>command==='account_save')).toBe(false);expect(emit).not.toHaveBeenCalled()
})
it('does not save after cancellation while the connection test is pending',async()=>{
 let resolve!:(value:unknown)=>void;vi.mocked(nativeCall).mockImplementation(async command=>command==='http_request'?await new Promise(done=>{resolve=done}):true as never);const emit=start(),work=login.submitRemoteDrive();await flushPromises();login.cancelRemoteConnection();resolve(result());await work;expect(vi.mocked(nativeCall).mock.calls.some(([command])=>command==='account_save')).toBe(false);expect(emit).not.toHaveBeenCalled();expect(login.connectionFailure.value).toBe('')
})
