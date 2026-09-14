import { useMediaLibraryStore } from '../store/medialibrary'
import { TmdbService, TmdbTransientError, tmdbImageUrl } from './tmdb'
import type { MediaLibraryItem, DriveFileItem, MediaLibraryFolder } from '../types/media'
import { IAliGetFileModel } from '../aliapi/alimodels'
import AliDirFileList from '../aliapi/dirfilelist'
import { usePanTreeStore } from '../store'
import message from './message'
import { isAliyunUser, isBaiduUser, isBoxUser, isCloud139User, isCloud189User, isCloud123User, isDrive115User, isDropboxUser, isGoogleUser, isGuangyaUser, isOneDriveUser, isPikPakUser, isQuarkUser } from '../aliapi/utils'
import { getWebDavConnection, getWebDavConnectionId, isWebDavDrive, listWebDavDirectory, type WebDavConnectionConfig } from './webdavClient'
import UserDAL from '../user/userdal'
import { buildExpectedSeasons } from './mediaCoverage'
import { isThirdPartyProviderFolder, iterateProviderFolderPages, listProviderFolderItems } from './providerFolderList'
import { libraryScanRateLimitScope, rateLimitSingleScanPage } from './libraryScanRateLimiter'
import DB from './db'
import { mergeDriveFileSources } from './mediaSourceMembership'
import { associateMediaSubtitles, type MediaSubtitleFolderScope } from './mediaSubtitleAssociation'
import { buildMediaFingerprint } from './mediaFingerprint'
import useSettingStore from '../setting/settingstore'
import { captureMediaScrapeUnrecognized } from '../analytics/posthog'

type ScanContext = {
  userId: string
  driveId: string
  driveServerId: string
  silent?: boolean
}

type MediaScanHint = { tmdbId?: number; title: string; year?: number; mediaType: 'movie' | 'tv' | 'anime' }
type SubtitleAssociationIndex = { files: DriveFileItem[]; folderParents: Map<string, string> }

const PERSISTENCE_CHECKPOINT_ITEMS = 100
const PERSISTENCE_CHECKPOINT_MS = 3000

export class MediaScanner {
  private static instance: MediaScanner
  private tmdbService = TmdbService.getInstance()
  private mediaStore = useMediaLibraryStore()
  private panTreeStore = usePanTreeStore()
  private isScanning = false
  private shouldStop = false
  private scanWaiters: Array<() => void> = []
  private itemsSincePersistenceCheckpoint = 0
  private lastPersistenceCheckpointAt = 0

  // 支持的视频文件扩展名
  private readonly VIDEO_EXTENSIONS = new Set([
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
    '.mpg', '.mpeg', '.3gp', '.rmvb', '.asf', '.divx', '.xvid', '.ts',
    '.m2ts', '.mts', '.vob', '.ogv', '.dv'
  ])
  private readonly SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa'])

  static getInstance(): MediaScanner {
    if (!MediaScanner.instance) {
      MediaScanner.instance = new MediaScanner()
    }
    return MediaScanner.instance
  }

  // 统一扫描入口，按当前网盘类型分流
  async scanFolder(
    folder: IAliGetFileModel,
    driveServerId: string,
    options: { incremental?: boolean; silent?: boolean; mediaHint?: MediaScanHint } = {}
  ): Promise<void> {
    while (this.isScanning) {
      if (!options.silent) {
        message.warning('正在扫描中，请稍后...')
        return
      }
      await new Promise<void>((resolve) => this.scanWaiters.push(resolve))
    }

    this.isScanning = true
    this.shouldStop = false
    this.mediaStore.setScanning(true)
    this.mediaStore.setScanProgress(0, 0)
    this.mediaStore.beginPersistenceBatch()
    this.resetPersistenceCheckpoint()
    let completed = false
    let folderKey = ''
    let sourceWasExisting = false
    let previousFileIds: string[] = []

    // 断点恢复只服务于用户主动发起的完整刮削。Agent 的静默扫描由任务
    // 自身负责重试，不能让视频页把正在运行的后台扫描识别成异常中断。
    try {
      const scanContext = await this.resolveScanContext(folder, driveServerId)
      scanContext.silent = !!options.silent
      folder.drive_id = scanContext.driveId
      ;(folder as any).user_id = scanContext.userId

      if (!options.incremental && !options.silent) {
        this.saveScanCheckpoint({ folder, driveServerId, userId: scanContext.userId })
      }

      folderKey = this.getScopedFolderKey(scanContext, folder.file_id)
      sourceWasExisting = this.mediaStore.folders.some(source => source.id === folderKey)
      previousFileIds = await DB.getMediaLibraryFolderFileIds(folderKey)
      const existingIds = new Set<string>()
      const subtitleIndex: SubtitleAssociationIndex = { files: [], folderParents: new Map() }
      let totalProcessed = 0
      let unresolvedTransientFailures = 0

      console.log('开始扫描网盘文件夹:', folder.name)
      // 与 iOS 保持一致：只有用户在设置中明确开启后，才在完整的常规刮削
      // 结束后把未匹配项交给 AI。AI 不能抢在 TMDB 匹配流程中间执行。
      const shouldRunAIScrape = Boolean(useSettingStore().apiAIMediaScrapeEnabled && await this.canRunInternalAIScrape())
      let totalFound = 0
      const pendingAIUnmatched: DriveFileItem[] = []
      const flushAIUnmatched = async () => {
        if (!pendingAIUnmatched.length || this.shouldStop) return
        const batch = pendingAIUnmatched.splice(0, pendingAIUnmatched.length)
        await this.applyBatchAIScrapeResults(batch, folder.name, folderKey, false)
      }

      // Phase 1: 边遍历边 TMDB 匹配（跳过 AI 兜底）
      totalFound = await this.scrapeFolderRecursive(folder, scanContext, folderKey, existingIds, options.incremental, shouldRunAIScrape, options.mediaHint,
        ({ processed, unresolved = 0 }) => {
          totalProcessed += processed
          unresolvedTransientFailures += unresolved
          this.mediaStore.setScanProgress(totalProcessed, totalProcessed + 1)
          this.checkpointScanPersistence(processed)
        },
        async (unmatched) => {
          pendingAIUnmatched.push(...unmatched)
        }, subtitleIndex
      )

      await flushAIUnmatched()

      if (!this.shouldStop) {
        this.applySubtitleAssociations(folderKey, scanContext, subtitleIndex, useSettingStore().mediaLibrarySubtitleScope)
        if (!options.incremental) {
          await DB.reconcileMediaLibraryFolder(folderKey, [...existingIds])
          this.mediaStore.reconcileFolderSource(folderKey, existingIds)
        }
        if (totalFound > 0) {
          const mediaFolder: MediaLibraryFolder = {
            id: folderKey,
            fileId: folder.file_id,
            name: folder.name,
            path: folder.path || '',
            userId: scanContext.userId,
            driveId: scanContext.driveId,
            driveServerId: scanContext.driveServerId,
            scanDate: new Date(),
            itemCount: totalFound
          }
          this.mediaStore.addFolder(mediaFolder)
          this.mediaStore.pruneOrphanDuplicateFolders()
        }
        this.mediaStore.setScanProgress(totalProcessed, totalProcessed)
        if (!options.silent) {
          if (unresolvedTransientFailures > 0) {
            message.warning(`扫描完成：${unresolvedTransientFailures} 个文件的 TMDB 请求在请求层退避重试后仍失败，已保留现有资料；下次增量扫描会继续重试`)
          } else {
            message.success(`扫描完成！共处理 ${totalProcessed} 个视频文件`)
          }
        }
        completed = true
      } else {
        if (!options.silent) message.info('扫描已停止')
      }
    } catch (error) {
      console.error('扫描文件夹时出错:', error)
      if (folderKey) {
        await DB.reconcileMediaLibraryFolder(folderKey, previousFileIds).catch(() => {})
        this.mediaStore.reconcileFolderSource(folderKey, previousFileIds)
        if (!sourceWasExisting) this.mediaStore.removeFolder(folderKey)
      }
      if (!options.silent) message.error('扫描失败: ' + (error as Error).message)
      // 后台调用方（例如媒体获取 Agent）必须知道扫描是否真正成功。
      // 否则 workflow 会继续写入“媒体库扫描已完成”并把任务标记完成，
      // 只能等下次启动的自动扫描补齐媒体库。
      if (options.silent) throw error
    } finally {
      this.isScanning = false
      this.mediaStore.setScanning(false)
      this.mediaStore.endPersistenceBatch()
      if (completed) {
        this.clearScanCheckpoint()
      }
      const waiters = this.scanWaiters.splice(0)
      waiters.forEach((resolve) => resolve())
    }
  }

