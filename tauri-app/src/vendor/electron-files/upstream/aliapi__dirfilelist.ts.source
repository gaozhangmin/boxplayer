import { usePanFileStore, useSettingStore } from '../store'
import TreeStore from '../store/treestore'
import DebugLog from '../utils/debuglog'
import { OrderDir, OrderFile } from '../utils/filenameorder'
import { humanDateTimeDateStr, humanSize, humanTime } from '../utils/format'
import message from '../utils/message'
import { HanToPin, MapValueToArray } from '../utils/utils'
import AliHttp, { IUrlRespData } from './alihttp'
import { IAliFileItem, IAliGetFileModel } from './alimodels'
import getFileIcon from './fileicon'
import { DecodeEncName, GetDriveID } from './utils'
import { buildAliColorSearchDriveIds } from './colorSearch'
import { resolveAliFileDriveId } from './fileModelDrive'
import { listProviderSpecialItems } from '../drive/providerSpecialList'
import { isScanRateLimitedError, runRateLimitedScanRequest } from '../utils/libraryScanRateLimiter'


export interface IAliFileResp {
  items: IAliGetFileModel[]
  itemsKey: Set<string>
  punished_file_count: number

  next_marker: string

  m_user_id: string
  m_drive_id: string
  dirID: string
  albumID?: string
  dirName: string
  itemsTotal?: number
}

export function NewIAliFileResp(user_id: string, drive_id: string, dirID: string, dirName: string): IAliFileResp {
  const resp: IAliFileResp = {
    items: [],
    itemsKey: new Set<string>(),
    punished_file_count: 0,
    next_marker: '',
    m_user_id: user_id,
    m_drive_id: drive_id,
    dirID: dirID,
    dirName: dirName
  }

  return resp
}

export default class AliDirFileList {
  static ItemJsonmask = 'category%2Ccreated_at%2Cdrive_id%2Cfile_extension%2Cfile_id%2Chidden%2Cmime_extension%2Cmime_type%2Cname%2Cparent_file_id%2Cpunish_flag%2Csize%2Cstarred%2Ctype%2Cupdated_at%2Cdescription%2Cfrom_share_id%2Ccontent_hash%2Ccontent_hash_name'

  static getFileInfo(user_id: string, item: IAliFileItem, downUrl: string, requestDriveId = ''): IAliGetFileModel {
    const size = item.size ? item.size : 0
    const file_count = item.file_count || item.image_count || item.video_count || 0
    const time = new Date(item.updated_at || item.created_at || item.gmt_deleted || item.last_played_at || '')
    const timeStr = humanDateTimeDateStr(item.updated_at || item.created_at || item.gmt_deleted || item.last_played_at || '')
    const isDir = item.type == 'folder'
    const { name, mine_type, ext } = DecodeEncName(user_id, item)
    const add: IAliGetFileModel = {
      __v_skip: true,
      drive_id: resolveAliFileDriveId(item.drive_id, requestDriveId),
      file_id: item.file_id,
      parent_file_id: item.parent_file_id || '',
      name: name,
      namesearch: HanToPin(name),
      ext: ext || '',
      mime_type: mine_type || '',
      mime_extension: item.mime_extension,
      category: item.category || '',
      starred: item.starred || false,
      time: time.getTime(),
      file_count: file_count,
      size: size,
      sizeStr: humanSize(size),
      timeStr: timeStr,
      icon: 'iconfile-folder',
      isDir: isDir,
      thumbnail: '',
      from_share_id: item.from_share_id,
      punish_flag: item.punish_flag,
      description: item.description || '',
      user_meta: item.user_meta || '',
      content_hash: item.content_hash || '',
      content_hash_name: item.content_hash_name || ''
    }
    if (!isDir) {
      const icon = getFileIcon(add.category, add.ext, add.ext || item.mime_extension, add.mime_type, add.size)
      add.category = icon[0]
      add.icon = icon[1]

      if (downUrl) {
        if (downUrl == 'download_url') {
          add.download_url = item.download_url || ''
        } else if (add.category == 'image') {
          add.thumbnail = downUrl + '&drive_id=' + add.drive_id + '&file_id=' + add.file_id + '&image_thumbnail_process=image%2Fresize%2Cl_260%2Fformat%2Cjpg%2Fauto-orient%2C1'
        } else if (add.category == 'image2') {
          add.thumbnail = downUrl + '&drive_id=' + add.drive_id + '&file_id=' + add.file_id
        } else if (add.category.startsWith('video')) {
          add.thumbnail = downUrl + '&drive_id=' + add.drive_id + '&file_id=' + add.file_id + '&video_thumbnail_process=video%2Fsnapshot%2Ct_106000%2Cf_jpg%2Car_auto%2Cm_fast'
        } else if (add.category == 'doc' || add.category == 'doc2') {
          if (add.ext != 'txt' && add.ext != 'epub' && add.ext != 'azw' && add.ext != 'azw3') {
            add.thumbnail = downUrl + '&drive_id=' + add.drive_id + '&file_id=' + add.file_id + '&office_thumbnail_process=image%2Fresize%2Cl_260%2Fformat%2Cjpg%2Fauto-orient%2C1'
          }
        }
      }

      if (item.video_media_metadata && Object.keys(item.video_media_metadata).length > 0) {
        add.media_width = item.video_media_metadata.width || 0
        add.media_height = item.video_media_metadata.height || 0
        add.media_time = humanDateTimeDateStr(item.video_media_metadata.time)
        add.media_duration = humanTime(item.video_media_metadata.duration)
      } else if (item.video_preview_metadata && Object.keys(item.video_preview_metadata).length > 0) {
        add.media_width = item.video_preview_metadata.width || 0
        add.media_height = item.video_preview_metadata.height || 0
        add.media_duration = humanTime(item.video_preview_metadata.duration)
      } else if (item.image_media_metadata && Object.keys(item.image_media_metadata).length > 0) {
        add.media_width = item.image_media_metadata.width || 0
        add.media_height = item.image_media_metadata.height || 0
        add.media_time = humanDateTimeDateStr(item.image_media_metadata.time)
      }
      if (item.play_cursor) {
        add.media_play_cursor = humanTime(item.play_cursor)
      } else if (item.user_meta) {
        const meta = JSON.parse(item.user_meta)
        if (meta.play_cursor) {
          add.media_play_cursor = humanTime(meta.play_cursor)
        }
      }
      if (!add.media_duration && item.duration) {
        add.media_duration = humanTime(item.duration)
      }
    }
    // 完全违规和部分违规
    if (item.punish_flag == 2) add.icon = 'iconweifa'
    else if (item.punish_flag == 103) add.icon = 'iconpartweifa'
    else if (item.punish_flag > 0) add.icon = 'iconweixiang'
    return add
  }

