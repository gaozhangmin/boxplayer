import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver} from '@/features/sources/drivers'
import {alipan} from '@/features/sources/alipan'
import {request} from '@/features/sources/transport'
vi.mock('@/features/sources/alipan',()=>({alipan:{list:vi.fn()}}))
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(value:{body:number[]})=>new TextDecoder().decode(new Uint8Array(value.body)),playable:()=>true}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'source',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let favorites:Record<string,string[]>,failed=false,repeated=false
beforeEach(()=>{vi.resetAllMocks();favorites={resource:['a','b'],backup:['a']};failed=false;repeated=false;vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 vi.mocked(alipan.list).mockResolvedValue({entries:['resource','backup'].map(drive=>({id:id(drive,'root'),name:drive,isDirectory:true,size:0,playable:false}))})
 vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async()=>({entries:[{id:id('resource','a'),name:'a.mkv',isDirectory:false,size:1,playable:true,favorite:favorites.resource!.includes('a')}]})),resolve:vi.fn()})
 vi.mocked(request).mockImplementation(async(_account,_method,url,body)=>{
  const input=JSON.parse(body!)
  if(url.includes('/list_by_custom_index_key?')){const all=favorites[input.drive_id]||[],start=input.marker?all.indexOf(input.marker)+1:0,items=all.slice(start,start+1);return response({items:items.map(file=>({file_id:file,drive_id:input.drive_id,parent_file_id:'root',name:file+'.mkv',type:'file',size:1,starred:true})),next_marker:start+1<all.length?items[0]:''})}
  if(url.endsWith('/batch')){const row=input.requests[0],value=row.body;if(failed&&value.drive_id==='backup')return response({responses:[{id:row.id,status:403,body:{code:'denied'}}]});if(value.starred){if(!favorites[value.drive_id]!.includes(row.id))favorites[value.drive_id]!.push(row.id)}else if(!repeated)favorites[value.drive_id]=favorites[value.drive_id]!.filter(file=>file!==row.id);return response({responses:[{id:row.id,status:200,body:{file_id:row.id,drive_id:value.drive_id,starred:value.starred}}]})}
  throw Error('unexpected endpoint')
 })
})
async function browser(initialPath='favorite'){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name,initialPath},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return {wrapper,pinia}}
describe('Ali original favorites UI with account-bound update/list ports',()=>{
 it('uses original favorite and unfavorite methods and keeps list markers current',async()=>{
  favorites.resource=[];const {wrapper}=await browser('');await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('favorite',[false,true]);await flushPromises();expect(getDrivePane().store.ListDataRaw[0]!.starred).toBe(true)
  const sent=JSON.parse(vi.mocked(request).mock.calls[0]![3]!);expect(sent.requests[0]).toMatchObject({id:'a',url:'/file/update',body:{drive_id:'resource',file_id:'a',custom_index_key:'starred_yes',starred:true}})
  await getDrivePane().action('favorite',[false,false]);await flushPromises();expect(getDrivePane().store.ListDataRaw[0]!.starred).toBe(false);expect(favorites.resource).toEqual([]);wrapper.unmount()
 })
 it('retains original favorite list recipe, true markers and navigation entry',async()=>{
  const {wrapper}=await browser();expect(getDrivePane().store.SelectDirType).toBe('favorite');expect(getDrivePane().store.ListDataRaw.every(file=>file.starred)).toBe(true);expect(getDrivePane().tree.navigationOptions.some(row=>row.file_id==='favorite')).toBe(true)
  expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!)).toEqual({drive_id:'resource',marker:'',limit:100,url_expire_sec:14400,fields:'*',order_by:'updated_at',order_direction:'DESC',custom_index_key:'starred_yes',parent_file_id:'root'});wrapper.unmount()
 })
 it('clears both drives through original first-page loop without deleting files/catalog items',async()=>{
  const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined);vi.mocked(request).mockClear();await getDrivePane().action('clearFavorites',[]);await flushPromises();expect(favorites).toEqual({resource:[],backup:[]});expect(getDrivePane().store.ListDataRaw).toEqual([]);expect(update).not.toHaveBeenCalled()
  const calls=vi.mocked(request).mock.calls;expect(calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(3);expect(calls.every(call=>!call[2].includes('/delete'))).toBe(true);expect(calls.filter(call=>call[2].includes('/list_by_custom_index_key?')).every(call=>JSON.parse(call[3]!).marker==='')).toBe(true);wrapper.unmount();update.mockRestore()
 })
 it('stops on partial failure and preserves the failing drive favorites',async()=>{
  failed=true;const {wrapper}=await browser();await getDrivePane().action('clearFavorites',[]);await flushPromises();expect(favorites.resource).toEqual([]);expect(favorites.backup).toEqual(['a']);expect(wrapper.text()).toContain('未完全清空');wrapper.unmount()
 })
 it('stops repeated provider rows rather than spinning on clear',async()=>{
  repeated=true;const {wrapper}=await browser();vi.mocked(request).mockClear();await getDrivePane().action('clearFavorites',[]);await flushPromises();expect(wrapper.text()).toContain('仍返回已取消收藏');expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1);wrapper.unmount()
 })
 it('does not apply a late favorite receipt to another source with the same ID',async()=>{
  favorites.resource=[];const {wrapper,pinia}=await browser('');await wrapper.get('.fileitem').trigger('click');let resolveRequest!:(value:any)=>void;vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>{resolveRequest=resolve}));const pending=getDrivePane().action('favorite',[false,true]);await flushPromises();useFileSourcesStore(pinia).accounts.push({...account,id:'other'});await wrapper.setProps({sourceId:'other'});await flushPromises();resolveRequest(response({responses:[{id:'a',status:200,body:{file_id:'a',drive_id:'resource',starred:true}}]}));await pending;await flushPromises();expect(getDrivePane().sourceId).toBe('other');expect(getDrivePane().store.ListDataRaw[0]!.starred).toBe(false);wrapper.unmount()
 })
 it('clears the previous error after a successful retry of the remaining drive',async()=>{
  failed=true;const {wrapper}=await browser();await getDrivePane().action('clearFavorites',[]);await flushPromises();expect(wrapper.text()).toContain('未完全清空');failed=false;await getDrivePane().action('clearFavorites',[]);await flushPromises();expect(favorites).toEqual({resource:[],backup:[]});expect(wrapper.find('.drive-error').exists()).toBe(false);wrapper.unmount()
 })
 it('rejects mismatched favorite receipts without flipping the UI marker',async()=>{
  favorites.resource=[];const {wrapper}=await browser('');vi.mocked(request).mockResolvedValueOnce(response({responses:[{id:'a',status:200,body:{file_id:'wrong',drive_id:'resource',starred:true}}]}));await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('favorite',[false,true]);await flushPromises();expect(getDrivePane().store.ListDataRaw[0]!.starred).toBe(false);expect(wrapper.text()).toContain('未确认完成');wrapper.unmount()
 })
})
