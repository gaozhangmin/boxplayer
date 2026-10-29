<template>
  <div class="media-library-view" :class="{ 'unified-folder-view': props.unifiedFiles }">
    <div class="media-library-shell">
      <!-- 左侧导航 -->
      <div v-show="props.navVisible ?? true" class="library-sidebar">
        <MediaLibraryNav
          ref="mediaNav"
          @folderSelected="handleFolderSelected"
          @categorySelected="handleCategorySelected"
          @genreSelected="handleGenreSelected"
          @yearSelected="handleYearSelected"
          @ratingSelected="handleRatingSelected"
          @refresh="handleRefresh"
          @categoryDrillDown="handleCategoryDrillDown"
        />
      </div>

      <!-- 右侧内容 -->
      <div class="media-library-pane">
        <MediaLibrary
          ref="mediaLibrary"
          :unified-files="props.unifiedFiles"
          :folder-descending="props.folderDescending"
          @detailVisibilityChange="emit('detailVisibilityChange', $event)"
          @tagTitleChange="emit('tagTitleChange', $event)"
          :unifiedBrowse="props.unifiedBrowse"
          :browseMode="props.browseMode"
          :localOnly="props.localOnly"
          :browseSort="props.browseSort"
          :browse-sort-descending="props.browseSortDescending"
          :browseSelection="props.browseSelection"
          :activeCategory="activeCategory"
          :selectedFolder="selectedFolder"
          :selectedGenre="selectedGenre"
          :selectedYear="selectedYear"
          :selectedRating="selectedRating"
          :fromHomeNavigation="homeNavigationActive"
          @categoryDrillDown="handleCategoryDrillDown"
          @categoryDrillBack="handleCategoryDrillBack"
          @navigateCategory="handleHomeNavigateCategory"
          @navigateFolder="handleFolderSelected"
          @homeNavigationBack="handleHomeNavigationBack"
          @manageLibrary="handleManageLibrary"
        />
      </div>
    </div>
    
    <!-- 扫描进度对话框 -->
    <a-modal
      v-model:visible="showScanProgress"
      title="扫描媒体文件"
      :closable="false"
      :mask-closable="false"
    >
      <template #footer>
        <!-- 无底部按钮 -->
      </template>
      <div class="scan-progress">
        <a-progress
          :percent="scanPercent"
          :show-info="true"
        />
        <p class="scan-info">
          正在扫描: {{ scanCurrent }}/{{ scanTotal }} 个文件
        </p>
      </div>
    </a-modal>

    <!-- 断点续刮提示 -->
    <a-modal
      v-model:visible="showResumeDialog"
      title="继续刮削？"
      :closable="true"
      :mask-closable="false"
      @ok="handleResumeScan"
      @cancel="handleCancelResume"
    >
      <p>检测到上次刮削未完成：<strong>{{ resumeInfo?.folderName }}</strong></p>
      <p style="color: var(--color-text-3);">是否从断点继续？已刮削完成的文件将跳过。</p>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { compareMediaBrowseValues, nextMediaBrowseSort, type MediaBrowseSort } from '../utils/mediaBrowseSort'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import MediaLibraryNav from '../components/MediaLibraryNav.vue'
import MediaLibrary from '../components/MediaLibrary.vue'
import { useMediaLibraryStore } from '../store/medialibrary'
import { usePanTreeStore } from '../store'
import { MediaScanner } from '../utils/mediaScanner'
import UserDAL from '../user/userdal'
import message from '../utils/message'
import type { MediaLibraryFolder } from '../types/media'
import type { IAliGetFileModel } from '../aliapi/alimodels'
import { isAliyunUser, isBaiduUser, isBoxUser, isCloud123User, isDrive115User, isDropboxUser, isGoogleUser, isOneDriveUser, isPikPakUser, isQuarkUser } from '../aliapi/utils'
import AliDirFileList from '../aliapi/dirfilelist'
import { apiBaiduFileList, mapBaiduFileToAliModel } from '../cloudbaidu/dirfilelist'
import { getWebDavConnection, getWebDavConnectionId, isWebDavDrive, listWebDavDirectory } from '../utils/webdavClient'
import { resolveDriveFileToken } from '../drive/account'