  private static async _ApiDirFileListOnePageOpenApi(orderby: string, order: string, dir: IAliFileResp, type: string, pageIndex: number, search= true): Promise<boolean> {
    let url = 'adrive/v1.0/openFile/list'
    let postData
    if (useSettingStore().uiFileListMode === 'movie' && search) {
      postData = {
        drive_id: dir.m_drive_id,
        parent_file_id: (dir.dirID === 'resource_root' || dir.dirID === 'backup_root') ? 'root' : dir.dirID,
        marker: dir.next_marker,
        category: "video",
        limit: 200,
        order_by: orderby,
        order_direction: order.toUpperCase()
      }
    } else {
      postData = {
        drive_id: dir.m_drive_id,
        parent_file_id: (dir.dirID === 'resource_root' || dir.dirID === 'backup_root') ? 'root' : dir.dirID,
        marker: dir.next_marker,
        limit: 200,
        order_by: orderby,
        order_direction: order.toUpperCase()
      }
    }
    if (type) {
      postData = Object.assign(postData, { type })
      pageIndex = -1
    }
    const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
    return AliDirFileList._FileListOnePage(orderby, order, dir, resp, pageIndex, type)
  }

  static async _ApiSearchFileListOnePage(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
    let url = 'adrive/v1.0/openFile/search'
    let query = ''
    const isColorSearch = dir.dirID.startsWith('color')
    const searchDriveIds = new Set<string>()
    if (isColorSearch) {
      url = 'adrive/v3/file/search'
      const color = dir.dirID.substring('color'.length).split(' ')[0].replace('#', 'c')
      query = 'description="' + color + '"'
    } else if (dir.dirID.startsWith('search')) {
      const search = dir.dirID.substring('search'.length).split(' ')

      let word = ''
      for (let i = 0; i < search.length; i++) {
        const itemstr = search[i]
        if (itemstr.split(':').length !== 2) {
          word += itemstr + ' '
          continue
        }

        const kv = search[i].split(':')
        const k = kv[0]
        const v = kv[1]
        if (k == 'range') {
          for (const drive of v.split(',')) {
            const driveId = GetDriveID(dir.m_user_id, drive)
            if (driveId) searchDriveIds.add(driveId)
          }
        } else if (k == 'type') {
          const arr = v.split(',')
          let type = ''
          for (let j = 0; j < arr.length; j++) {
            if (arr[j] == 'folder') type += 'type="' + arr[j] + '" or '
            else if (arr[j]) type += 'category="' + arr[j] + '" or '
          }
          type = type.substring(0, type.length - 4).trim()
          if (type && type.indexOf(' or ') > 0) query += '(' + type + ') and '
          else if (type) query += type + ' and '
        }
          // else if (k == 'size') {
          //   const size = parseInt(v)
          //   if (size > 0) query += 'size = ' + v + ' and '
          // }
          // else if (k == 'max') {
          //   const max = parseInt(v)
          //   if (max > 0) query += 'size <= ' + v + ' and '
          // } else if (k == 'min') {
          //   const min = parseInt(v)
          //   if (min > 0) query += 'size >= ' + v + ' and '
        // }
        else if (k == 'begin') {
          const dt = new Date(v).toISOString()
          query += 'created_at >= "' + dt.substring(0, dt.lastIndexOf('.')) + '" and '
        } else if (k == 'end') {
          const dt = new Date(v).toISOString()
          query += 'created_at <= "' + dt.substring(0, dt.lastIndexOf('.')) + '" and '
        } else if (k == 'ext') {
          const arr = v.split(',')
          let extin = ''
          for (let j = 0; j < arr.length; j++) {
            extin += '"' + arr[j] + '",'
          }
          if (extin.length > 0) extin = extin.substring(0, extin.length - 1)
          if (extin) query += 'file_extension in [' + extin + '] and '
        } else if (k == 'fav') query += 'starred = ' + v + ' and '
      }
      word = word.trim()
      if (word) query += 'name match "' + word.replaceAll('"', '\\"') + '" and '
      if (query.length > 0) query = query.substring(0, query.length - 5)
      if (query.startsWith('(') && query.endsWith(')')) query = query.substring(1, query.length - 1)
    }
    const postData: any = {
      drive_id: dir.m_drive_id,
      marker: dir.next_marker,
      limit: 100 ,
      fields: '*',
      query: query,
      order_by: orderby + ' ' + order
    }
    if (isColorSearch) {
      postData.drive_id_list = buildAliColorSearchDriveIds(GetDriveID(dir.m_user_id, 'backup'), GetDriveID(dir.m_user_id, 'resource'))
      delete postData.drive_id
    } else if (searchDriveIds.size > 0) {
      url = 'adrive/v3/file/search'
      postData.drive_id_list = Array.from(searchDriveIds)
      delete postData.drive_id
    }
    const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
    return AliDirFileList._FileListOnePage(orderby, order, dir, resp, pageIndex)
  }

