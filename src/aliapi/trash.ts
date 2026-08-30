import DebugLog from '../utils/debuglog'
import message from '../utils/message'
import AliHttp, { IUrlRespData } from './alihttp'
import { IAliFileItem, IAliGetFileModel } from './alimodels'
import AliDirFileList, { IAliFileResp } from './dirfilelist'
import { listProviderItems } from '../drive/providerList'
import UserDAL from '../user/userdal'
import { resolveDriveProvider } from '../utils/driveProvider'

export default class AliTrash {

  private static appendProviderItems(dir: IAliFileResp, items: IAliGetFileModel[]) {
    for (const item of items) {
      if (dir.itemsKey.has(item.file_id)) continue
      dir.items.push(item)
      dir.itemsKey.add(item.file_id)
    }
  }

  static async ApiTrashFileListOnePageForClean(orderby: string, order: string, dir: IAliFileResp): Promise<boolean> {
    const url =
      'v2/recyclebin/list?jsonmask=next_marker%2Citems(category%2Ccreated_at%2Cdrive_id%2Cfile_extension%2Cfile_id%2Chidden%2Cmime_extension%2Cmime_type%2Cname%2Cparent_file_id%2Cpunish_flag%2Csize%2Cstarred%2Ctype%2Cupdated_at%2Cdescription)'
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
    return AliTrash._FileListOnePage(dir, resp)
  }


  static async ApiFavorFileListOnePageForClean(orderby: string, order: string, dir: IAliFileResp): Promise<boolean> {
    const url =
      'v2/file/list_by_custom_index_key?jsonmask=next_marker%2Citems(category%2Ccreated_at%2Cdrive_id%2Cfile_extension%2Cfile_id%2Chidden%2Cmime_extension%2Cmime_type%2Cname%2Cparent_file_id%2Cpunish_flag%2Csize%2Cstarred%2Ctype%2Cupdated_at%2Cdescription)'
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
    return AliTrash._FileListOnePage(dir, resp)
  }


  static async ApiDirFileListNoLock(user_id: string, drive_id: string, dirID: string, dirName: string, order: string, type: string = '', max: number = 3000): Promise<IAliFileResp> {
    const dir: IAliFileResp = {
      items: [],
      itemsKey: new Set(),
      punished_file_count: 0,
      next_marker: '',
      m_user_id: user_id,
      m_drive_id: drive_id,
      dirID: dirID,
      dirName: dirName
    }

    const route = resolveDriveProvider(user_id, drive_id, UserDAL.GetUserToken(user_id)?.tokenfrom)
    if (!route.isValid) return dir
    if (route.provider !== 'aliyun' && route.provider !== 'webdav' && route.provider !== 'alist') {
      const result = await listProviderItems(route.provider, user_id, drive_id, dirID, type !== 'folder')
      if (!result) return dir
      dir.items = max > 0 ? result.items.slice(0, max) : result.items
      dir.itemsKey = new Set(dir.items.map(item => item.file_id))
      dir.itemsTotal = result.total
      return dir
    }

    if (!order) order = 'updated_at desc'
    const orders = order.split(' ')
    do {
      const isGet = await AliTrash._ApiDirFileListOnePage(orders[0], orders[1], dir, type)
      if (!isGet) {
        break
      }
      if (dir.items.length >= max && max > 0) {
        dir.next_marker = ''
        break
      }
    } while (dir.next_marker != '')
    return dir
  }

  static async _ApiDirFileListOnePage(orderby: string, order: string, dir: IAliFileResp, type: string = ''): Promise<boolean> {
    const url =
      'adrive/v3/file/list?jsonmask=next_marker%2Citems(category%2Ccreated_at%2Cdrive_id%2Cfile_extension%2Cfile_id%2Chidden%2Cmime_extension%2Cmime_type%2Cname%2Cparent_file_id%2Cpunish_flag%2Csize%2Cstarred%2Ctype%2Cupdated_at%2Cdescription)'
    let postData = {
      drive_id: dir.m_drive_id,
      parent_file_id: dir.dirID.includes('root') ? 'root': dir.dirID,
      marker: dir.next_marker,
      limit: 100,
      all: false,
      url_expire_sec: 14400,
      fields: '*',
      order_by: orderby,
      order_direction: order.toUpperCase()
    }
    if (type) postData = Object.assign(postData, { type })
    const resp = await AliHttp.Post(url, postData, dir.m_user_id, '')
    return AliTrash._FileListOnePage(dir, resp)
  }

  static _FileListOnePage(dir: IAliFileResp, resp: IUrlRespData): boolean {
    try {
      if (AliHttp.IsSuccess(resp.code)) {
        dir.next_marker = resp.body.next_marker
        const isrecover = dir.dirID == 'recover'
        const downurl = isrecover ? '' : 'https://api.aliyundrive.com/v2/file/download?t=' + Date.now().toString()

        for (let i = 0, maxi = resp.body.items.length; i < maxi; i++) {
          const item = resp.body.items[i] as IAliFileItem
          if (dir.itemsKey.has(item.file_id)) continue
          const add = AliDirFileList.getFileInfo(dir.m_user_id, item, downurl)
          if (isrecover) add.description = item.content_hash
          dir.items.push(add)
          dir.itemsKey.add(item.file_id)
        }
        dir.punished_file_count = resp.body.punished_file_count || 0

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
        DebugLog.mSaveWarning('_FileListOnePage err=' + (resp.code || ''), resp.body)
      }
    } catch (err: any) {
      DebugLog.mSaveDanger('_FileListOnePage ' + dir.dirID, err)
    }
    dir.next_marker = 'error ' + resp.code
    return false
  }

  static async ApiFileListOnePageAria(orderby: string, order: string, dir: IAliFileResp) {
    const route = resolveDriveProvider(dir.m_user_id, dir.m_drive_id, UserDAL.GetUserToken(dir.m_user_id)?.tokenfrom)
    if (!route.isValid) return false
    if (route.provider !== 'aliyun' && route.provider !== 'webdav' && route.provider !== 'alist') {
      const result = await listProviderItems(route.provider, dir.m_user_id, dir.m_drive_id, dir.dirID, true, dir.next_marker)
      if (!result) return false
      AliTrash.appendProviderItems(dir, result.items)
      dir.next_marker = result.nextCursor || ''
      return true
    }
    const url = 'adrive/v3/file/list'
    const postdata = {
      drive_id: dir.m_drive_id,
      parent_file_id: dir.dirID,
      marker: dir.next_marker,
      limit: 100,
      all: false,
      url_expire_sec: 14400,
      fields: 'thumbnail',
      order_by: orderby,
      order_direction: order
    }
    const resp = await AliHttp.Post(url, postdata, dir.m_user_id, '')
    // todo:: 这里不完善
    return AliDirFileList._FileListOnePage(orderby, order, dir, resp, -1)
  }
}