  // 边遍历边刮削：列出文件夹 → TMDB 匹配 → 递归子文件夹。
  private async scrapeFolderRecursive(
    folder: IAliGetFileModel,
    scanContext: ScanContext,
    folderKey: string,
    existingIds: Set<string>,
    incremental: boolean | undefined,
    deferUnmatchedForAI: boolean,
    mediaHint: MediaScanHint | undefined,
    onProgress: (stats: { processed: number; unresolved?: number }) => void,
    onAIUnmatched: (files: DriveFileItem[]) => Promise<void>,
    subtitleIndex: SubtitleAssociationIndex,
    depth = 0,
    relativePath = folder.path || folder.name
  ): Promise<number> {
    if (this.shouldStop) return 0

    let totalFound = 0

    try {
      console.log(`正在扫描: ${folder.name} (深度: ${depth})`)
      subtitleIndex.folderParents.set(folder.file_id, folder.parent_file_id || '')
      for await (const items of this.iterateFolderPages(folder, scanContext)) {
        if (this.shouldStop) break
        const videoFiles: DriveFileItem[] = []
        const subFolders: IAliGetFileModel[] = []
        for (const item of items) {
          if (item.isDir) {
            subtitleIndex.folderParents.set(item.file_id, item.parent_file_id || folder.file_id)
            subFolders.push(item)
          }
          else if (this.isVideoFile(item.name)) {
            const itemPath = relativePath ? `${relativePath.replace(/\/$/, '')}/${item.name}` : item.name
            videoFiles.push({ id: item.file_id, name: item.name, path: itemPath, parentFileId: item.parent_file_id || folder.file_id, userId: scanContext.userId, driveId: item.drive_id || scanContext.driveId, driveServerId: scanContext.driveServerId, fileSize: item.size || 0, contentHash: item.content_hash || '', contentHashName: item.content_hash_name || '', thumbnailLink: item.thumbnail || undefined, videoDuration: item.media_duration, height: item.media_height, sourceFolderIds: [folderKey] })
          } else if (this.isSubtitleFile(item.name)) {
            const itemPath = relativePath ? `${relativePath.replace(/\/$/, '')}/${item.name}` : item.name
            subtitleIndex.files.push({ id: item.file_id, name: item.name, path: itemPath, parentFileId: item.parent_file_id || folder.file_id, userId: scanContext.userId, driveId: item.drive_id || scanContext.driveId, driveServerId: scanContext.driveServerId, fileSize: item.size || 0, contentHash: item.content_hash || '', contentHashName: item.content_hash_name || '', sourceFolderIds: [folderKey] })
          }
        }
        if (incremental && videoFiles.length) {
          const indexed = await DB.getIndexedMediaFileIds(videoFiles.map(file => this.getScopedDriveFileKey(file)))
          indexed.forEach(id => existingIds.add(id))
        }
        const toProcess = incremental ? videoFiles.filter(f => !existingIds.has(this.getScopedDriveFileKey(f))) : videoFiles
        totalFound += videoFiles.length
        for (let i = 0; i < toProcess.length && !this.shouldStop; i += 3) {
          const batch = toProcess.slice(i, i + 3)
          const { unmatched, completed, unresolved } = await this.processVideoBatchWithTransientRetry(batch, folder.name, folderKey, mediaHint)
          if (deferUnmatchedForAI) await onAIUnmatched(unmatched)
          else unmatched.forEach(item => this.addUnmatchedMediaItem(item, folder.name, folderKey))
          unresolved.forEach(item => this.addRetryPendingMediaItem(item, folder.name, folderKey))
          onProgress({ processed: batch.length, unresolved: unresolved.length })
          // 临时失败不能在完整扫描时被当作已删除文件。新文件没有持久化
          // 映射，下一次增量扫描仍会再次尝试；已有资料则保持原资料不被清理。
          completed.concat(unresolved).forEach(file => existingIds.add(this.getScopedDriveFileKey(file)))
        }
        for (const sub of subFolders) {
          if (this.shouldStop) break
          totalFound += await this.scrapeFolderRecursive(sub, scanContext, folderKey, existingIds, incremental, deferUnmatchedForAI, mediaHint, onProgress, onAIUnmatched, subtitleIndex, depth + 1, relativePath ? `${relativePath.replace(/\/$/, '')}/${sub.name}` : sub.name)
        }
      }
    } catch (error) {
      console.error(`扫描文件夹失败: ${folder.name}`, error)
      throw error
    }

    return totalFound
  }

  private async processVideoBatchWithTransientRetry(files: DriveFileItem[], folderName: string, folderId: string, mediaHint?: MediaScanHint): Promise<{ unmatched: DriveFileItem[]; completed: DriveFileItem[]; unresolved: DriveFileItem[] }> {
    const unmatched: DriveFileItem[] = []
    const completed: DriveFileItem[] = []
    const unresolved: DriveFileItem[] = []
    const results = await Promise.allSettled(files.map(file => this.processVideoFileWithoutAI(file, folderName, folderId, mediaHint)))
    results.forEach((result, index) => {
      const file = files[index]
      if (result.status === 'fulfilled') {
        completed.push(file)
        if (result.value) unmatched.push(result.value)
        return
      }
      if (result.reason instanceof TmdbTransientError) {
        console.warn(`TMDB 请求层退避重试后仍失败，保留待下次增量扫描: ${file.name}`)
        unresolved.push(file)
        return
      }
      // processVideoFileWithoutAI 已将非临时错误降级为未匹配；这里仅作
      // 防御性保护，避免未知异常导致完整扫描误删已有媒体资料。
      console.error(`处理视频文件失败，保留现有资料: ${file.name}`, result.reason)
      completed.push(file)
    })
    return { unmatched, completed, unresolved }
  }

  private async *iterateFolderPages(folder: IAliGetFileModel, scanContext: ScanContext): AsyncGenerator<IAliGetFileModel[]> {
    const scope = libraryScanRateLimitScope(scanContext.userId, folder.drive_id || scanContext.driveId)
    const listMethodWasOverridden = this.getFolderItemsWithRetry !== MediaScanner.prototype.getFolderItemsWithRetry
    if (!listMethodWasOverridden && isThirdPartyProviderFolder(scanContext.userId, folder.drive_id || scanContext.driveId)) {
      yield* iterateProviderFolderPages({ folder, userId: scanContext.userId, driveId: folder.drive_id || scanContext.driveId, silent: scanContext.silent, shouldStop: () => this.shouldStop })
      return
    }
    if (!listMethodWasOverridden && isAliyunUser(scanContext.userId)) {
      yield* AliDirFileList.ApiDirFileListPages(scanContext.userId, folder.drive_id || scanContext.driveId, folder.file_id, folder.name, 'name asc', '', false, scope)
      return
    }
    yield* rateLimitSingleScanPage(scope, () => this.getFolderItemsWithRetry(folder, scanContext))
  }

