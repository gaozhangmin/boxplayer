import {it,expect,vi} from 'vitest'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver} from '@/features/sources/drivers'
import {request} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),request:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)})}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
it('keeps original multi-select Cmd+C and nested directory picker with one original 123 async request',async()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 const account={id:'123-batch-ui',providerId:'123' as const,name:'Fixture',baseUrl:'',authOrigins:[]},pinia=createPinia();useFileSourcesStore(pinia).accounts=[account]
 const row=(id:string,name:string,isDirectory=false)=>({id,name,isDirectory,size:42,playable:!isDirectory});let copied=false
 vi.mocked(driver).mockReturnValue({resolve:vi.fn(),list:vi.fn(async(_account,parent)=>({entries:!parent?[row('42','A.mkv'),row('43','B.mkv'),row('8','Target',true)]:parent==='8'&&copied?[row('99','A.mkv'),row('100','B.mkv')]:[]}))})
 vi.mocked(request).mockImplementation(async(_account,method,url)=>{
  const id=new URL(url).searchParams.get('fileID');if(method==='POST')copied=true
  const data=method==='POST'?{code:0,data:{}}:{code:0,data:{fileId:Number(id),parentFileId:id==='8'?0:8,filename:id==='8'?'Target':id==='99'?'A.mkv':'B.mkv',type:id==='8'?1:0,trashed:0}}
  return {status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''}
 })
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body}),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
 try{
  await flushPromises();getDrivePane().store.mMouseSelect('42',false,false);getDrivePane().store.mMouseSelect('43',true,false);await flushPromises()
  await wrapper.trigger('keydown',{key:'c',metaKey:true});await flushPromises()
  const picker=()=>new DOMWrapper(document.body).get('.showpandirmodal');expect(picker().text()).toContain('复制文件到')
  await picker().findAll('.sharetitleleft').find(row=>row.text()==='Target')!.trigger('click');await flushPromises()
  await picker().findAll('button').find(row=>row.text()==='选择')!.trigger('click');await flushPromises()
  const posts=vi.mocked(request).mock.calls.filter(call=>call[1]==='POST');expect(posts).toHaveLength(1)
  expect(posts[0]![2]).toBe('https://open-api.123pan.com/api/v1/file/async/copy');expect(JSON.parse(posts[0]![3]!)).toEqual({fileIds:[42,43],targetDirId:8})
  expect(getDrivePane().store.ListDataRaw.filter(row=>['42','43'].includes(row.file_id))).toHaveLength(2)
  expect(wrapper.find('[role=alert]').exists()).toBe(false);expect(update).not.toHaveBeenCalled()
 }finally{wrapper.unmount();update.mockRestore();vi.unstubAllGlobals()}
})
