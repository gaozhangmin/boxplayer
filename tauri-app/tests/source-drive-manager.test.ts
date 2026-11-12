import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, DOMWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
import {Tree as AntdTree} from 'ant-design-vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import { nativeCall } from '@/platform/native'
import { useFileSourcesStore } from '@/stores/fileSources'
import { driver,playSource } from '@/features/sources/drivers'
import { getDrivePane,useKeyboardStore } from '@/features/files/drive/ports'
import {useVideoCatalog} from '@/features/library/catalog'
import {json} from '@/features/sources/transport'
vi.mock('@/features/sources/transport',()=>({json:vi.fn()}))
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(e:unknown)=>({message:e instanceof Error?e.message:String(e)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',{class:'fixture-list'},(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const global={plugins:[createPinia()],stubs:{AList:list}}
beforeEach(()=>{
 vi.resetAllMocks();const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)})
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 vi.mocked(nativeCall).mockResolvedValue({sourceId:'local-fixture',relativePath:'',parentPath:null,entries:[
  {id:'hash-folder',name:'Folder',relativePath:'Folder',isDirectory:true,size:0,modified:1,playable:false},
  {id:'hash-b',name:'b.mkv',relativePath:'b.mkv',isDirectory:false,size:10,modified:2,playable:true},
  {id:'hash-a',name:'a.mkv',relativePath:'a.mkv',isDirectory:false,size:20,modified:3,playable:true}
 ]})
})
describe('direct Electron PanRight in the Tauri source browser',()=>{
 it('uses the original batch replacement UI and keeps only failed rows selected for retry',async()=>{
  const source={id:'batch-dialog',providerId:'onedrive' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
  useFileSourcesStore(global.plugins[0]).accounts=[source]
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:['a','b'].map(id=>({id,name:'Old-'+id+'.mkv',isDirectory:false,size:1,playable:true}))}),resolve:vi.fn()})
  const update=vi.spyOn(useVideoCatalog(global.plugins[0]),'update').mockResolvedValue(undefined)
  vi.mocked(json).mockResolvedValueOnce({id:'a',name:'New-a.mkv'}).mockRejectedValueOnce(Error('fixture denied')).mockResolvedValueOnce({id:'b',name:'New-b.mkv'})
  const wrapper=mount(SourceDriveManager,{props:{sourceId:source.id,name:source.name},global,attachTo:document.body});await flushPromises()
  await wrapper.trigger('keydown',{key:'a',metaKey:true});await getDrivePane().action('rename',[false,true,false]);await flushPromises()
  const body=new DOMWrapper(document.body);const dialog=()=>body.get('.renamemulti')
  expect(dialog().findAll('.mantine-label').map(label=>label.text())).toEqual(['替换','删除','增加','编号','其他'])
  const originalHeight=window.innerHeight;window.innerHeight=640;window.dispatchEvent(new Event('resize'));await flushPromises()
  expect(wrapper.getComponent(AntdTree).props('height')).toBe(508)
  window.innerHeight=originalHeight;window.dispatchEvent(new Event('resize'));await flushPromises()
  await dialog().get('input[placeholder="输入要查找的字符"]').setValue('Old');await dialog().get('input[placeholder="输入新的字符"]').setValue('New')
  const submit=()=>dialog().findAll('button').find(button=>button.text()==='应用替换')!
  await submit().trigger('click');await flushPromises()
  expect(body.find('.renamemulti').exists()).toBe(true);expect(wrapper.get('[role=alert]').text()).toContain('fixture denied')
  expect(getDrivePane().store.ListDataRaw.map(row=>row.name)).toEqual(['New-a.mkv','Old-b.mkv'])
  await submit().trigger('click');await flushPromises()
  expect(body.find('.renamemulti').exists()).toBe(false);expect(getDrivePane().store.ListDataRaw.map(row=>row.name)).toEqual(['New-a.mkv','New-b.mkv'])
  expect(json).toHaveBeenCalledTimes(3);expect(vi.mocked(json).mock.calls[2]?.[2]).toContain('/items/b')
  wrapper.unmount();update.mockRestore()
 })
 it('renames loaded nested entries without requiring them in the top-level visible list',async()=>{
  const source={id:'batch-nested',providerId:'google' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
  useFileSourcesStore(global.plugins[0]).accounts=[source]
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async(_account,parent)=>({entries:parent==='folder'?[{id:'child',name:'Old.mkv',isDirectory:false,size:1,playable:true}]:[{id:'folder',name:'Folder',isDirectory:true,size:0,playable:false}]})),resolve:vi.fn()})
  const update=vi.spyOn(useVideoCatalog(global.plugins[0]),'update').mockResolvedValue(undefined)
  vi.mocked(json).mockResolvedValue({id:'child',name:'New.mkv'})
  const wrapper=mount(SourceDriveManager,{props:{sourceId:source.id,name:source.name},global});await flushPromises()
  await getDrivePane().list(source.id,source.id,'folder')
  expect(await getDrivePane().action('renameBatch',[source.id,source.id,['child'],['New.mkv']])).toEqual([{file_id:'child',parent_file_id:'folder',isDir:false,name:'New.mkv'}])
  expect(getDrivePane().store.ListDataRaw.map(row=>row.file_id)).toEqual(['folder']);expect(getDrivePane().file?.('child')?.name).toBe('New.mkv')
  wrapper.unmount();update.mockRestore()
 })
 it('keeps the original rename modal open on failure and updates the same row after retry',async()=>{
  const source={id:'rename-dialog',providerId:'onedrive' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
  useFileSourcesStore(global.plugins[0]).accounts=[source]
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[{id:'movie',name:'Old.mkv',isDirectory:false,size:1,playable:true}]}),resolve:vi.fn()})
  const update=vi.spyOn(useVideoCatalog(global.plugins[0]),'update').mockResolvedValue(undefined)
  vi.mocked(json).mockRejectedValueOnce(Error('fixture denied')).mockResolvedValueOnce({id:'movie',name:'New.mkv'})
  const wrapper=mount(SourceDriveManager,{props:{sourceId:source.id,name:source.name},global,attachTo:document.body});await flushPromises()
  await wrapper.get('.fileitem').trigger('click')
  await getDrivePane().action('rename',[false,false,false]);await flushPromises()
  const body=new DOMWrapper(document.body);await body.get('#RenameInput').setValue('New.mkv')
  const submit=()=>body.get('.source-drive-dialog').findAll('button').find(button=>button.text()==='重命名')!
  await submit().trigger('click');await flushPromises()
  expect(body.find('#RenameInput').exists()).toBe(true);expect(wrapper.get('[role=alert]').text()).toContain('fixture denied');expect(update).not.toHaveBeenCalled()
  await submit().trigger('click');await flushPromises()
  expect(body.find('#RenameInput').exists()).toBe(false);expect(getDrivePane().store.ListDataRaw[0]).toMatchObject({file_id:'movie',name:'New.mkv'})
  expect(wrapper.find('[role=alert]').exists()).toBe(false)
  expect(update).toHaveBeenCalledTimes(1);wrapper.unmount();update.mockRestore()
 })
 it('keeps successful renames and synchronizes them when a later item fails',async()=>{
  const source={id:'rename-fixture',providerId:'onedrive' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
  useFileSourcesStore(global.plugins[0]).accounts=[source]
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[{id:'a',name:'a.mkv',isDirectory:false,size:1,playable:true},{id:'b',name:'b.mkv',isDirectory:false,size:1,playable:true}]}),resolve:vi.fn()})
  const catalog=useVideoCatalog(global.plugins[0]);const items=[{sourceId:source.id,fileId:'a',fileName:'a.mkv',name:'a.mkv',type:'unmatched'},{sourceId:source.id,fileId:'b',fileName:'b.mkv',name:'Manual title',type:'movie',metadataSource:'manual'}]
  const update=vi.spyOn(catalog,'update').mockImplementation(async mutate=>{mutate({items} as any)})
  vi.mocked(json).mockResolvedValueOnce({id:'a',name:'new-a.mkv'}).mockRejectedValueOnce(Error('fixture denied'))
  const wrapper=mount(SourceDriveManager,{props:{sourceId:source.id,name:source.name},global});await flushPromises()
  expect(await getDrivePane().action('renameBatch',[source.id,source.id,['a','b'],['new-a.mkv','new-b.mkv']])).toEqual([{file_id:'a',parent_file_id:'',name:'new-a.mkv',isDir:false}])
  expect(items[0]).toMatchObject({fileName:'new-a.mkv',name:'new-a.mkv'});expect(items[1]).toMatchObject({fileName:'b.mkv',name:'Manual title'})
  expect(wrapper.get('[role=alert]').text()).toContain('fixture denied');expect(update).toHaveBeenCalledTimes(1)
  wrapper.unmount();update.mockRestore()
 })
 it('rejects the entire malformed rename request before the first network write',async()=>{
  const source={id:'rename-preflight',providerId:'onedrive' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
  useFileSourcesStore(global.plugins[0]).accounts=[source]
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[{id:'a',name:'a.mkv',isDirectory:false,size:1,playable:true}]}),resolve:vi.fn()})
  const wrapper=mount(SourceDriveManager,{props:{sourceId:source.id,name:source.name},global});await flushPromises()
  await expect(getDrivePane().action('renameBatch',[source.id,source.id,['a','a'],['New','Other']])).rejects.toThrow('重复标识')
  await expect(getDrivePane().action('renameBatch',[source.id,source.id,['a'],[undefined]])).rejects.toThrow('无效名称')
  expect(json).not.toHaveBeenCalled();wrapper.unmount()
 })
 it('stops future remote requests after closing but synchronizes an already completed rename',async()=>{
  const source={id:'rename-close',providerId:'onedrive' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
  useFileSourcesStore(global.plugins[0]).accounts=[source]
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:['a','b'].map(id=>({id,name:id+'.mkv',isDirectory:false,size:1,playable:true}))}),resolve:vi.fn()})
  let finish!:(value:unknown)=>void;vi.mocked(json).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const update=vi.spyOn(useVideoCatalog(global.plugins[0]),'update').mockResolvedValue(undefined)
  const wrapper=mount(SourceDriveManager,{props:{sourceId:source.id,name:source.name},global});await flushPromises()
  const operation=getDrivePane().action('renameBatch',[source.id,source.id,['a','b'],['New-a','New-b']]);await flushPromises()
  wrapper.unmount();finish({id:'a',name:'New-a'});const results=await operation
  expect(results).toHaveLength(1);expect(json).toHaveBeenCalledTimes(1);expect(update).toHaveBeenCalledTimes(1);update.mockRestore()
 })
 it('does not write an old batch result into a newly selected source with the same file ID',async()=>{
  const first={id:'switch-first',providerId:'onedrive' as const,name:'First',baseUrl:'',authOrigins:[]},second={...first,id:'switch-second',name:'Second'}
  useFileSourcesStore(global.plugins[0]).accounts=[first,second]
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async account=>({entries:['a','b'].map(id=>({id,name:account.id+'-'+id+'.mkv',isDirectory:false,size:1,playable:true}))})),resolve:vi.fn()})
  let finish!:(value:unknown)=>void;vi.mocked(json).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const update=vi.spyOn(useVideoCatalog(global.plugins[0]),'update').mockResolvedValue(undefined)
  const wrapper=mount(SourceDriveManager,{props:{sourceId:first.id,name:first.name},global});await flushPromises()
  const operation=getDrivePane().action('renameBatch',[first.id,first.id,['a','b'],['New-a','New-b']]);await flushPromises()
  await wrapper.setProps({sourceId:second.id,name:second.name});await flushPromises();finish({id:'a',name:'New-a'})
  expect(await operation).toHaveLength(1);expect(json).toHaveBeenCalledTimes(1)
  expect(getDrivePane().file?.('a')?.name).toBe('switch-second-a.mkv');expect(wrapper.find('[role=alert]').exists()).toBe(false)
  expect(update).toHaveBeenCalledTimes(1);wrapper.unmount();update.mockRestore()
 })
 it.each([{providerId:'onedrive',text:true},{providerId:'box',text:true},{providerId:'guangya',text:true},{providerId:'quark',text:false},{providerId:'baidu',text:false}] as const)('keeps folder and text shortcuts distinct according to provider capability %j',async({providerId,text})=>{
  const source={id:'keyboard-fixture',providerId,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore(global.plugins[0]).accounts=[source];vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[]}),resolve:vi.fn()});
  const wrapper=mount(SourceDriveManager,{props:{sourceId:source.id,name:'Fixture'},global,attachTo:document.body});await flushPromises()
  await wrapper.trigger('keydown',{key:'n',metaKey:true,shiftKey:true});await flushPromises()
  const body=new DOMWrapper(document.body);expect(body.find('#CreatNewDirInput').exists()).toBe(true)
  await getDrivePane().action('closeDialog',[]);await flushPromises()
  await wrapper.trigger('keydown',{key:'n',metaKey:true});await flushPromises()
  expect(body.find('#CreatNewDirInput').exists()).toBe(false);expect(body.find('#CreatNewFileInput').exists()).toBe(text)
  wrapper.unmount();useFileSourcesStore(global.plugins[0]).accounts=[]
 })
 it('renders original file rows and uses its selection state, Ctrl+A and sorting',async()=>{
  const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global});await flushPromises()
  expect(nativeCall).toHaveBeenCalledWith('local_list',{sourceId:'local-fixture',relativePath:''})
  expect(wrapper.findAll('.fileitem')).toHaveLength(3)
  expect(wrapper.text()).toContain('Folder');expect(wrapper.text()).toContain('a.mkv')
  await wrapper.findAll('.fileitem')[1]!.trigger('click');expect([...getDrivePane().store.ListSelected]).toEqual(['a.mkv'])
  await wrapper.findAll('.fileitem')[2]!.trigger('click',{shiftKey:true});expect([...getDrivePane().store.ListSelected]).toEqual(['a.mkv','b.mkv'])
  await wrapper.trigger('keydown',{key:'a',ctrlKey:true});expect(getDrivePane().store.ListSelected.size).toBe(3)
  getDrivePane().store.mOrderListData('size asc');await flushPromises()
  expect(getDrivePane().store.ListDataShow.map(row=>row.name)).toEqual(['Folder','b.mkv','a.mkv'])
  expect(wrapper.findAll('.fileitem').map(row=>row.text())).toEqual(expect.arrayContaining([expect.stringContaining('Folder')]))
  wrapper.unmount();expect(()=>getDrivePane()).toThrow('closed')
 })
 it('retries failed local reads without replacing or mutating real sources',async()=>{
  vi.mocked(nativeCall).mockRejectedValueOnce(new Error('fixture unavailable'))
  const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global});await flushPromises()
  expect(wrapper.get('[role=alert]').text()).toContain('fixture unavailable')
  await wrapper.get('[role=alert] button').trigger('click');await flushPromises()
  expect(wrapper.find('[role=alert]').exists()).toBe(false);expect(wrapper.findAll('.fileitem')).toHaveLength(3)
  expect(vi.mocked(nativeCall).mock.calls.every(([command])=>command==='local_list')).toBe(true)
  wrapper.unmount()
 })
 it('does not expose excluded encryption, albums, casting, bottle or AI workspace controls',async()=>{
  const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global});await flushPromises()
  expect(wrapper.text()).not.toMatch(/加密上传|专属上传|好运瓶|投屏|AI 问答|相册名/)
  wrapper.unmount()
 })
 it('keeps remote pagination, navigation and playback bound to the selected account',async()=>{
  const source={id:'second-account',providerId:'google' as const,name:'Remote fixture',baseUrl:'',authOrigins:[]}
  useFileSourcesStore(global.plugins[0]).accounts=[source]
  const remoteList=vi.fn().mockResolvedValueOnce({entries:[{id:'folder',name:'Subfolder',isDirectory:true,size:0,playable:false}],nextCursor:'page2'})
   .mockResolvedValueOnce({entries:[{id:'movie',name:'Movie.mkv',isDirectory:false,size:12,playable:true}]})
   .mockResolvedValueOnce({entries:[]})
   .mockResolvedValueOnce({entries:[{id:'folder',name:'Subfolder',isDirectory:true,size:0,playable:false}]})
  vi.mocked(driver).mockReturnValue({list:remoteList,resolve:vi.fn()})
  const wrapper=mount(SourceDriveManager,{props:{sourceId:source.id,name:source.name},global});await flushPromises()
  await getDrivePane().more();await flushPromises();expect(getDrivePane().store.ListDataShow).toHaveLength(2)
  const file=getDrivePane().store.ListDataShow.find(file=>file.file_id==='movie')!
  await getDrivePane().action('open',[file]);expect(playSource).toHaveBeenCalledWith(source,expect.objectContaining({id:'movie'}),expect.any(Array))
  await getDrivePane().load(source.id,'folder',true);await flushPromises();expect(getDrivePane().tree.PanHistoryCount).toBe(1)
  await getDrivePane().load(source.id,'back',false);await flushPromises();expect(getDrivePane().tree.PanHistoryCount).toBe(0)
  expect(remoteList.mock.calls.map(call=>[call[0].id,call[1],call[2]])).toEqual([[source.id,'',undefined],[source.id,'','page2'],[source.id,'folder',undefined],[source.id,'',undefined]])
  expect(nativeCall).not.toHaveBeenCalled();wrapper.unmount();useFileSourcesStore(global.plugins[0]).accounts=[]
 })
 it('routes folder stars to the existing source favorite confirmation flow',async()=>{
  const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global});await flushPromises()
  await wrapper.get('.source-star').trigger('click');expect(wrapper.emitted('favorite')?.[0]?.[0]).toMatchObject({file_id:'Folder',isDir:true})
  expect(vi.mocked(nativeCall).mock.calls.every(([command])=>command==='local_list')).toBe(true)
  wrapper.unmount()
 })


})

