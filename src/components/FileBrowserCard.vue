<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Folder, FileVideo, Download } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  name: string
  directory: boolean
  thumbnail?: string
  sizeText?: string
  mode?: 'grid' | 'list'
  selection?: boolean
  selected?: boolean
  downloadable?: boolean
  downloadLabel?: string
}>(), { mode: 'grid', thumbnail: '', sizeText: '', selection: false, selected: false })

const imageFailed = ref(false)
watch(() => props.thumbnail, () => { imageFailed.value = false })
const showThumbnail = computed(() => !!props.thumbnail && !imageFailed.value)

const emit = defineEmits<{ open: [event: MouseEvent]; context: [event: MouseEvent]; download: [] }>()
</script>

<template>
  <div class="folder-browser-entry" :class="{ 'folder-browser-entry-list': mode === 'list' }">
  <button type="button" class="folder-browser-card" :class="{ 'folder-browser-card-list': mode === 'list' }" :aria-label="name" @click="emit('open', $event)" @contextmenu.prevent="emit('context', $event)">
    <span class="folder-browser-art">
      <img v-if="showThumbnail" :src="thumbnail" alt="" @error="imageFailed = true" />
      <Folder v-else-if="directory" :size="mode === 'list' ? 28 : 56" aria-hidden="true" />
      <FileVideo v-else :size="mode === 'list' ? 28 : 56" aria-hidden="true" />
      <input v-if="selection" type="checkbox" :checked="selected" tabindex="-1" :aria-label="name" />
    </span>
    <span class="folder-browser-info">
      <strong :title="name">{{ name }}</strong>
      <small v-if="mode === 'list' && !directory && sizeText">{{ sizeText }}</small>
    </span>
  </button>
  <button v-if="downloadable && !selection && mode === 'list'" type="button" class="folder-browser-download" :aria-label="downloadLabel" @click.stop="emit('download')"><Download :size="22" /></button>
  </div>
</template>

<style scoped>
.folder-browser-entry{min-width:0}.folder-browser-entry-list{display:flex;align-items:center}.folder-browser-entry-list>.folder-browser-card{flex:1;min-width:0}.folder-browser-download{flex-shrink:0;padding:12px;border:0;background:transparent;color:var(--color-text-2);cursor:pointer}.folder-browser-download:focus-visible{outline:2px solid #ff8b25}
.folder-browser-card{display:flex;flex-direction:column;gap:8px;min-width:0;padding:0;border:0;background:transparent;color:var(--color-text-1);text-align:left;cursor:pointer}
.folder-browser-art{position:relative;width:174px;aspect-ratio:2/3;background:var(--color-fill-2);border-radius:16px;display:grid;place-items:center;color:#ff8b25;overflow:hidden}
.folder-browser-art img{width:100%;height:100%;object-fit:cover}
.folder-browser-art input{position:absolute;top:8px;right:8px;accent-color:#ff8b25}
.folder-browser-card strong{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.folder-browser-info{display:flex;flex-direction:column;gap:4px;min-width:0;max-width:100%}
.folder-browser-info small{font-size:12px;color:var(--color-text-3);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.folder-browser-card-list{flex-direction:row;align-items:center;gap:16px;padding:16px;border-bottom:1px solid var(--color-border-2)}
.folder-browser-card-list .folder-browser-art{width:86px;height:129px;flex-shrink:0;border-radius:8px}
.folder-browser-card-list .folder-browser-info{flex:1}
.folder-browser-card-list strong{font-size:14px;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.folder-browser-card:hover .folder-browser-art{filter:brightness(1.12)}
.folder-browser-card:focus-visible{outline:2px solid #ff8b25;outline-offset:-2px}
:global(body[arco-theme='dark']) .folder-browser-art{background:#222!important}
:global(body[arco-theme='dark']) .folder-browser-card-list .folder-browser-art{background:#333!important}
</style>
