<script setup lang="ts">
import ElectronFilesSidebar from './electron/FilesSidebar.vue'
import type {FileSidebarEntry} from './sidebar'
defineProps<{entries:FileSidebarEntry[];collapsed:boolean;selectedId:string|null}>()
const emit=defineEmits<{selectFiles:[];selectSource:[entry:FileSidebarEntry]}>()
</script>
<template><ElectronFilesSidebar :entries="entries" :collapsed="collapsed" :selected-id="selectedId" @select-files="emit('selectFiles')" @select-source="emit('selectSource',$event)"/></template>
