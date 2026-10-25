<script setup lang="ts">
import { seriesPreferences, orderedVersions, playbackVersions, generalPreferences, displayScopeAllows } from '../utils/seriesVersionPreferences'
import MediaPosterPlaceholder from './MediaPosterPlaceholder.vue'
import { detailBackdropUrl } from '../utils/mediaArtwork'
import MediaCollectionPicker from './MediaCollectionPicker.vue'
import WatchedIndicator from './WatchedIndicator.vue'
import PosterRatingBadge from './PosterRatingBadge.vue'
import { isMediaWatched, setMediaWatched } from '../utils/localWatchedState'
import { ref, computed, watch, watchEffect, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useSettingStore, useUserStore } from '../store'
import { useMediaLibraryStore } from '../store/medialibrary'
import type { MediaLibraryItem, MediaCollectionMovie, MediaSeason, MediaEpisode, CastMember, CrewMember, DriveFileItem } from '../types/media'
import type { MediaServerMediaInfoCard } from '../types/mediaServerContent'
import type { IAliGetFileModel } from '../aliapi/alimodels'
import type { IPageVideoPlaylistEntry } from '../store/appstore'
import DownDAL from '../down/DownDAL'
import { menuOpenFile } from '../utils/openfile'
import { tmdbImageUrl } from '../utils/tmdb'
import message from '../utils/message'
import path from 'path'
import MediaAcquisitionTargetModal from './MediaAcquisitionTargetModal.vue'
import type { MediaAcquisitionRequest } from '@shared/types/mediaAcquisition'
import { getMediaCoverage } from '../utils/mediaCoverage'
import { listMediaAcquisitionTracking } from '../services/mediaAcquisition/client'
import type { MediaAcquisitionTrackingItem } from '@shared/types/mediaAcquisition'
import MediaMetadataEditorModal from './MediaMetadataEditorModal.vue'
import MediaSourceRatings from './MediaSourceRatings.vue'
import { getLocalVideoProgress } from '../utils/videoProgress'
import { detailResumeState, detailSeriesId, videoDurationSeconds } from '../utils/detailResume'
import { openCustomSeries } from '../utils/customMediaSeries'
import { detailCollectionTarget, playlistSelection, applyPlaylistSelection } from '../utils/detailCollections'
import { ListPlus, GalleryVerticalEnd, Play, Bookmark, Star, Ellipsis, ChevronDown, Repeat, Shuffle, Eye, EyeOff, Share, Plus, RefreshCw } from 'lucide-vue-next'
import { isContinueWatchingMember, toggleContinueWatching } from '../utils/continueWatchingAction'
import { openPersonalRating } from '../utils/mediaPersonalRating'
import { openMediaShare } from '../utils/mediaShare'
import { mediaFileSummary } from '../media-server/mediaSummary'

// Props
const props = defineProps<{
  mediaItem: MediaLibraryItem
  activePlaylistName?: string
  playlistItems?: MediaLibraryItem[]
}>()

// Emits
const emit = defineEmits<{
  back: []
  tagClick: [tagType: string, tagValue: string, personId?: number]
  aiRescrape: [item: MediaLibraryItem]
  metadataUpdated: [item: MediaLibraryItem]
  openPlaylistItem: [item: MediaLibraryItem]
}>()

const settingStore = useSettingStore()
const mediaStore = useMediaLibraryStore()
const userStore = useUserStore()

// 响应式状态
const selectedCollectionMovieId = ref<number>()
const activeMediaItem = computed<MediaLibraryItem>(() => (props.mediaItem.collectionMovies?.find(movie => movie.tmdbId === selectedCollectionMovieId.value) || props.mediaItem.collectionMovies?.[0] || props.mediaItem) as MediaLibraryItem)
const selectedSeason = ref(activeMediaItem.value.type === 'tv' && activeMediaItem.value.seasons?.length ? activeMediaItem.value.seasons[0].seasonNumber : 1)
const detailLogoLoadFailed = ref(false)
const detailLogoUrl = computed(() => {
  if (!displayScopeAllows(generalPreferences.logo, activeMediaItem.value.type === 'movie') || detailLogoLoadFailed.value || !activeMediaItem.value.logoUrl) return ''
  return activeMediaItem.value.logoUrl
})
watch(() => activeMediaItem.value.logoUrl, () => {
  detailLogoLoadFailed.value = false
})
const selectedEpisode = ref<number>()
const hasUserSelectedEpisode = ref(false)
const selectedDriveFileId = ref('')
const manuallySelectedVersion = ref(false)
watch(() => props.mediaItem, () => {
  selectedCollectionMovieId.value = undefined
  selectedSeason.value = activeMediaItem.value.type === 'tv' && activeMediaItem.value.seasons?.length ? activeMediaItem.value.seasons[0].seasonNumber : 1
  selectedEpisode.value = undefined
  hasUserSelectedEpisode.value = false
  selectedDriveFileId.value = ''; manuallySelectedVersion.value = false
})
const handleCollectionMovieSelect = (movie: MediaCollectionMovie) => {
  selectedCollectionMovieId.value = movie.tmdbId
  selectedEpisode.value = undefined
  hasUserSelectedEpisode.value = false
  void syncPlayButtonWidth()
}
const isFavorited = computed(() => {
  if (typeof mediaStore.isFavorite !== 'function') return false
  if (activeMediaItem.value.type === 'tv') {
    return mediaStore.isFavorite(activeMediaItem.value.id)
  }
  return mediaStore.isFavorite(activeMediaItem.value.id)
})
const inPlaylist = computed(() => {
  if (!currentPlaylistItemId.value) return false
  return Object.values(mediaStore.playlists).some(list => list.includes(currentPlaylistItemId.value))
})
const watchedId = computed(() => currentPlaylistItemId.value || activeMediaItem.value.id)
const isWatched = computed(() => {
  if (typeof mediaStore.isWatched !== 'function') return false
  return currentPlaylistItemId.value ? mediaStore.isWatched(watchedId.value) : isMediaWatched(activeMediaItem.value, mediaStore.watchedItems)
})
const showPlaylistModal = ref(false)
const playlistTarget = ref<{ id: string; title: string } | null>(null)
const selectedPlaylists = ref<string[]>([])
const playlistEditing = ref<string | null>(null)
const playlistName = ref('')
const playlistError = ref('')
const playlistRows = computed(() => Object.entries(mediaStore.playlists).map(([name, ids]) => ({ id: name, title: name, count: ids.length, selected: selectedPlaylists.value.includes(name) })))
const actionButtonsRef = ref<HTMLElement | null>(null)
const playButtonWidth = ref<number | null>(null)
const acquisitionVisible = ref(false)
const activeAcquisitionRequest = ref<MediaAcquisitionRequest | null>(null)
const trackingItems = ref<MediaAcquisitionTrackingItem[]>([])
const metadataEditorVisible = ref(false)

const playlistMemberEpisodeLabel = (member: MediaLibraryItem): string => {
  const match = member.id.match(/_(\d+)_(\d+)$/)
  return match ? `第 ${Number(match[1])} 季 · 第 ${Number(match[2])} 集` : ''
}

const mediaCoverage = computed(() => getMediaCoverage(activeMediaItem.value))
const acquisitionRequest = computed<MediaAcquisitionRequest | null>(() => {
  const coverage = mediaCoverage.value
  if (!coverage) return null
  const seasonNumbers = coverage.seasonGaps.map(gap => gap.seasonNumber)
  const isAnime = activeMediaItem.value.genres.some(genre => String(genre).includes('动画') || String(genre).includes('动漫'))
  return {
    mediaLibraryItemId: activeMediaItem.value.id,
    tmdbId: activeMediaItem.value.tmdbId,
    mediaType: isAnime ? 'anime' : 'tv',
    title: activeMediaItem.value.name,
    year: activeMediaItem.value.year ? Number(activeMediaItem.value.year) : undefined,
    seasonNumber: seasonNumbers[0],
    missingSeasonNumbers: seasonNumbers,
    missingEpisodes: coverage.seasonGaps
  }
})
const trackingRequest = computed<MediaAcquisitionRequest | null>(() => {
  if (activeMediaItem.value.type !== 'tv' || !activeMediaItem.value.tmdbId) return null
  const seasonNumbers = [...new Set([...(activeMediaItem.value.expectedSeasons || []).map(season => season.seasonNumber), ...(activeMediaItem.value.seasons || []).map(season => season.seasonNumber)])].filter(season => season > 0).sort((a, b) => a - b)
  if (!seasonNumbers.length) return null
  const isAnime = activeMediaItem.value.genres.some(genre => String(genre).includes('动画') || String(genre).includes('动漫'))
  return {
    mediaLibraryItemId: activeMediaItem.value.id, tmdbId: activeMediaItem.value.tmdbId, mediaType: isAnime ? 'anime' : 'tv', title: activeMediaItem.value.name,
    year: activeMediaItem.value.year ? Number(activeMediaItem.value.year) : undefined, seasonNumber: selectedSeason.value || seasonNumbers[0], trackingOnly: true, trackingSeasonNumbers: seasonNumbers
  }
})
const currentSeasonTracked = computed(() => trackingItems.value.some(item => item.tmdbId === activeMediaItem.value.tmdbId && item.seasonNumber === selectedSeason.value && item.status !== 'ended'))

// 计算属性
const currentSeason = computed(() => {
  if (activeMediaItem.value.type !== 'tv' || !activeMediaItem.value.seasons) return null
  return activeMediaItem.value.seasons.find(s => s.seasonNumber === selectedSeason.value) || activeMediaItem.value.seasons[0]
})

const currentSeasonEpisodes = computed(() => {
  if (activeMediaItem.value.type !== 'tv' || !activeMediaItem.value.seasons) return []

  const currentSeason = activeMediaItem.value.seasons.find(s => s.seasonNumber === selectedSeason.value)

  // 临时测试：如果只有一集，创建更多集用于测试
  if (currentSeason?.episodes && currentSeason.episodes.length === 1) {
    const baseEpisode = currentSeason.episodes[0]
    const testEpisodes = []

    for (let i = 1; i <= 5; i++) {
      testEpisodes.push({
        ...baseEpisode,
        id: baseEpisode.id + i,
        episodeNumber: i,
        name: `Episode ${i}`
      })
    }

    return testEpisodes
  }

  return currentSeason?.episodes || []
})

const continueRecord = computed(() => {
  if (activeMediaItem.value.type !== 'tv') {
    return mediaStore.continueWatching.find(item => item.id === activeMediaItem.value.id)
  }
  const idValue = String(activeMediaItem.value.id)
  const seriesId = detailSeriesId(idValue)
  if (seriesId !== idValue) {
    return mediaStore.continueWatching.find(item => item.id === idValue)
  }
  return mediaStore.continueWatching.find(item => detailSeriesId(String(item.id)) === seriesId)
})

const findEpisodeByFileId = (fileId: string | undefined | null) => {
  if (!fileId || activeMediaItem.value.type !== 'tv') return undefined
  const seasons = activeMediaItem.value.seasons || []
  for (const season of seasons) {
    const episode = season.episodes?.find(ep => ep.driveFiles?.some(file => file.id === fileId))
    if (episode) return episode
  }
  return undefined
}

const parseContinueEpisodeId = (value: string | undefined) => {
  if (!value) return null
  const parts = String(value).split('_')
  if (parts.length < 3) return null
  const seasonNumber = parseInt(parts[parts.length - 2] || '', 10)
  const episodeNumber = parseInt(parts[parts.length - 1] || '', 10)
  if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) return null
  const tvId = parts.slice(0, -2).join('_')
  return { seasonNumber, episodeNumber, tvId }
}

const continueEpisode = computed(() => {
  if (activeMediaItem.value.type !== 'tv') return undefined
  const info = parseContinueEpisodeId(continueRecord.value?.id)
  if (info) {
    const season = activeMediaItem.value.seasons?.find(s => s.seasonNumber === info.seasonNumber)
    const episode = season?.episodes?.find(ep => ep.episodeNumber === info.episodeNumber)
    if (episode) return episode
  }
  return findEpisodeByFileId(continueRecord.value?.lastPlayedFileId)
})

watchEffect(() => {
  if (activeMediaItem.value.type !== 'tv') return
  if (hasUserSelectedEpisode.value) return
  const episode = continueEpisode.value
  if (episode) {
    selectedSeason.value = episode.seasonNumber
    selectedEpisode.value = episode.episodeNumber
  }
})

const availableSeasons = computed(() => {
  if (activeMediaItem.value.type !== 'tv' || !activeMediaItem.value.seasons) return []
  return activeMediaItem.value.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber)
})

