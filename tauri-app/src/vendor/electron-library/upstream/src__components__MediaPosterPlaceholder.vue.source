<script setup lang="ts">
import filmIcon from '../assets/media/poster-placeholder-film.svg?raw'
import resumeBackground from '../assets/media/resume-placeholder.png'
import { BookOpen, Music } from 'lucide-vue-next'
withDefaults(defineProps<{ kind?: 'film' | 'music' | 'book' | 'resume' }>(), { kind: 'film' })
</script>
<!-- Trusted bundled SVG, not remote or user-provided markup. A non-img root
     keeps broken-poster img hiding rules from hiding the fallback too. -->
<template>
  <span v-if="kind === 'resume'" class="resume-poster-placeholder" :style="{ backgroundImage: `url(${resumeBackground})` }" aria-hidden="true" />
  <span v-else-if="kind === 'film'" class="media-poster-placeholder-icon" aria-hidden="true" v-html="filmIcon" />
  <span v-else class="media-poster-placeholder-icon media-category-placeholder" aria-hidden="true"><Music v-if="kind === 'music'" /><BookOpen v-else /></span>
</template>
<style>
.resume-poster-placeholder { position: absolute; inset: 0; width: 100%; height: 100%; background: #777 center / cover no-repeat; pointer-events: none; }
.media-poster-placeholder-icon {
  position: static !important;
  inset: auto !important;
  display: block;
  width: 34.5% !important;
  height: auto !important;
  aspect-ratio: 120 / 88;
  object-fit: contain !important;
  flex-shrink: 0;
  pointer-events: none;
}
.media-poster-placeholder-icon > svg {
  display: block;
  width: 100%;
  height: 100%;
}
.media-category-placeholder { aspect-ratio: 1; color: #ff8000; }
.poster-placeholder:has(> .media-poster-placeholder-icon),
.media-card-placeholder:has(> .media-poster-placeholder-icon),
.thumbnail-placeholder:has(> .media-poster-placeholder-icon),
.artwork:has(> .media-poster-placeholder-icon),
.local-file-art:has(> .media-poster-placeholder-icon) {
  background: #232625 !important;
}
.media-card-placeholder:has(> .media-poster-placeholder-icon)::before { display: none !important; }
</style>
