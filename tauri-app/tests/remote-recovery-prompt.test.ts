import {afterEach,it,expect,vi} from 'vitest'
import {DOMWrapper,flushPromises} from '@vue/test-utils'
import {confirmRemotePreferenceRestore} from '@/features/files/remoteRecoveryPrompt'
afterEach(async()=>{await vi.waitFor(()=>expect(document.querySelectorAll('.arco-modal')).toHaveLength(0))})
const conflict={operationId:'operation',sourceId:'source',corruptStorage:false}
async function dialog(){await flushPromises();const body=new DOMWrapper(document.body);await vi.waitFor(()=>expect(body.find('.arco-modal').exists()).toBe(true));return body.get('.arco-modal')}
it('uses the existing Arco confirmation surface with explicit backup/restore and defer choices',async()=>{
 const result=confirmRemotePreferenceRestore(conflict),modal=await dialog()
 expect(modal.text()).toContain('恢复文件收藏');expect(modal.text()).toContain('替换这些更改');expect(modal.find('.arco-modal-close-btn').exists()).toBe(false)
 await modal.findAll('button').find(button=>button.text()==='稍后')!.trigger('click');await expect(result).resolves.toBe(false)
})
it('restores only when the backup-and-restore button is explicitly selected',async()=>{
 const result=confirmRemotePreferenceRestore({...conflict,corruptStorage:true}),modal=await dialog()
 expect(modal.text()).toContain('保存的收藏设置无法读取');expect(modal.text()).toContain('备份当前设置')
 await modal.findAll('button').find(button=>button.text()==='备份并恢复')!.trigger('click');await expect(result).resolves.toBe(true)
})
it('does not treat Escape or a mask click as approval',async()=>{
 let resolved=false;const result=confirmRemotePreferenceRestore(conflict).then(value=>{resolved=true;return value}),modal=await dialog()
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await flushPromises();expect(resolved).toBe(false)
 const body=new DOMWrapper(document.body);await body.get('.arco-modal-mask').trigger('click');await flushPromises();expect(resolved).toBe(false)
 await modal.findAll('button').find(button=>button.text()==='稍后')!.trigger('click');await expect(result).resolves.toBe(false)
})