const totalEpisodeCount = computed(() => {
  if (activeMediaItem.value.type !== 'tv' || !activeMediaItem.value.seasons) return 0
  return activeMediaItem.value.seasons.reduce((total, season) => {
    return total + (season.episodes?.length || 0)
  }, 0)
})

const currentFileName = computed(() => {
  return selectedDriveFile.value?.name || ''
})

const currentDownloadFile = computed(() => {
  return selectedDriveFile.value || null
})

const backgroundStyle = computed(() => {
  if (activeMediaItem.value.backdropUrl) {
    return {
      backgroundImage: `url(${JSON.stringify(detailBackdropUrl(activeMediaItem.value.backdropUrl))})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center top',
      backgroundRepeat: 'no-repeat'
    }
  }
  return {
    backgroundImage: 'none'
  }
})

// 制作信息（可扩展）
const productionCompanies = computed(() => {
  return [] as { id: number; name: string }[]
})

const productionCountries = computed(() => {
  return (activeMediaItem.value.productionCountries || []).map((name) => ({
    iso31661: name,
    name
  }))
})

const currentEpisode = computed(() => {
  if (activeMediaItem.value.type !== 'tv') return null
  const selected = currentSeasonEpisodes.value.find(
    item => item.episodeNumber === selectedEpisode.value
  )
  return selected || currentSeasonEpisodes.value[0] || null
})

const detailVersionFiles = computed<DriveFileItem[]>(() => {
  const files = activeMediaItem.value.type === 'tv' ? currentEpisode.value?.driveFiles || [] : activeMediaItem.value.driveFiles || []
  return orderedVersions(files, seriesPreferences.defaultVersion)
})

const selectedDriveFile = computed<DriveFileItem | undefined>(() => {
  return detailVersionFiles.value.find(file => file.id === selectedDriveFileId.value) || detailVersionFiles.value[0]
})

const formatMediaFileSize = (value?: number) => {
  if (!value || value <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let current = value
  let unitIndex = 0
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }
  const precision = current >= 10 ? 1 : 2
  return `${current.toFixed(precision).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')}${units[unitIndex]}`
}

const mediaFileExtension = (name: string) => {
  const match = name.match(/\.([^.]+)$/)
  return match?.[1]?.toUpperCase() || ''
}

const inferVideoCodec = (name: string) => {
  if (/\b(?:hevc|h[ ._-]?265|x265)\b/i.test(name)) return 'HEVC'
  if (/\b(?:avc|h[ ._-]?264|x264)\b/i.test(name)) return 'H.264'
  if (/\bav1\b/i.test(name)) return 'AV1'
  if (/\bvp9\b/i.test(name)) return 'VP9'
  return ''
}

const inferVideoRange = (name: string) => {
  if (/\b(?:dolby[ ._-]?vision|dovi|dv)\b/i.test(name)) return 'Dolby Vision'
  if (/\bhdr10\+?\b/i.test(name)) return 'HDR10'
  if (/\bhdr\b/i.test(name)) return 'HDR'
  return 'SDR'
}

const inferVideoResolution = (file: DriveFileItem) => {
  const fromName = file.name.match(/\b(2160|1440|1080|720|576|480)p\b/i)?.[1]
  const height = Number(file.height || fromName || 0)
  return height > 0 ? `${height}p` : ''
}

const formatMediaDuration = (value?: string) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.includes(':')) return raw
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds <= 0) return raw
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

const inferSubtitleLanguage = (name: string) => {
  if (/(?:^|[. _-])(?:zh|zho|chi|chs|cht|简中|繁中|中文)(?:[. _-]|$)/i.test(name)) return '中文'
  if (/(?:^|[. _-])(?:en|eng|english)(?:[. _-]|$)/i.test(name)) return '英语'
  if (/(?:^|[. _-])(?:ja|jpn|japanese)(?:[. _-]|$)/i.test(name)) return '日语'
  if (/(?:^|[. _-])(?:ko|kor|korean)(?:[. _-]|$)/i.test(name)) return '韩语'
  return '未知'
}

const cloudDriveLabel = (file: DriveFileItem) => {
  const drive = [file.driveServerId, file.driveId, file.cloudType].filter(Boolean).join(' ').toLowerCase()
  if (drive.includes('local')) return '本地媒体库'
  if (drive.includes('115')) return '115 网盘'
  if (drive.includes('123')) return '123 云盘'
  if (drive.includes('baidu')) return '百度网盘'
  if (drive.includes('quark')) return '夸克网盘'
  if (drive.includes('pikpak')) return 'PikPak'
  if (drive.includes('dropbox')) return 'Dropbox'
  if (drive.includes('onedrive')) return 'OneDrive'
  if (drive.includes('box')) return 'Box'
  if (drive.includes('139')) return '中国移动云盘'
  if (drive.includes('189')) return '天翼云盘'
  return '阿里云盘'
}

const detailMediaInfoCards = computed<MediaServerMediaInfoCard[]>(() => {
  const file = selectedDriveFile.value
  if (!file) return []

  const container = mediaFileExtension(file.name)
  const codec = inferVideoCodec(file.name)
  const resolution = inferVideoResolution(file)
  const videoRange = inferVideoRange(file.name)
  const videoTitle = [resolution.toUpperCase(), codec, videoRange !== 'SDR' ? videoRange : ''].filter(Boolean).join(' · ') || file.name
  const videoRows: Array<[string, string]> = [
    ['Codec', codec],
    ['分辨率', resolution],
    ['Video range', videoRange],
    ['容器', container],
    ['时长', formatMediaDuration(file.videoDuration)],
    ['文件大小', formatMediaFileSize(file.fileSize)],
    ['来源', cloudDriveLabel(file)]
  ].filter((row): row is [string, string] => !!row[1])

  const cards: MediaServerMediaInfoCard[] = [{
    id: `video:${file.id}`,
    kind: 'video',
    title: videoTitle,
    selected: true,
    rows: videoRows.map(([label, value]) => ({ label, value }))
  }]

  const seenSubtitleIds = new Set<string>()
  for (const [index, subtitle] of (file.subtitleFiles || []).entries()) {
    const id = subtitle.id || subtitle.path || subtitle.name || String(index)
    if (seenSubtitleIds.has(id)) continue
    seenSubtitleIds.add(id)
    const subtitleFormat = mediaFileExtension(subtitle.name)
    cards.push({
      id: `subtitle:${id}`,
      kind: 'subtitle',
      title: subtitle.name || `字幕 ${index + 1}`,
      rows: [
        { label: '语言', value: inferSubtitleLanguage(subtitle.name) },
        ...(subtitleFormat ? [{ label: 'Codec', value: subtitleFormat }] : []),
        { label: '外部', value: '是' },
        ...(formatMediaFileSize(subtitle.fileSize) ? [{ label: '文件大小', value: formatMediaFileSize(subtitle.fileSize) }] : []),
        { label: '来源', value: cloudDriveLabel(subtitle) }
      ]
    })
  }
  return cards
})

const detailFileSummary = computed(() => mediaFileSummary(
  selectedDriveFile.value ? formatMediaFileSize(selectedDriveFile.value.fileSize) : undefined,
  detailMediaInfoCards.value
))

watch(detailVersionFiles, (files) => {
  if (!files.some(file => file.id === selectedDriveFileId.value)) selectedDriveFileId.value = files[0]?.id || ''
}, { immediate: true })

const castList = computed(() => {
  const item = activeMediaItem.value as MediaLibraryItem & {
    credits?: { cast?: CastMember[] }
    cast?: CastMember[]
  }
  const seasonCast = currentSeason.value?.credits?.cast
  const episodeCrew = currentEpisode.value?.crew || []

  let rawCast: Array<CastMember | (CrewMember & { character?: string })> = []
  if (episodeCrew.length > 0) {
    rawCast = episodeCrew.map((crew) => ({
      ...crew,
      character: crew.job || crew.department
    }))
  } else {
    rawCast = seasonCast || item.credits?.cast || item.cast || []
  }

  return rawCast.map((cast) => ({
    ...cast,
    profilePath: cast.profile_path || (cast as unknown as { profile_path?: string }).profile_path
  }))
})

const meaningfulOverview = (value?: string) => value?.trim() || ''
const displayOverview = computed(() => {
  if (generalPreferences.hideSpoilers) return ''
  if (activeMediaItem.value.type === 'tv') {
    return meaningfulOverview(currentEpisode.value?.overview)
      || meaningfulOverview(activeMediaItem.value.overview)
  }
  return meaningfulOverview(activeMediaItem.value.overview)
})

const currentEpisodeRecord = computed(() => {
  if (activeMediaItem.value.type !== 'tv') return null
  const episode = currentEpisode.value
  if (!episode) return null
  const seriesId = detailSeriesId(String(activeMediaItem.value.id))
  const episodeId = `${seriesId}_${episode.seasonNumber}_${episode.episodeNumber}`
  return mediaStore.continueWatching.find(item => item.id === episodeId) || null
})

const playResume = computed(() => {
  const file = selectedDriveFile.value
  if (!file) return null
  const record = activeMediaItem.value.type === 'tv' ? currentEpisodeRecord.value : continueRecord.value
  const matchesFile = record?.lastPlayedFileId === file.id || (!record?.lastPlayedFileId && detailVersionFiles.value.length === 1)
  const duration = (matchesFile ? record?.lastPlayedDurationSeconds : 0) || videoDurationSeconds(file.videoDuration) || (currentEpisode.value?.runtime || 0) * 60
  const localPosition = getLocalVideoProgress(file.userId || userStore.user_id, file.driveId, file.id)
  const position = localPosition || (matchesFile ? record?.lastPlayedPositionSeconds || (record?.watchProgress || 0) * duration : 0)
  return detailResumeState(position, duration, matchesFile ? (record?.watchProgress || 0) * 100 : undefined)
})
const playProgressPercent = computed(() => playResume.value?.percent ?? null)

const playButtonLabel = computed(() => {
  if (playResume.value) return playResume.value.label
  if (activeMediaItem.value.type === 'tv') {

    const current = currentEpisode.value
    if (current) return `播放第 ${current.episodeNumber} 集`
    return '播放第一集'
  }

  return '开始播放'
})

const playEpisodeInfo = computed(() => {
  if (activeMediaItem.value.type !== 'tv') return ''
  const episode = currentEpisode.value
  if (!episode) return ''
  const fileName = currentFileName.value || ''
  const title = `将播放：S${episode.seasonNumber}E${episode.episodeNumber} ${episode.name || ''}`.trim()
  return fileName ? `${title} · ${fileName}` : title
})

const detailHeading = computed(() => {
  const episode = currentEpisode.value
  if (activeMediaItem.value.type === 'tv' && episode) {
    return `S${episode.seasonNumber} · E${episode.episodeNumber} - ${episode.name}`
  }
  return ''
})

const currentCollectionTarget = computed(() => detailCollectionTarget(activeMediaItem.value, currentEpisode.value))
const currentPlaylistItemId = computed(() => currentCollectionTarget.value?.id || '')
const isWatchlisted = computed(() => mediaStore.continueWatching.some(entry => isContinueWatchingMember(entry, activeMediaItem.value)))
async function toggleWatchlist() {
  try { await toggleContinueWatching(mediaStore, activeMediaItem.value) }
  catch (error) { message.error(error instanceof Error ? error.message : String(error)) }
}

// 方法
const handleBackClick = () => {
  emit('back')
}

const handleCompleteMissing = () => {
  if (!acquisitionRequest.value) return
  activeAcquisitionRequest.value = acquisitionRequest.value
  acquisitionVisible.value = true
}

const handleStartTracking = () => {
  if (!trackingRequest.value) return
  activeAcquisitionRequest.value = trackingRequest.value
  acquisitionVisible.value = true
}

const refreshTrackingItems = async () => {
  try { trackingItems.value = await listMediaAcquisitionTracking(200) } catch {}
}

const handleAcquisitionCreated = () => {
  void refreshTrackingItems()
}

const handleTagClick = (tagType: string, tagValue: string) => {
  emit('tagClick', tagType, tagValue)
}

const handleSeasonChange = (seasonNumber: number) => {
  selectedSeason.value = seasonNumber
  selectedEpisode.value = undefined
  hasUserSelectedEpisode.value = true
}

const handleCastClick = (cast: CastMember) => {
  emit('tagClick', 'cast', cast.name, cast.id)
}

const handleEpisodeSelect = (episode: MediaEpisode) => {
  selectedEpisode.value = episode.episodeNumber
  hasUserSelectedEpisode.value = true
  syncPlayButtonWidth()
}

const handleEpisodePlay = (episode: MediaEpisode) => {
  selectedEpisode.value = episode.episodeNumber
  hasUserSelectedEpisode.value = true
  playEpisode(episode)
  syncPlayButtonWidth()
}

const playMainContent = () => {
  if (activeMediaItem.value.type === 'tv') {
    // 电视剧播放第一集
    const episode = currentEpisode.value
    if (episode) {
      playEpisode(episode)
    }
  } else {
    // 电影播放主文件
    playMovie()
  }
}

const playShuffledEpisodes = () => {
  const episodes = currentSeasonEpisodes.value.filter(episode => episode.driveFiles?.length)
  for (let index = episodes.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[episodes[index], episodes[other]] = [episodes[other], episodes[index]]
  }
  const first = episodes[0]
  if (!first) return
  const playlist = episodes.map(episode => buildPlaylistEntry(buildAliFileModel(playbackVersions(episode.driveFiles)[0]), `${activeMediaItem.value.name} · S${episode.seasonNumber}E${episode.episodeNumber}`))
  void menuOpenFile(buildAliFileModel(playbackVersions(first.driveFiles)[0]), '', { customPlaylistLabel: activeMediaItem.value.name, customPlaylist: playlist })
}

const buildAliFileModel = (driveFile: DriveFileItem): IAliGetFileModel => {
  const ext = driveFile.name.split('.').pop() || ''
  const parentFileId = driveFile.parentFileId || ((driveFile.driveId || '').startsWith('webdav:')
    ? (path.posix.dirname(driveFile.id || '/') || '/')
    : 'root')
  return {
    __v_skip: true,
    drive_id: driveFile.driveId,
    file_id: driveFile.id,
    parent_file_id: parentFileId,
    name: driveFile.name,
    namesearch: driveFile.name.toLowerCase(),
    ext,
    mime_type: '',
    mime_extension: '',
    category: 'video',
    icon: 'iconfile_video',
    size: driveFile.fileSize || 0,
    sizeStr: '',
    time: 0,
    timeStr: '',
    starred: false,
    isDir: false,
    thumbnail: driveFile.thumbnailLink || '',
    description: driveFile.contentHash || '',
    library_subtitle_files: driveFile.subtitleFiles || [],
    media_width: driveFile.height,
    media_height: driveFile.height,
    media_duration: driveFile.videoDuration,
    media_play_cursor: '',
    media_time: '',
    user_meta: '',
    user_id: driveFile.userId || ''
  } as IAliGetFileModel
}

const buildPlaylistEntry = (aliFile: IAliGetFileModel, title: string): IPageVideoPlaylistEntry => ({
  user_id: (aliFile as any).user_id || '',
  drive_id: aliFile.drive_id,
  file_id: aliFile.file_id,
  parent_file_id: aliFile.parent_file_id,
  file_name: aliFile.name,
  html: title,
  ext: aliFile.ext,
  description: aliFile.description,
  play_cursor: aliFile.media_play_cursor ? parseInt(aliFile.media_play_cursor, 10) || 0 : 0,
  encType: aliFile.description || ''
})

const resolvePlaylistEpisodeForItem = (item: MediaLibraryItem) => {
  if (item.id === activeMediaItem.value.id && currentEpisode.value) return currentEpisode.value
  const seasons = item.seasons || []
  for (const season of seasons) {
    const episode = season.episodes?.find((candidate) => candidate.driveFiles?.length)
    if (episode) return episode
  }
  return undefined
}

const resolvePlaylistPlayableEntry = (item: MediaLibraryItem): IPageVideoPlaylistEntry | null => {
  if (item.type === 'tv') {
    const episode = resolvePlaylistEpisodeForItem(item)
    const driveFile = playbackVersions(episode?.driveFiles || [])[0]
    if (!episode || !driveFile) return null
    const aliFile = buildAliFileModel(driveFile)
    return buildPlaylistEntry(aliFile, `${item.name} · S${episode.seasonNumber}E${episode.episodeNumber} ${episode.name}`.trim())
  }

  const driveFile = playbackVersions(item.driveFiles || [])[0]
  if (!driveFile) return null
  const aliFile = buildAliFileModel(driveFile)
  return buildPlaylistEntry(aliFile, item.name)
}

const currentPlaylistEntries = computed<IPageVideoPlaylistEntry[]>(() => {
  if (!props.activePlaylistName || !props.playlistItems?.length) return []
  return props.playlistItems
    .map((item) => resolvePlaylistPlayableEntry(item))
    .filter((item): item is IPageVideoPlaylistEntry => !!item)
})

const playEpisode = (episode: MediaEpisode, loop = false) => {
  if (episode.driveFiles && episode.driveFiles.length > 0) {
    const driveFile = (manuallySelectedVersion.value ? episode.driveFiles.find(file => file.id === selectedDriveFileId.value) : orderedVersions(episode.driveFiles, seriesPreferences.playbackVersion === 'auto' ? seriesPreferences.defaultVersion : seriesPreferences.playbackVersion)[0]) || episode.driveFiles[0]
    const aliFile = buildAliFileModel(driveFile)
    menuOpenFile(aliFile, '', {
      customPlaylistLabel: props.activePlaylistName || '',
      customPlaylist: currentPlaylistEntries.value,
      playlistLoop: loop
    })
  }
}

const playMovie = (loop = false) => {
  if (activeMediaItem.value.driveFiles && activeMediaItem.value.driveFiles.length > 0) {
    const driveFile = (manuallySelectedVersion.value ? activeMediaItem.value.driveFiles.find(file => file.id === selectedDriveFileId.value) : orderedVersions(activeMediaItem.value.driveFiles, seriesPreferences.playbackVersion === 'auto' ? seriesPreferences.defaultVersion : seriesPreferences.playbackVersion)[0]) || activeMediaItem.value.driveFiles[0]
    const aliFile = buildAliFileModel(driveFile)
    menuOpenFile(aliFile, '', {
      customPlaylistLabel: props.activePlaylistName || '',
      customPlaylist: currentPlaylistEntries.value,
      playlistLoop: loop
    })
  }
}

const handleDownloadCurrent = () => {
  const driveFile = currentDownloadFile.value
  if (!driveFile) {
    message.warning('当前媒体没有可下载的视频文件')
    return
  }

  const savePath = settingStore.AriaIsLocal ? settingStore.downSavePath : settingStore.ariaSavePath
  if (!savePath || !savePath.trim()) {
    message.error('未设置保存路径，请先在下载设置中配置')
    return
  }

  try {
    DownDAL.aAddDownload([buildAliFileModel(driveFile)], savePath, settingStore.downSavePathFull)
    message.success('成功创建下载任务')
  } catch (error: any) {
    message.error(error?.message || '创建下载任务失败')
  }
}

const getFavoriteMode = () => {
  if (activeMediaItem.value.type !== 'tv') return null
  const episode = currentEpisode.value
  if (!episode) return null
  const seriesId = activeMediaItem.value.id
  const seasonId = `${activeMediaItem.value.id}_${episode.seasonNumber}`
  const episodeId = `${activeMediaItem.value.id}_${episode.seasonNumber}_${episode.episodeNumber}`
  if (mediaStore.isFavorite(seriesId)) return 'series'
  if (mediaStore.isFavorite(seasonId)) return 'season'
  if (mediaStore.isFavorite(episodeId)) return 'episode'
  return null
}

const toggleFavorite = () => {
  if (typeof mediaStore.toggleFavorite !== 'function') return
  mediaStore.toggleFavorite(activeMediaItem.value.id)
}

const togglePlaylist = () => {
  if (!currentCollectionTarget.value) return
  playlistTarget.value = { ...currentCollectionTarget.value }
  selectedPlaylists.value = playlistSelection(mediaStore.playlists, playlistTarget.value.id)
  playlistEditing.value = null
  playlistName.value = ''
  playlistError.value = ''
  showPlaylistModal.value = true
}
const savePlaylistSelection = () => {
  if (playlistTarget.value) mediaStore.playlists = applyPlaylistSelection(mediaStore.playlists, playlistTarget.value.id, selectedPlaylists.value)
  showPlaylistModal.value = false
}
const addToCustomSeries = () => {
  if (activeMediaItem.value.type === 'tv') {
    openCustomSeries({ id: activeMediaItem.value.id, title: activeMediaItem.value.name })
  } else if (currentCollectionTarget.value) {
    openCustomSeries({ ...currentCollectionTarget.value })
  }
}

const handleMetadataSave = (edited: MediaLibraryItem) => {
  const active = activeMediaItem.value
  const updated = active.id === props.mediaItem.id
    ? edited
    : {
        ...props.mediaItem,
        collectionMovies: (props.mediaItem.collectionMovies || []).map((movie) => movie.id === active.id ? edited as MediaCollectionMovie : movie)
      }
  mediaStore.updateMediaItem(props.mediaItem.id, updated)
  metadataEditorVisible.value = false
  emit('metadataUpdated', updated)
  message.success('元数据已更新')
}

const startPlaylistName = (name = '') => {
  playlistEditing.value = name
  playlistName.value = name
  playlistError.value = ''
}
const confirmPlaylistName = () => {
  const name = playlistName.value.trim()
  const oldName = playlistEditing.value
  if (!name || oldName === null) return
  if (Object.keys(mediaStore.playlists).some(existing => existing.toLocaleLowerCase() === name.toLocaleLowerCase() && existing !== oldName)) {
    playlistError.value = '已存在同名播放列表'
    return
  }
  if (oldName) {
    mediaStore.renamePlaylist(oldName, name)
    selectedPlaylists.value = selectedPlaylists.value.map(selected => selected === oldName ? name : selected)
  } else mediaStore.addPlaylist(name)
  playlistEditing.value = null
}

const handleTogglePlaylistItem = (playlistName: string) => {
  selectedPlaylists.value = selectedPlaylists.value.includes(playlistName) ? selectedPlaylists.value.filter(name => name !== playlistName) : [...selectedPlaylists.value, playlistName]
}

const handleRemovePlaylist = (playlistName: string) => {
  mediaStore.removePlaylist(playlistName)
  selectedPlaylists.value = selectedPlaylists.value.filter(name => name !== playlistName)
}

const syncPlayButtonWidth = async () => {
  await nextTick()
  if (actionButtonsRef.value) {
    playButtonWidth.value = actionButtonsRef.value.offsetWidth
  }
}

onMounted(() => {
  syncPlayButtonWidth()
  void refreshTrackingItems()
  window.addEventListener('resize', syncPlayButtonWidth)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncPlayButtonWidth)
})

const toggleWatched = () => {
  if (typeof mediaStore.markWatched !== 'function') return
  if (currentPlaylistItemId.value) mediaStore.markWatched(watchedId.value, !isWatched.value)
  else setMediaWatched(activeMediaItem.value, !isWatched.value, mediaStore)
}

// 处理图片加载错误
const handleImageError = (event: Event) => {
  const img = event.target as HTMLImageElement
  img.style.display = 'none'
  const placeholder = img.parentElement?.querySelector('.thumbnail-placeholder') as HTMLElement
  if (placeholder) {
    placeholder.style.display = 'flex'
  }
}

const getCastAvatarUrl = (path?: string): string => {
  if (!path) return ''
  if (path.startsWith('http')) return path
  return tmdbImageUrl(path)
}

const getCastInitial = (name?: string): string => {
  if (!name) return '?'
  return name.trim().charAt(0).toUpperCase()
}
</script>

<template>
  <div class="media-detail">
    <!-- 返回按钮 -->
    <div class="detail-header">
      <button class="detail-back" @click="handleBackClick" :title="activeMediaItem.name">
        <IconFont name="iconarrow-left-2-icon" />
        <span class="detail-back-title">{{ activeMediaItem.name }}</span>
      </button>
      <div class="detail-header-actions">
        <button class="action-button" :title="isWatchlisted ? '从待看列表移除' : '加入待看列表'" @click="toggleWatchlist"><Bookmark :size="20" :fill="isWatchlisted ? 'currentColor' : 'none'" /></button>
        <a-dropdown trigger="click" position="br" :auto-fit-popup-width="false" popup-class="detail-more-action-popup">
          <button class="action-button" title="更多操作"><Ellipsis :size="20" /><ChevronDown :size="12" /></button>
          <template #content><div class="detail-more-action-menu">
            <button class="detail-more-action-item" @click="activeMediaItem.type === 'tv' && currentEpisode ? playEpisode(currentEpisode, true) : playMovie(true)"><Repeat :size="20" /><span>循环播放</span></button>
            <button v-if="activeMediaItem.type === 'tv'" class="detail-more-action-item" @click="playShuffledEpisodes"><Shuffle :size="20" /><span>随机播放</span></button>
            <button class="detail-more-action-item" @click="toggleWatched"><component :is="isWatched ? EyeOff : Eye" :size="20" /><span>{{ isWatched ? '标记未观看' : '标记已观看' }}</span></button>
            <button class="detail-more-action-item" @click="toggleWatchlist"><Bookmark :size="20" /><span>{{ isWatchlisted ? '从待看列表移除' : '加入待看列表' }}</span></button>
            <button class="detail-more-action-item" @click="togglePlaylist"><ListPlus :size="20" /><span>播放列表</span></button>
            <button class="detail-more-action-item" @click="addToCustomSeries"><GalleryVerticalEnd :size="20" /><span>系列</span></button>
            <button class="detail-more-action-item" @click="openPersonalRating(activeMediaItem)"><Star :size="20" /><span>评分</span></button>
            <button class="detail-more-action-item" @click="metadataEditorVisible = true"><IconFont name="iconedit-square" /><span>编辑元数据</span></button>
            <button class="detail-more-action-item" @click="openMediaShare({ id: activeMediaItem.id, title: activeMediaItem.name, year: activeMediaItem.year, files: activeMediaItem.driveFiles })"><Share :size="20" /><span>分享</span></button>
            <button class="detail-more-action-item" @click="handleDownloadCurrent"><IconFont name="icondownload" /><span>下载</span></button>
            <button v-if="mediaCoverage" class="detail-more-action-item accent" @click="handleCompleteMissing"><Plus :size="20" /><span>一键补全</span></button>
            <button v-if="trackingRequest" class="detail-more-action-item accent" @click="handleStartTracking"><RefreshCw :size="20" /><span>{{ currentSeasonTracked ? '管理追更' : '追更本季' }}</span></button>
          </div></template>
        </a-dropdown>
      </div>
    </div>

    <!-- 内容滚动区域 -->
    <div class="detail-content">
      <!-- Hero区域 -->
      <div class="hero-section" :style="backgroundStyle">
        <div class="hero-content">
          <div class="hero-poster">
            <WatchedIndicator corner :watched="isWatched" />
            <PosterRatingBadge :rating="activeMediaItem.rating" :is-movie="activeMediaItem.type === 'movie'" />
            <img v-if="activeMediaItem.posterUrl" :src="activeMediaItem.posterUrl" :alt="activeMediaItem.name" />
            <div v-else class="poster-placeholder">
              <MediaPosterPlaceholder />
            </div>
          </div>

          <div class="hero-info">
            <div class="hero-copy">
            <img
              v-if="detailLogoUrl"
              class="hero-logo"
              :src="detailLogoUrl"
              :alt="activeMediaItem.name"
              @error="detailLogoLoadFailed = true"
            />
            <h1 v-else class="hero-title">{{ activeMediaItem.name }}</h1>
            <div v-if="detailHeading" class="hero-episode-title">{{ detailHeading }}</div>

            <div class="hero-meta">
              <MediaSourceRatings :rating="activeMediaItem.rating" :is-movie="activeMediaItem.type === 'movie'" />
              <span v-if="activeMediaItem.type === 'tv' && totalEpisodeCount" class="meta-episodes">
                共 {{ totalEpisodeCount }} 集
              </span>
            </div>

            <div class="hero-meta-secondary">
              <span v-if="activeMediaItem.year">{{ activeMediaItem.year }}</span>
              <span v-if="activeMediaItem.genres.length" class="meta-genres">
                {{ activeMediaItem.genres.slice(0, 3).join(' · ') }}
              </span>
              <span v-if="activeMediaItem.certification?.trim()" class="content-certification">{{ activeMediaItem.certification }}</span>
              <span>24分钟</span>
              <span>1080P</span>
              <span>SDR</span>
            </div>

            <p v-if="displayOverview" class="hero-overview" :title="displayOverview">
              {{ displayOverview }}
            </p>

            <div v-if="mediaCoverage" class="coverage-alert">
              <span class="coverage-alert-icon">!</span>
              <div>
                <strong>{{ mediaCoverage.summary }}</strong>
                <span>{{ mediaCoverage.seasonGaps.map(gap => `S${String(gap.seasonNumber).padStart(2, '0')} 缺 ${gap.missingEpisodes.length} 集`).join(' · ') }}</span>
              </div>
            </div>

            </div>
            <div class="hero-actions">
              <div class="hero-brand-title">{{ activeMediaItem.name }}</div>
              <div class="actions-stack">
                <div v-if="playEpisodeInfo" class="play-episode-info">{{ playEpisodeInfo }}</div>
                <div class="play-row" :class="{ 'has-version': detailVersionFiles.length > 1 }">
                  <button
                    type="button"
                    class="play-button"
                    :class="{ 'has-resume': playResume }"
                    @click="playMainContent"
                  >
                    <span
                      v-if="playProgressPercent !== null"
                      class="play-button-progress"
                      aria-hidden="true"
                      :style="{ width: `${playProgressPercent}%` }"
                    ></span>
                    <span class="play-button-label">{{ playButtonLabel }}</span>
                  </button>
                  <a-dropdown v-if="detailVersionFiles.length > 1" trigger="click" position="bl" popup-class="detail-version-popup">
                    <button type="button" class="version-button" title="选择视频版本">
                      <IconFont name="icondown" />
                    </button>
                    <template #content>
                      <a-doption
                        v-for="file in detailVersionFiles"
                        :key="file.id"
                        class="detail-version-option"
                        @click="selectedDriveFileId = file.id; manuallySelectedVersion = true"
                      >
                        <span class="detail-version-option-name">{{ file.name }}</span>
                        <span v-if="selectedDriveFile?.id === file.id" class="detail-version-option-current">当前</span>
                      </a-doption>
                    </template>
                  </a-dropdown>
                </div>
                <div ref="actionButtonsRef" class="action-buttons">
                  <button
                    type="button"
                    class="action-button"
                    :class="{ active: isWatched }"
                    :title="isWatched ? '标记为未观看' : '标记为已观看'"
                    @click="toggleWatched"
                  >
                    <component :is="isWatched ? EyeOff : Eye" :size="20" />
                  </button>
                  <button
                    type="button"
                    class="action-button"
                    title="下载"
                    @click="handleDownloadCurrent"
                  >
                    <IconFont name="icondownload" />
                  </button>
                  <button
                    type="button"
                    class="action-button"
                    :class="{ active: isWatchlisted }"
                    :title="isWatchlisted ? '从待看列表移除' : '加入待看列表'"
                    @click="toggleWatchlist"
                  >
                    <Bookmark :size="20" :fill="isWatchlisted ? 'currentColor' : 'none'" />
                  </button>
                  <button class="action-button" title="评分" @click="openPersonalRating(activeMediaItem)"><Star :size="20" /></button>
                  <button class="action-button" title="加入系列" :disabled="!currentCollectionTarget" @click="addToCustomSeries"><GalleryVerticalEnd :size="20" /></button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="props.mediaItem.collectionMovies && props.mediaItem.collectionMovies.length > 1" class="episodes-section">
        <div class="section-header">
          <h3>{{ props.mediaItem.collectionName || props.mediaItem.name }}</h3>
          <span class="episode-count">{{ props.mediaItem.collectionMovies.length }} 部电影</span>
        </div>
        <div class="episodes-grid">
          <div
            v-for="movie in props.mediaItem.collectionMovies"
            :key="movie.tmdbId || movie.id"
            class="episode-card"
            :class="{ active: movie.tmdbId === activeMediaItem.tmdbId }"
            @click="handleCollectionMovieSelect(movie)"
          >
            <div class="episode-thumbnail">
              <WatchedIndicator corner :watched="isMediaWatched(movie, mediaStore.watchedItems)" />
              <PosterRatingBadge :rating="movie.rating" :is-movie="true" />
              <img v-if="movie.posterUrl" :src="movie.posterUrl" :alt="movie.name" class="episode-image" @error="handleImageError" />
              <div v-else class="thumbnail-placeholder"><MediaPosterPlaceholder /></div>
            </div>
            <div class="episode-info">
              <div class="episode-title">{{ movie.name }}</div>
              <p class="episode-name">{{ movie.year || '未知年份' }} · {{ movie.driveFiles.length }} 个文件</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 季选择器（仅电视剧显示） -->
      <div v-if="activeMediaItem.type === 'tv' && availableSeasons.length > 1" class="season-selector">
        <div class="season-tabs">
          <a-button
            v-for="season in availableSeasons"
            :key="season.seasonNumber"
            :type="selectedSeason === season.seasonNumber ? 'primary' : 'secondary'"
            @click="handleSeasonChange(season.seasonNumber)"
          >
            第 {{ season.seasonNumber }} 季
          </a-button>
        </div>
      </div>

      <!-- 集列表（仅电视剧显示） -->
      <div v-if="activeMediaItem.type === 'tv' && currentSeasonEpisodes.length > 0" class="episodes-section">
        <div class="section-header">
          <h3>{{ currentSeason?.name || `第 ${selectedSeason} 季` }}</h3>
          <span class="episode-count">{{ currentSeasonEpisodes.length }} 集</span>
        </div>

        <div class="episodes-grid">
          <div
            v-for="episode in currentSeasonEpisodes"
            :key="episode.id"
            class="episode-card"
            :class="{ active: currentEpisode?.episodeNumber === episode.episodeNumber }"
          >
            <div class="episode-thumbnail">
              <WatchedIndicator corner :watched="mediaStore.isWatched(`${String(activeMediaItem.id).split('_').slice(0, -2).join('_') || activeMediaItem.id}_${episode.seasonNumber}_${episode.episodeNumber}`)" />
              <PosterRatingBadge :rating="episode.rating" :is-movie="false" />
              <img
                v-if="episode.stillPath || activeMediaItem.posterUrl"
                :src="episode.stillPath || activeMediaItem.posterUrl"
                :alt="`第 ${episode.episodeNumber} 集 ${episode.name}`"
                class="episode-image"
                @error="handleImageError"
                @click="handleEpisodePlay(episode)"
              />
              <div v-else class="thumbnail-placeholder">
                <MediaPosterPlaceholder kind="resume" />
              </div>
              <div v-if="episode.stillPath || activeMediaItem.posterUrl" class="thumbnail-placeholder" style="display: none;">
                <MediaPosterPlaceholder kind="resume" />
              </div>
              <button type="button" class="episode-play-overlay" :aria-label="`播放第 ${episode.episodeNumber} 集`" @click.stop="handleEpisodePlay(episode)">
                <Play :size="20" fill="currentColor" aria-hidden="true" />
              </button>
            </div>

            <div class="episode-info" @click="handleEpisodeSelect(episode)">
              <div class="episode-title">
                E{{ episode.episodeNumber }} · {{ episode.name }}
              </div>
              <p class="episode-name">{{ generalPreferences.hideSpoilers ? '' : episode.overview || '' }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 标签元数据：与演员区保持纵向信息层级 -->
      <div class="tags-section metadata-tags-section">
        <div v-if="activeMediaItem.genres && activeMediaItem.genres.length" class="tag-group">
          <h4 class="tag-group-title">类型</h4>
          <div class="tag-list">
            <span
              v-for="genre in activeMediaItem.genres"
              :key="genre"
              class="tag-item clickable"
              @click="handleTagClick('genre', genre)"
            >
              {{ genre }}
            </span>
          </div>
        </div>

        <div v-if="productionCompanies.length" class="tag-group">
          <h4 class="tag-group-title">工作室</h4>
          <div class="tag-list">
            <span
              v-for="company in productionCompanies"
              :key="company.id"
              class="tag-item clickable"
              @click="handleTagClick('studio', company.name)"
            >
              {{ company.name }}
            </span>
          </div>
        </div>

        <div v-if="activeMediaItem.year" class="tag-group">
          <h4 class="tag-group-title">制作年份</h4>
          <div class="tag-list">
            <span class="tag-item clickable" @click="handleTagClick('year', activeMediaItem.year)">
              {{ activeMediaItem.year }}s
            </span>
          </div>
        </div>

        <div v-if="productionCountries.length" class="tag-group">
          <h4 class="tag-group-title">地区</h4>
          <div class="tag-list">
            <span
              v-for="country in productionCountries"
              :key="country.iso31661"
              class="tag-item clickable"
              @click="handleTagClick('country', country.name)"
            >
              {{ country.name }}
            </span>
          </div>
        </div>
      </div>

      <!-- 演员列表 -->
      <div v-if="castList.length" class="cast-section">
        <div class="section-header">
          <h3>演员</h3>
          <span class="cast-count">{{ castList.length }} 位</span>
        </div>

        <div class="cast-list">
          <div v-for="cast in castList" :key="cast.id" class="cast-card" @click="handleCastClick(cast)">
            <div class="cast-avatar">
              <img
                v-if="cast.profile_path"
                :src="getCastAvatarUrl(cast.profile_path)"
                :alt="cast.name"
                class="cast-avatar-image"
              />
              <div v-else class="cast-avatar-placeholder">
                {{ getCastInitial(cast.name) }}
              </div>
            </div>
            <div class="cast-info">
              <div class="cast-name">{{ cast.name }}</div>
              <div v-if="cast.character" class="cast-role">饰 {{ cast.character }}</div>
            </div>
          </div>
        </div>
      </div>

      <section v-if="activePlaylistName && playlistItems?.length" class="detail-playlist-section">
        <h3>{{ activePlaylistName }}</h3>
        <div class="detail-playlist-rail">
          <button v-for="member in playlistItems" :key="member.id" type="button" class="detail-playlist-member"
            @click="emit('openPlaylistItem', member)">
            <img v-if="member.posterUrl" :src="member.posterUrl" :alt="member.name" />
            <MediaPosterPlaceholder v-else />
            <span class="detail-playlist-member-title">{{ member.name }}</span>
            <span v-if="member.type === 'tv'" class="detail-playlist-member-subtitle">{{ playlistMemberEpisodeLabel(member) }}</span>
            <span v-else-if="member.year" class="detail-playlist-member-subtitle">{{ member.year }}</span>
          </button>
        </div>
      </section>

      <section v-if="detailMediaInfoCards.length || selectedDriveFile" class="scraped-media-info-section">
        <div class="section-header scraped-media-info-header">
          <h3>媒体</h3>
        </div>
        <div v-if="selectedDriveFile" class="detail-file-bar">
          <div class="detail-file-source">在 {{ cloudDriveLabel(selectedDriveFile) }} 上</div>
          <div v-if="selectedDriveFile.path" class="detail-file-path" :title="selectedDriveFile.path">路径：{{ selectedDriveFile.path }}</div>
          <div class="detail-file-name" :title="selectedDriveFile.path">{{ selectedDriveFile.name }}</div>
          <div v-if="detailFileSummary" class="detail-file-meta">{{ detailFileSummary }}</div>
        </div>

        <div class="detail-media-card-rail">
          <article
            v-for="card in detailMediaInfoCards"
            :key="card.id"
            class="detail-media-card"
            :class="[{ selected: card.selected }, `detail-media-card-${card.kind}`]"
            :data-media-kind="card.kind"
          >
            <div v-if="card.selected" class="detail-media-card-selected-badge">
              <IconFont name="iconcheck" />
            </div>
            <div class="detail-media-card-title">
              <div class="detail-media-card-heading">
                <span class="detail-media-kind-badge">{{ card.kind === 'video' ? '影' : '字' }}</span>
                <span class="detail-media-card-title-text" :title="card.title">{{ card.title }}</span>
              </div>
            </div>
            <div class="detail-media-card-body">
              <div v-for="row in card.rows" :key="`${card.id}-${row.label}`" class="detail-media-row">
                <span>{{ row.label }}</span>
                <strong :title="row.value">{{ row.value }}</strong>
              </div>
            </div>
          </article>
        </div>
      </section>

    </div>

    <MediaMetadataEditorModal
      :defaults-to-whole-tv-series="false"
      :initial-episode-number="selectedEpisode"
      :initial-season-number="selectedSeason"
      :item="activeMediaItem"
      :visible="metadataEditorVisible"
      @close="metadataEditorVisible = false"
      @save="handleMetadataSave"
    />

    <!-- 播放列表 -->
    <MediaCollectionPicker
      :visible="showPlaylistModal"
      heading="播放列表"
      :item-title="playlistTarget?.title || ''"
      :rows="playlistRows"
      :editing="playlistEditing"
      v-model:name="playlistName"
      :error="playlistError"
      removable
      hint="选择播放列表，点击完成保存；取消不会修改当前条目的归属。"
      @close="showPlaylistModal = false"
      @done="savePlaylistSelection"
      @create="startPlaylistName()"
      @rename="startPlaylistName"
      @toggle="handleTogglePlaylistItem"
      @remove="handleRemovePlaylist"
      @cancel-name="playlistEditing = null; playlistError = ''"
      @confirm-name="confirmPlaylistName"
    />
    <MediaAcquisitionTargetModal
      v-if="activeAcquisitionRequest"
      :visible="acquisitionVisible"
      :request="activeAcquisitionRequest"
      @created="handleAcquisitionCreated"
      @update:visible="acquisitionVisible = $event"
    />
  </div>
</template>

<style scoped lang="less">
.detail-playlist-section { margin: 32px 0; }
.detail-playlist-section h3 { margin: 0 0 16px; font-size: 20px; }
.detail-playlist-rail { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 12px; }
.detail-playlist-member { flex: 0 0 136px; min-width: 0; border: 0; background: none; color: inherit; text-align: left; cursor: pointer; padding: 0; }
.detail-playlist-member img { width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 10px; }
.detail-playlist-member-title, .detail-playlist-member-subtitle { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 5px; }
.detail-playlist-member-subtitle { color: var(--color-text-3, #999); }

.content-certification {
  display: inline-block;
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0 4px;
  font-size: 0.85em;
  font-weight: 600;
  line-height: 1.2;
}
.media-detail {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 18% 0%, rgba(223, 188, 152, 0.34) 0%, rgba(223, 188, 152, 0) 34%),
    radial-gradient(circle at 82% 0%, rgba(164, 191, 222, 0.36) 0%, rgba(164, 191, 222, 0) 36%),
    linear-gradient(180deg, rgba(244, 237, 229, 0.3) 0%, rgba(236, 241, 246, 0.34) 34%, rgba(233, 238, 243, 0.48) 60%, rgba(231, 236, 241, 0.62) 100%);
  backdrop-filter: blur(18px) saturate(128%);
  -webkit-backdrop-filter: blur(18px) saturate(128%);
  color: #1d2433;
}

.detail-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 20px 40px;
}
.detail-header-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; margin-left: auto }
#xbybody .media-detail .detail-header-actions .action-button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: auto;
  min-width: 38px;
  height: 38px;
  padding: 0 9px;
}
#xbybody .media-detail .detail-header-actions .action-button > svg { flex: 0 0 auto }
#xbybody .media-detail .detail-header-actions > .action-button {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}

