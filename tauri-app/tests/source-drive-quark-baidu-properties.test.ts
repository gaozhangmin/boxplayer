import {createFileProperties} from '@/features/files/drive/fileProperties'
import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {quark,baidu} from '@/features/sources/cloud'
import {request,rawRequest} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),request:vi.fn(),rawRequest:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
const copy=vi.fn()
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});copy.mockResolvedValue(undefined)})
it.each(['quark','baidu'] as const)('renders %s live properties in the original modal and copies only its public model',async provider=>{
 const pinia=createPinia(),account={id:'properties-ui-'+provider,providerId:provider,name:'Fixture',baseUrl:'',authOrigins:[]}
 useFileSourcesStore(pinia).accounts=[account];vi.mocked(driver).mockReturnValue(provider==='quark'?quark:baidu)
 vi.mocked(request).mockImplementation(async(_account,_method,url)=>response({code:0,data:{list:[{fid:'movie',file_name:url.includes('/file/sort?')?'Old.mkv':'Actual.mkv',file_type:1,pdir_fid:'0',size:4096,created_at:1700000000,updated_at:1700000100,private_token:'fixture-hidden'}]},metadata:{_total:1}}))
 vi.mocked(rawRequest).mockImplementation(async(_account,_method,url)=>response(new URL(url).pathname.endsWith('/multimedia')?{errno:0,list:[{fs_id:'9007199254740997',filename:'Actual.mkv',path:'/Moved/Actual.mkv',isdir:0,size:4096,server_ctime:1700000000,server_mtime:1700000100,md5:'fixture-md5',dlink:'https://fixture.test/private-hidden'}]}:{errno:0,has_more:0,list:[{fs_id:'9007199254740997',server_filename:'Old.mkv',path:'/Old.mkv',isdir:0,size:4096,server_mtime:1700000100}]}))
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body})
 try{
  await flushPromises();await vi.waitFor(()=>expect(wrapper.findAll('.fileitem')).toHaveLength(1));await wrapper.get('.fileitem').trigger('click')
  await getDrivePane().action('properties',[]);await flushPromises()
  const modal=new DOMWrapper(document.body).get('.source-drive-dialog.shuxingmodal')
  expect(modal.text()).toContain('Actual.mkv')
  await modal.findAll('button').find(button=>button.text()==='复制JSON')!.trigger('click');await flushPromises()
  const encoded=copy.mock.calls.at(-1)![0],model=JSON.parse(encoded)
  expect(model).toMatchObject({file_id:provider==='quark'?'movie':'9007199254740997',drive_id:account.id,name:'Actual.mkv',size:4096,created_at:'2023-11-14T22:13:20.000Z'})
  expect(encoded).not.toContain('fixture-hidden');expect(encoded).not.toContain('private-hidden')
  if(provider==='baidu'){expect(modal.text()).toContain('/Moved');expect(model.content_hash).toBe('fixture-md5')}
 }finally{wrapper.unmount()}
})

