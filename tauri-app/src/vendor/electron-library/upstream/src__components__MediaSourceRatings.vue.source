<script setup lang="ts">
import { generalPreferences, displayScopeAllows } from '../utils/seriesVersionPreferences'
import { computed } from 'vue'
import tmdbVerticalLogo from '../assets/media-server/tmdb_vertical_logo.svg'

const props = defineProps<{ rating?: number; criticRating?: number; isMovie?: boolean }>()

const community = computed(() => Number.isFinite(props.rating) && (props.rating || 0) > 0 ? props.rating : undefined)
const critic = computed(() => Number.isFinite(props.criticRating) && (props.criticRating || 0) > 0 ? props.criticRating : undefined)
const visible = computed(() => displayScopeAllows(generalPreferences.ratings, props.isMovie === true) && (community.value !== undefined || critic.value !== undefined))
</script>

<template>
  <div v-if="visible" class="media-source-ratings" aria-label="媒体评分">
    <span v-if="community !== undefined" class="media-source-rating" :aria-label="`TMDB ${community.toFixed(1)}`">
      <img class="media-source-rating-logo tmdb" :src="tmdbVerticalLogo" alt="" />
      <strong>{{ community.toFixed(1) }}</strong>
    </span>
    <span v-if="critic !== undefined" class="media-source-rating" :aria-label="`影评人评分 ${Math.round(critic)}%`">
      <svg class="media-source-rating-logo" viewBox="0 0 100 100" aria-hidden="true">
        <path fill="#24a148" d="M49 18 39 5l-3 18c-9-7-18-8-25-6 8 4 13 9 15 15C9 39 3 51 5 65c3 20 21 33 45 33s42-13 45-33c2-17-8-31-29-36 7-5 12-10 15-17-9 0-19 3-27 11z" />
        <path fill="#f04438" d="M50 25c27 0 43 14 40 38-3 18-19 29-40 29S13 81 10 63c-3-24 13-38 40-38z" />
      </svg>
      <strong>{{ Math.round(critic) }}%</strong>
    </span>
  </div>
</template>

<style scoped>
.media-source-ratings { display: flex; align-items: center; flex-wrap: wrap; gap: 18px; min-height: 28px; }
.media-source-rating { display: inline-flex; align-items: center; gap: 7px; color: inherit; font-size: 17px; line-height: 1; }
.media-source-rating-logo { display: block; width: 24px; height: 24px; object-fit: contain; flex: 0 0 auto; }
.media-source-rating-logo.tmdb { width: 33px; }
</style>
