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
it.each([[0,['Folder','a.mkv','b.mkv']],[1,['Folder','b.mkv','a.mkv']],[2,['Folder','b.mkv','a.mkv']],[3,['Folder','a.mkv','b.mkv']],[4,['Folder','b.mkv','a.mkv']],[5,['Folder','a.mkv','b.mkv']]] as const)('selects original sort menu option %i with original ordering and selection reset',async(index,expected)=>{
 const wrapper=await browser()
 try{
  await wrapper.findAll('.fileitem')[1]!.trigger('click')
  const sort=wrapper.get('.fileorder').findAll('button').find(row=>row.text().includes('名称'))!
  await sort.trigger('mouseenter');const body=new DOMWrapper(document.body)
  const labels=(['pan.sortNameAsc','pan.sortNameDesc','pan.sortTimeAsc','pan.sortTimeDesc','pan.sortSizeAsc','pan.sortSizeDesc'] as const).map(key=>t(key))
  const options=()=>body.findAll('.arco-dropdown-option').filter(row=>labels.includes(row.text().trim()))
  await vi.waitFor(()=>expect(options()).toHaveLength(6))
  await options().find(row=>row.text().trim()===labels[index])!.trigger('click');await flushPromises()
  expect(getDrivePane().store.ListDataShow.map(row=>row.name)).toEqual(expected)
  expect([...getDrivePane().store.ListSelected]).toEqual(index===0?['a.mkv']:[])
  expect(wrapper.findAll('.fileitem.selected')).toHaveLength(index===0?1:0)
  expect(wrapper.find('.drive-error').exists()).toBe(false)
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
