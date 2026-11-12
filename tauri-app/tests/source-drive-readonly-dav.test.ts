import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import Rename from '@/features/files/drive/electron/pan/topbtns/RenameModal.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {json,request} from '@/features/sources/transport'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn(),request:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)})}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
let count=0
beforeEach(()=>{
 vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 vi.mocked(json).mockResolvedValue({code:200,data:{total:1,content:[{name:'Movie.mkv',size:42,is_dir:false,thumb:'/thumb.jpg',modified:'2026-11-01T00:00:00Z'}]}})
 const xml='<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/Movie.mkv</d:href><d:propstat><d:prop><d:getcontentlength>42</d:getcontentlength><d:getlastmodified>Sun, 01 Nov 2026 00:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>'
 vi.mocked(request).mockResolvedValue({status:207,headers:{},body:Array.from(new TextEncoder().encode(xml)),finalUrl:''})
})
async function browser(provider:'webdav'|'alist'){
 const account={id:'readonly-ui-'+(++count),providerId:provider,name:'Fixture',baseUrl:'https://fixture.test/'+(provider==='webdav'?'dav/':'alist'),authOrigins:[]},pinia=createPinia();useFileSourcesStore(pinia).accounts=[account]
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return {wrapper,account}
}
it.each(['webdav','alist'] as const)('passes original %s models and icons into the original list store',async provider=>{
 const {wrapper,account}=await browser(provider)
 try{
  const row=getDrivePane().store.ListDataRaw[0]!
  expect(row).toMatchObject({drive_id:account.id,name:'Movie.mkv',icon:'iconfile_video',size:42,time:1793491200000,category:'video'})
  expect(row.file_id).toBe(provider==='webdav'?'https://fixture.test/dav/Movie.mkv':'/Movie.mkv')
  if(provider==='alist')expect(row.thumbnail).toBe('https://fixture.test/thumb.jpg')
  expect(wrapper.get('.fileitem').text()).toContain('Movie.mkv')
 }finally{wrapper.unmount()}
})
it.each(['webdav','alist'] as const)('retains original readonly %s capabilities and does not open rename from F2',async provider=>{
 const {wrapper}=await browser(provider)
 try{
  expect(getDrivePane().operations.has('files.download')).toBe(true)
  for(const operation of ['files.rename','files.move','files.copy','files.createFolder','upload.memory','trash.move','trash.list','trash.delete','trash.restore','trash.empty','share.create'])expect(getDrivePane().operations.has(operation as any)).toBe(false)
  await wrapper.get('.fileitem').trigger('click');await wrapper.trigger('keydown',{key:'F2',code:'F2'});await flushPromises()
  expect(wrapper.findComponent(Rename).exists()).toBe(false)
  expect(vi.mocked(request).mock.calls.every(call=>call[1]==='PROPFIND')).toBe(true)
  expect(vi.mocked(json).mock.calls.every(call=>call[2].endsWith('/api/fs/list'))).toBe(true)
 }finally{wrapper.unmount()}
})