const mediaStore = useMediaLibraryStore()
const panTreeStore = usePanTreeStore()
const mediaScanner = MediaScanner.getInstance()

const mediaNav = ref()
const mediaLibrary = ref()

// Props
const props = withDefaults(defineProps<{
  navVisible?: boolean
  unifiedBrowse?: boolean
  unifiedFiles?: boolean
  folderDescending?: boolean
  browseMode?: 'grid' | 'list'
  localOnly?: boolean
  browseSort?: MediaBrowseSort
  browseSortDescending?: boolean
  browseSelection?: boolean
}>(), { browseSortDescending: undefined })
const emit = defineEmits<{ tagTitleChange: [title: string]; detailVisibilityChange: [visible: boolean]; browseContextChange: [context: { folderId: string; category: string }] }>()

// 状态
const showScanProgress = ref(false)
const activeCategory = ref('all')
const selectedFolder = ref<MediaLibraryFolder>()
watch([selectedFolder, activeCategory], () => emit('browseContextChange', { folderId: selectedFolder.value?.id || '', category: activeCategory.value }))
const selectedGenre = ref('')
const selectedYear = ref('')
const selectedRating = ref('')
const homeNavigationActive = ref(false)
const workspaceMode = ref<'library' | 'tvbox'>('library')
const scanPercent = computed(() => {
  if (mediaStore.scanTotal === 0) return 0
  return Math.min(1, Math.max(0, mediaStore.scanProgress / mediaStore.scanTotal))
})
const scanCurrent = computed(() => mediaStore.scanProgress)
const scanTotal = computed(() => mediaStore.scanTotal)

const resetDrillDownFilters = () => {
  selectedGenre.value = ''
  selectedYear.value = ''
  selectedRating.value = ''
}

const isSameFolderSource = (candidate: MediaLibraryFolder | undefined, folder: MediaLibraryFolder) => {
  if (!candidate) return false
  if (candidate.id && folder.id && candidate.id === folder.id) return true
  if (candidate.fileId && folder.fileId && candidate.fileId === folder.fileId && candidate.driveId === folder.driveId) return true
  if (candidate.path && folder.path && candidate.path === folder.path && candidate.driveId === folder.driveId) return true
  return false
}

const inferFolderContextFromMedia = (folder: MediaLibraryFolder) => {
  const relatedItems = mediaStore.mediaItems.filter((item) => {
    if (item.folderId && folder.id && item.folderId === folder.id) return true
    if (item.folderPath && folder.path && item.folderPath === folder.path) return true
    return false
  })

  for (const item of relatedItems) {
    for (const file of item.driveFiles || []) {
      if (file.userId || file.driveId) {
        return {
          userId: file.userId || '',
          driveId: file.driveId || folder.driveId || ''
        }
      }
    }
  }

  return {
    userId: '',
    driveId: folder.driveId || ''
  }
}

const resolveFolderRuntimeContext = async (folder: MediaLibraryFolder): Promise<{ userId: string; driveId: string }> => {
  const inferred = inferFolderContextFromMedia(folder)
  const driveId = folder.driveId || inferred.driveId || folder.driveServerId || panTreeStore.drive_id
  const token = await resolveDriveFileToken({ drive_id: driveId, user_id: folder.userId || inferred.userId }, panTreeStore.user_id)

  return {
    userId: token?.user_id || '',
    driveId
  }
}

// 方法
const handleFolderSelected = async (folder: MediaLibraryFolder) => {
  homeNavigationActive.value = false
  mediaNav.value?.syncSelectedFolder?.(folder)
  selectedFolder.value = folder
  activeCategory.value = ''
  resetDrillDownFilters()
  console.log('Selected folder:', folder)

  // 直接加载文件夹内容并显示
  await loadFolderContent(folder)
}

const selectDriveRoots = (name: string, id: string, userId: string, drives: IAliGetFileModel[]) => {
  homeNavigationActive.value = false
  const folder: MediaLibraryFolder = { id, fileId: 'root', name, path: '/', userId,
    driveId: 'aliyun', driveServerId: 'aliyun', scanDate: new Date(), itemCount: drives.length }
  selectedFolder.value = folder
  activeCategory.value = ''
  resetDrillDownFilters()
  mediaLibrary.value?.showRootFolderFiles(drives, folder)
}