.detail-back {
  height: 46px;
  padding: 0 18px;
  max-width: min(420px, calc(100vw - 80px));
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.36);
  box-shadow: 0 10px 30px rgba(130, 137, 152, 0.18);
  backdrop-filter: blur(26px) saturate(165%);
  -webkit-backdrop-filter: blur(26px) saturate(165%);
  color: #253045;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.detail-back i {
  font-size: 16px;
  flex-shrink: 0;
}

.detail-back-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-back:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 36px rgba(130, 137, 152, 0.22);
  background: rgba(255, 255, 255, 0.46);
}

.detail-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  background: transparent;
  scrollbar-width: thin;
  scrollbar-color: rgba(147, 154, 168, 0.4) transparent;
}

.detail-content::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 520px;
  bottom: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 16% 0%, rgba(223, 188, 152, 0.3) 0%, rgba(223, 188, 152, 0) 30%),
    radial-gradient(circle at 78% 0%, rgba(164, 191, 222, 0.34) 0%, rgba(164, 191, 222, 0) 34%),
    linear-gradient(180deg, rgba(244, 238, 231, 0.12) 0%, rgba(236, 241, 246, 0.22) 24%, rgba(233, 238, 243, 0.34) 54%, rgba(232, 236, 241, 0.48) 100%);
  filter: blur(30px);
  z-index: 0;
}

