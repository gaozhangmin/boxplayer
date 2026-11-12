<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Film, LoaderCircle, Search, Tv } from 'lucide-vue-next'
import type { MediaLibraryItem, MediaLibraryTvSeriesItem, TmdbSearchResult } from '../types/media'
import { TmdbService, tmdbImageUrl } from '../utils/tmdb'
import { applyTmdbMovieMatch, applyTmdbTvEpisodeMatch, applyTmdbTvSeasonMatch, applyTmdbTvWholeMatch } from '../utils/mediaMetadataEditor'

const props = defineProps<{
  visible: boolean
  item: MediaLibraryItem
  initialSeasonNumber?: number
  initialEpisodeNumber?: number
  defaultsToWholeTvSeries?: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [item: MediaLibraryItem]
}>()

type SearchType = 'movie' | 'tv'
type TvApplyScope = 'whole' | 'season' | 'episode'
type CandidateSeason = { seasonNumber: number; name: string; episodeCount: number }
const tmdb = TmdbService.getInstance()
const query = ref('')
const searchType = ref<SearchType>('movie')
const loading = ref(false)
const applying = ref(false)
const error = ref('')
const results = ref<TmdbSearchResult[]>([])
const selected = ref<TmdbSearchResult | null>(null)
const scope = ref<TvApplyScope>('whole')
const targetSeasonNumber = ref(1)
const targetEpisodeNumber = ref(1)
const sourceSeasonNumber = ref(1)
const sourceEpisodeNumber = ref(1)
const sourceDetailLoading = ref(false)
const sourceEpisodes = ref<Array<{ episodeNumber: number; name: string }>>([])

const localSeasons = computed(() => [...(props.item.seasons || [])].sort((a, b) => a.seasonNumber - b.seasonNumber))
const targetSeason = computed(() => localSeasons.value.find((season) => season.seasonNumber === targetSeasonNumber.value))
const localEpisodes = computed(() => [...(targetSeason.value?.episodes || [])].sort((a, b) => a.episodeNumber - b.episodeNumber))
const candidateSeasons = computed<CandidateSeason[]>(() => {
  const seasons = (selected.value as any)?.seasons || []
  return seasons.filter((season: any) => Number(season.season_number) > 0).map((season: any) => ({
    seasonNumber: Number(season.season_number),
    name: season.name || `第 ${season.season_number} 季`,
    episodeCount: Number(season.episode_count) || 0
  }))
})
const canApply = computed(() => {
  if (!selected.value || applying.value) return false
  if (searchType.value === 'movie') return true
  if (scope.value === 'whole') return true
  if (!targetSeason.value || !sourceSeasonNumber.value) return false
  if (scope.value === 'episode') return Boolean(localEpisodes.value.some((episode) => episode.episodeNumber === targetEpisodeNumber.value) && sourceEpisodes.value.some((episode) => episode.episodeNumber === sourceEpisodeNumber.value))
  return true
})

const preferredTvScope = (): TvApplyScope => {
  if (props.defaultsToWholeTvSeries) return 'whole'
  if (localEpisodes.value.length > 0) return 'episode'
  if (localSeasons.value.length > 0) return 'season'
  return 'whole'
}

const titleOf = (item: TmdbSearchResult) => item.title || item.name || item.original_title || item.original_name || `TMDB #${item.id}`
const dateOf = (item: TmdbSearchResult) => item.release_date || item.first_air_date || ''
const posterOf = (item: TmdbSearchResult) => tmdbImageUrl(item.poster_path)

const resetTargets = () => {
  targetSeasonNumber.value = props.initialSeasonNumber && localSeasons.value.some((season) => season.seasonNumber === props.initialSeasonNumber)
    ? props.initialSeasonNumber
    : localSeasons.value[0]?.seasonNumber || 1
  targetEpisodeNumber.value = props.initialEpisodeNumber && localEpisodes.value.some((episode) => episode.episodeNumber === props.initialEpisodeNumber)
    ? props.initialEpisodeNumber
    : localEpisodes.value[0]?.episodeNumber || 1
}

const search = async () => {
  const keyword = query.value.trim()
  if (!keyword) return
  loading.value = true
  error.value = ''
  selected.value = null
  results.value = []
  try {
    const response = await tmdb.searchMedia(keyword, searchType.value === 'tv')
    results.value = searchType.value === 'tv' ? response.tv : response.movies
    if (!results.value.length) error.value = '没有找到匹配的 TMDB 条目'
  } catch (searchError: any) {
    error.value = searchError?.message || 'TMDB 搜索失败'
  } finally {
    loading.value = false
  }
}

