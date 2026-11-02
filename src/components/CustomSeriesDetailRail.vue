<script setup lang="ts">
import { Film } from 'lucide-vue-next'
import type { CustomSeriesDetail, SeriesMedia } from '../utils/customMediaSeries'
import { seriesMediaKey } from '../utils/customMediaSeries'

defineProps<{ series: CustomSeriesDetail; selectedId?: string; selectedServerId?: string }>()
const emit = defineEmits<{ open: [member: SeriesMedia] }>()
</script>

<template>
  <section class="custom-series-detail-rail">
    <h3>{{ series.title }}</h3>
    <div class="custom-series-detail-members">
      <button v-for="member in series.members" :key="seriesMediaKey(member)" type="button"
        :aria-label="member.title"
        :aria-pressed="member.id === selectedId && member.serverId === selectedServerId"
        @click="emit('open', member)">
        <img v-if="member.posterUrl" :src="member.posterUrl" :alt="member.title" loading="lazy" />
        <span v-else class="custom-series-detail-placeholder"><Film :size="36" /></span>
        <span class="custom-series-detail-title">{{ member.title }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.custom-series-detail-rail { margin: 28px 0; }
.custom-series-detail-rail h3 { margin: 0 0 16px; font-size: 20px; font-weight: 600; }
.custom-series-detail-members { display: flex; gap: 16px; overflow-x: auto; padding: 2px 2px 10px; }
.custom-series-detail-members button { flex: 0 0 clamp(120px, 12vw, 180px); min-width: 0; border: 0; padding: 0; background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer; border-radius: 10px; }
.custom-series-detail-members img, .custom-series-detail-placeholder { display: flex; width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 10px; background: var(--color-fill-2, #222); align-items: center; justify-content: center; }
.custom-series-detail-members button:focus-visible { outline: 2px solid var(--color-primary-light-4, #32c85a); outline-offset: 3px; }
.custom-series-detail-title { display: block; margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
