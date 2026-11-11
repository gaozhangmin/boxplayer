import { IAliGetFileModel } from '../aliapi/alimodels'
import AliDirFileList from '../aliapi/dirfilelist'
import { isAliyunUser } from '../aliapi/utils'
import UserDAL from '../user/userdal'
import { ITokenInfo } from '../user/userstore'
import useBookLibraryStore, { parseBookMeta } from '../store/booklibrary'
import { IBookItem } from '../types/book'
import { buildLibrarySourceId } from '../types/librarySource'
import { isScannableBookFormat } from './bookReaderCapabilities'
import DebugLog from './debuglog'
import { isThirdPartyProviderFolder, iterateProviderFolderPages, listProviderFolderItems } from './providerFolderList'
import { libraryScanRateLimitScope, rateLimitSingleScanPage } from './libraryScanRateLimiter'

const ISBN_RE = /(?:ISBN(?:-1[03])?:?\s*)?((?:97[89][-\s]?)?\d[-\s]?\d{2,5}[-\s]?\d{2,7}[-\s]?\d{1,7}[-\s]?[\dXx])/g

function extractISBN(...values: Array<string | undefined>): string {
  for (const value of values) {
    ISBN_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = ISBN_RE.exec(String(value || '')))) {
      const isbn = String(match[1] || '').replace(/[^0-9Xx]/g, '').toUpperCase()
      if (isbn.length === 10 || isbn.length === 13) return isbn
    }
  }
  return ''
}

import { getWebDavConnection, getWebDavConnectionId, isWebDavDrive, listWebDavDirectory } from './webdavClient'

const FOLDER_THROTTLE_MS = 50
const BFS_MAX_DEPTH = 128

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isBookFile(item: IAliGetFileModel): boolean {
  if (!item || item.isDir) return false
  const name = item.name || ''
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return isScannableBookFormat(name.slice(dot + 1))
}

function bookFromAliModel(item: IAliGetFileModel, user_id: string, drive_id: string, parent_path: string, source_id: string): IBookItem {
  const ext = item.ext || (() => {
    const i = (item.name || '').lastIndexOf('.')
    return i >= 0 ? (item.name || '').slice(i + 1) : ''
  })()
  const meta = parseBookMeta(item.name || '')
  const upperExt = (ext || '').toUpperCase()
  const isbn = extractISBN(item.name, item.description)
  return {
    id: `${user_id}|${drive_id}|${item.file_id}`,
    source_id,
    source_ids: [source_id],
    user_id,
    drive_id,
    file_id: item.file_id,
    parent_file_id: item.parent_file_id || '',
    parent_path: parent_path || '',
    file_name: item.name || '',
    ext: ext || '',
    size: item.size || 0,
    category: (item.category as any) || 'book',
    thumbnail: item.thumbnail || '',
    description: item.description || '',
    encType: item.description && item.description.includes('xbyEncrypt') ? 'xbyEncrypt' : '',
    title: meta.title,
    author: meta.author,
    summary: meta.summary || `${upperExt || 'BOOK'} · ${parent_path || '根目录'}`,
    cover_url: item.thumbnail || '',
    isbn,
    metadata_source: item.thumbnail ? 'thumbnail' : meta.metadata_source,
    scanned_at: Date.now(),
    updated_at: typeof item.time === 'number' && item.time > 0 ? item.time : undefined
  }
}

function readableTokenLabel(token: ITokenInfo): string {
  switch (token.tokenfrom) {
    case 'aliyun': return `阿里云盘 · ${token.nick_name || token.user_name || ''}`.trim()
    case 'cloud123': return `123 网盘 · ${token.nick_name || token.user_name || ''}`.trim()
    case '115': return `115 网盘 · ${token.nick_name || token.user_name || ''}`.trim()
    case 'baidu': return `百度网盘 · ${token.nick_name || token.user_name || ''}`.trim()
    case 'pikpak': return `PikPak · ${token.nick_name || token.user_name || ''}`.trim()
    case 'dropbox': return `Dropbox · ${token.nick_name || token.user_name || ''}`.trim()
    case 'onedrive': return `OneDrive · ${token.nick_name || token.user_name || ''}`.trim()
    case 'box': return `Box · ${token.nick_name || token.user_name || ''}`.trim()
    case 'quark': return `夸克网盘 · ${token.nick_name || token.user_name || ''}`.trim()
    case '139': return `139 云盘 · ${token.nick_name || token.user_name || ''}`.trim()
    case '189': return `天翼云盘 · ${token.nick_name || token.user_name || ''}`.trim()
    case 'webdav': return `WebDAV · ${token.nick_name || token.user_name || ''}`.trim()
    case 'alist': return `AList · ${token.nick_name || token.user_name || ''}`.trim()
    case 'smb': return `SMB · ${token.nick_name || token.user_name || ''}`.trim()
    case 'nfs': return `NFS · ${token.nick_name || token.user_name || ''}`.trim()
    case 'ftp': return `FTP · ${token.nick_name || token.user_name || ''}`.trim()
    default: return token.nick_name || token.user_name || token.user_id
  }
}

