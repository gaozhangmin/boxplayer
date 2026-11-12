import { afterEach, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import Profile from '@/features/sources/BoxPlayerAccount.vue'
import { nativeCall } from '@/platform/native'
import { accountsList } from '@/features/sources/transport'
vi.mock('@/platform/native',()=>({isNative:()=>true,nativeCall:vi.fn(),localSources:vi.fn(async()=>[]),asAppError:(e:unknown)=>e}))
vi.mock('@/features/sources/transport',()=>({accountsList:vi.fn(async()=>[])}))
vi.mock('qrcode',()=>({default:{toDataURL:vi.fn(async()=>'data:image/png;base64,test')}}))
let wrapper:ReturnType<typeof mount>|undefined
afterEach(()=>{wrapper?.unmount();document.body.innerHTML='';vi.clearAllMocks();vi.useRealTimers()})
it('reads only the own-account membership and preserves the platform scope',async()=>{
 vi.mocked(accountsList).mockResolvedValue([{id:'own',providerId:'boxplayer',name:'person@example.test',baseUrl:'https://site.test',authOrigins:['https://site.test']}])
 vi.mocked(nativeCall).mockResolvedValue({accountId:'own',isPro:true,entitlementScope:'android',plan:'android_lifetime'})
 wrapper=mount(Profile,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises()
 const view=new DOMWrapper(document.body);expect(view.text()).toContain('BoxPlayer Pro · Android');expect(nativeCall).toHaveBeenCalledWith('boxplayer_subscription',{accountId:'own'})
 await view.findAll('button').find(b=>b.text()==='在官网查看会员方案')!.trigger('click');expect(nativeCall).toHaveBeenCalledWith('open_website',{target:'pro'})
})
it('does not start login until requested and cancels a late QR result on unmount',async()=>{
 vi.mocked(accountsList).mockResolvedValue([]);let resolve!:(value:unknown)=>void
 vi.mocked(nativeCall).mockImplementation(command=>command==='boxplayer_begin'?new Promise(done=>{resolve=done}):Promise.resolve(true))
 wrapper=mount(Profile,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();expect(nativeCall).not.toHaveBeenCalled()
 const view=new DOMWrapper(document.body);await view.findAll('button').find(b=>b.text()==='扫码登录 BoxPlayer')!.trigger('click');await flushPromises()
 wrapper.unmount();await flushPromises();expect(nativeCall).toHaveBeenCalledWith('auth_cancel',expect.objectContaining({requestId:expect.any(String)}))
 resolve({sessionId:'late-own-session',content:'https://site.test/account/',userCode:'PUBLIC',interval:5,expiresIn:600});await flushPromises();expect(nativeCall).toHaveBeenCalledWith('boxplayer_cancel',{sessionId:'late-own-session'})
})
it('opens the browser only on request using the active native session',async()=>{
 vi.useFakeTimers();vi.mocked(accountsList).mockResolvedValue([])
 vi.mocked(nativeCall).mockImplementation(async command=>command==='boxplayer_begin'?{sessionId:'own-session',content:'https://site.test/account/?code=PUBLIC',userCode:'PUBLIC',interval:5,expiresIn:600}:true)
 wrapper=mount(Profile,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises()
 const view=new DOMWrapper(document.body);await view.findAll('button').find(b=>b.text()==='扫码登录 BoxPlayer')!.trigger('click');await flushPromises()
 expect(nativeCall).not.toHaveBeenCalledWith('boxplayer_browser',expect.anything())
 await view.findAll('button').find(b=>b.text()==='在浏览器登录')!.trigger('click');expect(nativeCall).toHaveBeenCalledWith('boxplayer_browser',{sessionId:'own-session'})
})