it('leaves toolbar activation and navigation keys to the focused native control',async()=>{
 const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global,attachTo:document.body})
 try{
  await flushPromises()
  const sort=wrapper.findAll('button').find(button=>button.text().includes('名称'))!
  expect(sort.exists()).toBe(true)
  vi.mocked(nativeCall).mockClear()
  for(const key of ['Enter',' ','ArrowDown','ArrowUp','Home','End','Escape']){
   const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})
   sort.element.dispatchEvent(event)
   expect(event.defaultPrevented).toBe(false)
  }
  await flushPromises();expect(nativeCall).not.toHaveBeenCalled()
  const selectAll=new KeyboardEvent('keydown',{key:'a',metaKey:true,bubbles:true,cancelable:true})
  sort.element.dispatchEvent(selectAll);await flushPromises()
  expect(selectAll.defaultPrevented).toBe(true);expect(getDrivePane().store.ListSelected.size).toBe(3)
 }finally{wrapper.unmount()}
})

it('installs and disposes the CSP-safe error bridge for the original teleported preview',async()=>{
 const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global,attachTo:document.body})
 const popup=document.createElement('div');popup.className='popimg';popup.innerHTML='<div class="preimg"><img></div>';document.body.append(popup)
 const img=popup.querySelector('img')!
 try{
  await flushPromises();img.setAttribute('onerror',"javascript:this.src='imgerror.png';");img.dispatchEvent(new Event('error'));expect(img.style.display).toBe('none')
  wrapper.unmount();img.style.display='';img.setAttribute('onerror',"javascript:this.src='imgerror.png';");img.dispatchEvent(new Event('error'));expect(img.style.display).toBe('');expect(img.hasAttribute('onerror')).toBe(true)
 }finally{if(wrapper.exists())wrapper.unmount();popup.remove()}
})

