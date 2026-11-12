<script setup lang="ts">
import {nextTick,onMounted,onUnmounted,ref} from 'vue'
const props=defineProps<{x:number;y:number;label:string;compact?:boolean}>()
const emit=defineEmits<{close:[]}>()
const panel=ref<HTMLElement>(),left=ref(props.x),top=ref(props.y)
let previous:HTMLElement|null=null
function key(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();emit('close');return}const buttons=[...panel.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];if(!buttons.length)return;const index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(['ArrowDown','ArrowUp','Home','End','Tab'].includes(event.key)){event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowUp'||event.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus()}}
onMounted(async()=>{previous=document.activeElement as HTMLElement;await nextTick();const rect=panel.value!.getBoundingClientRect();left.value=Math.max(8,Math.min(props.x,window.innerWidth-rect.width-8));top.value=Math.max(8,Math.min(props.y,window.innerHeight-rect.height-8));panel.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()})
onUnmounted(()=>previous?.isConnected&&previous.focus())
</script>
<template><Teleport to="body"><div class="menu-dismiss" @pointerdown.self="emit('close')" @contextmenu.prevent.self="emit('close')" @keydown="key"><div ref="panel" class="anchored-menu" :class="{compact}" role="menu" :aria-label="label" :style="{left:left+'px',top:top+'px'}"><slot/></div></div></Teleport></template>
<style scoped>.menu-dismiss{position:fixed;inset:0;z-index:500}.anchored-menu{position:fixed;min-width:145px;max-height:calc(100vh - 16px);overflow:auto;background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:10px;padding:5px;box-shadow:0 10px 32px #0004}.anchored-menu :deep(button){display:flex;align-items:center;gap:7px;min-height:25px;text-align:left;padding:3px 8px;width:100%;border:0;background:transparent;border-radius:5px;font-size:13px;color:inherit}.anchored-menu :deep(button:hover),.anchored-menu :deep(button:focus-visible){background:var(--secondary)}.anchored-menu :deep(button:disabled){opacity:.4}</style>

<style scoped>.anchored-menu.compact{min-width:132px}.anchored-menu.compact :deep(button){display:flex;align-items:center;gap:7px;padding:3px 7px;min-height:25px}</style>