  private getIndexedDriveFileIds(): Set<string> {
    const fileIds = new Set<string>()
    const addFiles = (files: DriveFileItem[] | undefined) => {
      for (const file of files || []) {
        if (file.id) fileIds.add(this.getScopedDriveFileKey(file))
      }
    }

    for (const item of this.mediaStore.mediaItems) {
      addFiles(item.driveFiles)
      for (const season of item.seasons || []) {
        for (const episode of season.episodes || []) addFiles(episode.driveFiles)
      }
    }
    return fileIds
  }

  private getScopedFolderKey(scanContext: ScanContext, fileId: string): string {
    return [scanContext.driveServerId, scanContext.userId, scanContext.driveId, fileId].map(value => encodeURIComponent(String(value || ''))).join(':')
  }

  private getScopedDriveFileKey(file: DriveFileItem): string {
    return [file.driveServerId, file.userId, file.driveId, file.id].map(value => encodeURIComponent(String(value || ''))).join(':')
  }

  private resetPersistenceCheckpoint() {
    this.itemsSincePersistenceCheckpoint = 0
    this.lastPersistenceCheckpointAt = Date.now()
  }

  private checkpointScanPersistence(processed: number) {
    this.itemsSincePersistenceCheckpoint += processed
    const now = Date.now()
    if (this.itemsSincePersistenceCheckpoint < PERSISTENCE_CHECKPOINT_ITEMS && now - this.lastPersistenceCheckpointAt < PERSISTENCE_CHECKPOINT_MS) return
    this.mediaStore.checkpointPersistenceBatch()
    this.itemsSincePersistenceCheckpoint = 0
    this.lastPersistenceCheckpointAt = now
  }

  async scanAliyunFolder(folder: IAliGetFileModel, driveServerId: string): Promise<void> {
    return this.scanFolder(folder, driveServerId)
  }

  async scanWebDavConnection(connection: WebDavConnectionConfig): Promise<void> {
    const rootFolder: IAliGetFileModel = {
      __v_skip: true,
      drive_id: `webdav:${connection.id}`,
      file_id: '/',
      parent_file_id: '',
      name: connection.name,
      namesearch: connection.name.toLowerCase(),
      path: '/',
      ext: '',
      mime_type: '',
      mime_extension: '',
      category: 'folder',
      icon: '',
      size: 0,
      sizeStr: '',
      time: Date.now(),
      timeStr: '',
      starred: false,
      isDir: true,
      thumbnail: '',
      description: ''
    }
    return this.scanFolder(rootFolder, 'webdav')
  }

