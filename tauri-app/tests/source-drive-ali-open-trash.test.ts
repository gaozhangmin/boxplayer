import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver} from '@/features/sources/drivers'
import {alipan} from '@/features/sources/alipan'
import {request,json} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),request:vi.fn(),json:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)})}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),response=(data:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let removed=false,wrapper:ReturnType<typeof mount>|undefined
beforeEach(()=>{vi.resetAllMocks();removed=false;vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(alipan);vi.mocked(json).mockImplementation(async(_account,_method,url)=>url.endsWith('/getDriveInfo')?{resource_drive_id:'resource'}:{items:removed?[]:[{drive_id:'resource',file_id:'movie',parent_file_id:'root',type:'file',name:'Movie.mkv',size:2}]});vi.mocked(request).mockImplementation(async(_account,_method,url)=>{if(url.endsWith('/recyclebin/trash')){removed=true;return response({})}return removed?response({code:'FileIdNotFound'},404):response({drive_id:'resource',file_id:'movie',parent_file_id:'root',type:'file',name:'Movie.mkv',size:2})})})
afterEach(()=>{wrapper?.unmount();wrapper=undefined;vi.restoreAllMocks()})
async function browser(){const pinia=createPinia(),account={id:crypto.randomUUID(),providerId:'alipan-open' as const,name:'Fixture',baseUrl:'',authOrigins:['https://openapi.alipan.com']};useFileSourcesStore(pinia).accounts=[account];wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();await getDrivePane().load(account.id,id('resource','root'),true);await flushPromises();const snapshot:any={items:[{id:'video',sourceId:account.id,fileId:id('resource','movie')},{id:'other',sourceId:'another',fileId:id('resource','movie')}],playlists:{list:['video','other']},series:{group:['video']}};return {pinia,account,snapshot}}
it('connects the original Delete shortcut to Open trash and removes only its confirmed catalog identity',async()=>{
 const {pinia,snapshot}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async action=>{action(snapshot)})
 expect(getDrivePane().operations.has('trash.move')).toBe(true);expect(getDrivePane().operations.has('trash.restore')).toBe(false)
 await wrapper!.get('.fileitem').trigger('click');await wrapper!.trigger('keydown',{key:'Delete',metaKey:true});await flushPromises();expect(wrapper!.findAll('.fileitem')).toHaveLength(0);expect(snapshot.items.map((row:any)=>row.id)).toEqual(['other']);expect(snapshot.playlists.list).toEqual(['other']);expect(snapshot.series.group).toEqual([]);expect(update).toHaveBeenCalledOnce()
})
it('retains the original row on catalog failure and retries synchronization without a second remote mutation',async()=>{
 const {pinia,snapshot}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValueOnce(Error('catalog disk unavailable')).mockImplementation(async action=>{action(snapshot)})
 await wrapper!.get('.fileitem').trigger('click');await wrapper!.trigger('keydown',{key:'Delete',metaKey:true});await flushPromises();expect(wrapper!.findAll('.fileitem')).toHaveLength(1);expect(wrapper!.text()).toContain('同步失败');expect(snapshot.items).toHaveLength(2)
 await wrapper!.trigger('keydown',{key:'Delete',metaKey:true});await flushPromises();expect(wrapper!.findAll('.fileitem')).toHaveLength(0);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/recyclebin/trash'))).toHaveLength(1);expect(update).toHaveBeenCalledTimes(2)
})
it('keeps old account receipts out of a replacement account catalog',async()=>{
 const {pinia,account,snapshot}=await browser();vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async(action,stillCurrent)=>{useFileSourcesStore(pinia).accounts=[{...account,userId:'new-user'}];if(stillCurrent&&!stillCurrent())return;action(snapshot)})
 expect(await getDrivePane().action('trashBatch',[account.id,account.id,[id('resource','movie')]])).toEqual([]);expect(snapshot.items).toHaveLength(2);expect(wrapper!.findAll('.fileitem')).toHaveLength(1)
})

it('connects original Cmd+Shift+Delete to documented direct deletion without exposing recycle list/restore',async()=>{
 const {pinia,snapshot}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async action=>{action(snapshot)})
 vi.mocked(request).mockImplementation(async(_account,_method,url)=>{if(url.endsWith('/delete')){removed=true;return response({drive_id:'resource',file_id:'movie'})}return removed?response({code:'NotFound.FileId'},404):response({drive_id:'resource',file_id:'movie',parent_file_id:'root',type:'file',name:'Movie.mkv',size:2})})
 expect(getDrivePane().operations.has('trash.delete')).toBe(true);expect(getDrivePane().operations.has('trash.list')).toBe(false);expect(getDrivePane().operations.has('trash.restore')).toBe(false)
 await wrapper!.get('.fileitem').trigger('click');await wrapper!.trigger('keydown',{key:'Delete',metaKey:true,shiftKey:true});await flushPromises()
 expect(wrapper!.findAll('.fileitem')).toHaveLength(0);expect(snapshot.items.map((row:any)=>row.id)).toEqual(['other']);expect(update).toHaveBeenCalledOnce()
 expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/delete'))).toHaveLength(1);expect(vi.mocked(request).mock.calls.every(call=>call[2].startsWith('https://openapi.alipan.com/'))).toBe(true)
})