  static async _ApiSearchFileListCount(dir: IAliFileResp): Promise<number> {
    let url = 'adrive/v1.0/openFile/search'

    let query = ''
    const isColorSearch = dir.dirID.startsWith('color')
    const searchDriveIds = new Set<string>()
    if (isColorSearch) {
      url = 'adrive/v3/file/search'
      const color = dir.dirID.substring('color'.length).split(' ')[0].replace('#', 'c')
      query = 'description="' + color + '"'
    } else if (dir.dirID.startsWith('search')) {
      const search = dir.dirID.substring('search'.length).split(' ')

      let word = ''
      for (let i = 0; i < search.length; i++) {
        const itemstr = search[i]
        if (itemstr.split(':').length !== 2) {
          word += itemstr + ' '
          continue
        }

        const kv = search[i].split(':')
        const k = kv[0]
        const v = kv[1]
        if (k == 'range') {
          for (const drive of v.split(',')) {
            const driveId = GetDriveID(dir.m_user_id, drive)
            if (driveId) searchDriveIds.add(driveId)
          }
        } else if (k == 'type') {
          const arr = v.split(',')
          let type = ''
          for (let j = 0; j < arr.length; j++) {
            if (arr[j] == 'folder') type += 'type="' + arr[j] + '" or '
            else if (arr[j]) type += 'category="' + arr[j] + '" or '
          }
          type = type.substring(0, type.length - 4).trim()
          if (type && type.indexOf(' or ') > 0) query += '(' + type + ') and '
          else if (type) query += type + ' and '
        }
          // else if (k == 'size') {
          //   const size = parseInt(v)
          //   if (size > 0) query += 'size = ' + v + ' and '
          // } else if (k == 'max') {
          //   const max = parseInt(v)
          //   if (max > 0) query += 'size <= ' + v + ' and '
          // } else if (k == 'min') {
          //   const min = parseInt(v)
          //   if (min > 0) query += 'size >= ' + v + ' and '
        // }
        else if (k == 'begin') {
          const dt = new Date(v).toISOString()
          query += 'created_at >= "' + dt.substring(0, dt.lastIndexOf('.')) + '" and '
        } else if (k == 'end') {
          const dt = new Date(v).toISOString()
          query += 'created_at <= "' + dt.substring(0, dt.lastIndexOf('.')) + '" and '
        } else if (k == 'ext') {
          const arr = v.split(',')
          let extin = ''
          for (let j = 0; j < arr.length; j++) {
            extin += '"' + arr[j] + '",'
          }
          if (extin.length > 0) extin = extin.substring(0, extin.length - 1)
          if (extin) query += 'file_extension in [' + extin + '] and '
        } else if (k == 'fav') query += 'starred = ' + v + ' and '
      }
      word = word.trim()
      if (word) query += 'name match "' + word.replaceAll('"', '\\"') + '" and '
      if (query.length > 0) query = query.substring(0, query.length - 5)
      if (query.startsWith('(') && query.endsWith(')')) query = query.substring(1, query.length - 1)
    }
    const postData: any = {
      drive_id: dir.m_drive_id,
      marker: dir.next_marker,
      limit: 1 ,
      fields: '*',
      query: query,
      return_total_count: true
    }
    if (isColorSearch) {
      postData.drive_id_list = buildAliColorSearchDriveIds(GetDriveID(dir.m_user_id, 'backup'), GetDriveID(dir.m_user_id, 'resource'))
      delete postData.drive_id
    } else if (searchDriveIds.size > 0) {
      url = 'adrive/v3/file/search'
      postData.drive_id_list = Array.from(searchDriveIds)
      delete postData.drive_id
    }
    const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
    try {
      if (AliHttp.IsSuccess(resp.code)) {
        return (resp.body.total_count as number) || 0
      } else {
        DebugLog.mSaveWarning('_ApiSearchFileListCount err=' + dir.dirID + ' ' + (resp.code || ''))
      }
    } catch (err: any) {
      DebugLog.mSaveDanger('_ApiSearchFileListCount ' + dir.dirID, err)
    }
    return 0
  }

  // static async _ApiVideoListRecent(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
  //   const url = 'adrive/v1.0/openFile/video/recentList'
  //   const postData = {}
  //   const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
  //   return AliDirFileList._FileListOnePage(orderby, order, dir, resp, pageIndex)
  // }

  static async ApiSearchByName(user_id: string, drive_id: string, keyword: string, limit: number = 50): Promise<IAliGetFileModel[]> {
    if (!keyword || !user_id || !drive_id) return []
    const query = `name match "${keyword.replaceAll('"', '\\"')}"`
    const postData = {
      drive_id,
      limit,
      fields: '*',
      query,
      order_by: 'updated_at DESC'
    }
    const resp = await AliHttp.Post('adrive/v1.0/openFile/search', postData, user_id, '')
    const items = (resp?.body?.items || []) as any[]
    return items.map((item: any) => AliDirFileList.getFileInfo(user_id, item, '', drive_id))
  }

