<script setup lang="ts">
import {computed} from 'vue'
import {LoaderCircle} from 'lucide-vue-next'
import ElectronModal from '@/components/dialog/ElectronModal.vue'
import {useLocale} from '@/features/files/electron/i18n'
const props=defineProps<{kind:'favorite'|'watchlist'|'connection';cancelable?:boolean}>(),emit=defineEmits<{close:[]}>()
const locale=useLocale(),text=computed(()=>{const en=locale.value.startsWith('en'),tw=String(locale.value)==='zh-TW';return{label:props.kind==='connection'?(en?'Testing connection…':tw?'連線測試…':'连接测试…'):props.kind==='favorite'?(en?'Updating favorites…':tw?'正在更新收藏的項目':'正在更新收藏的项目'):(en?'Updating watchlist…':tw?'正在更新觀看列表…':'正在更新观看列表…'),close:props.cancelable?(en?'Cancel':'取消'):(en?'Close':tw?'關閉':'关闭')}})
</script>
<template><ElectronModal :label="text.label" :width="320" @close="emit('close')"><div class="operation-progress"><strong>{{text.label}}</strong><LoaderCircle class="operation-spinner" :size="30" role="status" :aria-label="text.label"/><button type="button" @click="emit('close')">{{text.close}}</button></div></ElectronModal></template>
<style scoped>.operation-progress{display:grid;justify-items:center;gap:14px;text-align:center;font-size:15px}.operation-progress button{min-width:64px;border:0;border-radius:8px;background:var(--secondary);color:var(--foreground);padding:5px 16px;font:inherit;cursor:pointer}.operation-spinner{animation:progress-spin 1s linear infinite;color:var(--muted-foreground)}@keyframes progress-spin{to{transform:rotate(360deg)}}</style>
