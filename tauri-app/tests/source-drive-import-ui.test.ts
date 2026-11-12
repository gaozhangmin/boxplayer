import {beforeEach,describe,it,expect,vi} from 'vitest'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {createPinia} from 'pinia'
import ImportLink from '@/features/files/drive/electron/pan/topbtns/DaoRuShareLinkModal.vue'
import ShareTree from '@/features/files/drive/electron/pan/topbtns/ShowShareLinkModal.vue'
import {message} from '@/features/files/drive/ports'
import type {ShareImportUiPort} from '@/features/files/drive/shareImportUiPorts'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn()}))
const body=()=>new DOMWrapper(document.body)
function port(){return {check:vi.fn(),token:vi.fn().mockResolvedValue('capability'),info:vi.fn().mockResolvedValue({shareinfo:{share_name:'Fixture',expiration:'',is_photo_collection:false},error:''}),list:vi.fn().mockResolvedValue({items:[{file_id:'movie',name:'中文.mkv',isDir:false,icon:'iconfile_video',sizeStr:'20B',timeStr:'2026'}],next_marker:''}),close:vi.fn(),selectDirectory:vi.fn(),save:vi.fn().mockResolvedValue('success'),createFolder:vi.fn(),refresh:vi.fn()} as unknown as ShareImportUiPort}
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:vi.fn().mockResolvedValue('https://www.alipan.com/s/abcdefghijk 提取码:1234')}})})
async function input(ports=port()){const wrapper=mount(ImportLink,{props:{visible:false,shareUrl:'',sharePwd:'',port:ports},global:{plugins:[createPinia()]},attachTo:document.body});await wrapper.setProps({visible:true});await flushPromises();return {wrapper,ports}}
async function tree(ports=port()){const wrapper=mount(ShareTree,{props:{visible:false,share_id:'abcdefghijk',share_pwd:'',share_token:'capability',withsave:true,save_db:false,file_id_list:[],port:ports},global:{plugins:[createPinia()]},attachTo:document.body});await wrapper.setProps({visible:true});await flushPromises();return {wrapper,ports}}
describe('retained Electron import input and content tree',()=>{
 it('keeps the original input fields, parses clipboard and hands off only a verified token',async()=>{
  const {wrapper,ports}=await input();expect(body().text()).toContain('导入分享链接');expect(body().text()).not.toContain('保存到我的导入');expect((body().get('#DaoRuShareInput').element as HTMLInputElement).value).toBe('alipan.com/s/abcdefghijk')
  await body().findAll('button').find(button=>button.text()==='导入')!.trigger('click');await flushPromises();expect(ports.token).toHaveBeenCalledWith('abcdefghijk','1234');expect(wrapper.emitted('resolved')?.[0]).toEqual([{id:'abcdefghijk',password:'1234',token:'capability'}]);wrapper.unmount()
 })
 it('retains Quark/PikPak/Guangya pasted-link parsing without falling through to an Ali id',async()=>{
  const {wrapper,ports}=await input();await body().get('#DaoRuShareInput').trigger('paste',{clipboardData:{getData:()=> 'https://pan.quark.cn/s/Public123?pwd=abcd'}});await flushPromises();await body().findAll('button').find(button=>button.text()==='导入')!.trigger('click');await flushPromises();expect(ports.token).toHaveBeenCalledWith('quark:Public123','abcd');wrapper.unmount()
 })
 it('does not hand off a late token after the input modal unmounts',async()=>{
  const ports=port();let finish!:(value:string)=>void;vi.mocked(ports.token).mockImplementation(()=>new Promise(resolve=>{finish=resolve}));const {wrapper}=await input(ports);await body().findAll('button').find(button=>button.text()==='导入')!.trigger('click');await flushPromises();wrapper.unmount();finish('late');await flushPromises();expect(wrapper.emitted('resolved')).toBeUndefined()
 })
 it('renders the original tree, filters and save-mode buttons without the excluded album footer',async()=>{
  const {wrapper,ports}=await tree();expect(body().text()).toContain('Fixture');expect(body().text()).toContain('中文.mkv');expect(body().text()).toContain('导入勾选(按路径)');expect(body().text()).toContain('导入勾选(仅文件)');expect(body().text()).not.toContain('导入全部到相册')
  await body().findAll('button').find(button=>button.text()==='一键导入全部')!.trigger('click');expect(ports.selectDirectory).toHaveBeenCalledTimes(1)
  const callback=vi.mocked(ports.selectDirectory).mock.calls[0]![0];await callback('source','source',{drive_id:'source',file_id:'target'});expect(ports.save).toHaveBeenCalledWith('abcdefghijk','capability','source','source','target',['movie']);expect(ports.refresh).toHaveBeenCalledWith('source','source','target');wrapper.unmount()
 })
 it('ignores late metadata after the content tree unmounts',async()=>{
  const ports=port();let finish!:(value:any)=>void;vi.mocked(ports.info).mockImplementation(()=>new Promise(resolve=>{finish=resolve}));const {wrapper}=await tree(ports);wrapper.unmount();finish({shareinfo:{share_name:'late',is_photo_collection:false},error:''});await flushPromises();expect(ports.list).not.toHaveBeenCalled()
 })
 it('keeps original pinyin filtering and checked-file selection modes',async()=>{
  const {wrapper,ports}=await tree();const modal=body().get('.showsharemodal');const search=modal.get('input');await search.setValue('zhong');await flushPromises();expect(modal.text()).toContain('中文.mkv')
  await search.setValue('not-present');await flushPromises();expect(modal.text()).not.toContain('中文.mkv');await search.setValue('');await flushPromises();await modal.get('.ant-tree-checkbox').trigger('click');await flushPromises()
  await modal.findAll('button').find(button=>button.text()==='导入勾选(仅文件)')!.trigger('click');const callback=vi.mocked(ports.selectDirectory).mock.calls[0]![0];await callback('source','source',{drive_id:'source',file_id:'target'});expect(ports.save).toHaveBeenCalledWith('abcdefghijk','capability','source','source','target',['movie']);wrapper.unmount()
 })
 it('cancels the original automatic folder-expansion timer after closing',async()=>{
  const ports=port();vi.mocked(ports.list).mockResolvedValue({items:[{file_id:'folder',name:'Folder',isDir:true,icon:'iconfile-folder',sizeStr:'',timeStr:''}],next_marker:''} as any);const {wrapper}=await tree(ports);wrapper.unmount();await new Promise(resolve=>setTimeout(resolve,240));expect(ports.list).toHaveBeenCalledTimes(1)
 })
 it('reports a cyclic share folder instead of recursively building an invalid tree',async()=>{
  const ports=port();vi.mocked(ports.list).mockResolvedValue({items:[{file_id:'folder',name:'Folder',isDir:true,icon:'iconfile-folder',sizeStr:'',timeStr:''}],next_marker:''} as any);const {wrapper}=await tree(ports);await new Promise(resolve=>setTimeout(resolve,240));await flushPromises();expect(ports.list).toHaveBeenCalledTimes(2);expect(body().text()).toContain('重复或循环');wrapper.unmount()
 })

 it('reports an acknowledged asynchronous save as submitted rather than completed',async()=>{
  const ports=port();vi.mocked(ports.save).mockResolvedValue('async');const success=vi.spyOn(message,'success'),info=vi.spyOn(message,'info');const {wrapper}=await tree(ports)
  await body().findAll('button').find(button=>button.text()==='一键导入全部')!.trigger('click');const callback=vi.mocked(ports.selectDirectory).mock.calls[0]![0];await callback('source','source',{drive_id:'source',file_id:'target'})
  expect(success).not.toHaveBeenCalled();expect(info).toHaveBeenCalledWith('已提交转存任务，完成后请手动刷新保存到的文件夹');wrapper.unmount();success.mockRestore();info.mockRestore()
 })

 it('keeps manual entry usable when the WebView cannot read the clipboard',async()=>{
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});const {wrapper,ports}=await input();expect((body().get('#DaoRuShareInput').element as HTMLInputElement).value).toBe('')
  await body().get('#DaoRuShareInput').setValue('alipan.com/s/abcdefghijk');await body().findAll('button').find(button=>button.text()==='导入')!.trigger('click');await flushPromises();expect(ports.token).toHaveBeenCalledWith('abcdefghijk','');wrapper.unmount()
 })

 it('does not overwrite manual input with a late asynchronous clipboard read',async()=>{
  let finish!:(value:string)=>void;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:vi.fn(()=>new Promise<string>(resolve=>{finish=resolve}))}})
  const {wrapper,ports}=await input();await body().get('#DaoRuShareInput').setValue('alipan.com/s/manualABCDE');finish('alipan.com/s/clipboardID');await flushPromises();expect((body().get('#DaoRuShareInput').element as HTMLInputElement).value).toBe('alipan.com/s/manualABCDE')
  await body().findAll('button').find(button=>button.text()==='导入')!.trigger('click');await flushPromises();expect(ports.token).toHaveBeenCalledWith('manualABCDE','');wrapper.unmount()
 })

})
