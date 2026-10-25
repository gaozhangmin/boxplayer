<script setup lang="ts">
import { generalPreferences, displayScopeAllows } from '../utils/seriesVersionPreferences'
defineProps<{ rating?: number | null; isMovie?: boolean }>()
</script>

<template>
  <span v-if="displayScopeAllows(generalPreferences.ratings, isMovie === true) && typeof rating === 'number' && Number.isFinite(rating) && rating > 0" class="poster-rating-corner">{{ rating.toFixed(1) }}</span>
</template>

<style scoped>
.poster-rating-corner { position: absolute; right: 7px; bottom: 7px; z-index: 4; padding: 3px 6px; border-radius: 999px; background: #0009; color: #fff; font-size: 12px; font-weight: 600; line-height: 16px; pointer-events: none; }
</style>
