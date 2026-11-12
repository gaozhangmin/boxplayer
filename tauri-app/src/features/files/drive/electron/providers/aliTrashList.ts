import {useSettingStore} from '../../ports'
import {AliTrashHttp as AliHttp,AliDirFileList,type IAliFileResp} from '../../aliTrashListPorts'
export const ItemJsonmask = 'category%2Ccreated_at%2Cdrive_id%2Cfile_extension%2Cfile_id%2Chidden%2Cmime_extension%2Cmime_type%2Cname%2Cparent_file_id%2Cpunish_flag%2Csize%2Cstarred%2Ctype%2Cupdated_at%2Cdescription%2Cfrom_share_id%2Ccontent_hash%2Ccontent_hash_name'
export async function ApiTrashFileListOnePage(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
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

export async function ApiDeletedFileListOnePage(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
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

export async function ApiFavorFileListOnePage(orderby: string, order: string, dir: IAliFileResp, pageIndex: number): Promise<boolean> {
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
