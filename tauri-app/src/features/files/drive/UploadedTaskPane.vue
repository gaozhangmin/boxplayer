<script setup lang="ts">
import {onMounted,onUnmounted,reactive,ref} from 'vue'
import {createPinia} from 'pinia'
import OriginalUploaded from './electron/down/DownUploaded.vue'
import useUploadedStore from './electron/down/UploadedStore'
import {createTaskKeyboard,createTaskMouse} from './taskPorts'
import {provideUploadedTaskPane,createUploadedDAL,type UploadedTaskController} from './uploadedTaskPorts'
import {onHideRightMenu} from './electron/utils/keyboardhelper'
const props=defineProps<{controller?:UploadedTaskController}>()
const root=ref<HTMLElement>(),store=useUploadedStore(createPinia()),keyboard=createTaskKeyboard(),mouse=createTaskMouse()
let disposed=false,observer:ResizeObserver|undefined
const pane=reactive({store,height:240,controller:props.controller,keyboard,mouse,check(){if(disposed)throw Error('已上传页面已关闭');if(props.controller!==pane.controller)throw Error('任务数据来源已变化')}})
provideUploadedTaskPane(pane)
function keydown(event:KeyboardEvent){
 const target=event.target instanceof Element?event.target:null
 if(target?.closest('input,textarea,select,[contenteditable="true"]'))return
 if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&target?.closest('button,a[href],[role="menuitem"],[role="option"]')&&['Enter',' ','ArrowUp','ArrowDown'].includes(event.key))return
 if(event.ctrlKey||event.metaKey||['ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Enter','F5','Backspace',' '].includes(event.key)){
  event.preventDefault();event.stopPropagation();keyboard.KeyDownEvent={Code:event.code,Key:event.key,Ctrl:event.ctrlKey||event.metaKey,Shift:event.shiftKey,Alt:event.altKey,Repeat:event.repeat,IsInput:false,IsEnmpty:false}
 }
}
function pointerdown(event:MouseEvent){mouse.MouseEvent={isTrusted:event.isTrusted,Ctrl:event.ctrlKey||event.metaKey,Shift:event.shiftKey,Alt:event.altKey,button:event.button,buttons:event.buttons,srcElement:event.target}}
onMounted(()=>{observer=new ResizeObserver(()=>{const list=root.value?.querySelector('.toppanlist');if(root.value&&list)pane.height=Math.max(120,root.value.getBoundingClientRect().bottom-list.getBoundingClientRect().top)});if(root.value)observer.observe(root.value);void createUploadedDAL(pane).aReloadUploaded()})
onUnmounted(()=>{disposed=true;observer?.disconnect();onHideRightMenu();store.$dispose()})
</script>
<template><section ref="root" class="source-drive-manager upload-task-pane" tabindex="0" aria-label="已上传" @keydown.capture="keydown" @pointerdown="pointerdown" @click="onHideRightMenu" @contextmenu.prevent><OriginalUploaded/></section></template>
<style scoped>
.upload-task-pane{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;overflow:hidden;outline:none;padding:0 12px 12px}
.upload-task-pane :deep(.toppanlist){flex:1;min-height:0}
</style>
