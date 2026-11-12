import {beforeEach,it,expect,vi} from 'vitest'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {alipan} from '@/features/sources/alipan'
import {request,json} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),request:vi.fn(),json:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)})}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const id=(fileId:string)=>JSON.stringify({driveId:'drive',fileId}),response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})

const copy=vi.fn()
beforeEach(()=>{
 vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});copy.mockResolvedValue(undefined);vi.mocked(driver).mockReturnValue(alipan)
 vi.mocked(json).mockImplementation(async(_account,_method,url)=>url.endsWith('/getDriveInfo')||url.endsWith('/user/get')?{resource_drive_id:'drive'}:{items:[{file_id:'movie',name:'Old.mkv',type:'file',size:1}]})
 vi.mocked(request).mockImplementation(async(_account,_method,url)=>response(url.endsWith('/get_path')?{items:[{file_id:'movie',name:'Actual.mkv'}]}:{drive_id:'drive',file_id:'movie',parent_file_id:'root',name:'Actual.mkv',type:'file',size:4096,content_hash:'fixture-hash',content_hash_name:'sha1',private_token:'fixture-hidden',download_url:'https://fixture.test/private'}))
})
it.each(['aliyun','alipan-open'] as const)('renders %s metadata in the original modal and copies canonical public JSON',async provider=>{
 const pinia=createPinia(),account={id:'ali-properties-ui-'+provider,providerId:provider,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore(pinia).accounts=[account]
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body})
 try{
  await flushPromises();await getDrivePane().load(account.id,id('root'),true);await flushPromises();getDrivePane().store.mMouseSelect(id('movie'),false,false)
  await getDrivePane().action('properties',[]);await flushPromises()
  const modal=new DOMWrapper(document.body).get('.source-drive-dialog.shuxingmodal');expect(modal.text()).toContain('Actual.mkv')
  await modal.findAll('button').find(button=>button.text()==='复制JSON')!.trigger('click');await flushPromises()
  const encoded=copy.mock.calls.at(-1)![0];expect(JSON.parse(encoded)).toMatchObject({drive_id:account.id,file_id:id('movie'),parent_file_id:id('root'),size:4096,name:'Actual.mkv',content_hash:'fixture-hash'})
  expect(encoded).not.toContain('fixture-hidden');expect(encoded).not.toContain('fixture.test/private')
 }finally{wrapper.unmount()}
})

it('renders original web folder size and full provider path without walking descendants',async()=>{
 const pinia=createPinia(),account={id:'ali-web-folder-ui',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore(pinia).accounts=[account]
 vi.mocked(json).mockImplementation(async(_account,_method,url)=>url.endsWith('/user/get')?{backup_drive_id:'drive'}:{items:[{file_id:'movie',name:'Folder',type:'folder',size:0}]})
 vi.mocked(request).mockImplementation(async(_account,_method,url)=>response(url.endsWith('/get_path')?{items:[{file_id:'movie',name:'Folder'},{file_id:'parent',name:'Movies'}]}:url.endsWith('/get_folder_size_info')?{size:30,file_count:2,folder_count:1,reach_limit:false}:{drive_id:'drive',file_id:'movie',parent_file_id:'parent',name:'Folder',type:'folder',size:0}))
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body})
 try{
  await flushPromises();await getDrivePane().load(account.id,id('root'),true);await flushPromises();getDrivePane().store.mMouseSelect(id('movie'),false,false);await getDrivePane().action('properties',[]);await flushPromises()
  const modal=new DOMWrapper(document.body).get('.source-drive-dialog.shuxingmodal'),inputs=modal.findAll('input').map(input=>(input.element as HTMLInputElement).value)
  expect(inputs).toContain('30.00B');expect(inputs.some(value=>value.includes('30.00B')&&value.includes('2')&&value.includes('1'))).toBe(true)
  expect(modal.text()).toContain('/Movies/Folder')
  expect(vi.mocked(request).mock.calls.map(call=>new URL(call[2]).pathname)).toEqual(['/v2/file/get','/adrive/v1/file/get_path','/adrive/v1/file/get_folder_size_info'])
  expect(vi.mocked(json).mock.calls.filter(call=>call[2].endsWith('/file/list'))).toHaveLength(1)
 }finally{wrapper.unmount()}
})

it.each(['aliyun','alipan-open'] as const)('opens %s account drive-root properties in the unchanged modal',async provider=>{
 const pinia=createPinia(),account={id:'root-properties-ui-'+provider,providerId:provider,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore(pinia).accounts=[account]
 vi.mocked(json).mockImplementation(async(_account,_method,url)=>url.endsWith('/getDriveInfo')||url.endsWith('/user/get')?{backup_drive_id:'drive'}:{items:[{file_id:'child',name:'Child.mkv',type:'file',size:12}]})
 vi.mocked(request).mockResolvedValue(response({size:12,file_count:1,folder_count:0,reach_limit:false}))
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body})
 try{
  await flushPromises();getDrivePane().store.mMouseSelect(id('root'),false,false);await getDrivePane().action('properties',[]);await flushPromises()
  const modal=new DOMWrapper(document.body).get('.source-drive-dialog.shuxingmodal');expect(modal.findAll('input').some(input=>(input.element as HTMLInputElement).value==='12.00B')).toBe(true)
  await modal.findAll('button').find(button=>button.text()==='复制JSON')!.trigger('click');await flushPromises()
  expect(JSON.parse(copy.mock.calls.at(-1)![0])).toMatchObject({drive_id:account.id,file_id:id('root'),parent_file_id:'',name:'备份盘',type:'folder',size:12,file_count:1})
  expect(vi.mocked(request).mock.calls.every(call=>call[2].endsWith('/get_folder_size_info'))).toBe(true)
 }finally{wrapper.unmount()}
})
