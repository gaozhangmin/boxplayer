<!-- MediaPanRight.vue - 媒体库专用的文件列表组件 -->
<template>
  <div class='media-pan-right'>
    <div v-if="props.unifiedFiles" class="folder-browser" :class="{ 'folder-browser-list': browseMode === 'list' }">
      <template v-for="item in browserItems" :key="item.file_id">
        <LocalMediaFileCard portrait-list v-if="item.drive_id === 'local'" :season-label="browserSeasonLabels.get(item.file_id)" :name="browserMedia.get(item.file_id)?.name || item.name" :metadata="browserMetadata.get(item.file_id)" :path="item.file_id" :thumbnail="browserPosters.get(item.file_id) || item.thumbnail" :duration="item.media_duration" :height="item.media_height" :directory="item.isDir && !browserMedia.has(item.file_id)" :mode="browseMode" :selection="props.browseSelection" :selected="mediaPanFileStore.ListSelected.has(item.file_id)" :watched="localFileWatched(item)" @open="props.browseSelection ? handleSelect(item.file_id, {} as MouseEvent, true) : handleOpenFile({} as Event, item)" @watched="toggleLocalFileWatched(item)" @context="openFileMenu($event, item)" />
      <FileBrowserCard v-else :downloadable="!item.isDir && item.category === 'video'" :download-label="t('fileContext.download')" @download="emit('fileAction', 'download', item)" :key="item.file_id" :season-label="browserSeasonLabels.get(item.file_id)" :name="browserMedia.get(item.file_id)?.name || item.name" :directory="item.isDir && !browserMedia.has(item.file_id)" :thumbnail="browserPosters.get(item.file_id) || item.thumbnail" :size-text="item.isDir ? '' : browserSubtitle(item)" :mode="browseMode" :selection="props.browseSelection" :selected="mediaPanFileStore.ListSelected.has(item.file_id)" @context="openFileMenu($event, item)" @open="props.browseSelection ? handleSelect(item.file_id, $event, true) : handleOpenFile($event, item)" />
      </template>
    </div>
    <!-- 加载状态 -->
    <a-skeleton v-else-if='mediaPanFileStore.ListLoading && mediaPanFileStore.ListDataCount == 0' :loading='true' :animation='true'>
      <a-skeleton-line :rows='10' :line-height='50' :line-spacing='50' />
    </a-skeleton>

    <!-- 文件列表 -->
    <a-list
      v-else
      ref='viewlist'
      :bordered='false'
      :split='false'
      :max-height='listViewportHeight'
      :virtual-list-props="{
        height: listViewportHeight,
        fixedSize: true,
        estimatedSize: 50,
        threshold: 1,
        itemKey: 'file_id'
      }"
      style='width: 100%'
      :data='mediaPanFileStore.ListDataShow'
      tabindex='-1'
      @scroll='handleListScroll'>
      <template #empty>
        <a-empty description='空文件夹' />
      </template>
      <template #item='{ item, index }'>
        <div :key="'l-' + item.file_id" class='listitemdiv'>
          <div
            v-if='item.isDir'
            :class="'fileitem' + (mediaPanFileStore.ListSelected.has(item.file_id) ? ' selected' : '') + (mediaPanFileStore.ListFocusKey == item.file_id ? ' focus' : '')"
            @click='handleSelect(item.file_id, $event)'
            @dblclick='handleOpenFile($event, item)'>
            <!-- 选择框 -->
            <div class='rangselect'>
              <a-button shape='circle' type='text' tabindex='-1' class='select media-file-action' :title='index'
                        @click.prevent.stop='handleSelect(item.file_id, $event, true)'>
                <IconFont :name="mediaPanFileStore.ListSelected.has(item.file_id) ? (item.starred ? 'iconcrown3' : 'iconrsuccess') : item.starred ? 'iconcrown' : 'iconpic2'" />
              </a-button>
            </div>
            <!-- 文件图标 -->
            <div class='fileicon'>
              <IconFont :name="item.icon" aria-hidden='true' />
            </div>
            <!-- 文件名 -->
            <div class='filename' droppable='false'>
              <div @click='handleOpenFile($event, item)'>
                {{ item.name }}
              </div>
            </div>
            <!-- 文件按钮 -->
            <div class='filebtn'>
              <a-popover v-if='item.thumbnail'
                         content-class='popimg' position='lt'>
                <a-button type='text' tabindex='-1' class='gengduo media-file-action' title='缩略图'>
                  <IconFont name="icongengduo" />
                </a-button>
                <template #content>
                  <div class='preimg'>
                    <img :src='item.thumbnail' onerror="javascript:this.src='imgerror.png';" />
                  </div>
                </template>
              </a-popover>
              <a-button v-else type='text' tabindex='-1' class='gengduo media-file-action' disabled></a-button>
            </div>
            <!-- 文件大小 -->
            <div class='filesize'>{{ item.sizeStr }}</div>
            <div v-show='item.file_count' class='filesize'>{{ '文件数: ' + item.file_count }}</div>
            <!-- 修改时间 -->
            <div class='filetime'>{{ item.timeStr }}</div>
          </div>

          <!-- 文件项 -->
          <div
            v-else
            :class="'fileitem' + (mediaPanFileStore.ListSelected.has(item.file_id) ? ' selected' : '') + (mediaPanFileStore.ListFocusKey == item.file_id ? ' focus' : '')"
            @click='handleSelect(item.file_id, $event)'
            @dblclick='handleOpenFile($event, item)'>
            <!-- 选择框 -->
            <div class='rangselect'>
              <a-button shape='circle' type='text' tabindex='-1' class='select media-file-action' :title='index'
                        @click.prevent.stop='handleSelect(item.file_id, $event, true)'>
                <IconFont :name="mediaPanFileStore.ListSelected.has(item.file_id) ? (item.starred ? 'iconcrown3' : 'iconrsuccess') : item.starred ? 'iconcrown' : 'iconpic2'" />
              </a-button>
            </div>
            <!-- 文件图标 -->
            <div class='fileicon'>
              <IconFont :name="item.icon" aria-hidden='true' />
            </div>
            <!-- 文件名 -->
            <div class='filename' droppable='false'>
              <div @click='handleOpenFile($event, item)'>
                {{ item.name }}
              </div>
            </div>
            <!-- 文件按钮 -->
            <div class='filebtn'>
              <a-popover v-if='item.thumbnail' content-class='popimg'
                         position='lt'>
                <a-button type='text' tabindex='-1' class='gengduo media-file-action'>
                  <IconFont name="icontupianyulan" />
                </a-button>
                <template #content>
                  <div class='preimg'>
                    <img :src='item.thumbnail' onerror="javascript:this.src='imgerror.png';" />
                  </div>
                </template>
              </a-popover>
              <a-button v-else type='text' tabindex='-1' class='gengduo media-file-action' disabled></a-button>
            </div>
            <!-- 文件大小 -->
            <div class='filesize'>
              {{ item.sizeStr }}
            </div>
            <!-- 修改时间 -->
            <div class='filetime'>{{ item.timeStr }}</div>
            <!-- 媒体信息 -->
            <div class='filesize' v-show="item.media_duration || item.media_play_cursor">
              <span>{{ '总时:' + (item.media_duration || '未知时长') }}</span>
              <span>{{ '观看:' + (item.media_play_cursor || '未知状态') }}</span>
              <span>{{ item.media_width > 0 ? item.media_width + 'x' + item.media_height : '' }}</span>
            </div>
          </div>
        </div>
      </template>
    </a-list>
    <div v-if="menuFile" class="file-browser-context-menu" :style="{ left: menuPosition.x + 'px', top: menuPosition.y + 'px' }" role="menu"><button v-for="action in fileMenuActions" :key="action.id" type="button" role="menuitem" :disabled="action.disabled" @click="runFileAction(action.id)"><component :is="action.icon" :size="16" /><span>{{ t(action.label) }}</span></button></div>
  </div>
