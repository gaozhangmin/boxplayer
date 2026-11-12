import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {request} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(value:{body:number[]})=>new TextDecoder().decode(new Uint8Array(value.body)),playable:()=>true}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'source',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id=(fileId:string)=>JSON.stringify({driveId:'resource',fileId}),response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let descriptions:Record<string,string>,failSecond=false,wrongReply=false
beforeEach(()=>{vi.resetAllMocks();descriptions={a:'xbyEncrypt-a,c123456',b:'xbyEncrypt-b,c654321'};failSecond=false;wrongReply=false;vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async()=>({entries:Object.entries(descriptions).map(([key,description])=>({id:id(key),name:key+'.mkv',isDirectory:false,size:1,playable:true,description}))})),resolve:vi.fn()})
 vi.mocked(request).mockImplementation(async(_account,_method,_url,body)=>{const row=JSON.parse(body!).requests[0],value=row.body;if(failSecond&&row.id==='b')return response({responses:[{id:row.id,status:403,body:{code:'denied'}}]});if(!wrongReply)descriptions[row.id]=value.description;return response({responses:[{id:row.id,status:200,body:{file_id:row.id,drive_id:value.drive_id,description:wrongReply?'wrong':value.description}}]})})
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return {wrapper,pinia}}
describe('original Ali color menu and per-file native description preservation',()=>{
 it('retains original palette conversion and encryption marker in request/UI',async()=>{
  const {wrapper}=await browser();await wrapper.findAll('.fileitem')[0]!.trigger('click');await getDrivePane().action('color',[false,'#42A5F5']);await flushPromises();expect(getDrivePane().store.ListDataRaw[0]!.description).toBe('xbyEncrypt-a,c42a5f5')
  expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!).requests[0]).toMatchObject({url:'/file/update',id:'a',body:{drive_id:'resource',file_id:'a',description:'xbyEncrypt-a,c42a5f5'}});wrapper.unmount()
 })
 it('clears only the color using the original empty-color branch',async()=>{
  const {wrapper}=await browser();await wrapper.findAll('.fileitem')[0]!.trigger('click');await getDrivePane().action('color',[false,'']);await flushPromises();expect(descriptions.a).toBe('xbyEncrypt-a');expect(getDrivePane().store.ListDataRaw[0]!.description).toBe('xbyEncrypt-a');wrapper.unmount()
 })
 it('preserves different existing encryption markers for every selected file',async()=>{
  const {wrapper}=await browser();await wrapper.trigger('keydown',{key:'a',metaKey:true});await getDrivePane().action('color',[false,'#00bc99']);await flushPromises();expect(descriptions).toEqual({a:'xbyEncrypt-a,c00bc99',b:'xbyEncrypt-b,c00bc99'});expect(request).toHaveBeenCalledTimes(2);wrapper.unmount()
 })
 it('updates only confirmed files when a batch partially fails',async()=>{
  failSecond=true;const {wrapper}=await browser();await wrapper.trigger('keydown',{key:'a',metaKey:true});await getDrivePane().action('color',[false,'#00bc99']);await flushPromises();expect(getDrivePane().store.ListDataRaw.map(file=>file.description)).toEqual(['xbyEncrypt-a,c00bc99','xbyEncrypt-b,c654321']);expect(wrapper.text()).toContain('部分颜色标记失败');wrapper.unmount()
 })
 it('does not apply a mismatched metadata receipt',async()=>{
  wrongReply=true;const {wrapper}=await browser();await wrapper.findAll('.fileitem')[0]!.trigger('click');await getDrivePane().action('color',[false,'#00bc99']);await flushPromises();expect(getDrivePane().store.ListDataRaw[0]!.description).toBe('xbyEncrypt-a,c123456');expect(wrapper.text()).toContain('未确认完成');wrapper.unmount()
 })
 it('does not rewrite encryption through the color-only native port',async()=>{
  const {wrapper}=await browser();await wrapper.findAll('.fileitem')[0]!.trigger('click');await getDrivePane().action('color',[false,'notEncrypt']);await flushPromises();expect(request).not.toHaveBeenCalled();expect(getDrivePane().store.ListDataRaw[0]!.description).toBe('xbyEncrypt-a,c123456');wrapper.unmount()
 })
 it('does not apply a late receipt to another source with matching file IDs',async()=>{
  const {wrapper,pinia}=await browser();await wrapper.findAll('.fileitem')[0]!.trigger('click');let resolveRequest!:(value:any)=>void;vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>{resolveRequest=resolve}));const pending=getDrivePane().action('color',[false,'#00bc99']);await flushPromises();useFileSourcesStore(pinia).accounts.push({...account,id:'other'});await wrapper.setProps({sourceId:'other'});await flushPromises();resolveRequest(response({responses:[{id:'a',status:200,body:{file_id:'a',drive_id:'resource',description:'xbyEncrypt-a,c00bc99'}}]}));await pending;await flushPromises();expect(getDrivePane().sourceId).toBe('other');expect(getDrivePane().store.ListDataRaw[0]!.description).toBe('xbyEncrypt-a,c123456');wrapper.unmount()
 })
})
