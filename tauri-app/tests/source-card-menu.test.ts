import { beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import SourceCardMenu from '@/features/files/SourceCardMenu.vue'
import { useFileSourcesStore } from '@/stores/fileSources'
import { nativeCall } from '@/platform/native'
vi.mock('@/platform/native',async original=>({...await original<typeof import('@/platform/native')>(),nativeCall:vi.fn()}))
import { buildFileSidebarEntries } from '@/features/files/sidebar'
beforeEach(()=>{const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)})})
it('shares Home visibility and covers without removing the Files card',async()=>{
 const pinia=createPinia(),store=useFileSourcesStore(pinia);store.replaceSnapshot({localFolders:[{id:'local',name:'Films'}],drives:[],mediaServers:[],hasDirectURLs:false})
 const wrapper=mount(SourceCardMenu,{props:{sourceId:'local',x:10,y:10},global:{plugins:[pinia]}});expect(wrapper.text()).toContain('循环播放');await wrapper.findAll('button').find(b=>b.text()==='在主屏幕隐藏')!.trigger('click');expect(store.homeCards).toEqual([]);expect(store.cards).toHaveLength(1)
 await wrapper.findAll('button').find(b=>b.text()==='选择封面')!.trigger('click');await wrapper.get('input').setValue('https://api.xbyvideohub.com/cover.jpg');await wrapper.get('form').trigger('submit');await flushPromises();expect(store.favoriteCards[0]!.cover).toBe('https://api.xbyvideohub.com/cover.jpg')
})
it('unfavorites a real local root while keeping its stored device source',async()=>{
 const pinia=createPinia(),store=useFileSourcesStore(pinia);store.replaceSnapshot({localFolders:[{id:'local',name:'Films'}],drives:[],mediaServers:[],hasDirectURLs:false});const removeFolder=vi.fn(async()=>{})
 const wrapper=mount(SourceCardMenu,{props:{sourceId:'local',x:10,y:10,folderCatalog:{scanFolder:vi.fn(),removeFolder}},global:{plugins:[pinia]}})
 await wrapper.findAll('button').find(b=>b.text()==='从收藏夹中移除')!.trigger('click');await wrapper.get('form').trigger('submit');await flushPromises();expect(removeFolder).toHaveBeenCalledWith('local','');expect(store.cards).toEqual([]);expect(store.snapshot.localFolders).toHaveLength(1);expect(buildFileSidebarEntries(store.snapshot,'URL')).toEqual([])
})

it('chooses a native cover image, previews it and persists it across store reload',async()=>{
 const image='data:image/png;base64,dGVzdA==';vi.mocked(nativeCall).mockResolvedValue(image);const pinia=createPinia(),store=useFileSourcesStore(pinia);store.replaceSnapshot({localFolders:[{id:'local',name:'Films'}],drives:[],mediaServers:[],hasDirectURLs:false})
 const wrapper=mount(SourceCardMenu,{props:{sourceId:'local',x:10,y:10},global:{plugins:[pinia]}});await wrapper.findAll('button').find(b=>b.text()==='选择封面')!.trigger('click');await wrapper.findAll('button').find(b=>b.text()==='选择图片')!.trigger('click');await flushPromises();expect(nativeCall).toHaveBeenCalledWith('choose_cover_image');expect(wrapper.get('img[alt="已选择的封面"]').attributes('src')).toBe(image);await wrapper.get('form').trigger('submit');await flushPromises();expect(useFileSourcesStore(createPinia()).preferences.covers.local).toBe(image)
})
