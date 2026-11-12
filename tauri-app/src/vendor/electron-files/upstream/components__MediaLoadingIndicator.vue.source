<script setup lang="ts">
import { t } from '../i18n'
import loadingRing from '../assets/media/loading-ring.png'

withDefaults(defineProps<{ size?: number }>(), { size: 128 })
</script>

<template>
  <span class="media-loading-indicator" role="status" :aria-label="t('common.loading')" :style="{ width: `${size}px`, height: `${size}px` }">
    <img :src="loadingRing" alt="" aria-hidden="true" draggable="false" />
  </span>
</template>

<style scoped>
.media-loading-indicator {
  display: inline-flex;
  flex: 0 0 auto;
  vertical-align: middle;
  overflow: hidden;
}
.media-loading-indicator img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  /* The source asset has a 4% transparent inset around the ring. */
  transform-origin: center;
  scale: 1.09;
  animation: media-loading-rotate 1s linear infinite;
}
@keyframes media-loading-rotate {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .media-loading-indicator img { animation: none; }
}
</style>
