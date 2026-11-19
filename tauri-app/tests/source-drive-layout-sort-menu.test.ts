import {beforeEach,it,expect,vi} from 'vitest'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {nativeCall} from '@/platform/native'
import {t} from '@/features/files/electron/i18n'
import {getDrivePane} from '@/features/files/drive/ports'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:String(cause)})}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
beforeEach(()=>{vi.resetAllMocks();const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(nativeCall).mockResolvedValue({sourceId:'local-sort',relativePath:'',parentPath:null,entries:[{id:'folder',name:'Folder',relativePath:'Folder',isDirectory:true,size:0,modified:1,playable:false},{id:'b',name:'b.mkv',relativePath:'b.mkv',isDirectory:false,size:10,modified:2,playable:true},{id:'a',name:'a.mkv',relativePath:'a.mkv',isDirectory:false,size:20,modified:3,playable:true}]})})
async function browser(){const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-sort',local:true,name:'Fixture'},global:{plugins:[createPinia()],stubs:{AList:list}},attachTo:document.body});await flushPromises();return wrapper}
it.each([['name',1,['Folder','b.mkv','a.mkv']],['name',2,['Folder','a.mkv','b.mkv']],['updated_at',1,['Folder','b.mkv','a.mkv']],['updated_at',2,['Folder','a.mkv','b.mkv']],['size',1,['Folder','b.mkv','a.mkv']],['size',2,['Folder','a.mkv','b.mkv']]] as const)('repeats %s %i times to switch direction and clear stale selection',async(field,clicks,expected)=>{
 const wrapper=await browser()
 try{
  await wrapper.findAll('.fileitem')[1]!.trigger('click')
  const sort=wrapper.get('.fileorder button'),body=new DOMWrapper(document.body)
  for(let count=0;count<clicks;count++){await sort.trigger('click');await flushPromises();await vi.waitFor(()=>expect(body.findAll('[data-sort-field]')).toHaveLength(3));await body.get(`[data-sort-field="${field}"]`).trigger('click');await flushPromises()}
  expect(getDrivePane().store.ListDataShow.map(row=>row.name)).toEqual(expected)
  expect([...getDrivePane().store.ListSelected]).toEqual([]);expect(wrapper.findAll('.fileitem.selected')).toHaveLength(0);expect(wrapper.find('.drive-error').exists()).toBe(false)
 }finally{wrapper.unmount()}
})
it('switches all original view buttons while preserving rows and selection',async()=>{
 const wrapper=await browser()
 try{
  await wrapper.findAll('.fileitem')[1]!.trigger('click')
  for(const [index,mode] of [[1,'image'],[2,'bigimage'],[0,'list']] as const){
   const buttons=new DOMWrapper(wrapper.get('.fileorder').element.nextElementSibling!).findAll('button')
   await buttons[index]!.trigger('click');await flushPromises()
   expect(getDrivePane().settings.uiFileListMode).toBe(mode)
   expect(getDrivePane().store.ListDataRaw).toHaveLength(3)
   expect([...getDrivePane().store.ListSelected]).toEqual(['a.mkv'])
   expect(wrapper.find(mode==='list'?'.fileitem':'.griditem.'+mode).exists()).toBe(true)
  }
 }finally{wrapper.unmount()}
})
