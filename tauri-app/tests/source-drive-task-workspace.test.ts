import {beforeEach,expect,it,vi} from 'vitest'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {createPinia} from 'pinia'
import TransferWorkspace from '@/features/files/drive/TransferWorkspace.vue'
import AddFileSourceModal from '@/features/files/electron/AddFileSourceModal.vue'
vi.mock('@/platform/native',async(original)=>({...await original<typeof import('@/platform/native')>(),nativeCall:vi.fn().mockResolvedValue(undefined),isNative:()=>false}))
beforeEach(()=>vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}}))
it('opens every retained original task page from the original four-item menu',async()=>{
 const wrapper=mount(TransferWorkspace,{global:{plugins:[createPinia()]}});await flushPromises()
 const labels=['下载中','已下载','上传中','已上传']
 expect(wrapper.findAll('.arco-menu-item').map(item=>item.text())).toEqual(labels)
 expect(wrapper.findAll('.arco-menu-item svg')).toHaveLength(4)
 expect(wrapper.findAll('.toppanbtn button svg').length).toBeGreaterThan(0)
 for(const label of labels){await wrapper.findAll('.arco-menu-item').find(item=>item.text()===label)!.trigger('click');await flushPromises();expect(wrapper.get('.arco-menu-selected').text()).toBe(label);expect(wrapper.get(`[aria-label="${label}"]`).isVisible()).toBe(true)}
 expect(wrapper.text()).not.toContain('M3U8');expect(wrapper.findAll('.fileitem')).toHaveLength(0)
})
it('connects the M5 source-dialog task entry and closes the nested task window',async()=>{
 const wrapper=mount(AddFileSourceModal,{props:{visible:true,deviceName:'Mac',sources:[]},global:{plugins:[createPinia()],stubs:{IconFont:true,UserLogin:true,ServerRegistry:true}},attachTo:document.body});await flushPromises()
 const body=new DOMWrapper(document.body),entry=body.findAll('.file-source-navigation button').find(button=>button.text()==='传输文件')!
 expect(entry).toBeDefined();await entry.trigger('click');await flushPromises();expect(body.find('.source-transfer-modal [aria-label="传输任务"]').exists()).toBe(true)
 await body.get('.source-transfer-modal .arco-modal-close-btn').trigger('click');await flushPromises();expect(body.find('.source-transfer-modal').exists()).toBe(false);expect(wrapper.emitted('close')).toBeUndefined()
})
