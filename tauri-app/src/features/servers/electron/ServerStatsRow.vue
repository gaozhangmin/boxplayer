<template>
  <div class="statistics-row">
    <div class="stat-card">
      <strong>{{ statistics.libraryCount }}</strong>
      <span>{{ t('mediaServer.libraryCount') }}</span>
    </div>
    <div class="stat-card">
      <strong>{{ statistics.movieCount }}</strong>
      <span>{{ t('mediaServer.movies') }}</span>
    </div>
    <div class="stat-card">
      <strong>{{ statistics.seriesCount }}</strong>
      <span>{{ t('mediaServer.episodes') }}</span>
    </div>
    <div class="stat-card">
      <strong>{{ statistics.episodeCount }}</strong>
      <span>{{ t('mediaServer.episodeShort') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{statistics:{libraryCount:number;movieCount:number;seriesCount:number;episodeCount:number}}>()
const t=(key:string)=>({'mediaServer.libraryCount':'媒体库','mediaServer.movies':'电影','mediaServer.episodes':'电视剧','mediaServer.episodeShort':'集'}[key]||key)
</script>

<style scoped>
.statistics-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 4px;
}

.stat-card {
  padding: 18px 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(15, 23, 42, 0.08);
  text-align: center;
}

.stat-card strong {
  display: block;
  margin-bottom: 6px;
  font-size: 22px;
  color: var(--foreground);
}

.stat-card span {
  color: var(--foreground); opacity: 0.56;
  font-size: 13px;
}

@media (max-width: 1280px) {
  .statistics-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

:global(html.dark) .stat-card {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

:global(html.dark) .stat-card strong {
  color: rgba(244, 247, 252, 0.96);
}

:global(html.dark) .stat-card span {
  color: rgba(191, 201, 216, 0.72);
}
</style>
