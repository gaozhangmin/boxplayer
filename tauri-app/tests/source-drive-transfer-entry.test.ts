import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane,message} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {nativeCall} from '@/platform/native'
import {driver} from '@/features/sources/drivers'
import {registerTransferEntryExecutor} from '@/features/files/drive/transferEntry'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)})}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'transfer-entry',providerId:'onedrive' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
let wrapper:ReturnType<typeof mount>|undefined,unregister:(()=>void)|undefined
beforeEach(()=>{
 vi.resetAllMocks();const saved=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value)});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[{id:'movie',name:'Movie.mkv',isDirectory:false,size:42,playable:true},{id:'folder',name:'Folder',isDirectory:true,size:0,playable:false}]}),resolve:vi.fn()});vi.mocked(nativeCall).mockResolvedValue([])
})
afterEach(()=>{wrapper?.unmount();wrapper=undefined;unregister?.();unregister=undefined;vi.restoreAllMocks()})
async function browser(provider=account.providerId as string){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[{...account,providerId:provider as typeof account.providerId}];wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return {pane:getDrivePane(),pinia}}
const modal=()=>new DOMWrapper(document.body).get('.source-drive-dialog')
async function download(){const context=await browser();context.pane.store.mMouseSelect('movie',false,false);await context.pane.action('download',[]);await flushPromises();return context}
async function chooseDirectory(){vi.mocked(nativeCall).mockResolvedValueOnce(['/fixture/downloads']);await modal().findAll('button').find(button=>button.text()==='更改')!.trigger('click');await flushPromises()}
it('keeps original file picker cancellation without creating upload tasks',async()=>{
 const {pane}=await browser(),submit=vi.fn();unregister=registerTransferEntryExecutor({submit})
 expect(pane.operations.has('upload.local')).toBe(true);await wrapper!.trigger('keydown',{key:'u',metaKey:true});await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('choose_transfer_paths',{kind:'files'});expect(submit).not.toHaveBeenCalled()
})
it('keeps original folder shortcut and submits a source-bound request only to the installed boundary',async()=>{
 const {pane}=await browser(),submit=vi.fn().mockResolvedValue(false);unregister=registerTransferEntryExecutor({submit});vi.mocked(nativeCall).mockResolvedValueOnce(['/fixture/folder'])
 await wrapper!.trigger('keydown',{key:'u',metaKey:true,shiftKey:true});await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('choose_transfer_paths',{kind:'folders'});expect(submit).toHaveBeenCalledOnce();expect(submit.mock.calls[0]![0]).toMatchObject({kind:'upload',account,parent:'',paths:['/fixture/folder'],conflict:'refuse'});expect(pane.store.ListDataRaw).toHaveLength(2)
})
it('reports that execution is unavailable without inventing upload jobs or invoking HTTP',async()=>{
 await browser();const warning=vi.spyOn(message,'warning');vi.mocked(nativeCall).mockResolvedValueOnce(['/fixture/movie.mkv'])
 await wrapper!.trigger('keydown',{key:'u',metaKey:true});await flushPromises()
 expect(warning).toHaveBeenCalledWith('传输服务尚未启用，未创建任务');expect(vi.mocked(nativeCall).mock.calls.map(call=>call[0])).toEqual(['choose_transfer_paths'])
})
it('does not expose upload for the original read-only WebDAV provider',async()=>{
 const {pane}=await browser('webdav');await wrapper!.trigger('keydown',{key:'u',metaKey:true});await flushPromises();expect(pane.operations.has('upload.local')).toBe(false);expect(nativeCall).not.toHaveBeenCalled()
})
it('drops a late picker result after a same-ID account replacement',async()=>{
 const {pinia}=await browser(),submit=vi.fn();unregister=registerTransferEntryExecutor({submit});let finish!:(paths:string[])=>void;vi.mocked(nativeCall).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 await wrapper!.trigger('keydown',{key:'u',metaKey:true});useFileSourcesStore(pinia).accounts=[{...account,userId:'other'}];finish(['/fixture/late']);await flushPromises();expect(submit).not.toHaveBeenCalled()
})
it('opens the original download confirmation for files and folders without starting a direct download',async()=>{
 const {pane}=await download();expect(modal().text()).toContain('从网盘下载 文件/文件夹 到本地');expect(modal().text()).toContain('开始下载');expect(nativeCall).not.toHaveBeenCalled()
 await pane.action('closeDialog',[]);pane.store.mMouseSelect('folder',false,false);await pane.action('download',[]);await flushPromises();expect(modal().text()).toContain('开始下载');expect(nativeCall).not.toHaveBeenCalled()
})
it('keeps download dialog open when no execution backend is installed, without reporting queued tasks',async()=>{
 await download();await chooseDirectory();const warning=vi.spyOn(message,'warning');await modal().findAll('button').find(button=>button.text()==='开始下载')!.trigger('click');await flushPromises()
 expect(modal().text()).toContain('开始下载');expect(warning).toHaveBeenCalledWith('传输服务尚未启用，未创建任务');expect(vi.mocked(nativeCall).mock.calls.map(call=>call[0])).toEqual(['choose_transfer_paths'])
})
it('passes the original selected snapshot and destination to the boundary and closes only on acceptance',async()=>{
 const {pane}=await download();await chooseDirectory();pane.store.mSelectAll();const submit=vi.fn().mockResolvedValue(true);unregister=registerTransferEntryExecutor({submit})
 await modal().findAll('button').find(button=>button.text()==='开始下载')!.trigger('click');await flushPromises()
 expect(submit.mock.calls[0]![0]).toMatchObject({kind:'download',account,destination:'/fixture/downloads',files:[{id:'movie',name:'Movie.mkv',isDirectory:false}]});expect(new DOMWrapper(document.body).find('.source-drive-dialog').exists()).toBe(false);expect(vi.mocked(nativeCall).mock.calls.every(call=>call[0]==='choose_transfer_paths')).toBe(true)
})
it('does not duplicate a pending download submission',async()=>{
 await download();await chooseDirectory();let finish!:(accepted:boolean)=>void;const submit=vi.fn().mockImplementation(()=>new Promise(resolve=>{finish=resolve}));unregister=registerTransferEntryExecutor({submit})
 const button=modal().findAll('button').find(button=>button.text()==='开始下载')!;await button.trigger('click');await button.trigger('click');await flushPromises();expect(submit).toHaveBeenCalledOnce();finish(false);await flushPromises();expect(modal().text()).toContain('开始下载')
})
it('does not write a late destination after closing the original dialog',async()=>{
 const {pane}=await download();let finish!:(paths:string[])=>void;vi.mocked(nativeCall).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 await modal().findAll('button').find(button=>button.text()==='更改')!.trigger('click');await pane.action('closeDialog',[]);await flushPromises();finish(['/fixture/late']);await flushPromises();expect(pane.settings.downSavePath).toBe('')
})

it('retains the original Box ZIP-download capability and forwards the selected mode without executing it',async()=>{
 const {pane}=await browser('box');expect(pane.operations.has('files.downloadZip')).toBe(true);pane.store.mMouseSelect('folder',false,false);await pane.action('download',[false,true]);await flushPromises();await chooseDirectory()
 const submit=vi.fn().mockResolvedValue(false);unregister=registerTransferEntryExecutor({submit});await modal().findAll('button').find(button=>button.text()==='开始下载')!.trigger('click');await flushPromises()
 expect(submit.mock.calls[0]![0]).toMatchObject({kind:'download',account:{id:account.id,providerId:'box'},zip:true,files:[{id:'folder',name:'Folder',isDirectory:true}]});expect(modal().text()).toContain('开始下载');expect(vi.mocked(nativeCall).mock.calls.map(call=>call[0])).toEqual(['choose_transfer_paths'])
})
