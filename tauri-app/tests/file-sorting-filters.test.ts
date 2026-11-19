import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia} from 'pinia'
import {sortedFiles,readFilePreferences} from '@/features/files/preferences'
import {matchesFileFilter,entryTimes} from '@/features/files/fileSorting'
import {useFileSourcesStore} from '@/stores/fileSources'
import {fileLabels} from '@/features/files/fileLabels'
beforeEach(()=>{const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)})})
it.each(['modified','added','watched'] as const)('sorts by %s in either direction with folders first and missing times last',sort=>{
 const rows=[{name:'Unknown',isDirectory:false,size:1},{name:'Recent',isDirectory:false,size:1,[sort]:Date.parse('2026-11-19')},{name:'Old',isDirectory:false,size:1,[sort]:Date.parse('2026-01-01')},{name:'Folder',isDirectory:true,size:0}]
 expect(sortedFiles(rows,sort,false).map(row=>row.name)).toEqual(['Folder','Old','Recent','Unknown']);expect(sortedFiles(rows,sort,true).map(row=>row.name)).toEqual(['Folder','Recent','Old','Unknown']);expect(rows[0].name).toBe('Unknown')
})
it('normalizes provider seconds, milliseconds and ISO time without overwriting native display time',()=>{
 expect(entryTimes({modified:1760000000}).modified).toBe(1760000000000)
 expect(entryTimes({electronModel:{time:1760000000000,created_at:'2026-01-01T00:00:00Z'}})).toEqual({modified:1760000000000,added:Date.parse('2026-01-01T00:00:00Z'),watched:undefined})
})
it.each([['video','Film.MKV'],['image','Poster.JPEG'],['document','Report.docx'],['subtitle','Film.ASS']] as const)('filters %s while preserving folder navigation', (filter,name)=>{
 expect(matchesFileFilter({name,isDirectory:false},filter)).toBe(true);expect(matchesFileFilter({name:'Folder',isDirectory:true},filter)).toBe(true);expect(matchesFileFilter({name:'music.flac',isDirectory:false},filter)).toBe(false)
})
it('persists source and directory choices and migrates manual source order',()=>{
 localStorage.setItem('tauri.filePreferences',JSON.stringify({order:['b','a']}));const store=useFileSourcesStore(createPinia());expect(store.preferences.sourceSort).toBe('manual');store.selectSourceSort('watched');store.preferences.sort='added';store.preferences.filter='subtitle';const saved=readFilePreferences();expect(saved).toMatchObject({sourceSort:'watched',sort:'added',filter:'subtitle',order:['b','a']})
})
it('records real playback for unscanned files and source cards without treating loading as viewing',()=>{
 const store=useFileSourcesStore(createPinia()),snapshot={sourceId:'cloud',itemId:'file',state:'loading',position:10,duration:100} as any
 store.recordPlayback(snapshot);expect(store.preferences.watchedFiles).toEqual({});store.recordPlayback({...snapshot,state:'playing'});expect(store.preferences.watchedFiles[JSON.stringify(['cloud','file'])]).toBeGreaterThan(0);expect(store.preferences.times.cloud.watched).toBeGreaterThan(0)
})
it('provides all new labels in Simplified/Traditional Chinese and English',()=>{for(const locale of ['zh-CN','zh-TW','en-US'])for(const key of ['name','modified','added','watched','all','video','image','document','subtitle'] as const)expect(fileLabels(locale)[key]).toBeTruthy()})
it('places file types in the More submenu instead of another toolbar button',async()=>{
 const {mount,DOMWrapper,flushPromises}=await import('@vue/test-utils');const {default:Toolbar}=await import('@/features/files/electron/FilesFolderToolbar.vue')
 const wrapper=mount(Toolbar,{props:{mode:'grid',descending:false,selection:false,filter:'all'},attachTo:document.body});expect(wrapper.find('.file-type-filter').exists()).toBe(false)
 await wrapper.get('.more-button').trigger('click');await flushPromises();const menu=new DOMWrapper(document.body);await menu.findAll('.arco-dropdown-option').find(option=>option.text().includes('文件类型'))!.trigger('mouseenter');await flushPromises();await vi.waitFor(()=>expect(menu.find('[data-file-filter="image"]').exists()).toBe(true));await menu.get('[data-file-filter="image"]').trigger('click');expect(wrapper.emitted('filter')).toEqual([['image']]);wrapper.unmount()
})
