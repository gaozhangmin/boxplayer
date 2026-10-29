<template>
  <div class="media-library-nav">
    <!-- 扫描进度 -->
    <div v-if="mediaStore.isScanning" class="scan-progress-section">
      <div class="scan-header">
        <IconFont name="iconreload-1-icon" class="spin" />
        <span>{{ t('scan.scanning') }}</span>
      </div>
      <a-progress
        :percent="scanPercent"
        :show-info="false"
        :stroke-width="4"
        size="small"
      />
      <div class="scan-info">
        {{ mediaStore.scanProgress }}/{{ mediaStore.scanTotal }} {{ t('media.filesUnit') }}
      </div>
    </div>

<!--    &lt;!&ndash; 媒体库标题 &ndash;&gt;-->
<!--    <div class="media-library-title">-->
<!--      <h2>媒体库</h2>-->
<!--    </div>-->

    <!-- 媒体库主菜单 -->
    <div class="nav-section">
      <div class="nav-items">
        <div
          class="nav-item"
          :class="{ active: activeCategory === 'home' }"
          @click="handleCategoryClick('home')"
        >
          <House class="nav-icon" />
          <span>{{ t('nav.home') }}</span>
        </div>

        <!-- 搜索 -->
        <div
          class="nav-item"
          :class="{ active: activeCategory === 'search' }"
          @click="handleCategoryClick('search')"
        >
          <Search class="nav-icon" />
          <span>{{ t('nav.search') }}</span>
        </div>

        <!-- 继续观看 -->
        <div
          class="nav-item"
          :class="{ active: activeCategory === 'continue-watching' }"
          @click="handleCategoryClick('continue-watching')"
        >
          <CirclePlay class="nav-icon" />
          <span>{{ t('media.continueWatching') }}</span>
          <span v-if="mediaStore.continueWatching.length > 0" class="count">
            {{ mediaStore.continueWatching.length }}
          </span>
        </div>

        <!-- 最近添加 -->
        <div
          class="nav-item"
          :class="{ active: activeCategory === 'recently-added' }"
          @click="handleCategoryClick('recently-added')"
        >
          <Clock3 class="nav-icon" />
          <span>{{ t('media.recentlyAdded') }}</span>
          <span v-if="mediaStore.recentlyAdded.length > 0" class="count">
            {{ mediaStore.recentlyAdded.length }}
          </span>
        </div>

        <!-- 电影 -->
        <div
          class="nav-item"
          :class="{ active: activeCategory === 'movies' }"
          @click="handleCategoryClick('movies')"
        >
          <Film class="nav-icon" />
          <span>{{ t('media.movie') }}</span>
          <span v-if="mediaStore.mediaTypeCounts.movie > 0" class="count">
            {{ mediaStore.mediaTypeCounts.movie }}
          </span>
        </div>

        <!-- 电视剧 -->
        <div
          class="nav-item"
          :class="{ active: activeCategory === 'tv-shows' }"
          @click="handleCategoryClick('tv-shows')"
        >
          <Tv class="nav-icon" />
          <span>{{ t('media.tv') }}</span>
          <span v-if="mediaStore.mediaTypeCounts.tv > 0" class="count">
            {{ mediaStore.mediaTypeCounts.tv }}
          </span>
        </div>

        <!-- 纪录片 -->
        <div
          class="nav-item"
          :class="{ active: activeCategory === 'documentary' }"
          @click="handleCategoryClick('documentary')"
        >
          <Video class="nav-icon" />
          <span>{{ t('media.documentary') }}</span>
          <span v-if="documentaryCount > 0" class="count">
            {{ documentaryCount }}
          </span>
        </div>

        <!-- 动画 -->
        <div
          class="nav-item"
          :class="{ active: activeCategory === 'animation' }"
          @click="handleCategoryClick('animation')"
        >
          <Shapes class="nav-icon" />
          <span>{{ t('media.animation') }}</span>
          <span v-if="animationCount > 0" class="count">
            {{ animationCount }}
          </span>
        </div>

        <!-- 未匹配 -->
        <div
          class="nav-item"
          :class="{ active: activeCategory === 'unmatched' }"
          @click="handleCategoryClick('unmatched')"
        >
          <CircleHelp class="nav-icon" />
          <span>{{ t('media.unmatched') }}</span>
          <span v-if="mediaStore.mediaTypeCounts.unmatched > 0" class="count">
            {{ mediaStore.mediaTypeCounts.unmatched }}
          </span>
        </div>

        <!-- 未观看 -->
        <div
          class="nav-item"
          :class="{ active: activeCategory === 'unwatched' }"
          @click="handleCategoryClick('unwatched')"
        >
          <EyeOff class="nav-icon" />
          <span>{{ t('media.unwatched') }}</span>
        </div>

        <!-- 收藏 -->
        <div
          class="nav-item"
          :class="{ active: activeCategory === 'favorites' }"
          @click="handleCategoryClick('favorites')"
        >
          <Heart class="nav-icon" />
          <span>{{ t('tree.favorites') }}</span>
        </div>

        <!-- 播放列表 -->
        <div
          class="nav-item"
          :class="{ active: activeCategory === 'playlist' }"
          @click="handleCategoryClick('playlist')"
        >
          <ListVideo class="nav-icon" />
          <span>{{ t('media.playlist') }}</span>
        </div>
      </div>
    </div>

    <!-- 分类筛选 -->
    <div class="nav-section">
      <div class="nav-header">
        <span>{{ t('media.categories') }}</span>
      </div>

      <div class="nav-items">
        <!-- 类型 -->
        <div
          class="nav-item"
          :class="{ active: activeCategory === 'genres' }"
          @click="handleCategoryClick('genres')"
        >
          <Tags class="nav-icon" />
          <span>{{ t('media.genre') }}</span>
          <span v-if="mediaStore.genres.length > 0" class="count">
            {{ mediaStore.genres.length }}
          </span>
        </div>

        <!-- 评分 -->
        <div
          class="nav-item"
          :class="{ active: activeCategory === 'ratings' }"
          @click="handleCategoryClick('ratings')"
        >
          <Star class="nav-icon" />
          <span>{{ t('media.rating') }}</span>
          <span v-if="mediaStore.ratingCategories.length > 0" class="count">
            {{ mediaStore.ratingCategories.length }}
          </span>
        </div>

        <!-- 年份 -->
        <div
          class="nav-item"
          :class="{ active: activeCategory === 'years' }"
          @click="handleCategoryClick('years')"
        >
          <CalendarDays class="nav-icon" />
          <span>{{ t('media.year') }}</span>
          <span v-if="mediaStore.years.length > 0" class="count">
            {{ mediaStore.years.length }}
          </span>
        </div>
      </div>
    </div>

    <!-- 媒体库文件夹列表 -->
    <div class="nav-section" v-if="visibleVideoFolders.length > 0 || localDeviceFolders.length > 0">
      <div class="nav-header">
        <Folder class="nav-header-icon" />
        <span>{{ t('media.fileSources') }}</span>
      </div>

      <div class="nav-items">
        <template v-if="localDeviceFolders.length">
          <button class="nav-item folder-item local-device-root" type="button"
            :aria-expanded="localDeviceExpanded" @click="localDeviceExpanded = !localDeviceExpanded">
            <Folder class="nav-icon" />
            <span class="folder-name">{{ localDeviceName }}</span>
            <span aria-hidden="true"><ChevronDown v-if="localDeviceExpanded" :size="14" /><ChevronRight v-else :size="14" /></span>
          </button>
          <div v-if="localDeviceExpanded" class="local-device-folders">
            <div v-for="folder in localDeviceFolders" :key="folder.id"
              class="nav-item folder-item" :class="{ active: selectedFolder?.id === folder.id }"
              @click="openLocalFolder(folder)" @contextmenu="handleFolderRightClick($event, folder)">
              <Folder class="nav-icon" />
              <span class="folder-name">{{ folder.name }}</span>
              <button type="button" :aria-label="t(folder.isFavorite === false ? 'unified.addToFavorites' : 'unified.removeFavoriteFolder')" @click.stop="toggleLocalFavorite(folder)">
                <Star :size="16" :fill="folder.isFavorite === false ? 'none' : 'currentColor'" />
              </button>
            </div>
          </div>
        </template>
        <div v-for="folder in remoteSourceFolders" :key="folder.id" class="nav-item folder-item"
          :class="{ active: selectedFolder?.id === folder.id }"
          @click="handleFolderClick(folder)" @contextmenu="handleFolderRightClick($event, folder)">
          <Folder class="nav-icon" />
          <div class="folder-main">
            <span class="folder-name">{{ folder.name }}</span>
            <span class="folder-source" :class="getFolderSourceClass(folder)">{{ getFolderSourceLabel(folder) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 扫描操作 -->
    <div class="nav-scan-actions-wrapper">
      <LibraryScanPanel
        v-model:selected-ids="selectedScanSourceIds"
        :drive-options="scanSourceOptions"
        :is-scanning="mediaStore.isScanning"
        :idle-status-text="visibleVideoFolders.length ? `${visibleVideoFolders.length} ${t('media.sourcesUnit')}` : t('scan.notScanned')"
        :scanning-status-text="`${t('scan.scanning')} ${mediaStore.scanProgress}/${mediaStore.scanTotal}`"
        :import-label="t('media.importLocalVideo')"
        import-icon-name="iconfolder"
        :import-disabled="mediaStore.isScanning"
        :clear-confirm-text="t('media.clearConfirm')"
        :clear-disabled="!hasLibraryData"
        @start-scan="handleIncrementalScan"
        @stop-scan="mediaStore.setScanning(false)"
        @import-local="handleImportLocalFolder"
        @clear-library="handleClearLibrary"
      >
      </LibraryScanPanel>
    </div>

    <!-- 文件夹右键菜单 -->
    <a-dropdown
      id='medialibrarymenu'
      class='rightmenu'
      :popup-visible='showFolderMenu'
      :style="{
        position: 'fixed',
        left: menuPosition.x + 'px',
        top: menuPosition.y + 'px',
        zIndex: 9999,
        opacity: showFolderMenu ? 1 : 0
      }"
      @popup-visible-change="handleMenuClose"
    >
      <div style="width: 1px; height: 1px; visibility: hidden;" />
      <template #content>
        <a-doption @click="handleDeleteFolder" class="danger">
          <template #icon><IconFont name="icondelete" /></template>
          <template #default>{{ t('media.removeFromLibrary') }}</template>
        </a-doption>
      </template>
    </a-dropdown>

    <a-modal v-model:visible="showLocalBrowser" :title="localBrowserTitle" :footer="false">
      <button v-if="localBrowserPath" type="button" @click="localBrowserBack">{{ t('unified.back') }}</button>
      <template v-if="!localBrowserPath">
        <div v-for="folder in localDeviceFolders" :key="folder.id" class="local-browser-row">
          <button type="button" @click="openLocalFolder(folder)"><FolderClosed class="local-browser-icon" :size="34" /> {{ folder.name }}</button>
          <button class="local-browser-star" type="button" @click="toggleLocalFavorite(folder)" :aria-label="t(folder.isFavorite === false ? 'unified.addToFavorites' : 'unified.removeFavoriteFolder')">
            <Star :size="18" :fill="folder.isFavorite === false ? 'none' : 'currentColor'" />
          </button>
        </div>
      </template>
      <div v-for="entry in localBrowserEntries" v-else :key="entry.path" class="local-browser-row">
        <button type="button" @click="openLocalEntry(entry)">
          <FolderClosed v-if="entry.directory" class="local-browser-icon" :size="34" />
          <span v-else class="local-browser-video" aria-hidden="true"><Play :size="12" fill="currentColor" /></span>
          {{ entry.name }}
        </button>
      </div>
    </a-modal>
    <a-modal v-model:visible="showLocalNameModal" :title="t('libraryBrowse.addHome')" :ok-text="t('common.add')" :cancel-text="t('common.cancel')" @before-ok="confirmLocalFolderName">
      <a-input v-model="localFolderName" />
    </a-modal>
    <a-modal
      v-model:visible="showLibraryManagerModal"
      :title="t('media.manager')"
      :footer="false"
      width="520px"
    >
      <div class="library-manager-panel">
        <button type="button" class="library-manager-card" @click="handleLibraryManagerImport">
          <div class="library-manager-card-icon">
            <IconFont name="iconfolder" />
          </div>
          <div class="library-manager-card-main">
            <strong>{{ t('media.importLocalFolder') }}</strong>
            <span>{{ t('media.importLocalFolderDesc') }}</span>
          </div>
        </button>

      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ChevronDown, ChevronRight, CalendarDays, CircleHelp, CirclePlay, Clock3, EyeOff, Film, Folder, FolderClosed, Heart, House, ListVideo, Play, Search, Shapes, Star, Tags, Tv, Video } from 'lucide-vue-next'
