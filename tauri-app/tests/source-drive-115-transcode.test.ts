import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import SearchPan from '@/features/files/drive/electron/pan/topbtns/SearchPanModal.vue'
import {topSearchAll} from '@/features/files/drive/ports'
import {message} from '@/features/files/drive/ports'
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
const account={id:'source',providerId:'115' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let pushReply:any,detail:any
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});detail={file_id:'movie',file_category:'1',pick_code:'fixture-pick',play_long:100};pushReply={code:0,state:true,message:'任务已提交'};
 vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[{id:'movie',name:'Movie.mkv',isDirectory:false,size:1,playable:true}]}),resolve:vi.fn()});vi.mocked(request).mockImplementation(async(_account,_method,url)=>response(url.includes('get_info')?{code:0,data:detail}:pushReply))
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();await wrapper.get('.fileitem').trigger('click');return {wrapper,pinia}}
describe('original 115 transcode menu and native account boundary',()=>{
 it.each(['vip_push','pay_push'])('submits %s with original form fields and reports acceptance',async op=>{const {wrapper}=await browser();const success=vi.spyOn(message,'success').mockImplementation(()=>undefined as any);try{await getDrivePane().action('transcode',[op]);expect(request).toHaveBeenCalledTimes(2);expect(vi.mocked(request).mock.calls[0]!.slice(1,3)).toEqual(['GET','https://proapi.115.com/open/folder/get_info?file_id=movie']);expect(vi.mocked(request).mock.calls[1]).toEqual([account,'POST','https://proapi.115.com/open/video/video_push','pick_code=fixture-pick&op='+op,expect.objectContaining({'Content-Type':'application/x-www-form-urlencoded'})]);expect(vi.mocked(request).mock.calls[1]![4]).not.toHaveProperty('Authorization');expect(success).toHaveBeenCalledWith('任务已提交')}finally{success.mockRestore();wrapper.unmount()}});
 it.each([{file_id:'foreign',file_category:'1',pick_code:'fixture'},{file_id:'movie',file_category:'0',pick_code:'fixture'},{file_id:'movie',file_category:'1',pick_code:''}])('rejects invalid detail without submitting %j',async value=>{detail=value;const {wrapper}=await browser();try{await expect(getDrivePane().action('transcode',['vip_push'])).rejects.toThrow('详情');expect(request).toHaveBeenCalledTimes(1)}finally{wrapper.unmount()}});
 it('reports provider rejection without a success message',async()=>{pushReply={code:99,state:false,message:'枫叶不足'};const {wrapper}=await browser(),error=vi.spyOn(message,'error').mockImplementation(()=>undefined as any),success=vi.spyOn(message,'success').mockImplementation(()=>undefined as any);try{await getDrivePane().action('transcode',['pay_push']);expect(error).toHaveBeenCalledWith('枫叶不足');expect(success).not.toHaveBeenCalled()}finally{error.mockRestore();success.mockRestore();wrapper.unmount()}});
 it('rejects unsupported operation before reading details or writing',async()=>{const {wrapper}=await browser();try{await expect(getDrivePane().action('transcode',['other'])).rejects.toThrow('操作无效');expect(request).not.toHaveBeenCalled()}finally{wrapper.unmount()}});
 it('does not submit after switching sources during detail retrieval',async()=>{const {wrapper,pinia}=await browser();let done!:(value:any)=>void;vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>done=resolve));try{const pending=getDrivePane().action('transcode',['vip_push']);await flushPromises();useFileSourcesStore(pinia).accounts.push({...account,id:'other'});await wrapper.setProps({sourceId:'other'});await flushPromises();done(response({code:0,data:detail}));await expect(pending).rejects.toThrow('来源已切换');expect(request).toHaveBeenCalledTimes(1)}finally{wrapper.unmount()}});
 it('suppresses late push notifications after source switching',async()=>{const {wrapper,pinia}=await browser();let done!:(value:any)=>void;const success=vi.spyOn(message,'success').mockImplementation(()=>undefined as any),error=vi.spyOn(message,'error').mockImplementation(()=>undefined as any);vi.mocked(request).mockImplementation(async(_a,_m,url)=>url.includes('get_info')?response({code:0,data:detail}):new Promise(resolve=>done=resolve));try{const pending=getDrivePane().action('transcode',['pay_push']);await flushPromises();expect(request).toHaveBeenCalledTimes(2);useFileSourcesStore(pinia).accounts.push({...account,id:'other'});await wrapper.setProps({sourceId:'other'});await flushPromises();done(response(pushReply));await expect(pending).rejects.toThrow('来源已切换');expect(success).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled()}finally{success.mockRestore();error.mockRestore();wrapper.unmount()}});
 it('retains original one-video selection warning',async()=>{const {wrapper}=await browser();const warning=vi.spyOn(message,'warning').mockImplementation(()=>undefined as any);try{getDrivePane().store.mSelectAll();await getDrivePane().action('transcode',['vip_push']);expect(warning).toHaveBeenCalledWith('请选择一个 115 视频文件');expect(request).not.toHaveBeenCalled()}finally{warning.mockRestore();wrapper.unmount()}});

})