  static async ApiDirFileList(user_id: string, drive_id: string, dirID: string, dirName: string, order: string, type: string = '', albumID?: string, refresh: boolean = true): Promise<IAliFileResp> {
    const dir: IAliFileResp = {
      items: [],
      itemsKey: new Set(),
      punished_file_count: 0,
      next_marker: '',
      m_user_id: user_id,
      m_drive_id: drive_id,
      dirID: dirID,
      dirName: dirName,
      albumID: albumID
    }

    if (!user_id || !drive_id || !dirID) return dir
    if (!order) order = 'updated_at asc'
    if (dirID.includes('video')) order = 'updated_at desc'
    order = order.replace(' desc', ' DESC').replace(' asc', ' ASC')
    const orders = order.split(' ')

    let pageIndex = 0

    let max: number = useSettingStore().debugFileListMax
    if (dirID == 'favorite' || dirID == 'recent' || dirID.startsWith('color')
      || dirID.startsWith('search') || dirID == 'trash'
      || dirID.startsWith('video') || dirID == 'recover') {
      max = useSettingStore().debugFavorListMax
    }

    const specialItems = await listProviderSpecialItems(user_id, drive_id, dirID, max)
    if (specialItems) {
      dir.items = specialItems.items
      dir.itemsKey = new Set(specialItems.items.map(item => item.file_id))
      dir.itemsTotal = specialItems.total
      return dir
    }

    let needTotal
    do {
      let isGet = false
      if (dirID == 'favorite') {
        if (!needTotal) {
          needTotal = AliDirFileList._ApiFavoriteFileListCount(dir).then((total) => {
            dir.itemsTotal = total
          })
        }
        isGet = await AliDirFileList._ApiFavorFileListOnePage(orders[0], orders[1], dir, pageIndex)
      } else if (dirID == 'trash') {
        isGet = await AliDirFileList._ApiTrashFileListOnePage(orders[0], orders[1], dir, pageIndex)
      } else if (dirID == 'recover') {
        isGet = await AliDirFileList._ApiDeleteedFileListOnePage(orders[0], orders[1], dir, pageIndex)
      } else if (dirID.startsWith('color')) {
        if (!needTotal) {
          needTotal = AliDirFileList._ApiSearchFileListCount(dir).then((total) => {
            dir.itemsTotal = total
          })
        }
        isGet = await AliDirFileList._ApiSearchFileListOnePage(orders[0], orders[1], dir, pageIndex)
      } else if (dirID.startsWith('search')) {
        if (!needTotal) {
          needTotal = AliDirFileList._ApiSearchFileListCount(dir).then((total) => {
            dir.itemsTotal = total
          })
        }
        isGet = await AliDirFileList._ApiSearchFileListOnePage(orders[0], orders[1], dir, pageIndex)
      } else if (dirID == 'video') {
        isGet = await AliDirFileList._ApiVideoListRecent(orders[0], orders[1], dir, pageIndex)
      } else if (dirID === 'video.recentplay') {
        isGet = await AliDirFileList._ApiVideoListRecent(orders[0], orders[1], dir, pageIndex)
      } else if (dirID === 'video.compilation') {
        isGet = await AliDirFileList._ApiVideoListOnePage(orders[0], orders[1], dir, pageIndex)
      } else if (albumID && albumID.length > 0) {
        isGet = await AliDirFileList._ApiAlbumListFilesOnePage(orders[0], orders[1], dir, pageIndex)
        dir.itemsTotal = dir.items.length
      } else if (dirID === 'mypic') {
        isGet = await AliDirFileList._ApiAlbumListOnePage(orders[0], orders[1], dir, pageIndex)
      } else {
        if (!needTotal) {
          needTotal = AliDirFileList._ApiDirFileListCount(dir, dirID, type).then((total) => {
            dir.itemsTotal = total
          })
        }
        isGet = await AliDirFileList._ApiDirFileListOnePage(orders[0], orders[1], dir, type, pageIndex, refresh)
      }

      if (!isGet) {
        if (needTotal) dir.itemsTotal = -1
        break
      }

      if (dir.next_marker == 'cancel') {
        if (needTotal) dir.itemsTotal = -1
        break
      }

      if (dir.items.length >= max && max > 0) {
        dir.next_marker = ''
        break
      }

      pageIndex++
    }
    while (dir.next_marker)

    if (needTotal) await needTotal
    return dir
  }

  /**
   * Streams ordinary directory-list pages without retaining preceding pages.
   * Scanner callers must use this instead of ApiDirFileList for large folders.
   */
  static async *ApiDirFileListPages(user_id: string, drive_id: string, dirID: string, dirName: string, order: string = 'name asc', type: string = '', refresh: boolean = false, rateLimitScope = ''): AsyncGenerator<IAliGetFileModel[]> {
    if (!user_id || !drive_id || !dirID) return
    const dir = NewIAliFileResp(user_id, drive_id, dirID, dirName)
    const normalizedOrder = order.replace(' desc', ' DESC').replace(' asc', ' ASC').split(' ')
    let pageIndex = 0
    const seenMarkers = new Set<string>()

    do {
      if (seenMarkers.has(dir.next_marker)) throw new Error('阿里云盘目录分页游标重复')
      seenMarkers.add(dir.next_marker)
      const isGet = await AliDirFileList._ApiDirFileListOnePage(normalizedOrder[0], normalizedOrder[1], dir, type, pageIndex, refresh, rateLimitScope)
      if (!isGet || dir.next_marker === 'cancel') throw new Error('获取阿里云盘目录列表失败')
      const items = dir.items
      dir.items = []
      dir.itemsKey.clear()
      if (items.length) yield items
      pageIndex += 1
    } while (dir.next_marker)
  }

