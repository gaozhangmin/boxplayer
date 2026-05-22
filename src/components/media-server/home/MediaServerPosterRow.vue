<template>
  <div class="home-section">
    <div class="home-section-header">
      <h4>{{ title }}</h4>
      <a-button v-if="showSeeAll && items.length > 0" type="text" class="see-all-button" @click="$emit('see-all')">{{ seeAllLabel }}</a-button>
      <span v-else-if="loading">加载中...</span>
      <span v-else-if="errorText">{{ errorText }}</span>
      <span v-else>{{ items.length }} 项</span>
    </div>

    <div class="poster-row">
      <div v-if="loading && items.length === 0" class="poster-skeleton-row">
        <div
          v-for="index in 6"
          :key="`poster-skeleton-${title}-${index}`"
          class="poster-skeleton-card"
          :class="posterTileClass"
        >
          <div class="poster-skeleton-image skeleton-block" :class="posterTileClass" />
          <div v-if="showPosterLabels" class="poster-meta">
            <div class="poster-skeleton-line skeleton-block" />
            <div class="poster-skeleton-line skeleton-block short" />
          </div>
        </div>
      </div>
      <a-trigger
        v-for="item in enableContextMenu ? items : []"
        :key="item.id"
        class="poster-context-trigger"
        :class="posterTileClass"
        trigger="contextMenu"
        align-point
        auto-fit-position
        :popup-offset="6"
      >
        <button
          class="poster-tile"
          :class="posterTileClass"
          @click="$emit('select', item)"
        >
          <div class="poster-image media-image-frame" :class="{ 'has-image': !!resolvePosterImage(item) }">
            <img
              v-if="resolvePosterImage(item)"
              :src="resolvePosterImage(item)"
              :alt="item.title"
              @load="handleMediaImageLoad"
              @error="handleMediaImageError"
            />
            <div class="media-card-placeholder media-image-placeholder">{{ item.title.slice(0, 1) }}</div>
            <div v-if="showTopOverlay && resolveOverlay(item)" class="poster-overlay-badge">
              {{ resolveOverlay(item) }}
            </div>
          </div>
          <div v-if="showPosterLabels" class="poster-meta">
            <h5>{{ resolveHeading(item) }}</h5>
            <p>{{ resolveSubtitle(item) }}</p>
          </div>
        </button>
        <template #content>
          <div class="home-card-context-menu">
            <button type="button" class="home-card-context-item" @click="$emit('play', item)">
              <span class="home-card-context-icon">▷</span>
              <span>播放</span>
            </button>
            <button type="button" class="home-card-context-item" @click="$emit('action', item, 'download')">
              <span class="home-card-context-icon">↓</span>
              <span>下载</span>
            </button>
            <button type="button" class="home-card-context-item" @click="$emit('action', item, 'favorite')">
              <span class="home-card-context-icon">{{ item.isFavorite ? '♥' : '♡' }}</span>
              <span>{{ item.isFavorite ? '从收藏夹移除' : '添加到收藏夹' }}</span>
            </button>
            <div class="home-card-context-divider" />
            <button type="button" class="home-card-context-item" @click="$emit('action', item, 'watched')">
              <span class="home-card-context-icon context-icon-filled">✓</span>
              <span>{{ item.isPlayed ? '标记为未观看' : '标记为已观看' }}</span>
            </button>
          </div>
        </template>
      </a-trigger>
      <button
        v-for="item in enableContextMenu ? [] : items"
        :key="item.id"
        class="poster-tile"
        :class="posterTileClass"
        @click="$emit('select', item)"
      >
        <div class="poster-image media-image-frame" :class="{ 'has-image': !!resolvePosterImage(item) }">
          <img
            v-if="resolvePosterImage(item)"
            :src="resolvePosterImage(item)"
            :alt="item.title"
            @load="handleMediaImageLoad"
            @error="handleMediaImageError"
          />
          <div class="media-card-placeholder media-image-placeholder">{{ item.title.slice(0, 1) }}</div>
          <div v-if="showTopOverlay && resolveOverlay(item)" class="poster-overlay-badge">
            {{ resolveOverlay(item) }}
          </div>
        </div>
        <div v-if="showPosterLabels" class="poster-meta">
          <h5>{{ resolveHeading(item) }}</h5>
          <p>{{ resolveSubtitle(item) }}</p>
        </div>
      </button>
      <div v-if="errorText && items.length === 0 && !loading" class="section-error-card">
        <div class="section-error-title">这一栏加载失败了</div>
        <div class="section-error-text">{{ errorText }}</div>
        <a-button type="outline" size="small" @click="$emit('retry')">重试</a-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MediaServerLibraryNode } from '../../../types/mediaServerContent'
