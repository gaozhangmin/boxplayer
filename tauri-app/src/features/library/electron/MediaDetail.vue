<script setup lang="ts">
import DownloadChoiceDialog from '../detailDialogs/DownloadChoiceDialog.vue'
import OperationProgressDialog from '../detailDialogs/OperationProgressDialog.vue'
import {nativeItems} from '../adapters/libraryData'
import MediaDetailPage from '@/components/media-detail/MediaDetailPage.vue'
import MediaDetailInfo from '@/components/media-detail/MediaDetailInfo.vue'
import { seriesPreferences, orderedVersions, playbackVersions, generalPreferences, displayScopeAllows } from './seriesVersionPreferences'
import MediaPosterPlaceholder from './MediaPosterPlaceholder.vue'
import { detailBackdropUrl } from './mediaArtwork'
import MediaCollectionPicker from '@/features/files/electron/MediaCollectionPicker.vue'
import WatchedIndicator from './WatchedIndicator.vue'
import PosterRatingBadge from './PosterRatingBadge.vue'
import { isMediaWatched, setMediaWatched } from '../adapters/libraryData'
import { ref, computed, watch, watchEffect, onMounted, onBeforeUnmount, nextTick } from 'vue'
import {downloadFile} from '../adapters/detailNative'
import { getMediaCoverage, visibleSeriesSeasons } from './mediaCoverage'
import { useMediaLibraryStore } from '../adapters/libraryData'
import type { MediaLibraryItem, MediaCollectionMovie, MediaSeason, MediaEpisode, CastMember, CrewMember, DriveFileItem } from '@/features/files/electron/mediaTypes'
import type {MediaServerMediaInfoCard} from './mediaServerContent'
import type {IAliGetFileModel,IPageVideoPlaylistEntry} from '../adapters/detailNative'


import DB from '../adapters/libraryData'
import {menuOpenFile} from '../adapters/detailNative'
import { tmdbImageUrl } from '@/features/files/adapters/tmdb'
import {message} from '@/features/files/adapters/sourceServices'
import IconFont from '@/features/files/electron/IconFont.vue'
import {path} from '../adapters/detailNative'





import MediaMetadataEditorModal from '@/features/files/electron/MediaMetadataEditorModal.vue'
import MediaSourceRatings from './MediaSourceRatings.vue'
import {getLocalVideoProgress} from '../adapters/detailNative'
import { detailResumeState, detailSeriesId, videoDurationSeconds } from './detailResume'
import { openCustomSeries } from '../adapters/customSeries'
import { aliFileDisplayPath } from '@/features/sources/alipan'
import { useFileSourcesStore } from '@/stores/fileSources'
import { localSources } from '@/platform/native'
import type { CustomSeriesDetail, SeriesMedia } from '../adapters/customSeries'
import CustomSeriesDetailRail from './CustomSeriesDetailRail.vue'
import { detailCollectionTarget, detailCollectionMovies, playlistSelection, applyPlaylistSelection } from './detailCollections'
import { ListPlus, GalleryVerticalEnd, Play, Bookmark, Star, Ellipsis, ChevronDown, Repeat, Shuffle, Eye, EyeOff, Share, Plus, RefreshCw } from 'lucide-vue-next'
import { isContinueWatchingMember, toggleContinueWatching } from '../adapters/continueWatching'
import { openPersonalRating } from '../adapters/detailActions'
import { openMediaShare } from '../adapters/detailActions'
import {mediaFileSummary} from './mediaSummary'

// Props
const props = defineProps<{
  mediaItem: MediaLibraryItem
  activePlaylistName?: string
  playlistItems?: MediaLibraryItem[]
  customSeriesDetail?: CustomSeriesDetail
}>()

// Emits
const emit = defineEmits<{
  back: []
  tagClick: [tagType: string, tagValue: string, personId?: number]
  aiRescrape: [item: MediaLibraryItem]
  metadataUpdated: [item: MediaLibraryItem]
  openPlaylistItem: [item: MediaLibraryItem]
  openCustomSeriesMember: [member: SeriesMedia]
}>()


const mediaStore = useMediaLibraryStore()


