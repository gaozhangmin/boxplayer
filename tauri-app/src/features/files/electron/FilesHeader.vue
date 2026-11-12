<script setup lang="ts">
import {ChevronLeft} from 'lucide-vue-next'
import {t} from './i18n'
defineProps<{title:string}>()
defineEmits<{back:[]}>()
</script>
<template><header class="unified-toolbar"><button class="round-button back-button" :aria-label="t('unified.back')" @click="$emit('back')"><ChevronLeft :size="20"/></button><h1>{{title}}</h1><slot/></header></template>
<style scoped>
.unified-toolbar{height:56px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-bottom:1px solid var(--color-border-2)}
.unified-toolbar h1{font-size:15px;font-weight:600;margin:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.round-button{display:grid;place-items:center;border:1px solid var(--color-border-2);background:var(--color-fill-1);border-radius:50%;width:36px;height:36px;flex-shrink:0}
.unified-toolbar{gap:12px}
</style>