it('forwards original row selection-button arrows and Space while preserving toolbar and favorite activation',async()=>{
 const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global,attachTo:document.body})
 try{
  await flushPromises();const rows=wrapper.findAll('.fileitem'),button=rows[0]!.get('button.select');await button.trigger('click');(button.element as HTMLButtonElement).focus()
  await button.trigger('keydown',{key:'ArrowDown',code:'ArrowDown'});await flushPromises();expect(getDrivePane().store.ListSelected.has('a.mkv')).toBe(true)
  await button.trigger('keydown',{key:' '});await flushPromises();expect(document.activeElement).toBe(wrapper.get('input[placeholder="快速筛选"]').element)
  const previousKey=useKeyboardStore().KeyDownEvent,favorite=rows[0]!.get('button.source-star'),event=new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true});favorite.element.dispatchEvent(event);expect(useKeyboardStore().KeyDownEvent).toBe(previousKey)
 }finally{wrapper.unmount()}
})
it.each([{key:'f',code:'KeyF',metaKey:true},{key:'F3',code:'F3'}])('focuses the original quick filter from a row for $key',async shortcut=>{
 const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global,attachTo:document.body})
 try{await flushPromises();const button=wrapper.findAll('.fileitem')[1]!.get('button.select');await button.trigger('click');(button.element as HTMLButtonElement).focus();await button.trigger('keydown',shortcut);await flushPromises();expect(document.activeElement).toBe(wrapper.get('input[placeholder="快速筛选"]').element)}finally{wrapper.unmount()}
})

