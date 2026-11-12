<script setup lang="ts">
import {computed,ref} from 'vue'
import {Folder,ChevronDown,Star,ExternalLink,Network} from 'lucide-vue-next'
import {t} from './i18n'
import type {FileSidebarEntry} from '../sidebar'
import MediaServerIcon from './MediaServerIcon.vue'
const props=defineProps<{entries:FileSidebarEntry[];collapsed:boolean;selectedId:string|null}>()
const emit=defineEmits<{selectFiles:[];selectSource:[entry:FileSidebarEntry]}>()
const expanded=ref({files:true})
const section=computed<string>(()=>props.selectedId==='files'?'files':'video'),selectedFolder=computed(()=>props.selectedId)
const registry={currentServer:undefined as {id:string}|undefined}
const app={set mediaLibrarySection(_value:string){emit('selectFiles')}}
const failedProviderIcons=ref(new Set<string>())
function markProviderIconFailed(key:string){failedProviderIcons.value=new Set([...failedProviderIcons.value,key])}
const fileSourceCards=computed(()=>props.entries.filter(entry=>entry.kind!=='drive'||!props.entries.some(favorite=>favorite.kind==='favorite'&&favorite.sourceId===entry.sourceId)).map(entry=>({key:'folder:'+entry.id,title:entry.title,providerIcon:entry.icon,server:null,icon:entry.kind==='directURL'?ExternalLink:entry.kind==='drive'?Network:entry.kind==='serverFavorite'?Folder:Star,action:()=>emit('selectSource',entry)})))
</script>
<template><section class="electron-files-sidebar" :class="{collapsed}" data-testid="files-sidebar" data-sidebar-root="files">      <div class="group-header"><button class="group-heading" :class="{ selected: section === 'files' }" @click="app.mediaLibrarySection = 'files'"><Folder :size="20" /><span>{{ t('unified.files') }}</span></button><button class="group-toggle" :aria-expanded="expanded.files" :aria-label="t('unified.expandGroup', { name: t('unified.files') })" @click="expanded.files = !expanded.files"><ChevronDown :size="14" /></button></div>
      <div v-show="expanded.files" class="nav-children">
        <button v-for="card in fileSourceCards" :key="card.key" :class="{ selected: card.key.startsWith('server:') ? section === 'server' && registry.currentServer?.id === card.key.slice(7) : section === 'video' && selectedFolder === (card.key.startsWith('root:') ? card.key.slice(5) : card.key.slice(7)) }" @click="card.action()"><img v-if="card.providerIcon && !failedProviderIcons.has(card.key)" class="file-sidebar-provider-icon" :src="card.providerIcon" :alt="card.title" @error="markProviderIconFailed(card.key)" /><MediaServerIcon v-else-if="card.server" :server="card.server" :size="18" /><component v-else :is="card.icon" :size="18" /><span>{{ card.title }}</span></button>
      </div></section></template>
<style scoped>
.group-heading,.nav-children button{display:flex;align-items:center;gap:12px;border:0;background:transparent;width:100%;border-radius:9px;text-align:left;min-height:39px;padding:8px 12px}
.group-heading{font-weight:600;margin:12px 0 4px}.group-heading span{flex:1}.group-header{display:flex;align-items:center}.group-header .group-heading{flex:1}.group-toggle{background:transparent;border:0;border-radius:50%;padding:8px}.unified-sidebar svg{color:#ff8b25;flex-shrink:0}.nav-children{padding-left:14px}.nav-children span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file-sidebar-provider-icon{width:18px;height:18px;flex-shrink:0;object-fit:contain}
.electron-files-sidebar svg{color:var(--primary);flex-shrink:0}.group-heading.selected,.nav-children button.selected{background:var(--muted)}.group-heading span{flex:1}.collapsed .nav-children,.collapsed .group-toggle,.collapsed .group-heading span{display:none}.group-heading{font-size:15px;color:inherit}.nav-children button{font-size:15px;color:inherit}
</style>