  private static async _ApiDirFileListOnePage(orderby: string, order: string, dir: IAliFileResp, type: string, pageIndex: number, refresh: boolean = true, rateLimitScope = ''): Promise<boolean> {
    let url = 'adrive/v3/file/list'
    if (useSettingStore().uiShowPanMedia == false) {
      url += '?jsonmask=next_marker%2Citems(' + AliDirFileList.ItemJsonmask + ')'
    } else {
      url += '?jsonmask=next_marker%2Citems(' + AliDirFileList.ItemJsonmask + '%2Cuser_meta%2Cvideo_media_metadata(duration%2Cwidth%2Cheight%2Ctime)%2Cvideo_preview_metadata%2Fduration%2Cimage_media_metadata)'
    }
    let postData: any = {
      drive_id: dir.m_drive_id,
      parent_file_id: (dir.dirID === 'resource_root' || dir.dirID === 'backup_root' || dir.dirID.includes('root')) ? 'root' : dir.dirID,
      marker: dir.next_marker,
      limit: 100,
      all: false,
      url_expire_sec: 14400,
      fields: '*',
      order_by: orderby,
      order_direction: order.toUpperCase()
    }
    if (type) {
      postData = Object.assign(postData, { type })
      pageIndex = -1
    }
    const request = async () => {
      const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
      const body = resp.body as { code?: unknown; message?: unknown } | undefined
      const error = { status: resp.code, code: body?.code, message: body?.message }
      if (isScanRateLimitedError(error)) throw Object.assign(new Error(String(body?.message || body?.code || resp.code)), error)
      return resp
    }
    const resp = rateLimitScope ? await runRateLimitedScanRequest(rateLimitScope, request) : await request()
    return AliDirFileList._FileListOnePage(orderby, order, dir, resp, pageIndex, type, refresh)
  }


  private static async _ApiDirFileListCount(dir: IAliFileResp, dirID: string, type: string): Promise<number> {
    let isPic = dirID.includes('pic')
    type = isPic ? 'file' : type
    let url = ''
    if (!isPic) {
      url = 'adrive/v1.0/openFile/search'
    } else {
      url = 'adrive/v3/file/search'
    }
    let parent_file_id = (dir.dirID === 'resource_root' || dir.dirID === 'backup_root' || dir.dirID.includes('_root')) ? 'root' : dir.dirID
    const postData: any = {
      drive_id: dir.m_drive_id,
      marker: '',
      limit: 1,
      all: false,
      url_expire_sec: 14400,
      fields: 'thumbnail',
      query: 'parent_file_id="' + parent_file_id + '"' + (type ? ' and type="' + type + '"' : ''),
      return_total_count: true
    }
    if (!isPic) {
      delete postData.all
      delete postData.url_expire_sec
    }
    const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
    try {
      if (AliHttp.IsSuccess(resp.code)) {
        return resp.body.total_count || 0
      } else if (!AliHttp.HttpCodeBreak(resp.code)) {
        DebugLog.mSaveWarning('_ApiDirFileListCount err=' + dir.dirID + ' ' + (resp.code || ''), resp.body)
      }
    } catch (err: any) {
      DebugLog.mSaveDanger('_ApiDirFileListCount ' + dir.dirID, err)
    }
    return 0
  }


  private static async _ApiFavoriteFileListCount(dir: IAliFileResp): Promise<number> {
    const url = 'adrive/v3/file/search'
    const postData = {
      drive_id: dir.m_drive_id,
      marker: '',
      limit: 1,
      all: false,
      url_expire_sec: 14400,
      fields: 'thumbnail',
      query: 'starred=true',
      return_total_count: true
    }
    const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
    try {
      if (AliHttp.IsSuccess(resp.code)) {
        return resp.body.total_count || 0
      } else if (!AliHttp.HttpCodeBreak(resp.code)) {
        DebugLog.mSaveWarning('_ApiFavoriteFileListCount err=' + dir.dirID + ' ' + (resp.code || ''), resp.body)
      }
    } catch (err: any) {
      DebugLog.mSaveDanger('_ApiFavoriteFileListCount ' + dir.dirID, err)
    }
    return 0
  }

  private static async _ApiFavorFileListOnePage(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
    let url = 'v2/file/list_by_custom_index_key'
    if (useSettingStore().uiShowPanMedia == false) url += '?jsonmask=next_marker%2Citems(' + AliDirFileList.ItemJsonmask + ')'
    else url += '?jsonmask=next_marker%2Citems(' + AliDirFileList.ItemJsonmask + '%2Cuser_meta%2Cvideo_media_metadata(duration%2Cwidth%2Cheight%2Ctime)%2Cvideo_preview_metadata%2Fduration%2Cimage_media_metadata)'

    const postData = {
      drive_id: dir.m_drive_id,
      marker: dir.next_marker,
      limit: 100,
      url_expire_sec: 14400,
      fields: '*',
      order_by: orderby,
      order_direction: order.toUpperCase(),
      custom_index_key: 'starred_yes',
      parent_file_id: 'root'
    }
    const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
    return AliDirFileList._FileListOnePage(orderby, order, dir, resp, pageIndex)
  }

  private static async _ApiTrashFileListOnePage(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
    const url = 'v2/recyclebin/list?jsonmask=next_marker%2Citems(' + AliDirFileList.ItemJsonmask + ')'

    const postData = {
      drive_id: dir.m_drive_id,
      marker: dir.next_marker,
      limit: 100,
      all: false,
      url_expire_sec: 14400,
      fields: 'thumbnail',
      order_by: orderby,
      order_direction: order.toUpperCase()
    }
    const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
    return AliDirFileList._FileListOnePage(orderby, order, dir, resp, pageIndex)
  }

  static async _ApiDeleteedFileListOnePage(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
    const url = 'adrive/v1/file/listDeleted'
    const postData = {
      drive_id: dir.m_drive_id,
      limit: 100,
      order_by: 'gmt_deleted',
      order_direction: 'DESC',
      marker: dir.next_marker
    }
    const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
    return AliDirFileList._FileListOnePage(orderby, order, dir, resp, pageIndex)
  }