class BookScanner {
  private static instance: BookScanner | null = null
  private isRunning = false
  private shouldStop = false
  private silent = false
  private hadError = false

  static getInstance(): BookScanner {
    if (!BookScanner.instance) BookScanner.instance = new BookScanner()
    return BookScanner.instance
  }

  get isScanning(): boolean { return this.isRunning }

  stopScan(): void {
    this.shouldStop = true
  }

  async scanFolder(folder: IAliGetFileModel, user_id: string): Promise<{ found: number; scanned: number }> {
    if (this.isRunning) return { found: 0, scanned: 0 }
    this.isRunning = true
    this.shouldStop = false
    this.silent = false
    this.hadError = false
    const store = useBookLibraryStore()
    const drive_id = folder.drive_id || ''
    const label = folder.name || '指定文件夹'
    const counters = { scanned: 0, found: 0, seen: new Set<string>() }
    const sourceId = buildLibrarySourceId('book', user_id, drive_id, folder.file_id)
    store.setIsScanning(true)
    store.setScanProgress(`正在扫描 ${label}`, 0, 0)
    try {
      await this.bfsCollect(folder, user_id, drive_id, folder.name || '', label, counters, 0, sourceId)
      if (!this.shouldStop && !this.hadError) {
        await store.reconcileSource(sourceId, [...counters.seen])
        await store.saveSource({ id: sourceId, kind: 'book', user_id, drive_id, folder_id: folder.file_id, name: folder.name || label, path: (folder as any).path || '', created_at: Date.now(), scanned_at: Date.now(), item_count: counters.seen.size })
        await store.markScanFinished()
      }
    } catch (e) {
      this.hadError = true
      DebugLog.mSaveWarning('bookScanner.scanFolder failed: ' + (e as Error).message)
    } finally {
      store.setIsScanning(false)
      this.isRunning = false
      this.shouldStop = false
      this.silent = false
    }
    return counters
  }