// 加载文件夹内容 - 直接显示文件列表
const loadFolderContent = async (folder: MediaLibraryFolder) => {
  try {
    if (folder.driveId === 'local') {
      await loadLocalFolderContent(folder)
      return
    }
    if (isWebDavDrive(folder.driveId, folder.driveServerId)) {
      const connectionId = folder.userId || getWebDavConnectionId(folder.driveId)
      const connection = getWebDavConnection(connectionId || '')
      if (!connection) {
        message.error('WebDAV 连接信息不存在，请重新连接')
        return
      }
      const items = await listWebDavDirectory(connection, folder.path || folder.fileId || '/')
      items.forEach((item: any) => { item.user_id = folder.userId || connection.id })
      if (items.length > 0) {
        mediaLibrary.value?.showFolderFiles(items, folder)
      } else {
        console.log(`WebDAV 文件夹 ${folder.name} 为空或加载失败`)
        message.info('文件夹为空或加载失败')
      }
      return
    }
    console.log('Loading folder file list:', folder.name, 'ID:', folder.id, 'Drive:', folder.driveId, 'Server:', folder.driveServerId)

    // 使用 fileId 字段，如果不存在则从复合ID中提取
    const fileId = folder.fileId || (folder.id.includes('_') ? folder.id.split('_')[1] : folder.id)
    const runtimeContext = await resolveFolderRuntimeContext(folder)
    const userId = runtimeContext.userId
    const driveId = runtimeContext.driveId
    if (!userId || !driveId) {
      message.error('未找到该媒体库文件夹对应的已登录账号')
      return
    }

    if (!isSameFolderSource(selectedFolder.value, folder)) {
      selectedFolder.value = {
        ...folder,
        userId,
        driveId
      }
    } else {
      selectedFolder.value = {
        ...(selectedFolder.value as MediaLibraryFolder),
        userId,
        driveId
      }
    }

    if (!folder.id.startsWith('account:') && !folder.id.startsWith('webdav:')) {
      mediaStore.addFolder({ ...folder, userId, driveId })
    }

    console.warn('[MediaLibraryDebug] loadFolderContent context', {
      folderId: folder.id,
      folderName: folder.name,
      folderFileId: folder.fileId,
      folderPath: folder.path,
      originalUserId: folder.userId,
      originalDriveId: folder.driveId,
      resolvedUserId: userId,
      resolvedDriveId: driveId
    })

    console.log('Using file_id:', fileId, 'userId:', userId, 'driveId:', driveId)

    let items: any[] = []

    if (isCloud123User(userId) || driveId === 'cloud123') {
      // 123云盘
      const { apiCloud123FileList, mapCloud123FileToAliModel } = await import('../cloud123/dirfilelist')
      const list = await apiCloud123FileList(userId, fileId, 100)
      items = list.map((item) => {
        const mapped = mapCloud123FileToAliModel(item)
        mapped.drive_id = driveId
        ;(mapped as any).user_id = userId
        return mapped
      })
      console.log('使用123云盘API获取文件列表')
    } else if (isDrive115User(userId) || driveId === 'drive115') {
      // 115网盘
      const { apiDrive115FileList, mapDrive115FileToAliModel } = await import('../cloud115/dirfilelist')
      const list = await apiDrive115FileList(userId, fileId, 200, 0, true)
      items = list.map((item) => { const mapped = mapDrive115FileToAliModel(item, driveId); (mapped as any).user_id = userId; return mapped })
      console.log('使用115网盘API获取文件列表')
    } else if (isBaiduUser(userId) || driveId === 'baidu') {
      // 百度网盘 - 需要使用路径而不是fileId
      const parentPath = folder.path || folder.fileId || '/'
      const list = await apiBaiduFileList(userId, parentPath, 'name', 0, 1000)
      items = list.map((item) => { const mapped = mapBaiduFileToAliModel(item, driveId, parentPath); (mapped as any).user_id = userId; return mapped })
      console.log('使用百度网盘API获取文件列表，路径:', parentPath)
    } else if (isPikPakUser(userId) || driveId === 'pikpak') {
      const { apiPikPakFileList, mapPikPakFileToAliModel } = await import('../pikpak/dirfilelist')
      const parentId = fileId === 'pikpak_root' ? 'pikpak_root' : fileId
      const { items: list } = await apiPikPakFileList(userId, parentId, 100)
      items = list.map((item) => { const mapped = mapPikPakFileToAliModel(item, driveId, parentId); (mapped as any).user_id = userId; return mapped })
      console.log('使用PikPak API获取文件列表')
    } else if (driveId === 'cloud139') {
      const { apiCloud139FileList, mapCloud139FileToAliModel } = await import('../cloud139/dirfilelist')
      const list = await apiCloud139FileList(userId, fileId, 200)
      items = list.map(item => ({ ...mapCloud139FileToAliModel(item, driveId, fileId), user_id: userId }))
    } else if (driveId === 'cloud189') {
      const { apiCloud189FileList, mapCloud189FileToAliModel } = await import('../cloud189/dirfilelist')
      const list = await apiCloud189FileList(userId, fileId, 200)
      items = list.map(item => ({ ...mapCloud189FileToAliModel(item, driveId, fileId), user_id: userId }))
    } else if (driveId === 'guangya') {
      const { apiGuangyaFileList, mapGuangyaFileToAliModel } = await import('../guangya/dirfilelist')
      const list = await apiGuangyaFileList(userId, fileId, 200)
      items = list.map(item => ({ ...mapGuangyaFileToAliModel(item, driveId, fileId), user_id: userId }))
    } else if (isQuarkUser(userId) || driveId === 'quark') {
      const { apiQuarkFileList, mapQuarkFileToAliModel } = await import('../quark/dirfilelist')
      const parentId = fileId === 'quark_root' ? '0' : fileId
      const { items: list } = await apiQuarkFileList(userId, parentId, 200)
      items = list.map((item) => { const mapped = mapQuarkFileToAliModel(item, driveId, fileId); (mapped as any).user_id = userId; return mapped })
      console.log('使用夸克网盘 API获取文件列表')
    } else if (isDropboxUser(userId) || driveId === 'dropbox') {
      const { apiDropboxFileList, mapDropboxFileToAliModel } = await import('../dropbox/dirfilelist')
      const parentId = fileId === 'dropbox_root' ? 'dropbox_root' : fileId
      const list = await apiDropboxFileList(userId, parentId, 500)
      items = list.map((item) => { const mapped = mapDropboxFileToAliModel(item, driveId, parentId); (mapped as any).user_id = userId; return mapped })
      console.log('使用Dropbox API获取文件列表')
    } else if (isOneDriveUser(userId) || driveId === 'onedrive') {
      const { apiOneDriveFileList, mapOneDriveItemToAliModel } = await import('../onedrive/dirfilelist')
      const parentId = fileId === 'onedrive_root' ? 'onedrive_root' : fileId
      const list = await apiOneDriveFileList(userId, parentId)
      items = list.map((item) => { const mapped = mapOneDriveItemToAliModel(item, driveId, parentId); (mapped as any).user_id = userId; return mapped })
      console.log('使用OneDrive API获取文件列表')
    } else if (isBoxUser(userId) || driveId === 'box') {
      const { apiBoxFileList, mapBoxItemToAliModel } = await import('../box/dirfilelist')
      const parentId = fileId === 'box_root' ? 'box_root' : fileId
      const list = await apiBoxFileList(userId, parentId, 500)
      items = list.map((item) => { const mapped = mapBoxItemToAliModel(item, driveId, parentId); (mapped as any).user_id = userId; return mapped })
      console.log('使用Box API获取文件列表')
    } else if (isGoogleUser(userId) || driveId === 'google') {
      const { apiGoogleFileList, mapGoogleFileToAliModel } = await import('../google/dirfilelist')
      const parentId = fileId === 'google_root' ? 'google_root' : fileId
      const list = await apiGoogleFileList(userId, parentId, 500)
      items = list.map((item) => { const mapped = mapGoogleFileToAliModel(item, driveId, parentId); (mapped as any).user_id = userId; return mapped })
      console.log('使用 Google Drive API 获取文件列表')
    } else if (isAliyunUser(userId)) {
      // 阿里云盘（默认）
      const result = await AliDirFileList.ApiDirFileList(
        userId,
        driveId,
        fileId,
        folder.name,
        'name asc',
        '',
        undefined,
        false
      )
      items = (result?.items || []).map((item: any) => ({ ...item, user_id: userId }))
      console.log('使用阿里云盘API获取文件列表')
    } else {
      console.warn('[MediaLibraryView] skip Aliyun file list for non-Aliyun source', {
        userId,
        driveId,
        fileId
      })
    }

    if (items && items.length > 0) {
      console.log(`文件夹 ${folder.name} 包含 ${items.length} 个项目`)
      // 直接将文件列表传递给 MediaLibrary 组件显示
      mediaLibrary.value?.showFolderFiles(items, folder)
    } else if (folder.id.startsWith('account:')) {
      mediaLibrary.value?.showFolderFiles([], folder)
    } else {
      console.log(`文件夹 ${folder.name} 为空或加载失败`)
      message.info('文件夹为空或加载失败')
    }
  } catch (error) {
    console.error('加载文件夹内容失败:', error)
    message.error('加载文件夹内容失败')
  }
}