const persistedCollectionItems = ref<MediaLibraryItem[]>([])
const collectionMovies = computed(() => activeCustomSeries.value ? [] : detailCollectionMovies(props.mediaItem, [...persistedCollectionItems.value, ...mediaStore.mediaItems]))
watch(() => JSON.stringify([props.mediaItem.id, props.mediaItem.type, props.mediaItem.collectionId]), async (_identity, _previous, onCleanup) => {
  const item = props.mediaItem
  let cancelled = false
  onCleanup(() => { cancelled = true })
  persistedCollectionItems.value = []
  if (item.type !== 'movie') return
  try {
    const items = await DB.getMediaLibraryCollectionItems(item)
    if (!cancelled) persistedCollectionItems.value = items
  } catch { /* Keep the entry and cached members available when storage is unavailable. */ }
}, { immediate: true })

// 响应式状态
const activeMediaItem = computed<MediaLibraryItem>(() => (props.mediaItem.collectionMovies?.[0] || props.mediaItem) as MediaLibraryItem)
const activeCustomSeries = computed(() => props.customSeriesDetail?.members.some(member => !member.serverId && detailSeriesId(member.id) === detailSeriesId(activeMediaItem.value.id)) ? props.customSeriesDetail : undefined)
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
watch(() => activeMediaItem.value.id, () => {
  selectedSeason.value = activeMediaItem.value.type === 'tv' && activeMediaItem.value.seasons?.length ? activeMediaItem.value.seasons[0].seasonNumber : 1
  selectedEpisode.value = undefined
  hasUserSelectedEpisode.value = false
  selectedDriveFileId.value = ''; manuallySelectedVersion.value = false
})
const handleCollectionMovieSelect = (movie: MediaLibraryItem) => {
  emit('openPlaylistItem', movie)
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
const mediaCoverage=computed(()=>getMediaCoverage(activeMediaItem.value))
const trackingRequest=computed(()=>activeMediaItem.value.type==='tv'&&!!activeMediaItem.value.tmdbId&&!!activeMediaItem.value.seasons?.length)


const metadataEditorVisible = ref(false)

const playlistMemberEpisodeLabel = (member: MediaLibraryItem): string => {
  const match = member.id.match(/_(\d+)_(\d+)$/)
  return match ? `第 ${Number(match[1])} 季 · 第 ${Number(match[2])} 集` : ''
}

// 计算属性
const availableSeasons = computed(() => visibleSeriesSeasons(activeMediaItem.value, generalPreferences.showMissingSeasons, generalPreferences.showMissingEpisodes))
const currentSeason = computed(() => availableSeasons.value.find(season => season.seasonNumber === selectedSeason.value) || availableSeasons.value[0])
const currentSeasonEpisodes = computed(() => currentSeason.value?.episodes || [])

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
    item => item.episodeNumber === selectedEpisode.value && item.driveFiles.length
  )
  return selected || currentSeasonEpisodes.value.find(episode => episode.driveFiles.length) || null
})

const detailVersionFiles = computed<DriveFileItem[]>(() => {
  const files = activeMediaItem.value.type === 'tv' ? currentEpisode.value?.driveFiles || [] : activeMediaItem.value.driveFiles || []
  return orderedVersions(files, seriesPreferences.defaultVersion)
})

