<script setup lang="ts">
import {ref} from 'vue'
import UnifiedFilesPage from './electron/UnifiedFilesPage.vue'
import TauriDirectoryController from './TauriDirectoryController.vue'
import type {FileSidebarEntry} from './sidebar'
import type {BrowseRoute} from '@/features/servers/workspace'
import type {FolderCatalog} from './folderFavorites'
const props=defineProps<{source?:FileSidebarEntry;toolbarTarget?:string;searchQuery?:string;searchRevision?:number;folderCatalog?:FolderCatalog}>()
const emit=defineEmits<{selectSource:[id:string];menu:[event:MouseEvent];serverRoute:[accountId:string,route:BrowseRoute];title:[value:string];canGoBack:[value:boolean];goBack:[];openFolder:[folder:{sourceId:string;path:string;local:boolean;favoriteId:string}]}>()
const directory=ref<InstanceType<typeof TauriDirectoryController>>()
defineExpose({goBack:()=>directory.value?.goBack()})
</script>
<template><TauriDirectoryController v-if="source" ref="directory" v-bind="props" @select-source="emit('selectSource',$event)" @menu="emit('menu',$event)" @server-route="(id,route)=>emit('serverRoute',id,route)" @title="emit('title',$event)" @can-go-back="emit('canGoBack',$event)" @go-back="emit('goBack')" @open-folder="emit('openFolder',$event)"/><UnifiedFilesPage v-else :toolbar-target="toolbarTarget" @select-source="emit('selectSource',$event)" @open-folder="emit('openFolder',$event)" @server-route="(id,route)=>emit('serverRoute',id,route)"/></template>
