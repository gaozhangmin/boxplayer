import type { PackageTreeFile, ResourceCandidate, TransferAttempt, TransferStatus, VerifiedFile } from '@mediary/domain'
import { episodeCodeFromFileName } from '@mediary/episode-code'
import type { StorageExecutor, UnparsedVideoFile } from '@mediary/ports'
import { isBoxPlayerDriveAuthError } from '@mediary/storage-brands'
import type { OfflineTask, OfflineTaskStatus } from './providerTransfers'

export interface DriveItem {
  id: string
  name: string
  isDirectory: boolean
  size: number
}

/** The drive operations one BoxPlayer login offers to the mediary workflow. */
export interface BoxPlayerDriveClient {
  label: string
  /** The provider's own root id; it is never written to or removed. */
  rootId: string
  listFiles(directoryId: string): Promise<DriveItem[]>
  createDirectory(parentId: string, name: string): Promise<string>
  renameFile(fileId: string, newName: string): Promise<void>
  moveFiles(fileIds: string[], targetDirectoryId: string): Promise<void>
  trashFiles(fileIds: string[]): Promise<void>
  /** Share links this login can save; resolves once the provider accepted the save, throws when the share is dead. */
  importShare?(input: { url: string; password: string; directoryId: string }): Promise<void>
  shareTypes?: string[]
  /** Magnet / HTTP offline download. */
  createOfflineTask?(input: { url: string; title: string; directoryId: string }): Promise<OfflineTask>
  getOfflineTaskStatus?(task: OfflineTask): Promise<OfflineTaskStatus>
}

export interface BoxPlayerStorageExecutorOptions {
  client: BoxPlayerDriveClient
  /** The run's chosen folder(s). Writes are allowed there and in folders found or created under them. */
  writeScopeDirectoryIds: string[]
  minVideoSizeBytes?: number
  taskPollMaxPolls?: number
  taskPollIntervalMs?: number
  shareSettlePolls?: number
  shareSettleIntervalMs?: number
  wait?: (ms: number) => Promise<void>
}

const MAX_RECURSIVE_DEPTH = 6
const DEFAULT_MIN_VIDEO_SIZE_BYTES = 10 * 1024 * 1024
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.m2ts', '.rmvb']

interface VideoFact { file: VerifiedFile; sourceDirectoryId: string }

/**
 * mediary's StorageExecutor over a BoxPlayer drive login. It follows the vendored
 * GuangYaStorageExecutor: writes stay inside the derived scope (the chosen folder plus
 * folders found or created under it), every transfer is judged by re-reading the target
 * directory, and a login failure surfaces as BOXPLAYER_DRIVE_AUTH instead of a failed attempt.
 */
export class BoxPlayerStorageExecutor implements StorageExecutor {
  private readonly client: BoxPlayerDriveClient
  private readonly scopeRoots: Set<string>
  private readonly derivedScope = new Set<string>()
  private readonly minVideoSizeBytes: number
  private readonly taskPollMaxPolls: number
  private readonly taskPollIntervalMs: number
  private readonly shareSettlePolls: number
  private readonly shareSettleIntervalMs: number
  private readonly wait: (ms: number) => Promise<void>
  private nextTransferNumber = 1