import { useMediaLibraryStore } from '../store/medialibrary'
import type { MediaLibraryFolder } from '../types/media'
import type { IAliGetFileModel } from '../aliapi/alimodels'
import { Modal } from '@arco-design/web-vue'
import { MediaScanner } from '../utils/mediaScanner'
import message from '../utils/message'
import LibraryScanPanel from './LibraryScanPanel.vue'
import { getWebDavConnection, getWebDavConnectionId, getWebDavConnections } from '../utils/webdavClient'
import UserDAL from '../user/userdal'
import type { ITokenInfo } from '../user/userstore'
import { tokenRootScanFolders } from '../utils/fileSourceRoots'
import { t } from '../i18n'
import { buildLocalVideoPage, isLocalVideoPath } from '../down/integration/localVideoPlayback'

const mediaStore = useMediaLibraryStore()
const mediaScanner = MediaScanner.getInstance()

const visibleVideoFolders = computed(() => {
  const indexedFolderIds = new Set(mediaStore.mediaItems.map(item => item.folderId).filter(Boolean))
  return mediaStore.folders.filter(folder => folder.itemCount > 0 || indexedFolderIds.has(folder.id))
})

// 状态
const isLocalDeviceFolder = (folder: MediaLibraryFolder) =>
  folder.driveId === 'local' || folder.driveServerId === 'local' || folder.userId === 'local'