const loadSourceSeason = async () => {
  if (searchType.value !== 'tv' || !selected.value || !sourceSeasonNumber.value) return
  sourceDetailLoading.value = true
  sourceEpisodes.value = []
  try {
    const detail = await tmdb.getTvByTmdbId(selected.value.id, sourceSeasonNumber.value)
    sourceEpisodes.value = (detail?.current_season?.episodes || []).map((episode) => ({ episodeNumber: episode.episode_number, name: episode.name }))
    sourceEpisodeNumber.value = sourceEpisodes.value[0]?.episodeNumber || 1
  } finally {
    sourceDetailLoading.value = false
  }
}

const selectCandidate = (item: TmdbSearchResult) => {
  selected.value = item
  error.value = ''
  if (searchType.value !== 'tv') return
  scope.value = preferredTvScope()
  sourceSeasonNumber.value = candidateSeasons.value.some((season: CandidateSeason) => season.seasonNumber === targetSeasonNumber.value)
    ? targetSeasonNumber.value
    : candidateSeasons.value[0]?.seasonNumber || 1
  void loadSourceSeason()
}

const applySelection = async () => {
  if (!selected.value || !canApply.value) return
  applying.value = true
  error.value = ''
  try {
    if (searchType.value === 'movie') {
      const movie = await tmdb.getMovieByTmdbId(selected.value.id)
      if (!movie) throw new Error('无法获取电影详情')
      emit('save', applyTmdbMovieMatch(props.item, movie))
      return
    }

    if (scope.value === 'whole') {
      const seasonNumbers = [...new Set((props.item.seasons || []).map((season) => season.seasonNumber).filter((season) => season > 0))]
      if (!seasonNumbers.length) seasonNumbers.push(1)
      const details = (await Promise.all(seasonNumbers.map((season) => tmdb.getTvByTmdbId(selected.value!.id, season)))).filter((detail): detail is MediaLibraryTvSeriesItem => Boolean(detail))
      if (!details.length) throw new Error('无法获取电视剧详情')
      emit('save', applyTmdbTvWholeMatch(props.item, details))
      return
    }

    const detail = await tmdb.getTvByTmdbId(selected.value.id, sourceSeasonNumber.value)
    if (!detail) throw new Error('无法获取所选季详情')
    if (scope.value === 'season') {
      emit('save', applyTmdbTvSeasonMatch(props.item, targetSeasonNumber.value, detail))
    } else {
      emit('save', applyTmdbTvEpisodeMatch(props.item, targetSeasonNumber.value, targetEpisodeNumber.value, detail, sourceEpisodeNumber.value))
    }
  } catch (applyError: any) {
    error.value = applyError?.message || '应用 TMDB 元数据失败'
  } finally {
    applying.value = false
  }
}

watch(() => props.visible, (visible) => {
  if (!visible) return
  query.value = props.item.name
  searchType.value = props.item.type === 'tv' ? 'tv' : 'movie'
  results.value = []
  selected.value = null
  error.value = ''
  resetTargets()
  scope.value = preferredTvScope()
  void search()
})
watch(searchType, () => {
  results.value = []
  selected.value = null
  error.value = ''
})
watch(targetSeasonNumber, () => {
  targetEpisodeNumber.value = localEpisodes.value[0]?.episodeNumber || 1
})
watch(sourceSeasonNumber, () => void loadSourceSeason())
</script>