</template>

<script setup lang='ts'>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { t } from '../i18n'
import { isFileSourceRoot } from '../utils/fileSourceRoots'
import { localWatchedKey, localWatchedKeys } from '../utils/localWatchedState'
import { isContinueWatchingMember } from '../utils/continueWatchingAction'
import DB from '../utils/db'
import { Play, RefreshCw, Shuffle, Star, SquareCheck, Share2, Download, Pencil, Eye, Bookmark, ListPlus, Library, Trash2 } from 'lucide-vue-next'
import LocalMediaFileCard from './LocalMediaFileCard.vue'
import FileBrowserCard from './FileBrowserCard.vue'
import { useMediaLibraryStore } from '../store/medialibrary'
import { IAliGetFileModel } from '../aliapi/alimodels'
import { useMediaPanFileStore, useMediaPanTreeStore } from './stores'
import { menuOpenFile } from '../utils/openfile'

const sizeFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const formatBrowserFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++ }
  return `${sizeFormatter.format(value)} ${units[index]}`
}

// 定义 emit 事件
const emit = defineEmits<{
  enterFolder: [file: IAliGetFileModel]
  fileAction: [action: string, file: IAliGetFileModel]
  openMedia: [item: import('../types/media').MediaLibraryItem]
}>()

const menuFile = ref<IAliGetFileModel>()
const closeFileMenu = (event: Event) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target as HTMLElement)?.closest('.file-browser-context-menu')) menuFile.value = undefined }
onMounted(() => { document.addEventListener('keydown', closeFileMenu); document.addEventListener('click', closeFileMenu) })
onUnmounted(() => { document.removeEventListener('keydown', closeFileMenu); document.removeEventListener('click', closeFileMenu) })
const menuPosition = ref({ x: 0, y: 0 })
const openFileMenu = (event: MouseEvent, file: IAliGetFileModel) => { menuFile.value = file; menuPosition.value = { x: event.clientX, y: event.clientY } }
const fileMenuActions = computed<Array<{ id: string; icon: typeof Play; label: Parameters<typeof t>[0]; disabled?: boolean }>>(() => !menuFile.value ? [] : menuFile.value.isDir ? [
  { id: 'play', icon: Play, label: 'unified.play' }, { id: 'loop', icon: RefreshCw, label: 'unified.loopPlay' }, { id: 'shuffle', icon: Shuffle, label: 'unified.shufflePlay' }, { id: 'favorite', icon: Star, label: library.folders.some(folder => folder.userId === browserTree.user_id && folder.driveId === menuFile.value?.drive_id && folder.fileId === menuFile.value?.file_id && folder.isFavorite !== false && (!isFileSourceRoot(menuFile.value!) || folder.isDriveRootFavorite)) ? 'unified.removeFavoriteFolder' : 'unified.addToFavorites' }
] : [
  { id: 'play', icon: Play, label: 'unified.play' }, { id: 'loop', icon: RefreshCw, label: 'unified.loopPlay' }, { id: 'select', icon: SquareCheck, label: 'unified.selectItems' }, { id: 'rating', icon: Star, label: 'media.rating' },
  { id: 'share', icon: Share2, label: 'fileContext.share' }, { id: 'download', icon: Download, label: 'fileContext.download', disabled: menuFile.value.drive_id === 'local' },
  { id: 'metadata', icon: Pencil, label: 'fileContext.editMetadata' }, { id: 'watched', icon: Eye, label: localFileWatched(menuFile.value!) ? 'mediaServer.markUnwatched' : 'mediaServer.markWatched' },
  { id: 'continue', icon: Bookmark, label: fileInContinueWatching.value ? 'fileContext.removeContinue' : 'fileContext.continue' }, { id: 'playlist', icon: ListPlus, label: 'media.playlist' }, { id: 'series', icon: Library, label: 'fileContext.series' }, { id: 'delete', icon: Trash2, label: 'common.delete', disabled: true }
])
const runFileAction = (action: string) => { const file = menuFile.value; menuFile.value = undefined; if (!file) return; if (action === 'select') handleSelect(file.file_id, {} as MouseEvent, true); else if (action === 'watched') toggleLocalFileWatched(file); else emit('fileAction', action, file) }
const viewlist = ref()
const mediaPanFileStore = useMediaPanFileStore()
const props = defineProps<{ unifiedFiles?: boolean; favoriteBrowse?: boolean; browseMode?: 'grid' | 'list'; browseSelection?: boolean; descending?: boolean }>()
// Favorites may be browsed as a list or a grid, like any other folder.
const browseMode = computed(() => props.browseMode)
const library = useMediaLibraryStore()
const fileInContinueWatching = computed(() => {
  const file = menuFile.value
  if (!file) return false
  const target = library.mediaItems.find(item => [...(item.driveFiles || []), ...(item.seasons || []).flatMap(season => (season.episodes || []).flatMap(episode => episode.driveFiles || []))].some(candidate => candidate.id === file.file_id || candidate.path === file.file_id))
  return !!target && library.continueWatching.some(entry => isContinueWatchingMember(entry, target))
})
const localFileMediaId = (file: IAliGetFileModel) => library.mediaItems.find(item => [...(item.driveFiles || []), ...(item.seasons || []).flatMap(season => (season.episodes || []).flatMap(episode => episode.driveFiles || []))].some(candidate => candidate.driveId === 'local' && (candidate.path === file.file_id || candidate.id === file.file_id)))?.id || 'local-file:' + file.file_id
const localFileWatched = (file: IAliGetFileModel) => library.isWatched(localFileMediaId(file)) || library.isWatched(localWatchedKey(file.file_id))
const toggleLocalFileWatched = async (file: IAliGetFileModel) => {
  const watched = !localFileWatched(file)
  library.markWatched(localFileMediaId(file), watched)
  library.markWatched(localWatchedKey(file.file_id), watched)
  const matches = await DB.getMediaLibraryPage({ predicate: item => localWatchedKeys(item).includes(localWatchedKey(file.file_id)), limit: Number.MAX_SAFE_INTEGER })
  if (library.isWatched(localWatchedKey(file.file_id)) !== watched) return
  for (const item of matches) library.markWatched(item.id, watched)
}
const browserMetadata = ref(new Map<string, { title?: string; rating?: number; year?: string; certification?: string; overview?: string }>())
const browserSeasonLabels = ref(new Map<string, string>())
const browserMedia = ref(new Map<string, import('../types/media').MediaLibraryItem>())
const browserPosters = ref(new Map<string, string>())
/** Scraped overviews shown under list rows instead of "date - size". */
const browserOverviews = ref(new Map<string, string>())
function browserSubtitle(item: IAliGetFileModel) {
  const overview = browserOverviews.value.get(item.file_id)
  if (overview) return overview
  const size = item.sizeStr || formatBrowserFileSize(item.size)
  return item.timeStr ? `${item.timeStr} - ${size}` : size
}
const browserTree = useMediaPanTreeStore()
let artworkRequest = 0
watch(
  [() => props.unifiedFiles, () => mediaPanFileStore.ListDataShow, () => library.mediaItems, () => library.isScanning, () => browserTree.user_id],
  async () => {
    const request = ++artworkRequest
    browserSeasonLabels.value = new Map()
    browserMedia.value = new Map()
    browserPosters.value = new Map()
    browserOverviews.value = new Map()
    browserMetadata.value = new Map()
    if (!props.unifiedFiles) return
    const files = [...mediaPanFileStore.ListDataShow]
    const userID = browserTree.user_id
    const fileMatches = (candidate: import('../types/media').DriveFileItem, file: IAliGetFileModel) => {
      if (file.drive_id === 'local') {
        if (candidate.driveId !== 'local' && candidate.driveServerId !== 'local') return false
        return file.isDir
          ? candidate.path.startsWith((file.path || file.file_id).replace(/\/$/, '') + '/')
          : candidate.path === file.file_id || candidate.id === file.file_id
      }
      if (candidate.driveId !== file.drive_id || (userID && candidate.userId !== userID && candidate.driveServerId !== userID)) return false
      return file.isDir
        ? candidate.parentFileId === file.file_id || (!!file.path && file.path !== '/' && candidate.path.startsWith(file.path.replace(/\/$/, '') + '/'))
        : candidate.id === file.file_id
    }
    try {
      const records = await DB.getMediaLibraryPage({
        limit: Number.MAX_SAFE_INTEGER,
        predicate: item => {
          const media = [item, ...(item.collectionMovies || [])]
          return media.some(member => [
            ...(member.driveFiles || []),
            ...('seasons' in member ? member.seasons || [] : []).flatMap(season => (season.episodes || []).flatMap(episode => episode.driveFiles || []))
          ].some(candidate => files.some(file => fileMatches(candidate, file))))
        }
      })
      if (request !== artworkRequest) return
      const media = new Map<string, import('../types/media').MediaLibraryItem>()
      const seasonLabels = new Map<string, string>()
      const posters = new Map<string, string>()
      const overviews = new Map<string, string>()
      const metadata = new Map<string, { title?: string; rating?: number; year?: string; certification?: string; overview?: string }>()
      for (const file of files) {
        const matches = records.flatMap(item => [item, ...(item.collectionMovies || [])]).filter(item => [
          ...(item.driveFiles || []),
          ...('seasons' in item ? item.seasons || [] : []).flatMap(season => (season.episodes || []).flatMap(episode => episode.driveFiles || []))
        ].some(candidate => fileMatches(candidate, file)))
        if (matches.length && (!file.isDir || new Set(matches.map(item => item.id)).size === 1)) {
          media.set(file.file_id, matches[0])
          if (matches[0].type === 'tv') {
            const seasons = [...new Set((matches[0].seasons || []).filter(season =>
              (season.episodes || []).some(episode => (episode.driveFiles || []).some(candidate => fileMatches(candidate, file)))
            ).map(season => season.seasonNumber))]
            if (seasons.length) seasonLabels.set(file.file_id, seasons.length === 1
              ? t('ai.media.tracking.season', { number: seasons[0] })
              : t('mediaLibrary.seasonsCount', { count: seasons.length }))
          }
          const poster = matches[0].posterUrl || (matches[0].type === 'unmatched'
            ? matches[0].driveFiles?.find(candidate => fileMatches(candidate, file))?.thumbnailLink : undefined)
          if (poster) posters.set(file.file_id, poster)
          if (matches[0].type !== 'unmatched') {
            const item = matches[0]
            metadata.set(file.file_id, { title: item.name, rating: item.rating, year: item.year, certification: item.certification, overview: item.overview })
          }
          if (matches[0].overview) overviews.set(file.file_id, matches[0].overview)
        }
      }
      browserSeasonLabels.value = seasonLabels
      browserMedia.value = media
      browserPosters.value = posters
      browserOverviews.value = overviews
      browserMetadata.value = metadata
    } catch (error) {
      console.warn('Unable to load scraped file artwork', error)
    }
  },
  { immediate: true }
)
onUnmounted(() => { artworkRequest++ })
const browserItems = computed(() => [...mediaPanFileStore.ListDataShow].filter(file => !props.favoriteBrowse || file.isDir || file.category === 'video').sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) * (props.descending ? -1 : 1)))
const listViewportHeight = computed(() => Math.min(500, Math.max(50, mediaPanFileStore.ListDataShow.length * 50)))