import type { MediaServerPosterType } from '../../../store/mediaServerHomePreferences'
import { resolveMediaServerImage } from '../../../media-server/imageSources'
import { toMsCacheUrl } from '../../../media-server/imageCache'
import useMediaServerRegistryStore from '../../../store/mediaServerRegistry'

const props = withDefaults(defineProps<{
  title: string
  items: MediaServerLibraryNode[]
  loading?: boolean
  errorText?: string
  posterType?: MediaServerPosterType
  showPosterLabels?: boolean
  showTopOverlay?: boolean
  showSeeAll?: boolean
  seeAllLabel?: string
  enableContextMenu?: boolean
  headingMode?: 'title' | 'parent-or-title'
  subtitleMode?: 'overview' | 'title' | 'year-only' | 'year-or-overview' | 'year-or-parent-or-overview'
}>(), {
  posterType: 'portrait',
  showPosterLabels: true,
  showTopOverlay: false,
  showSeeAll: true,
  seeAllLabel: '查看全部',
  enableContextMenu: false,
  headingMode: 'title',
  subtitleMode: 'overview'
})

defineEmits<{
  (e: 'select', item: MediaServerLibraryNode): void
  (e: 'play', item: MediaServerLibraryNode): void
  (e: 'action', item: MediaServerLibraryNode, action: 'watched' | 'favorite' | 'download'): void
  (e: 'see-all'): void
  (e: 'retry'): void
}>()

const posterTileClass = computed(() => props.posterType === 'portrait' ? 'poster-tile-portrait' : 'poster-tile-landscape')
const registry = useMediaServerRegistryStore()

const resolvePosterImage = (item: MediaServerLibraryNode) => {
  const raw = resolveMediaServerImage(item, props.posterType === 'landscape' ? 'landscape' : 'portrait')
  return toMsCacheUrl(registry.currentServer?.id, raw)
}

const resolveHeading = (item: MediaServerLibraryNode) => {
  if (props.headingMode === 'parent-or-title') return item.parentTitle || item.title
  return item.title
}

const resolveSubtitle = (item: MediaServerLibraryNode) => {
  switch (props.subtitleMode) {
    case 'title':
      return item.title
    case 'year-only':
      return item.year ? `${item.year}` : ''
    case 'year-or-overview':
      return item.year ? `${item.year}` : item.overview || '媒体内容'
    case 'year-or-parent-or-overview':
      return item.year ? `${item.year}` : item.parentTitle || item.overview || '媒体内容'
    default:
      return item.parentTitle || item.overview || '媒体内容'
  }
}

const resolveOverlay = (item: MediaServerLibraryNode) => {
  if (typeof item.rating === 'number') return `★ ${item.rating.toFixed(1)}`
  if (item.year) return `${item.year}`
  if (item.kind === 'series') return '剧集'
  if (item.kind === 'movie') return '电影'
  return ''
}

const handleMediaImageError = (event: Event) => {
  const frame = (event.target as HTMLElement | null)?.closest('.media-image-frame')
  frame?.classList.add('is-broken')
}

const handleMediaImageLoad = (event: Event) => {
  const frame = (event.target as HTMLElement | null)?.closest('.media-image-frame')
  frame?.classList.remove('is-broken')
}
</script>

<style scoped>
.home-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.home-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
}

.home-section-header h4 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #111827;
}

.home-section-header span {
  color: #94a3b8;
  font-size: 13px;
}

.see-all-button {
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(250, 245, 240, 0.52);
  border: 1px solid rgba(255, 255, 255, 0.72);
  color: rgba(24, 24, 24, 0.88);
  font-weight: 700;
  font-size: 14px;
  box-shadow: 0 12px 30px rgba(63, 46, 37, 0.1);
  backdrop-filter: blur(18px) saturate(135%);
}

