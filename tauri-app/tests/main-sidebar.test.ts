import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import MainSidebarNav from '@/features/files/MainSidebarNav.vue'
import {useLibraryNavigation} from '@/stores/libraryNavigation'
import useHome from '@/stores/unifiedHomePreferences'
it('keeps Home, Library and Files as three selectable sibling roots, and sources below Files', async () => {
  const wrapper = mount(MainSidebarNav, { props: { collapsed: false, selectedKey: 'library', entries: [{ id: 'local-a', sourceId: 'a', kind: 'localFolder', title: 'testVideo' }] }, global: { plugins: [createPinia()] } })
  const roots = wrapper.get('nav').element.children
  expect(Array.from(roots).map(root => root.getAttribute('data-sidebar-root'))).toEqual(['home', 'library', 'files'])
  expect(wrapper.findAll('.group-header > .group-heading').map(item => item.text())).toEqual(['主屏幕', '媒体库', '文件'])
  expect(wrapper.find('h2').exists()).toBe(false)
  expect(wrapper.get('[data-sidebar-root="files"] .nav-children').text()).toContain('testVideo')
  await wrapper.get('[data-sidebar-root="files"] .group-heading').trigger('click')
  expect(wrapper.emitted('select')?.[0]).toEqual(['files'])
  await wrapper.get('[data-sidebar-root="library"] [aria-expanded]').trigger('click')
  expect(wrapper.get('[data-sidebar-root="library"] .group-toggle').attributes('aria-expanded')).toBe('false')
  expect(wrapper.get('[data-sidebar-root="library"] .nav-children').attributes('style')).toContain('display: none')
  expect(wrapper.get('[data-sidebar-root="files"]').text()).toContain('testVideo')
  await wrapper.setProps({ collapsed: true })
  expect(wrapper.findAll('.group-header > .group-heading')).toHaveLength(3)
  expect(wrapper.get('.electron-files-sidebar').classes()).toContain('collapsed')
})

it('preserves the clicked sidebar group when Home and Library share a category route', async () => {
 const wrapper=mount(MainSidebarNav,{props:{collapsed:false,selectedKey:'home',selectedRoute:'daily',entries:[]},global:{plugins:[createPinia()]}})
 const home=wrapper.get('[data-sidebar-root="home"] .nav-children'),library=wrapper.get('[data-sidebar-root="library"] .nav-children')
 expect(home.findAll('.selected').map(row=>row.text())).toEqual(['每日精选'])
 expect(library.findAll('.selected')).toHaveLength(0)
 await library.findAll('button').find(row=>row.text()==='每日精选')!.trigger('click')
 expect(wrapper.emitted('catalog')?.at(-1)).toEqual(['daily','library'])
 await wrapper.setProps({selectedKey:'library'})
 expect(home.findAll('.selected')).toHaveLength(0)
 expect(library.findAll('.selected').map(row=>row.text())).toEqual(['每日精选'])
 wrapper.unmount()
})

it.each([
 ['所有电影','movies/all'],
 ['所有电视剧','tv/all'],
 ['按类型','movies/genres'],
 ['按评价','movies/ratings'],
 ['按发行日期','movies/years'],
 ['系列','series'],
 ['播放列表','playlist']
])('keeps Home ownership when opening %s and leaves Library unselected',async(title,route)=>{
 const wrapper=mount(MainSidebarNav,{props:{collapsed:false,selectedKey:'home',entries:[]},global:{plugins:[createPinia()]}})
 const home=wrapper.get('[data-sidebar-root="home"] .nav-children')
 await home.findAll('button').find(row=>row.text()===title)!.trigger('click')
 expect(wrapper.emitted('catalog')?.at(-1)).toEqual([route,'home'])
 await wrapper.setProps({selectedRoute:route})
 expect(home.findAll('.selected').map(row=>row.text())).toEqual([title])
 expect(wrapper.findAll('[data-sidebar-root="library"] .selected')).toHaveLength(0)
 wrapper.unmount()
})

it('keeps an independently placed child category in Home when its parent is hidden',async()=>{
 const pinia=createPinia()
 const navigation=useLibraryNavigation(pinia)
 navigation.setItems([{id:'local:genres',title:'按类型',sourceId:'local',available:true},{id:'local:genres:group:Drama',title:'剧情',sourceId:'local',available:true,child:true,optIn:true}])
 useHome(pinia).$patch({hidden:['local:genres'],order:['local:genres:group:Drama']})
 const wrapper=mount(MainSidebarNav,{props:{collapsed:false,selectedKey:'home',entries:[]},global:{plugins:[pinia]}})
 expect(wrapper.get('[data-sidebar-root="home"]').text()).not.toContain('按类型')
 await wrapper.findAll('[data-sidebar-root="home"] .nav-children button').find(row=>row.text()==='剧情')!.trigger('click')
 expect(wrapper.emitted('catalog')?.at(-1)).toEqual(['movies/genres/Drama','home'])
 await wrapper.setProps({selectedRoute:'movies/genres/Drama'})
 expect(wrapper.findAll('[data-sidebar-root="home"] .selected').map(row=>row.text())).toEqual(['剧情'])
 wrapper.unmount()
})
