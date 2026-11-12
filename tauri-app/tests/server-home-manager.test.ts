import {it,expect} from 'vitest'
import {mount} from '@vue/test-utils'
import ServerHomeManager from '@/features/servers/electron/ServerHomeManager.vue'
it('keeps visibility and drag order in a draft until Save; Cancel leaves source preferences untouched',async()=>{
 const visible=['resume','latest'],choices=[{key:'resume',title:'继续观看'},{key:'latest',title:'最近添加'},{key:'nextup',title:'接下来观看'}]
 const wrapper=mount(ServerHomeManager,{props:{visible,choices}})
 await wrapper.findAll('input')[0]!.setValue(false)
 await wrapper.findAll('[data-section-key]')[1]!.trigger('dragstart');await wrapper.findAll('[data-section-key]')[0]!.trigger('drop')
 expect(visible).toEqual(['resume','latest']);expect(wrapper.emitted('save')).toBeUndefined()
 await wrapper.findAll('button').find(b=>b.text()==='取消')!.trigger('click');expect(wrapper.emitted('close')).toHaveLength(1);expect(wrapper.emitted('save')).toBeUndefined()
 await wrapper.findAll('button').find(b=>b.text()==='保存')!.trigger('click');expect(wrapper.emitted('save')?.[0]).toEqual([['latest']]);expect(visible).toEqual(['resume','latest']);wrapper.unmount()
})
