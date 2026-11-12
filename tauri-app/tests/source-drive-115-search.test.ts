import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {topSearchAll} from '@/features/files/drive/ports'
import {searchDrive115} from '@/features/files/drive/drive115Search'
import FileRightMenu from '@/features/files/drive/electron/pan/menus/FileRightMenu.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver} from '@/features/sources/drivers'
import {json,request} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:(response:{body:number[]})=>new TextDecoder().decode(new Uint8Array(response.body)),playable:(name:string)=>name.endsWith('.mkv')}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'source',providerId:'115' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id='1234567890123456789',row={file_id:id,parent_id:'12',file_name:'电影 Movie.mkv',file_category:'1',file_size:1024,thumb:'https://example.test/preview.jpg'},response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let rows:any[],total:number
beforeEach(()=>{vi.resetAllMocks();rows=[row];total=1;vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[]}),search:searchDrive115,resolve:vi.fn()});vi.mocked(request).mockImplementation(async()=>response({code:0,count:total,data:rows}))})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return {wrapper,pinia}}
describe('original 115 search result model in source manager',()=>{
 it('retains original icon, pinyin, thumbnail and parent while adapting native video capability',async()=>{const {wrapper}=await browser();try{await topSearchAll('Movie',['backup']);await flushPromises();const file=getDrivePane().store.ListDataRaw[0]!;expect(file).toMatchObject({file_id:id,parent_file_id:'12',thumbnail:row.thumb,icon:'iconfile_video',category:'video'});expect(file.namesearch).toContain('dian');await wrapper.get('.fileitem').trigger('click');await wrapper.get('.fileitem').trigger('contextmenu');await flushPromises();expect(wrapper.findAllComponents(FileRightMenu).some(menu=>menu.props('isvideo')===true)).toBe(true)}finally{wrapper.unmount()}});
 it('opens the actual result parent instead of the directory where search began',async()=>{const {wrapper}=await browser();try{await topSearchAll('Movie',['backup']);await flushPromises();await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('openLocation',[]);expect(vi.mocked(driver).mock.results[0]!.value.list).toHaveBeenLastCalledWith(account,'12',undefined)}finally{wrapper.unmount()}});
 it('loads the next search page without losing the original row model',async()=>{const {wrapper}=await browser();try{total=2;vi.mocked(request).mockImplementation(async(_a,_m,url)=>response({code:0,count:2,data:new URL(url).searchParams.get('offset')==='0'?[row]:[{...row,file_id:'2',parent_id:'13'}]}));await topSearchAll('Movie',['backup']);await flushPromises();await getDrivePane().more();expect(getDrivePane().store.ListDataRaw.map(file=>file.file_id)).toEqual([id,'2']);expect(getDrivePane().store.ListDataRaw[1]?.parent_file_id).toBe('13');expect(vi.mocked(request).mock.calls[1]![2]).toContain('offset=1')}finally{wrapper.unmount()}});
 it('does not apply late search results to another source',async()=>{const {wrapper,pinia}=await browser();let done!:(value:any)=>void;vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>done=resolve));try{const pending=topSearchAll('Movie',['backup']);await flushPromises();useFileSourcesStore(pinia).accounts.push({...account,id:'other'});await wrapper.setProps({sourceId:'other'});await flushPromises();done(response({code:0,count:1,data:[row]}));await pending;expect(getDrivePane().sourceId).toBe('other');expect(getDrivePane().store.ListDataRaw).toEqual([])}finally{wrapper.unmount()}});
})