const selectedDriveFile = computed<DriveFileItem | undefined>(() => {
  return detailVersionFiles.value.find(file => file.id === selectedDriveFileId.value) || detailVersionFiles.value[0]
})
const fileSources = useFileSourcesStore()
const selectedMediaPath = ref('')
watch(selectedDriveFile, async (file, _, onCleanup) => {
  selectedMediaPath.value = ''
  if (!file) return
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  try {
    let result = ''
    if (file.cloudType === 'local') {
      if (/^(?:\/|\\\\|[A-Za-z]:[/\\])/.test(file.path)) {
        result = file.path
      } else {
        const source = (await localSources()).find(source => source.id === file.userId)
        if (source) {
          const separator = /^(?:\\\\|[A-Za-z]:\\)/.test(source.path) ? '\\' : '/'
          result = source.path.replace(/[/\\]+$/, '') + separator + file.path.split('/').filter(Boolean).join(separator)
        }
      }
    } else {
      const account = fileSources.accounts.find(account => account.id === file.userId)
      if (account?.providerId === 'aliyun' || account?.providerId === 'alipan-open') {
        result = await aliFileDisplayPath(account, file.path, controller.signal)
      } else if (file.path.startsWith('/')) {
        result = file.path
      }
    }
    if (!controller.signal.aborted) selectedMediaPath.value = result
  } catch {
    // Keep the filename visible while a source cannot resolve its complete path.
  }
}, { immediate: true })

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
  const localPosition = getLocalVideoProgress(file.userId || '', file.driveId, file.id)
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
const detailMenuOpen=ref(false),downloadChoices=ref(false),watchlistFeedback=ref(false)
const canDownloadCurrent=computed(()=>{const file=currentDownloadFile.value;return !!file&&nativeItems([activeMediaItem.value]).some(item=>item.id===file.id&&!item.local)})
const isWatchlisted = computed(() => mediaStore.continueWatching.some(entry => isContinueWatchingMember(entry, activeMediaItem.value)))
async function toggleWatchlist() {
  watchlistFeedback.value=true
  try { await toggleContinueWatching(mediaStore, activeMediaItem.value, true) }
  catch (error) { message.error(error instanceof Error ? error.message : String(error)) }
  finally{watchlistFeedback.value=false}
}

