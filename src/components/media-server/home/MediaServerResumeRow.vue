<template>
  <div class="home-section">
    <div class="home-section-header">
      <h4>{{ t('mediaServer.continueWatching') }}</h4>
      <span>{{ loading ? t('mediaServer.loading') : t('mediaServer.itemsCount', { count: items.length }) }}</span>
    </div>

    <div class="resume-strip">
      <div v-if="loading && items.length === 0" class="resume-skeleton-row">
        <div v-for="index in 3" :key="`resume-skeleton-${index}`" class="resume-skeleton-card">
          <div class="resume-skeleton-poster skeleton-block" />
          <div class="resume-skeleton-line skeleton-block" />
          <div class="resume-skeleton-line skeleton-block short" />
        </div>
      </div>
      <a-trigger
        v-for="item in items"
        :key="item.id"
        class="resume-context-trigger"
        trigger="contextMenu"
        align-point
        auto-fit-position
        :popup-offset="6"
      >
        <button
          class="resume-card"
          @click="$emit('play', item)"
        >
          <div class="resume-card-poster media-image-frame" :class="{ 'has-image': !!resolveResumeImage(item) }">
            <img
              v-if="resolveResumeImage(item)"
              :src="resolveResumeImage(item)"
              :alt="item.title"
              @load="handleMediaImageLoad"
              @error="handleMediaImageError"
            />
            <div class="media-card-placeholder media-image-placeholder">{{ item.title.slice(0, 1) }}</div>
            <div class="resume-overlay">
              <div class="resume-badge">{{ typeof item.progress === 'number' ? t('mediaServer.watchedPercent', { percent: Math.round(item.progress) }) : t('mediaServer.continueWatching') }}</div>
              <div v-if="typeof item.progress === 'number'" class="media-progress cinematic-progress">
                <div class="media-progress-bar" :style="{ width: `${Math.min(100, Math.max(0, item.progress || 0))}%` }" />
              </div>
            </div>
          </div>
          <div class="resume-card-body">
            <h5>{{ item.title }}</h5>
            <p>{{ item.year ? `${item.year}` : '' }}</p>
          </div>
        </button>
        <template #content>
          <div class="home-card-context-menu">
            <button type="button" class="home-card-context-item" @click="$emit('play', item)">
              <span class="home-card-context-icon">▷</span>
              <span>{{ t('mediaServer.play') }}</span>
            </button>
            <button type="button" class="home-card-context-item" @click="$emit('action', item, 'favorite')">
              <span class="home-card-context-icon">{{ item.isFavorite ? '♥' : '♡' }}</span>
              <span>{{ item.isFavorite ? t('mediaServer.removeFavorite') : t('mediaServer.addFavorite') }}</span>
            </button>
            <div class="home-card-context-divider" />
            <button type="button" class="home-card-context-item" @click="$emit('action', item, 'watched')">
              <span class="home-card-context-icon context-icon-filled">✓</span>
              <span>{{ item.isPlayed ? t('mediaServer.markUnwatched') : t('mediaServer.markWatched') }}</span>
            </button>
          </div>
        </template>
      </a-trigger>
      <div v-if="errorText && items.length === 0 && !loading" class="resume-error-card">
        <div class="resume-error-title">{{ t('mediaServer.resumeLoadFailed') }}</div>
        <div class="resume-error-text">{{ errorText }}</div>
        <a-button type="outline" size="small" @click="$emit('retry')">{{ t('mediaServer.retry') }}</a-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MediaServerCardItem } from '../../../types/mediaServerContent'
import { resolveMediaServerImage } from '../../../media-server/imageSources'
import { toMsCacheUrl } from '../../../media-server/imageCache'
import useMediaServerRegistryStore from '../../../store/mediaServerRegistry'
import { t } from '../../../i18n'

defineProps<{
  items: MediaServerCardItem[]
  loading?: boolean
  errorText?: string
}>()

defineEmits<{
  (e: 'select', item: MediaServerCardItem): void
  (e: 'play', item: MediaServerCardItem): void
  (e: 'action', item: MediaServerCardItem, action: 'watched' | 'favorite'): void
  (e: 'retry'): void
}>()

const registry = useMediaServerRegistryStore()

const resolveResumeImage = (item: MediaServerCardItem) => {
  const raw = resolveMediaServerImage(item, 'cinematic')
  return toMsCacheUrl(registry.currentServer?.id, raw)
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
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--app-mineradio-ink, #e8ecef);
}