const loadLocalFolderContent = async (folder: MediaLibraryFolder) => {
  try {
    const fs = window.require?.('fs')
    const path = window.require?.('path')
    if (!fs || !path) {
      message.error('当前环境不支持浏览本地文件夹')
      return
    }

    const folderPath = folder.path || folder.fileId
    if (!folderPath) {
      message.error('本地文件夹路径为空')
      return
    }

    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
    const items = []
    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name)
      const stat = await fs.promises.stat(fullPath)
      items.push({
        name: entry.name,
        file_id: fullPath,
        isDir: entry.isDirectory(),
        ext: entry.isDirectory() ? '' : path.extname(entry.name).replace('.', ''),
        size: stat.size || 0,
        category: entry.isDirectory() ? 'folder' : 'video',
        description: '',
        drive_id: 'local',
        parent_file_id: folderPath
      })
    }

    mediaLibrary.value?.showFolderFiles(items, folder)
  } catch (error) {
    console.error('加载本地文件夹失败:', error)
    message.error('加载本地文件夹失败')
  }
}

// 检查是否为视频文件
const isVideoFile = (filename: string): boolean => {
  const VIDEO_EXTENSIONS = new Set([
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
    '.mpg', '.mpeg', '.3gp', '.rmvb', '.asf', '.divx', '.xvid', '.ts',
    '.m2ts', '.mts', '.vob', '.ogv', '.dv'
  ])
  const ext = '.' + (filename.split('.').pop()?.toLowerCase() || '')
  return VIDEO_EXTENSIONS.has(ext)
}