it('uses original Enter, Backspace and F5 from row controls to navigate local directories',async()=>{
 vi.mocked(nativeCall).mockImplementation(async(command,args)=>{if(command!=='local_list')throw Error('Unexpected native write '+command);const relativePath=String(args!.relativePath||'');return {sourceId:'local-fixture',relativePath,parentPath:relativePath?'':null,entries:relativePath?[]:[{id:'folder',name:'Folder',relativePath:'Folder',isDirectory:true,size:0,modified:1,playable:false}]}})
 const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global,attachTo:document.body})
 try{await flushPromises();const row=wrapper.get('.fileitem button.select');await row.trigger('click');await row.trigger('keydown',{key:'Enter',code:'Enter'});await flushPromises();expect(nativeCall).toHaveBeenCalledWith('local_list',{sourceId:'local-fixture',relativePath:'Folder'});expect(getDrivePane().tree.selectDir.name).toBe('Folder');await wrapper.trigger('keydown',{key:'Backspace',code:'Backspace'});await flushPromises();expect(vi.mocked(nativeCall).mock.calls.at(-1)![1]).toEqual({sourceId:'local-fixture',relativePath:''});await wrapper.trigger('keydown',{key:'F5',code:'F5'});await flushPromises();expect(vi.mocked(nativeCall).mock.calls.filter(call=>call[0]==='local_list')).toHaveLength(4)}finally{wrapper.unmount()}
})