  async scanLocalFolder(folderPath: string): Promise<void> {
    if (this.isScanning) {
      message.warning('正在扫描中，请稍后...')
      return
    }

    const fs = window.require?.('fs')
    const path = window.require?.('path')
    if (!fs || !path) {
      message.error('当前环境不支持本地文件扫描')
      return
    }

    this.isScanning = true
    this.shouldStop = false
    this.mediaStore.setScanning(true)
    this.mediaStore.setScanProgress(0, 0)
    this.mediaStore.beginPersistenceBatch()
    this.resetPersistenceCheckpoint()
    let completed = false
    let sourceId = ''
    let sourceWasExisting = false
    let previousFileIds: string[] = []

    try {
      const folderName = path.basename(folderPath)
      sourceId = `local_${folderPath}`
      sourceWasExisting = this.mediaStore.folders.some(source => source.id === sourceId)
      previousFileIds = await DB.getMediaLibraryFolderFileIds(sourceId)
      const seenFileIds = new Set<string>()
      this.saveLocalScanCheckpoint(folderPath, folderName)
      let videoCount = 0
      let processed = 0
      let sourceAdded = false
      let batch: DriveFileItem[] = []
      const processBatch = async () => {
        if (!batch.length) return
        if (!sourceAdded) {
          this.mediaStore.addFolder({
            id: sourceId,
            fileId: folderPath,
            name: folderName,
            path: folderPath,
            userId: 'local',
            driveId: 'local',
            driveServerId: 'local',
            scanDate: new Date(),
            itemCount: 0
          })
          sourceAdded = true
        }
        const currentBatch = batch
        const { unmatched, unresolved } = await this.processVideoBatchWithTransientRetry(currentBatch, folderName, sourceId)
        unmatched.forEach(file => this.addUnmatchedMediaItem(file, folderName, sourceId))
        unresolved.forEach(file => this.addRetryPendingMediaItem(file, folderName, sourceId))
        processed += batch.length
        this.mediaStore.setScanProgress(processed, Math.max(processed + 1, videoCount))
        this.checkpointScanPersistence(batch.length)
        batch = []
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      for await (const file of this.iterateLocalVideoFiles(folderPath, fs, path)) {
        if (this.shouldStop) break
        videoCount += 1
        file.sourceFolderIds = [sourceId]
        seenFileIds.add(this.getScopedDriveFileKey(file))
        batch.push(file)
        if (batch.length >= 5) await processBatch()
      }
      if (!this.shouldStop) await processBatch()

      if (!videoCount) {
        message.info('未在该文件夹中找到视频文件')
        return
      }

      if (!this.shouldStop) {
        await DB.reconcileMediaLibraryFolder(sourceId, [...seenFileIds])
        this.mediaStore.reconcileFolderSource(sourceId, seenFileIds)
        const mediaFolder: MediaLibraryFolder = {
          id: `local_${folderPath}`,
          fileId: folderPath,
          name: folderName,
          path: folderPath,
          userId: 'local',
          driveId: 'local',
          driveServerId: 'local',
          scanDate: new Date(),
          itemCount: videoCount
        }

        this.mediaStore.addFolder(mediaFolder)
        this.mediaStore.pruneOrphanDuplicateFolders()
        this.mediaStore.setScanProgress(videoCount, videoCount)
        message.success(`扫描完成！共处理 ${videoCount} 个视频文件`)
        completed = true
      } else {
        message.info('扫描已停止')
      }
    } catch (error) {
      console.error('扫描本地文件夹时出错:', error)
      if (sourceId) {
        await DB.reconcileMediaLibraryFolder(sourceId, previousFileIds).catch(() => {})
        this.mediaStore.reconcileFolderSource(sourceId, previousFileIds)
        if (!sourceWasExisting) this.mediaStore.removeFolder(sourceId)
      }
      message.error('扫描失败: ' + (error as Error).message)
    } finally {
      this.isScanning = false
      this.mediaStore.setScanning(false)
      this.mediaStore.endPersistenceBatch()
      if (completed) this.clearScanCheckpoint()
    }
  }

  // 递归收集所有视频文件 - 参考Swift版本的广度优先遍历
  private async collectVideoFiles(
    folder: IAliGetFileModel,
    scanContext: ScanContext,
    videoFiles: DriveFileItem[],
    depth = 0,
    currentPath = ''
  ): Promise<void> {
    if (this.shouldStop || depth > 10) return // 防止过深递归

    try {
      console.log(`正在扫描文件夹: ${folder.name} (深度: ${depth})`)

      const items = await this.getFolderItemsWithRetry(folder, scanContext)
      if (!items || items.length === 0) {
        console.log(`文件夹 ${folder.name} 无内容或获取失败`)
        return
      }

      console.log(`文件夹 ${folder.name} 包含 ${items.length} 个项目`)

      for (const item of items) {
        if (this.shouldStop) break

        const itemPath = currentPath ? `${currentPath}/${item.name}` : item.name
        if (item.isDir) {
          // 递归处理子文件夹
          await this.collectVideoFiles(item, scanContext, videoFiles, depth + 1, itemPath)
        } else {
          if (this.isVideoFile(item.name)) {
            console.log(`✓ 找到视频文件: ${item.name} ${item.thumbnail ? '(有缩略图)' : '(无缩略图)'}`)
            // 转换为DriveFileItem格式
            const driveFile: DriveFileItem = {
              id: item.file_id,
              name: item.name,
              path: itemPath,
              parentFileId: item.parent_file_id || folder.file_id,
              userId: scanContext.userId,
              driveId: item.drive_id || scanContext.driveId,
              driveServerId: scanContext.driveServerId,
              fileSize: item.size || 0,
              contentHash: item.content_hash || '',
              contentHashName: item.content_hash_name || '',
              thumbnailLink: item.thumbnail || undefined,
              videoDuration: item.media_duration,
              height: item.media_height
            }
            videoFiles.push(driveFile)
          }
        }
      }

    } catch (error) {
      console.error(`获取文件夹内容失败: ${folder.name}`, error)
    }
  }

  // 网盘 list API 限速重试包装：遇到 BlockException/TooManyRequests 自动退避重试
  private async getFolderItemsWithRetry(folder: IAliGetFileModel, scanContext: ScanContext, maxRetries = 4): Promise<IAliGetFileModel[]> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.getFolderItems(folder, scanContext)
      } catch (e: any) {
        const isRateLimited =
          e?.code === 'BlockException' ||
          e?.resultCode === 'BlockException' ||
          String(e?.message || '').includes('TooManyRequests') ||
          String(e?.message || '').includes('BlockException')
        if (isRateLimited && attempt < maxRetries) {
          const delay = 1500 * Math.pow(2, attempt)
          console.log(`[MediaScanner] 网盘 API 限速，${delay}ms 后重试 (${attempt + 1}/${maxRetries})`)
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        throw e
      }
    }
    return []
  }

  private async getFolderItems(folder: IAliGetFileModel, scanContext: ScanContext): Promise<IAliGetFileModel[]> {
    const userId = scanContext.userId
    const driveId = folder.drive_id || scanContext.driveId

    if (isWebDavDrive(driveId)) {
      const connectionId = getWebDavConnectionId(driveId)
      const connection = getWebDavConnection(connectionId)
      if (!connection) {
        console.warn('WebDAV 连接不存在:', connectionId)
        return []
      }
      return await listWebDavDirectory(connection, folder.path || folder.file_id || '/')
    }

    const providerItems = await listProviderFolderItems({ folder, userId, driveId, silent: scanContext.silent, shouldStop: () => this.shouldStop })
    if (providerItems) return providerItems

    if (!isAliyunUser(userId)) {
      console.warn('[MediaScanner] skip Aliyun file list for non-Aliyun source', {
        userId,
        driveId,
        fileId: folder.file_id
      })
      return []
    }
    const resp = await AliDirFileList.ApiDirFileList(
      userId,
      driveId,
      folder.file_id,
      folder.name,
      'name asc',
      '',
      undefined,
      false
    )

    return resp?.items || []
  }

  private async resolveScanContext(folder: IAliGetFileModel, driveServerId: string): Promise<ScanContext> {
    const driveId = folder.drive_id || driveServerId || this.panTreeStore.drive_id
    const folderUserId = (folder as any).user_id || ''
    if (isWebDavDrive(driveId) || driveServerId === 'webdav') {
      const webDavDriveId = isWebDavDrive(driveId) ? driveId : folder.drive_id
      return {
        userId: getWebDavConnectionId(webDavDriveId),
        driveId: webDavDriveId,
        driveServerId: 'webdav'
      }
    }

    const currentUserId = this.panTreeStore.user_id || ''
    const userId = folderUserId || this.matchCurrentUser(currentUserId, driveId) || (await this.findUserIdForDrive(driveId)) || currentUserId
    return {
      userId,
      driveId,
      driveServerId: this.resolveDriveServerId(userId, driveId, driveServerId)
    }
  }

  private matchCurrentUser(userId: string, driveId: string): string {
    if (!userId) return ''
    if (driveId === 'cloud123' && isCloud123User(userId)) return userId
    if (driveId === 'drive115' && isDrive115User(userId)) return userId
    if (driveId === 'baidu' && isBaiduUser(userId)) return userId
    if (driveId === 'pikpak' && isPikPakUser(userId)) return userId
    if (driveId === 'dropbox' && isDropboxUser(userId)) return userId
    if (driveId === 'onedrive' && isOneDriveUser(userId)) return userId
    if (driveId === 'box' && isBoxUser(userId)) return userId
    if (driveId === 'google' && isGoogleUser(userId)) return userId
    if (driveId === 'quark' && isQuarkUser(userId)) return userId
    if (driveId === 'cloud139' && isCloud139User(userId)) return userId
    if (driveId === 'cloud189' && isCloud189User(userId)) return userId
    if (driveId === 'guangya' && isGuangyaUser(userId)) return userId
    if (driveId !== 'cloud123' && driveId !== 'drive115' && driveId !== 'baidu' && driveId !== 'pikpak' && driveId !== 'dropbox' && driveId !== 'onedrive' && driveId !== 'box' && driveId !== 'google' && driveId !== 'quark' && driveId !== 'cloud139' && driveId !== 'cloud189' && driveId !== 'guangya') return userId
    return ''
  }

  private async findUserIdForDrive(driveId: string): Promise<string> {
    const users = await UserDAL.GetUserListFromDB()
    const matched = users.find((token) => {
      if (driveId === 'cloud123') return isCloud123User(token)
      if (driveId === 'drive115') return isDrive115User(token)
      if (driveId === 'baidu') return isBaiduUser(token)
      if (driveId === 'pikpak') return isPikPakUser(token)
      if (driveId === 'dropbox') return isDropboxUser(token)
      if (driveId === 'onedrive') return isOneDriveUser(token)
      if (driveId === 'box') return isBoxUser(token)
      if (driveId === 'google') return isGoogleUser(token)
      if (driveId === 'quark') return isQuarkUser(token)
      if (driveId === 'cloud139') return isCloud139User(token)
      if (driveId === 'cloud189') return isCloud189User(token)
      if (driveId === 'guangya') return isGuangyaUser(token)
      return token.default_drive_id === driveId
        || token.resource_drive_id === driveId
        || token.backup_drive_id === driveId
        || token.pic_drive_id === driveId
        || token.default_sbox_drive_id === driveId
    })
    return matched?.user_id || ''
  }

  private resolveDriveServerId(userId: string, driveId: string, fallback: string): string {
    if (isCloud123User(userId) || driveId === 'cloud123') return 'cloud123'
    if (isDrive115User(userId) || driveId === 'drive115') return 'drive115'
    if (isBaiduUser(userId) || driveId === 'baidu') return 'baidu'
    if (isPikPakUser(userId) || driveId === 'pikpak') return 'pikpak'
    if (isDropboxUser(userId) || driveId === 'dropbox') return 'dropbox'
    if (isOneDriveUser(userId) || driveId === 'onedrive') return 'onedrive'
    if (isBoxUser(userId) || driveId === 'box') return 'box'
    if (isGoogleUser(userId) || driveId === 'google') return 'google'
    if (isQuarkUser(userId) || driveId === 'quark') return 'quark'
    if (isCloud139User(userId) || driveId === 'cloud139') return 'cloud139'
    if (isCloud189User(userId) || driveId === 'cloud189') return 'cloud189'
    if (isGuangyaUser(userId) || driveId === 'guangya') return 'guangya'
    return fallback
  }

  private async *iterateLocalVideoFiles(
    folderPath: string,
    fs: any,
    path: any,
    depth = 0
  ): AsyncGenerator<DriveFileItem> {
    if (this.shouldStop) return
    if (depth > 10) throw new Error(`本地目录层级超过扫描上限: ${folderPath}`)

    try {
      const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
      for (const entry of entries) {
        if (this.shouldStop) return
        const fullPath = path.join(folderPath, entry.name)
        if (entry.isDirectory()) {
          yield* this.iterateLocalVideoFiles(fullPath, fs, path, depth + 1)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (this.VIDEO_EXTENSIONS.has(ext)) {
            const stat = await fs.promises.stat(fullPath)
            yield {
              id: fullPath,
              name: entry.name,
              path: fullPath,
              driveId: 'local',
              driveServerId: 'local',
              fileSize: stat.size || 0,
              contentHash: '',
              thumbnailLink: undefined,
              videoDuration: undefined,
              height: undefined
            }
          }
        }
      }
    } catch (error) {
      console.error('扫描本地文件夹失败:', error)
      throw error
    }
  }

  // 检查是否为视频文件
  private isVideoFile(filename: string): boolean {
    const ext = '.' + (filename.split('.').pop()?.toLowerCase() || '')
    return this.VIDEO_EXTENSIONS.has(ext)
  }

  private isSubtitleFile(filename: string): boolean {
    const ext = '.' + (filename.split('.').pop()?.toLowerCase() || '')
    return this.SUBTITLE_EXTENSIONS.has(ext)
  }

  private applySubtitleAssociations(folderKey: string, scanContext: ScanContext, subtitleIndex: SubtitleAssociationIndex, scope: MediaSubtitleFolderScope) {
    const belongsToScan = (file: DriveFileItem) => file.driveServerId === scanContext.driveServerId
      && file.userId === scanContext.userId
      && file.driveId === scanContext.driveId
      && file.sourceFolderIds?.includes(folderKey)
    const associateFiles = (files: DriveFileItem[] = []) => files.map((file) => (
      belongsToScan(file) ? associateMediaSubtitles(file, subtitleIndex.files, subtitleIndex.folderParents, scope) : file
    ))

    for (const item of this.mediaStore.mediaItems) {
      const driveFiles = associateFiles(item.driveFiles)
      const seasons = item.seasons?.map((season) => ({
        ...season,
        episodes: season.episodes?.map((episode) => ({ ...episode, driveFiles: associateFiles(episode.driveFiles) }))
      }))
      const collectionMovies = item.collectionMovies?.map((movie) => ({ ...movie, driveFiles: associateFiles(movie.driveFiles) }))
      const changed = driveFiles.some((file, index) => file !== item.driveFiles[index])
        || seasons?.some((season, seasonIndex) => season.episodes?.some((episode, episodeIndex) => episode.driveFiles.some((file, fileIndex) => file !== item.seasons?.[seasonIndex].episodes?.[episodeIndex].driveFiles[fileIndex])))
        || collectionMovies?.some((movie, index) => movie.driveFiles.some((file, fileIndex) => file !== item.collectionMovies?.[index].driveFiles[fileIndex]))
      if (changed) this.mediaStore.updateMediaItem(item.id, { driveFiles, seasons, collectionMovies })
    }
  }

  private parseTmdbId(fileName: string): string | null {
    const match = fileName.match(/tmdb(?:id)?[-=](\d+)/i)
    return match ? match[1] : null
  }

  // 尝试匹配现有电视剧 - 参考Swift版本的addTvSeriesItemByMatchName
  private tryMatchExistingTvSeries(
    fileItem: DriveFileItem,
    folderName: string,
    cleanedFileName: string,
    seasonEpisode: { season: number, episode: number },
    folderId?: string
  ): MediaLibraryItem | null {
    const existingTvItems = this.mediaStore.tvShows

    for (const existingItem of existingTvItems) {
      // 检查名称匹配逻辑（与Swift版本保持一致）
      const tvName = existingItem.name.toLowerCase()
      const cleanedFileNameLower = cleanedFileName.toLowerCase()

      if (cleanedFileNameLower.includes(tvName) ||
          tvName.includes(cleanedFileNameLower)) {

        // 找到匹配的电视剧，需要合并集数信息
        const updatedItem = this.mergeEpisodeIntoTvSeries(
          existingItem,
          fileItem,
          seasonEpisode,
          folderName,
          folderId
        )

        if (updatedItem) {
          // 更新媒体库中的项目
          this.mediaStore.addOrMergeTvSeries(updatedItem)
          this.mediaStore.addToRecentlyAdded(updatedItem)
          return updatedItem
        }
      }
    }

    return null
  }

  // 将新集数合并到现有电视剧中 - 与Swift版本的addTvSeriesItemByMatchName保持一致
  private mergeEpisodeIntoTvSeries(
    existingTvItem: MediaLibraryItem,
    newFileItem: DriveFileItem,
    seasonEpisode: { season: number, episode: number },
    folderName: string,
    folderId?: string
  ): MediaLibraryItem | null {
    try {
      // 深拷贝现有项目以避免直接修改
      const updatedItem: MediaLibraryItem = JSON.parse(JSON.stringify(existingTvItem))

      // 获取现有的seasons，如果不存在则返回null（与Swift版本一致）
      const mergedSeasons = updatedItem.seasons || []

      // 查找对应的季
      const existingSeasonIndex = mergedSeasons.findIndex(s => s.seasonNumber === seasonEpisode.season)
      if (existingSeasonIndex >= 0) {
        const existingSeason = mergedSeasons[existingSeasonIndex]
        const mergedEpisodes = existingSeason.episodes || []

        // 查找对应的集
        const existingEpisodeIndex = mergedEpisodes.findIndex(e => e.episodeNumber === seasonEpisode.episode)
        if (existingEpisodeIndex >= 0) {
          // 只有当季和集都已存在时才进行合并（与Swift版本一致）
          const existingEpisode = mergedEpisodes[existingEpisodeIndex]

          if (existingEpisode.driveFiles) {
            // 添加新文件到现有集中，避免重复
            const existingCloudItems = [...existingEpisode.driveFiles]
            existingCloudItems.push(newFileItem)

            // 去重处理（使用Set去重）
            existingEpisode.driveFiles = mergeDriveFileSources(existingCloudItems)
          } else {
            existingEpisode.driveFiles = [newFileItem]
          }

          // 更新季中的集数组
          mergedEpisodes[existingEpisodeIndex] = existingEpisode
          existingSeason.episodes = mergedEpisodes
          mergedSeasons[existingSeasonIndex] = existingSeason

          // 更新项目的seasons
          updatedItem.seasons = mergedSeasons

          // 更新总的driveFiles列表
          // if (!updatedItem.driveFiles) {
          //   updatedItem.driveFiles = []
          // }
          // const mainFileExists = updatedItem.driveFiles.some(f => f.id === newFileItem.id)
          // if (!mainFileExists) {
          //   updatedItem.driveFiles.push(newFileItem)
          // }

          // 更新父ID和文件夹ID
          updatedItem.parentId = folderName
          updatedItem.folderId = folderId || updatedItem.folderId

          return updatedItem
        }
      }

      // 如果没有找到对应的季或集，返回null（与Swift版本一致，不创建新的季集）
      return null
    } catch (error) {
      console.error('合并集数信息失败:', error)
      return null
    }
  }

  // TMDB 匹配（不含 AI 兜底）：成功返回 null，失败返回未匹配文件供批量 AI 处理
  private async processVideoFileWithoutAI(file: DriveFileItem, folderName: string, folderId?: string, mediaHint?: MediaScanHint): Promise<DriveFileItem | null> {
    try {
      this.removeRetryPendingMediaItem(file)
      const fileName = file.name.replace(/\.[^/.]+$/, '')
      const normalized = this.tmdbService.normalizeFileName(file.name, file.path || `${folderName}/${file.name}`)
      const seasonEpisode = normalized.seasonNumber === undefined || normalized.episodeNumber === undefined
        ? null
        : { season: normalized.seasonNumber, episode: normalized.episodeNumber }
      const lookupName = normalized.searchTitle || ''

      if (lookupName.replace(/\s/g, '').length === 0) return file

      if (seasonEpisode) {
        const existingTvItem = this.tryMatchExistingTvSeries(file, folderName, lookupName, seasonEpisode, folderId)
        if (existingTvItem) return null

        // Acquisition already resolved the title identity.  Do not send an
        // imported TV/anime file back through title search merely because its
        // release name has no embedded TMDB id.
        const tmdbId = (mediaHint?.mediaType === 'tv' || mediaHint?.mediaType === 'anime') && mediaHint.tmdbId
          ? String(mediaHint.tmdbId)
          : this.parseTmdbId(fileName)
        const year = normalized.releaseYear === undefined ? undefined : String(normalized.releaseYear)
        const shouldUseYear = Boolean(year && !lookupName.includes(year))
        const fingerprint = buildMediaFingerprint(file)

        const tvResult = tmdbId
          ? await this.tmdbService.searchTV(lookupName, seasonEpisode.season, shouldUseYear ? year : undefined, tmdbId, fingerprint)
          : await this.tmdbService.searchTV(lookupName, seasonEpisode.season, shouldUseYear ? year : undefined, undefined, fingerprint, fileName)

        const matchedEpisode = tvResult?.current_season?.episodes?.find(ep => ep.episode_number === seasonEpisode.episode)
        if (tvResult && tvResult.current_season && matchedEpisode) {
          const mediaItem = this.buildTvMediaItem(tvResult, matchedEpisode, seasonEpisode, file, folderName, folderId)
          this.mediaStore.addOrMergeTvSeries(mediaItem)
          this.mediaStore.addToRecentlyAdded(mediaItem)
          console.log(`✅ 电视剧: ${file.name} -> ${mediaItem.name} S${seasonEpisode.season}E${seasonEpisode.episode} (TMDB)`)
          return null
        }
        return file
      }

      // 电影处理：Agent 已确认 TMDB ID 时，直接按 ID 获取元数据；只有旧任务没有 ID 时才按标题搜索。
      const movie = mediaHint?.mediaType === 'movie' && mediaHint.tmdbId
        ? await this.tmdbService.getMovieByTmdbId(mediaHint.tmdbId)
        : await this.tmdbService.searchMovie(lookupName, mediaHint?.year ? String(mediaHint.year) : normalized.releaseYear === undefined ? undefined : String(normalized.releaseYear), undefined, buildMediaFingerprint(file), file.name)
      if (movie) {
        const collection = movie.belongs_to_collection
        const mediaItem: MediaLibraryItem = {
          id: collection ? `collection_${collection.id}` : `${movie.id}`,
          parentId: folderName,
          folderId: folderId || `${file.driveId}`,
          folderPath: file.path.substring(0, file.path.lastIndexOf('/')) || '',
          type: 'movie',
          name: collection?.name || movie.title || movie.original_title || lookupName,
          overview: movie.overview,
          posterUrl: tmdbImageUrl(movie.poster_path) || undefined,
          backdropUrl: tmdbImageUrl(movie.backdrop_path) || undefined,
          year: movie.release_date?.substring(0, 4),
          rating: movie.vote_average,
          genres: movie.genres?.map(g => g.name) || [],
          credits: movie.credits,
          productionCountries: movie.production_countries?.map(c => c.name) || [],
          tmdbId: movie.id,
          imdbId: movie.imdb_id,
          driveFiles: [file],
          collectionId: collection?.id,
          collectionName: collection?.name,
          collectionMovies: collection ? [{
            id: `${movie.id}`,
            parentId: folderName,
            folderId: folderId || `${file.driveId}`,
            folderPath: file.path.substring(0, file.path.lastIndexOf('/')) || '',
            type: 'movie' as const,
            name: movie.title || movie.original_title || lookupName,
            overview: movie.overview,
            posterUrl: tmdbImageUrl(movie.poster_path) || undefined,
            backdropUrl: tmdbImageUrl(movie.backdrop_path) || undefined,
            year: movie.release_date?.substring(0, 4),
            rating: movie.vote_average,
            genres: movie.genres?.map(g => g.name) || [],
            credits: movie.credits,
            productionCountries: movie.production_countries?.map(c => c.name) || [],
            tmdbId: movie.id,
            imdbId: movie.imdb_id,
            driveFiles: [file],
            metadataSource: 'tmdb' as const,
            addedAt: new Date()
          }] : undefined,
          metadataSource: 'tmdb',
          addedAt: new Date()
        }
        this.mediaStore.addOrMergeTvSeries(mediaItem)
        this.mediaStore.addToRecentlyAdded(mediaItem)
        console.log(`✅ 电影: ${file.name} -> ${mediaItem.name} (TMDB)`)
        return null
      }

      return file
    } catch (error) {
      console.error(`处理文件失败: ${file.name}`, error)
      if (error instanceof TmdbTransientError) throw error
      return file
    }
  }

  private addUnmatchedMediaItem(file: DriveFileItem, folderName: string, folderId?: string, stage: 'tmdb_no_match' | 'ai_no_match' = 'tmdb_no_match', aiOutcome: 'not_attempted' | 'no_candidate' | 'candidate_rejected' | 'tmdb_no_match_after_ai' = 'not_attempted', aiCandidate?: { title: string; type: 'movie' | 'tv' | 'unknown'; year?: number; season?: number; episode?: number; confidence: number }): void {
    this.mediaStore.addMediaItem({
      id: this.getScopedDriveFileKey(file),
      parentId: folderName,
      folderId: folderId || `${file.driveId}`,
      folderPath: file.path.substring(0, file.path.lastIndexOf('/')) || '',
      type: 'unmatched',
      name: file.name.replace(/\.[^/.]+$/, '') || file.name,
      posterUrl: file.thumbnailLink || undefined,
      genres: [],
      driveFiles: [file],
      scrapeRetrying: false,
      addedAt: new Date()
    })
    const normalized = this.tmdbService.normalizeFileName(file.name)
    captureMediaScrapeUnrecognized({
      fileName: file.name,
      normalizedFileName: normalized.normalizedFileName,
      cleanedTitle: normalized.cleanedTitle,
      releaseYear: normalized.releaseYear,
      seasonNumber: normalized.seasonNumber,
      episodeNumber: normalized.episodeNumber,
      stage,
      tmdbOutcome: 'no_match',
      aiOutcome,
      aiCandidate,
      hasFingerprint: !!buildMediaFingerprint(file),
      fingerprintAlgorithm: file.contentHashName
    })
  }

  private addRetryPendingMediaItem(file: DriveFileItem, folderName: string, folderId?: string): void {
    this.mediaStore.addMediaItem({
      id: this.getScopedDriveFileKey(file),
      parentId: folderName,
      folderId: folderId || `${file.driveId}`,
      folderPath: file.path.substring(0, file.path.lastIndexOf('/')) || '',
      type: 'unmatched',
      name: file.name.replace(/\.[^/.]+$/, '') || file.name,
      posterUrl: file.thumbnailLink || undefined,
      overview: 'TMDB 服务暂时不可用，等待下次自动重新刮削。',
      genres: [],
      driveFiles: [file],
      scrapeRetrying: true,
      addedAt: new Date()
    })
  }

  private removeRetryPendingMediaItem(file: DriveFileItem): void {
    const id = this.getScopedDriveFileKey(file)
    const pending = this.mediaStore.mediaItems.find(item => item.id === id && item.scrapeRetrying)
    if (pending) this.mediaStore.removeMediaItem(id)
  }

  // 构建电视剧 MediaLibraryItem（从 processVideoFileWithoutAI 抽取）
  private buildTvMediaItem(
    tvResult: any,
    matchedEpisode: any,
    seasonEpisode: { season: number; episode: number },
    file: DriveFileItem,
    folderName: string,
    folderId?: string
  ): MediaLibraryItem {
    const currentEpisode = {
      id: matchedEpisode.id,
      episodeNumber: matchedEpisode.episode_number,
      seasonNumber: matchedEpisode.season_number,
      name: matchedEpisode.name,
      overview: matchedEpisode.overview,
      stillPath: tmdbImageUrl(matchedEpisode.still_path) || undefined,
      airDate: matchedEpisode.air_date,
      runtime: matchedEpisode.runtime,
      crew: matchedEpisode.crew,
      driveFiles: [file]
    }
    const currentSeason = {
      id: tvResult.current_season.id,
      seasonNumber: tvResult.current_season.season_number,
      name: tvResult.current_season.name,
      overview: tvResult.current_season.overview,
      posterPath: tvResult.current_season.poster_path,
      episodeCount: tvResult.current_season.episode_count || tvResult.current_season.episodes?.length || 0,
      airDate: tvResult.current_season.air_date,
      credits: tvResult.current_season.credits,
      episodes: [currentEpisode]
    }
    return {
      id: `${tvResult.tv.id}`,
      parentId: folderName,
      folderId: folderId,
      folderPath: file.path.substring(0, file.path.lastIndexOf('/')) || '',
      type: 'tv',
      name: tvResult.tv.name || tvResult.tv.original_name || '',
      overview: tvResult.tv.overview,
      posterUrl: tmdbImageUrl(tvResult.tv.poster_path) || undefined,
      backdropUrl: tmdbImageUrl(tvResult.tv.backdrop_path) || undefined,
      year: tvResult.tv.first_air_date?.substring(0, 4),
      rating: tvResult.tv.vote_average,
      genres: tvResult.tv.genres?.map((g: any) => g.name) || [],
      credits: tvResult.current_season?.credits,
      productionCountries: tvResult.tv.production_countries?.map((c: any) => c.name) || [],
      tmdbId: tvResult.tv.id,
      imdbId: tvResult.tv.imdbId,
      tvdbId: tvResult.tv.tvdbId,
      metadataSource: 'tmdb',
      seasons: [currentSeason],
      expectedSeasons: buildExpectedSeasons(tvResult),
      driveFiles: [],
      addedAt: new Date()
    }
  }

  // 处理单个视频文件 - 参考Swift版本的元数据匹配逻辑
  private async processVideoFile(file: DriveFileItem, folderName: string, folderId?: string): Promise<void> {
    try {
      const fileName = file.name.replace(/\.[^/.]+$/, '') // 去除文件扩展名
      const normalized = this.tmdbService.normalizeFileName(file.name, file.path || `${folderName}/${file.name}`)
      const seasonEpisode = normalized.seasonNumber === undefined || normalized.episodeNumber === undefined
        ? null
        : { season: normalized.seasonNumber, episode: normalized.episodeNumber }
      const lookupName = normalized.searchTitle || ''

      if (lookupName.replace(/\s/g, "").length === 0) {
        const unmatchedItem: MediaLibraryItem = {
          id: this.getScopedDriveFileKey(file),
          parentId: folderName,
          folderId: folderId || `${file.driveId}`,
          folderPath: file.path.substring(0, file.path.lastIndexOf('/')) || '',
          type: 'unmatched',
          name: fileName || file.name,
          posterUrl: file.thumbnailLink || undefined,
          genres: [],
          driveFiles: [file],
          addedAt: new Date()
        }

        this.mediaStore.addMediaItem(unmatchedItem)
        console.warn(`⚠️ 无法提取有效片名，已归类为未匹配: ${file.name} (folder=${folderName})`)
        return
      }

      // 检查是否为电视剧文件（必须能解析出季集信息）
      if (seasonEpisode) {
        // 电视剧处理逻辑 - 完全移植 Swift 的 processTVFile

        // 1. 首先尝试与现有电视剧匹配（addTvSeriesItemByMatchName逻辑）
        const existingTvItem = this.tryMatchExistingTvSeries(file, folderName, lookupName, seasonEpisode, folderId)
        if (existingTvItem) {
          console.log(`📺 已匹配现有剧集: ${existingTvItem.name} S${seasonEpisode.season}E${seasonEpisode.episode}`)
          return
        }

        // 2. 尝试通过TMDB API获取电视剧信息（对齐 Swift 的 parseAndFetchTVMetadata）
        const tmdbId = this.parseTmdbId(fileName)
        const year = normalized.releaseYear === undefined ? undefined : String(normalized.releaseYear)
        const shouldUseYear = Boolean(year && !lookupName.includes(year))
        const fingerprint = buildMediaFingerprint(file)

        const tvResult = tmdbId
          ? await this.tmdbService.searchTV(
              lookupName,
              seasonEpisode.season,
              shouldUseYear ? year : undefined,
              tmdbId,
              fingerprint
            )
          : await this.tmdbService.searchTV(
              lookupName,
              seasonEpisode.season,
              shouldUseYear ? year : undefined,
              undefined,
              fingerprint,
              fileName
            )

        const matchedEpisode = tvResult?.current_season?.episodes?.find(
          ep => ep.episode_number === seasonEpisode.episode
        )

        if (tvResult && tvResult.current_season && matchedEpisode) {
          const episodeStillPath = tmdbImageUrl(matchedEpisode.still_path) || undefined

          const currentEpisode = {
            id: matchedEpisode.id,
            episodeNumber: matchedEpisode.episode_number,
            seasonNumber: matchedEpisode.season_number,
            name: matchedEpisode.name,
            overview: matchedEpisode.overview,
            stillPath: episodeStillPath,
            airDate: matchedEpisode.air_date,
            runtime: matchedEpisode.runtime,
            crew: matchedEpisode.crew,
            driveFiles: [file]
          }

          const currentSeason = {
            id: tvResult.current_season.id,
            seasonNumber: tvResult.current_season.season_number,
            name: tvResult.current_season.name,
            overview: tvResult.current_season.overview,
            posterPath: tvResult.current_season.poster_path,
            episodeCount: tvResult.current_season.episode_count || tvResult.current_season.episodes?.length || 0,
            airDate: tvResult.current_season.air_date,
            credits: tvResult.current_season.credits,
            episodes: [currentEpisode]
          }

          const mediaItem: MediaLibraryItem = {
            id: `${tvResult.tv.id}`,
            parentId: folderName,
            folderId: folderId,
            folderPath: file.path.substring(0, file.path.lastIndexOf('/')) || '',
            type: 'tv',
            name: tvResult.tv.name || tvResult.tv.original_name || lookupName,
            overview: tvResult.tv.overview,
            posterUrl: tmdbImageUrl(tvResult.tv.poster_path) || undefined,
            backdropUrl: tmdbImageUrl(tvResult.tv.backdrop_path) || undefined,
            year: tvResult.tv.first_air_date?.substring(0, 4),
            rating: tvResult.tv.vote_average,
            genres: tvResult.tv.genres?.map(g => g.name) || [],
            credits: tvResult.current_season?.credits,
            productionCountries: tvResult.tv.production_countries?.map(c => c.name) || [],
            tmdbId: tvResult.tv.id,
            imdbId: tvResult.tv.imdbId,
            tvdbId: tvResult.tv.tvdbId,
            metadataSource: 'tmdb',
            seasons: [currentSeason],
            expectedSeasons: buildExpectedSeasons(tvResult),
            driveFiles: [],
            addedAt: new Date()
          }

          this.mediaStore.addOrMergeTvSeries(mediaItem)
          this.mediaStore.addToRecentlyAdded(mediaItem)

          console.log(`✅ 已处理电视剧: ${file.name} -> ${mediaItem.name} S${seasonEpisode.season}E${seasonEpisode.episode} (tv) - TMDB封面`)
        } else {
          const unmatchedItem: MediaLibraryItem = {
            id: this.getScopedDriveFileKey(file),
            parentId: folderName,
            folderId: folderId,
            folderPath: file.path.substring(0, file.path.lastIndexOf('/')) || '',
            type: 'unmatched',
            name: fileName || file.name,
            posterUrl: file.thumbnailLink || undefined,
            genres: [],
            driveFiles: [file],
            addedAt: new Date()
          }

          this.mediaStore.addMediaItem(unmatchedItem)
          console.log(`⚠️ 未匹配电视剧: ${file.name} - 使用文件缩略图`)
        }
      } else {
        // 电影处理逻辑（无季集信息的视频文件）
        const mediaInfo = await this.tmdbService.matchMedia(file.name, file.path, normalized)

        if (mediaInfo && (mediaInfo.type === 'movie' || !mediaInfo.type)) {
          const collectionId = mediaInfo.collectionId
          const movieItem = {
            id: `${mediaInfo.tmdbId || this.getScopedDriveFileKey(file)}`,
            parentId: folderName,
            folderId: folderId,
            folderPath: file.path.substring(0, file.path.lastIndexOf('/')) || '',
            type: 'movie' as const,
            name: mediaInfo.name!,
            overview: mediaInfo.overview,
            posterUrl: mediaInfo.posterUrl,
            backdropUrl: mediaInfo.backdropUrl,
            year: mediaInfo.year,
            rating: mediaInfo.rating,
            genres: mediaInfo.genres || [],
            credits: mediaInfo.credits,
            productionCountries: mediaInfo.productionCountries,
            tmdbId: mediaInfo.tmdbId,
            imdbId: mediaInfo.imdbId,
            tvdbId: mediaInfo.tvdbId,
            metadataSource: 'tmdb' as const,
            driveFiles: [file],
            addedAt: new Date()
          }
          const mediaItem: MediaLibraryItem = collectionId ? {
            ...movieItem,
            id: `collection_${collectionId}`,
            name: mediaInfo.collectionName || movieItem.name,
            collectionId,
            collectionName: mediaInfo.collectionName,
            collectionMovies: [movieItem]
          } : { ...movieItem, id: this.getScopedDriveFileKey(file) }

          this.mediaStore.addOrMergeTvSeries(mediaItem)
          this.mediaStore.addToRecentlyAdded(mediaItem)

          console.log(`✅ 已处理电影: ${file.name} -> ${mediaInfo.name} (${mediaInfo.type}) - TMDB封面`)
        } else {
          // 未匹配的项目 - 使用文件的缩略图作为封面
          const unmatchedItem: MediaLibraryItem = {
            id: this.getScopedDriveFileKey(file),
            parentId: folderName,
            folderId: folderId || `${file.driveId}`,
            folderPath: file.path.substring(0, file.path.lastIndexOf('/')) || '',
            type: 'unmatched',
            name: fileName || file.name,
            posterUrl: file.thumbnailLink || undefined,
            genres: [],
            driveFiles: [file],
            addedAt: new Date()
          }

          this.mediaStore.addMediaItem(unmatchedItem)
          console.log(`⚠️ 未匹配: ${file.name} - 使用文件缩略图`)
        }
      }
    } catch (error) {
      console.error(`处理视频文件失败: ${file.name}`, error)
    }
  }

  // 停止扫描
  stopScan(): void {
    this.shouldStop = true
    this.mediaStore.setScanning(false)
    console.log('扫描已停止')
  }

  // 检查是否正在扫描
  get isCurrentlyScanning(): boolean {
    return this.isScanning
  }

  private async canRunInternalAIScrape(): Promise<boolean> {
    const [{ resolveAIProviderConfig }, { isPro }] = await Promise.all([import('./bookAI'), import('./usageLimit')])
    return isPro() && resolveAIProviderConfig()?.providerName === 'boxplayer-cloud'
  }

  private async applyBatchAIScrapeResults(unmatchedFiles: DriveFileItem[], folderName: string, folderId: string, silent = false): Promise<number> {
    const { batchScrapeMediaWithAI } = await import('./mediaAIScrape')

    if (!unmatchedFiles.length) {
      if (!silent) message.warning(`"${folderName}" 中没有需要 AI 判断的未匹配视频`)
      return 0
    }

    if (!silent) message.info(`"${folderName}" 中有 ${unmatchedFiles.length} 个未匹配视频，正在 AI 识别…`)
    const fileInfos = unmatchedFiles.map(f => ({ name: f.name, path: f.path, fileSize: f.fileSize, driveFile: f }))
    const results = await batchScrapeMediaWithAI(fileInfos, folderName, folderId)

    let saved = 0
    for (const r of results) {
      if (r.mediaItem) {
        if (r.mediaItem.type === 'tv') {
          this.mediaStore.addOrMergeTvSeries(r.mediaItem)
        } else {
          this.mediaStore.addMediaItem(r.mediaItem)
        }
        saved++
      } else if (r.file.driveFile && !r.error) {
        const aiOutcome = r.decision && r.decision.type !== 'unknown'
          ? 'tmdb_no_match_after_ai'
          : r.candidate ? 'candidate_rejected' : 'no_candidate'
        this.addUnmatchedMediaItem(r.file.driveFile, folderName, folderId, 'ai_no_match', aiOutcome, r.candidate || undefined)
      } else if (r.error) {
        if (r.file.driveFile) this.addRetryPendingMediaItem(r.file.driveFile, folderName, folderId)
        console.warn(`AI/TMDB 临时失败，将在下次扫描重试: ${r.file.name}`, r.error)
      }
    }

    if (!silent && saved > 0) {
      message.success(`AI 识别完成：${saved}/${results.length} 个文件匹配成功`)
    } else if (!silent) {
      message.warning('AI 未能识别出任何影视作品')
    }
    return saved
  }

  // 断点续刮：保存/读取/清除扫描断点
  private SCAN_CHECKPOINT_KEY = 'media_scan_checkpoint'
  private saveScanCheckpoint(info: { folder: IAliGetFileModel; driveServerId: string; userId: string }) {
    try {
      localStorage.setItem(this.SCAN_CHECKPOINT_KEY, JSON.stringify({
        folderName: info.folder.name,
        fileId: info.folder.file_id,
        driveId: info.folder.drive_id || info.driveServerId,
        driveServerId: info.driveServerId,
        userId: info.userId,
        timestamp: Date.now()
      }))
    } catch {}
  }

  private saveLocalScanCheckpoint(localPath: string, folderName: string) {
    try {
      localStorage.setItem(this.SCAN_CHECKPOINT_KEY, JSON.stringify({ localPath, folderName, timestamp: Date.now() }))
    } catch {}
  }

  getScanCheckpoint(): { folderName: string; fileId?: string; driveId?: string; driveServerId?: string; userId?: string; localPath?: string; timestamp: number } | null {
    try {
      const raw = localStorage.getItem(this.SCAN_CHECKPOINT_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      // 超过 24 小时的断点视为过期
      if (Date.now() - parsed.timestamp > 86400000) { this.clearScanCheckpoint(); return null }
      return parsed
    } catch { return null }
  }

  clearScanCheckpoint() {
    try { localStorage.removeItem(this.SCAN_CHECKPOINT_KEY) } catch {}
  }

  // 从断点恢复扫描
  async resumeScanFromCheckpoint(): Promise<boolean> {
    const cp = this.getScanCheckpoint()
    if (!cp) return false
    if (cp.localPath) {
      await this.scanLocalFolder(cp.localPath)
      return true
    }
    if (!cp.fileId || !cp.driveId || !cp.driveServerId) return false
    const folder: IAliGetFileModel = {
      __v_skip: true,
      drive_id: cp.driveId,
      file_id: cp.fileId,
      parent_file_id: '',
      name: cp.folderName,
      namesearch: cp.folderName.toLowerCase(),
      ext: '', mime_type: '', mime_extension: '', category: 'folder',
      icon: 'iconfolder', file_count: 0, size: 0, sizeStr: '',
      time: Date.now(), timeStr: '', starred: false, isDir: true,
      thumbnail: '', path: ''
    } as any
    ;(folder as any).user_id = cp.userId || ''
    await this.scanFolder(folder, cp.driveServerId, { incremental: true, silent: true })
    return true
  }
}
