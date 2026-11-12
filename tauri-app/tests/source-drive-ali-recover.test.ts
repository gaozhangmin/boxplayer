import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {alipan} from '@/features/sources/alipan'
import {request} from '@/features/sources/transport'
import {nativeCall} from '@/platform/native'
vi.mock('@/features/sources/alipan',()=>({alipan:{list:vi.fn()}}))
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(value:{body:number[]})=>new TextDecoder().decode(new Uint8Array(value.body)),playable:()=>true}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'source',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),row={file_id:'a',drive_id:'resource',name:'Movie.mkv',type:'file',size:4,content_hash:'hash-a'},response=(data:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let vip=false,partial=false,offline=false,resumeCalls=0
beforeEach(()=>{vi.resetAllMocks();vip=false;partial=false;offline=false;resumeCalls=0;vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 vi.mocked(alipan.list).mockResolvedValue({entries:[{id:id('resource','root'),name:'资源盘',isDirectory:true,size:0,playable:false}]})
 vi.mocked(request).mockResolvedValue(response({items:[row,{...row,file_id:'b',name:'Other.mkv',content_hash:'hash-b'}],next_marker:''}))
 vi.mocked(nativeCall).mockImplementation(async(command,args)=>{
  if(command!=='http_request')throw Error('unexpected native command');const req=(args as any).request
  if(req.url.endsWith('/resumeDeleted')){resumeCalls++;return vip?response({code:'UserNotVip'},403):response({task_id:'task'})}
  if(req.url.endsWith('/checkResumeTask')){if(offline){offline=false;throw Error('offline')};return response({state:'done',results:[{file_id:'a',status:200},{file_id:'b',status:partial?403:200}]})}
  throw Error('unexpected endpoint')
 })
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name,initialPath:'recover'},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return {wrapper,pinia}}
describe('original Ali deleted-file recovery UI and native jobs',()=>{
 it('renders independent original view and recovers selected files with real IDs/hash',async()=>{
  const {wrapper}=await browser();expect(getDrivePane().store.SelectDirType).toBe('recover');expect(wrapper.text()).toContain('仅会员可用');await wrapper.trigger('keydown',{key:'a',metaKey:true});await flushPromises();expect(wrapper.text()).toContain('恢复')
  await getDrivePane().action('recover',[]);await flushPromises();expect(getDrivePane().store.ListDataRaw).toEqual([])
  const requests=vi.mocked(nativeCall).mock.calls.filter(([command,args])=>command==='http_request'&&(args as any).request.url.endsWith('/resumeDeleted'));expect(requests).toHaveLength(1)
  const raw=(requests[0]![1] as any).request;expect(raw.accountId).toBe(account.id);expect(JSON.parse(new TextDecoder().decode(new Uint8Array(raw.body)))).toEqual({resume_file_list:[{drive_id:'resource',file_id:'a',content_hash:'hash-a',size:4,name:'Movie.mkv'},{drive_id:'resource',file_id:'b',content_hash:'hash-b',size:4,name:'Other.mkv'}]});expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!)).toEqual({drive_id:'resource',limit:100,order_by:'gmt_deleted',order_direction:'DESC',marker:''});wrapper.unmount()
 })
 it('removes only successfully recovered IDs from the original view',async()=>{
  partial=true;const {wrapper}=await browser();await wrapper.trigger('keydown',{key:'a',metaKey:true});await getDrivePane().action('recover',[]);await flushPromises();expect(getDrivePane().store.ListDataRaw.map(file=>file.file_id)).toEqual([id('resource','b')]);wrapper.unmount()
 })
 it('shows original membership error without removing files',async()=>{
  vip=true;const {wrapper}=await browser();await wrapper.trigger('keydown',{key:'a',metaKey:true});await getDrivePane().action('recover',[]);await flushPromises();expect(new DOMWrapper(document.body).text()).toContain('文件恢复功能需要开通阿里云盘会员');expect(getDrivePane().store.ListDataRaw).toHaveLength(2);expect(resumeCalls).toBe(1);wrapper.unmount()
 })
 it('resumes the original task after failed polling without a second restore submission',async()=>{
  offline=true;const {wrapper}=await browser();await wrapper.trigger('keydown',{key:'a',metaKey:true});await getDrivePane().action('recover',[]);await flushPromises();expect(getDrivePane().store.ListDataRaw).toHaveLength(2);await getDrivePane().action('recover',[]);await flushPromises();expect(getDrivePane().store.ListDataRaw).toHaveLength(0);expect(resumeCalls).toBe(1);wrapper.unmount()
 })
 it('rejects result IDs not present in the submitted selection',async()=>{
  vi.mocked(nativeCall).mockImplementation(async(_command,args)=>{const req=(args as any).request;return req.url.endsWith('/resumeDeleted')?response({task_id:'task'}):response({state:'done',results:[{file_id:'foreign',status:200}]})})
  const {wrapper}=await browser();await wrapper.trigger('keydown',{key:'a',metaKey:true});await getDrivePane().action('recover',[]);await flushPromises();expect(getDrivePane().store.ListDataRaw).toHaveLength(2);expect(wrapper.text()).toContain('结果不匹配');wrapper.unmount()
 })
 it('does not resubmit a recovery with a missing acceptance receipt',async()=>{
  let launches=0;vi.mocked(nativeCall).mockImplementation(async()=>{launches++;return response({})})
  const {wrapper}=await browser();await wrapper.trigger('keydown',{key:'a',metaKey:true});await getDrivePane().action('recover',[]);await getDrivePane().action('recover',[]);await flushPromises();expect(getDrivePane().store.ListDataRaw).toHaveLength(2);expect(launches).toBe(1);wrapper.unmount()
 })
 it('does not remove same-ID files from another source when the old task completes',async()=>{
  let resolveTask!:(value:unknown)=>void;vi.mocked(nativeCall).mockImplementation(async(_command,args)=>(args as any).request.url.endsWith('/resumeDeleted')?response({task_id:'task'}):new Promise(resolve=>{resolveTask=resolve}))
  const {wrapper,pinia}=await browser();await wrapper.trigger('keydown',{key:'a',metaKey:true});const pending=getDrivePane().action('recover',[]);await flushPromises();useFileSourcesStore(pinia).accounts.push({...account,id:'other'});await wrapper.setProps({sourceId:'other'});await flushPromises();resolveTask(response({state:'done',results:[{file_id:'a',status:200},{file_id:'b',status:200}]}));await pending;await flushPromises();expect(getDrivePane().sourceId).toBe('other');expect(getDrivePane().store.ListDataRaw).toHaveLength(2);wrapper.unmount()
 })
 it('rejects missing content hashes before submitting a recovery',async()=>{
  vi.mocked(request).mockResolvedValue(response({items:[{...row,content_hash:''}],next_marker:''}));const {wrapper}=await browser();expect(wrapper.text()).toContain('缺少内容哈希');expect(resumeCalls).toBe(0);wrapper.unmount()
 })
})
