<script setup lang="ts">
import {ArrowLeft,ArrowRight,Download,Check,ChevronDown,Play,Folder,UserRound} from 'lucide-vue-next'
defineProps<{name:string}>()
const icons:Record<string,unknown>={'iconarrow-left-2-icon':ArrowLeft,'iconarrow-right-2-icon':ArrowRight,icondownload:Download,iconcheck:Check,icondown:ChevronDown,iconplay:Play,iconfolder:Folder,iconuser:UserRound}
</script>
<template><component :is="icons[name]||ChevronDown" :size="20" aria-hidden="true"/></template>
