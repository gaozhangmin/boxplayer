<script setup lang="ts">
import {computed} from 'vue'
import ElectronModal from '@/components/dialog/ElectronModal.vue'
import {useLocale} from '@/features/files/electron/i18n'
const emit=defineEmits<{choose:[scope:'single'|'unwatched'|'all'];close:[]}>()
defineProps<{singleDisabled?:boolean}>()
const locale=useLocale(),text=computed(()=>locale.value.startsWith('en')?{title:'Download',single:'Download episode',unwatched:'Download unwatched episodes',all:'Download all episodes',cancel:'Cancel'}:String(locale.value)==='zh-TW'?{title:'下載',single:'下載單個劇集',unwatched:'下載未觀看劇集',all:'下載全部劇集',cancel:'取消'}:{title:'下载',single:'下载单个剧集',unwatched:'下载未观看剧集',all:'下载全部剧集',cancel:'取消'})
</script>
<template><ElectronModal :label="text.title" :width="310" class="download-choice-dialog" @close="emit('close')"><div class="download-choices"><strong>{{text.title}}</strong><button type="button" :disabled="singleDisabled" @click="emit('choose','single')">{{text.single}}</button><button type="button" @click="emit('choose','unwatched')">{{text.unwatched}}</button><button type="button" @click="emit('choose','all')">{{text.all}}</button><button type="button" @click="emit('close')">{{text.cancel}}</button></div></ElectronModal></template>
<style scoped>.download-choices{display:grid;gap:8px;text-align:center}.download-choices strong{margin:0 0 12px;font-size:15px}.download-choices button{width:100%;min-height:34px;border:0;border-radius:18px;background:var(--secondary);color:var(--foreground);font:inherit;cursor:pointer}.download-choices button:disabled{opacity:.45}</style>