.home-section-header span {
  color: var(--app-mineradio-ink, #e8ecef);
  opacity: 0.48;
  font-size: 12px;
  font-weight: 600;
  line-height: 36px;
}

.resume-strip {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 2px 8px 10px;
  scroll-padding-inline: 8px;
}

.resume-error-card {
  width: 320px;
  flex: 0 0 auto;
  padding: 18px;
  border-radius: 18px;
  border: 1px solid rgba(239, 68, 68, 0.16);
  background: rgba(255, 255, 255, 0.04);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.resume-error-card :deep(.arco-btn) {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
  color: var(--app-mineradio-ink, #e8ecef);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(18px) saturate(135%);
}

.resume-error-card :deep(.arco-btn:hover) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.14);
  color: var(--app-mineradio-ink, #e8ecef);
  box-shadow: 0 16px 34px rgba(0, 0, 0, 0.22);
}

.resume-error-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--app-mineradio-ink, #e8ecef);
}

.resume-error-text {
  color: var(--app-mineradio-ink, #e8ecef); opacity: 0.56;
  font-size: 13px;
  line-height: 1.6;
}

.resume-skeleton-row {
  display: flex;
  gap: 16px;
}

.resume-skeleton-card {
  width: 320px;
  flex: 0 0 auto;
}

.resume-skeleton-poster {
  width: 320px;
  height: 180px;
  border-radius: 18px;
}

.resume-skeleton-line {
  height: 16px;
  border-radius: 999px;
  margin-top: 12px;
}

.resume-skeleton-line.short {
  width: 72%;
}

.skeleton-block {
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.06));
  background-size: 200% 100%;
  animation: skeletonShimmer 1.4s linear infinite;
}

.resume-card {
  width: 320px;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: transform 0.24s ease;
}

.resume-context-trigger {
  width: 320px;
  flex: 0 0 auto;
}

.home-card-context-menu {
  min-width: 184px;
  padding: 7px;
  border-radius: 18px;
  background: rgba(18, 22, 30, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.08);
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
  color: var(--app-mineradio-ink, #e8ecef);
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

.resume-card-poster {
  position: relative;
  overflow: hidden;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 20px 42px rgba(15, 23, 42, 0.12);
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

.resume-card-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.28s ease;
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
  background: center / contain no-repeat var(--app-icon-image);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.28);
  filter: grayscale(1) brightness(0.72) contrast(0.92);
  opacity: 0.88;
}

.resume-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 12px;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.18) 0%, rgba(255, 255, 255, 0.04) 45%, rgba(15, 23, 42, 0.75) 100%);
}

.resume-badge {
  width: fit-content;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.media-progress {
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
}

.media-progress-bar {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #fb923c, #f97316);
}

.resume-card-body {
  padding: 10px 4px 0;
  transition: transform 0.22s ease;
}

.resume-card-body h5 {
  margin: 0 0 6px;
  font-size: 17px;
  font-weight: 700;
  color: var(--app-mineradio-ink, #e8ecef);
  line-height: 1.4;
  min-height: 1.4em;
  max-height: 1.4em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resume-card-body p {
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

.resume-card:hover {
  transform: translateY(-3px);
}

.resume-card:hover .resume-card-poster {
  border-color: rgba(22, 119, 255, 0.18);
  box-shadow: 0 26px 48px rgba(15, 23, 42, 0.16);
}

.resume-card:hover .resume-card-poster img {
  transform: scale(1.03);
}

.resume-card:hover .resume-card-body {
  transform: translateY(-1px);
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
[arco-theme='dark'] .resume-row-header h4,
[arco-theme='dark'] .resume-card-body h5 {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .home-section-header span,
[arco-theme='dark'] .resume-row-header p,
[arco-theme='dark'] .resume-card-body p,
[arco-theme='dark'] .resume-empty,
[arco-theme='dark'] .resume-more {
  color: rgba(191, 201, 216, 0.72);
}

[arco-theme='dark'] .resume-error {
  border-color: rgba(248, 113, 113, 0.22);
  background: rgba(248, 113, 113, 0.08);
}

[arco-theme='dark'] .resume-error strong {
  color: rgba(252, 165, 165, 0.96);
}

[arco-theme='dark'] .resume-error p {
  color: rgba(254, 202, 202, 0.76);
}

[arco-theme='dark'] .resume-card-poster {
  background: linear-gradient(135deg, rgba(36, 44, 58, 0.96), rgba(18, 24, 34, 0.94));
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 22px 42px rgba(0, 0, 0, 0.3);
}

[arco-theme='dark'] .resume-card:hover .resume-card-poster {
  border-color: rgba(64, 156, 255, 0.2);
  box-shadow: 0 26px 48px rgba(0, 0, 0, 0.38);
}

[arco-theme='dark'] .resume-placeholder,
[arco-theme='dark'] .skeleton-block {
  background: linear-gradient(90deg, rgba(54, 64, 80, 0.9), rgba(72, 84, 102, 0.96), rgba(54, 64, 80, 0.9));
}

[arco-theme='dark'] .resume-badge {
  background: rgba(15, 23, 42, 0.84);
}

[arco-theme='dark'] .resume-error-card :deep(.arco-btn) {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(233, 239, 247, 0.92);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
}

[arco-theme='dark'] .resume-error-card {
  background: rgba(248, 113, 113, 0.08);
  border-color: rgba(248, 113, 113, 0.22);
}
</style>
