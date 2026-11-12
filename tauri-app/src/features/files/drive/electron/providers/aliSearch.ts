import {AliSearchHttp as AliHttp,GetDriveID,AliDirFileList,type IAliFileResp} from '../../aliSearchPorts'
import {buildAliColorSearchDriveIds} from './aliColorSearch'
export async function ApiSearchFileListOnePage(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
    let url = 'adrive/v1.0/openFile/search'
    let query = ''
    const isColorSearch = dir.dirID.startsWith('color')
    const searchDriveIds = new Set<string>()
    if (isColorSearch) {
      url = 'adrive/v3/file/search'
      const color = dir.dirID.substring('color'.length).split(' ')[0]!.replace('#', 'c')
      query = 'description="' + color + '"'
    } else if (dir.dirID.startsWith('search')) {
      const search = dir.dirID.substring('search'.length).split(' ')

      let word = ''
      for (let i = 0; i < search.length; i++) {
        const itemstr = search[i]!
        if (itemstr.split(':').length !== 2) {
          word += itemstr + ' '
          continue
        }

        const kv = search[i].split(':')
        const k = kv[0]
        const v = kv[1]!
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