.detail-content::-webkit-scrollbar {
  width: 6px;
}

.detail-content::-webkit-scrollbar-thumb {
  background: rgba(147, 154, 168, 0.4);
  border-radius: 999px;
}

.hero-section {
  position: relative;
  min-height: 940px;
  padding: 210px 0 34px;
  overflow: hidden;
}

.hero-section::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(10, 16, 28, 0.14) 0%, rgba(16, 22, 34, 0.08) 22%, rgba(255, 255, 255, 0.14) 54%, rgba(245, 247, 249, 0.42) 78%, rgba(244, 246, 249, 0.72) 100%),
    radial-gradient(circle at 36% 56%, rgba(255, 255, 255, 0.32) 0%, rgba(255, 255, 255, 0) 26%),
    radial-gradient(circle at 32% 74%, rgba(255, 255, 255, 0.44) 0%, rgba(255, 255, 255, 0) 34%),
    radial-gradient(circle at 54% 88%, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0) 34%);
  pointer-events: none;
}

.hero-section::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -60px;
  height: 320px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, rgba(243, 245, 248, 0.24) 36%, rgba(238, 242, 246, 0.66) 100%),
    radial-gradient(circle at 24% 18%, rgba(223, 188, 152, 0.34) 0%, rgba(223, 188, 152, 0) 30%),
    radial-gradient(circle at 76% 8%, rgba(164, 191, 222, 0.36) 0%, rgba(164, 191, 222, 0) 36%);
  filter: blur(56px);
  pointer-events: none;
}

