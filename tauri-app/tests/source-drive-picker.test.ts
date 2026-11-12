import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import {Modal as ArcoModal} from '@arco-design/web-vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {json} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({json:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const source={id:'picker-second',providerId:'google' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
const folder=(id:string,name:string)=>({id,name,isDirectory:true,size:0,playable:false})
const file={id:'movie',name:'Movie.mkv',isDirectory:false,size:1,playable:true}
beforeEach(()=>{vi.resetAllMocks();const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[source];const wrapper=mount(SourceDriveManager,{props:{sourceId:source.id,name:source.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return wrapper}
const body=()=>new DOMWrapper(document.body)
const picker=()=>body().get('.showpandirmodal')
const choose=()=>picker().findAll('button').find(button=>button.text()==='选择')!
describe('original Electron directory picker through Tauri listing',()=>{
 it('restores a known nested selection through the source-bound tree cache',async()=>{
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async(_account,parent)=>({entries:parent==='folder'?[folder('child','Child')]:parent==='child'?[]:[folder('folder','Folder')]})),resolve:vi.fn()})
  const wrapper=await browser(),selected=vi.fn();await getDrivePane().action('selectDirectory',['selectdir','',selected]);await flushPromises()
  await picker().findAll('.sharetitleleft').find(node=>node.text()==='Folder')!.trigger('click');await flushPromises()
  await picker().findAll('.sharetitleleft').find(node=>node.text()==='Child')!.trigger('click');await flushPromises();await choose().trigger('click');await flushPromises()
  await getDrivePane().action('selectDirectory',['selectdir','',selected]);await flushPromises()
  expect(picker().get('#selectdir').text()).toContain('Child');await choose().trigger('click');await flushPromises()
  expect(selected).toHaveBeenLastCalledWith(source.id,source.id,expect.objectContaining({file_id:'child',isDir:true}));wrapper.unmount()
 })
 it('falls back to the actual source root when a saved destination is unknown',async()=>{
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[]}),resolve:vi.fn()});const wrapper=await browser(),selected=vi.fn()
  localStorage.setItem('selectpandir-'+source.id,'missing-folder');await getDrivePane().action('selectDirectory',['selectdir','',selected]);await flushPromises()
  await choose().trigger('click');await flushPromises()
  expect(selected).toHaveBeenCalledWith(source.id,source.id,expect.objectContaining({file_id:'google_root',name:'Fixture',isDir:true}));wrapper.unmount()
 })
 it('does not return an unverified destination when initial listing fails',async()=>{
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValueOnce({entries:[]}).mockRejectedValueOnce(Error('fixture unavailable')),resolve:vi.fn()})
  const wrapper=await browser(),selected=vi.fn();await getDrivePane().action('selectDirectory',['selectdir','',selected]);await flushPromises()
  await choose().trigger('click');await flushPromises();expect(selected).not.toHaveBeenCalled();expect(body().find('.showpandirmodal').exists()).toBe(true);wrapper.unmount()
 })
 it('keeps folder-only lazy loading and returns the selected source identity',async()=>{
  const listing=vi.fn().mockImplementation(async(_account,parent)=>({entries:parent==='folder'?[folder('child','Child'),file]:parent==='child'?[]:[folder('folder','Folder'),file]}))
  vi.mocked(driver).mockReturnValue({list:listing,resolve:vi.fn()});const wrapper=await browser(),selected=vi.fn()
  await getDrivePane().action('selectDirectory',['selectdir','',selected]);await flushPromises()
  expect(picker().text()).toContain('Folder');expect(picker().text()).not.toContain('Movie.mkv')
  await picker().findAll('.sharetitleleft').find(node=>node.text()==='Folder')!.trigger('click');await flushPromises()
  expect(picker().text()).toContain('Child');await choose().trigger('click');await flushPromises()
  expect(selected).toHaveBeenCalledWith(source.id,source.id,expect.objectContaining({file_id:'folder',isDir:true}));expect(body().find('.showpandirmodal').exists()).toBe(false)
  expect(listing.mock.calls.every(call=>call[0].id===source.id)).toBe(true);expect(json).not.toHaveBeenCalled();wrapper.unmount()
 })
 it('keeps failed nested creation open and selects a real created folder after retry',async()=>{
  let created=false;const listing=vi.fn().mockImplementation(async(_account,parent)=>({entries:parent?[]:[folder('folder','Folder'),...(created?[folder('created','Created')]:[])]}))
  vi.mocked(driver).mockReturnValue({list:listing,resolve:vi.fn()});vi.mocked(json).mockRejectedValueOnce(Error('fixture denied')).mockImplementationOnce(async()=>{created=true;return {id:'created'}})
  const wrapper=await browser(),selected=vi.fn();await getDrivePane().action('selectDirectory',['selectdir','',selected]);await flushPromises()
  await picker().findAll('button').find(button=>button.text()==='新建文件夹')!.trigger('click');await flushPromises()
  await body().get('#SelectDirCreatNewDirInput').setValue('Created')
  const create=()=>body().findAll('.source-drive-dialog button').find(button=>button.text()==='创建')!
  await create().trigger('click');await flushPromises();expect(body().find('#SelectDirCreatNewDirInput').exists()).toBe(true);expect(selected).not.toHaveBeenCalled()
  await create().trigger('click');await flushPromises();expect(wrapper.findAllComponents(ArcoModal).at(-1)!.props('visible')).toBe(false)
  expect(picker().get('#selectdir').text()).toContain('Created');await choose().trigger('click');await flushPromises()
  expect(selected).toHaveBeenCalledWith(source.id,source.id,expect.objectContaining({file_id:'created',parent_file_id:'google_root',isDir:true}));expect(json).toHaveBeenCalledTimes(2)
  expect(listing.mock.calls.length).toBeGreaterThan(3);wrapper.unmount()
 })
})