it('opens a selected folder with Enter through the actual Arco virtual list',async()=>{
 vi.mocked(nativeCall).mockImplementation(async(command,args)=>{if(command!=='local_list')throw Error('Unexpected native write '+command);const relativePath=String(args!.relativePath||'');return {sourceId:'local-fixture',relativePath,parentPath:relativePath?'':null,entries:relativePath?[]:[{id:'folder',name:'Folder',relativePath:'Folder',isDirectory:true,size:0,modified:1,playable:false},{id:'other',name:'Other',relativePath:'Other',isDirectory:true,size:0,modified:1,playable:false}]}})
 const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global:{plugins:[createPinia()]},attachTo:document.body})
 try{await flushPromises();const row=wrapper.get('.fileitem button.select');await row.trigger('click');await row.trigger('keydown',{key:'Enter',code:'Enter'});await flushPromises();expect(nativeCall).toHaveBeenCalledWith('local_list',{sourceId:'local-fixture',relativePath:'Folder'})}finally{wrapper.unmount()}
})

it('moves keyboard focus into the source browser after a mouse-only row selection',async()=>{
 vi.mocked(nativeCall).mockImplementation(async(command,args)=>{if(command!=='local_list')throw Error('Unexpected write');const path=String(args!.relativePath||'');return {sourceId:'local-fixture',relativePath:path,parentPath:path?'':null,entries:path?[]:[{id:'folder',name:'Folder',relativePath:'Folder',isDirectory:true,size:0,modified:1,playable:false}]}})
 const outside=document.createElement('button');document.body.append(outside)
 const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global,attachTo:document.body})
 try{await flushPromises();outside.focus();await wrapper.get('.fileitem button.select').trigger('click');expect(document.activeElement).toBe(wrapper.element);document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));await flushPromises();expect(nativeCall).toHaveBeenCalledWith('local_list',{sourceId:'local-fixture',relativePath:'Folder'})}finally{wrapper.unmount();outside.remove()}
})

