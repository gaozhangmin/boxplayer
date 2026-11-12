import {beforeEach,it,expect,vi} from 'vitest'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {defineComponent,h} from 'vue'
import {Dropdown} from '@arco-design/web-vue'
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


const older='2024-01-01T00:00:00Z',newer='2025-01-01T00:00:00Z'
const rows=[{file_id:'folder',name:'Folder',type:'folder',size:0,updated_at:older,file_count:2},{file_id:'b',name:'b.mkv',type:'file',size:20,updated_at:older,content_hash:'b-hash'},{file_id:'a',name:'a.mkv',type:'file',size:10,updated_at:newer,content_hash:'a-hash',description:'color:#df5659',starred:true}]
beforeEach(()=>{
 vi.resetAllMocks();const saved=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value)});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(alipan)
 vi.mocked(json).mockImplementation(async(_account,_method,url)=>url.endsWith('/getDriveInfo')||url.endsWith('/user/get')?{resource_drive_id:'drive'}:{items:rows})
})
it.each(['aliyun','alipan-open'] as const)('preserves %s original directory models across the six actual sort handlers',async provider=>{
 const pinia=createPinia(),account={id:'ali-directory-ui-'+provider,providerId:provider,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore(pinia).accounts=[account]
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body})
 try{
  await flushPromises();const pane=getDrivePane();await pane.load(account.id,id('root'),true);await flushPromises()
  const model=pane.store.ListDataRaw.find(row=>row.file_id===id('a'))!
  expect(model).toMatchObject({drive_id:account.id,parent_file_id:id('root'),time:Date.parse(newer),timeStr:expect.any(String),sizeStr:'10.00B',icon:'iconfile_video',description:'color:#df5659',starred:true,content_hash:'a-hash'})
  if(provider==='aliyun')expect(model.thumbnail).toContain('/file-thumbnail?');else expect(model.thumbnail).toBe('')
  const sort=wrapper.findAllComponents(Dropdown).find(node=>node.text().includes('名称'))!
  for(const [order,expected] of [['name asc',['Folder','a.mkv','b.mkv']],['name desc',['Folder','b.mkv','a.mkv']],['updated_at asc',['Folder','b.mkv','a.mkv']],['updated_at desc',['Folder','a.mkv','b.mkv']],['size asc',['Folder','a.mkv','b.mkv']],['size desc',['Folder','b.mkv','a.mkv']]] as const){sort.vm.$emit('select',order);await flushPromises();expect(pane.store.ListDataShow.map(row=>row.name)).toEqual([...expected]);expect(wrapper.findAll('.fileitem').map(row=>row.text()).map(text=>expected.find(name=>text.includes(name)))).toEqual([...expected])}
  await pane.load(account.id,'refresh',false);await flushPromises();expect(pane.store.ListDataShow.map(row=>row.name)).toEqual(['Folder','b.mkv','a.mkv'])
  expect(pane.store.ListDataRaw.find(row=>row.file_id===id('a'))).toMatchObject({time:Date.parse(newer),description:'color:#df5659',content_hash:'a-hash'})
 }finally{wrapper.unmount()}
})
it.each(['aliyun','alipan-open'] as const)('preserves %s metadata when the original load-more flow appends another page',async provider=>{
 const pinia=createPinia(),account={id:'ali-directory-pages-'+provider,providerId:provider,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore(pinia).accounts=[account]
 vi.mocked(json).mockImplementation(async(_account,_method,url,body:any)=>url.endsWith('/getDriveInfo')||url.endsWith('/user/get')?{resource_drive_id:'drive'}:body.marker?{items:[{file_id:'c',name:'c.mkv',type:'file',size:30,updated_at:newer,content_hash:'c-hash'}]}:{items:rows,next_marker:'next'})
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body})
 try{
  await flushPromises();const pane=getDrivePane();await pane.load(account.id,id('root'),true);await pane.more();await flushPromises()
  expect(pane.store.ListDataRaw).toHaveLength(4);expect(pane.store.ListDataRaw.find(row=>row.file_id===id('c'))).toMatchObject({parent_file_id:id('root'),drive_id:account.id,time:Date.parse(newer),content_hash:'c-hash',icon:'iconfile_video'})
  const last=vi.mocked(json).mock.calls.at(-1)!;expect(last[3]).toMatchObject({drive_id:'drive',parent_file_id:'root',marker:'next'})
  expect(last[2].startsWith(provider==='aliyun'?'https://api.aliyundrive.com/':'https://openapi.alipan.com/')).toBe(true)
 }finally{wrapper.unmount()}
})