.hero-content {
  position: absolute;
  z-index: 1;
  width: min(1880px, calc(100% - 80px));
  left: 50%;
  bottom: 78px;
  transform: translateX(-50%);
  margin: 0;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 30px;
  align-items: end;
}

.hero-poster {
  position: relative;
  width: 280px;
  aspect-ratio: 2 / 3;
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 26px 64px rgba(34, 43, 58, 0.18);
  background: rgba(18, 24, 36, 0.08);
}

.hero-poster img,
.poster-placeholder {
  width: 100%;
  height: 100%;
}

.poster-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.72) 0%, rgba(232, 235, 240, 0.92) 100%);
  color: rgba(77, 87, 104, 0.7);
}

.poster-placeholder .iconfont {
  font-size: 60px;
}

.hero-info {
  min-height: 470px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 14px;
  color: #1b2232;
  max-width: 1040px;
  text-rendering: geometricPrecision;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.hero-title {
  margin: 0;
  font-size: clamp(34px, 4.2vw, 62px);
  line-height: 1.08;
  font-weight: 900;
  letter-spacing: -0.03em;
  color: rgba(10, 15, 24, 0.98);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.16);
}

.hero-logo {
  display: block;
  width: min(430px, 72%);
  max-height: 130px;
  object-fit: contain;
  object-position: left center;
}

.hero-episode-title {
  font-size: clamp(18px, 1.45vw, 28px);
  line-height: 1.28;
  font-weight: 780;
}

.hero-meta,
.hero-meta-secondary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  color: rgba(18, 24, 35, 0.9);
}

.hero-meta {
  font-size: 16px;
  font-weight: 700;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.12);
}

.meta-rating {
  color: #0f172a;
}

.meta-divider {
  color: rgba(15, 23, 42, 0.35);
}

.hero-meta-secondary {
  font-size: 16px;
  font-weight: 800;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.12);
}

.hero-meta-secondary span + span::before {
  content: '·';
  margin-right: 8px;
  color: rgba(15, 23, 42, 0.35);
}

.coverage-alert {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  max-width: 100%;
  padding: 9px 12px;
  border: 1px solid rgba(210, 132, 20, 0.26);
  border-radius: 10px;
  background: rgba(255, 244, 220, 0.72);
  color: #6f4309;
  backdrop-filter: blur(12px);
}

.coverage-alert-icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #f5a524;
  color: #291a05;
  font-size: 13px;
  font-weight: 900;
}

.coverage-alert div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.coverage-alert strong { font-size: 13px; }
.coverage-alert div span { overflow: hidden; color: rgba(111, 67, 9, 0.76); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }

.hero-overview {
  max-width: 980px;
  margin: 0;
  font-size: 15px;
  line-height: 1.72;
  color: rgba(12, 18, 28, 0.9);
  font-weight: 600;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.14);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hero-actions {
  margin-top: 8px;
  width: 340px;
  min-width: 340px;
  max-width: 100%;
}

.actions-stack {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.play-episode-info {
  font-size: 13px;
  line-height: 1.5;
  color: rgba(15, 23, 42, 0.72);
  font-weight: 600;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.14);
}

.action-buttons {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
}

.action-button,
.play-button,
.download-button {
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: rgba(250, 245, 240, 0.52);
  box-shadow: 0 12px 30px rgba(63, 46, 37, 0.1);
  backdrop-filter: blur(18px) saturate(135%);
  -webkit-backdrop-filter: blur(18px) saturate(135%);
  overflow: hidden;
  position: relative;
  cursor: pointer;
}

.action-button {
  height: 62px;
  padding: 0;
  border-radius: 18px;
  color: rgba(22, 22, 22, 0.92);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.action-button.active {
  background: rgba(240, 235, 230, 0.74);
}

.action-glyph {
  font-size: 22px;
  line-height: 1;
  font-weight: 800;
}

.play-button {
  width: 100%;
  min-width: 0;
  height: 62px;
  padding: 0 28px;
  border-radius: 20px;
  color: #fff;
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.96), rgba(59, 130, 246, 0.88));
  border-color: rgba(96, 165, 250, 0.38);
  box-shadow: 0 22px 42px rgba(24, 70, 166, 0.32);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.play-button:hover {
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.98), rgba(96, 165, 250, 0.9));
  border-color: rgba(147, 197, 253, 0.48);
  box-shadow: 0 26px 52px rgba(24, 70, 166, 0.42);
}

