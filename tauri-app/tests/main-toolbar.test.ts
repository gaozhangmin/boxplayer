import { beforeEach, afterEach,expect,it,vi } from 'vitest'
import { mount,flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import Main from '@/entries/main/App.vue'
vi.mock('@/platform/native',async original=>({...await original<typeof import('@/platform/native')>(),isNative:()=>false}))
vi.mock('vue-sonner',()=>({Toaster:{template:'<div />'},toast:{info:vi.fn(),error:vi.fn()}}))
beforeEach(()=>{const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)})})
afterEach(()=>{document.body.innerHTML='';vi.clearAllMocks()})
it('keeps file actions mounted in the header across root navigation',async()=>{
 const wrapper=mount(Main,{attachTo:document.body,global:{plugins:[createPinia()]}})
 await wrapper.findAll('button').find(b=>b.text()==='文件')!.trigger('click');await flushPromises()
 expect(document.querySelector('#file-toolbar-actions')?.textContent).toContain('添加文件源')
 expect(document.querySelector('.files-browser .file-source-add')).toBeNull()
 await wrapper.findAll('button').find(b=>b.text()==='主屏幕')!.trigger('click');await flushPromises()
 await wrapper.findAll('button').find(b=>b.text()==='文件')!.trigger('click');await flushPromises()
 expect(document.querySelectorAll('#file-toolbar-actions .file-source-add')).toHaveLength(1)
 wrapper.unmount()
})
