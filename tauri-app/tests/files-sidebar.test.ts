import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import FilesSidebar from '@/features/files/FilesSidebar.vue'
import { buildFileSidebarEntries, type FileSourcesSnapshot } from '@/features/files/sidebar'
const empty = (): FileSourcesSnapshot => ({ localFolders: [], drives: [], mediaServers: [], hasDirectURLs: false })
describe('Files sidebar keeps Electron roots alongside favorites', () => {
  it('shows only the selectable Files parent when no sources have been added', async () => {
    const wrapper = mount(FilesSidebar, { props: { entries: [], collapsed: false, selectedId: null }, global: { plugins: [createPinia()] } })
    expect(wrapper.findAll('button').map(button => button.text()).filter(Boolean)).toEqual(['文件'])
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('selectFiles')).toHaveLength(1)
  })
  it('flattens actual folders, drives, favorites and media servers without type-category nodes', () => {
    const snapshot: FileSourcesSnapshot = {
      localFolders: [{ id: 'films', name: '我的电影' }],
      drives: [
        { id: 'a', name: '阿里云盘', kind: 'remote', favorites: [] },
        { id: 'b', name: '共享服务器', kind: 'remote', favorites: [{ id: 'shows', name: '剧集收藏', path: '/shows' }] }
      ],
      mediaServers: [{ id: 'emby', name: '客厅 Emby' }], hasDirectURLs: false
    }
    expect(buildFileSidebarEntries(snapshot, '直接播放 URL').map(entry => entry.title)).toEqual(['我的电影', '阿里云盘', '共享服务器', '剧集收藏', '客厅 Emby'])
  })
  it('excludes local-device roots and only exposes Direct URL when saved URLs exist', () => {
    const snapshot = empty()
    snapshot.drives = [{ id: 'device', name: '本机', kind: 'local', favorites: [{ id: 'root', name: '本机', path: '/' }, { id: 'books', name: '书籍', path: '/books' }] }]
    expect(buildFileSidebarEntries(snapshot, '直接播放 URL').map(entry => entry.title)).toEqual(['书籍'])
    snapshot.hasDirectURLs = true
    expect(buildFileSidebarEntries(snapshot, '直接播放 URL').map(entry => entry.title)).toEqual(['书籍', '直接播放 URL'])
  })
  it('uses source identity instead of display name and selects the actual source', async () => {
    const snapshot = empty()
    snapshot.localFolders = [{ id: '/a', name: '电影' }, { id: '/b', name: '电影' }]
    const entries = buildFileSidebarEntries(snapshot, '直接播放 URL')
    expect(entries[0].id).not.toBe(entries[1].id)
    const wrapper = mount(FilesSidebar, { props: { entries, collapsed: false, selectedId: entries[1].id }, global: { plugins: [createPinia()] } })
    const selected = wrapper.get('.selected')
    await selected.trigger('click')
    expect(wrapper.emitted('selectSource')?.[0]).toEqual([entries[1]])
    await wrapper.get('[aria-expanded]').trigger('click')
    expect(wrapper.get('[aria-expanded]').attributes('aria-expanded')).toBe('false')
  })
  it('keeps a single Files icon when the entire sidebar is collapsed', () => {
    const snapshot = empty()
    snapshot.localFolders = [{ id: 'a', name: '我的电影' }]
    const wrapper = mount(FilesSidebar, { props: { entries: buildFileSidebarEntries(snapshot, '直接播放 URL'), collapsed: true, selectedId: 'files' }, global: { plugins: [createPinia()] } })
    expect(wrapper.findAll('.group-heading')).toHaveLength(1)
    expect(wrapper.get('.group-heading').text()).toBe('文件')
    expect(wrapper.get('.electron-files-sidebar').classes()).toContain('collapsed')
  })
})
it('retains remote roots with both root and child favorites and distinct navigable identities',()=>{
 const snapshot=empty();snapshot.drives=[{id:'drive',name:'Cloud',kind:'remote',favorites:[{id:'all',name:'所有文件',path:'',isDriveRoot:true},{id:'shows',name:'Shows',path:'opaque-id'}]}]
 const entries=buildFileSidebarEntries(snapshot,'URL');expect(entries.map(e=>e.kind)).toEqual(['drive','favorite','favorite']);expect(new Set(entries.map(e=>e.id)).size).toBe(3);expect(entries.every(e=>e.sourceId==='drive')).toBe(true);expect(entries[2].favoriteId).toBe('shows')
})
it('keeps actual local-root favorites when their name matches the source',()=>{
 const snapshot=empty();snapshot.localFolders=[{id:'local',name:'Films'}];snapshot.drives=[{id:'local',name:'Films',kind:'local',favorites:[{id:JSON.stringify(['local','']),name:'Films',path:''}]}]
 expect(buildFileSidebarEntries(snapshot,'URL').map(entry=>entry.kind)).toEqual(['localFolder','favorite'])
})

it('falls back to the favorite star when a folder has no provider artwork',()=>{
 const wrapper=mount(FilesSidebar,{props:{entries:[{id:'folder',title:'Folder',kind:'favorite',sourceId:'drive'}],collapsed:false,selectedId:null},global:{plugins:[createPinia()]}})
 expect(wrapper.get('.electron-files-sidebar .nav-children button svg').classes()).toContain('lucide-star')
})
it('retains provider marks and falls back safely when the asset fails',async()=>{
 const wrapper=mount(FilesSidebar,{props:{entries:[{id:'cloud',title:'Cloud',kind:'drive',icon:'/source-icons/quark.svg'}],collapsed:false,selectedId:null},global:{plugins:[createPinia()]}})
 expect(wrapper.get('.electron-files-sidebar .nav-children img').attributes('src')).toBe('/source-icons/quark.svg')
 await wrapper.get('.electron-files-sidebar .nav-children img').trigger('error')
 expect(wrapper.find('.electron-files-sidebar .nav-children img').exists()).toBe(false)
 expect(wrapper.find('.electron-files-sidebar .nav-children svg').exists()).toBe(true)
})
it('uses a star for scraped root favorites while keeping the drive provider mark',()=>{
 const snapshot=empty();snapshot.drives=[{id:'drive',name:'Cloud',kind:'remote',favorites:[{id:'root-favorite',name:'All',path:''}]}]
 snapshot.presentation={order:[],names:{},providerIds:{drive:'quark'},descending:false}
 const entries=buildFileSidebarEntries(snapshot,'URL')
 expect(entries.find(entry=>entry.kind==='drive')?.icon).toBe('/source-icons/quark.svg')
 expect(entries.find(entry=>entry.kind==='favorite')?.icon).toBeUndefined()
 const wrapper=mount(FilesSidebar,{props:{entries,collapsed:false,selectedId:null},global:{plugins:[createPinia()]}})
 expect(wrapper.findAll('.electron-files-sidebar .nav-children button').find(button=>button.text()==='All')!.get('svg').classes()).toContain('lucide-star')
})
