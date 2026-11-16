<script setup lang="ts">
import { computed } from 'vue'
import { useDownloadStatus, type DownloadTrack } from '../../utils/musicDownloadStatus'
import { t } from '../../i18n'
const props = defineProps<{ track?: DownloadTrack; compact?: boolean; ring?: boolean }>()
const status = useDownloadStatus(() => props.track)
const label = computed(() => status.value ? t(`music.downloadState.${status.value.phase}` as const) : '')
const percent = computed(() => status.value?.progress === undefined ? undefined : Math.floor(status.value.progress * 100))
</script>
<template>
 <span v-if="status" class="music-download-badge" :class="[status.phase, { ring: props.ring }]" :title="label" :aria-label="label + (percent === undefined ? '' : ' ' + percent + '%')">
  <svg v-if="ring" viewBox="0 0 24 24" width="38" height="38" :class="{ spinning: percent === undefined && (status.phase === 'downloading' || status.phase === 'queued') }" aria-hidden="true">
   <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1.3"/>
   <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" :stroke-dasharray="`${(['completed', 'failed'].includes(status.phase) ? 1 : status.progress ?? .22) * 62.83} 62.83`" transform="rotate(-90 12 12)"/>
  </svg>
  <svg v-else-if="status.phase === 'downloading' || status.phase === 'queued' || status.phase === 'paused'" viewBox="0 0 24 24" width="22" height="22" :class="{ spinning: percent === undefined && status.phase === 'downloading' }" aria-hidden="true">
   <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2"/>
   <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" :stroke-dasharray="`${(status.progress ?? .22) * 56.55} 56.55`" transform="rotate(-90 12 12)"/>
  </svg>
  <svg v-else viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path v-if="status.phase === 'completed'" d="m7 12 3 3 7-7"/><path v-else-if="status.phase === 'failed'" d="M12 7v6m0 3v1"/><path v-else d="m8 8 8 8m0-8-8 8"/></svg>
  <span v-if="!compact && !ring">{{ status.phase === 'downloading' && percent !== undefined ? percent + '%' : label }}</span>
 </span>
</template>
<style scoped>
.music-download-badge{display:inline-flex;align-items:center;gap:4px;flex-shrink:0;font-size:11px;font-variant-numeric:tabular-nums;color:var(--primary,#b695ff);pointer-events:none}.completed{color:#65c995}.failed{color:#f4a261}.paused,.cancelled{opacity:.7}.spinning{animation:download-spin 1.2s linear infinite}@keyframes download-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinning{animation:none}}
.ring{position:absolute;inset:0;display:flex;justify-content:center;align-items:center;border-radius:50%;pointer-events:none}
</style>