it('restores browser keyboard focus when the clicked selection control disappears',async()=>{
 const outside=document.createElement('button');document.body.append(outside)
 const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global,attachTo:document.body})
 try{
  await flushPromises();await wrapper.get('.fileitem button.select').trigger('click')
  const cancel=wrapper.findAll('button').find(button=>button.text()==='取消已选')!
  outside.focus();await cancel.trigger('click');await flushPromises();await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
  expect(cancel.element.isConnected).toBe(false);expect(document.activeElement).toBe(wrapper.element)
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'f',code:'KeyF',metaKey:true,bubbles:true,cancelable:true}));await flushPromises()
  expect(document.activeElement).toBe(wrapper.get('input[placeholder="快速筛选"]').element)
 }finally{wrapper.unmount();outside.remove()}
})

it('does not steal newly acquired input focus after a selection control disappears',async()=>{
 const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global,attachTo:document.body})
 try{
  await flushPromises();await wrapper.get('.fileitem button.select').trigger('click')
  const cancel=wrapper.findAll('button').find(button=>button.text()==='取消已选')!,input=wrapper.get('input[placeholder="快速筛选"]')
  cancel.element.dispatchEvent(new MouseEvent('click',{bubbles:true}));(input.element as HTMLInputElement).focus();await flushPromises();await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
  expect(cancel.element.isConnected).toBe(false);expect(document.activeElement).toBe(input.element)
 }finally{wrapper.unmount()}
})