it.each(['quark','baidu'] as const)('renders complete %s folder totals in the unchanged original modal',async provider=>{
 const pinia=createPinia(),account={id:'folder-properties-ui-'+provider,providerId:provider,name:'Fixture',baseUrl:'',authOrigins:[]}
 useFileSourcesStore(pinia).accounts=[account];vi.mocked(driver).mockReturnValue(provider==='quark'?quark:baidu)
 vi.mocked(request).mockImplementation(async(_account,_method,raw)=>{
  const url=new URL(raw),parent=url.searchParams.get('pdir_fid')
  const rows=url.pathname.endsWith('/file')?[{fid:'folder',file_name:'Actual Folder',file_type:0,pdir_fid:'0',size:999}]:parent==='0'?[{fid:'folder',file_name:'Folder',file_type:0,pdir_fid:'0',size:999}]:parent==='folder'?[{fid:'first',file_name:'First.mkv',file_type:1,pdir_fid:'folder',size:10},{fid:'sub',file_name:'Sub',file_type:0,pdir_fid:'folder',size:0}]:[{fid:'nested',file_name:'Nested.mkv',file_type:1,pdir_fid:'sub',size:20}]
  return response({code:0,data:{list:rows},metadata:{_total:rows.length}})
 })
 vi.mocked(rawRequest).mockImplementation(async(_account,_method,raw)=>{
  const url=new URL(raw)
  if(url.pathname.endsWith('/multimedia')){const sub=url.searchParams.get('fsids')==='[200]';return response({errno:0,list:[{fs_id:sub?'200':'100',filename:sub?'Sub':'Actual Folder',path:sub?'/Actual Folder/Sub':'/Actual Folder',isdir:1,size:999}]})}
  const parent=url.searchParams.get('dir'),rows=parent==='/'?[{fs_id:'100',server_filename:'Folder',path:'/Folder',isdir:1,size:999}]:parent==='/Actual Folder'?[{fs_id:'101',server_filename:'First.mkv',path:'/Actual Folder/First.mkv',isdir:0,size:10},{fs_id:'200',server_filename:'Sub',path:'/Actual Folder/Sub',isdir:1,size:0}]:[{fs_id:'201',server_filename:'Nested.mkv',path:'/Actual Folder/Sub/Nested.mkv',isdir:0,size:20}]
  return response({errno:0,has_more:0,list:rows.map(row=>({...row,server_mtime:1700000100}))})
 })
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body})
 try{
  await flushPromises();await vi.waitFor(()=>expect(wrapper.findAll('.fileitem')).toHaveLength(1));await wrapper.get('.fileitem').trigger('click')
  await getDrivePane().action('properties',[]);await flushPromises()
  const modal=new DOMWrapper(document.body).get('.source-drive-dialog.shuxingmodal')
  await vi.waitFor(()=>{const values=modal.findAll('input').map(input=>(input.element as HTMLInputElement).value);expect(values).toContain('子文件大小：30.00B，子文件：2个，子文件夹：1个');expect(values).toContain('30.00B')})
  await modal.findAll('button').find(button=>button.text()==='复制JSON')!.trigger('click');await flushPromises()
  expect(JSON.parse(copy.mock.calls.at(-1)![0])).toMatchObject({size:30,sizeStr:'30.00B',file_count:2,type:'folder'})
 }finally{wrapper.unmount()}
})

it('stops the native list port before the next page after an account replacement during folder statistics',async()=>{
 const pinia=createPinia(),account={id:'folder-owner-check',providerId:'quark' as const,name:'Fixture',baseUrl:'',userId:'owner',authOrigins:[]}
 useFileSourcesStore(pinia).accounts=[account];vi.mocked(driver).mockReturnValue(quark)
 const folder={fid:'folder',file_name:'Folder',file_type:0,pdir_fid:'0',size:0}
 vi.mocked(request).mockImplementation(async(_account,_method,raw)=>{
  const url=new URL(raw)
  if(url.searchParams.get('pdir_fid')==='folder'){
   useFileSourcesStore(pinia).accounts=[{...account,userId:'another'}]
   return response({code:0,data:{list:Array.from({length:100},(_,index)=>({fid:'child-'+index,file_name:'Child.mkv',file_type:1,pdir_fid:'folder',size:1}))},metadata:{_total:101}})
  }
  return response({code:0,data:{list:[folder]},metadata:{_total:1}})
 })
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body})
 let reader:ReturnType<typeof createFileProperties>|undefined
 try{
  await flushPromises();await vi.waitFor(()=>expect(getDrivePane().store.ListDataRaw).toHaveLength(1));reader=createFileProperties()
  await expect(reader.read(getDrivePane().store.ListDataRaw[0]!)).rejects.toThrow('身份')
  const pages=vi.mocked(request).mock.calls.map(call=>new URL(call[2])).filter(url=>url.searchParams.get('pdir_fid')==='folder')
  expect(pages).toHaveLength(1);expect(pages[0]!.searchParams.get('_page')).toBe('1')
 }finally{reader?.dispose();wrapper.unmount()}
})
