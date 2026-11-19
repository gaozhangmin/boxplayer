import {mount,DOMWrapper,flushPromises} from '@vue/test-utils'
import {it,expect} from 'vitest'
import SortMenuButton from '@/features/files/SortMenuButton.vue'
it('repeated field selection toggles direction; another field selects its key',async()=>{
 const wrapper=mount(SortMenuButton,{props:{sort:'title',descending:false,options:[{value:'title',label:'名称'},{value:'date',label:'时间'}]},attachTo:document.body})
 await wrapper.get('button').trigger('click');await flushPromises();const menu=new DOMWrapper(document.body);await menu.get('[data-sort-field="title"]').trigger('click');expect(wrapper.emitted('toggle')).toEqual([[]]);expect(wrapper.emitted('select')).toBeUndefined()
 await wrapper.get('button').trigger('click');await flushPromises();await menu.get('[data-sort-field="date"]').trigger('click');expect(wrapper.emitted('select')).toEqual([['date']]);expect(menu.find('[data-file-direction]').exists()).toBe(false);wrapper.unmount()
})
it('keeps provider default relevance as a non-directional option',async()=>{
 const wrapper=mount(SortMenuButton,{props:{sort:'default',descending:false,options:[{value:'default',label:'默认',directional:false}]},attachTo:document.body});await wrapper.get('button').trigger('click');await flushPromises();await new DOMWrapper(document.body).get('[data-sort-field="default"]').trigger('click');expect(wrapper.emitted('toggle')).toBeUndefined();expect(wrapper.emitted('select')).toEqual([['default']]);wrapper.unmount()
})
