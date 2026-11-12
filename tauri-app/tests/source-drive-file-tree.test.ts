import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import {Select} from '@arco-design/web-vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import CopyFileTree from '@/features/files/drive/electron/pan/topbtns/CopyFileTreeModal.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {nativeCall} from '@/platform/native'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const entry=(relativePath:string,isDirectory=false)=>({id:'hash-'+relativePath,name:relativePath.split('/').at(-1)!,relativePath,isDirectory,size:1,modified:0,playable:!isDirectory})
const sourceId='tree-local',copy=vi.fn()
beforeEach(()=>{
 vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});copy.mockResolvedValue(undefined)
 vi.mocked(nativeCall).mockImplementation(async(command,args)=>{if(command!=='local_list')throw Error('unexpected write');const path=(args as any).relativePath;return {sourceId,relativePath:path,parentPath:null,entries:path==='Folder'?[entry('Folder/Sub',true),entry('Folder/第一集.mkv')]:path==='Folder/Sub'?[entry('Folder/Sub/第二集.mkv')]:[entry('Folder',true)]}})
})
async function browser(){const wrapper=mount(SourceDriveManager,{props:{sourceId,local:true,name:'Fixture'},global:{plugins:[createPinia()],stubs:{AList:list}},attachTo:document.body});await flushPromises();await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('copyTree',[]);await flushPromises();return wrapper}
const body=()=>new DOMWrapper(document.body)
const dialog=()=>body().get('.source-drive-dialog')
const content=()=>dialog().get('textarea').element as HTMLTextAreaElement
describe('original directory tree export with source-bound traversal',()=>{
 it('renders the original formats, copies the complete tree and does not duplicate entries on reparse',async()=>{
  const wrapper=await browser();expect(dialog().text()).toContain('复制目录树');expect(content().value).toContain('第一集.mkv');expect(content().value).toContain('第二集.mkv')
  expect(dialog().text()).toContain('文件 2 个，文件夹 1 个')
  await dialog().findAll('button').find(button=>button.text()==='解析文件')!.trigger('click');await flushPromises()
  expect(content().value.match(/第二集/g)).toHaveLength(1)
  const original=wrapper.getComponent(CopyFileTree),selects=original.findAllComponents(Select)
  selects[0]!.vm.$emit('change','linux');selects[2]!.vm.$emit('change','path');await flushPromises()
  expect(content().value).toContain('Folder/Sub/第二集.mkv')
  await dialog().findAll('button').find(button=>button.text()==='复制到剪切板')!.trigger('click');await flushPromises();expect(copy).toHaveBeenLastCalledWith(content().value)
  expect(vi.mocked(nativeCall).mock.calls.every(([command,args])=>command==='local_list'&&(args as any).sourceId===sourceId)).toBe(true);wrapper.unmount()
 })
 it('does not present a cyclic listing as a successfully parsed directory',async()=>{
  vi.mocked(nativeCall).mockResolvedValue({sourceId,relativePath:'',parentPath:null,entries:[entry('Folder',true)]})
  const wrapper=await browser();expect(content().value).toBe('');expect(dialog().text()).toContain('重复或循环')
  await dialog().findAll('button').find(button=>button.text()==='复制到剪切板')!.trigger('click');expect(copy).not.toHaveBeenCalled();wrapper.unmount()
 })
 it('stops traversal after closing and does not close a new dialog when the old request resolves',async()=>{
  const first=vi.mocked(nativeCall).getMockImplementation()!;let finish!:(value:unknown)=>void
  vi.mocked(nativeCall).mockImplementation((command,args)=>((args as any).relativePath==='Folder'?new Promise(resolve=>{finish=resolve}):first(command,args)))
  const wrapper=await browser();await getDrivePane().action('closeDialog',[]);vi.mocked(nativeCall).mockImplementation(async(command,args)=>(args as any).relativePath==='Folder'?{sourceId,relativePath:'Folder',entries:[]}:first(command,args));await getDrivePane().action('properties',[]);await flushPromises()
  finish({sourceId,relativePath:'Folder',parentPath:null,entries:[entry('Folder/Sub',true)]});await flushPromises()
  expect(body().find('.shuxingmodal').exists()).toBe(true);expect(vi.mocked(nativeCall).mock.calls.some(([,args])=>(args as any).relativePath==='Folder/Sub')).toBe(false);wrapper.unmount()
 })
})
