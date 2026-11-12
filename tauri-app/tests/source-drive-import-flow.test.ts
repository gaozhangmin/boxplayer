import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {nativeCall} from '@/platform/native'
import {driver} from '@/features/sources/drivers'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(error:unknown)=>({message:error instanceof Error?error.message:String(error)}),isNative:()=>false}))
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'source',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]},root=JSON.stringify({driveId:'drive',fileId:'root'}),response=(body:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(body))),finalUrl:''})
const body=()=>new DOMWrapper(document.body),viewer=()=>body().get('.showsharemodal')
const button=(node:DOMWrapper<Element>|Omit<DOMWrapper<Element>,'exists'>,label:string)=>node.findAll('button').find(button=>button.text()===label)!
const picker=()=>body().findAll('.source-drive-dialog').find(node=>node.find('#selectdir').exists())!
beforeEach(()=>{
 vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:vi.fn().mockResolvedValue('alipan.com/s/abcdefghijk')}})
 vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async(_account,parent)=>({entries:parent?[]:[{id:root,name:'资源盘',isDirectory:true,size:0,playable:false}]})),resolve:vi.fn()})
 vi.mocked(nativeCall).mockImplementation(async(command,args)=>{
  if(command!=='http_request')throw Error('unexpected native mutation')
  const request=(args as any).request,url=request.url as string
  if(url.includes('get_share_token'))return response({share_token:'cap'})
  if(url.includes('get_share_by_anonymous'))return response({creator_id:'creator',share_name:'Shared Fixture',file_count:1})
  if(url.includes('/file/list?'))return response({items:[{file_id:'movie',name:'Movie.mkv',type:'file',category:'video',file_extension:'mkv',size:1}],next_marker:''})
  if(url.endsWith('/batch'))return response({responses:[{id:'movie',status:200,body:{file_id:'new-copy',drive_id:'drive',parent_file_id:'root'}}]})
  throw Error('unexpected endpoint')
 })
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:'Fixture'},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();await wrapper.trigger('keydown',{key:'l',metaKey:true});await flushPromises();expect(body().find('.importsharemodal').exists()).toBe(true);await button(body().get('.importsharemodal'),'导入').trigger('click');await flushPromises();expect(viewer().text()).toContain('Movie.mkv');return {wrapper,pinia}}
describe('Ali import through original source-browser dialogs',()=>{
 it('runs Cmd+L, original input/tree, nested target picker and native copy acknowledgment',async()=>{
  const {wrapper}=await browser();expect(wrapper.text()).toContain('导入');await button(viewer(),'一键导入全部').trigger('click');await flushPromises();expect(picker().text()).toContain('保存分享文件到')
  const target=picker().findAll('.ant-tree-node-content-wrapper').find(node=>node.text()==='资源盘')!;expect(target).toBeTruthy();await target.trigger('click');await flushPromises();expect(picker().get('#selectdir').text()).toContain('资源盘');await button(picker(),'选择').trigger('click');await flushPromises()
  expect(body().find('.showsharemodal').exists()).toBe(true);expect(body().text()).toContain('保存文件成功')
  const calls=vi.mocked(nativeCall).mock.calls.filter(([,args])=>(args as any).request.url.endsWith('/batch'));expect(calls).toHaveLength(1);const request=(calls[0]![1] as any).request;expect(request.accountId).toBe('source');expect(JSON.parse(new TextDecoder().decode(new Uint8Array(request.body))).requests[0].body).toMatchObject({share_id:'abcdefghijk',file_id:'movie',to_drive_id:'drive',to_parent_file_id:'root'});wrapper.unmount()
 })
 it('cancels the target picker without remounting the original content tree or losing selection',async()=>{
  const {wrapper}=await browser();await viewer().get('.ant-tree-checkbox').trigger('click');await button(viewer(),'一键导入全部').trigger('click');await flushPromises();await button(picker(),'取消').trigger('click');await flushPromises();expect(viewer().text()).toContain('Movie.mkv');expect(viewer().find('.ant-tree-checkbox-checked').exists()).toBe(true)
  expect(vi.mocked(nativeCall).mock.calls.filter(([,args])=>(args as any).request.url.includes('get_share_by_anonymous'))).toHaveLength(1);expect(vi.mocked(nativeCall).mock.calls.some(([,args])=>(args as any).request.url.endsWith('/batch'))).toBe(false);wrapper.unmount()
 })
 it('closes the whole import session on source change and rejects its old save callback',async()=>{
  const {wrapper,pinia}=await browser();await button(viewer(),'一键导入全部').trigger('click');await flushPromises();const oldPort=getDrivePane(),other={...account,id:'other'};useFileSourcesStore(pinia).accounts.push(other);await wrapper.setProps({sourceId:'other'});await flushPromises();expect(body().find('.showsharemodal').exists()).toBe(false);expect(picker()).toBeUndefined();expect(vi.mocked(nativeCall).mock.calls.some(([,args])=>(args as any).request.url.endsWith('/batch'))).toBe(false);expect(oldPort.sourceId).toBe('other');wrapper.unmount()
 })
})