it('keeps filter editing and toolbar focus separate from row keyboard focus',async()=>{
 const outside=document.createElement('button');document.body.append(outside)
 const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global,attachTo:document.body})
 try{await flushPromises();const input=wrapper.get('input[placeholder="快速筛选"]');(input.element as HTMLInputElement).focus();await input.trigger('click');expect(document.activeElement).toBe(input.element);outside.focus();await wrapper.get('.fileitem button.source-star').trigger('click');expect(document.activeElement).not.toBe(wrapper.element);outside.focus();const sort=wrapper.findAll('button').find(button=>button.text().includes('名称'))!;await sort.trigger('click');expect(document.activeElement).not.toBe(wrapper.element)}finally{wrapper.unmount();outside.remove()}
})

it('uses the retained 450ms folder preview and twelve-entry cap without changing navigation',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']})
 const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global,attachTo:document.body})
 try{
  await flushPromises();const original=vi.mocked(nativeCall).getMockImplementation()!
  vi.mocked(nativeCall).mockImplementation(async(command,args)=>args?.relativePath==='Folder'?{sourceId:'local-fixture',relativePath:'Folder',parentPath:'',entries:Array.from({length:15},(_,i)=>({id:String(i),relativePath:'Folder/'+i+'.mp4',name:i+'.mp4',isDirectory:false,size:1,modified:1,playable:true}))}:original(command,args))
  vi.mocked(nativeCall).mockClear();await wrapper.get('.fileitem').trigger('mouseover');await vi.advanceTimersByTimeAsync(449);expect(nativeCall).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1);await flushPromises();expect(wrapper.findAll('.folderPreviewCell')).toHaveLength(12);expect(wrapper.get('.folderPreviewName').text()).toBe('Folder');expect(getDrivePane().store.ListDataShow).toHaveLength(3)
  await wrapper.get('.fileitem').trigger('mouseout');await vi.advanceTimersByTimeAsync(180);expect(wrapper.get('.folderPreviewPanel').isVisible()).toBe(false)
  await wrapper.get('.fileitem').trigger('mouseover');await vi.advanceTimersByTimeAsync(450);await flushPromises();expect(vi.mocked(nativeCall).mock.calls.filter(call=>call[1]?.relativePath==='Folder')).toHaveLength(1)
 }finally{wrapper.unmount();vi.useRealTimers()}
})