// 处理从API获取的视频文件
const processVideoFileFromApi = async (apiFile: any, folder: MediaLibraryFolder) => {
  try {
    // 转换API文件格式为DriveFileItem
    const driveFile = {
      id: apiFile.file_id,
      name: apiFile.name,
      path: `/${apiFile.name}`, // 构造路径
      userId: apiFile.user_id || folder.userId,
      driveId: apiFile.drive_id,
      driveServerId: folder.driveServerId,
      fileSize: apiFile.size || 0,
      contentHash: apiFile.description || '', // 使用 description 替代 sha1
      thumbnailLink: apiFile.thumbnail || undefined,
      videoDuration: apiFile.media_duration,
      height: apiFile.media_height,
      cloudType: undefined
    }

    // 创建媒体项目（暂时作为未匹配项目）
    const mediaItem = {
      id: `${folder.driveServerId}_${apiFile.file_id}`,
      parentId: folder.name,
      folderId: folder.id,
      folderPath: folder.path,
      type: 'unmatched' as const,
      name: apiFile.name.replace(/\.[^/.]+$/, ''), // 移除扩展名
      posterUrl: apiFile.thumbnail || undefined,
      backdropUrl: apiFile.thumbnail || undefined,
      genres: [] as string[],
      driveFiles: [driveFile],
      addedAt: new Date()
    }

    mediaStore.addMediaItem(mediaItem)
    console.log(`✅ 已添加: ${apiFile.name}`)
  } catch (error) {
    console.error(`处理视频文件失败: ${apiFile.name}`, error)
  }
}

