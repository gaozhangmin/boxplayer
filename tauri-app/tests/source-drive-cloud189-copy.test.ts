import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver} from '@/features/sources/drivers'
import {cloud189} from '@/features/sources/cloud189'
import {rawRequest,json} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),rawRequest:vi.fn(),json:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const id=(fileId:string)=>JSON.stringify({fileId})
let account:any,moved:boolean,apply:boolean,count=0
beforeEach(()=>{
 vi.resetAllMocks();moved=false;apply=true;account={id:'189-copy-ui-'+(++count),providerId:'189',name:'Fixture',baseUrl:'https://api.cloud.189.cn',authOrigins:[]}
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(cloud189)
 vi.mocked(json).mockImplementation(async(_account,_method,url)=>{
  const parent=new URL(url).searchParams.get('folderId')
  return {fileListAO:{folderList:parent==='-11'?[{id:'target',name:'Target'}]:[],fileList:parent==='-11'?[{id:'9007199254740997',name:'Movie.mkv',size:42}]:parent==='target'&&moved?[{id:'9007199254740996',name:'Movie.mkv',size:42}]:[]}}
 })
 vi.mocked(rawRequest).mockImplementation(async(_account,_method,url)=>{
  const create=url.endsWith('createBatchTask.action');if(!create&&apply)moved=true
  return {status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(create?{taskId:'9007199254740998'}:{taskStatus:4}))),finalUrl:''}
 })
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();await getDrivePane().load(account.id,id('-11'),true);await flushPromises();return {wrapper,pinia}}
it('copies through original Cmd+C and directory picker without moving or importing source media',async()=>{
 const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
 try{
  expect(getDrivePane().operations.has('files.copy')).toBe(true)
  await wrapper.findAll('.fileitem').find(row=>row.text().includes('Movie.mkv'))!.trigger('click');await wrapper.trigger('keydown',{key:'c',metaKey:true});await flushPromises()
  const picker=()=>new DOMWrapper(document.body).get('.showpandirmodal')
  expect(picker().text()).toContain('复制文件到')
  await picker().findAll('.sharetitleleft').find(row=>row.text().includes('个人空间'))!.trigger('click');await flushPromises()
  await picker().findAll('.sharetitleleft').find(row=>row.text()==='Target')!.trigger('click');await flushPromises()
  await picker().findAll('button').find(row=>row.text()==='选择')!.trigger('click');await flushPromises()
  expect(new URLSearchParams(vi.mocked(rawRequest).mock.calls[0][3]).get('type')).toBe('COPY')
  expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id===id('9007199254740997'))).toBe(true)
  expect(update).not.toHaveBeenCalled()
 }finally{wrapper.unmount();update.mockRestore()}
})
it('resumes a confirmed task whose result was not yet visible through the original copy command',async()=>{
 apply=false;const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
 try{
  const args=[account.id,account.id,[id('9007199254740997')],account.id,id('target')]
  expect(await getDrivePane().action('copyBatch',args)).toEqual([]);expect(wrapper.text()).toContain('尚未确认')
  moved=true;expect(await getDrivePane().action('copyBatch',args)).toEqual([id('9007199254740997')])
  expect(rawRequest).toHaveBeenCalledTimes(2);expect(update).not.toHaveBeenCalled()
 }finally{wrapper.unmount();update.mockRestore()}
})
it('synchronizes neither catalog nor list rows from an old copy completion after a source switch',async()=>{
 const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
 let finish!:(value:any)=>void
 vi.mocked(rawRequest).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve))
 try{
  const task=getDrivePane().action('copyBatch',[account.id,account.id,[id('9007199254740997')],account.id,id('target')]);await flushPromises()
  const second={...account,id:account.id+'-second'};useFileSourcesStore(pinia).accounts.push(second);await wrapper.setProps({sourceId:second.id});await flushPromises()
  finish({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify({taskId:'old-task'}))),finalUrl:''});await task;await flushPromises()
  expect(getDrivePane().sourceId).toBe(second.id);expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id===id('-11'))).toBe(true)
  expect(update).not.toHaveBeenCalled();expect(rawRequest).toHaveBeenCalledOnce()
 }finally{wrapper.unmount();update.mockRestore()}
})
