import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {nativeCall} from '@/platform/native'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const copy=vi.fn(),sourceId='property-local'
beforeEach(()=>{
 vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});copy.mockResolvedValue(undefined)
 vi.mocked(nativeCall).mockResolvedValue({sourceId,relativePath:'',entries:[{id:'hash',relativePath:'movie.mkv',name:'movie.mkv',isDirectory:false,size:2048,modified:1700000000,playable:true}]})
})
const body=()=>new DOMWrapper(document.body)
async function browser(){const wrapper=mount(SourceDriveManager,{props:{sourceId,local:true,name:'Fixture'},global:{plugins:[createPinia()],stubs:{AList:list}},attachTo:document.body});await flushPromises();await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('properties',[]);await flushPromises();return wrapper}
describe('original Electron properties dialog',()=>{
 it('opens the original details and copies names/actual JSON without account material',async()=>{
  const wrapper=await browser();const dialog=body().get('.source-drive-dialog.shuxingmodal');expect(dialog.text()).toContain('查看属性');expect(dialog.text()).toContain('movie.mkv');expect(dialog.findAll('input').some(input=>(input.element as HTMLInputElement).value==='2.00KB')).toBe(true)
  await dialog.findAll('button').find(button=>button.text()==='复制')!.trigger('click');await flushPromises();expect(copy).toHaveBeenLastCalledWith('movie.mkv')
  const jsonButton=dialog.findAll('button').find(button=>button.text()==='复制JSON')!;expect(jsonButton).toBeTruthy();await jsonButton.trigger('click');await flushPromises();expect(JSON.parse(copy.mock.calls.at(-1)![0])).toMatchObject({name:'movie.mkv',size:2048});wrapper.unmount()
 })
 it('does not populate a replacement modal after closing a pending detail read',async()=>{
  const wrapper=mount(SourceDriveManager,{props:{sourceId,local:true,name:'Fixture'},global:{plugins:[createPinia()],stubs:{AList:list}},attachTo:document.body});await flushPromises();await wrapper.get('.fileitem').trigger('click')
  const original=vi.mocked(nativeCall).getMockImplementation()!;let finish!:(value:any)=>void;vi.mocked(nativeCall).mockImplementation(()=>new Promise(resolve=>{finish=resolve}));await getDrivePane().action('properties',[]);await flushPromises()
  await getDrivePane().action('closeDialog',[]);vi.mocked(nativeCall).mockImplementation(original);await getDrivePane().action('copyTree',[]);await flushPromises();finish({sourceId,entries:[{relativePath:'movie.mkv',name:'late',size:9,isDirectory:false}]});await flushPromises()
  expect(body().find('.source-drive-dialog textarea').exists()).toBe(true);expect(body().find('.shuxingmodal').exists()).toBe(false);expect(copy).not.toHaveBeenCalled();wrapper.unmount()
 })
})