const handleCategorySelected = (category: string) => {
  if (category === 'home') category = 'all'
  homeNavigationActive.value = false
  mediaNav.value?.syncActiveCategory?.(category)
  activeCategory.value = category
  selectedFolder.value = undefined
  resetDrillDownFilters()
  console.log('Selected category:', category)
}

const handleHomeNavigateCategory = (category: string) => {
  if (category === 'home') category = 'all'
  homeNavigationActive.value = true
  mediaNav.value?.syncActiveCategory?.(category)
  activeCategory.value = category
  selectedFolder.value = undefined
  resetDrillDownFilters()
}

const handleGenreSelected = (genre: string) => {
  homeNavigationActive.value = false
  activeCategory.value = 'all'
  selectedFolder.value = undefined
  resetDrillDownFilters()
  selectedGenre.value = genre
  console.log('Selected genre:', genre)
}

const handleYearSelected = (year: string) => {
  homeNavigationActive.value = false
  activeCategory.value = 'all'
  selectedFolder.value = undefined
  resetDrillDownFilters()
  selectedYear.value = year
  console.log('Selected year:', year)
}

const handleRatingSelected = (rating: string) => {
  homeNavigationActive.value = false
  activeCategory.value = 'all'
  selectedFolder.value = undefined
  resetDrillDownFilters()
  selectedRating.value = rating
  console.log('Selected rating:', rating)
}

// 处理分类内钻取
const handleCategoryDrillDown = (data: {
  categoryType: string
  categoryValue: string
  filter: {
    genre?: string
    rating?: string
    year?: string
  }
}) => {
  homeNavigationActive.value = false
  console.log('Category drill down:', data)

  resetDrillDownFilters()

  // 根据钻取数据更新筛选条件
  if (data.filter.genre) {
    selectedGenre.value = data.filter.genre
  }
  if (data.filter.rating) {
    selectedRating.value = data.filter.rating
  }
  if (data.filter.year) {
    selectedYear.value = data.filter.year
  }

  // 退出聚合分类页，进入普通媒体结果列表
  activeCategory.value = 'all'

  // 清除选中的文件夹
  selectedFolder.value = undefined
}

const handleCategoryDrillBack = (data: { categoryType: string }) => {
  homeNavigationActive.value = false
  selectedFolder.value = undefined
  resetDrillDownFilters()

  switch (data.categoryType) {
    case 'genre':
      activeCategory.value = 'genres'
      break
    case 'year':
      activeCategory.value = 'years'
      break
    case 'rating':
      activeCategory.value = 'ratings'
      break
    default:
      activeCategory.value = 'all'
      break
  }
}

const handleRefresh = async () => {
  console.log('Refreshing media library...')
  message.info('刷新功能待实现')
}

const handleManageLibrary = () => {
  mediaNav.value?.openLibraryManager?.()
}

const handleHomeNavigationBack = () => {
  homeNavigationActive.value = false
  selectedFolder.value = undefined
  resetDrillDownFilters()
  activeCategory.value = 'all'
  mediaNav.value?.syncActiveCategory?.('all')
}


const addFolderToLibrary = async (folder: any, folderName: string) => {
  console.log('Adding folder to library:', folderName)
  message.info('添加到媒体库功能待实现')
}

let syncTimer: number | undefined
let lastContinueWatchingRaw = ''