const localDeviceFolders = computed(() => mediaStore.folders.filter(isLocalDeviceFolder))
const remoteSourceFolders = computed(() => visibleVideoFolders.value.filter(folder => !isLocalDeviceFolder(folder)))
const localDeviceExpanded = ref(true)
const localDeviceName = /mac/i.test(navigator.platform) ? 'Mac' : t('unified.myComputer')
const showLocalBrowser = ref(false)
const localBrowserPath = ref('')
const localBrowserRoot = ref('')
const localBrowserName = ref('')
const localBrowserEntries = ref<{ name: string; path: string; directory: boolean }[]>([])
const localBrowserTitle = computed(() => localBrowserPath.value ? localBrowserName.value : localDeviceName)
const showLocalDevice = () => { localBrowserPath.value = ''; localBrowserEntries.value = []; showLocalBrowser.value = true }
const loadLocalDirectory = async (directory: string) => {
  const fs = window.require?.('fs'); const path = window.require?.('path')
  if (!fs || !path) return
  try {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true })
    localBrowserEntries.value = entries.filter((entry: { name: string; isDirectory: () => boolean }) => !entry.name.startsWith('.') && (entry.isDirectory() || isLocalVideoPath(entry.name)))
      .map((entry: { name: string; isDirectory: () => boolean }) => ({ name: entry.name, path: path.join(directory, entry.name), directory: entry.isDirectory() }))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    localBrowserPath.value = directory
    localBrowserName.value = directory === localBrowserRoot.value ? localBrowserName.value : path.basename(directory)
  } catch { message.error(t('media.importFailed')) }
}
const openLocalFolder = (folder: MediaLibraryFolder) => {
  localBrowserRoot.value = folder.path || folder.fileId; localBrowserName.value = folder.name; showLocalBrowser.value = true
  void loadLocalDirectory(localBrowserRoot.value)
}
const openLocalEntry = (entry: { path: string; directory: boolean }) => {
  if (entry.directory) void loadLocalDirectory(entry.path)
  else window.WebOpenWindow({ page: 'PageVideo', data: buildLocalVideoPage(entry.path), theme: 'dark' })
}
const localBrowserBack = () => {
  if (localBrowserPath.value === localBrowserRoot.value) { showLocalDevice(); return }
  const path = window.require?.('path'); if (path) void loadLocalDirectory(path.dirname(localBrowserPath.value))
}

const activeCategory = ref('home')
const selectedFolder = ref<MediaLibraryFolder | null>(null)
const selectedGenre = ref('')
const selectedYear = ref('')
const selectedRating = ref('')
const showAddFolderModal = ref(false)
const showLibraryManagerModal = ref(false)
const addFolderForm = ref({
  folderId: '',
  name: ''
})