  // static async _ApiSearchFileListOnePage(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
  //   let url = 'adrive/v3/file/search'
  //   if (useSettingStore().uiShowPanMedia == false) url += '?jsonmask=next_marker%2Citems(' + AliDirFileList.ItemJsonmask + ')'
  //   else url += '?jsonmask=next_marker%2Citems(' + AliDirFileList.ItemJsonmask + '%2Cuser_meta%2Cvideo_media_metadata(duration%2Cwidth%2Cheight%2Ctime)%2Cvideo_preview_metadata%2Fduration%2Cimage_media_metadata)'
  //
  //   let query = ''
  //   let drive_id_list = []
  //   if (dir.dirID.startsWith('color')) {
  //     const color = dir.dirID.substring('color'.length).split(' ')[0].replace('#', 'c')
  //     query = 'description="' + color + '"'
  //   } else if (dir.dirID.startsWith('search')) {
  //     const search = dir.dirID.substring('search'.length).split(' ')
  //     let word = ''
  //     for (let i = 0; i < search.length; i++) {
  //       const itemstr = search[i]
  //       if (itemstr.split(':').length !== 2) {
  //         word += itemstr + ' '
  //         continue
  //       }
  //       const kv = search[i].split(':')
  //       const k = kv[0]
  //       const v = kv[1]
  //       if (k == 'range') {
  //         const arr = v.split(',')
  //         for (let j = 0; j < arr.length; j++) {
  //           drive_id_list.push(GetDriveID(dir.m_user_id, arr[j]))
  //         }
  //       } else if (k == 'type') {
  //         const arr = v.split(',')
  //         let type = ''
  //         for (let j = 0; j < arr.length; j++) {
  //           if (arr[j] == 'folder') type += 'type="' + arr[j] + '" or '
  //           else if (arr[j]) type += 'category="' + arr[j] + '" or '
  //         }
  //         type = type.substring(0, type.length - 4).trim()
  //         if (type && type.indexOf(' or ') > 0) query += '(' + type + ') and '
  //         else if (type) query += type + ' and '
  //       } else if (k == 'size') {
  //         const size = parseInt(v)
  //         if (size > 0) query += 'size = ' + v + ' and '
  //       } else if (k == 'description') {
  //         query += 'description = ' + v + ' and '
  //       } else if (k == 'max') {
  //         const max = parseInt(v)
  //         if (max > 0) query += 'size <= ' + v + ' and '
  //       } else if (k == 'min') {
  //         const min = parseInt(v)
  //         if (min > 0) query += 'size >= ' + v + ' and '
  //       } else if (k == 'begin') {
  //         const dt = new Date(v).toISOString()
  //         query += 'updated_at >= "' + dt.substring(0, dt.lastIndexOf('.')) + '" and '
  //       } else if (k == 'end') {
  //         const dt = new Date(v).toISOString()
  //         query += 'updated_at <= "' + dt.substring(0, dt.lastIndexOf('.')) + '" and '
  //       } else if (k == 'ext') {
  //         const arr = v.split(',')
  //         let extin = ''
  //         for (let j = 0; j < arr.length; j++) {
  //           extin += '"' + arr[j] + '",'
  //         }
  //         if (extin.length > 0) extin = extin.substring(0, extin.length - 1)
  //         if (extin) query += 'file_extension in [' + extin + '] and '
  //       } else if (k == 'fav') query += 'starred = ' + v + ' and '
  //     }
  //     word = word.trim()
  //     if (word) query += 'name match "' + word.replaceAll('"', '\\"') + '" and '
  //     if (query.length > 0) query = query.substring(0, query.length - 5)
  //     if (query.startsWith('(') && query.endsWith(')')) query = query.substring(1, query.length - 1)
  //   }
  //   const postData: any = {
  //     marker: dir.next_marker,
  //     limit: 100,
  //     fields: '*',
  //     query: query,
  //     order_by: orderby + ' ' + order
  //   }
  //   if (drive_id_list.length > 0) postData.drive_id_list = drive_id_list
  //   else postData.drive_id = dir.m_drive_id
  //   const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
  //   return AliDirFileList._FileListOnePage(orderby, order, dir, resp, pageIndex)
  // }