.download-button {
  width: 100%;
  min-width: 0;
  height: 52px;
  border-radius: 18px;
  color: rgba(22, 22, 22, 0.92);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 800;
}

.download-button:hover {
  background: rgba(250, 245, 240, 0.66);
  border-color: rgba(255, 255, 255, 0.86);
  box-shadow: 0 16px 34px rgba(63, 46, 37, 0.14);
}


:global(.detail-more-action-popup) {
  min-width: 210px;
  padding: 6px !important;
  border: 1px solid var(--color-border-2);
  border-radius: 8px !important;
  background: var(--color-bg-popup) !important;
  box-shadow: 0 16px 38px rgba(0, 0, 0, 0.28) !important;
}

.detail-more-action-menu {
  display: grid;
  min-width: 210px;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
  gap: 2px;
}

.detail-more-action-item {
  display: flex;
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  gap: 9px;
  align-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-1);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}

.detail-more-action-item:hover {
  background: var(--color-fill-2);
}

.detail-more-action-item > span {
  flex: 1 0 auto;
  white-space: nowrap;
}

.detail-more-action-item > svg {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  color: #ff8700;
}

.detail-more-action-item > span:only-child {
  padding-left: 29px;
}

.detail-more-action-item.accent,
.detail-more-action-item.accent > span:first-child {
  color: #d89222;
}

.detail-more-action-divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--color-border-2);
}

.play-button-progress {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, rgba(15, 47, 99, 0.96) 0%, rgba(49, 95, 158, 0.9) 100%);
}

.play-button-label {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.01em;
}

.play-glyph {
  font-size: 15px;
  line-height: 1;
}

.season-selector,
.episodes-section,
.cast-section,
.tags-section {
  width: min(1880px, calc(100% - 80px));
  margin: 0 auto;
  padding: 0 0 32px;
  position: relative;
  z-index: 1;
  background: transparent;
}

.season-selector,
.episodes-section,
.cast-section {
  margin-top: 12px;
}

.tags-section {
  margin-top: 12px;
  margin-bottom: 28px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.section-header h3,
.tag-group-title {
  margin: 0 0 16px;
  font-size: 28px;
  font-weight: 800;
  color: rgba(20, 28, 40, 0.96);
  letter-spacing: -0.02em;
}

.section-header h3 {
  margin-bottom: 0;
}

.section-header .more-link,
.episode-count,
.cast-count {
  font-size: 14px;
  color: rgba(94, 103, 119, 0.78);
}

.season-tabs {
  display: none;
}

.episodes-grid {
  display: flex;
  flex-wrap: nowrap;
  gap: 18px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 2px 2px 12px;
  scroll-padding-inline: 2px;
}

.episode-card {
  flex: 0 0 320px;
  width: 320px;
  min-width: 320px;
  border-radius: 28px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.58);
  box-shadow: 0 12px 34px rgba(159, 168, 181, 0.16);
  backdrop-filter: blur(24px) saturate(155%);
  -webkit-backdrop-filter: blur(24px) saturate(155%);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.episode-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 18px 40px rgba(159, 168, 181, 0.22);
}

.episode-card.active {
  border-color: rgba(35, 46, 63, 0.16);
  box-shadow: 0 20px 48px rgba(123, 132, 145, 0.24);
}

.episode-thumbnail {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 22px;
  overflow: hidden;
  background: rgba(229, 232, 238, 0.9);
}

.episode-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.25s ease;
}

.episode-card:hover .episode-image {
  transform: scale(1.03);
}

.thumbnail-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(250, 250, 251, 0.9) 0%, rgba(233, 236, 241, 0.95) 100%);
}

.episode-number {
  font-size: 20px;
  font-weight: 800;
  color: rgba(88, 98, 116, 0.92);
}

.episode-play-overlay {
  position: absolute;
  inset: auto auto 14px 14px;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 10px 26px rgba(89, 96, 110, 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.94;
}

.episode-play-overlay .iconfont {
  font-size: 18px;
  color: #162131;
}

.episode-info {
  padding: 14px 8px 6px;
}

.episode-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 700;
  color: rgba(23, 31, 45, 0.96);
}

.episode-name {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(94, 103, 119, 0.88);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cast-list {
  display: flex;
  gap: 18px;
  overflow-x: auto;
  padding-bottom: 8px;
}

.cast-card {
  flex: 0 0 156px;
  padding: 18px 16px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.56);
  box-shadow: 0 12px 34px rgba(159, 168, 181, 0.15);
  backdrop-filter: blur(24px) saturate(155%);
  -webkit-backdrop-filter: blur(24px) saturate(155%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.cast-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 18px 40px rgba(159, 168, 181, 0.22);
}

.cast-avatar {
  width: 92px;
  height: 92px;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(232, 235, 241, 0.94);
}

.cast-avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cast-avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(87, 97, 114, 0.9);
  font-size: 30px;
  font-weight: 800;
}

.cast-info {
  width: 100%;
  text-align: center;
}

.cast-name {
  font-size: 15px;
  font-weight: 700;
  color: rgba(23, 31, 45, 0.96);
}

.cast-role {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.45;
  color: rgba(102, 111, 127, 0.88);
}

.tag-group {
  margin-bottom: 26px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.tag-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 20px;
  border-radius: 18px;
  background: rgba(250, 245, 240, 0.52);
  border: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow: 0 12px 30px rgba(63, 46, 37, 0.1);
  color: rgba(17, 24, 39, 0.94);
  font-size: 15px;
  font-weight: 700;
  backdrop-filter: blur(18px) saturate(135%);
  -webkit-backdrop-filter: blur(18px) saturate(135%);
  transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.tag-item.clickable {
  cursor: pointer;
}

.tag-item.clickable:hover {
  transform: translateY(-1px);
  background: rgba(255, 250, 245, 0.68);
  box-shadow: 0 14px 30px rgba(63, 46, 37, 0.14);
}







.playlist-modal :deep(.arco-modal) {
  width: 620px;
  max-width: calc(100vw - 40px);
}

.playlist-modal :deep(.arco-modal-content) {
  border-radius: 28px;
  background:
    radial-gradient(circle at 72% 8%, rgba(0, 245, 212, 0.08), transparent 28%),
    radial-gradient(circle at 12% 72%, rgba(36, 66, 255, 0.1), transparent 34%),
    var(--app-mineradio-bg, #08090b);
  border: 1px solid var(--app-glass-line, rgba(255, 255, 255, 0.08));
  box-shadow:
    0 28px 60px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}

.playlist-modal :deep(.arco-modal-header) {
  border-bottom: 1px solid var(--app-glass-line, rgba(255, 255, 255, 0.06));
}

.playlist-modal :deep(.arco-modal-title) {
  color: var(--app-mineradio-ink, #e8ecef);
}

.playlist-manager-panel {
  padding: 8px 4px 2px;
}

.home-library-manager-hint {
  margin: 0 0 14px 8px;
  color: var(--app-mineradio-ink, #e8ecef);
  opacity: 0.56;
  font-size: 14px;
  font-weight: 500;
}

.playlist-create {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  margin-bottom: 16px;
}

.playlist-modal :deep(.arco-input-wrapper) {
  min-height: 40px;
  border-radius: 12px;
  background: var(--app-glass-panel, rgba(255, 255, 255, 0.06));
  border-color: var(--app-glass-line, rgba(255, 255, 255, 0.08));
  color: var(--app-mineradio-ink, #e8ecef);
}

.playlist-modal :deep(.arco-input) {
  color: var(--app-mineradio-ink, #e8ecef);
  font-weight: 600;
}

.playlist-modal :deep(.arco-input::placeholder) {
  color: color-mix(in srgb, var(--app-mineradio-ink, #e8ecef) 48%, transparent);
}

.playlist-modal :deep(.arco-btn) {
  min-height: 40px;
  border-radius: 12px;
  font-weight: 700;
}

.playlist-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 8px 18px;
  border-radius: 16px;
  border: 1px solid var(--app-glass-line, rgba(255, 255, 255, 0.06));
  background: var(--app-glass-panel, rgba(255, 255, 255, 0.06));
  min-height: 240px;
}

.playlist-row {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 0;
  border-bottom: 1px solid var(--app-glass-line, rgba(255, 255, 255, 0.05));
  color: var(--app-mineradio-ink, #e8ecef);
}

.playlist-row:last-child {
  border-bottom: 0;
}

.playlist-checkbox {
  flex: 1;
  min-width: 0;
}

.playlist-modal :deep(.arco-checkbox-label) {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--app-mineradio-ink, #e8ecef);
  font-size: 15px;
  font-weight: 700;
}

.playlist-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-count,
.playlist-empty {
  color: var(--app-mineradio-ink, #e8ecef);
  opacity: 0.48;
}

.playlist-empty {
  padding: 56px 12px;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
}

.playlist-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

[arco-theme='dark'] .media-detail {
  background:
    radial-gradient(circle at 18% 0%, rgba(72, 88, 108, 0.2) 0%, rgba(72, 88, 108, 0) 34%),
    radial-gradient(circle at 82% 0%, rgba(42, 73, 116, 0.18) 0%, rgba(42, 73, 116, 0) 36%),
    linear-gradient(180deg, #0f141c 0%, #0b1017 100%);
  color: rgba(233, 239, 247, 0.92);
}

[arco-theme='dark'] .detail-back {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(233, 239, 247, 0.92);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
}

[arco-theme='dark'] .detail-back:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.98);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.34);
}

[arco-theme='dark'] .detail-content {
  scrollbar-color: rgba(128, 144, 166, 0.42) transparent;
}

[arco-theme='dark'] .detail-content::before {
  background:
    radial-gradient(circle at 16% 0%, rgba(72, 88, 108, 0.2) 0%, rgba(72, 88, 108, 0) 32%),
    radial-gradient(circle at 78% 0%, rgba(42, 73, 116, 0.18) 0%, rgba(42, 73, 116, 0) 34%),
    linear-gradient(180deg, rgba(18, 25, 34, 0.08) 0%, rgba(18, 25, 34, 0.18) 42%, rgba(10, 14, 20, 0.76) 100%);
}

[arco-theme='dark'] .detail-content::-webkit-scrollbar-thumb {
  background: rgba(128, 144, 166, 0.42);
}

[arco-theme='dark'] .hero-section::before {
  background:
    linear-gradient(180deg, rgba(0, 0, 0, 0.1) 0%, rgba(8, 12, 18, 0.2) 34%, rgba(10, 14, 20, 0.52) 70%, rgba(10, 14, 20, 0.9) 100%),
    radial-gradient(circle at 36% 56%, rgba(90, 112, 142, 0.14) 0%, rgba(90, 112, 142, 0) 26%),
    radial-gradient(circle at 32% 74%, rgba(56, 68, 86, 0.22) 0%, rgba(56, 68, 86, 0) 34%);
}

[arco-theme='dark'] .hero-section::after {
  background:
    linear-gradient(180deg, rgba(10, 14, 20, 0.02) 0%, rgba(10, 14, 20, 0.28) 38%, rgba(10, 14, 20, 0.92) 100%),
    radial-gradient(circle at 24% 18%, rgba(72, 88, 108, 0.28) 0%, rgba(72, 88, 108, 0) 30%),
    radial-gradient(circle at 76% 8%, rgba(42, 73, 116, 0.24) 0%, rgba(42, 73, 116, 0) 36%);
}

[arco-theme='dark'] .hero-poster,
[arco-theme='dark'] .episode-thumbnail,
[arco-theme='dark'] .cast-avatar {
  background: rgba(18, 24, 36, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.24);
}

[arco-theme='dark'] .poster-placeholder,
[arco-theme='dark'] .thumbnail-placeholder {
  background: linear-gradient(180deg, rgba(28, 32, 42, 0.96), rgba(20, 24, 33, 0.94));
  color: rgba(191, 201, 216, 0.68);
}

[arco-theme='dark'] .hero-title,
[arco-theme='dark'] .section-header h3,
[arco-theme='dark'] .tag-group-title,
[arco-theme='dark'] .episode-title,
[arco-theme='dark'] .cast-name,
[arco-theme='dark'] .playlist-title {
  color: rgba(244, 247, 252, 0.96);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.32);
}

[arco-theme='dark'] .hero-meta,
[arco-theme='dark'] .hero-meta-secondary,
[arco-theme='dark'] .meta-rating,
[arco-theme='dark'] .play-episode-info,
[arco-theme='dark'] .section-header .more-link,
[arco-theme='dark'] .episode-count,
[arco-theme='dark'] .cast-count,
[arco-theme='dark'] .episode-name,
[arco-theme='dark'] .cast-role,
[arco-theme='dark'] .playlist-subtitle,
[arco-theme='dark'] .playlist-count,
[arco-theme='dark'] .playlist-empty {
  color: rgba(191, 201, 216, 0.78);
  text-shadow: none;
}

[arco-theme='dark'] .hero-overview {
  color: rgba(230, 236, 244, 0.9);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.22);
}

[arco-theme='dark'] .coverage-alert {
  border-color: rgba(245, 165, 36, 0.28);
  background: rgba(43, 27, 8, 0.72);
  color: #ffd18a;
}

[arco-theme='dark'] .coverage-alert div span {
  color: rgba(255, 209, 138, 0.72);
}

[arco-theme='dark'] .hero-meta-secondary span + span::before,
[arco-theme='dark'] .meta-divider {
  color: rgba(191, 201, 216, 0.38);
}

[arco-theme='dark'] .action-button,
[arco-theme='dark'] .download-button,
[arco-theme='dark'] .episode-card,
[arco-theme='dark'] .cast-card,
[arco-theme='dark'] .tag-item {
  background: linear-gradient(180deg, rgba(28, 32, 42, 0.96), rgba(20, 24, 33, 0.94));
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.28);
}

[arco-theme='dark'] .action-button,
[arco-theme='dark'] .download-button,
[arco-theme='dark'] .tag-item {
  color: rgba(233, 239, 247, 0.92);
}

[arco-theme='dark'] .action-button.active,
[arco-theme='dark'] .episode-card.active {
  border-color: rgba(96, 165, 250, 0.34);
  background: linear-gradient(180deg, rgba(34, 56, 92, 0.95), rgba(28, 45, 76, 0.92));
  box-shadow: 0 22px 42px rgba(24, 70, 166, 0.28);
}

[arco-theme='dark'] .tag-item.clickable:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.16);
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.3);
}

[arco-theme='dark'] .episode-play-overlay {
  background: rgba(18, 22, 30, 0.84);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.32);
}

