<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { File, Film, Folder, Server, Network, Star } from 'lucide-vue-next'
import { localThumbnail, remoteThumbnail } from './thumbnails'
const props=defineProps<{poster?:string;iconKind?:'server'|'share'|'favorite';contain?:boolean;sourceId?:string;fileId?:string;local?:boolean;directory?:boolean;playable?:boolean;preview?:boolean}>()
const thumbnail=ref(''),failedPoster=ref(''),failedThumbnail=ref('')
let sequence=0
onUnmounted(()=>{sequence++})
const image=computed(()=>props.poster&&failedPoster.value!==props.poster?props.poster:thumbnail.value&&failedThumbnail.value!==thumbnail.value?thumbnail.value:'')
async function loadThumbnail(){const current=++sequence;thumbnail.value='';failedThumbnail.value='';if(!props.preview||!props.playable||!props.sourceId||!props.fileId)return;try{const result=props.local?await localThumbnail(props.sourceId,props.fileId,()=>current===sequence):await remoteThumbnail(props.sourceId,props.fileId,()=>current===sequence);if(current===sequence&&result)thumbnail.value=result}catch{/* Unsupported thumbnails fall back to the file icon. */}}
watch(()=>[props.sourceId,props.fileId,props.preview,props.poster,props.local,props.directory,props.playable],()=>{failedPoster.value='';if(!props.poster)void loadThumbnail();else{sequence++;thumbnail.value=''}},{immediate:true})
function imageFailed(){if(image.value===props.poster){failedPoster.value=props.poster||'';void loadThumbnail()}else failedThumbnail.value=thumbnail.value}
</script>
<template><span class="file-artwork" :class="{contain}"><img v-if="image" :src="image" alt="" loading="lazy" @error="imageFailed"/><component v-else :is="iconKind==='server'?Server:iconKind==='share'?Network:iconKind==='favorite'?Star:directory?Folder:playable?Film:File" :size="28"/></span></template>
<style scoped>
.file-artwork{display:grid;place-items:center;flex-shrink:0;width:52px;height:72px;overflow:hidden;border-radius:6px;background:var(--muted,rgba(128,128,128,.12));color:var(--primary)}.file-artwork img{width:100%;height:100%;object-fit:cover}
.file-artwork.contain img{object-fit:contain;padding:12px}
</style>