.see-all-button:hover {
  background: rgba(255, 255, 255, 0.68);
  border-color: rgba(255, 255, 255, 0.86);
  color: rgba(24, 24, 24, 0.96);
  box-shadow: 0 16px 34px rgba(63, 46, 37, 0.12);
}

.poster-row {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 2px 8px 10px;
  scroll-padding-inline: 8px;
}

.section-error-card {
  min-width: 280px;
  padding: 18px;
  border-radius: 18px;
  border: 1px solid rgba(239, 68, 68, 0.16);
  background: rgba(255, 255, 255, 0.82);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-error-card :deep(.arco-btn) {
  background: rgba(250, 245, 240, 0.52);
  border-color: rgba(255, 255, 255, 0.72);
  color: rgba(24, 24, 24, 0.88);
  box-shadow: 0 12px 30px rgba(63, 46, 37, 0.1);
  backdrop-filter: blur(18px) saturate(135%);
}

.section-error-card :deep(.arco-btn:hover) {
  background: rgba(255, 255, 255, 0.68);
  border-color: rgba(255, 255, 255, 0.86);
  color: rgba(24, 24, 24, 0.96);
  box-shadow: 0 16px 34px rgba(63, 46, 37, 0.12);
}

.section-error-title {
  font-size: 14px;
  font-weight: 700;
  color: #111827;
}

.section-error-text {
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

.poster-skeleton-row {
  display: flex;
  gap: 16px;
}

.poster-skeleton-card {
  flex: 0 0 auto;
}

.poster-tile {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: transform 0.22s ease, filter 0.22s ease;
}

.poster-context-trigger {
  flex: 0 0 auto;
}

.home-card-context-menu {
  min-width: 184px;
  padding: 7px;
  border-radius: 18px;
  background: rgba(250, 246, 239, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow: 0 18px 42px rgba(45, 35, 25, 0.2);
  backdrop-filter: blur(22px) saturate(145%);
}

.home-card-context-item {
  width: 100%;
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: rgba(24, 24, 24, 0.92);
  font-size: 16px;
  line-height: 1;
  text-align: left;
  cursor: pointer;
}

.home-card-context-item:hover {
  background: rgba(255, 255, 255, 0.48);
}

.home-card-context-icon {
  width: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 19px;
  color: rgba(18, 18, 18, 0.9);
}

.context-icon-filled {
  width: 18px;
  height: 18px;
  margin: 0 2px;
  border-radius: 999px;
  background: rgba(24, 24, 24, 0.92);
  color: #fff;
  font-size: 11px;
  font-weight: 800;
}

.home-card-context-divider {
  height: 1px;
  margin: 6px 8px;
  background: rgba(24, 24, 24, 0.12);
}

[arco-theme='dark'] .home-card-context-menu {
  background: rgba(24, 28, 36, 0.9);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.38);
}

[arco-theme='dark'] .home-card-context-item {
  color: rgba(238, 243, 250, 0.94);
}

[arco-theme='dark'] .home-card-context-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

[arco-theme='dark'] .home-card-context-icon {
  color: rgba(238, 243, 250, 0.92);
}

[arco-theme='dark'] .context-icon-filled {
  background: rgba(238, 243, 250, 0.94);
  color: rgba(18, 22, 30, 0.96);
}

[arco-theme='dark'] .home-card-context-divider {
  background: rgba(255, 255, 255, 0.12);
}

.poster-tile-landscape {
  width: 320px;
}

.poster-tile-portrait {
  width: 150px;
}

.poster-image {
  position: relative;
  overflow: hidden;
  border-radius: 18px;
  background: linear-gradient(135deg, #dbeafe, #f8fafc);
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.1);
  width: 320px;
  height: 180px;
  transition: transform 0.24s ease, box-shadow 0.24s ease, border-color 0.24s ease;
}

.media-image-frame .media-image-placeholder {
  display: none;
}

.media-image-frame:not(.has-image) .media-image-placeholder,
.media-image-frame.is-broken .media-image-placeholder {
  display: flex;
}

.media-image-frame.is-broken img {
  display: none;
}

.poster-skeleton-image {
  width: 320px;
  height: 180px;
  border-radius: 18px;
}

.poster-tile-portrait .poster-image {
  width: 150px;
  height: 225px;
}

.poster-tile-portrait.poster-skeleton-image,
.poster-tile-portrait .poster-skeleton-image {
  width: 150px;
  height: 225px;
}

.poster-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.28s ease;
}

.poster-overlay-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  backdrop-filter: blur(10px);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.media-card-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  position: relative;
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, 0.42), transparent 56%),
    linear-gradient(180deg, rgba(226, 232, 240, 0.92) 0%, rgba(203, 213, 225, 0.96) 100%);
  color: transparent;
  user-select: none;
}

