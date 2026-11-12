import { beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { useFileBrowseMode } from '@/features/files/browseMode'
beforeEach(()=>{const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)})})
it('shares grid/list mode through storage and both event spellings',async()=>{
 const wrapper=mount({setup:()=>({grid:useFileBrowseMode()}),template:'<button @click="grid=!grid">{{grid}}</button>'});const event=vi.fn();window.addEventListener('boxplayer:browse-mode-changed',event)
 await wrapper.get('button').trigger('click');expect(localStorage.getItem('MediaLibrary_BrowseMode')).toBe('list');expect(event).toHaveBeenCalled();localStorage.setItem('MediaLibrary_BrowseMode','grid');window.dispatchEvent(new CustomEvent('boxplayer:browse-mode'));await wrapper.vm.$nextTick();expect(wrapper.text()).toBe('true')
 localStorage.setItem('MediaLibrary_BrowseMode','list');window.dispatchEvent(new CustomEvent('boxplayer:browse-mode-changed'));await wrapper.vm.$nextTick();expect(wrapper.text()).toBe('false');wrapper.unmount();window.removeEventListener('boxplayer:browse-mode-changed',event)
})