  async scanAllUsers(opts: { userIdAllowList?: Set<string>; silent?: boolean } = {}): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    this.shouldStop = false
    this.silent = !!opts.silent
    this.hadError = false
    const store = useBookLibraryStore()
    store.setIsScanning(true)
    try {
      const users = await UserDAL.GetUserListFromDB()
      for (const u of users) {
        if (this.shouldStop) break
        if (!u || !u.access_token) continue
        if (opts.userIdAllowList && !opts.userIdAllowList.has(u.user_id)) continue
        try {
          await this.scanUser(u)
        } catch (e) {
          this.hadError = true
          DebugLog.mSaveWarning('bookScanner.scanUser failed: ' + (e as Error).message)
        }
      }
      if (!this.shouldStop && !this.hadError) await store.markScanFinished()
    } finally {
      store.setIsScanning(false)
      this.isRunning = false
      this.shouldStop = false
      this.silent = false
    }
  }

  async scanUser(token: ITokenInfo): Promise<void> {
    if (!token || !token.access_token) return
    const label = readableTokenLabel(token)
    const store = useBookLibraryStore()
    store.setScanProgress(`正在扫描 ${label}`, 0, 0)

    if (token.tokenfrom === 'aliyun' || isAliyunUser(token.user_id)) {
      await this.scanAliyun(token, label)
      return
    }

    if (['webdav', 'alist', 'smb', 'nfs', 'ftp'].includes(token.tokenfrom) || isWebDavDrive(token.default_drive_id)) {
      const driveId = token.default_drive_id || `webdav:${token.access_token}`
      const connection = getWebDavConnection(getWebDavConnectionId(driveId))
      if (!connection) throw new Error('远程文件来源连接不存在或已被移除')
      const rootFolder: IAliGetFileModel = {
        ...({} as any),
        file_id: '/',
        parent_file_id: '',
        drive_id: driveId,
        name: '/',
        isDir: true
      } as IAliGetFileModel
      ;(rootFolder as any).path = '/'
      const counters = { scanned: 0, found: 0, seen: new Set<string>() }
      const sourceId = buildLibrarySourceId('book', token.user_id, driveId, rootFolder.file_id || 'root')
      await this.bfsCollect(rootFolder, token.user_id, driveId, '', label, counters, 0, sourceId)
      if (!this.shouldStop) {
        await store.reconcileSource(sourceId, [...counters.seen])
        await store.saveSource({ id: sourceId, kind: 'book', user_id: token.user_id, drive_id: driveId, folder_id: rootFolder.file_id || 'root', name: label, path: (rootFolder as any).path || '', created_at: Date.now(), scanned_at: Date.now(), item_count: counters.seen.size })
      }
      return
    }

    const sentinelMap: Record<string, string> = {
      cloud123: '0',
      '115': '0',
      baidu: '/',
      pikpak: 'pikpak_root',
      dropbox: 'dropbox_root',
      onedrive: 'onedrive_root',
      box: '0',
      google: 'google_root',
      quark: '0',
      '139': 'cloud139_root',
      '189': 'cloud189_root',
      guangya: 'guangya_root'
    }
    const driveId =
      token.tokenfrom === 'cloud123' ? 'cloud123' :
      token.tokenfrom === '115' ? 'drive115' :
      token.tokenfrom === 'baidu' ? 'baidu' :
      token.tokenfrom === 'pikpak' ? 'pikpak' :
      token.tokenfrom === 'dropbox' ? 'dropbox' :
      token.tokenfrom === 'onedrive' ? 'onedrive' :
      token.tokenfrom === 'box' ? 'box' :
      token.tokenfrom === 'google' ? 'google' :
      token.tokenfrom === 'quark' ? 'quark' :
      token.tokenfrom === '139' ? 'cloud139' :
      token.tokenfrom === '189' ? 'cloud189' :
      token.tokenfrom === 'guangya' ? 'guangya' :
      ''
    if (!driveId) return

    const rootFolder: IAliGetFileModel = {
      ...({} as any),
      file_id: sentinelMap[token.tokenfrom] || '',
      parent_file_id: '',
      drive_id: driveId,
      name: '/',
      isDir: true
    } as IAliGetFileModel
    ;(rootFolder as any).path = token.tokenfrom === 'baidu' ? '/' : ''
    const counters = { scanned: 0, found: 0, seen: new Set<string>() }
    const sourceId = buildLibrarySourceId('book', token.user_id, driveId, rootFolder.file_id || 'root')
    await this.bfsCollect(rootFolder, token.user_id, driveId, '', label, counters, 0, sourceId)
    if (!this.shouldStop) {
      await store.reconcileSource(sourceId, [...counters.seen])
      await store.saveSource({ id: sourceId, kind: 'book', user_id: token.user_id, drive_id: driveId, folder_id: rootFolder.file_id || 'root', name: label, path: (rootFolder as any).path || '', created_at: Date.now(), scanned_at: Date.now(), item_count: counters.seen.size })
    }
  }

  private async scanAliyun(token: ITokenInfo, label: string): Promise<void> {
    const drives = new Set<string>()
    if (token.default_drive_id) drives.add(token.default_drive_id)
    if (token.resource_drive_id) drives.add(token.resource_drive_id)
    if (token.backup_drive_id) drives.add(token.backup_drive_id)
    const store = useBookLibraryStore()
    let scanned = 0
    let found = 0
    for (const drive_id of drives) {
      if (this.shouldStop) break
      try {
        const rootFolder: IAliGetFileModel = {
          ...({} as any),
          file_id: 'root',
          parent_file_id: '',
          drive_id,
          name: '/',
          isDir: true
        } as IAliGetFileModel
        const counters = { scanned: 0, found: 0, seen: new Set<string>() }
        const sourceId = buildLibrarySourceId('book', token.user_id, drive_id, 'root')
        await this.bfsCollect(rootFolder, token.user_id, drive_id, '', `${label} · ${drive_id.slice(-6)}`, counters, 0, sourceId)
        if (!this.shouldStop) {
          await store.reconcileSource(sourceId, [...counters.seen])
          await store.saveSource({ id: sourceId, kind: 'book', user_id: token.user_id, drive_id, folder_id: 'root', name: `${label} · ${drive_id.slice(-6)}`, path: '', created_at: Date.now(), scanned_at: Date.now(), item_count: counters.seen.size })
        }
        scanned += counters.scanned
        found += counters.found
        store.setScanProgress(`正在扫描 ${label}`, scanned, found)
      } catch (e) {
        this.hadError = true
        DebugLog.mSaveWarning(`bookScanner.scanAliyun failed (${drive_id}): ${(e as Error).message}`)
      }
    }
  }

  private async bfsCollect(
    folder: IAliGetFileModel,
    user_id: string,
    drive_id: string,
    parent_path: string,
    label: string,
    counters: { scanned: number; found: number; seen: Set<string> },
    depth: number,
    sourceId: string
  ): Promise<void> {
    if (this.shouldStop) return
    if (depth > BFS_MAX_DEPTH) {
      this.hadError = true
      const error = new Error(`bookScanner depth limit reached: ${folder.name}`)
      DebugLog.mSaveWarning(error.message)
      throw error
    }
    const store = useBookLibraryStore()
    try {
      for await (const items of this.iterateFolderPages(folder, user_id, drive_id)) {
        if (this.shouldStop) break
        counters.scanned += items.length
        const books = items.filter(isBookFile)
        if (books.length) {
          const mapped = books.map((it) => bookFromAliModel(it, user_id, drive_id, parent_path, sourceId))
          mapped.forEach(book => counters.seen.add(book.id))
          await store.appendBooks(mapped, { addToLoaded: false })
          counters.found += books.length
        }
        store.setScanProgress(`正在扫描 ${label}`, counters.scanned, counters.found)

        for (const child of items) {
          if (this.shouldStop) break
          if (!child.isDir) continue
          const childPath = parent_path ? `${parent_path}/${child.name}` : child.name
          await delay(FOLDER_THROTTLE_MS)
          await this.bfsCollect(child, user_id, drive_id, childPath, label, counters, depth + 1, sourceId)
        }
      }
    } catch (e) {
      this.hadError = true
      DebugLog.mSaveWarning('bookScanner.listFolder failed: ' + (e as Error).message)
      throw e
    }
  }

  private async *iterateFolderPages(folder: IAliGetFileModel, user_id: string, drive_id: string): AsyncGenerator<IAliGetFileModel[]> {
    const scope = libraryScanRateLimitScope(user_id, drive_id)
    if (isWebDavDrive(drive_id)) {
      const connection = getWebDavConnection(getWebDavConnectionId(drive_id))
      if (!connection) throw new Error('WebDAV 连接不存在或已被移除')
      yield* rateLimitSingleScanPage(scope, () => listWebDavDirectory(connection, (folder as any).path || folder.file_id || '/'))
      return
    }
    if (isThirdPartyProviderFolder(user_id, drive_id)) {
      yield* iterateProviderFolderPages({ folder, userId: user_id, driveId: drive_id, silent: this.silent, shouldStop: () => this.shouldStop })
      return
    }
    if (isAliyunUser(user_id)) {
      yield* AliDirFileList.ApiDirFileListPages(user_id, drive_id, folder.file_id, folder.name || '', 'name asc', '', false, scope)
      return
    }
    yield* rateLimitSingleScanPage(scope, () => this.listFolder(folder, user_id, drive_id))
  }

  private async listFolder(folder: IAliGetFileModel, user_id: string, drive_id: string): Promise<IAliGetFileModel[]> {
    const fileId = folder.file_id

    const providerItems = await listProviderFolderItems({ folder, userId: user_id, driveId: drive_id, silent: this.silent, shouldStop: () => this.shouldStop })
    if (providerItems) return providerItems

    if (isAliyunUser(user_id)) {
      const result = await AliDirFileList.ApiDirFileList(
        user_id,
        drive_id,
        fileId,
        folder.name || '',
        'name asc',
        '',
        undefined,
        false
      )
      return result?.items || []
    }
    return []
  }
}

export default BookScanner