  constructor(options: BoxPlayerStorageExecutorOptions) {
    this.client = options.client
    this.scopeRoots = new Set(options.writeScopeDirectoryIds.map(id => id.trim()).filter(Boolean))
    if (!this.scopeRoots.size) throw new Error('BoxPlayer 网盘执行器必须限定在所选目录内')
    this.minVideoSizeBytes = options.minVideoSizeBytes ?? DEFAULT_MIN_VIDEO_SIZE_BYTES
    this.taskPollMaxPolls = options.taskPollMaxPolls ?? 60
    this.taskPollIntervalMs = options.taskPollIntervalMs ?? 3000
    this.shareSettlePolls = options.shareSettlePolls ?? 6
    this.shareSettleIntervalMs = options.shareSettleIntervalMs ?? 2500
    this.wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  async createDirectory(input: { name: string; parentId: string }): Promise<string> {
    const parentId = this.assertWritable(input.parentId, 'create directory')
    const existing = (await this.client.listFiles(parentId)).find(item => item.isDirectory && item.name === input.name)
    const id = existing?.id || await this.client.createDirectory(parentId, input.name)
    this.derivedScope.add(id)
    return id
  }

  async listVideoFiles(directoryId: string): Promise<VerifiedFile[]> {
    return (await this.collectVideos(this.assertListable(directoryId), this.assertListable(directoryId))).map(fact => fact.file)
  }

  async listUnparsedVideoFiles(directoryId: string): Promise<UnparsedVideoFile[]> {
    const videos = await this.collectVideos(this.assertListable(directoryId), this.assertListable(directoryId))
    return videos.filter(fact => fact.file.episodeCode === null).map(fact => ({ providerFileId: fact.file.providerFileId, name: fact.file.name, sizeBytes: fact.file.sizeBytes }))
  }

  async renameFile(input: { directoryId: string; fileId: string; newName: string }): Promise<void> {
    this.assertWritable(input.directoryId, 'rename file')
    await this.client.renameFile(input.fileId, input.newName)
  }

  async transfer(input: { workflowRunId: string; directoryId: string; candidate: ResourceCandidate }): Promise<TransferAttempt> {
    const directoryId = this.assertWritable(input.directoryId, 'transfer')
    const url = String(input.candidate.providerPayload['url'] || '')
    const password = String(input.candidate.providerPayload['password'] || '')
    const before = new Set((await this.listVideoFiles(directoryId)).map(file => file.id))
    let providerMessage = ''
    let accepted = false
    try {
      if (isOfflineLink(input.candidate.type, url)) {
        if (!this.client.createOfflineTask || !this.client.getOfflineTaskStatus) throw new Error(`BOXPLAYER_NO_OFFLINE: ${this.client.label} 不支持磁力/离线下载，请改用分享链候选`)
        const task = await this.client.createOfflineTask({ url, title: input.candidate.title, directoryId })
        accepted = true
        providerMessage = await this.pollOfflineTask(task)
      } else if (this.client.importShare && (this.client.shareTypes || []).includes(input.candidate.type)) {
        await this.client.importShare({ url, password, directoryId })
        accepted = true
      } else {
        throw new Error(`BOXPLAYER_UNSUPPORTED_LINK: ${this.client.label} 不能转存这类链接（${input.candidate.type}）`)
      }
    } catch (error) {
      if (isBoxPlayerDriveAuthError(error)) throw error
      providerMessage = error instanceof Error ? error.message : String(error)
      accepted = false
    }

    // A share save and an offline task both land asynchronously; re-read until videos appear or the window ends.
    let materializedFileIds: string[] = []
    const polls = accepted ? this.shareSettlePolls : 1
    for (let poll = 0; poll < polls; poll++) {
      materializedFileIds = (await this.listVideoFiles(directoryId)).filter(file => !before.has(file.id)).map(file => file.id)
      if (materializedFileIds.length || poll === polls - 1) break
      await this.wait(this.shareSettleIntervalMs)
    }
    const status: TransferStatus = !accepted ? 'failed' : materializedFileIds.length ? 'succeeded' : 'no_target_change'
    const attempt: TransferAttempt = {
      id: `${input.workflowRunId}_transfer_${this.nextTransferNumber}`,
      workflowRunId: input.workflowRunId,
      candidateId: input.candidate.id,
      status,
      providerMessage: providerMessage || (status === 'no_target_change' ? '任务已提交，但等待时间内目标目录未出现新视频' : ''),
      materializedFileIds
    }
    this.nextTransferNumber += 1
    return attempt
  }

  async flattenDirectory(directoryId: string): Promise<{ moved: string[]; removed: string[] }> {
    const safe = this.assertWritable(directoryId, 'flatten directory')
    const moved = (await this.collectVideos(safe, safe)).filter(fact => fact.sourceDirectoryId !== safe && fact.file.sizeBytes >= this.minVideoSizeBytes).map(fact => fact.file.providerFileId)
    if (moved.length) await this.client.moveFiles(moved, safe)
    const removed: string[] = []
    for (const item of await this.client.listFiles(safe)) {
      if (!item.isDirectory) continue
      const videos = await this.collectVideos(item.id, item.id)
      if (!videos.some(fact => fact.file.sizeBytes >= this.minVideoSizeBytes)) removed.push(item.id)
    }
    if (removed.length) await this.client.trashFiles(removed)
    return { moved, removed }
  }

  async deleteFiles(input: { directoryId: string; fileIds: string[] }): Promise<{ deleted: string[] }> {
    if (!input.fileIds.length) return { deleted: [] }
    const safe = this.assertWritable(input.directoryId, 'delete files')
    const known = new Set((await this.listTree({ directoryId: safe })).map(file => file.providerFileId))
    const unknown = input.fileIds.filter(id => !known.has(id))
    if (unknown.length) throw new Error(`SAFETY_VIOLATION: refusing to delete unverified file ids from target directory; fileId=${safe}; fileIds=${unknown.join(',')}`)
    await this.client.trashFiles(input.fileIds)
    return { deleted: input.fileIds }
  }

  async removeDirectory(directoryId: string): Promise<{ removed: boolean }> {
    const safe = this.assertWritable(directoryId, 'remove directory')
    if (this.scopeRoots.has(safe) || safe === this.client.rootId) throw new Error(`SAFETY_VIOLATION: refusing to remove protected/root directory fileId=${safe}`)
    await this.client.trashFiles([safe])
    return { removed: true }
  }

  async listTree(input: { directoryId: string; maxDepth?: number }): Promise<PackageTreeFile[]> {
    const root = this.assertListable(input.directoryId)
    const maxDepth = input.maxDepth ?? MAX_RECURSIVE_DEPTH
    const results: PackageTreeFile[] = []
    const walk = async (dirId: string, prefix: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return
      for (const item of await this.client.listFiles(dirId)) {
        if (item.isDirectory) await walk(item.id, `${prefix}${item.name}/`, depth + 1)
        else results.push({ path: `${prefix}${item.name}`, providerFileId: item.id, sizeBytes: item.size })
      }
    }
    await walk(root, '', 1)
    return results
  }

  async listSubdirectories(input: { directoryId: string; maxDepth?: number }): Promise<Array<{ id: string; path: string }>> {
    const root = this.assertListable(input.directoryId)
    const maxDepth = input.maxDepth ?? MAX_RECURSIVE_DEPTH
    const results: Array<{ id: string; path: string }> = []
    const walk = async (dirId: string, prefix: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return
      // A folder found under an in-scope folder is in scope too (an offline task's wrapper folder, say).
      const parentInScope = this.isWritable(dirId)
      for (const item of await this.client.listFiles(dirId)) {
        if (!item.isDirectory) continue
        if (parentInScope) this.derivedScope.add(item.id)
        const path = `${prefix}${item.name}`
        results.push({ id: item.id, path })
        await walk(item.id, `${path}/`, depth + 1)
      }
    }
    await walk(root, '', 1)
    return results
  }

  async listChildDirectories(directoryId: string): Promise<Array<{ id: string; name: string }>> {
    return (await this.client.listFiles(directoryId)).filter(item => item.isDirectory).map(item => ({ id: item.id, name: item.name }))
  }

  async moveFiles(input: { fileIds: string[]; targetDirectoryId: string }): Promise<{ moved: string[] }> {
    if (!input.fileIds.length) return { moved: [] }
    await this.client.moveFiles(input.fileIds, this.assertWritable(input.targetDirectoryId, 'move files into'))
    return { moved: input.fileIds }
  }

  private async pollOfflineTask(task: OfflineTask): Promise<string> {
    for (let poll = 0; poll < this.taskPollMaxPolls; poll++) {
      const status = await this.client.getOfflineTaskStatus!(task)
      if (status.failed) return status.message || '离线下载任务失败'
      if (status.completed) return ''
      await this.wait(this.taskPollIntervalMs)
    }
    return ''
  }

  private async collectVideos(rootId: string, currentId: string, depth = 1): Promise<VideoFact[]> {
    if (depth > MAX_RECURSIVE_DEPTH) return []
    const videos: VideoFact[] = []
    for (const item of await this.client.listFiles(currentId)) {
      if (item.isDirectory) {
        videos.push(...(await this.collectVideos(rootId, item.id, depth + 1)))
        continue
      }
      if (!isVideoName(item.name)) continue
      videos.push({ file: { id: item.id, storageDirectoryId: rootId, name: item.name, sizeBytes: item.size, episodeCode: episodeCodeFromFileName(item.name), providerFileId: item.id }, sourceDirectoryId: currentId })
    }
    return videos
  }

  private isWritable(directoryId: string): boolean {
    const id = directoryId.trim()
    return !!id && (this.scopeRoots.has(id) || this.derivedScope.has(id))
  }

  private assertWritable(directoryId: string, action: string): string {
    const id = directoryId.trim()
    if (this.isWritable(id)) return id
    throw new Error(`WRITE_SCOPE_VIOLATION: refusing to ${action} outside configured write scope; fileId=${id}`)
  }

  /** Never walk the whole drive recursively. */
  private assertListable(directoryId: string): string {
    const id = directoryId.trim()
    if (!id || id === this.client.rootId) throw new Error(`SAFETY_VIOLATION: refusing to recursively list protected directory fileId=${id || '(root)'}`)
    return id
  }
}

function isOfflineLink(type: string, url: string): boolean {
  return type === 'magnet' || /^(?:magnet:|ed2k:|https?:\/\/.+\.torrent(?:$|\?))/i.test(url)
}

function isVideoName(name: string): boolean {
  const lower = name.toLowerCase()
  return VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext))
}