// 右键菜单状态
const showFolderMenu = ref(false)
const menuPosition = ref({ x: 0, y: 0 })
const contextMenuFolder = ref<MediaLibraryFolder | null>(null)

// 计算属性
const folderTreeData = computed(() => {
  // 这里应该从实际的文件夹结构生成
  return [
    {
      title: t('drive.backup'),
      value: 'backup',
      children: [
        { title: t('media.movie'), value: 'backup_movies' },
        { title: t('media.tv'), value: 'backup_tv' }
      ]
    },
    {
      title: t('drive.resource'),
      value: 'resource',
      children: [
        { title: t('media.movie'), value: 'resource_movies' },
        { title: t('media.tv'), value: 'resource_tv' }
      ]
    }
  ]
})

// 方法
const selectFolder = (folder: MediaLibraryFolder) => {
  selectedFolder.value = folder
  selectedGenre.value = ''
  selectedYear.value = ''
  selectedRating.value = ''
  activeCategory.value = ''
  
  // 触发父组件更新
  emit('folderSelected', folder)
}

// 计算属性
const scanPercent = computed(() => {
  if (mediaStore.scanTotal === 0) return 0
  return Math.min(1, Math.max(0, mediaStore.scanProgress / mediaStore.scanTotal))
})

const documentaryCount = computed(() => mediaStore.mediaItems.filter((item) => {
  const genres = Array.isArray(item.genres) ? item.genres : []
  return genres.some((genre) => {
    const normalized = String(genre || '').trim().toLowerCase()
    return normalized === '99' || normalized.includes('纪录片')
  })
}).length)

const animationCount = computed(() => mediaStore.mediaItems.filter((item) => {
  const genres = Array.isArray(item.genres) ? item.genres : []
  return genres.some((genre) => {
    const normalized = String(genre || '').trim().toLowerCase()
    return normalized === '16' || normalized.includes('动画') || normalized.includes('动漫')
  })
}).length)

// 方法
const handleCategoryClick = (category: string) => {
  // 判断是否为分类聚合类型
  const aggregationCategories = ['genres', 'ratings', 'years']

  if (aggregationCategories.includes(category)) {
    // 分类聚合模式：显示分类卡片网格
    activeCategory.value = category
    selectedFolder.value = null
    selectedGenre.value = ''
    selectedYear.value = ''
    selectedRating.value = ''
    emit('categorySelected', category)
  } else {
    // 直接筛选模式：显示具体媒体内容
    activeCategory.value = category
    selectedFolder.value = null
    selectedGenre.value = ''
    selectedYear.value = ''
    selectedRating.value = ''
    emit('categorySelected', category)
  }
}

const handleFolderClick = (folder: MediaLibraryFolder) => {
  selectedFolder.value = folder
  activeCategory.value = ''
  console.log('Folder clicked:', folder.name, 'ID:', folder.id)
  emit('folderSelected', folder)
}

const isWebDavFolderSource = (folder: MediaLibraryFolder) => {
  const connectionIds = new Set(getWebDavConnections().map(item => item.id))
  return folder.driveServerId === 'webdav'
    || (folder.driveId || '').startsWith('webdav:')
    || (!!folder.userId && connectionIds.has(folder.userId))
    || folder.id.startsWith('webdav_')
}

const getFolderSourceLabel = (folder: MediaLibraryFolder) => {
  const connectionId = folder.userId || getWebDavConnectionId(folder.driveId)
  if (connectionId && getWebDavConnection(connectionId)?.kind === 'alist') return 'AList'
  if (isWebDavFolderSource(folder)) return 'WebDAV'
  if (folder.driveId === 'local' || folder.driveServerId === 'local') return t('drive.local')
  if (folder.driveId === 'cloud123' || folder.driveServerId === 'cloud123') return '123'
  if (folder.driveId === 'drive115' || folder.driveServerId === 'drive115') return '115'
  if (folder.driveId === 'baidu' || folder.driveServerId === 'baidu') return t('drive.baidu')
  if (folder.driveId === 'pikpak' || folder.driveServerId === 'pikpak') return 'PikPak'
  if (folder.driveId === 'quark' || folder.driveServerId === 'quark') return t('drive.quark')
  if (folder.driveId === 'dropbox' || folder.driveServerId === 'dropbox') return 'Dropbox'
  if (folder.driveId === 'onedrive' || folder.driveServerId === 'onedrive') return 'OneDrive'
  if (folder.driveId === 'box' || folder.driveServerId === 'box') return 'Box'
  if (folder.driveId === 'cloud139' || folder.driveServerId === 'cloud139') return '139'
  if (folder.driveId === 'cloud189' || folder.driveServerId === 'cloud189') return t('drive.cloud189Short')
  if (folder.driveId === 'guangya' || folder.driveServerId === 'guangya') return t('drive.guangyaShort')
  return t('drive.aliyunShort')
}

