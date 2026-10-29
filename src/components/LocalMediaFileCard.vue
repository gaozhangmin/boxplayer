<script setup lang="ts">
import WatchedIndicator from './WatchedIndicator.vue'
import MediaPosterPlaceholder from './MediaPosterPlaceholder.vue'
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { Folder, Check, Star } from 'lucide-vue-next'
import { getLocalVideoPreview, type LocalVideoPreview } from '../utils/localVideoPreview'
import { t } from '../i18n'
const props = defineProps<{ name: string; metadata?: { title?: string; rating?: number; year?: string; certification?: string; overview?: string }; path?: string; thumbnail?: string; duration?: string | number; height?: number; mode?: 'grid' | 'list'; portraitList?: boolean; directory?: boolean; watched?: boolean; selection?: boolean; selected?: boolean }>()
const emit = defineEmits<{ open: []; watched: []; context: [event: MouseEvent] }>()
const root = ref<HTMLElement>()
const preview = ref<LocalVideoPreview>({ thumbnail: '', duration: 0, height: 0 })
let observer: IntersectionObserver | undefined
let version = 0
let visible = false
async function load() {
  const current = ++version
  preview.value = { thumbnail: '', duration: 0, height: 0 }
  if (!props.path || props.directory || !/\.(mp4|m4v|mov|webm|mkv|avi|ts|m2ts)$/i.test(props.path)) return
  const result = await getLocalVideoPreview(props.path)
  if (current === version) preview.value = result
}
watch(() => props.path, () => { if (visible) void load() })
onMounted(() => {
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { visible = true; observer?.disconnect(); void load() }
  }, { rootMargin: '200px' })
  if (root.value) observer.observe(root.value)
})
onUnmounted(() => { version++; observer?.disconnect() })
</script>
<template>
  <div ref="root" class="local-file-card" :class="{ 'local-file-list': mode === 'list', 'local-file-portrait-list': mode === 'list' && portraitList }" role="button" tabindex="0" :aria-label="name" :aria-pressed="selection ? !!selected : undefined" @click="emit('open')" @keydown.enter.prevent="emit('open')" @keydown.space.prevent="emit('open')" @contextmenu.prevent="emit('context', $event)">
    <div class="local-file-art">
      <img v-if="thumbnail || preview.thumbnail" :src="thumbnail || preview.thumbnail" alt="" />
      <Folder v-else-if="directory" :size="mode === 'list' ? 30 : 56" />
      <MediaPosterPlaceholder v-else />
      <WatchedIndicator v-if="!directory" corner :watched="!!watched" />
      <input v-if="selection" type="checkbox" tabindex="-1" :checked="selected" :aria-label="name" />
    </div>
    <div class="local-file-info">
      <strong :title="metadata?.title || name">{{ mode === 'list' ? metadata?.title || name : name }}</strong>
      <template v-if="mode === 'list' && !directory && metadata">
        <div class="local-file-meta">
          <span v-if="metadata.rating != null"><Star :size="13" />{{ metadata.rating.toFixed(1) }}</span>
          <span v-if="metadata.year">{{ metadata.year }}</span>
          <span v-if="metadata.certification" class="local-file-certification">{{ metadata.certification }}</span>
        </div>
        <p v-if="metadata.overview" class="local-file-overview">{{ metadata.overview }}</p>
      </template>
      <template v-if="mode === 'list' && !directory && !portraitList">
        <small><span v-if="Number(duration) || preview.duration">{{ t('unified.durationMinutes', { count: Math.max(1, Math.ceil((Number(duration) || preview.duration) / 60)) }) }}</span><span v-if="height || preview.height">{{ height || preview.height }}p</span></small>
        <button v-if="!selection" :class="['local-file-watched', { 'is-watched': watched }]" :aria-pressed="!!watched" :aria-label="t(watched ? 'mediaServer.markUnwatched' : 'mediaServer.markWatched')" @click.stop="emit('watched')" @keydown.stop><Check :size="14" />{{ t(watched ? 'unified.watched' : 'mediaServer.markWatched') }}</button>
      </template>
    </div>
  </div>
</template>
<style scoped>
.local-file-card{display:flex;flex-direction:column;gap:8px;min-width:0;cursor:pointer;color:var(--color-text-1);outline-offset:3px}
.local-file-art{position:relative;width:100%;aspect-ratio:2/3;overflow:hidden;border-radius:16px;background:var(--color-fill-2);color:#ff8b25;display:grid;place-items:center}
.local-file-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center}.local-file-art input{position:absolute;top:8px;right:8px;accent-color:#ff8b25}
.local-file-info{min-width:0}.local-file-info strong{display:block;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.local-file-info small{display:flex;gap:8px;color:var(--color-text-3);font-size:12px;margin:6px 0 10px;min-height:14px}
.local-file-list{flex-direction:row;align-items:center;gap:16px;padding:16px;border-bottom:1px solid var(--color-border-2)}.local-file-list .local-file-art{width:228px;height:128px;aspect-ratio:16/9;flex-shrink:0;border-radius:8px}.local-file-list .local-file-info{flex:1}.local-file-list strong{font-size:14px}.local-file-watched{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--color-text-2);font-size:12px;padding:4px 7px;border-radius:5px;cursor:pointer}.local-file-watched:hover{background:var(--color-fill-3)}
.local-file-watched.is-watched{background:#ff8800;color:#fff}.local-file-watched.is-watched:hover{background:#e87900}
@media(max-width:900px){.local-file-list .local-file-art{width:180px;height:101px}}
.local-file-portrait-list{gap:22px;padding:12px 0}.local-file-list.local-file-portrait-list .local-file-art{width:98px;height:147px;aspect-ratio:2/3}

.local-file-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:13px;color:var(--color-text-3);margin-top:6px}
.local-file-meta span{display:inline-flex;align-items:center;gap:4px}
.local-file-certification{border:1px solid currentColor;border-radius:3px;padding:0 4px}
.local-file-overview{font-size:13px;color:var(--color-text-2);line-height:1.5;margin:8px 0 0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
</style>
<style>
body[arco-theme='dark'] .local-file-card .local-file-art{background:#222}
</style>
