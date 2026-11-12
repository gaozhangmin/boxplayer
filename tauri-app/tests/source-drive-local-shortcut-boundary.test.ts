import {beforeEach,it,expect,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {nativeCall} from '@/platform/native'
import {getDrivePane} from '@/features/files/drive/ports'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:String(cause)})}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(nativeCall).mockResolvedValue({sourceId:'local-shortcuts',relativePath:'',parentPath:null,entries:[{id:'fixture',name:'Movie.mkv',relativePath:'Movie.mkv',isDirectory:false,size:20,modified:2,playable:true}]})})
async function browser(){const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-shortcuts',name:'Fixture',local:true},global:{plugins:[createPinia()],stubs:{AList:list}},attachTo:document.body});await flushPromises();await wrapper.get('.fileitem').trigger('click');vi.mocked(nativeCall).mockClear();return wrapper}
const mutations=[{key:'c'},{key:'x'},{key:'n'},{key:'n',shiftKey:true},{key:'u'},{key:'u',shiftKey:true},{key:'l'},{key:'e'},{key:'s'},{key:'t'},{key:'g'},{key:'Delete'},{key:'Delete',shiftKey:true}]
it.each(['ctrlKey','metaKey'] as const)('keeps all cloud-only mutation shortcuts unavailable for local sources using %s',async modifier=>{
 const wrapper=await browser()
 try{
  for(const shortcut of mutations){
   await wrapper.trigger('keydown',{...shortcut,[modifier]:true});await flushPromises()
   expect(nativeCall).not.toHaveBeenCalled();expect(wrapper.find('.drive-error').exists()).toBe(false)
   expect([...getDrivePane().store.ListSelected]).toEqual(['Movie.mkv']);expect(getDrivePane().store.ListDataRaw[0]!.name).toBe('Movie.mkv')
   expect(document.querySelector('.renamemulti,.showpandirmodal,.creatnewdirmodal,.creatnewfilemodal')).toBeNull()
  }
  await wrapper.trigger('keydown',{key:'F2'});await flushPromises();expect(nativeCall).not.toHaveBeenCalled()
 }finally{wrapper.unmount()}
})
it('keeps native text-editing shortcuts inside the filter instead of forwarding file commands',async()=>{
 const wrapper=await browser()
 try{
  const input=wrapper.get('input[placeholder="快速筛选"]')
  for(const key of ['a','c','x','n','u','l','e','s','t','g','q','h']){
   const event=new KeyboardEvent('keydown',{key,metaKey:true,bubbles:true,cancelable:true});input.element.dispatchEvent(event);await flushPromises();expect(event.defaultPrevented).toBe(false)
  }
  expect(nativeCall).not.toHaveBeenCalled();expect([...getDrivePane().store.ListSelected]).toEqual(['Movie.mkv'])
 }finally{wrapper.unmount()}
})
