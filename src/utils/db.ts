import { readHomeCatalogPages } from './homeCatalogPages'
import { isDetailCollectionSource } from './detailCollections'
import Dexie from 'dexie'
import { ITokenInfo } from '../user/userstore'
import { IOtherShareLinkModel } from '../share/share/OtherShareStore'
import { IMusicTrack } from '../types/music'
import { IBookItem } from '../types/book'
import { IBookNote } from '../types/bookNote'
import { IBookBookmark } from '../types/bookBookmark'
import type { MediaLibraryFolder, MediaLibraryItem } from '../types/media'
import { buildLibrarySourceId, type ILibrarySource, type LibrarySourceKind } from '../types/librarySource'
import type { AIConversation, AIMessage, BookIndexMeta } from '../services/ai/types'
import type { TextChunk } from './bookAI'
import { mediaDriveFileKey, reconcileMediaItemSource } from './mediaSourceMembership'
import { mediaPersistenceSnapshot } from './mediaPersistenceSnapshot'
import { associateScrapedFiles, mergeScrapedMedia } from './mediaScrapeMerge'
import { shouldEnrichMusic, musicCohortKey } from './musicCatalog'

type AIConversationRecord = AIConversation
type AIMessageRecord = AIMessage

class XBYDB3 extends Dexie {
  iobject: Dexie.Table<object, string>
  istring: Dexie.Table<string, string>
  inumber: Dexie.Table<number, string>
  ibool: Dexie.Table<boolean, string>
  icache: Dexie.Table<Blob, string>

  itoken: Dexie.Table<ITokenInfo, string>
  iothershare: Dexie.Table<IOtherShareLinkModel, string>
  imusic_track: Dexie.Table<IMusicTrack, string>
  ibook_item: Dexie.Table<IBookItem, string>
  ibook_note: Dexie.Table<IBookNote, string>
  ibook_bookmark: Dexie.Table<IBookBookmark, string>
  ibook_ai_chunk: Dexie.Table<TextChunk, string>
  ibook_ai_meta: Dexie.Table<BookIndexMeta, string>
  ibook_ai_bm25: Dexie.Table<{ id: string; bookId: string; sourceHash: string; settingsHash: string; updatedAt: number }, string>
  ibook_ai_conversation: Dexie.Table<AIConversationRecord, string>
  ibook_ai_message: Dexie.Table<AIMessageRecord, string>
  imedia_item: Dexie.Table<MediaLibraryItem, string>
  imedia_folder: Dexie.Table<MediaLibraryFolder, string>
  imedia_file: Dexie.Table<{ id: string; fileId: string; mediaId: string; folderId?: string }, string>
  ilibrary_source: Dexie.Table<ILibrarySource, string>

