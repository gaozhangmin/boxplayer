<script setup lang="ts">
import {ref} from 'vue'
import {GripVertical} from 'lucide-vue-next'
import ElectronModal from '@/components/dialog/ElectronModal.vue'
const props=defineProps<{choices:{key:string;title:string}[];visible:string[]}>(),emit=defineEmits<{close:[];save:[keys:string[]]}>()
const draft=ref([...props.visible.map(key=>props.choices.find(c=>c.key===key)).filter((v):v is {key:string;title:string}=>!!v),...props.choices.filter(c=>!props.visible.includes(c.key))].map(c=>({...c,visible:props.visible.includes(c.key)}))),dragged=ref('')
function drop(key:string){const from=draft.value.findIndex(c=>c.key===dragged.value),to=draft.value.findIndex(c=>c.key===key);if(from<0||to<0||from===to)return;draft.value.splice(to,0,draft.value.splice(from,1)[0]!);dragged.value=''}
</script>
<template><ElectronModal title="媒体管理" :width="560" @close="emit('close')"><div class="home-library-manager-panel"><p class="home-library-manager-hint">拖动调整首页分区顺序，也可以隐藏你不想显示的栏目。</p><div class="home-library-manager-list"><div v-for="item in draft" :key="item.key" class="home-library-manager-item" :data-section-key="item.key" draggable="true" @dragstart="dragged=item.key" @dragover.prevent @drop.prevent="drop(item.key)"><GripVertical :size="18"/><label><input v-model="item.visible" type="checkbox"/>{{item.title}}</label></div></div><div class="home-library-manager-footer"><button @click="emit('close')">取消</button><button class="primary" @click="emit('save',draft.filter(c=>c.visible).map(c=>c.key))">保存</button></div></div></ElectronModal></template>
<style scoped src="./workspace.css"></style>
<style scoped>.home-library-manager-item{display:flex;align-items:center;gap:12px;padding:12px;border-radius:10px;background:var(--secondary);margin-bottom:10px}.home-library-manager-item label{display:flex;align-items:center;gap:10px;flex:1}input{accent-color:var(--primary)}.home-library-manager-footer{display:flex;justify-content:flex-end;gap:12px;margin-top:20px}.home-library-manager-footer button{padding:7px 16px;border-radius:4px;background:var(--secondary)}.home-library-manager-footer .primary{background:var(--primary);color:white}</style>