.media-card-placeholder::before {
  content: '';
  width: clamp(44px, 22%, 68px);
  height: clamp(44px, 22%, 68px);
  border-radius: 16px;
  background: center / contain no-repeat url('/icon.svg');
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.28);
  filter: grayscale(1) brightness(0.72) contrast(0.92);
  opacity: 0.88;
}

.poster-meta {
  padding: 10px 4px 0;
  transition: transform 0.22s ease;
}

.poster-meta h5 {
  margin: 0 0 6px;
  font-size: 17px;
  font-weight: 700;
  color: #111827;
  line-height: 1.4;
  min-height: 1.4em;
  max-height: 1.4em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.poster-meta p {
  margin: 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
  min-height: 1.5em;
  max-height: 1.5em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.poster-tile:hover {
  transform: translateY(-3px);
}

.poster-tile:hover .poster-image {
  border-color: rgba(22, 119, 255, 0.18);
  box-shadow: 0 24px 44px rgba(15, 23, 42, 0.14);
}

.poster-tile:hover .poster-image img {
  transform: scale(1.03);
}

.poster-tile:hover .poster-meta {
  transform: translateY(-1px);
}

.poster-skeleton-line {
  height: 16px;
  border-radius: 999px;
  margin-top: 2px;
}

.poster-skeleton-line.short {
  width: 76%;
  margin-top: 8px;
}

.skeleton-block {
  background: linear-gradient(90deg, rgba(226, 232, 240, 0.85), rgba(241, 245, 249, 0.95), rgba(226, 232, 240, 0.85));
  background-size: 200% 100%;
  animation: skeletonShimmer 1.4s linear infinite;
}

@keyframes skeletonShimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

[arco-theme='dark'] .home-section-header h4,
[arco-theme='dark'] .poster-row-header h4,
[arco-theme='dark'] .poster-meta h5 {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .home-section-header,
[arco-theme='dark'] .poster-row-header {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
}

[arco-theme='dark'] .home-section-header span,
[arco-theme='dark'] .poster-row-header p,
[arco-theme='dark'] .poster-meta p,
[arco-theme='dark'] .poster-empty,
[arco-theme='dark'] .row-action {
  color: rgba(191, 201, 216, 0.72);
}

[arco-theme='dark'] .row-error {
  border-color: rgba(248, 113, 113, 0.22);
  background: rgba(248, 113, 113, 0.08);
}

[arco-theme='dark'] .row-error strong {
  color: rgba(252, 165, 165, 0.96);
}

[arco-theme='dark'] .row-error p {
  color: rgba(254, 202, 202, 0.76);
}

[arco-theme='dark'] .poster-image {
  background: linear-gradient(135deg, rgba(36, 44, 58, 0.96), rgba(18, 24, 34, 0.94));
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.28);
}

[arco-theme='dark'] .poster-tile:hover .poster-image {
  border-color: rgba(64, 156, 255, 0.2);
  box-shadow: 0 24px 44px rgba(0, 0, 0, 0.36);
}

[arco-theme='dark'] .poster-placeholder,
[arco-theme='dark'] .skeleton-block {
  background: linear-gradient(90deg, rgba(54, 64, 80, 0.9), rgba(72, 84, 102, 0.96), rgba(54, 64, 80, 0.9));
}

[arco-theme='dark'] .see-all-button,
[arco-theme='dark'] .section-error-card :deep(.arco-btn) {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(233, 239, 247, 0.92);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
}

[arco-theme='dark'] .section-error-card {
  background: rgba(248, 113, 113, 0.08);
  border-color: rgba(248, 113, 113, 0.22);
}
</style>