  // static async _ApiSearchFileListCount(dir: IAliFileResp): Promise<number> {
  //   const url = 'adrive/v3/file/search'
  //   let query = ''
  //   let drive_id_list = []
  //   if (dir.dirID.startsWith('color')) {
  //     const color = dir.dirID.substring('color'.length).split(' ')[0].replace('#', 'c')
  //     query = 'description="' + color + '"'
  //   } else if (dir.dirID.startsWith('search')) {
  //     const search = dir.dirID.substring('search'.length).split(' ')
  //
  //     let word = ''
  //     for (let i = 0; i < search.length; i++) {
  //       const itemstr = search[i]
  //       if (itemstr.split(':').length !== 2) {
  //         word += itemstr + ' '
  //         continue
  //       }
  //
  //       const kv = search[i].split(':')
  //       const k = kv[0]
  //       const v = kv[1]
  //       if (k == 'range') {
  //         const arr = v.split(',')
  //         for (let j = 0; j < arr.length; j++) {
  //           drive_id_list.push(GetDriveID(dir.m_user_id, arr[j]))
  //         }
  //       } else if (k == 'type') {
  //         const arr = v.split(',')
  //         let type = ''
  //         for (let j = 0; j < arr.length; j++) {
  //           if (arr[j] == 'folder') type += 'type="' + arr[j] + '" or '
  //           else if (arr[j]) type += 'category="' + arr[j] + '" or '
  //         }
  //         type = type.substring(0, type.length - 4).trim()
  //         if (type && type.indexOf(' or ') > 0) query += '(' + type + ') and '
  //         else if (type) query += type + ' and '
  //       } else if (k == 'size') {
  //         const size = parseInt(v)
  //         if (size > 0) query += 'size = ' + v + ' and '
  //       } else if (k == 'description') {
  //         query += 'description = ' + v + ' and '
  //       } else if (k == 'max') {
  //         const max = parseInt(v)
  //         if (max > 0) query += 'size <= ' + v + ' and '
  //       } else if (k == 'min') {
  //         const min = parseInt(v)
  //         if (min > 0) query += 'size >= ' + v + ' and '
  //       } else if (k == 'begin') {
  //         const dt = new Date(v).toISOString()
  //         query += 'updated_at >= "' + dt.substring(0, dt.lastIndexOf('.')) + '" and '
  //       } else if (k == 'end') {
  //         const dt = new Date(v).toISOString()
  //         query += 'updated_at <= "' + dt.substring(0, dt.lastIndexOf('.')) + '" and '
  //       } else if (k == 'ext') {
  //         const arr = v.split(',')
  //         let extin = ''
  //         for (let j = 0; j < arr.length; j++) {
  //           extin += '"' + arr[j] + '",'
  //         }
  //         if (extin.length > 0) extin = extin.substring(0, extin.length - 1)
  //         if (extin) query += 'file_extension in [' + extin + '] and '
  //       } else if (k == 'fav') query += 'starred = ' + v + ' and '
  //     }
  //     word = word.trim()
  //     if (word) query += 'name match "' + word.replaceAll('"', '\\"') + '" and '
  //     if (query.length > 0) query = query.substring(0, query.length - 5)
  //     if (query.startsWith('(') && query.endsWith(')')) query = query.substring(1, query.length - 1)
  //   }
  //   const postData: any = {
  //     marker: dir.next_marker,
  //     limit: 1,
  //     fields: '*',
  //     query: query,
  //     return_total_count: true
  //   }
  //   if (drive_id_list.length > 0) postData.drive_id_list = drive_id_list
  //   else postData.drive_id = dir.m_drive_id
  //   const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
  //   try {
  //     if (AliHttp.IsSuccess(resp.code)) {
  //       return (resp.body.total_count as number) || 0
  //     } else if (!AliHttp.HttpCodeBreak(resp.code)) {
  //       DebugLog.mSaveWarning('_ApiSearchFileListCount err=' + dir.dirID + ' ' + (resp.code || ''), resp.body)
  //     }
  //   } catch (err: any) {
  //     DebugLog.mSaveDanger('_ApiSearchFileListCount ' + dir.dirID, err)
  //   }
  //   return 0
  // }

  static async _ApiAlbumListOnePage(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
    const url = 'adrive/v1/album/list'
    const postData = {
      limit: 100,
      order_by: 'updated_at',
      order_direction: 'DESC'
    }
    const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
    return AliDirFileList._FileListOnePage(orderby, order, dir, resp, pageIndex)
  }

  static async _ApiAlbumListFilesOnePage(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
    const url = 'adrive/v1/album/list_files'
    const postData = {
      album_id: dir.albumID,
      fields: '*',
      filter: '',
      limit: 100,
      order_by: 'joined_at',
      order_direction: 'DESC',
      image_thumbnail_process: 'image/resize,w_400/format,jpeg',
      image_url_process: 'image/resize,w_1920/format,jpeg',
      video_thumbnail_process: 'video/snapshot,t_0,f_jpg,ar_auto,w_1000'
    }
    const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
    return AliDirFileList._FileListOnePage(orderby, order, dir, resp, pageIndex)
  }

  static async _ApiVideoListRecent(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
    let need_open_api = true
    let url = ''
    if (need_open_api) {
      url = 'adrive/v1.1/openFile/video/recentList'
    } else {
      url = 'adrive/v2/video/recentList'
    }
    const postData = {}
    const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
    return AliDirFileList._FileListOnePage(orderby, order, dir, resp, pageIndex)
  }

  static async _ApiVideoListOnePage(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
    const url = 'adrive/v2/video/list'
    const postData = {
      use_compilation: true,
      duration: 0,
      order_by: (orderby + ' ' + order).toLowerCase(),
      hidden_type: 'NO_HIDDEN',
      limit: 100,
      marker: dir.next_marker,
      url_expire_sec: 14400
    }
    const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
    return AliDirFileList._FileListOnePage(orderby, order, dir, resp, pageIndex)
  }

  static async _ApiVideoFileListOnePage(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
    const url = 'adrive/v2/video/compilation/list'
    const postData = {
      name: dir.dirID.substring('video'.length),
      use_compilation: true,
      duration: 0,
      order_by: (orderby + ' ' + order).toLowerCase(),
      hidden_type: 'NO_HIDDEN',
      limit: 100,
      marker: dir.next_marker,
      url_expire_sec: 14400
    }
    const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
    return AliDirFileList._FileListOnePage(orderby, order, dir, resp, pageIndex)
  }


