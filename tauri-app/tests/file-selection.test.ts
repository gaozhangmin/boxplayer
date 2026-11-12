import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useFileSelection } from '@/features/files/adapters/fileSelection'
import { sortedFiles } from '@/features/files/preferences'
import { NewRenameConfigData, RunReplaceName, type TreeNodeData } from '@/features/files/electron/renamemulti'

function pane() {
 const rows=ref(['a','b','c','d','e'].map(file_id=>({file_id}))),selected=ref<string[]>([])
 const scope=effectScope();const selection=scope.run(()=>useFileSelection(rows,selected))!
 return {rows,selected,selection,stop:()=>scope.stop()}
}
describe('Electron selection state in independent Tauri panes',()=>{
 it('keeps Ctrl selection and contracts a Shift range around its original anchor',()=>{
  const p=pane();p.selection.mouse('b');p.selection.mouse('e',false,true)
  expect(p.selected.value).toEqual(['b','c','d','e'])
  p.selection.mouse('c',false,true);expect(p.selected.value).toEqual(['b','c'])
  p.selection.mouse('a',true);expect(p.selected.value).toEqual(['b','c','a'])
  p.selection.mouse('a',true);expect(p.selected.value).toEqual(['b','c']);p.stop()
 })
 it('distinguishes mouse toggle from keyboard selection and isolates panes',()=>{
  const p=pane(),q=pane();p.selection.mouse('b');p.selection.mouse('b');expect(p.selected.value).toEqual([])
  p.selection.keyboard('b');p.selection.keyboard('b');expect(p.selected.value).toEqual(['b'])
  expect(q.selected.value).toEqual([]);expect(p.selection.next('next')).toBe('c');p.stop();q.stop()
 })
 it('toggles select all and supports inverse/cancel',()=>{
  const p=pane();p.selection.all();expect(p.selected.value).toHaveLength(5)
  p.selection.all();expect(p.selected.value).toEqual([])
  p.selection.mouse('b');p.selection.reverse();expect(p.selected.value).toEqual(['a','c','d','e'])
  p.selection.cancel();expect(p.selection.anchor.value).toBe('');expect(p.selected.value).toEqual([]);p.stop()
 })
 it('uses original keyboard navigation, including Shift contraction and Ctrl focus-only movement',()=>{
  const p=pane(),scroll:string[]=[],opened:string[]=[]
  const key=(key:string,options:KeyboardEventInit={})=>p.selection.key(new KeyboardEvent('keydown',{key,cancelable:true,...options}),id=>scroll.push(id),id=>opened.push(id))
  key('ArrowDown');expect(p.selected.value).toEqual(['a'])
  key('ArrowDown',{shiftKey:true});key('ArrowDown',{shiftKey:true});expect(p.selected.value).toEqual(['a','b','c'])
  key('ArrowUp',{shiftKey:true});expect(p.selected.value).toEqual(['a','b'])
  key('ArrowDown',{ctrlKey:true});expect(p.selected.value).toEqual(['a','b']);expect(p.selection.focus.value).toBe('c')
  key('Enter');expect(opened).toEqual(['c']);expect(p.selected.value).toEqual(['c'])
  key('a',{metaKey:true});expect(p.selected.value).toHaveLength(5)
  key('Escape');expect(p.selected.value).toEqual([]);expect(scroll.length).toBeGreaterThan(0);p.stop()
 })
 it('leaves editable targets and repeated selection shortcuts alone',()=>{
  const p=pane(),input=document.createElement('input');document.body.append(input)
  input.addEventListener('keydown',event=>p.selection.key(event,()=>{},()=>{}))
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true}));expect(p.selected.value).toEqual([])
  expect(p.selection.key(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,repeat:true}),()=>{},()=>{})).toBe(false)
  input.remove();p.stop()
 })
 it('prunes removed results without leaking the previous range anchor',async()=>{
  const p=pane();p.selection.mouse('e');p.rows.value=[{file_id:'a'}];await nextTick()
  expect(p.selected.value).toEqual([]);expect(p.selection.focus.value).toBe('');expect(p.selection.anchor.value).toBe('')
  p.selection.mouse('unlisted');expect(p.selected.value).toEqual([]);p.stop()
 })
})
describe('Electron original file algorithms',()=>{
 const rows=[{name:'file10',isDirectory:false,size:10,modified:2},{name:'dir',isDirectory:true,size:0,modified:0},{name:'file2',isDirectory:false,size:2,modified:3}]
 it('sorts folders first and numeric names without mutating the source',()=>{
  expect(sortedFiles(rows,'name',false).map(r=>r.name)).toEqual(['dir','file2','file10'])
  expect(sortedFiles(rows,'name',true).map(r=>r.name)).toEqual(['dir','file10','file2'])
  expect(rows[0]!.name).toBe('file10')
 })
 it('retains size and date sorting rather than overriding with name order',()=>{
  expect(sortedFiles(rows,'size',true).map(r=>r.name)).toEqual(['dir','file10','file2'])
  expect(sortedFiles(rows,'modified',true).map(r=>r.name)).toEqual(['dir','file2','file10'])
 })
 function nodes():TreeNodeData[]{return ['Film.S01E01.MKV','Film.S01E02.MKV'].map((rawtitle,i)=>({key:String(i),title:rawtitle,rawtitle,newtitle:rawtitle,isLeaf:true,children:[],icon:null,isDir:false,isMatch:false}))}
 it('previews replacements without mutating original names or unchecked files',()=>{
  const config=NewRenameConfigData(),data=nodes();config.replace.search='film';config.replace.newword='Show'
  RunReplaceName(config,data,['0']);expect(data[0]!.newtitle).toBe('Show.S01E01.MKV');expect(data[0]!.rawtitle).toBe('Film.S01E01.MKV')
  expect(data[1]!.isMatch).toBe(false)
 })
 it('preserves extensions for sequenced batch renaming',()=>{
  const config=NewRenameConfigData(),data=nodes();config.replace.enable=false;config.index.enable=true
  config.index.type='cover';config.index.format='Episode #';config.index.minlen=2;config.index.beginindex=3
  RunReplaceName(config,data,['0','1']);expect(data.map(r=>r.newtitle)).toEqual(['Episode 03.MKV','Episode 04.MKV'])
 })
 it('handles invalid regex without changing filenames',()=>{
  const config=NewRenameConfigData(),data=nodes();config.replace.chkReg=true;config.replace.search='['
  RunReplaceName(config,data,['0']);expect(data[0]!.isMatch).toBe(false)
 })
})
