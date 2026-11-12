import {beforeEach,it,expect,vi} from 'vitest'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {driver} from '@/features/sources/drivers'
import {nativeCall} from '@/platform/native'
import {useFileSourcesStore} from '@/stores/fileSources'
import {getDrivePane} from '@/features/files/drive/ports'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)})}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:vi.fn().mockResolvedValue('')}})})
it('opens the original Quark import input, original content tree and original nested target picker from Cmd+L',async()=>{
 const pinia=createPinia(),account={id:'quark-ui',providerId:'quark' as const,name:'Fixture',baseUrl:'https://drive-pc.quark.cn',authOrigins:['https://drive-pc.quark.cn']};useFileSourcesStore(pinia).accounts=[account]
 vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[]}),resolve:vi.fn()})
 vi.mocked(nativeCall).mockImplementation(async(_command,args)=>{const req=(args as any).request;if(!req)throw Error('Unexpected command');const data=req.url.includes('/token?')?{stoken:'cap'}:req.url.includes('/save?')?{task_sync:true}:{share:{title:'Original Quark import'},list:[{fid:'movie',file_name:'电影.mkv',file_type:1,size:20,share_fid_token:'file-cap'}],metadata:{_total:1}};return {status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify({code:0,data}))),finalUrl:''} as any})
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body})
 try{
  await flushPromises();expect(getDrivePane().operations.has('share.import')).toBe(true)
  await wrapper.trigger('keydown',{key:'l',code:'KeyL',metaKey:true});await flushPromises();const body=new DOMWrapper(document.body)
  expect(body.text()).toContain('导入分享链接');await body.get('#DaoRuShareInput').setValue('https://pan.quark.cn/s/abc123?pwd=1234');await body.findAll('button').find(button=>button.text()==='导入')!.trigger('click');await flushPromises()
  expect(body.text()).toContain('Original Quark import');expect(body.get('.showsharemodal').text()).toContain('电影.mkv');expect(body.get('.showsharemodal').text()).toContain('导入勾选(按路径)')
  await body.findAll('button').find(button=>button.text()==='一键导入全部')!.trigger('click');await flushPromises()
  expect(body.text()).toContain('保存分享文件到');expect(body.find('.showsharemodal').exists()).toBe(true)
  await body.findAll('button').find(button=>button.text()==='选择')!.trigger('click');await flushPromises()
  const saved=vi.mocked(nativeCall).mock.calls.find(([,args])=>(args as any).request.url.includes('/save?'));expect(saved).toBeDefined();expect(JSON.parse(new TextDecoder().decode(new Uint8Array((saved![1] as any).request.body)))).toMatchObject({fid_list:['movie'],fid_token_list:['file-cap'],to_pdir_fid:'0'})
  expect(vi.mocked(nativeCall).mock.calls.every(([,args])=>(args as any).request.accountId===account.id)).toBe(true)
 }finally{wrapper.unmount()}
})
