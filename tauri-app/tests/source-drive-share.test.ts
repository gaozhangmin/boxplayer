import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {nativeCall} from '@/platform/native'
import type {Account} from '@/features/sources/contracts'
import {json,request} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:(r:{body:number[]})=>new TextDecoder().decode(new Uint8Array(r.body)),playable:()=>true}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'share-box',providerId:'box' as const,name:'Fixture',baseUrl:'',authOrigins:[]},copy=vi.fn()
const file=(id:string)=>({id,name:id+'.mkv',isDirectory:false,size:2,playable:true})
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});copy.mockResolvedValue(undefined);vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[file('a'),file('b')]}),resolve:vi.fn()})})
async function browser(source:Account=account,driveType='resource_root'){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[source];const wrapper=mount(SourceDriveManager,{props:{sourceId:source.id,name:'Fixture'},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();await wrapper.trigger('keydown',{key:'a',metaKey:true});await getDrivePane().action('share',[false,'pan',driveType]);await flushPromises();return wrapper}
const dialog=()=>new DOMWrapper(document.body).get('.createsharelinkmodal')
const button=(label:string)=>dialog().findAll('button').find(button=>button.text()===label)!
const shared=(id:string)=>({id,type:'file',name:id+'.mkv',shared_link:{url:'https://box.example/s/'+id}})
describe('original Electron source share dialog',()=>{
 it('retains original controls and retries only failed files after partial creation',async()=>{
  let b=0;vi.mocked(json).mockImplementation(async(_account,_method,url)=>{if(url.includes('/b?')&&++b===1)throw Error('fixture denied');return shared(url.includes('/a?')?'a':'b')})
  const wrapper=await browser();expect(dialog().text()).toContain('已选择2个文件');expect(dialog().text()).toContain('提取码');expect(dialog().text()).toContain('有效期')
  await button('为每个文件单独创建').trigger('click');await flushPromises();expect(dialog().element).toBeTruthy();expect(copy).toHaveBeenCalledTimes(1);expect(copy.mock.calls[0]![0]).toContain('/s/a');expect(copy.mock.calls[0]![0]).not.toContain('/s/b')
  await button('为每个文件单独创建').trigger('click');await flushPromises();expect(vi.mocked(json).mock.calls.filter(call=>call[2].includes('/a?'))).toHaveLength(1);expect(vi.mocked(json).mock.calls.filter(call=>call[2].includes('/b?'))).toHaveLength(2);expect(copy.mock.calls.at(-1)![0]).toContain('/s/b');wrapper.unmount()
 })
 it('rejects Box combined selection before any provider request',async()=>{
  const wrapper=await browser();await button('创建分享链接').trigger('click');await flushPromises();expect(json).not.toHaveBeenCalled();expect(copy).not.toHaveBeenCalled();expect(dialog().element).toBeTruthy();wrapper.unmount()
 })
 it('does not copy or create remaining links after closing a pending share',async()=>{
  let finish!:(value:any)=>void;vi.mocked(json).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const wrapper=await browser();await button('为每个文件单独创建').trigger('click');await flushPromises();await getDrivePane().action('closeDialog',[]);await getDrivePane().action('createFolder',['folder']);await flushPromises();finish(shared('a'));await flushPromises();expect(json).toHaveBeenCalledTimes(1);expect(copy).not.toHaveBeenCalled();expect(new DOMWrapper(document.body).find('#CreatNewDirInput').exists()).toBe(true);wrapper.unmount()
 })
 it('rejects a mismatched successful response before copying a public link',async()=>{
  vi.mocked(json).mockResolvedValue(shared('different'));const wrapper=await browser();await button('为每个文件单独创建').trigger('click');await flushPromises();expect(copy).not.toHaveBeenCalled();expect(dialog().element).toBeTruthy();wrapper.unmount()
 })
 it('retries failed clipboard delivery without publishing duplicate shares',async()=>{
  vi.mocked(json).mockImplementation(async(_account,_method,url)=>shared(url.includes('/a?')?'a':'b'));copy.mockRejectedValueOnce(Error('clipboard unavailable'))
  const wrapper=await browser();await button('为每个文件单独创建').trigger('click');await flushPromises();expect(json).toHaveBeenCalledTimes(2);expect(dialog().element).toBeTruthy()
  await button('为每个文件单独创建').trigger('click');await flushPromises();expect(json).toHaveBeenCalledTimes(2);expect(copy).toHaveBeenCalledTimes(2);wrapper.unmount()
 })
 it('does not mix edited options into a partially confirmed batch',async()=>{
  vi.mocked(json).mockImplementation(async(_account,_method,url)=>{if(url.includes('/b?'))throw Error('fixture denied');return shared('a')})
  const wrapper=await browser();await button('为每个文件单独创建').trigger('click');await flushPromises();expect(json).toHaveBeenCalledTimes(2)
  await dialog().findAll('input')[0]!.setValue('different title');await button('为每个文件单独创建').trigger('click');await flushPromises();expect(json).toHaveBeenCalledTimes(2);wrapper.unmount()
 })

 it('opens the original quick-transfer form and copies its prefixed result',async()=>{
  const source={...account,providerId:'aliyun' as const},ids=['a','b'].map(fileId=>JSON.stringify({driveId:'backup',fileId}))
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:ids.map(id=>({...file(id),name:'Movie.mkv'}))}),resolve:vi.fn()})
  vi.mocked(nativeCall).mockResolvedValue({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify({share_id:'transfer',share_url:'https://www.alipan.com/t/public'}))),finalUrl:''})
  const wrapper=await browser(source,'backup_root');expect(dialog().text()).toContain('创建快传链接');expect(dialog().text()).not.toContain('有效期：');await button('创建快传链接').trigger('click');await flushPromises()
  expect(copy.mock.calls.at(-1)![0]).toContain('【快传链接】');expect(copy.mock.calls.at(-1)![0]).toContain('https://www.alipan.com/t/public');expect(nativeCall).toHaveBeenCalledTimes(1);wrapper.unmount()
 })

 it('submits the original 123 paid-share controls and copies no unused password',async()=>{
  const source={...account,providerId:'123' as const,userId:'42'};vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[file('1'),file('2')]}),resolve:vi.fn()})
  vi.mocked(request).mockResolvedValue({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify({code:0,data:{shareID:8,shareKey:'paid'}}))),finalUrl:''})
  const wrapper=await browser(source);await dialog().get('input[type=checkbox]').setValue(true);await flushPromises();expect(dialog().text()).toContain('购买金额')
  await dialog().get('textarea').setValue('Notes');await dialog().findAll('input[type=checkbox]')[1]!.setValue(true);await button('创建分享链接').trigger('click');await flushPromises()
  expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!)).toEqual({shareName:'1.mkv',fileIDList:'1,2',payAmount:1,isReward:1,resourceDesc:'Notes'});expect(copy.mock.calls.at(-1)![0]).toContain('https://42.share.123pan.cn/123pan/paid');expect(copy.mock.calls.at(-1)![0]).not.toContain('提取码');wrapper.unmount()
 })

 it('does not copy an old share or create the next file after same-ID account replacement',async()=>{
  let finish!:(value:any)=>void;vi.mocked(json).mockImplementation(()=>new Promise(resolve=>finish=resolve))
  const wrapper=await browser()
  try{await button('为每个文件单独创建').trigger('click');await flushPromises();useFileSourcesStore((wrapper.vm as any).$pinia).accounts=[{...account,name:'Replacement'}];finish(shared('a'));await flushPromises();expect(json).toHaveBeenCalledTimes(1);expect(copy).not.toHaveBeenCalled();expect(dialog().element).toBeTruthy()}finally{wrapper.unmount()}
 })
 it('does not deliver cached clipboard results from an old account on retry',async()=>{
  vi.mocked(json).mockImplementation(async(_account,_method,url)=>shared(url.includes('/a?')?'a':'b'));copy.mockRejectedValueOnce(Error('fixture clipboard denied'))
  const wrapper=await browser()
  try{await button('为每个文件单独创建').trigger('click');await flushPromises();expect(json).toHaveBeenCalledTimes(2);expect(copy).toHaveBeenCalledTimes(1);useFileSourcesStore((wrapper.vm as any).$pinia).accounts=[{...account,name:'Replacement'}];await button('为每个文件单独创建').trigger('click');await flushPromises();expect(json).toHaveBeenCalledTimes(2);expect(copy).toHaveBeenCalledTimes(1);expect(dialog().element).toBeTruthy()}finally{wrapper.unmount()}
 })

})