  constructor() {
    super('XBY3Database')

    this.version(10)
      .stores({
        iobject: '',
        istring: '',
        inumber: '',
        ibool: '',
        icache: '',

        itoken: 'user_id',
        iothershare: 'share_id'
      })
      .upgrade((tx: any) => {
        console.log('upgrade', tx)
      })

    this.version(11)
      .stores({
        iobject: '',
        istring: '',
        inumber: '',
        ibool: '',
        icache: '',

        itoken: 'user_id',
        iothershare: 'share_id',
        imusic_track: '&id, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, artist, album'
      })
      .upgrade((tx: any) => {
        console.log('upgrade to v11 (music_track)', tx)
      })

    this.version(12)
      .stores({
        iobject: '',
        istring: '',
        inumber: '',
        ibool: '',
        icache: '',

        itoken: 'user_id',
        iothershare: 'share_id',
        imusic_track: '&id, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, artist, album',
        ibook_item: '&id, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, author, ext'
      })
      .upgrade((tx: any) => {
        console.log('upgrade to v12 (book_item)', tx)
      })

    this.version(13)
      .stores({
        iobject: '',
        istring: '',
        inumber: '',
        ibool: '',
        icache: '',

        itoken: 'user_id',
        iothershare: 'share_id',
        imusic_track: '&id, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, artist, album',
        ibook_item: '&id, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, author, ext',
        ibook_note: '&id, book_id, [user_id+drive_id], user_id, drive_id, file_id, kind, created_at, updated_at'
      })
      .upgrade((tx: any) => {
        console.log('upgrade to v13 (book_note)', tx)
      })

    this.version(14)
      .stores({
        iobject: '',
        istring: '',
        inumber: '',
        ibool: '',
        icache: '',

        itoken: 'user_id',
        iothershare: 'share_id',
        imusic_track: '&id, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, artist, album',
        ibook_item: '&id, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, author, ext',
        ibook_note: '&id, book_id, [user_id+drive_id], user_id, drive_id, file_id, kind, created_at, updated_at',
        ibook_bookmark: '&id, book_id, [user_id+drive_id], user_id, drive_id, file_id, percentage, created_at, updated_at'
      })
      .upgrade((tx: any) => {
        console.log('upgrade to v14 (book_bookmark)', tx)
      })

    this.version(15)
      .stores({
        iobject: '',
        istring: '',
        inumber: '',
        ibool: '',
        icache: '',

        itoken: 'user_id',
        iothershare: 'share_id',
        imusic_track: '&id, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, artist, album',
        ibook_item: '&id, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, author, ext',
        ibook_note: '&id, book_id, [user_id+drive_id], user_id, drive_id, file_id, kind, created_at, updated_at',
        ibook_bookmark: '&id, book_id, [user_id+drive_id], user_id, drive_id, file_id, percentage, created_at, updated_at',
        ibook_ai_chunk: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, sectionIndex, pageNumber',
        ibook_ai_meta: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, lastUpdated',
        ibook_ai_bm25: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, updatedAt',
        ibook_ai_conversation: '&id, bookId, [bookId+mode], updatedAt',
        ibook_ai_message: '&id, conversationId, createdAt'
      })

    this.version(16)
      .stores({
        iobject: '', istring: '', inumber: '', ibool: '', icache: '', itoken: 'user_id', iothershare: 'share_id',
        imusic_track: '&id, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, artist, album',
        ibook_item: '&id, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, author, ext',
        ibook_note: '&id, book_id, [user_id+drive_id], user_id, drive_id, file_id, kind, created_at, updated_at',
        ibook_bookmark: '&id, book_id, [user_id+drive_id], user_id, drive_id, file_id, percentage, created_at, updated_at',
        ibook_ai_chunk: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, sectionIndex, pageNumber',
        ibook_ai_meta: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, lastUpdated',
        ibook_ai_bm25: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, updatedAt',
        ibook_ai_conversation: '&id, bookId, [bookId+mode], updatedAt', ibook_ai_message: '&id, conversationId, createdAt',
        imedia_item: '&id, folderId, type, addedAt, tmdbId', imedia_folder: '&id, [userId+driveId], fileId, scanDate'
      })

    this.version(17)
      .stores({
        iobject: '', istring: '', inumber: '', ibool: '', icache: '', itoken: 'user_id', iothershare: 'share_id',
        imusic_track: '&id, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, artist, album',
        ibook_item: '&id, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, author, ext',
        ibook_note: '&id, book_id, [user_id+drive_id], user_id, drive_id, file_id, kind, created_at, updated_at', ibook_bookmark: '&id, book_id, [user_id+drive_id], user_id, drive_id, file_id, percentage, created_at, updated_at',
        ibook_ai_chunk: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, sectionIndex, pageNumber', ibook_ai_meta: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, lastUpdated', ibook_ai_bm25: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, updatedAt', ibook_ai_conversation: '&id, bookId, [bookId+mode], updatedAt', ibook_ai_message: '&id, conversationId, createdAt',
        imedia_item: '&id, folderId, type, addedAt, tmdbId', imedia_folder: '&id, [userId+driveId], fileId, scanDate', imedia_file: '&id, mediaId, folderId'
      })
      .upgrade((tx: any) => {
        console.log('upgrade to v15 (book_ai)', tx)
      })

    this.version(18).stores({
      iobject: '', istring: '', inumber: '', ibool: '', icache: '', itoken: 'user_id', iothershare: 'share_id',
      imusic_track: '&id, source_id, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, artist, album',
      ibook_item: '&id, source_id, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, author, ext',
      ibook_note: '&id, book_id, [user_id+drive_id], user_id, drive_id, file_id, kind, created_at, updated_at',
      ibook_bookmark: '&id, book_id, [user_id+drive_id], user_id, drive_id, file_id, percentage, created_at, updated_at',
      ibook_ai_chunk: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, sectionIndex, pageNumber',
      ibook_ai_meta: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, lastUpdated',
      ibook_ai_bm25: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, updatedAt',
      ibook_ai_conversation: '&id, bookId, [bookId+mode], updatedAt',
      ibook_ai_message: '&id, conversationId, createdAt',
      imedia_item: '&id, folderId, type, addedAt, tmdbId',
      imedia_folder: '&id, [userId+driveId], fileId, scanDate',
      imedia_file: '&id, mediaId, folderId',
      ilibrary_source: '&id, kind, [kind+user_id], [kind+drive_id], user_id, drive_id, folder_id, scanned_at'
    }).upgrade(async (tx) => {
      const sourceTable = tx.table<ILibrarySource, string>('ilibrary_source')
      const migrate = async <T extends { source_id?: string; user_id: string; drive_id: string; parent_file_id: string; parent_path?: string; scanned_at?: number }>(kind: LibrarySourceKind, tableName: string) => {
        const table = tx.table<T, string>(tableName)
        const records = await table.toArray()
        const sources = new Map<string, ILibrarySource>()
        for (const record of records) {
          if (record.source_id) continue
          const folderId = record.parent_file_id || 'root'
          const sourceId = buildLibrarySourceId(kind, record.user_id, record.drive_id, folderId)
          const path = (record.parent_path || '').trim()
          const scannedAt = record.scanned_at || Date.now()
          record.source_id = sourceId
          const current = sources.get(sourceId)
          if (!current || scannedAt > current.scanned_at) {
            sources.set(sourceId, {
              id: sourceId,
              kind,
              user_id: record.user_id,
              drive_id: record.drive_id,
              folder_id: folderId,
              name: path.split('/').filter(Boolean).pop() || path || folderId,
              path,
              created_at: current?.created_at || scannedAt,
              scanned_at: scannedAt
            })
          }
        }
        const migrated = records.filter(record => record.source_id)
        if (migrated.length) await table.bulkPut(migrated)
        if (sources.size) await sourceTable.bulkPut([...sources.values()])
      }
      await migrate<IMusicTrack>('music', 'imusic_track')
      await migrate<IBookItem>('book', 'ibook_item')
    })

    this.version(19).stores({
      iobject: '', istring: '', inumber: '', ibool: '', icache: '', itoken: 'user_id', iothershare: 'share_id',
      imusic_track: '&id, source_id, *source_ids, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, artist, album',
      ibook_item: '&id, source_id, *source_ids, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, author, ext',
      ibook_note: '&id, book_id, [user_id+drive_id], user_id, drive_id, file_id, kind, created_at, updated_at',
      ibook_bookmark: '&id, book_id, [user_id+drive_id], user_id, drive_id, file_id, percentage, created_at, updated_at',
      ibook_ai_chunk: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, sectionIndex, pageNumber',
      ibook_ai_meta: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, lastUpdated',
      ibook_ai_bm25: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, updatedAt',
      ibook_ai_conversation: '&id, bookId, [bookId+mode], updatedAt',
      ibook_ai_message: '&id, conversationId, createdAt',
      imedia_item: '&id, folderId, type, addedAt, tmdbId',
      imedia_folder: '&id, [userId+driveId], fileId, scanDate',
      imedia_file: '&id, mediaId, folderId',
      ilibrary_source: '&id, kind, [kind+user_id], [kind+drive_id], user_id, drive_id, folder_id, scanned_at'
    }).upgrade(async (tx) => {
      const sourceCounts = new Map<string, number>()
      for (const tableName of ['imusic_track', 'ibook_item']) {
        const table = tx.table<IMusicTrack | IBookItem, string>(tableName)
        await table.toCollection().modify((item) => {
          item.source_ids = Array.from(new Set([...(item.source_ids || []), ...(item.source_id ? [item.source_id] : [])]))
          item.source_ids.forEach(sourceId => sourceCounts.set(sourceId, (sourceCounts.get(sourceId) || 0) + 1))
        })
      }
      await tx.table<ILibrarySource, string>('ilibrary_source').toCollection().modify((source) => {
        source.item_count = sourceCounts.get(source.id) || 0
      })
    })

    this.version(20).stores({
      iobject: '', istring: '', inumber: '', ibool: '', icache: '', itoken: 'user_id', iothershare: 'share_id',
      imusic_track: '&id, source_id, *source_ids, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, artist, album',
      ibook_item: '&id, source_id, *source_ids, [user_id+drive_id], user_id, drive_id, parent_file_id, scanned_at, updated_at, author, ext',
      ibook_note: '&id, book_id, [user_id+drive_id], user_id, drive_id, file_id, kind, created_at, updated_at',
      ibook_bookmark: '&id, book_id, [user_id+drive_id], user_id, drive_id, file_id, percentage, created_at, updated_at',
      ibook_ai_chunk: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, sectionIndex, pageNumber',
      ibook_ai_meta: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, lastUpdated',
      ibook_ai_bm25: '&id, bookId, [bookId+sourceHash], [bookId+settingsHash], sourceHash, settingsHash, updatedAt',
      ibook_ai_conversation: '&id, bookId, [bookId+mode], updatedAt',
      ibook_ai_message: '&id, conversationId, createdAt',
      imedia_item: '&id, folderId, type, addedAt, tmdbId',
      imedia_folder: '&id, [userId+driveId], fileId, scanDate',
      imedia_file: '&id, fileId, mediaId, folderId, [folderId+fileId]',
      ilibrary_source: '&id, kind, [kind+user_id], [kind+drive_id], user_id, drive_id, folder_id, scanned_at'
    })

    this.iobject = this.table('iobject')
    this.istring = this.table('istring')
    this.inumber = this.table('inumber')
    this.ibool = this.table('ibool')
    this.icache = this.table('icache')

    this.itoken = this.table('itoken')
    this.iothershare = this.table('iothershare')
    this.imusic_track = this.table('imusic_track')
    this.ibook_item = this.table('ibook_item')
    this.ibook_note = this.table('ibook_note')
    this.ibook_bookmark = this.table('ibook_bookmark')
    this.ibook_ai_chunk = this.table('ibook_ai_chunk')
    this.ibook_ai_meta = this.table('ibook_ai_meta')
    this.ibook_ai_bm25 = this.table('ibook_ai_bm25')
    this.ibook_ai_conversation = this.table('ibook_ai_conversation')
    this.ibook_ai_message = this.table('ibook_ai_message')
    this.imedia_item = this.table('imedia_item')
    this.imedia_folder = this.table('imedia_folder')
    this.imedia_file = this.table('imedia_file')
    this.ilibrary_source = this.table('ilibrary_source')
  }