const handleListScroll = () => {
  // 处理滚动事件（媒体库中不需要复杂的滚动逻辑）
}

const handleSelect = (file_id: string, event: MouseEvent, isCtrl: boolean = false) => {
  mediaPanFileStore.mMouseSelect(file_id, event.ctrlKey || isCtrl, event.shiftKey)
  if (!mediaPanFileStore.ListSelected.has(file_id)) mediaPanFileStore.ListFocusKey = ''
}

const handleOpenFile = (event: Event, file: IAliGetFileModel | undefined) => {
  if (!file) file = mediaPanFileStore.GetSelectedFirst()
  if (!file) return

  const media = browserMedia.value.get(file.file_id)
  if (props.unifiedFiles && !props.browseSelection && media && (props.favoriteBrowse || file.drive_id === 'local')) {
    emit('openMedia', media)
    return
  }

  // 如果是文件夹，应该进入子目录而不是打开文件
  if (file.isDir) {
    // 发出事件让 MediaLibrary.vue 处理文件夹导航
    emit('enterFolder', file)
    return
  }

  // 只有文件才执行打开操作
  if (!mediaPanFileStore.ListSelected.has(file.file_id)) {
    mediaPanFileStore.mMouseSelect(file.file_id, false, false)
  }

  // 简化的文件打开逻辑
  menuOpenFile(file)
}

