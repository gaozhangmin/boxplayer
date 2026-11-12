<script setup lang="ts">
import MediaPosterPlaceholder from '../library/electron/MediaPosterPlaceholder.vue'
import { ref, watch, onBeforeUnmount } from 'vue'
import type { Account } from '../sources/contracts'
import { isLocalCoverData } from './cover'
import { serverArtwork } from '../sources/serverMetadata'
const props = defineProps<{ account: Account; path?: string; alt?: string }>()
const url = ref(''); let revision = 0
function clear() { if (url.value.startsWith('blob:')) URL.revokeObjectURL(url.value); url.value = '' }
watch(() => [props.account.id, props.account.baseUrl, props.path], async () => {
  const current = ++revision; clear()
  if (props.path && isLocalCoverData(props.path)) { url.value = props.path; return }
  if (props.path?.startsWith('data:')) return
  if (!props.path || /(?:[?&])(?:api_key|token|x-plex-token|authorization)=/i.test(props.path)) return
  try { const value = await serverArtwork(props.account, props.path); if (current !== revision) URL.revokeObjectURL(value); else url.value = value } catch { /* Keep the accessible fallback; one missing poster must not fail a page. */ }
}, { immediate: true })
onBeforeUnmount(() => { revision++; clear() })
</script>
<template><img v-if="url" :src="url" :alt="alt || ''" loading="lazy" @error="clear" /><span v-else class="server-art-fallback" role="img" :aria-label="alt || '暂无封面'"><MediaPosterPlaceholder/></span></template>
<style scoped>.server-art-fallback{display:grid;place-items:center;width:100%;height:100%;background:var(--secondary);color:var(--primary,#34a86f);font-size:32px}img{width:100%;height:100%;object-fit:cover}</style>