const getFolderSourceClass = (folder: MediaLibraryFolder) => {
  const connectionId = folder.userId || getWebDavConnectionId(folder.driveId)
  if (connectionId && getWebDavConnection(connectionId)?.kind === 'alist') return 'source-alist'
  if (isWebDavFolderSource(folder)) return 'source-webdav'
  if (folder.driveId === 'local' || folder.driveServerId === 'local') return 'source-local'
  if (folder.driveId === 'cloud123' || folder.driveServerId === 'cloud123') return 'source-123'
  if (folder.driveId === 'drive115' || folder.driveServerId === 'drive115') return 'source-115'
  if (folder.driveId === 'baidu' || folder.driveServerId === 'baidu') return 'source-baidu'
  if (folder.driveId === 'pikpak' || folder.driveServerId === 'pikpak') return 'source-pikpak'
  if (folder.driveId === 'quark' || folder.driveServerId === 'quark') return 'source-quark'
  if (folder.driveId === 'dropbox' || folder.driveServerId === 'dropbox') return 'source-dropbox'
  if (folder.driveId === 'onedrive' || folder.driveServerId === 'onedrive') return 'source-onedrive'
  if (folder.driveId === 'box' || folder.driveServerId === 'box') return 'source-box'
  if (folder.driveId === 'cloud139' || folder.driveServerId === 'cloud139') return 'source-cloud139'
  if (folder.driveId === 'cloud189' || folder.driveServerId === 'cloud189') return 'source-cloud189'
  if (folder.driveId === 'guangya' || folder.driveServerId === 'guangya') return 'source-guangya'
  return 'source-aliyun'
}

const selectedScanSourceIds = ref<string[]>([])
const scanAccounts = ref<ITokenInfo[]>([])

type ScanSourceTarget = {
  value: string
  label: string
  folder: IAliGetFileModel
  driveServerId: string
}

const getFolderScanSourceId = (folder: MediaLibraryFolder) => `folder:${folder.id}`

const scanSourceTargets = computed<ScanSourceTarget[]>(() => {
  const options = new Map<string, ScanSourceTarget>()
  for (const token of scanAccounts.value) {
    for (const target of tokenRootScanFolders(token)) {
      if (!options.has(target.value)) options.set(target.value, target)
    }
  }
  for (const folder of visibleVideoFolders.value) {
    const value = getFolderScanSourceId(folder)
    if (!value || options.has(value)) continue
    const folderModel = mediaFolderToAliModel(folder)
    options.set(value, {
      value,
      label: `${getFolderSourceLabel(folder)} · ${folder.name}`,
      folder: folderModel,
      driveServerId: folder.driveServerId || folder.driveId || 'local'
    })
  }
  return Array.from(options.values())
})

const scanSourceOptions = computed(() => scanSourceTargets.value.map(({ value, label }) => ({ value, label })))

const hasLibraryData = computed(() => {
  return mediaStore.mediaItemCount > 0
    || mediaStore.folders.length > 0
    || mediaStore.recentlyAdded.length > 0
    || mediaStore.continueWatching.length > 0
    || mediaStore.favorites.length > 0
    || mediaStore.watchedItems.length > 0
    || Object.keys(mediaStore.playlists || {}).length > 0
})

watch(scanSourceOptions, (options) => {
  const available = new Set(options.map((option) => option.value))
  const current = selectedScanSourceIds.value.filter((id) => available.has(id))
  selectedScanSourceIds.value = current.length || !options.length ? current : options.map((option) => option.value)
}, { immediate: true })


function mediaFolderToAliModel(folder: MediaLibraryFolder): IAliGetFileModel {
  const model = {
    __v_skip: true,
    drive_id: folder.driveId,
    file_id: folder.fileId,
    parent_file_id: '',
    name: folder.name,
    namesearch: folder.name.toLowerCase(),
    path: folder.path || '',
    ext: '',
    mime_type: '',
    mime_extension: '',
    category: 'folder',
    icon: '',
    size: 0,
    sizeStr: '',
    time: folder.scanDate ? new Date(folder.scanDate).getTime() : Date.now(),
    timeStr: '',
    starred: false,
    isDir: true,
    thumbnail: '',
    description: ''
  } as IAliGetFileModel
  ;(model as any).user_id = folder.userId || ''
  return model
}

// 处理文件夹右键菜单
const handleFolderRightClick = (event: MouseEvent, folder: MediaLibraryFolder) => {
  event.preventDefault()
  contextMenuFolder.value = folder
  menuPosition.value = {
    x: event.clientX,
    y: event.clientY
  }
  showFolderMenu.value = true
}

// 关闭右键菜单
const handleMenuClose = () => {
  showFolderMenu.value = false
  contextMenuFolder.value = null
}

// 删除文件夹
const handleDeleteFolder = () => {
  if (!contextMenuFolder.value) return

  const folder = contextMenuFolder.value
  Modal.confirm({
    title: t('media.deleteFolder'),
    content: `${t('media.deleteFolderConfirmPrefix')}${folder.name}${t('media.deleteFolderConfirmSuffix')}`,
    okText: t('file.delete'),
    okButtonProps: { status: 'danger' },
    cancelText: t('common.cancel'),
    onOk: () => {
      // 从媒体库删除文件夹和相关媒体
      mediaStore.removeFolder(folder.id)
      console.log(`已删除文件夹: ${folder.name}`)

      // 如果当前选中的是被删除的文件夹，清除选择
      if (selectedFolder.value?.id === folder.id) {
        selectedFolder.value = null
        activeCategory.value = 'home'
        emit('categorySelected', 'home')
      }

      handleMenuClose()
    }
  })
}

const selectGenre = (genre: string) => {
  selectedGenre.value = selectedGenre.value === genre ? '' : genre
  emit('genreSelected', selectedGenre.value)
}

const selectYear = (year: number) => {
  selectedYear.value = selectedYear.value === year.toString() ? '' : year.toString()
  emit('yearSelected', selectedYear.value)
}

const selectRating = (rating: string) => {
  selectedRating.value = selectedRating.value === rating ? '' : rating
  emit('ratingSelected', selectedRating.value)
}

