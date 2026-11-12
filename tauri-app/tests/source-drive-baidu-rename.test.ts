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
beforeEach(()=>{
 vi.resetAllMocks();const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 account={id:'baidu-component-'+ ++counter,providerId:'baidu',name:'Fixture',baseUrl:'',authOrigins:[]};actual={fs_id:'101',path:'/Old.mkv',filename:'Old.mkv',isdir:0};vi.mocked(driver).mockReturnValue(baidu)
 vi.mocked(rawRequest).mockImplementation(async(_account,method,raw,body)=>{
  const url=new URL(raw)
  if(method==='POST'){const oldPath=actual.path,name=JSON.parse(new URLSearchParams(body).get('filelist')!)[0].newname;actual={...actual,path:'/'+name,filename:name};return response({errno:0,info:[{errno:0,path:oldPath}]})}
  if(url.pathname.endsWith('/multimedia'))return response({errno:0,list:[actual]})
  return response({errno:0,has_more:0,list:[{...actual,server_filename:actual.filename,size:42,server_mtime:1700000000}]})
 })
})
async function browser(count=1){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await vi.waitFor(()=>expect(getDrivePane().store.ListDataRaw).toHaveLength(count));return {wrapper,pinia}}
async function rename(wrapper:ReturnType<typeof mount>,name:string){await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('rename',[false,false,false]);await flushPromises();const body=new DOMWrapper(document.body);await body.get('#RenameInput').setValue(name);await body.get('.source-drive-dialog').findAll('button').find(button=>button.text()==='重命名')!.trigger('click');await flushPromises();return body}
const posts=()=>vi.mocked(rawRequest).mock.calls.filter(call=>call[1]==='POST')
it('uses the original rename modal and updates current metadata and catalog without changing stable media identities',async()=>{
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:'101',fileName:'Old.mkv',name:'Old.mkv',type:'unmatched',size:42,progress:25,watched:true}],playlists:{watch:['video']},series:{group:['video']}}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{const body=await rename(wrapper,'New.mkv');expect(body.find('#RenameInput').exists()).toBe(false);expect(getDrivePane().store.ListDataRaw[0]).toMatchObject({file_id:'101',name:'New.mkv',path:'/New.mkv',description:'baidu_fsid:101;baidu_path:/New.mkv'});expect(snapshot.items[0]).toMatchObject({id:'video',fileId:'101',fileName:'New.mkv',name:'New.mkv',progress:25,watched:true});expect(snapshot.playlists.watch).toEqual(['video']);expect(snapshot.series.group).toEqual(['video']);expect(posts()).toHaveLength(1)}finally{wrapper.unmount();update.mockRestore()}
})
it('updates legacy folder bookmarks, cover/order and descendant catalog paths after confirmed folder rename',async()=>{
 actual={...actual,path:'/Folder',filename:'Folder',isdir:1};const {wrapper,pinia}=await browser(),sources=useFileSourcesStore(pinia),from=JSON.stringify([account.id,'/Folder']),to=JSON.stringify([account.id,'/Renamed'])
 sources.bookmark(account.id,'/Folder','Custom favorite',false);sources.preferences.covers[from]='https://fixture.test/cover';sources.preferences.hiddenOnHome[from]=true;sources.preferences.order=[from]
 const snapshot:any={items:[{id:'video',sourceId:account.id,fileId:'child',fileName:'Movie.mkv',name:'Custom media',type:'movie',size:42,folderPath:'/Folder/Sub',folderAncestors:['101','/Folder','/Folder/Sub'],catalogRoots:['/Folder'],progress:12}]}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{await rename(wrapper,'Renamed');expect(getDrivePane().store.ListDataRaw[0]).toMatchObject({file_id:'101',name:'Renamed',isDir:true,path:'/Renamed'});expect(sources.preferences.favorites[0]).toMatchObject({id:to,path:'/Renamed',name:'Custom favorite'});expect(sources.preferences.covers[to]).toBe('https://fixture.test/cover');expect(sources.preferences.order).toEqual([to]);expect(sources.preferences.hiddenOnHome[to]).toBe(true);expect(snapshot.items[0]).toMatchObject({fileId:'child',name:'Custom media',folderPath:'/Renamed/Sub',folderAncestors:['101','/Renamed','/Renamed/Sub'],catalogRoots:['/Renamed'],progress:12});expect(posts()).toHaveLength(1)}finally{wrapper.unmount();update.mockRestore()}
})
it('repairs failed catalog synchronization on retry without posting the confirmed rename again',async()=>{
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:'101',fileName:'Old.mkv',name:'Manual title',metadataSource:'manual',type:'movie'}]}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValueOnce(Error('fixture sync denied')).mockImplementation(async mutate=>mutate(snapshot))
 try{await rename(wrapper,'New.mkv');expect(wrapper.text()).toContain('同步失败');expect(posts()).toHaveLength(1);await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('rename',[false,false,false]);await flushPromises();expect(new DOMWrapper(document.body).get('#RenameInput').element).toHaveProperty('value','New.mkv');expect(snapshot.items[0]).toMatchObject({fileName:'New.mkv',name:'Manual title'});expect(posts()).toHaveLength(1);expect(update).toHaveBeenCalledTimes(2)}finally{wrapper.unmount();update.mockRestore()}
})
it('preserves confirmed items and reports individual failures from the original batch rename action',async()=>{
 const rows:Record<string,any>={'101':{...actual},'102':{...actual,fs_id:'102',path:'/Other.mkv',filename:'Other.mkv'}}
 vi.mocked(rawRequest).mockImplementation(async(_account,method,raw,body)=>{
  const url=new URL(raw)
  if(method==='POST'){const request=JSON.parse(new URLSearchParams(body).get('filelist')!)[0];if(request.path==='/Other.mkv')return response({errno:0,info:[{errno:-8,path:request.path}]});rows['101']={...rows['101'],path:'/'+request.newname,filename:request.newname};return response({errno:0,info:[{errno:0,path:request.path}]})}
  if(url.pathname.endsWith('/multimedia'))return response({errno:0,list:[rows[url.searchParams.get('fsids')!.slice(1,-1)]]})
  return response({errno:0,has_more:0,list:Object.values(rows).map(row=>({...row,server_filename:row.filename,size:42}))})
 })
 const {wrapper,pinia}=await browser(2),snapshot:any={items:[{id:'first',sourceId:account.id,fileId:'101',fileName:'Old.mkv',name:'Manual first',type:'movie',metadataSource:'manual'},{id:'second',sourceId:account.id,fileId:'102',fileName:'Other.mkv',name:'Manual second',type:'movie',metadataSource:'manual'}]}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{const result=await getDrivePane().action('renameBatch',[account.id,account.id,['101','102'],['New.mkv','Another.mkv']]);expect(result.map((row:any)=>row.file_id)).toEqual(['101']);expect(snapshot.items[0]).toMatchObject({fileName:'New.mkv',name:'Manual first'});expect(snapshot.items[1]).toMatchObject({fileName:'Other.mkv',name:'Manual second'});expect(wrapper.text()).toContain('拒绝单项重命名');expect(posts()).toHaveLength(2)}finally{wrapper.unmount();update.mockRestore()}
})
