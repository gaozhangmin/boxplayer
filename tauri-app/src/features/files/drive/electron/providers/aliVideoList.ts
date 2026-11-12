import {usePanFileStore,useSettingStore} from '../../ports'
import {AliVideoHttp as AliHttp,TreeStore,DecodeEncName,DebugLog,message,resolveAliFileDriveId,type IUrlRespData} from '../../aliVideoPorts'
import {OrderDir,OrderFile} from '../../../electron/filenameorder'
import {humanDateTimeDateStr,humanSize,humanTime} from '../utils/format'
import {HanToPin} from '../utils/pinyin'
import type {IAliFileItem,IAliGetFileModel} from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
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
export function getFileInfo(user_id: string, item: IAliFileItem, downUrl: string, requestDriveId = ''): IAliGetFileModel {
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
export async function _ApiVideoListRecent(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
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
export async function _ApiVideoListOnePage(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
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
export async function _ApiVideoFileListOnePage(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
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
export function _FileListOnePage(orderby: string, order: string, dir: IAliFileResp, resp: IUrlRespData, pageIndex: number, type: string = '', refresh: boolean = true): boolean {
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
const AliDirFileList={getFileInfo,_FileListOnePage}