const showLocalNameModal = ref(false)
const localFolderName = ref('')
const pendingLocalFolderPath = ref('')
const pendingLocalFavoriteId = ref('')
const toggleLocalFavorite = (folder: MediaLibraryFolder) => {
  if (folder.isFavorite === false) {
    pendingLocalFavoriteId.value = folder.id
    pendingLocalFolderPath.value = folder.path || folder.fileId
    localFolderName.value = folder.name
    showLocalNameModal.value = true
    return
  }
  Modal.confirm({
    title: t('unified.removeFavoriteFolder'), content: folder.name,
    okText: t('unified.removeFavoriteFolder'), cancelText: t('common.cancel'),
    onOk: () => {
      const current = mediaStore.folders.find(item => item.id === folder.id)
      if (current) mediaStore.addFolder({ ...current, isFavorite: false })
    }
  })
}
const confirmLocalFolderName = async () => {
  const name = localFolderName.value.trim()
  if (!name || !pendingLocalFolderPath.value) return false
  const path = pendingLocalFolderPath.value
  const existing = pendingLocalFavoriteId.value && mediaStore.folders.find(folder => folder.id === pendingLocalFavoriteId.value)
  if (pendingLocalFavoriteId.value && !existing) return false
  if (existing) mediaStore.addFolder({ ...existing, name, isFavorite: true })
  pendingLocalFolderPath.value = ''
  pendingLocalFavoriteId.value = ''
  await mediaScanner.scanLocalFolder(path, name)
  return true
}

const handleImportLocalFolder = () => {
  if (mediaStore.isScanning) return
  if (window.WebShowOpenDialogSync) {
    window.WebShowOpenDialogSync(
      {
        title: t('media.selectLocalFolder'),
        buttonLabel: t('settings.import'),
        properties: ['openDirectory', 'createDirectory']
      },
      async (result: string[] | undefined) => {
        if (!result || !result[0]) return
        const folderPath = result[0]
        pendingLocalFavoriteId.value = ''
        pendingLocalFolderPath.value = folderPath
        localFolderName.value = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folderPath
        showLocalNameModal.value = true
      }
    )
  } else {
    message.error(t('media.localFolderUnsupported'))
  }
}

const handleClearLibrary = () => {
  mediaStore.clearAllData()
  message.success(t('media.libraryCleared'))
}

const handleIncrementalScan = async () => {
  if (mediaStore.isScanning) return
  const selected = new Set(selectedScanSourceIds.value)
  const targets = selected.size ? scanSourceTargets.value.filter((target) => selected.has(target.value)) : scanSourceTargets.value
  if (!targets.length) {
    handleImportLocalFolder()
    return
  }
  try {
    mediaStore.setScanning(true)
    for (const target of targets) {
      await mediaScanner.scanFolder(target.folder, target.driveServerId, { incremental: true })
    }
  } catch (error) {
    console.error('增量扫描失败:', error)
    message.error(t('media.scanFailed'))
  } finally {
    mediaStore.setScanning(false)
  }
}

const handleAddFolder = () => {
  // 这里需要调用扫描服务
  console.log('Adding folder:', addFolderForm.value)
  showAddFolderModal.value = false
  addFolderForm.value = { folderId: '', name: '' }
}

// 暴露方法
const showAddFolderDialog = () => {
  showAddFolderModal.value = true
}

const openLibraryManager = () => {
  showLibraryManagerModal.value = true
}

const handleLibraryManagerImport = () => {
  showLibraryManagerModal.value = false
  handleImportLocalFolder()
}

const syncActiveCategory = (category: string) => {
  activeCategory.value = category
  selectedFolder.value = null
  selectedGenre.value = ''
  selectedYear.value = ''
  selectedRating.value = ''
}

const syncSelectedFolder = (folder: MediaLibraryFolder) => {
  selectedFolder.value = folder
  activeCategory.value = ''
  selectedGenre.value = ''
  selectedYear.value = ''
  selectedRating.value = ''
}

// 事件
const emit = defineEmits([
  'folderSelected',
  'categorySelected',
  'genreSelected',
  'yearSelected',
  'ratingSelected',
  'refresh',
  'categoryDrillDown'
])

// 暴露给父组件的方法
defineExpose({
  showLocalDevice,
  showAddFolderDialog,
  importLocalFolder: handleImportLocalFolder,
  removeFolder: (folder: MediaLibraryFolder) => {
    contextMenuFolder.value = folder
    handleDeleteFolder()
  },
  openLibraryManager,
  syncActiveCategory,
  syncSelectedFolder
})

// 添加全局点击监听器来关闭右键菜单
const handleGlobalClick = (event: MouseEvent) => {
  // 检查点击是否在菜单外部
  const target = event.target as HTMLElement
  if (!target.closest('.media-library-menu')) {
    showFolderMenu.value = false
  }
}

onMounted(async () => {
  const users = await UserDAL.GetUserListFromDB().catch(() => [])
  scanAccounts.value = users.filter((u) => !!u?.user_id && !!u?.access_token)
  document.addEventListener('click', handleGlobalClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
})
</script>

<style scoped>
.media-library-nav {
  height: 100%;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(circle at 42% 0%, rgba(0, 245, 212, 0.12), transparent 34%),
    radial-gradient(circle at 0% 86%, rgba(244, 210, 138, 0.07), transparent 26%),
    linear-gradient(180deg, rgba(14, 16, 20, 0.8), rgba(8, 9, 11, 0.94));
  border-right: 1px solid rgba(255, 255, 255, 0.075);
  overflow-y: auto;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  display: flex;
  flex-direction: column;
}

.media-library-title {
  padding: 20px 24px 16px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.075);
  background:
    radial-gradient(circle at 10% 0%, rgba(255, 255, 255, 0.09), transparent 32%),
    rgba(255, 255, 255, 0.042);
}

.media-library-title h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.92);
  line-height: 1.2;
  letter-spacing: -0.5px;
}


