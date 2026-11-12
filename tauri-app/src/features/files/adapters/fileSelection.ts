import { ref, watch, type Ref } from 'vue'
import { GetFocusNext, KeyboardSelectOne, MouseSelectOne, SelectAll } from '../electron/selecthelper'
import { TestCtrl, TestKeyboardSelect } from '../electron/keyboardhelper'

/** State boundary for the unchanged Electron selection helpers. One instance per pane. */
export function useFileSelection<T extends { file_id: string }>(rows: Ref<T[]>, selected: Ref<string[]>) {
  const focus = ref(''), anchor = ref('')
  function apply(result: { selectedNew: Set<string>; selectedLast: string; focusLast: string }) {
    selected.value = [...result.selectedNew]; anchor.value = result.selectedLast; focus.value = result.focusLast
  }
  function mouse(id: string, ctrl = false, shift = false) {
    if (!rows.value.length || (id && !rows.value.some(row=>row.file_id===id))) return
    apply(MouseSelectOne(rows.value, 'file_id', new Set(selected.value), focus.value, anchor.value, id, ctrl, shift, ''))
  }
  function keyboard(id: string, ctrl = false, shift = false) {
    if (!rows.value.length || (id && !rows.value.some(row=>row.file_id===id))) return
    apply(KeyboardSelectOne(rows.value, 'file_id', new Set(selected.value), focus.value, anchor.value, id, ctrl, shift, ''))
  }
  function all() {
    if (!rows.value.length) return
    const previous = new Set(selected.value)
    selected.value = [...SelectAll(rows.value, 'file_id', previous)]
    focus.value = anchor.value = previous.size===rows.value.length ? '' : rows.value[0]!.file_id
  }
  function cancel() { selected.value=[];focus.value='';anchor.value='' }
  function reverse() {
    const old = new Set(selected.value)
    selected.value=rows.value.filter(row=>!old.has(row.file_id)).map(row=>row.file_id)
    focus.value=anchor.value=selected.value[0]||''
  }
  function next(position: string) { return GetFocusNext(rows.value, 'file_id', focus.value, position, '') }
  function key(event: KeyboardEvent, scroll: (id:string)=>void, open:(id:string)=>void) {
    const target=event.target
    if(target instanceof Element && target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'))return false
    const message={Code:event.code,Key:event.key,Ctrl:event.ctrlKey||event.metaKey,Shift:event.shiftKey,Alt:event.altKey,Repeat:event.repeat,IsInput:false,IsEnmpty:false}
    const store={mGetFocusNext:next,mSetFocus:(id:string)=>{focus.value=id},mGetFocus:()=>focus.value||rows.value[0]?.file_id||'',mKeyboardSelect:keyboard}
    const view={scrollIntoView:({key}:{key:string})=>scroll(key)}
    const handled=TestCtrl('a',message,all)||TestKeyboardSelect(message,view,store,open)
    if(handled){event.preventDefault();event.stopPropagation()}
    return handled
  }
  watch(rows, values=>{
    const available=new Set(values.map(row=>row.file_id))
    selected.value=selected.value.filter(id=>available.has(id))
    if(!available.has(focus.value))focus.value=''
    if(!available.has(anchor.value))anchor.value=''
  })
  return { focus, anchor, mouse, keyboard, all, cancel, reverse, next, key }
}
