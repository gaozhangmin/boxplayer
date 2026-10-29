<template>
  <div class="category-card" :style="categoryBannerStyle(name)" role="button" tabindex="0"
    @click="$emit('click', { name, type, count })"
    @keydown.enter.self.prevent="$emit('click', { name, type, count })"
    @keydown.space.self.prevent="$emit('click', { name, type, count })"
    @contextmenu.prevent="$emit('contextmenu', $event, { name, type, count })">
    <div class="category-card__art" aria-hidden="true">
      <img v-for="url in artwork" :key="url" :src="detailBackdropUrl(url)" alt="" loading="lazy" @error="failed.add(url)" />
    </div>
    <div class="category-card__shade" />
    <div class="category-card__copy"><img v-if="type === 'network' && categoryNetworkLogo(name) && !failed.has(categoryNetworkLogo(name)!)" class="network-logo" :class="{ 'network-logo-original': name.trim().toLowerCase() === 'netflix' }" :src="categoryNetworkLogo(name)" :alt="name" @error="failed.add(categoryNetworkLogo(name)!)" /><strong v-else>{{ name }}</strong><span>{{ t('customSeries.memberCount', { count }) }}</span></div>
  </div>
</template>
<script setup lang="ts">
import { computed, reactive } from 'vue'
import { t } from '../i18n'
import { categoryBannerStyle, categoryNetworkLogo } from '../utils/categoryBannerTheme'
import { detailBackdropUrl } from '../utils/mediaArtwork'
const props = withDefaults(defineProps<{ name: string; count: number; type: 'genre' | 'rating' | 'year' | 'network' | 'playlist'; gradient?: string; coverImage?: string; coverImages?: string[] }>(), { coverImages: () => [] })
defineEmits<{
  (e: 'click', data: { name: string; type: string; count: number }): void
  (e: 'contextmenu', event: MouseEvent, data: { name: string; type: string; count: number }): void
}>()
const failed = reactive(new Set<string>())
const artwork = computed(() => (props.coverImages.length ? props.coverImages : props.coverImage ? [props.coverImage] : []).filter(url => !failed.has(url)).slice(0, 3))
</script>
<style scoped>
.category-card { position: relative; width: 100%; min-height: 132px; aspect-ratio: 5.5 / 1; border-radius: 18px; overflow: hidden; cursor: pointer; color: white; background: linear-gradient(110deg, var(--banner-start), var(--banner-end)); border: 1px solid #ffffff35; transition: box-shadow .18s ease; }
.category-card__art { position: absolute; inset: 0 0 0 26%; display: flex; mask-image: linear-gradient(90deg, transparent, #000 45%); }
.category-card__art img { min-width: 0; flex: 1; width: 0; height: 100%; object-fit: cover; object-position: 70% center; }
.category-card__shade { position: absolute; inset: 0; background: linear-gradient(90deg, var(--banner-start), transparent 85%); }
.category-card__copy { position: absolute; left: 24px; right: 24px; top: 50%; transform: translateY(-50%); }
.category-card__copy strong { display: block; font-size: 28px; line-height: 1.2; font-weight: 750; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.category-card__copy span { display: block; margin-top: 8px; font-size: 13px; color: #ffffffd9; }
.category-card:hover { box-shadow: 0 8px 22px #0003; }
.category-card:focus-visible { outline: 3px solid #88baff; outline-offset: 3px; }
</style>

<style scoped>
.network-logo { display: block; max-width: 100%; width: 230px; height: 64px; object-fit: contain; object-position: left center; filter: brightness(0) invert(1); }
</style>

<style scoped>
.network-logo-original { filter: none !important; }
</style>

<style scoped>
@media (max-width: 600px) {
  .network-logo { width: 120px; height: 40px; }
}
</style>
