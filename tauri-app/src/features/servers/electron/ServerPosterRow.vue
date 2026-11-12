<script setup lang="ts">
import {computed} from 'vue'
import ServerArtwork from '../ServerArtwork.vue'
import MediaPosterPlaceholder from '../../library/electron/MediaPosterPlaceholder.vue'
import WatchedIndicator from '../../library/electron/WatchedIndicator.vue'
import PosterRatingBadge from '../../library/electron/PosterRatingBadge.vue'
import type {ServerItem} from '../workspace'
import type {Account} from '../../sources/contracts'
const props=defineProps<{title:string;items:ServerItem[];account:Account;landscape?:boolean;loading?:boolean;error?:string;more?:boolean}>()
const emit=defineEmits<{select:[item:ServerItem];context:[event:MouseEvent,item:ServerItem];more:[];retry:[]}>()
const posterTileClass=computed(()=>props.landscape?'poster-landscape':'poster-portrait')
const showPosterLabels=true,showTopOverlay=true
const resolveHeading=(item:ServerItem)=>item.name
const resolveSubtitle=(item:ServerItem)=>item.year
const resolveOverlay=(item:ServerItem)=>item.childCount?String(item.childCount):''
</script>
<template><div class="home-section"><div class="home-section-header"><h4>{{title}}</h4><button v-if="more&&items.length" class="see-all-button" @click="emit('more')">查看全部</button><span v-else-if="loading">正在加载…</span></div><p v-if="error" role="alert">{{error}}<button @click="emit('retry')">重试</button></p><div class="poster-row"><template v-for="item in items" :key="item.id">        <button
          class="poster-tile"
          :class="posterTileClass"
          @click="emit('select',item)" @contextmenu.prevent="emit('context',$event,item)"
        >
          <div class="poster-image media-image-frame" :class="{ 'has-image': !!item.imagePath }">
            <ServerArtwork :account="account" :path="landscape?item.backdropPath||item.imagePath:item.imagePath" :alt="item.name"/>
            <WatchedIndicator v-if="['movie', 'series', 'season', 'episode'].includes(item.kind)" corner :watched="item.watched" />
            <PosterRatingBadge :rating="item.rating" :is-movie="item.kind === 'movie'" />
            <div class="media-card-placeholder media-image-placeholder"><MediaPosterPlaceholder /></div>
            <div v-if="showTopOverlay && resolveOverlay(item)" class="poster-overlay-badge">
              {{ resolveOverlay(item) }}
            </div>
            <div v-if="false" class="poster-coverage-badge" >
              <span>!</span>
            </div>
          </div>
          <div v-if="showPosterLabels" class="poster-meta">
            <h5>{{ resolveHeading(item) }}</h5>
            <p>{{ resolveSubtitle(item) }}</p>
          </div>
        </button>
</template></div></div></template><style scoped>
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

.see-all-button {
  display: inline-flex;
  align-items: center;
  height: 36px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--app-mineradio-ink, #e8ecef);
  font-size: 12px;
  font-weight: 600;
  line-height: 36px;
  cursor: pointer;
  white-space: nowrap;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.see-all-button:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.14);
}

.see-all-button:active {
  transform: scale(0.97);
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
  background: rgba(255, 255, 255, 0.04);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-error-card :deep(.arco-btn) {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
  color: var(--app-mineradio-ink, #e8ecef);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(18px) saturate(135%);
}

.section-error-card :deep(.arco-btn:hover) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.14);
  color: var(--app-mineradio-ink, #e8ecef);
  box-shadow: 0 16px 34px rgba(0, 0, 0, 0.22);
}

.section-error-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--app-mineradio-ink, #e8ecef);
}

.section-error-text {
  color: var(--app-mineradio-ink, #e8ecef); opacity: 0.56;
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
  background: var(--app-overlay-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 18px 42px rgba(45, 35, 25, 0.2);
  backdrop-filter: none;
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
  background: var(--app-overlay-bg);
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
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
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

.poster-coverage-badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: calc(100% - 16px);
  padding: 5px 8px;
  border: 1px solid rgba(255, 190, 92, 0.42);
  border-radius: 999px;
  background: rgba(43, 27, 8, 0.86);
  color: #ffd18a;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  backdrop-filter: blur(10px);
}

.poster-coverage-badge span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #f5a524;
  color: #201506;
  font-size: 10px;
  font-weight: 900;
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

.poster-meta {
  padding: 10px 4px 0;
  transition: transform 0.22s ease;
}

.poster-meta h5 {
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
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.06));
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
</style><style scoped>.poster-image :deep(img){position:absolute;inset:0}.poster-row{gap:24px}.see-all-button{color:var(--primary)}</style>