const syncContinueWatchingFromStorage = () => {
  try {
    const raw = localStorage.getItem('MediaLibrary_ContinueWatching')
    if (!raw) return
    if (raw === lastContinueWatchingRaw) return
    lastContinueWatchingRaw = raw
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const normalized = parsed.map((item: any) => {
        if (item.addedAt && typeof item.addedAt === 'string') item.addedAt = new Date(item.addedAt)
        if (item.lastWatched && typeof item.lastWatched === 'string') item.lastWatched = new Date(item.lastWatched)
        if (item.watchProgress !== undefined && item.watchProgress !== null) {
          item.watchProgress = typeof item.watchProgress === 'string' ? parseFloat(item.watchProgress) : Number(item.watchProgress)
        }
        return item
      })
      mediaStore.continueWatching = normalized

      // 同步到 mediaItems，确保进度条/文本及时更新
      normalized.forEach((cw: any) => {
        const index = mediaStore.mediaItems.findIndex(item => item.id === cw.id)
        if (index >= 0) {
          mediaStore.updateMediaItem(cw.id, {
            watchProgress: cw.watchProgress,
            lastWatched: cw.lastWatched
          })
        }
      })
    }
  } catch (error) {
    console.error('同步继续观看失败:', error)
  }
}

const handleStorageSync = (event: StorageEvent) => {
  if (event.key === 'MediaLibrary_ContinueWatching') {
    syncContinueWatchingFromStorage()
    return
  }
  if (event.key === 'MediaLibrary_MediaItems' || event.key === 'MediaLibrary_Folders') {
    void mediaStore.hydrate()
  }
}

// 生命周期
// 断点续刮
const showResumeDialog = ref(false)
const resumeInfo = ref<{ folderName: string; timestamp: number } | null>(null)

const checkScanResume = () => {
  if (mediaScanner.isCurrentlyScanning) return
  const cp = mediaScanner.getScanCheckpoint()
  if (cp) {
    resumeInfo.value = { folderName: cp.folderName, timestamp: cp.timestamp }
    showResumeDialog.value = true
  }
}

const handleResumeScan = async () => {
  showResumeDialog.value = false
  showScanProgress.value = true
  await mediaScanner.resumeScanFromCheckpoint()
}

const handleCancelResume = () => {
  showResumeDialog.value = false
  mediaScanner.clearScanCheckpoint()
}

onMounted(() => {
  console.log('Media library initialized')
  window.addEventListener('storage', handleStorageSync)
  syncContinueWatchingFromStorage()
  syncTimer = window.setInterval(syncContinueWatchingFromStorage, 500)
  // 延迟检查断点，等页面渲染完成
  setTimeout(() => checkScanResume(), 500)
})

onUnmounted(() => {
  window.removeEventListener('storage', handleStorageSync)
  if (syncTimer) window.clearInterval(syncTimer)
})

// 暴露方法给父组件
defineExpose({
  resumeMedia: (item: import('../types/media').MediaLibraryItem) => mediaLibrary.value?.resumeMedia(item),
  returnToTagDetail: () => mediaLibrary.value?.returnToTagDetail() || false,
  playItems: (items: import('../types/media').MediaLibraryItem[], mode: 'play' | 'loop' | 'shuffle', title: string) => mediaLibrary.value?.playItems(items, mode, title),
  refreshMetadata: () => mediaLibrary.value?.refreshMetadata(),
  posterAction: (item: import('../types/media').MediaLibraryItem, action: import('../utils/mediaPosterMenu').PosterAction) => mediaLibrary.value?.posterAction(item, action),
  folderTitle: computed(() => mediaLibrary.value?.folderTitle || selectedFolder.value?.name || ''),
  goFolderBack: () => mediaLibrary.value?.goFolderBack(),
  activeCategory,
  playFolder: (id: string, mode: 'play' | 'loop' | 'shuffle') => mediaLibrary.value?.playBrowse(mode, id),
  playBrowse: (mode: 'play' | 'loop' | 'shuffle') => mediaLibrary.value?.playBrowse(mode),
  addFolderToLibrary,
  showAddFolder: () => mediaNav.value?.importLocalFolder(),
  showLocalDevice: () => mediaNav.value?.showLocalDevice(),
  removeFolder: (folder: MediaLibraryFolder) => mediaNav.value?.removeFolder(folder),
  manageLibrary: handleManageLibrary,
  selectCategory: handleCategorySelected,
  selectFolder: handleFolderSelected,
  selectDriveRoots,
  openItem: (item: import('../types/media').MediaLibraryItem) => mediaLibrary.value?.openMedia(item)
})
</script>

