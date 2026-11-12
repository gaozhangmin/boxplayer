import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver} from '@/features/sources/drivers'
import {baidu} from '@/features/sources/cloud'
import {rawRequest} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({rawRequest:vi.fn(),request:vi.fn(),json:vi.fn(),text:(value:{body:number[]})=>new TextDecoder().decode(new Uint8Array(value.body)),playable:()=>true}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let counter=0,actual:any,account:any
const target={fs_id:'12',path:'/Dest',filename:'Dest',isdir:1}
beforeEach(()=>{
 vi.resetAllMocks();const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 account={id:'baidu-move-ui-'+ ++counter,providerId:'baidu',name:'Fixture',baseUrl:'',authOrigins:[]};actual={fs_id:'101',path:'/Movie.mkv',filename:'Movie.mkv',isdir:0};vi.mocked(driver).mockReturnValue(baidu)
 vi.mocked(rawRequest).mockImplementation(async(_account,method,raw,body)=>{
  const url=new URL(raw)
  if(method==='POST'){const oldPath=actual.path,row=JSON.parse(new URLSearchParams(body).get('filelist')!)[0];actual={...actual,path:(row.dest==='/'?'':row.dest)+'/'+actual.filename};return response({errno:0,info:[{errno:0,path:oldPath}]})}
  if(url.pathname.endsWith('/multimedia'))return response({errno:0,list:[url.searchParams.get('fsids')==='[12]'?target:actual]})
  const parent=url.searchParams.get('dir'),rows=[actual,target].filter(row=>(row.path.slice(0,row.path.lastIndexOf('/'))||'/')===parent)
  return response({errno:0,has_more:0,list:rows.map(row=>({...row,server_filename:row.filename,size:42}))})
 })
})
async function browser(count=2,existing?:ReturnType<typeof createPinia>,initialPath=''){const pinia=existing||createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name,initialPath},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await vi.waitFor(()=>{expect(getDrivePane().store.ListLoading).toBe(false);expect(getDrivePane().store.ListDataRaw).toHaveLength(count)});return {wrapper,pinia}}
const picker=()=>new DOMWrapper(document.body).findAll('.showpandirmodal').at(-1)!
async function chooseTarget(wrapper:ReturnType<typeof mount>){
 await wrapper.trigger('keydown',{key:'x',metaKey:true});await flushPromises();await vi.waitFor(()=>expect(picker().findAll('.sharetitleleft').some(row=>row.text()==='Dest')).toBe(true));expect(picker().text()).toContain('移动文件到')
 await picker().findAll('.sharetitleleft').find(row=>row.text()==='Dest')!.trigger('click');await flushPromises();await picker().findAll('button').find(row=>row.text()==='选择')!.trigger('click');await flushPromises()
}
const posts=()=>vi.mocked(rawRequest).mock.calls.filter(call=>call[1]==='POST')
it('uses original Ctrl+X, directory picker and move callback, preserving media IDs and updating original parent metadata',async()=>{
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:'101',fileName:'Movie.mkv',name:'Manual title',metadataSource:'manual',folderPath:'',folderAncestors:[''],catalogRoots:[''],progress:37,originalMetadata:{folderPath:'/',folderId:'',driveFiles:[{id:'101',driveServerId:account.id,path:'/Movie.mkv',parentFileId:''}]}}]}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{expect(getDrivePane().operations.has('files.move')).toBe(true);expect(getDrivePane().operations.has('files.copy')).toBe(true);await wrapper.findAll('.fileitem').find(row=>row.text().includes('Movie.mkv'))!.trigger('click');await chooseTarget(wrapper);await vi.waitFor(()=>expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id==='101')).toBe(false));expect(snapshot.items[0]).toMatchObject({id:'video',fileId:'101',name:'Manual title',progress:37,folderPath:'12',folderAncestors:['','12'],originalMetadata:{folderPath:'/Dest',folderId:'12',driveFiles:[{id:'101',path:'/Dest/Movie.mkv',parentFileId:'12'}]}});expect(posts()).toHaveLength(1)}finally{wrapper.unmount();update.mockRestore()}
})
it('moves legacy folder favorites and physical descendants without changing their custom titles or progress',async()=>{
 actual={...actual,path:'/Folder',filename:'Folder',isdir:1};const {wrapper,pinia}=await browser(),sources=useFileSourcesStore(pinia),from=JSON.stringify([account.id,'/Folder']),to=JSON.stringify([account.id,'/Dest/Folder'])
 sources.bookmark(account.id,'/Folder','Custom favorite',false);sources.preferences.covers[from]='https://fixture.test/cover';sources.preferences.order=[from]
 const snapshot:any={items:[{id:'child',sourceId:account.id,fileId:'505',name:'Custom media',folderPath:'/Folder/Sub',folderAncestors:['','101','/Folder/Sub'],catalogRoots:['/Folder'],progress:42}]};const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{await wrapper.findAll('.fileitem').find(row=>row.text().includes('Folder'))!.trigger('click');await chooseTarget(wrapper);await vi.waitFor(()=>expect(sources.preferences.favorites[0]!.path).toBe('/Dest/Folder'));expect(sources.preferences.favorites[0]).toMatchObject({id:to,name:'Custom favorite'});expect(sources.preferences.covers[to]).toBe('https://fixture.test/cover');expect(sources.preferences.order).toEqual([to]);expect(snapshot.items[0]).toMatchObject({id:'child',fileId:'505',name:'Custom media',folderPath:'/Dest/Folder/Sub',folderAncestors:['','12','101','/Dest/Folder/Sub'],catalogRoots:['/Dest/Folder'],progress:42});expect(posts()).toHaveLength(1)}finally{wrapper.unmount();update.mockRestore()}
})
it('reopens the original picker to retry local sync without posting the move again',async()=>{
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:'101',fileName:'Movie.mkv',name:'Manual title',folderPath:'',folderAncestors:[''],catalogRoots:['']}]}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValueOnce(Error('fixture local sync denied')).mockImplementation(async mutate=>mutate(snapshot))
 try{await wrapper.findAll('.fileitem').find(row=>row.text().includes('Movie.mkv'))!.trigger('click');await chooseTarget(wrapper);await vi.waitFor(()=>expect(wrapper.text()).toContain('同步失败'));expect(getDrivePane().store.ListDataRaw.find(row=>row.file_id==='101')).toMatchObject({path:'/Movie.mkv',parent_file_id:''});expect(posts()).toHaveLength(1);await chooseTarget(wrapper);await vi.waitFor(()=>expect(snapshot.items[0].folderPath).toBe('12'));expect(posts()).toHaveLength(1);expect(update).toHaveBeenCalledTimes(2)}finally{wrapper.unmount();update.mockRestore()}
})
it('recovers through original F5 after the moved file disappears from the old source listing',async()=>{
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:'101',fileName:'Movie.mkv',name:'Manual',folderPath:'',folderAncestors:[''],catalogRoots:[''],progress:31}]}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValueOnce(Error('fixture sync failed')).mockImplementation(async mutate=>mutate(snapshot))
 try{await wrapper.findAll('.fileitem').find(row=>row.text().includes('Movie.mkv'))!.trigger('click');await chooseTarget(wrapper);await vi.waitFor(()=>expect(wrapper.text()).toContain('同步失败'));await flushPromises();await wrapper.trigger('keydown',{key:'F5',code:'F5'});await vi.waitFor(()=>{expect(snapshot.items[0].folderPath).toBe('12');expect(getDrivePane().store.ListLoading).toBe(false);expect(getDrivePane().store.ListDataRaw.map(row=>row.file_id)).toEqual(['12'])});expect(snapshot.items[0]).toMatchObject({id:'video',name:'Manual',progress:31});expect(posts()).toHaveLength(1);expect(wrapper.find('[role=alert]').exists()).toBe(false)}finally{wrapper.unmount();update.mockRestore()}
})
it('recovers on reopening the source without selecting the file that has already moved away',async()=>{
 const first=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:'101',name:'Manual',folderPath:'',folderAncestors:[''],catalogRoots:['']}]}
 const update=vi.spyOn(useVideoCatalog(first.pinia),'update').mockRejectedValueOnce(Error('fixture sync failed')).mockImplementation(async mutate=>mutate(snapshot))
 let next:Awaited<ReturnType<typeof browser>>|undefined
 try{await first.wrapper.findAll('.fileitem').find(row=>row.text().includes('Movie.mkv'))!.trigger('click');await chooseTarget(first.wrapper);await vi.waitFor(()=>expect(first.wrapper.text()).toContain('同步失败'));await flushPromises();first.wrapper.unmount();next=await browser(1,first.pinia);expect(snapshot.items[0]).toMatchObject({id:'video',name:'Manual',folderPath:'12',folderAncestors:['','12']});expect(posts()).toHaveLength(1);expect(update).toHaveBeenCalledTimes(2)}finally{if(next)next.wrapper.unmount();else if(first.wrapper.exists())first.wrapper.unmount();update.mockRestore()}
})
it('redirects a legacy folder entrance to the verified moved path and keeps Root navigation there',async()=>{
 actual={...actual,path:'/Folder',filename:'Folder',isdir:1}
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementation(async(...args)=>{const url=new URL(args[2]);if(args[1]==='GET'&&url.searchParams.get('dir')==='/Dest/Folder')return response({errno:0,has_more:0,list:[{fs_id:'505',path:'/Dest/Folder/Child.mkv',server_filename:'Child.mkv',isdir:0,size:42}]});return original(...args)})
 const first=await browser(),sources=useFileSourcesStore(first.pinia);sources.bookmark(account.id,'/Folder','Custom favorite',false)
 const snapshot:any={items:[{id:'child',sourceId:account.id,fileId:'505',name:'Manual',folderPath:'/Folder',folderAncestors:['101','/Folder'],catalogRoots:['/Folder'],progress:19}]}
 const update=vi.spyOn(useVideoCatalog(first.pinia),'update').mockRejectedValueOnce(Error('fixture sync failed')).mockImplementation(async mutate=>mutate(snapshot))
 let next:Awaited<ReturnType<typeof browser>>|undefined
 try{await first.wrapper.findAll('.fileitem').find(row=>row.text().includes('Folder'))!.trigger('click');await chooseTarget(first.wrapper);await vi.waitFor(()=>expect(first.wrapper.text()).toContain('同步失败'));await flushPromises();first.wrapper.unmount();next=await browser(1,first.pinia,'/Folder');expect(getDrivePane().store.DirID).toBe('/Dest/Folder');expect(getDrivePane().store.ListDataRaw[0]).toMatchObject({file_id:'505',path:'/Dest/Folder/Child.mkv'});expect(sources.preferences.favorites[0]).toMatchObject({path:'/Dest/Folder',name:'Custom favorite'});await getDrivePane().load(account.id,'root',false);expect(getDrivePane().store.DirID).toBe('/Dest/Folder');expect(snapshot.items[0]).toMatchObject({name:'Manual',progress:19,folderPath:'/Dest/Folder'});expect(posts()).toHaveLength(1)}finally{if(next)next.wrapper.unmount();else if(first.wrapper.exists())first.wrapper.unmount();update.mockRestore()}
})