.scan-progress-section {
  padding: 16px;
  margin: 16px 16px 0 16px;
  background:
    radial-gradient(circle at 10% 0%, rgba(255, 255, 255, 0.09), transparent 32%),
    rgba(255, 255, 255, 0.042);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.075);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.065);
}

.scan-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary-6);
}

.scan-info {
  font-size: 12px;
  color: var(--color-text-2);
  text-align: center;
  margin-top: 8px;
  font-weight: 500;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.nav-section {
  margin-bottom: 22px;
}

.nav-section:first-child {
  margin-top: 20px;
}

.nav-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px;
  margin-bottom: 16px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-2);
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

.nav-header i {
  font-size: 16px;
  width: 16px;
  text-align: center;
  color: var(--color-primary-6);
}

.nav-items {
  padding: 0 12px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  padding: 6px 10px;
  margin-bottom: 3px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 500;
  color: var(--color-text-2);
  cursor: pointer;
  transition: background-color 0.18s ease, color 0.18s ease;
  user-select: none;
  position: relative;
  background: transparent;
  min-width: 0;
  white-space: nowrap;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.055);
  color: var(--color-text-1);
}

.nav-item.active {
  background: rgba(82, 122, 255, 0.14);
  color: rgba(255, 255, 255, 0.96);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px rgba(102, 142, 255, 0.08);
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 9px;
  bottom: 9px;
  width: 2px;
  background: #5b8cff;
  border-radius: 0 2px 2px 0;
}

.nav-item > .nav-icon {
  width: 32px;
  height: 32px;
  padding: 6px;
  border-radius: 8px;
  flex-shrink: 0;
  color: inherit;
  stroke-width: 1.8;
  transition: background-color 0.18s ease, color 0.18s ease;
}

.nav-item:hover > .nav-icon {
  background: rgba(255, 255, 255, 0.06);
}

.nav-item.active > .nav-icon {
  background: rgba(82, 122, 255, 0.18);
  color: #6f9cff;
}

.nav-header-icon {
  width: 16px;
  height: 16px;
  color: var(--color-primary-6);
  stroke-width: 1.8;
}

.nav-item > span:first-of-type {
  flex: 1;
  line-height: 1.4;
  font-weight: inherit;
  min-width: 0;
  overflow: visible;
  text-overflow: clip;
  white-space: nowrap;
}

.nav-item .count {
  margin-left: auto;
  font-size: 12px;
  font-weight: 700;
  background: var(--color-neutral-4);
  color: var(--color-text-2);
  padding: 4px 10px;
  border-radius: 20px;
  min-width: 24px;
  text-align: center;
  line-height: 1.2;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
}

.nav-item.active .count {
  background: var(--color-primary-6);
  color: white;
  box-shadow: 0 2px 8px rgba(var(--primary-6), 0.4);
}

.nav-item .count.error {
  background: linear-gradient(135deg, var(--color-danger-6), var(--color-danger-5));
  color: white;
  box-shadow: 0 2px 8px rgba(var(--danger-6), 0.4);
}

.folder-item .folder-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.folder-item .folder-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

.folder-source {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.4;
  font-weight: 700;
  letter-spacing: 0.2px;
  border: 1px solid transparent;
}

.folder-source.source-aliyun {
  color: #1677ff;
  background: rgba(22, 119, 255, 0.1);
  border-color: rgba(22, 119, 255, 0.18);
}

.folder-source.source-123 {
  color: #f08c00;
  background: rgba(240, 140, 0, 0.12);
  border-color: rgba(240, 140, 0, 0.18);
}

.folder-source.source-115 {
  color: #2b8a3e;
  background: rgba(43, 138, 62, 0.12);
  border-color: rgba(43, 138, 62, 0.18);
}

.folder-source.source-baidu {
  color: #5f3dc4;
  background: rgba(95, 61, 196, 0.12);
  border-color: rgba(95, 61, 196, 0.18);
}

.folder-source.source-pikpak {
  color: #0f766e;
  background: rgba(15, 118, 110, 0.12);
  border-color: rgba(15, 118, 110, 0.18);
}

.folder-source.source-quark {
  color: #f59f00;
  background: rgba(245, 159, 0, 0.12);
  border-color: rgba(245, 159, 0, 0.18);
}

.folder-source.source-dropbox,
.folder-source.source-onedrive,
.folder-source.source-box,
.folder-source.source-cloud139 {
  color: #228be6;
  background: rgba(34, 139, 230, 0.12);
  border-color: rgba(34, 139, 230, 0.18);
}

.folder-source.source-cloud189 {
  color: #f76707;
  background: rgba(247, 103, 7, 0.12);
  border-color: rgba(247, 103, 7, 0.18);
}

.folder-source.source-guangya {
  color: #0ca678;
  background: rgba(12, 166, 120, 0.12);
  border-color: rgba(12, 166, 120, 0.18);
}

.folder-source.source-local {
  color: #495057;
  background: rgba(73, 80, 87, 0.1);
  border-color: rgba(73, 80, 87, 0.16);
}

.folder-source.source-webdav {
  color: #0b7285;
  background: rgba(11, 114, 133, 0.12);
  border-color: rgba(11, 114, 133, 0.18);
}

.folder-source.source-alist {
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.12);
  border-color: rgba(124, 58, 237, 0.2);
}

.nav-actions {
  padding: 24px;
  border-top: 1px solid var(--color-neutral-3);
  margin-top: auto;
  background: var(--color-bg-2);
}
.nav-scan-actions-wrapper {
  margin: 18px 12px 0;
}