it('cancels short folder hovers and respects the preview preference',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']})
 const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global,attachTo:document.body})
 try{
  await flushPromises();vi.mocked(nativeCall).mockClear();await wrapper.get('.fileitem').trigger('mouseover');await vi.advanceTimersByTimeAsync(200);await wrapper.get('.fileitem').trigger('mouseout');await vi.advanceTimersByTimeAsync(500);expect(nativeCall).not.toHaveBeenCalled()
  getDrivePane().settings.uiFolderPreviewEnabled=false;await wrapper.get('.fileitem').trigger('mouseover');await vi.advanceTimersByTimeAsync(500);expect(nativeCall).not.toHaveBeenCalled();expect(wrapper.get('.folderPreviewPanel').isVisible()).toBe(false)
 }finally{wrapper.unmount();vi.useRealTimers()}
})

it('does not show a late folder preview after switching source',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']})
 const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},global,attachTo:document.body})
 try{
  await flushPromises();let finish!:(value:any)=>void;const original=vi.mocked(nativeCall).getMockImplementation()!
  vi.mocked(nativeCall).mockImplementation((command,args)=>args?.relativePath==='Folder'?new Promise(resolve=>{finish=resolve}):original(command,args))
  await wrapper.get('.fileitem').trigger('mouseover');await vi.advanceTimersByTimeAsync(450);expect(wrapper.get('.folderPreviewPanel').isVisible()).toBe(true)
  await wrapper.setProps({sourceId:'other-local'});await flushPromises();finish({sourceId:'local-fixture',relativePath:'Folder',entries:[{id:'late',relativePath:'Folder/late.mkv',name:'late.mkv',isDirectory:false,size:1,modified:1,playable:true}]});await flushPromises()
  expect(wrapper.get('.folderPreviewPanel').isVisible()).toBe(false);expect(wrapper.find('.folderPreviewCell').exists()).toBe(false)
 }finally{wrapper.unmount();vi.useRealTimers()}
})

it('reads remote preview through the existing source driver and invalidates cache for same-ID owner changes',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']})
 const source={id:'preview-remote',providerId:'onedrive' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
 useFileSourcesStore(global.plugins[0]).accounts=[source]
 const list=vi.fn(async(_account:any,path:string)=>({entries:path?[{id:'child',name:'child.mkv',isDirectory:false,size:1,playable:true}]:[{id:'folder',name:'Folder',isDirectory:true,size:0,playable:false}]}))
 vi.mocked(driver).mockReturnValue({list,resolve:vi.fn()})
 const wrapper=mount(SourceDriveManager,{props:{sourceId:source.id,name:source.name},global,attachTo:document.body})
 try{
  await flushPromises();await wrapper.get('.fileitem').trigger('mouseover');await vi.advanceTimersByTimeAsync(450);await flushPromises();expect(wrapper.get('.folderPreviewLabel').text()).toBe('child.mkv');expect(list.mock.calls.at(-1)![1]).toBe('folder')
  await wrapper.get('.fileitem').trigger('mouseout');await vi.advanceTimersByTimeAsync(180)
  useFileSourcesStore(global.plugins[0]).accounts=[{...source,userId:'replacement-owner'}];await flushPromises()
  await wrapper.get('.fileitem').trigger('mouseover');await vi.advanceTimersByTimeAsync(450);await flushPromises()
  expect(list.mock.calls.filter(call=>call[1]==='folder')).toHaveLength(2)
 }finally{wrapper.unmount();vi.useRealTimers()}
})

it('pins a source root favorite inside the list region without sorting or selecting it as a file',async()=>{
 const wrapper=mount(SourceDriveManager,{props:{sourceId:'local-fixture',local:true,name:'Fixture'},slots:{'list-header':()=>h('div',{'data-pinned-root':''},'所有文件')},global,attachTo:document.body})
 try{
  await flushPromises();expect(wrapper.get('#panfilelist > .source-list-header [data-pinned-root]').text()).toBe('所有文件')
  expect(getDrivePane().store.ListDataRaw).toHaveLength(3)
  await wrapper.trigger('keydown',{key:'a',metaKey:true});await flushPromises();expect(getDrivePane().store.ListSelected.size).toBe(3)
  await getDrivePane().load('local-fixture','local-dir:Folder:',true);await flushPromises();expect(wrapper.find('[data-pinned-root]').exists()).toBe(false)
  await getDrivePane().load('local-fixture','back',false);await flushPromises();expect(wrapper.find('#panfilelist [data-pinned-root]').exists()).toBe(true)
 }finally{wrapper.unmount()}
})