defineExpose({
  viewlist
})
</script>

<style scoped>
.folder-browser{display:grid;grid-template-columns:repeat(auto-fill,174px);gap:24px 20px;padding:20px;align-content:start}
.folder-browser-list{display:flex;flex-direction:column;gap:0;padding:0 16px}
.media-pan-right {
  width: 100%;
  height: 100%;
}

.listitemdiv {
  padding: 0;
  margin: 0;
}

.fileitem {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  margin: 0;
  min-height: 50px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--color-neutral-3);
  transition: background-color 0.2s ease;
}

.fileitem:hover {
  background-color: var(--color-neutral-1);
}

.fileitem.selected {
  background-color: var(--color-primary-light-1);
}

.fileitem.focus {
  background-color: var(--color-primary-light-2);
}

.rangselect {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fileicon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
}

.fileicon .iconfont {
  font-size: 20px;
  color: var(--color-text-2);
}

.filename {
  flex: 1;
  min-width: 0;
  margin-right: 12px;
}

.filename > div {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: var(--color-text-1);
}

.filebtn {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
}

.media-pan-right :deep(.media-file-action.arco-btn) {
  width: 28px;
  height: 28px;
  min-width: 28px;
  min-height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  box-shadow: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.media-pan-right :deep(.media-file-action.arco-btn:hover) {
  border: 0;
  background: var(--color-fill-2);
  box-shadow: none;
}

.media-pan-right :deep(.media-file-action .iconfont) {
  font-size: 20px;
  line-height: 1;
}

.filebtn .gengduo[disabled] {
  opacity: 0;
  background: transparent !important;
  border-color: transparent !important;
  box-shadow: none !important;
  pointer-events: none;
}

.filesize {
  width: 80px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--color-text-3);
  text-align: right;
  margin-right: 12px;
}

.filetime {
  width: 120px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--color-text-3);
  text-align: right;
}

.preimg {
  max-width: 300px;
  max-height: 300px;
}

.preimg img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* 响应式 */
@media (max-width: 768px) {
  .filesize,
  .filetime {
    display: none;
  }

  .filename {
    margin-right: 8px;
  }
}
</style>
<style>
.file-browser-context-menu{position:fixed;z-index:2100;padding:5px;min-width:174px;background: var(--app-overlay-bg);border:1px solid var(--color-border-2);border-radius:12px;box-shadow:0 8px 24px #0004}.file-browser-context-menu button{display:flex;align-items:center;gap:7px;width:100%;border:0;border-radius:5px;background:transparent;padding:5px 9px;text-align:left;color:var(--color-text-1);font-size:13px;cursor:pointer}.file-browser-context-menu button svg{color:#ff8b25}.file-browser-context-menu button:hover:not(:disabled){background:var(--color-fill-2)}.file-browser-context-menu button:disabled{opacity:.4;cursor:not-allowed}body[arco-theme=dark] .file-browser-context-menu{background: var(--app-overlay-bg)}
</style>