<template>
  <a-modal :footer="false" :visible="visible" class="tmdb-metadata-modal" title="编辑元数据" :width="960" @cancel="emit('close')">
    <div class="tmdb-editor">
      <div class="tmdb-search-toolbar">
        <a-radio-group v-model="searchType" type="button">
          <a-radio value="movie"><Film :size="14" />电影</a-radio>
          <a-radio value="tv"><Tv :size="14" />电视剧</a-radio>
        </a-radio-group>
        <a-input-search v-model="query" allow-clear placeholder="搜索 TMDB 电影或电视剧" search-button @press-enter="search" @search="search">
          <template #prefix><Search :size="15" /></template>
        </a-input-search>
      </div>

      <div class="tmdb-current-path" :title="item.driveFiles?.[0]?.path">
        当前媒体：{{ item.name }}
        <span v-if="item.driveFiles?.[0]?.path">· {{ item.driveFiles[0].path }}</span>
      </div>

      <div v-if="loading" class="tmdb-status"><LoaderCircle class="spin" :size="24" />正在搜索 TMDB...</div>
      <div v-else-if="error && !selected" class="tmdb-status error">{{ error }}</div>
      <div v-else-if="results.length" class="tmdb-results">
        <button v-for="result in results" :key="result.id" type="button" class="tmdb-result-card" :class="{ selected: selected?.id === result.id }" @click="selectCandidate(result)">
          <div class="tmdb-result-leading">
            <div class="tmdb-poster">
              <img v-if="posterOf(result)" :alt="titleOf(result)" :src="posterOf(result)" loading="lazy" />
              <component :is="searchType === 'tv' ? Tv : Film" v-else :size="30" />
              <span v-if="selected?.id === result.id" class="tmdb-selected-mark"><Check :size="14" /></span>
            </div>
            <strong>{{ titleOf(result) }}</strong>
            <span>{{ dateOf(result).slice(0, 4) || '年份未知' }}</span>
          </div>
          <div class="tmdb-result-details">
            <div class="tmdb-result-facts">
              <span>{{ searchType === 'tv' ? '电视剧' : '电影' }}</span>
              <span>★ {{ Number(result.vote_average || 0).toFixed(1) }}</span>
              <span>TMDB #{{ result.id }}</span>
            </div>
            <strong v-if="result.original_title || result.original_name" class="tmdb-original-title">
              {{ result.original_title || result.original_name }}
            </strong>
            <p>{{ result.overview || '暂无简介' }}</p>
          </div>
        </button>
      </div>

      <div v-if="selected" class="tmdb-apply-panel">
        <div class="tmdb-selection-summary">
          <img v-if="posterOf(selected)" :alt="titleOf(selected)" :src="posterOf(selected)" />
          <div>
            <span>已选择 TMDB 条目</span>
            <strong>{{ titleOf(selected) }}</strong>
            <small>TMDB #{{ selected.id }} · {{ dateOf(selected).slice(0, 4) || '年份未知' }}</small>
          </div>
        </div>

        <template v-if="searchType === 'tv'">
          <div class="tmdb-scope-row">
            <span>应用范围</span>
            <a-radio-group v-model="scope" type="button">
              <a-radio value="whole">整部剧集</a-radio>
              <a-radio value="season">单季</a-radio>
              <a-radio value="episode">单集</a-radio>
            </a-radio-group>
          </div>

          <div v-if="scope !== 'whole'" class="tmdb-mapping-grid">
            <div class="tmdb-mapping-column">
              <h4>本地目标</h4>
              <a-form-item label="目标季">
                <a-select v-model="targetSeasonNumber">
                  <a-option v-for="season in localSeasons" :key="season.seasonNumber" :value="season.seasonNumber">第 {{ season.seasonNumber }} 季 · {{ season.name }}</a-option>
                </a-select>
              </a-form-item>
              <a-form-item v-if="scope === 'episode'" label="目标集">
                <a-select v-model="targetEpisodeNumber">
                  <a-option v-for="episode in localEpisodes" :key="episode.episodeNumber" :value="episode.episodeNumber">E{{ episode.episodeNumber }} · {{ episode.name }}</a-option>
                </a-select>
              </a-form-item>
            </div>
            <div class="tmdb-mapping-column">
              <h4>TMDB 来源</h4>
              <a-form-item label="来源季">
                <a-select v-model="sourceSeasonNumber">
                  <a-option v-for="season in candidateSeasons" :key="season.seasonNumber" :value="season.seasonNumber">第 {{ season.seasonNumber }} 季 · {{ season.name }}</a-option>
                </a-select>
              </a-form-item>
              <a-form-item v-if="scope === 'episode'" label="来源集">
                <a-select v-model="sourceEpisodeNumber" :loading="sourceDetailLoading">
                  <a-option v-for="episode in sourceEpisodes" :key="episode.episodeNumber" :value="episode.episodeNumber">E{{ episode.episodeNumber }} · {{ episode.name }}</a-option>
                </a-select>
              </a-form-item>
            </div>
          </div>
        </template>

        <div v-if="error" class="tmdb-inline-error">{{ error }}</div>
        <div class="tmdb-actions">
          <span>只替换所选范围的元数据，网盘文件与播放记录保持不变。</span>
          <a-button @click="emit('close')">取消</a-button>
          <a-button type="primary" :disabled="!canApply" :loading="applying" @click="applySelection">应用此元数据</a-button>
        </div>
      </div>
    </div>
  </a-modal>
</template>

<style scoped>
.tmdb-editor {
  display: grid;
  height: min(680px, calc(100vh - 150px));
  min-height: 480px;
  gap: 14px;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
}

.tmdb-search-toolbar {
  display: grid;
  grid-template-columns: auto minmax(280px, 1fr);
  gap: 12px;
}

.tmdb-search-toolbar :deep(.arco-radio) {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}