  static _FileListOnePage(orderby: string, order: string, dir: IAliFileResp, resp: IUrlRespData, pageIndex: number, type: string = '', refresh: boolean = true): boolean {
    try {
      if (AliHttp.IsSuccess(resp.code)) {
        const dirPart: IAliFileResp = {
          items: [],
          itemsKey: new Set(),
          punished_file_count: 0,
          next_marker: dir.next_marker,
          m_user_id: dir.m_user_id,
          m_drive_id: dir.m_drive_id,
          dirID: dir.dirID,
          dirName: dir.dirName
        }

        dir.next_marker = resp.body.next_marker || ''
        const isRecover = dir.dirID == 'recover'
        const isDirFile = dir.dirID.includes('root') || (dir.dirID.length == 40 && !dir.dirID.startsWith('search'))
        const isVideo = dir.dirID.startsWith('video')
        const isPic = dir.dirID.includes('pic')
        const downUrl = isRecover ? '' : 'https://api.aliyundrive.com/v2/file/download?t=' + Date.now().toString()

        if (resp.body.items) {
          let settingStore = useSettingStore()
          const driverData = TreeStore.GetDriver(dir.m_drive_id)
          const DirFileSizeMap = driverData?.DirFileSizeMap || {}
          const DirTotalSizeMap = driverData?.DirTotalSizeMap || {}
          const isFolderSize = settingStore.uiFolderSize
          let dirList: IAliGetFileModel[] = []
          let fileList: IAliGetFileModel[] = []
          for (let i = 0, maxi = resp.body.items.length; i < maxi; i++) {
            const item = resp.body.items[i] as IAliFileItem
            if (isVideo) {
              if (!item.compilation_id && (!item.drive_id || !item.file_id)) continue
              if (!item.compilation_id) {
                item.type = 'file'
                item.category = 'video'
                item.compilation_id = item.drive_id + '_' + item.file_id
              }
              if (item.video_type == 'COMPILATION') {
                item.type = 'folder'
                item.drive_id = item.compilation_id.split('_')[0]
                item.file_id = item.compilation_id.split('_')[1]
              } else {
                item.category = 'video'
              }
            }
            if (isPic) {
              if (!item.album_id && (!item.drive_id || !item.file_id)) continue
              if (item.album_id) {
                item.type = 'folder'
                item.file_id = item.album_id
              }
            }
            if (dir.itemsKey.has(item.file_id)) continue
            const add = AliDirFileList.getFileInfo(dir.m_user_id, item, downUrl, dir.m_drive_id)
            if (isRecover) add.description = item.content_hash
            if (isVideo) add.compilation_id = item.compilation_id
            if (isPic) add.album_id = item.album_id
            if (add.isDir) {
              if (isFolderSize) {
                add.size = DirTotalSizeMap[add.file_id] || DirFileSizeMap[add.file_id] || 0
                add.sizeStr = humanSize(add.size)
              }
              if (isDirFile) dirList.push(add)
              else fileList.push(add)
            } else fileList.push(add)
            dir.itemsKey.add(item.file_id)
          }
          if (dirList.length > 0) {
            dirList = OrderDir(orderby, order, dirList) as IAliGetFileModel[]
            dirPart.items.push(...dirList)
            dir.items.push(...dirList)
          }
          if (fileList.length > 0) {
            fileList = OrderFile(orderby, order, fileList) as IAliGetFileModel[]
            dirPart.items.push(...fileList)
            dir.items.push(...fileList)
          }
        }
        dirPart.punished_file_count = resp.body.punished_file_count || 0
        dir.punished_file_count += resp.body.punished_file_count || 0
        // 相册文件数
        if (isPic && dir.dirID != 'pic_root') {
          dir.itemsTotal = resp.body.totalCount
        }
        if (pageIndex >= 0 && type == '' && refresh) {
          const pan = usePanFileStore()
          if (pan.DriveID == dir.m_drive_id) {
            pan.mSaveDirFileLoadingPart(pageIndex, dirPart, dir.itemsTotal || 0)
          }
        }
        if (dirPart.next_marker == 'cancel') dir.next_marker = 'cancel'
        if (isVideo && dir.items.length >= 500) dir.next_marker = ''
        return true
      } else if (resp.code == 404) {
        dir.items.length = 0
        dir.next_marker = ''
        return true
      } else if (resp.body && resp.body.code) {
        dir.items.length = 0
        dir.next_marker = resp.body.code
        message.warning('列出文件出错 ' + resp.body.code, 2)
        return false
      } else if (!AliHttp.HttpCodeBreak(resp.code)) {
        DebugLog.mSaveWarning('_FileListOnePage err=' + dir.dirID + ' ' + (resp.code || ''), resp.body)
      }
    } catch (err: any) {
      DebugLog.mSaveDanger('_FileListOnePage ' + dir.dirID, err)
    }
    dir.next_marker = 'error ' + resp.code
    return false
  }


  static async ApiDirFileSize(user_id: string, drive_id: string, file_idList: string[]): Promise<{
    dirID: string;
    size: number
  }[] | undefined> {
    const list: Map<string, { dirID: string; size: number }> = new Map<string, { dirID: string; size: number }>()
    for (let i = 0, maxi = file_idList.length; i < maxi; i++) {
      list.set(file_idList[i], { dirID: file_idList[i], size: 0 })
      let id = file_idList[i].includes('root') ? 'root' : file_idList[i]
      let postData = {
        drive_id: drive_id,
        limit: 100,
        query: 'parent_file_id="' + id + '" and type="file"',
        fields: 'thumbnail',
        order_by: 'size DESC'
      }
      const url = 'adrive/v3/file/search?jsonmask=next_marker%2Citems(size)'
      const resp = await AliHttp.Post(url, postData, user_id, '')
      try {
        if (AliHttp.IsSuccess(resp.code)) {
          if (resp.body && resp.body.items && resp.body.items.length > 0) {
            let size = 0
            const items = resp.body.items
            for (let k = 0, maxk = items.length; k < maxk; k++) {
              size += items[k].size || 0
            }
            const find = list.get(id)
            if (find) find.size = size
          }
          return MapValueToArray(list)
        } else {
          DebugLog.mSaveWarning('ApiDirFileSize err=' + (resp.code || ''), resp.body)
          return undefined
        }
      } catch (err: any) {
        DebugLog.mSaveWarning('ApiDirFileSize', err)
      }
    }
    return MapValueToArray(list)
  }
}