  async getValueString(key: string): Promise<string> {
    if (!this.isOpen()) await this.open().catch(() => {})
    const val = await this.istring.get(key)
    if (val) return val
    else return ''
  }

  async saveValueString(key: string, value: string): Promise<string> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.istring.put(value || '', key)
  }

  async saveValueStringBatch(keys: string[], values: string[]): Promise<string> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.istring.bulkPut(values, keys)
  }

  async getValueNumber(key: string): Promise<number> {
    if (!this.isOpen()) await this.open().catch(() => {})
    const val = await this.inumber.get(key)
    if (val) return val
    return 0
  }

  async saveValueNumber(key: string, value: number): Promise<string> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.inumber.put(value, key)
  }

  async getValueBool(key: string): Promise<boolean> {
    if (!this.isOpen()) await this.open().catch(() => {})
    const val = await this.ibool.get(key)
    if (val) return true
    return false
  }

  async saveValueBool(key: string, value: boolean): Promise<string> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibool.put(value || false, key)
  }

  async getValueObject(key: string): Promise<object | undefined> {
    if (!this.isOpen()) await this.open().catch(() => {})
    const val = await this.iobject.get(key)
    if (val) return val
    else return undefined
  }

  async saveValueObject(key: string, value: object): Promise<string | void> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.iobject.put(value, key).catch(() => {})
  }

  async saveValueObjectBatch(keys: string[], values: object[]): Promise<string> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.iobject.bulkPut(values, keys)
  }

  async deleteValueObject(key: string): Promise<void> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.iobject.delete(key)
  }

  async saveMediaLibrary(items: MediaLibraryItem[], folders: MediaLibraryFolder[]): Promise<void> {
    items = mediaPersistenceSnapshot(items)
    folders = mediaPersistenceSnapshot(folders)
    if (!this.isOpen()) await this.open()
    const files = items.flatMap((item) => {
      const all = [...(item.driveFiles || []), ...(item.seasons || []).flatMap(season => (season.episodes || []).flatMap(episode => episode.driveFiles || []))]
      return all.filter(file => !!file.id).flatMap((file) => {
        const fileId = mediaDriveFileKey(file)
        const sourceIds = file.sourceFolderIds?.length ? file.sourceFolderIds : (item.folderId ? [item.folderId] : [])
        return sourceIds.map(folderId => ({ id: `${encodeURIComponent(folderId)}|${fileId}`, fileId, mediaId: item.id, folderId }))
      })
    })
    await this.transaction('rw', this.imedia_item, this.imedia_folder, this.imedia_file, async () => {
      await this.imedia_item.clear()
      await this.imedia_folder.clear()
      await this.imedia_file.clear()
      await this.imedia_item.bulkPut(items)
      await this.imedia_folder.bulkPut(folders)
      await this.imedia_file.bulkPut(files)
    })
  }

  async getMediaLibrary(): Promise<{ items: MediaLibraryItem[]; folders: MediaLibraryFolder[] }> {
    if (!this.isOpen()) await this.open()
    const [items, folders] = await Promise.all([this.imedia_item.toArray(), this.imedia_folder.toArray()])
    return { items, folders }
  }

  /** Complete Home catalog without putting the whole library in Vue's deep-reactive page cache.
   * Keyset batches yield between IndexedDB reads, including for very large libraries. */
  async getHomeMediaLibrary(): Promise<MediaLibraryItem[]> {
    if (!this.isOpen()) await this.open()
    return readHomeCatalogPages<MediaLibraryItem>((after, limit) =>
      (after === undefined ? this.imedia_item.orderBy('id') : this.imedia_item.where('id').above(after)).limit(limit).toArray())
  }

  async getMediaLibraryPage(options: { offset?: number; limit?: number; folderId?: string; type?: MediaLibraryItem['type']; predicate?: (item: MediaLibraryItem) => boolean; sort?: (a: MediaLibraryItem, b: MediaLibraryItem) => number } = {}): Promise<MediaLibraryItem[]> {
    if (!this.isOpen()) await this.open()
    const { offset = 0, limit = 100, folderId, type, predicate } = options
    let collection: Dexie.Collection<MediaLibraryItem, string>
    if (folderId) collection = this.imedia_item.where('folderId').equals(folderId)
    else if (type) collection = this.imedia_item.where('type').equals(type)
    else collection = this.imedia_item.orderBy('addedAt')
    const filtered = type && folderId ? collection.filter(item => item.type === type) : collection
    const matched = predicate ? filtered.filter(predicate) : filtered
    if (options.sort) return (await matched.toArray()).sort(options.sort).slice(offset, offset + limit)
    return matched.reverse().offset(offset).limit(limit).toArray()
  }

  async getMediaLibraryCollectionItems(item: MediaLibraryItem): Promise<MediaLibraryItem[]> {
    if (!this.isOpen()) await this.open()
    return this.imedia_item.where('type').equals('movie').filter(candidate => isDetailCollectionSource(item, candidate)).toArray()
  }

  async getMediaLibraryItemsByIds(ids: string[]): Promise<MediaLibraryItem[]> {
    if (!ids.length) return []
    if (!this.isOpen()) await this.open()
    return this.imedia_item.bulkGet(ids).then(items => items.filter((item): item is MediaLibraryItem => !!item))
  }

  async countMediaLibraryItems(options: { folderId?: string; type?: MediaLibraryItem['type']; predicate?: (item: MediaLibraryItem) => boolean } = {}): Promise<number> {
    if (!this.isOpen()) await this.open()
    let collection: Dexie.Collection<MediaLibraryItem, string>
    if (options.folderId) collection = this.imedia_item.where('folderId').equals(options.folderId)
    else if (options.type) collection = this.imedia_item.where('type').equals(options.type)
    else collection = this.imedia_item.toCollection()
    const matched = options.type && options.folderId ? collection.filter(item => item.type === options.type) : collection
    return options.predicate ? matched.filter(options.predicate).count() : matched.count()
  }

  async getMediaLibraryFolders(): Promise<MediaLibraryFolder[]> {
    if (!this.isOpen()) await this.open()
    return this.imedia_folder.toArray()
  }

  async getIndexedMediaFileIds(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set()
    if (!this.isOpen()) await this.open()
    const records = await this.imedia_file.where('fileId').anyOf(ids).toArray()
    const mediaItems = await this.imedia_item.bulkGet([...new Set(records.map(record => record.mediaId))])
    const indexedMediaIds = new Set(mediaItems.filter((item): item is MediaLibraryItem => !!item && item.type !== 'unmatched' && !item.scrapeRetrying).map(item => item.id))
    return new Set(records.filter(record => indexedMediaIds.has(record.mediaId)).map(record => record.fileId))
  }

  async getScrapedMediaItem(item: MediaLibraryItem): Promise<MediaLibraryItem | undefined> {
    if (!this.isOpen()) await this.open()
    if (item.collectionId) return this.imedia_item.get(item.id)
    if (!item.tmdbId || item.type === 'unmatched') return this.imedia_item.get(item.id)
    return this.imedia_item.where('tmdbId').equals(item.tmdbId).filter(existing => existing.type === item.type && !existing.collectionId).first()
  }

  async associateMediaFilesWithFolder(files: MediaLibraryItem['driveFiles'], folderId: string): Promise<MediaLibraryItem[]> {
    if (!files.length) return []
    if (!this.isOpen()) await this.open()
    return this.transaction('rw', this.imedia_item, this.imedia_file, async () => {
      const mappings = await this.imedia_file.where('fileId').anyOf(files.map(mediaDriveFileKey)).toArray()
      const items = await this.getMediaLibraryItemsByIds([...new Set(mappings.map(mapping => mapping.mediaId))])
      const associated = items.map(item => associateScrapedFiles(item, files, folderId))
      await this.upsertMediaLibraryItems(associated)
      return associated
    })
  }

  async getMediaLibraryFolderFileIds(folderId: string): Promise<string[]> {
    if (!this.isOpen()) await this.open()
    return (await this.imedia_file.where('folderId').equals(folderId).toArray()).map(record => record.fileId)
  }

  async upsertMediaLibraryItems(items: MediaLibraryItem[], mergeExisting = true): Promise<void> {
    items = mediaPersistenceSnapshot(items)
    if (!items.length) return
    if (!this.isOpen()) await this.open()
    await this.transaction('rw', this.imedia_item, this.imedia_file, async () => {
      const existingItems = await this.imedia_item.bulkGet(items.map(item => item.id))
      const mergedItems = items.map((item, index) => mergeExisting && existingItems[index] ? mergeScrapedMedia(existingItems[index]!, item) : item)
      const files = mergedItems.flatMap(item => [...(item.driveFiles || []), ...(item.seasons || []).flatMap(season => (season.episodes || []).flatMap(episode => episode.driveFiles || [])), ...(item.collectionMovies || []).flatMap(movie => movie.driveFiles || [])]
        .filter(file => !!file.id).flatMap(file => {
          const fileId = mediaDriveFileKey(file)
          const sourceIds = file.sourceFolderIds?.length ? file.sourceFolderIds : (item.folderId ? [item.folderId] : [])
          return sourceIds.map(folderId => ({ id: `${encodeURIComponent(folderId)}|${fileId}`, fileId, mediaId: item.id, folderId }))
      }))
      await this.imedia_item.bulkPut(mergedItems)
      await this.imedia_file.where('mediaId').anyOf(mergedItems.map(item => item.id)).delete()
      await this.imedia_file.bulkPut(files)
    })
  }

  async deleteMediaLibraryItems(ids: string[]): Promise<void> {
    if (!ids.length) return
    if (!this.isOpen()) await this.open()
    await this.transaction('rw', this.imedia_item, this.imedia_file, async () => {
      await this.imedia_item.bulkDelete(ids)
      await this.imedia_file.where('mediaId').anyOf(ids).delete()
    })
  }

  async upsertMediaLibraryFolders(folders: MediaLibraryFolder[]): Promise<void> {
    folders = mediaPersistenceSnapshot(folders)
    if (!folders.length) return
    if (!this.isOpen()) await this.open()
    await this.imedia_folder.bulkPut(folders)
  }

  async deleteMediaLibraryFolders(ids: string[]): Promise<void> {
    if (!ids.length) return
    if (!this.isOpen()) await this.open()
    await this.transaction('rw', this.imedia_item, this.imedia_folder, this.imedia_file, async () => {
      const affectedMediaIds = new Set<string>()
      for (const folderId of ids) {
        const mappings = await this.imedia_file.where('folderId').equals(folderId).toArray()
        mappings.forEach(mapping => affectedMediaIds.add(mapping.mediaId))
      }
      const retained: MediaLibraryItem[] = []
      const deleted: string[] = []
      for (const item of await this.imedia_item.bulkGet([...affectedMediaIds])) {
        if (!item) continue
        let current: MediaLibraryItem | undefined = item
        for (const folderId of ids) {
          if (!current) break
          current = reconcileMediaItemSource(current, folderId, new Set()).item
        }
        if (current) retained.push(current)
        else deleted.push(item.id)
      }
      if (retained.length) await this.imedia_item.bulkPut(retained)
      if (deleted.length) await this.imedia_item.bulkDelete(deleted)
      await this.imedia_file.where('folderId').anyOf(ids).delete()
      if (deleted.length) await this.imedia_file.where('mediaId').anyOf(deleted).delete()
      await this.imedia_folder.bulkDelete(ids)
    })
  }

  async reconcileMediaLibraryFolder(folderId: string, seenFileIds: string[]): Promise<void> {
    if (!this.isOpen()) await this.open()
    const seen = new Set(seenFileIds)
    await this.transaction('rw', this.imedia_item, this.imedia_file, async () => {
      const mappings = await this.imedia_file.where('folderId').equals(folderId).toArray()
      const affectedMediaIds = [...new Set(mappings.filter(mapping => !seen.has(mapping.fileId)).map(mapping => mapping.mediaId))]
      const retained: MediaLibraryItem[] = []
      const deleted: string[] = []
      for (const item of await this.imedia_item.bulkGet(affectedMediaIds)) {
        if (!item) continue
        const result = reconcileMediaItemSource(item, folderId, seen)
        if (result.item) retained.push(result.item)
        else deleted.push(item.id)
      }
      if (retained.length) await this.imedia_item.bulkPut(retained)
      if (deleted.length) await this.imedia_item.bulkDelete(deleted)
      const staleMappingIds = mappings.filter(mapping => !seen.has(mapping.fileId)).map(mapping => mapping.id)
      if (staleMappingIds.length) await this.imedia_file.bulkDelete(staleMappingIds)
      if (deleted.length) await this.imedia_file.where('mediaId').anyOf(deleted).delete()
    })
  }

  async clearMediaLibrary(): Promise<void> {
    if (!this.isOpen()) await this.open()
    await this.transaction('rw', this.imedia_item, this.imedia_folder, this.imedia_file, async () => {
      await this.imedia_item.clear()
      await this.imedia_folder.clear()
      await this.imedia_file.clear()
    })
  }

  async getUser(user_id: string): Promise<ITokenInfo | undefined> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.transaction('r', this.itoken, () => {
      return this.itoken.get(user_id)
    })
  }

  async getUserAll(): Promise<ITokenInfo[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    const list = await this.transaction('r', this.itoken, () => {
      return this.itoken.toArray()
    })
    return list.sort((a: ITokenInfo, b: ITokenInfo) => b.used_size - a.used_size)
  }

  async deleteUser(user_id: string): Promise<void> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.itoken.delete(user_id)
  }

  async saveUser(token: ITokenInfo): Promise<string | void> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.itoken.put(token, token.user_id).catch(() => {})
  }

  async saveUserBatch(tokens: ITokenInfo[]): Promise<boolean | string> {
    if (tokens.length == 0) return false
    if (!this.isOpen()) await this.open().catch()
    return this.itoken.bulkPut(tokens).catch()
  }

  async getCache(key: string): Promise<Blob | undefined> {
    if (!this.isOpen()) await this.open().catch(() => {})
    const val = await this.icache.get(key)
    return val
  }

  async saveCache(key: string, data: Blob) {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.icache.put(data, key)
  }

  async getOtherShare(share_id: string): Promise<IOtherShareLinkModel | undefined> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.iothershare.get(share_id)
  }

  async getOtherShareAll(): Promise<IOtherShareLinkModel[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    const list = await this.iothershare.toArray()
    return list.sort((a: IOtherShareLinkModel, b: IOtherShareLinkModel) => b.saved_time - a.saved_time)
  }

  async deleteOtherShareBatch(share_id_list: string[]): Promise<void> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.iothershare.bulkDelete(share_id_list)
  }

  async saveOtherShare(share: IOtherShareLinkModel): Promise<string | void> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.iothershare.put(share, share.share_id).catch(() => {})
  }

  async saveMusicTracks(tracks: IMusicTrack[]): Promise<string | void> {
    if (!this.isOpen()) await this.open().catch(() => {})
    if (!tracks.length) return
    return this.imusic_track.bulkPut(tracks)
  }

  async getMusicTrackById(id: string): Promise<IMusicTrack | undefined> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.imusic_track.get(id)
  }

  async getMusicTracksByIds(ids: string[]): Promise<IMusicTrack[]> {
    if (!ids.length) return []
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.imusic_track.bulkGet(ids).then(items => items.filter((item): item is IMusicTrack => !!item))
  }

  async getAllMusicTracks(): Promise<IMusicTrack[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.imusic_track.toArray()
  }

  async getMusicTrackPage(options: { offset?: number; limit?: number; query?: string } = {}): Promise<IMusicTrack[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    const { offset = 0, limit = 100, query = '' } = options
    const keyword = query.trim().toLowerCase()
    const collection = keyword
      ? this.imusic_track.filter(track => [track.file_name, track.title, track.artist, track.album].some(value => String(value || '').toLowerCase().includes(keyword)))
      : this.imusic_track.orderBy('scanned_at')
    return collection.reverse().offset(offset).limit(limit).toArray()
  }

  async countMusicTracks(query = ''): Promise<number> {
    if (!this.isOpen()) await this.open().catch(() => {})
    const keyword = query.trim().toLowerCase()
    if (!keyword) return this.imusic_track.count()
    return this.imusic_track.filter(track => [track.file_name, track.title, track.artist, track.album].some(value => String(value || '').toLowerCase().includes(keyword))).count()
  }

  async getMusicEnrichmentCandidates(limit: number, staleBefore: number, excludedIds: Set<string> = new Set()): Promise<IMusicTrack[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    const candidates = await this.imusic_track.filter(track => !excludedIds.has(track.id) && shouldEnrichMusic(track, staleBefore + 24 * 60 * 60 * 1000)).toArray()
    // Never split a semantic cohort at a UI-page boundary (including its final pair).
    const keys = new Set(candidates.slice(0, limit).map(musicCohortKey))
    return candidates.filter(track => keys.has(musicCohortKey(track)))
  }

  async getMusicTracksByDrive(user_id: string, drive_id: string): Promise<IMusicTrack[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.imusic_track.where({ user_id, drive_id }).toArray()
  }

  async deleteMusicTrack(id: string): Promise<void> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.imusic_track.delete(id)
  }

  async deleteMusicTracksByIds(ids: string[]): Promise<number> {
    if (!ids || ids.length === 0) return 0
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.imusic_track.bulkDelete(ids).then(() => ids.length).catch(() => 0)
  }

  async deleteMusicTracksByDrive(user_id: string, drive_id: string): Promise<number> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.imusic_track.where({ user_id, drive_id }).delete()
  }

  async saveLibrarySource(source: ILibrarySource): Promise<string> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ilibrary_source.put(source)
  }

  async getLibrarySources(kind: LibrarySourceKind): Promise<ILibrarySource[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    const sources = await this.ilibrary_source.where('kind').equals(kind).toArray()
    return sources.sort((a, b) => b.scanned_at - a.scanned_at)
  }

  async deleteMusicLibrarySource(sourceId: string): Promise<number> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.transaction('rw', this.ilibrary_source, this.imusic_track, async () => {
      const tracks = await this.imusic_track.where('source_ids').equals(sourceId).toArray()
      const orphanIds: string[] = []
      const retained: IMusicTrack[] = []
      for (const track of tracks) {
        const sourceIds = (track.source_ids || []).filter(id => id !== sourceId)
        if (!sourceIds.length) orphanIds.push(track.id)
        else retained.push({ ...track, source_ids: sourceIds, source_id: sourceIds[0] })
      }
      if (retained.length) await this.imusic_track.bulkPut(retained)
      if (orphanIds.length) await this.imusic_track.bulkDelete(orphanIds)
      await this.ilibrary_source.delete(sourceId)
      return orphanIds.length
    })
  }

  async getMusicSourceItemIds(sourceId: string): Promise<string[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return (await this.imusic_track.where('source_ids').equals(sourceId).primaryKeys()).map(String)
  }

  async reconcileMusicLibrarySource(sourceId: string, seenIds: string[]): Promise<number> {
    if (!this.isOpen()) await this.open().catch(() => {})
    const seen = new Set(seenIds)
    return this.transaction('rw', this.imusic_track, async () => {
      const current = await this.imusic_track.where('source_ids').equals(sourceId).toArray()
      const stale = current.filter(track => !seen.has(track.id))
      const orphanIds: string[] = []
      const retained: IMusicTrack[] = []
      for (const track of stale) {
        const sourceIds = (track.source_ids || []).filter(id => id !== sourceId)
        if (!sourceIds.length) orphanIds.push(track.id)
        else retained.push({ ...track, source_ids: sourceIds, source_id: sourceIds[0] })
      }
      if (retained.length) await this.imusic_track.bulkPut(retained)
      if (orphanIds.length) await this.imusic_track.bulkDelete(orphanIds)
      return orphanIds.length
    })
  }

  async clearMusicTracks(): Promise<void> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.imusic_track.clear()
  }

  async saveBookItems(books: IBookItem[]): Promise<string | void> {
    if (!this.isOpen()) await this.open().catch(() => {})
    if (!books.length) return
    return this.ibook_item.bulkPut(books)
  }

  async getAllBookItems(): Promise<IBookItem[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibook_item.toArray()
  }

  async getBookItemsByIds(ids: string[]): Promise<IBookItem[]> {
    if (!ids.length) return []
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibook_item.bulkGet(ids).then(items => items.filter((item): item is IBookItem => !!item))
  }

  async getBookItemsByDrive(user_id: string, drive_id: string): Promise<IBookItem[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibook_item.where({ user_id, drive_id }).toArray()
  }

  async getBookItemsPage(offset: number, limit: number): Promise<IBookItem[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibook_item.orderBy('scanned_at').reverse().offset(Math.max(0, offset)).limit(Math.max(1, limit)).toArray()
  }

  async getBookItemCounts(): Promise<{ total: number; deleted: number }> {
    if (!this.isOpen()) await this.open().catch(() => {})
    let total = 0
    let deleted = 0
    await this.ibook_item.each((book) => {
      total++
      if (book.deleted_at) deleted++
    })
    return { total, deleted }
  }

  async deleteBookItemsByIds(ids: string[]): Promise<number> {
    if (!ids || ids.length === 0) return 0
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibook_item.bulkDelete(ids).then(() => ids.length).catch(() => 0)
  }

  async deleteBookLibrarySource(sourceId: string): Promise<number> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.transaction('rw', this.ilibrary_source, this.ibook_item, this.ibook_note, this.ibook_bookmark, async () => {
      const books = await this.ibook_item.where('source_ids').equals(sourceId).toArray()
      const ids: string[] = []
      const retained: IBookItem[] = []
      for (const book of books) {
        const sourceIds = (book.source_ids || []).filter(id => id !== sourceId)
        if (!sourceIds.length) ids.push(book.id)
        else retained.push({ ...book, source_ids: sourceIds, source_id: sourceIds[0] })
      }
      if (retained.length) await this.ibook_item.bulkPut(retained)
      if (ids.length) {
        await this.ibook_note.where('book_id').anyOf(ids).delete()
        await this.ibook_bookmark.where('book_id').anyOf(ids).delete()
        await this.ibook_item.bulkDelete(ids)
      }
      await this.ilibrary_source.delete(sourceId)
      return ids.length
    })
  }

  async getBookSourceItemIds(sourceId: string): Promise<string[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return (await this.ibook_item.where('source_ids').equals(sourceId).primaryKeys()).map(String)
  }

  async reconcileBookLibrarySource(sourceId: string, seenIds: string[]): Promise<number> {
    if (!this.isOpen()) await this.open().catch(() => {})
    const seen = new Set(seenIds)
    return this.transaction('rw', this.ibook_item, this.ibook_note, this.ibook_bookmark, async () => {
      const current = await this.ibook_item.where('source_ids').equals(sourceId).toArray()
      const stale = current.filter(book => !seen.has(book.id))
      const orphanIds: string[] = []
      const retained: IBookItem[] = []
      for (const book of stale) {
        const sourceIds = (book.source_ids || []).filter(id => id !== sourceId)
        if (!sourceIds.length) orphanIds.push(book.id)
        else retained.push({ ...book, source_ids: sourceIds, source_id: sourceIds[0] })
      }
      if (retained.length) await this.ibook_item.bulkPut(retained)
      if (orphanIds.length) {
        await this.ibook_note.where('book_id').anyOf(orphanIds).delete()
        await this.ibook_bookmark.where('book_id').anyOf(orphanIds).delete()
        await this.ibook_item.bulkDelete(orphanIds)
      }
      return orphanIds.length
    })
  }

  async clearBookItems(): Promise<void> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibook_item.clear()
  }

  async countBookItems(): Promise<number> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibook_item.count()
  }

  async saveBookNotes(notes: IBookNote[]): Promise<string | void> {
    if (!this.isOpen()) await this.open().catch(() => {})
    if (!notes.length) return
    return this.ibook_note.bulkPut(notes).catch(() => {})
  }

  async getBookNotesByBookId(book_id: string): Promise<IBookNote[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibook_note.where({ book_id }).toArray()
  }

  async getAllBookNotes(): Promise<IBookNote[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibook_note.toArray()
  }

  async deleteBookNotesByIds(ids: string[]): Promise<number> {
    if (!ids || ids.length === 0) return 0
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibook_note.bulkDelete(ids).then(() => ids.length).catch(() => 0)
  }

  async deleteBookNotesByBookIds(bookIds: string[]): Promise<number> {
    if (!bookIds || bookIds.length === 0) return 0
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibook_note.where('book_id').anyOf(bookIds).delete().catch(() => 0)
  }

  async saveBookBookmarks(bookmarks: IBookBookmark[]): Promise<string | void> {
    if (!this.isOpen()) await this.open().catch(() => {})
    if (!bookmarks.length) return
    return this.ibook_bookmark.bulkPut(bookmarks).catch(() => {})
  }

  async getBookBookmarksByBookId(book_id: string): Promise<IBookBookmark[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibook_bookmark.where({ book_id }).toArray()
  }

  async getAllBookBookmarks(): Promise<IBookBookmark[]> {
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibook_bookmark.toArray()
  }

  async deleteBookBookmarksByIds(ids: string[]): Promise<number> {
    if (!ids || ids.length === 0) return 0
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibook_bookmark.bulkDelete(ids).then(() => ids.length).catch(() => 0)
  }

  async deleteBookBookmarksByBookIds(bookIds: string[]): Promise<number> {
    if (!bookIds || bookIds.length === 0) return 0
    if (!this.isOpen()) await this.open().catch(() => {})
    return this.ibook_bookmark.where('book_id').anyOf(bookIds).delete().catch(() => 0)
  }
}

const DB = new XBYDB3()
export default DB