// 方法
const handleBackClick = () => {
  emit('back')
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
  if (!episode.driveFiles.length) return
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

function requestDetailDownload(){if(!canDownloadCurrent.value)return;if(activeMediaItem.value.type==='tv')downloadChoices.value=true;else void handleDownloadCurrent()}
async function chooseDetailDownload(scope:'single'|'unwatched'|'all'){
 downloadChoices.value=false;if(scope==='single'){await handleDownloadCurrent();return}
 const rows=nativeItems([activeMediaItem.value]).filter(item=>!item.local&&(scope!=='unwatched'||!item.watched))
 try{for(const item of rows)await downloadFile(item.id);if(rows.length)message.success('成功创建下载任务')}catch(error){message.error(error instanceof Error?error.message:String(error))}
}
const handleDownloadCurrent = async () => {
  const driveFile = currentDownloadFile.value
  if (!driveFile) {
    message.error('当前媒体没有可下载的视频文件')
    return
  }

  try {await downloadFile(driveFile.id);message.success('成功创建下载任务')}
  catch(error){message.error(error instanceof Error?error.message:String(error))}
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
  <MediaDetailPage class="library-media-detail" :item-key="String(activeMediaItem.id)" :title="activeMediaItem.name"
    :backdrop-style="backgroundStyle" :play-label="playButtonLabel" :progress="playProgressPercent"
    :has-version="detailVersionFiles.length > 1" :play-disabled="!selectedDriveFile" @back="handleBackClick" @play="playMainContent">
    <template #header-actions>
      <button class="action-button" :title="isWatchlisted ? '从待看列表移除' : '加入待看列表'" @click="toggleWatchlist"><Bookmark :size="20" :fill="isWatchlisted ? 'currentColor' : 'none'" /></button>
      <a-dropdown v-model:popup-visible="detailMenuOpen" trigger="click" position="br" :auto-fit-popup-width="false" popup-class="detail-more-action-popup">
        <button class="action-button" title="更多操作"><Ellipsis :size="20" /><ChevronDown :size="12" /></button>
        <template #content><div class="detail-more-action-menu" @click="detailMenuOpen=false">
          <button class="detail-more-action-item" @click="activeMediaItem.type === 'tv' && currentEpisode ? playEpisode(currentEpisode, true) : playMovie(true)"><Repeat :size="20" /><span>循环播放</span></button>
          <button v-if="activeMediaItem.type === 'tv'" class="detail-more-action-item" @click="playShuffledEpisodes"><Shuffle :size="20" /><span>随机播放</span></button>
          <button class="detail-more-action-item" @click="toggleWatched"><component :is="isWatched ? EyeOff : Eye" :size="20" /><span>{{ isWatched ? '标记未观看' : '标记已观看' }}</span></button>
          <button class="detail-more-action-item" @click="toggleWatchlist"><Bookmark :size="20" /><span>{{ isWatchlisted ? '从待看列表移除' : '加入待看列表' }}</span></button>
          <button class="detail-more-action-item" @click="togglePlaylist"><ListPlus :size="20" /><span>播放列表</span></button>
          <button class="detail-more-action-item" @click="addToCustomSeries"><GalleryVerticalEnd :size="20" /><span>系列</span></button>
          <button v-if="mediaCoverage" class="detail-more-action-item accent" disabled title="当前版本暂不支持媒体自动获取"><Plus :size="20" /><span>一键补全</span></button>
          <button v-if="trackingRequest" class="detail-more-action-item accent" disabled title="当前版本暂不支持媒体自动获取"><RefreshCw :size="20" /><span>追更本季</span></button>
          <button class="detail-more-action-item" @click="openPersonalRating(activeMediaItem)"><Star :size="20" /><span>评分</span></button>
          <button class="detail-more-action-item" @click="metadataEditorVisible = true"><IconFont name="iconedit-square" /><span>编辑元数据</span></button>
          <button class="detail-more-action-item" @click="openMediaShare({ id: activeMediaItem.id, title: activeMediaItem.name, year: activeMediaItem.year, files: activeMediaItem.driveFiles })"><Share :size="20" /><span>分享</span></button>
          <button v-if="canDownloadCurrent" class="detail-more-action-item" @click="requestDetailDownload"><IconFont name="icondownload" /><span>下载</span></button>
        </div></template>
      </a-dropdown>
    </template>
    <template #poster>
      <WatchedIndicator corner :watched="isWatched" />
      <PosterRatingBadge :rating="activeMediaItem.rating" :is-movie="activeMediaItem.type === 'movie'" />
      <img v-if="activeMediaItem.posterUrl" :src="activeMediaItem.posterUrl" :alt="activeMediaItem.name" />
      <div v-else class="poster-placeholder">
        <MediaPosterPlaceholder />
      </div>
    </template>
    <template #summary>
      <img
        v-if="detailLogoUrl"
        class="hero-logo"
        :src="detailLogoUrl"
        :alt="activeMediaItem.name"
        @error="detailLogoLoadFailed = true"
      />
      <h1 v-else class="hero-title" :title="activeMediaItem.name">{{ activeMediaItem.name }}</h1>
      <div v-if="detailHeading" class="hero-episode-title" :title="detailHeading">{{ detailHeading }}</div>

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
        <span v-if="Number(selectedDriveFile?.videoDuration)">{{ Math.max(1,Math.round(Number(selectedDriveFile?.videoDuration)/60)) }}分钟</span>
        <span v-if="selectedDriveFile?.height">{{selectedDriveFile.height}}p</span>

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
    </template>
    <template #play-context>
      <div v-if="playEpisodeInfo" class="play-episode-info">{{ playEpisodeInfo }}</div>
    </template>
    <template #versions>
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
    </template>
    <template #actions>
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
          v-if="canDownloadCurrent"
          title="下载"
          @click="requestDetailDownload"
        >
          <IconFont name="icondownload" />
        </button>
        <button class="action-button" title="评分" @click="openPersonalRating(activeMediaItem)"><Star :size="20" /></button>
        <button
          type="button"
          class="action-button"
          :class="{ active: isWatchlisted }"
          :title="isWatchlisted ? '从待看列表移除' : '加入待看列表'"
          @click="toggleWatchlist"
        >
          <Bookmark :size="20" :fill="isWatchlisted ? 'currentColor' : 'none'" />
        </button>
        <button class="action-button" title="加入系列" :disabled="!currentCollectionTarget" @click="addToCustomSeries"><GalleryVerticalEnd :size="20" /></button>
        <button class="action-button" title="播放列表" @click="togglePlaylist"><ListPlus :size="20"/></button>
      </div>
    </template>

    <!-- 季选择器（仅电视剧显示） -->
    <div v-if="activeMediaItem.type === 'tv' && availableSeasons.length > 1" class="season-selector">
      <div class="season-tabs">
        <a-button
          v-for="season in availableSeasons"
          :key="season.seasonNumber"
          :type="currentSeason?.seasonNumber === season.seasonNumber ? 'primary' : 'secondary'"
          @click="handleSeasonChange(season.seasonNumber)"
        >
          第 {{ season.seasonNumber }} 季<span v-if="mediaCoverage?.missingSeasons.includes(season.seasonNumber)"> · 缺失</span>
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
            <button v-if="episode.driveFiles.length" type="button" class="episode-play-overlay" :aria-label="`播放第 ${episode.episodeNumber} 集`" @click.stop="handleEpisodePlay(episode)">
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

    <div v-if="collectionMovies.length" class="episodes-section collection-section">
      <div class="section-header">
        <h3>{{ props.mediaItem.collectionName || collectionMovies[0]?.collectionName || props.mediaItem.name }}</h3>
        <span class="episode-count">{{ collectionMovies.length }} 部电影</span>
      </div>
      <div class="episodes-grid collection-poster-rail">
        <button
          v-for="movie in collectionMovies"
          :key="movie.tmdbId || movie.id"
          type="button"
          class="episode-card collection-poster-card"
          :aria-label="movie.name"
          :aria-pressed="movie.id === activeMediaItem.id"
          :class="{ active: movie.id === activeMediaItem.id }"
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
            <p class="episode-name">{{ movie.year || '未知年份' }}</p>
          </div>
        </button>
      </div>
    </div>

    <CustomSeriesDetailRail v-if="activeCustomSeries" class="custom-series-section" :series="activeCustomSeries" :selected-id="activeMediaItem.id"
      @open="emit('openCustomSeriesMember', $event)" />

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
    <MediaDetailInfo :cards="detailMediaInfoCards" :file="selectedDriveFile ? {
      source: cloudDriveLabel(selectedDriveFile), path: selectedMediaPath,
      name: selectedDriveFile.name, summary: detailFileSummary
    } : undefined" />
    <template #dialogs>
      <DownloadChoiceDialog v-if="downloadChoices" :single-disabled="!canDownloadCurrent" @close="downloadChoices=false" @choose="chooseDetailDownload"/><OperationProgressDialog v-if="watchlistFeedback" kind="watchlist" @close="watchlistFeedback=false"/>
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
    </template>
  </MediaDetailPage>
</template>

<style scoped lang="less">
.playlist-modal :deep(.arco-modal) {
  width: 620px;
  max-width: calc(100vw - 40px);
}

.playlist-modal :deep(.arco-modal-content) {
  border-radius: 28px;
  background: var(--app-overlay-bg);
  border: 1px solid var(--app-glass-line, rgba(255, 255, 255, 0.08));
  box-shadow:
    0 28px 60px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
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

</style>
<style>
/* 播放列表弹窗使用和视频页媒体管理弹窗一致的 Arco portal 外壳 */
body[arco-theme='dark'] .playlist-modal.detail-media-modal .arco-modal,
body[arco-theme='dark'] .playlist-modal.detail-media-modal .arco-modal-content {
  background: var(--app-overlay-bg) !important;
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
  background: var(--app-overlay-bg) !important;
  border-color: rgba(15, 23, 42, 0.08) !important;
  color: rgba(17, 24, 39, 0.94) !important;
}

body:not([arco-theme='dark']) .playlist-modal.detail-media-modal .arco-modal-title,
body:not([arco-theme='dark']) .playlist-modal.detail-media-modal .arco-modal-close-btn {
  color: rgba(17, 24, 39, 0.94) !important;
}
</style>

<style scoped>.library-media-detail :deep(.action-buttons){grid-auto-columns:minmax(0,1fr)}.library-media-detail :deep(.detail-header-actions>.action-button){width:40px;height:40px;flex:0 0 40px}.library-media-detail :deep(.detail-header-actions .arco-trigger-popup){min-width:190px}</style>

<style>
.detail-more-action-popup {
  padding: 6px;
  border: 1px solid var(--color-border-2);
  border-radius: 10px;
  background: var(--color-bg-popup);
}
.detail-more-action-menu {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  width: min(220px, calc(100vw - 24px));
  max-height: min(500px, calc(100vh - 100px));
  overflow-y: auto;
  gap: 2px;
}
.detail-more-action-menu .detail-more-action-item {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 5px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-1);
  text-align: left;
}
.detail-more-action-menu .detail-more-action-item:hover:not(:disabled),
.detail-more-action-menu .detail-more-action-item:focus-visible { background: var(--color-fill-2); }
.detail-more-action-menu .detail-more-action-item:disabled { opacity: .5; }
.detail-more-action-menu .detail-more-action-item > svg { width: 20px; height: 20px; }
</style>
