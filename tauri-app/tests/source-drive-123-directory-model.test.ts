import {beforeEach,expect,it,vi} from 'vitest'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {defineComponent,h} from 'vue'
import {Dropdown} from '@arco-design/web-vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {cloud123} from '@/features/sources/cloud'
import {json,request} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn(),request:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)})}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})

const older='2024-01-01T00:00:00Z',newer='2025-01-01T00:00:00Z'
const rows=[{fileId:1,parentFileId:0,filename:'Folder',type:1,size:0,updateAt:older},{fileId:2,parentFileId:0,filename:'b.mkv',type:0,size:20,updateAt:older},{fileId:3,parentFileId:0,filename:'a.mkv',type:0,size:10,updateAt:newer,thumbnailUrl:'https://fixture.test/a'}]
beforeEach(()=>{vi.resetAllMocks();const saved=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value)});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(cloud123);vi.mocked(json).mockResolvedValue({code:0,data:{fileList:rows,lastFileId:-1}})})
it('uses original 123 metadata in all six dropdown sorts and preserves it across refresh/layouts',async()=>{
 const pinia=createPinia(),account={id:'123-model-ui',providerId:'123' as const,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore(pinia).accounts=[account]
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body})
 try{
  await flushPromises();const pane=getDrivePane();expect(pane.store.ListDataRaw.find(row=>row.file_id==='3')).toMatchObject({drive_id:account.id,parent_file_id:'',time:Date.parse(newer),sizeStr:'10.00B',icon:'iconfile_video',thumbnail:'https://fixture.test/a'})
  const sort=wrapper.findAllComponents(Dropdown).find(node=>node.text().includes('名称'))!
  for(const [order,expected] of [['name asc',['Folder','a.mkv','b.mkv']],['name desc',['Folder','b.mkv','a.mkv']],['updated_at asc',['Folder','b.mkv','a.mkv']],['updated_at desc',['Folder','a.mkv','b.mkv']],['size asc',['Folder','a.mkv','b.mkv']],['size desc',['Folder','b.mkv','a.mkv']]] as const){sort.vm.$emit('select',order);await flushPromises();expect(pane.store.ListDataShow.map(row=>row.name)).toEqual([...expected]);expect(wrapper.findAll('.fileitem').map(row=>row.text()).map(text=>expected.find(name=>text.includes(name)))).toEqual([...expected])}
  await pane.load(account.id,'refresh',false);await flushPromises();expect(pane.store.ListDataShow.map(row=>row.name)).toEqual(['Folder','b.mkv','a.mkv'])
  for(const layout of ['image','bigimage','list']){pane.settings.updateStore({uiFileListMode:layout});await flushPromises();expect(wrapper.text()).toContain('a.mkv');expect(pane.store.ListDataRaw.find(row=>row.file_id==='3')!.time).toBe(Date.parse(newer))}
 }finally{wrapper.unmount()}
})
it('preserves original model metadata after loading the next 123 page',async()=>{
 const pinia=createPinia(),account={id:'123-pages-ui',providerId:'123' as const,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore(pinia).accounts=[account]
 vi.mocked(json).mockImplementation(async(_account,_method,url)=>new URL(url).searchParams.has('lastFileId')?{code:0,data:{fileList:[{fileId:4,parentFileId:0,filename:'c.mkv',type:0,size:30,updateAt:newer}],lastFileId:-1}}:{code:0,data:{fileList:rows,lastFileId:3}})
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body})
 try{await flushPromises();const pane=getDrivePane();await pane.more();await flushPromises();expect(pane.store.ListDataRaw).toHaveLength(4);expect(pane.store.ListDataRaw.find(row=>row.file_id==='4')).toMatchObject({drive_id:account.id,parent_file_id:'',time:Date.parse(newer),icon:'iconfile_video'});expect(new URL(vi.mocked(json).mock.calls.at(-1)![2]).searchParams.get('lastFileId')).toBe('3')}finally{wrapper.unmount()}
})

it.each([false,true])('opens original 123 properties and copies public file/folder metadata (folder=%s)',async folder=>{
 const pinia=createPinia(),account={id:'123-property-ui-'+folder,providerId:'123' as const,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore(pinia).accounts=[account]
 const copy=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}})
 vi.mocked(request).mockResolvedValue({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify({code:0,data:{fileId:folder?1:3,parentFileId:0,filename:folder?'Actual Folder':'Actual.mkv',type:folder?1:0,size:4096,createAt:older,updateAt:newer,private_token:'fixture-hidden'}}))),finalUrl:''})
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body})
 try{
  await flushPromises();const pane=getDrivePane();pane.store.mMouseSelect(folder?'1':'3',false,false);await pane.action('properties',[]);await flushPromises()
  const modal=new DOMWrapper(document.body).get('.source-drive-dialog.shuxingmodal');expect(modal.text()).toContain(folder?'Actual Folder':'Actual.mkv')
  await modal.findAll('button').find(button=>button.text()==='复制JSON')!.trigger('click');await flushPromises()
  const encoded=copy.mock.calls.at(-1)![0];expect(JSON.parse(encoded)).toMatchObject({drive_id:account.id,file_id:folder?'1':'3',parent_file_id:'',name:folder?'Actual Folder':'Actual.mkv',type:folder?'folder':'file',size:4096,created_at:older,updated_at:newer});expect(encoded).not.toContain('fixture-hidden')
  expect(json).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledTimes(1)
 }finally{wrapper.unmount()}
})