.nav-actions .arco-btn {
  width: 100%;
  height: 44px;
  justify-content: flex-start;
  gap: 14px;
  font-weight: 600;
  font-size: 14px;
  border-radius: 12px;
  border: 1px solid var(--color-neutral-3);
  background: var(--color-bg-1);
  transition: all 0.3s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.nav-actions .arco-btn + .arco-btn {
  margin-top: 10px;
}

.nav-actions .arco-btn:hover {
  background: linear-gradient(135deg, var(--color-primary-light-1), var(--color-primary-light-2));
  border-color: var(--color-primary-6);
  color: var(--color-primary-6);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--primary-6), 0.2);
}

.nav-actions .arco-btn i {
  font-size: 18px;
  transition: transform 0.2s ease;
}

.nav-actions .arco-btn:hover i {
  transform: scale(1.1);
}

.library-manager-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.library-manager-card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.88);
  text-align: left;
  cursor: pointer;
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(20px) saturate(135%);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.library-manager-card:hover {
  transform: translateY(-2px);
  border-color: rgba(96, 165, 250, 0.24);
  box-shadow: 0 22px 42px rgba(96, 165, 250, 0.14);
}

.library-manager-card-icon {
  width: 50px;
  height: 50px;
  flex: 0 0 50px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(219, 234, 254, 0.74), rgba(191, 219, 254, 0.46));
  color: #2563eb;
}

.library-manager-card-icon .iconfont {
  font-size: 24px;
}

.library-manager-card-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.library-manager-card-main strong {
  font-size: 16px;
  color: #111827;
}

.library-manager-card-main span {
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

/* 深色模式适配 */
[arco-theme='dark'] .media-library-nav {
  background-color: var(--color-bg-2);
  border-right-color: var(--color-neutral-4);
}

[arco-theme='dark'] .media-library-title {
  background: linear-gradient(135deg, var(--color-bg-2), var(--color-bg-3));
  border-bottom-color: var(--color-neutral-4);
}

[arco-theme='dark'] .media-library-title h2 {
  color: var(--color-text-1);
}

[arco-theme='dark'] .scan-progress-section {
  background: linear-gradient(135deg, rgba(var(--primary-6), 0.15), rgba(var(--primary-6), 0.1));
  border-color: rgba(var(--primary-6), 0.3);
}

[arco-theme='dark'] .nav-item:hover {
  background: rgba(255, 255, 255, 0.055);
}

[arco-theme='dark'] .nav-item.active {
  background: rgba(82, 122, 255, 0.14);
}

[arco-theme='dark'] .nav-actions {
  background: var(--color-bg-3);
  border-top-color: var(--color-neutral-4);
}

[arco-theme='dark'] .nav-actions .arco-btn {
  background: var(--color-bg-2);
  border-color: var(--color-neutral-4);
}

[arco-theme='dark'] .library-manager-card {
  border-color: rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, rgba(28, 33, 44, 0.88), rgba(18, 22, 30, 0.8));
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.24);
}

[arco-theme='dark'] .library-manager-card-icon {
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.26), rgba(30, 64, 175, 0.18));
  color: #bfdbfe;
}

[arco-theme='dark'] .library-manager-card-main strong {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .library-manager-card-main span {
  color: rgba(203, 213, 225, 0.78);
}

/* 响应式设计 */
@media (max-width: 1200px) {
  .media-library-title {
    padding: 16px 20px 12px 20px;
  }

  .media-library-title h2 {
    font-size: 18px;
  }

  .nav-section {
    margin-bottom: 20px;
  }

  .nav-header {
    padding: 0 20px;
    font-size: 13px;
    gap: 10px;
  }

  .nav-item {
    padding: 6px 10px;
    gap: 12px;
    font-size: 14px;
  }

  .nav-items {
    padding: 0 12px;
  }

  .nav-actions {
    padding: 20px;
  }

  .nav-actions .arco-btn {
    height: 40px;
    font-size: 13px;
  }
}

/* 滚动条美化 */
.media-library-nav::-webkit-scrollbar {
  width: 6px;
}

.media-library-nav::-webkit-scrollbar-track {
  background: var(--color-bg-2);
}

.media-library-nav::-webkit-scrollbar-thumb {
  background: var(--color-neutral-4);
  border-radius: 3px;
}

.media-library-nav::-webkit-scrollbar-thumb:hover {
  background: var(--color-neutral-5);
}

/* 焦点状态优化 */
.nav-item:focus-visible {
  outline: 2px solid var(--color-primary-6);
  outline-offset: 2px;
}

/* 右键菜单样式 */
.rightmenu .arco-dropdown-option.danger {
  color: var(--color-danger-6);
}

.rightmenu .arco-dropdown-option.danger:hover {
  background-color: var(--color-danger-light-1);
  color: var(--color-danger-6);
}
</style>

<style scoped>
.local-device-root { width: 100%; border: 0; background: transparent; color: inherit; text-align: left; font: inherit; }
.local-device-root .folder-name { flex: 1; }
.local-device-folders { padding-left: 22px; }
.local-device-folders button, .local-browser-row button { border: 0; background: transparent; color: var(--color-text-1); cursor: pointer; }
.local-device-folders button:last-child, .local-browser-star { color: #ff8a00 !important; }
.local-browser-row { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 0 20px; background: var(--color-fill-2); border-bottom: 1px solid var(--color-border-2); }
.local-browser-row button:first-child { display: flex; align-items: center; gap: 20px; flex: 1; min-width: 0; text-align: left; font-size: 18px; }
.local-browser-icon, .local-browser-video { flex: 0 0 34px; color: #ff8a00; }
.local-browser-video { display: grid; place-items: center; width: 30px; height: 24px; box-sizing: border-box; border: 2px solid currentColor; border-radius: 3px; }
</style>