[arco-theme='dark'] .episode-play-overlay .iconfont,
[arco-theme='dark'] .episode-number,
[arco-theme='dark'] .cast-avatar-placeholder {
  color: rgba(233, 239, 247, 0.9);
}




[arco-theme='dark'] .download-button:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.16);
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.3);
}

@media (max-width: 1180px) {
  .hero-section {
    min-height: 700px;
    padding-top: 144px;
  }

  .hero-content {
    margin-top: 56px;
    grid-template-columns: 1fr;
    align-items: start;
  }

  .hero-poster {
    width: 240px;
  }

  .hero-info {
    min-height: auto;
    max-width: none;
  }
}

@media (max-width: 768px) {
  .detail-header {
    padding: 16px 20px;
  }

  .hero-section,
  .season-selector,
  .episodes-section,
  .cast-section,
  .tags-section {
    width: calc(100% - 32px);
  }

  .hero-section {
    min-height: auto;
    padding-top: 120px;
    padding-bottom: 8px;
  }

  .hero-content {
    margin-top: 36px;
    width: 100%;
  }

  .hero-poster {
    width: 200px;
  }

  .hero-title {
    font-size: 34px;
  }

  .action-buttons {
    flex-wrap: wrap;
  }

  .episodes-grid {
    padding-bottom: 12px;
  }

  .episode-card {
    flex-basis: min(320px, 86vw);
    width: min(320px, 86vw);
    min-width: min(320px, 86vw);
  }

}

</style>

<style lang="less">
/* Cinematic scraped-media detail, aligned with the media-server detail view. */
#xbybody .media-detail {
  --scraped-detail-surface: #191919;
  --scraped-detail-soft: #2f2f2f;
  --scraped-detail-copy: rgba(255, 255, 255, 0.94);
  --scraped-detail-muted: rgba(255, 255, 255, 0.62);
  --scraped-detail-accent: #ff7a00;
  color: var(--scraped-detail-copy) !important;
  background: var(--scraped-detail-surface) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

#xbybody .media-detail .detail-content {
  color: var(--scraped-detail-copy);
  background: var(--scraped-detail-surface) !important;
}

#xbybody .media-detail .detail-content::before {
  display: none !important;
}

#xbybody .media-detail .detail-header {
  height: 54px;
  padding: 0 12px;
  background: #191919;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

#xbybody .media-detail .detail-back,
[arco-theme='dark'] #xbybody .media-detail .detail-back {
  height: 54px;
  max-width: min(520px, calc(100vw - 80px));
  padding: 0;
  gap: 12px;
  border: 0;
  border-radius: 0;
  color: var(--scraped-detail-copy);
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

#xbybody .media-detail .detail-back:hover {
  transform: none;
  color: #fff;
  background: transparent;
  box-shadow: none;
}

#xbybody .media-detail .detail-back > .iconfont-svg {
  width: 38px;
  height: 38px;
  padding: 9px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  background: #222;
}

#xbybody .media-detail .hero-section {
  min-height: max(620px, calc(100vh - 140px));
  padding: 54px 0 0;
  background-position: center 10% !important;
  background-color: #242424 !important;
}

#xbybody .media-detail .hero-section::before,
[arco-theme='dark'] #xbybody .media-detail .hero-section::before {
  z-index: 0;
  background:
    linear-gradient(90deg, rgba(12, 12, 12, 0.16) 0%, rgba(12, 12, 12, 0.04) 48%, rgba(12, 12, 12, 0.14) 100%),
    linear-gradient(180deg, rgba(12, 12, 12, 0.01) 0%, rgba(19, 19, 19, 0.03) 64%, rgba(25, 25, 25, 0.7) 87%, #191919 100%) !important;
}

#xbybody .media-detail .hero-section::after,
[arco-theme='dark'] #xbybody .media-detail .hero-section::after {
  left: 0;
  right: 0;
  bottom: -1px;
  height: 32%;
  filter: none;
  background: linear-gradient(180deg, transparent 0%, rgba(25, 25, 25, 0.38) 54%, #191919 100%) !important;
}

#xbybody .media-detail .hero-content {
  width: calc(100% - 68px);
  left: 34px;
  bottom: 12px;
  transform: none;
  display: block;
}

#xbybody .media-detail .hero-poster {
  display: none;
}

#xbybody .media-detail .hero-info {
  width: 100%;
  max-width: none;
  min-height: 242px;
  display: grid;
  grid-template-columns: minmax(232px, 280px) minmax(0, 1fr);
  grid-template-rows: auto;
  column-gap: 34px;
  row-gap: 9px;
  align-items: end;
  color: var(--scraped-detail-copy);
}

#xbybody .media-detail .hero-copy {
  grid-column: 2;
  grid-row: 1;
  align-self: end;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
#xbybody .media-detail .hero-copy .hero-meta { order: 5; align-self: stretch; }

#xbybody .media-detail .hero-title,
#xbybody .media-detail .hero-logo,
#xbybody .media-detail .hero-episode-title,
#xbybody .media-detail .hero-meta,
#xbybody .media-detail .hero-meta-secondary,
#xbybody .media-detail .hero-overview,
#xbybody .media-detail .coverage-alert {
  grid-column: 2;
  margin: 0;
}

#xbybody .media-detail .hero-title {
  grid-row: 1;
  font-size: clamp(18px, 1.45vw, 28px);
  line-height: 1.28;
  font-weight: 780;
  letter-spacing: 0;
  color: var(--scraped-detail-copy) !important;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.52) !important;
}

#xbybody .media-detail .hero-logo,
#xbybody .media-detail .hero-episode-title {
  grid-column: 2;
  grid-row: 1;
  /* These are now children of the column-flex hero-copy, not hero-info's grid. */
  align-self: flex-start;
}

#xbybody .media-detail .hero-copy .hero-episode-title {
  max-width: 100%;
  text-align: left;
  overflow-wrap: anywhere;
}

#xbybody .media-detail .hero-meta {
  grid-row: 5;
  align-self: end;
  gap: 9px;
  min-height: 24px;
  color: var(--scraped-detail-muted) !important;
  font-size: 13px;
  font-weight: 650;
  text-shadow: none;
}

#xbybody .media-detail .meta-rating {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: rgba(255, 255, 255, 0.82) !important;
}

#xbybody .media-detail .meta-rating-logo {
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex: 0 0 24px;
}

#xbybody .media-detail .hero-meta-secondary {
  grid-row: 2;
  gap: 8px;
  color: var(--scraped-detail-muted) !important;
  font-size: 12px;
  font-weight: 650;
  text-shadow: none;
}

#xbybody .media-detail .hero-meta-secondary span + span::before {
  color: rgba(255, 255, 255, 0.3) !important;
}

#xbybody .media-detail .hero-overview {
  grid-row: 3;
  max-width: 1280px;
  color: rgba(255, 255, 255, 0.84) !important;
  font-size: 13px;
  line-height: 1.55;
  font-weight: 520;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5) !important;
}

#xbybody .media-detail .coverage-alert {
  grid-row: 4;
  padding: 7px 10px;
  border-color: rgba(255, 176, 62, 0.26);
  border-radius: 8px;
  color: #ffd18a;
  background: rgba(43, 27, 8, 0.64);
}

#xbybody .media-detail .hero-actions {
  grid-column: 1;
  grid-row: 1;
  align-self: end;
  width: 100%;
  min-width: 0;
  max-width: none;
  margin: 0;
}

#xbybody .media-detail .hero-brand-title {
  min-height: 74px;
  margin-bottom: 18px;
  display: flex;
  align-items: flex-end;
  color: #fff;
  font-size: clamp(22px, 2vw, 34px);
  line-height: 1.08;
  font-weight: 900;
  text-shadow: 0 8px 24px rgba(0, 0, 0, 0.56);
}

#xbybody .media-detail .actions-stack {
  gap: 12px;
}

#xbybody .media-detail .play-episode-info {
  display: none;
}

#xbybody .media-detail .play-row {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 46px;
  align-items: center;
  gap: 10px;
}

#xbybody .media-detail .play-button {
  width: 100%;
  height: 46px;
  min-height: 46px;
  padding: 0 22px;
  border: 0;
  border-radius: 999px;
  color: rgba(25, 25, 25, 0.9);
  background: rgba(231, 231, 235, 0.76);
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

#xbybody .media-detail .play-button:hover {
  color: #111;
  background: rgba(255, 255, 255, 0.92);
  border-color: transparent;
  box-shadow: none;
}

#xbybody .media-detail .play-button-label {
  font-size: 14px;
  font-weight: 780;
}

#xbybody .media-detail .play-button-progress {
  background: rgba(235, 239, 240, 0.42);
  border-right: 1px solid rgba(255, 255, 255, 0.3);
  pointer-events: none;
}

#xbybody .media-detail .play-button.has-resume {
  color: #fff;
  background: rgba(150, 157, 160, 0.5);
  isolation: isolate;
}

#xbybody .media-detail .version-button {
  width: 46px;
  height: 46px;
  min-width: 46px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(62, 62, 62, 0.94);
  cursor: pointer;
}

#xbybody .media-detail .version-button:hover {
  color: #fff;
  background: #505050;
}

#xbybody .media-detail .version-button[disabled] {
  opacity: 0.52;
  cursor: default;
}

#xbybody .media-detail .version-button > .iconfont-svg {
  width: 18px;
  height: 18px;
}

#xbybody .media-detail .action-buttons {
  width: 100%;
  max-width: 100%;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
}

#xbybody .media-detail .action-button,
[arco-theme='dark'] #xbybody .media-detail .action-button {
  width: 100%;
  height: 44px;
  min-width: 0;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.86);
  background: rgba(49, 49, 49, 0.94);
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

#xbybody .media-detail .action-button:hover,
#xbybody .media-detail .action-button.active {
  color: #fff;
  background: #414141;
  border-color: rgba(255, 255, 255, 0.2);
}

#xbybody .media-detail .action-button > .iconfont-svg {
  width: 18px;
  height: 18px;
}

#xbybody .media-detail .download-button {
  display: none;
}

#xbybody .media-detail .season-selector,
#xbybody .media-detail .episodes-section,
#xbybody .media-detail .cast-section,
#xbybody .media-detail .tags-section {
  width: calc(100% - 68px);
  margin: 0 auto;
  padding: 16px 0 8px;
  color: var(--scraped-detail-copy);
  background: var(--scraped-detail-surface);
}

#xbybody .media-detail .section-header {
  justify-content: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}

#xbybody .media-detail .section-header h3,
#xbybody .media-detail .tag-group-title {
  margin: 0;
  color: var(--scraped-detail-copy) !important;
  font-size: 14px;
  line-height: 1.4;
  font-weight: 760;
  letter-spacing: 0;
  text-shadow: none;
}

