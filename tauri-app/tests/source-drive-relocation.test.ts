import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver,playSource} from '@/features/sources/drivers'
import {json} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({json:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const source={id:'box-second',providerId:'box' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
const folder=(id:string,name:string)=>({id,name,isDirectory:true,size:0,playable:false})
const movie=(id:string)=>({id,name:id+'.mkv',isDirectory:false,size:1,playable:true})
beforeEach(()=>{vi.resetAllMocks();const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[source];const wrapper=mount(SourceDriveManager,{props:{sourceId:source.id,name:source.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return {wrapper,pinia}}
const picker=()=>new DOMWrapper(document.body).get('.showpandirmodal')
describe('original move/copy orchestration through Box native transport',()=>{
 it('retains a catalog synchronization failure after original drag navigation refreshes the listing',async()=>{
  let moved=false;vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async(_account,parent)=>({entries:parent==='target'?(moved?[movie('a')]:[]):[folder('target','Target'),movie('a')]})),resolve:vi.fn()})
  vi.mocked(json).mockImplementation(async()=>{moved=true;return {id:'a',parent:{id:'target'}}})
  const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValue(Error('fixture catalog unavailable'))
  await wrapper.findAll('.fileitem').find(row=>row.text().includes('a.mkv'))!.trigger('click');await getDrivePane().action('dropMove',[source.id,'target',false]);await flushPromises()
  expect(getDrivePane().store.DirID).toBe('target');expect(wrapper.get('[role=alert]').text()).toContain('远端移动已完成');expect(wrapper.get('[role=alert]').text()).toContain('fixture catalog unavailable')
  wrapper.unmount();update.mockRestore()
 })
 it('does not let an old drag completion delete or navigate rows in a newly selected source',async()=>{
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async()=>({entries:[folder('target','Target'),movie('a')]})),resolve:vi.fn()})
  let finish!:(value:unknown)=>void;vi.mocked(json).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
  const second={...source,id:'box-third'};useFileSourcesStore(pinia).accounts.push(second)
  await wrapper.findAll('.fileitem').find(row=>row.text().includes('a.mkv'))!.trigger('click')
  const operation=getDrivePane().action('dropMove',[source.id,'target',false]);await flushPromises()
  await wrapper.setProps({sourceId:second.id});await flushPromises();finish({id:'a',parent:{id:'target'}});await operation;await flushPromises()
  expect(getDrivePane().sourceId).toBe(second.id);expect(getDrivePane().store.DirID).toBe('backup_root')
  expect(getDrivePane().store.ListDataRaw.map(row=>row.file_id)).toEqual(['target','a']);expect(json).toHaveBeenCalledTimes(1);expect(update).toHaveBeenCalledTimes(1)
  wrapper.unmount();update.mockRestore()
 })
 it('copies through Cmd+C and the original picker without importing an unscanned copy into the catalog',async()=>{
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async(_account,parent)=>({entries:parent?[]:[folder('target','Target'),movie('movie')]})),resolve:vi.fn()})
  vi.mocked(json).mockResolvedValue({id:'copied',parent:{id:'target'}})
  const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
  await wrapper.findAll('.fileitem').find(row=>row.text().includes('movie.mkv'))!.trigger('click');await wrapper.trigger('keydown',{key:'c',metaKey:true});await flushPromises()
  expect(picker().text()).toContain('复制文件到')
  await picker().findAll('.sharetitleleft').find(row=>row.text()==='Target')!.trigger('click');await flushPromises()
  await picker().findAll('button').find(row=>row.text()==='选择')!.trigger('click');await flushPromises()
  expect(json).toHaveBeenCalledWith(expect.objectContaining({id:source.id}),'POST','https://api.box.com/2.0/files/movie/copy',{parent:{id:'target'}})
  expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id==='movie')).toBe(true);expect(update).not.toHaveBeenCalled()
  wrapper.unmount();update.mockRestore()
 })
 it('moves confirmed successes only and preserves catalog identity, manual metadata and progress',async()=>{
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async(_account,parent)=>({entries:parent?[]:[folder('target','Target'),movie('a'),movie('b')]})),resolve:vi.fn()})
  vi.mocked(json).mockResolvedValueOnce({id:'a',parent:{id:'target'}}).mockRejectedValueOnce(Error('fixture denied'))
  const {wrapper,pinia}=await browser();const item={id:'stable',sourceId:source.id,fileId:'a',fileName:'a.mkv',name:'Manual title',metadataSource:'manual',folderPath:'',folderAncestors:[''],catalogRoots:[''],progress:37,watched:true}
  const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate({items:[item]} as any))
  expect(await getDrivePane().action('moveBatch',[source.id,source.id,['a','b'],source.id,'target'])).toEqual(['a'])
  expect(item).toMatchObject({id:'stable',name:'Manual title',progress:37,watched:true,folderPath:'target',folderAncestors:['','target'],catalogRoots:['']})
  expect(wrapper.get('[role=alert]').text()).toContain('fixture denied');expect(update).toHaveBeenCalledTimes(1)
  const remaining=getDrivePane().store.ListDataRaw.find(row=>row.file_id==='b')!;await getDrivePane().action('open',[remaining])
  expect(playSource).toHaveBeenCalledTimes(1);expect(vi.mocked(playSource).mock.calls[0]![2]!.map(row=>row.id)).not.toContain('a')
  wrapper.unmount();update.mockRestore()
 })
 it.each([{id:'wrong',parent:{id:'target'}},{id:'a',parent:{id:'wrong'}},{}])('does not claim move success for an invalid receipt %j',async receipt=>{
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async(_account,parent)=>({entries:parent?[]:[folder('target','Target'),movie('a')]})),resolve:vi.fn()});vi.mocked(json).mockResolvedValue(receipt)
  const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
  expect(await getDrivePane().action('moveBatch',[source.id,source.id,['a'],source.id,'target'])).toEqual([])
  expect(update).not.toHaveBeenCalled();expect(wrapper.get('[role=alert]').text()).toContain('目标目录');wrapper.unmount();update.mockRestore()
 })
 it('rejects moving a folder into its loaded descendant before any network write',async()=>{
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async(_account,parent)=>({entries:parent==='parent'?[folder('child','Child')]:[folder('parent','Parent')]})),resolve:vi.fn()})
  const {wrapper}=await browser();await getDrivePane().list(source.id,source.id,'parent')
  await expect(getDrivePane().action('moveBatch',[source.id,source.id,['parent'],source.id,'child'])).rejects.toThrow('子目录')
  expect(json).not.toHaveBeenCalled();wrapper.unmount()
 })
 it('keeps opaque destination IDs containing root intact in the original drag flow',async()=>{
  let moved=false;vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async(_account,parent)=>({entries:parent==='root-target'?(moved?[movie('a')]:[]):[folder('root-target','Target'),movie('a')]})),resolve:vi.fn()})
  vi.mocked(json).mockImplementation(async()=>{moved=true;return {id:'a',parent:{id:'root-target'}}})
  const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
  await wrapper.findAll('.fileitem').find(row=>row.text().includes('a.mkv'))!.trigger('click')
  await getDrivePane().action('dropMove',[source.id,'root-target',false]);await flushPromises()
  expect(json).toHaveBeenCalledWith(expect.objectContaining({id:source.id}),'PUT','https://api.box.com/2.0/files/a',{parent:{id:'root-target'}})
  expect(getDrivePane().store.DirID).toBe('root-target');expect(getDrivePane().store.ListDataRaw.map(row=>row.file_id)).toEqual(['a'])
  wrapper.unmount();update.mockRestore()
 })
})