.tmdb-current-path {
  overflow: hidden;
  color: var(--color-text-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tmdb-status {
  display: flex;
  min-height: 260px;
  gap: 10px;
  align-items: center;
  justify-content: center;
  color: var(--color-text-2);
}

.tmdb-status.error,
.tmdb-inline-error {
  color: rgb(var(--danger-6));
}

.spin {
  animation: tmdb-spin 0.9s linear infinite;
}

.tmdb-results {
  display: grid;
  padding: 2px 4px 8px 2px;
  gap: 10px;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  overflow-y: auto;
}

.tmdb-result-card {
  display: grid;
  min-width: 0;
  padding: 10px;
  gap: 16px;
  grid-template-columns: 122px minmax(0, 1fr);
  border: 1px solid var(--color-border-2);
  border-radius: 6px;
  background: var(--color-fill-1);
  color: var(--color-text-1);
  cursor: pointer;
  text-align: left;
}

.tmdb-result-card:hover,
.tmdb-result-card.selected {
  border-color: rgb(var(--primary-6));
  background: var(--color-primary-light-1);
}

.tmdb-poster {
  position: relative;
  display: grid;
  width: 100%;
  aspect-ratio: 2 / 3;
  place-items: center;
  border-radius: 4px;
  background: var(--color-fill-3);
  color: var(--color-text-3);
  overflow: hidden;
}

.tmdb-result-leading {
  display: grid;
  min-width: 0;
  gap: 2px;
  align-self: center;
}

.tmdb-result-leading > strong,
.tmdb-result-leading > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tmdb-result-leading > strong {
  margin-top: 4px;
  font-size: 13px;
}

.tmdb-result-leading > span {
  color: var(--color-text-3);
  font-size: 12px;
}

.tmdb-result-details {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  align-self: center;
  justify-content: center;
}

.tmdb-result-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.tmdb-result-facts span {
  padding: 3px 7px;
  border-radius: 4px;
  background: var(--color-fill-3);
  color: var(--color-text-2);
  font-size: 11px;
}

.tmdb-original-title {
  color: var(--color-text-2);
  font-size: 13px;
  font-weight: 600;
}

.tmdb-result-details p {
  display: -webkit-box;
  margin: 0;
  color: var(--color-text-2);
  font-size: 13px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
  overflow: hidden;
}

.tmdb-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tmdb-selected-mark {
  position: absolute;
  top: 6px;
  right: 6px;
  display: grid;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgb(var(--primary-6));
  color: #fff;
  place-items: center;
}

.tmdb-apply-panel {
  display: grid;
  padding: 14px;
  gap: 14px;
  border: 1px solid var(--color-border-2);
  border-radius: 6px;
  background: var(--color-fill-1);
}

:global(.tmdb-metadata-modal .arco-modal) {
  width: min(960px, calc(100vw - 48px)) !important;
  max-width: min(960px, calc(100vw - 48px));
}

:global(.tmdb-metadata-modal .arco-modal-body) {
  padding: 16px 18px 18px;
  overflow: hidden;
}

.tmdb-selection-summary {
  display: flex;
  gap: 12px;
  align-items: center;
}

.tmdb-selection-summary img {
  width: 42px;
  height: 63px;
  border-radius: 4px;
  object-fit: cover;
}

.tmdb-selection-summary div {
  display: grid;
  gap: 2px;
}

.tmdb-selection-summary span,
.tmdb-selection-summary small {
  color: var(--color-text-3);
}

.tmdb-scope-row,
.tmdb-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.tmdb-scope-row > span {
  color: var(--color-text-2);
  font-weight: 600;
}

.tmdb-mapping-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.tmdb-mapping-column {
  padding: 12px;
  border: 1px solid var(--color-border-2);
  border-radius: 6px;
}

.tmdb-mapping-column h4 {
  margin: 0 0 10px;
}

.tmdb-actions {
  justify-content: flex-end;
}

.tmdb-actions > span {
  margin-right: auto;
  color: var(--color-text-3);
  font-size: 12px;
}

@keyframes tmdb-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 760px) {
  :global(.tmdb-metadata-modal .arco-modal) {
    width: calc(100vw - 20px) !important;
    max-width: calc(100vw - 20px);
  }

  .tmdb-editor {
    height: calc(100vh - 110px);
    min-height: 0;
  }

  .tmdb-search-toolbar,
  .tmdb-mapping-grid {
    grid-template-columns: 1fr;
  }

  .tmdb-result-card {
    gap: 12px;
    grid-template-columns: 92px minmax(0, 1fr);
  }

  .tmdb-result-details p {
    -webkit-line-clamp: 4;
  }
}
</style>