<style scoped>
:global(#xbybody .media-library-view.unified-folder-view .media-library-pane){padding:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:transparent!important}
.media-library-view {
  height: 100%;
  width: 100%;
}

.media-library-shell {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.library-sidebar {
  flex: 0 0 218px;
  width: 218px;
  min-width: 218px;
  max-width: 218px;
  height: calc(100% - 36px);
  margin: 18px 0 18px 18px;
  padding: 14px 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.085);
  border-radius: 28px;
  background:
    radial-gradient(circle at 42% 0%, rgba(0, 245, 212, 0.16), transparent 34%),
    radial-gradient(circle at 0% 86%, rgba(244, 210, 138, 0.07), transparent 26%),
    linear-gradient(180deg, rgba(14, 16, 20, 0.92), rgba(8, 9, 11, 0.98));
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.075);
}

.media-library-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: calc(100% - 36px);
  margin: 18px 18px 18px 14px;
}

:global(#xbybody .media-library-view .media-library-pane) {
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  transform: none !important;
  contain: none !important;
}

:global(#xbybody .media-library-view .media-library-pane .media-library),
:global(#xbybody .media-library-view .media-library-pane .media-detail) {
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}

:global(#xbybody .media-library-view .library-sidebar) {
  flex: 0 0 252px !important;
  width: 252px !important;
  min-width: 252px !important;
  max-width: 252px !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  transform: none !important;
  contain: none !important;
}

:global(#xbybody .media-library-view .library-sidebar::before) {
  display: none !important;
}

:global(#xbybody .media-library-view .library-sidebar > .media-library-nav) {
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

:global(#xbybody .media-library-view .media-library-nav),
:global(#xbybody .media-library-view .media-library),
:global(#xbybody .media-library-view .media-library *) {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

:global(#xbybody .media-library-view .nav-item:hover),
:global(#xbybody .media-library-view .nav-item.active),
:global(#xbybody .media-library-view .nav-item:hover i),
:global(#xbybody .media-library-view .nav-item.active i),
:global(#xbybody .media-library-view .media-item:hover),
:global(#xbybody .media-library-view .media-item:hover .media-poster img),
:global(#xbybody .media-library-view .media-list-item:hover),
:global(#xbybody .media-library-view .media-list-item:hover .list-poster img),
:global(#xbybody .media-library-view .library-home-mini-card:hover),
:global(#xbybody .media-library-view .category-list-card:hover),
:global(#xbybody .media-library-view .search-media-server-result:hover),
:global(#xbybody .media-library-view .toolbar-btn:active) {
  transform: none !important;
}

:global(#xbybody .media-library-view .library-home-resume-poster img),
:global(#xbybody .media-library-view .library-home-poster-image img),
:global(#xbybody .media-library-view .media-poster img),
:global(#xbybody .media-library-view .list-poster img) {
  will-change: auto !important;
  transform: none !important;
  filter: none !important;
}


.workspace-tabs {
  display: flex;
  gap: 4px;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.075);
  flex-shrink: 0;
  background:
    radial-gradient(circle at 8% 0%, rgba(255, 255, 255, 0.075), transparent 34%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.058), rgba(255, 255, 255, 0.026));
  backdrop-filter: blur(20px) saturate(1.12);
}

.workspace-tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px;
  border-radius: 16px;
  font-size: 13px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.68);
  transition: background-color .2s, color .2s;
}

.workspace-tab:hover {
  background: rgba(255, 255, 255, 0.072);
  color: #fff;
}

.workspace-tab.active {
  background: rgba(255, 255, 255, 0.085);
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(0, 245, 212, 0.22), 0 10px 28px rgba(0, 245, 212, 0.055);
}

.workspace-tab i {
  font-size: 14px;
}


.scan-progress {
  text-align: center;
}

.scan-info {
  margin-top: 12px;
  color: var(--color-text-2);
}

@media (max-width: 768px) {
  .library-sidebar {
    flex-basis: 218px;
    width: 218px;
    min-width: 218px;
    max-width: 218px;
  }
}
</style>

<style>
#xbybody .media-library-pane:has(.local-file-collection){padding:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:transparent!important}
</style>
