import { afterEach, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import AccountManager from '@/features/sources/AccountManager.vue'
import { useFileSourcesStore } from '@/stores/fileSources'
import { nativeCall } from '@/platform/native'
vi.mock('@/platform/native',()=>({isNative:()=>true,nativeCall:vi.fn(async()=>true),localSources:vi.fn(async()=>[]),asAppError:(e:unknown)=>e,addLocalSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({accountsList:vi.fn(async()=>[]),accountSave:vi.fn()}))
let wrapper:ReturnType<typeof mount>|undefined
afterEach(()=>{wrapper?.unmount();document.body.innerHTML='';vi.clearAllMocks()})
it('requires explicit confirmation before removing an account and then refreshes the list',async()=>{
 const pinia=createPinia();const sources=useFileSourcesStore(pinia)
 sources.accounts=[{id:'account-a',providerId:'webdav',name:'test-source',baseUrl:'https://example.test',authOrigins:['https://example.test']}]
 wrapper=mount(AccountManager,{attachTo:document.body,global:{plugins:[pinia]}});await flushPromises()
 const view=new DOMWrapper(document.body)
 await view.findAll('button').find(b=>b.text()==='退出')!.trigger('click');await flushPromises()
 expect(nativeCall).not.toHaveBeenCalled()
 await view.findAll('button').find(b=>b.text()==='确认退出本机账号')!.trigger('click');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('account_remove',{accountId:'account-a'})
 expect(view.text()).not.toContain('test-source');expect(view.text()).toContain('还没有登录的账号')
})