#xbybody .media-detail .episode-count,
#xbybody .media-detail .cast-count,
#xbybody .media-detail .more-link {
  color: var(--scraped-detail-muted) !important;
  font-size: 11px;
}

#xbybody .media-detail .episodes-grid {
  gap: 14px;
  padding: 2px 2px 10px;
}

#xbybody .media-detail .episode-card,
[arco-theme='dark'] #xbybody .media-detail .episode-card {
  flex: 0 0 180px;
  width: 180px;
  min-width: 180px;
  padding: 0;
  border: 0;
  border-radius: 0;
  color: var(--scraped-detail-copy);
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

#xbybody .media-detail .episode-card:hover {
  transform: none;
  box-shadow: none;
}

#xbybody .media-detail .episode-thumbnail {
  border-radius: 14px;
  background: #252525;
  box-shadow: none;
}

#xbybody .media-detail .episode-card.active .episode-thumbnail {
  outline: 3px solid var(--scraped-detail-accent);
  outline-offset: -3px;
}

#xbybody .media-detail .episode-play-overlay {
  display: flex;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.4);
  color: white;
  background: rgba(0, 0, 0, 0.48);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
  cursor: pointer;
}

#xbybody .media-detail .episode-play-overlay:hover,
#xbybody .media-detail .episode-play-overlay:focus-visible {
  background: rgba(0, 0, 0, 0.72);
  outline: 2px solid white;
  outline-offset: 2px;
}

#xbybody .media-detail .episode-play-overlay svg {
  margin-left: 2px;
}

#xbybody .media-detail .episode-info {
  padding: 8px 2px 2px;
}

#xbybody .media-detail .episode-title {
  margin: 0 0 4px;
  color: rgba(255, 255, 255, 0.86) !important;
  font-size: 11px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#xbybody .media-detail .episode-name {
  color: rgba(255, 255, 255, 0.48) !important;
  font-size: 10px;
  line-height: 1.4;
  -webkit-line-clamp: 1;
}

#xbybody .media-detail .cast-list {
  gap: 14px;
  padding-bottom: 8px;
}

#xbybody .media-detail .cast-card,
[arco-theme='dark'] #xbybody .media-detail .cast-card {
  flex: 0 0 72px;
  width: 72px;
  padding: 0;
  gap: 7px;
  align-items: flex-start;
  border: 0;
  border-radius: 0;
  color: var(--scraped-detail-copy);
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

#xbybody .media-detail .cast-card:hover {
  transform: none;
  box-shadow: none;
}

#xbybody .media-detail .cast-avatar {
  width: 72px;
  height: 72px;
  border-radius: 16px;
  background: #252525;
  box-shadow: none;
}

#xbybody .media-detail .cast-info {
  text-align: left;
}

#xbybody .media-detail .cast-name {
  color: rgba(255, 255, 255, 0.86) !important;
  font-size: 11px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#xbybody .media-detail .cast-role {
  margin-top: 2px;
  color: rgba(255, 255, 255, 0.48) !important;
  font-size: 10px;
  line-height: 1.35;
}

#xbybody .media-detail .tags-section {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 22px;
  padding-top: 20px;
  padding-bottom: 30px;
}

#xbybody .media-detail .metadata-tags-section {
  flex-direction: column;
  flex-wrap: nowrap;
  align-items: stretch;
  gap: 18px;
  margin-bottom: 0;
  padding-bottom: 16px;
}

#xbybody .media-detail .metadata-tags-section .tag-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

#xbybody .media-detail .tag-group {
  margin: 0;
}

#xbybody .media-detail .tag-list {
  margin-top: 10px;
  gap: 8px;
}

#xbybody .media-detail .tag-item,
[arco-theme='dark'] #xbybody .media-detail .tag-item {
  padding: 7px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.76);
  background: #242424;
  box-shadow: none;
  font-size: 11px;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}





#xbybody .media-detail .scraped-media-info-section {
  width: calc(100% - 68px);
  margin: 0 auto;
  padding: 4px 0 34px;
  color: var(--scraped-detail-copy);
  background: var(--scraped-detail-surface);
}

#xbybody .media-detail .scraped-media-info-header {
  margin-bottom: 8px;
}

#xbybody .media-detail .detail-file-bar {
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 0;
  border-radius: 0;
  color: rgba(255, 255, 255, 0.5);
  background: transparent;
  box-shadow: none;
  text-align: left;
}

#xbybody .media-detail .detail-file-source {
  font-size: 11px;
  line-height: 1.4;
}

#xbybody .media-detail .detail-file-name {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.48);
  font-size: 11px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#xbybody .media-detail .detail-file-path {
  overflow-wrap: anywhere;
  color: rgba(255, 255, 255, 0.48);
  font-size: 11px;
  line-height: 1.4;
}

#xbybody .media-detail .detail-file-meta {
  align-self: flex-start;
  color: rgba(255, 255, 255, 0.52);
  font-size: 11px;
  white-space: normal;
}

#xbybody .media-detail .detail-media-card-rail {
  margin-top: 26px;
  padding: 8px 2px 12px;
  display: flex;
  gap: 18px;
  overflow-x: auto;
  scroll-padding-inline: 2px;
}

#xbybody .media-detail .detail-media-card {
  position: relative;
  width: 320px;
  min-width: 320px;
  min-height: 190px;
  flex: 0 0 auto;
  padding: 18px 20px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 22px;
  color: var(--scraped-detail-copy);
  background: #222;
  box-shadow: none;
}

#xbybody .media-detail .detail-media-card.selected {
  border-color: rgba(69, 119, 255, 0.42);
  background: #252936;
}

#xbybody .media-detail .detail-media-card-selected-badge {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 1;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #fff;
  background: #315be8;
}

#xbybody .media-detail .detail-media-card-selected-badge > .iconfont-svg {
  width: 16px;
  height: 16px;
}

#xbybody .media-detail .detail-media-card-title {
  margin: 0 42px 16px 0;
  color: rgba(255, 255, 255, 0.92);
  font-size: 15px;
  font-weight: 760;
}

#xbybody .media-detail .detail-media-card-heading {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

#xbybody .media-detail .detail-media-kind-badge {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.09);
  font-size: 15px;
  font-weight: 800;
}

#xbybody .media-detail .detail-media-card-title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#xbybody .media-detail .detail-media-card-body {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

#xbybody .media-detail .detail-media-row {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

#xbybody .media-detail .detail-media-row span,
#xbybody .media-detail .detail-media-row strong {
  font-size: 11px;
  line-height: 1.4;
}

#xbybody .media-detail .detail-media-row span {
  color: rgba(255, 255, 255, 0.48);
  font-weight: 650;
}

#xbybody .media-detail .detail-media-row strong {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.76);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 980px) {
  #xbybody .media-detail .hero-section {
    min-height: 760px;
  }

  #xbybody .media-detail .hero-info {
    grid-template-columns: 218px minmax(0, 1fr);
    column-gap: 24px;
  }
}

@media (max-width: 720px) {
  #xbybody .media-detail .hero-section {
    min-height: 840px;
  }

  #xbybody .media-detail .hero-content,
  #xbybody .media-detail .season-selector,
  #xbybody .media-detail .episodes-section,
  #xbybody .media-detail .cast-section,
  #xbybody .media-detail .tags-section,
  #xbybody .media-detail .scraped-media-info-section {
    width: calc(100% - 40px);
  }

  #xbybody .media-detail .hero-content {
    left: 20px;
  }

  #xbybody .media-detail .hero-info {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto;
    row-gap: 14px;
  }

  #xbybody .media-detail .hero-title,
  #xbybody .media-detail .hero-copy,
  #xbybody .media-detail .hero-meta,
  #xbybody .media-detail .hero-meta-secondary,
  #xbybody .media-detail .hero-overview,
  #xbybody .media-detail .coverage-alert,
  #xbybody .media-detail .hero-actions {
    grid-column: 1;
    grid-row: auto;
  }

  #xbybody .media-detail .hero-actions {
    max-width: 280px;
  }

  #xbybody .media-detail .detail-file-bar {
    grid-template-columns: minmax(0, 1fr);
  }

  #xbybody .media-detail .detail-file-meta {
    grid-column: 1;
    grid-row: auto;
  }
}
</style>

<style>
/* 播放列表弹窗使用和视频页媒体管理弹窗一致的 Arco portal 外壳 */
body[arco-theme='dark'] .playlist-modal.detail-media-modal .arco-modal,
body[arco-theme='dark'] .playlist-modal.detail-media-modal .arco-modal-content {
  background:
    radial-gradient(circle at 72% 8%, rgba(0, 245, 212, 0.08), transparent 28%),
    radial-gradient(circle at 12% 72%, rgba(36, 66, 255, 0.1), transparent 34%),
    var(--app-mineradio-bg, #08090b) !important;
  border-color: var(--app-glass-line, rgba(255, 255, 255, 0.08)) !important;
  color: var(--app-mineradio-ink, #e8ecef) !important;
}

body[arco-theme='dark'] .playlist-modal.detail-media-modal .arco-modal-header {
  border-bottom: 1px solid var(--app-glass-line, rgba(255, 255, 255, 0.06)) !important;
}

body[arco-theme='dark'] .playlist-modal.detail-media-modal .arco-modal-title,
body[arco-theme='dark'] .playlist-modal.detail-media-modal .arco-modal-close-btn {
  color: var(--app-mineradio-ink, #e8ecef) !important;
}

body:not([arco-theme='dark']) .playlist-modal.detail-media-modal .arco-modal,
body:not([arco-theme='dark']) .playlist-modal.detail-media-modal .arco-modal-content {
  --app-mineradio-ink: rgba(17, 24, 39, 0.94);
  --app-glass-panel: rgba(255, 255, 255, 0.72);
  --app-glass-line: rgba(15, 23, 42, 0.08);
  background:
    radial-gradient(circle at 72% 8%, rgba(37, 99, 235, 0.1), transparent 30%),
    radial-gradient(circle at 12% 72%, rgba(20, 184, 166, 0.08), transparent 34%),
    rgba(255, 255, 255, 0.88) !important;
  border-color: rgba(15, 23, 42, 0.08) !important;
  color: rgba(17, 24, 39, 0.94) !important;
}

body:not([arco-theme='dark']) .playlist-modal.detail-media-modal .arco-modal-title,
body:not([arco-theme='dark']) .playlist-modal.detail-media-modal .arco-modal-close-btn {
  color: rgba(17, 24, 39, 0.94) !important;
}
/* The cinematic rules above are dark defaults; light mode needs its own surface
   and foregrounds, including the artwork fade into the content below. */
body:not([arco-theme='dark']) #xbybody .media-detail {
  --scraped-detail-surface: #fafafa;
  --scraped-detail-soft: #eceef1;
  --scraped-detail-copy: #22252b;
  --scraped-detail-muted: #69717d;
}
body:not([arco-theme='dark']) #xbybody .media-detail {
  .detail-header { background:var(--scraped-detail-surface); border-color:#e4e6e9; }
  .detail-back:hover { color:var(--scraped-detail-copy); }
  .detail-back > .iconfont-svg { background:#f0f1f3; border-color:#daddE2; }
  .hero-section { background-color:#eceef1!important; }
  .hero-section::before { background:linear-gradient(180deg, transparent 30%, rgba(250,250,250,.25) 58%, rgba(250,250,250,.96) 85%, #fafafa 100%)!important; }
  .hero-section::after { background:linear-gradient(180deg, transparent, #fafafa)!important; }
  .hero-title,.hero-brand-title,.hero-overview,.meta-rating { color:var(--scraped-detail-copy)!important; text-shadow:none!important; }
  .hero-meta-secondary span + span::before { color:#858b94!important; }
  .episode-title,.cast-name,.detail-media-card-title,.detail-media-row strong { color:var(--scraped-detail-copy)!important; }
  .episode-name,.cast-role,.detail-file-bar,.detail-file-name,.detail-file-meta,.detail-media-row span { color:var(--scraped-detail-muted)!important; }
  .cast-avatar,.episode-thumbnail,.detail-media-kind-badge { background:#eceef1; color:#69717d; }
  .tag-item,.season-tab { background:#f0f1f3; color:#424852; border-color:#dfe2e6; }
  .detail-media-card { background:#f1f2f4; border-color:#dfe2e6; }
  .detail-media-card.selected { background:#edf1ff; border-color:#a5b8f5; }
  .action-button,.play-dropdown-button { background:rgba(240,241,243,.9); color:#333942; border-color:#cdd1d7; }
}
</style>

<style scoped>
#xbybody .media-detail .play-row:not(.has-version) {
  grid-template-columns: minmax(0, 1fr);
}
</style>
