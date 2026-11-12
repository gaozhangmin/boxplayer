import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {message} from '@/features/files/drive/ports'
import {useVideoCatalog} from '@/features/library/catalog'
import NewFolder from '@/features/files/drive/electron/pan/topbtns/CreatNewDirModal.vue'
import Rename from '@/features/files/drive/electron/pan/topbtns/RenameModal.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {request} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:(response:{body:number[]})=>new TextDecoder().decode(new Uint8Array(response.body)),playable:(name:string)=>name.endsWith('.mkv')}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
let index=0,account:any,names:Record<string,string>,parent:string
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
beforeEach(()=>{vi.resetAllMocks();account={id:'batch-ui-'+ ++index,providerId:'pikpak',userId:'owner',name:'Fixture',baseUrl:'',authOrigins:[]};names={file:'Old.mkv'};parent='target';vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async(_a,path)=>({entries:path?[{id:'file',name:names.file,isDirectory:false,size:1,playable:true}]:[{id:'target',name:'Target',isDirectory:true,size:0,playable:false},{id:'file',name:names.file,isDirectory:false,size:1,playable:true}]})),resolve:vi.fn()});vi.mocked(request).mockImplementation(async(_a,method,url)=>{if(method==='POST')return response({task_id:'job'});if(url.includes('/tasks/'))return response({id:'job',user_id:'owner',phase:'PHASE_TYPE_COMPLETE'});if(url.includes('/files/target?'))return response({id:'target',name:'Target',kind:'drive#folder',parent_id:''});if(url.includes('/files?'))return response({files:[{id:'file',name:'Old.mkv',kind:'drive#file',parent_id:'old',trashed:true,phase:'PHASE_TYPE_COMPLETE'}],next_page_token:''});return response({id:'file',name:'Auto(1).mkv',kind:'drive#file',parent_id:parent})})})
async function browser(initialPath=''){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name,initialPath},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return {wrapper,pinia}}
describe('PikPak original recycle bin integration',()=>{
 it('opens the original bin toolbar and clears only confirmed source catalog references',async()=>{
  const {wrapper,pinia}=await browser(),draft={items:[{id:'media',sourceId:account.id,fileId:'file'},{id:'other',sourceId:'other',fileId:'file'}],playlists:{watch:['media','other']},series:{group:['media']}}
  const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async updater=>{updater(draft as any)})
  try{
   await getDrivePane().load(account.id,'trash',true)
   await vi.waitFor(()=>expect(getDrivePane().store.ListDataRaw.map(row=>row.file_id)).toEqual(['file']))
   expect(wrapper.text()).toContain('清空回收站')
   expect(await getDrivePane().action('emptyTrashDirect',[account.id,account.id])).toBe(1)
   expect(getDrivePane().store.ListDataRaw).toEqual([])
   expect(draft.items.map(item=>item.id)).toEqual(['other']);expect(draft.playlists.watch).toEqual(['other'])
   expect(vi.mocked(request).mock.calls.find(call=>call[1]==='POST')?.[2]).toContain('batchDelete')
  }finally{update.mockRestore();wrapper.unmount()}
 })
 it('uses the original trash menu command and preserves unrelated catalog items',async()=>{
  const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
  try{
   await wrapper.findAll('.fileitem').find(node=>node.text().includes('Old.mkv'))!.trigger('click')
   await getDrivePane().action('trash',[false,false]);await flushPromises()
   expect(vi.mocked(request).mock.calls.find(call=>call[1]==='POST')?.[2]).toContain('batchTrash')
   expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id==='file')).toBe(false)
   expect(update).toHaveBeenCalledTimes(1)
  }finally{update.mockRestore();wrapper.unmount()}
 })
})
