import type {IAliShareAnonymous,IAliShareFileItem} from '../aliapi/alimodels'
import {humanDateTimeDateStr,humanSize} from '../utils/format'
import getFileIcon from '../aliapi/fileicon'
import {Message} from '@arco-design/web-vue'
const message={warning:(content:string,seconds=2)=>Message.warning({content,duration:seconds*1000})}
import {AliImportHttp as AliHttp,DebugLog} from '../../aliImportTransport'
type IUrlRespData=Awaited<ReturnType<typeof AliHttp.Post>>
export interface IAliShareFileResp {
  items: IAliShareFileItem[]
  itemsKey: Set<string>
  punished_file_count: number

  next_marker: string

  m_user_id: string
  m_share_id: string
  dirID: string
  dirName: string
}

export async function ApiGetShareToken(share_id: string, pwd: string): Promise<string> {
    if (!share_id) return '，分享链接错误'
    const url = 'v2/share_link/get_share_token'
    const postData = { share_id: share_id, share_pwd: pwd }

    let resp = await AliHttp.Post(url, postData, '', '')

    if (resp.body?.code == 'InvalidResource.SharePwd') return '，提取码错误'
    if (resp.body?.code == 'ShareLink.Cancelled') return '，分享链接被取消分享了'
    if (resp.body?.code == 'ShareLink.Expired') return '，分享链接过期失效了'
    if (resp.body?.code == 'ShareLink.Forbidden') return '，分享链接违规禁止访问'
    if (resp.body?.code) return '，' + resp.body.code

    if (AliHttp.IsSuccess(resp.code)) {
      return (resp.body.share_token as string | undefined) || '，share_token错误'
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiGetShareToken err=' + share_id + ' ' + (resp.code || ''), resp.body)
    }
    return '，网络错误请重试'
  }

export async function ApiGetShareAnonymous(share_id: string, share_pwd = ''): Promise<IAliShareAnonymous> {
    const share: IAliShareAnonymous = {
      shareinfo: {
        share_id: share_id,
        creator_id: '',
        creator_name: '',
        creator_phone: '',
        display_name: '',
        expiration: '',
        file_count: 0,
        share_name: '',
        created_at: '',
        updated_at: '',
        vip: '',
        is_photo_collection: false,
        album_id: ''
      },
      shareinfojson: '',
      error: '解析分享链接失败'
    }
    if (!share_id) return share
    const url = 'adrive/v3/share_link/get_share_by_anonymous?share_id=' + share_id
    const postData = { share_id: share_id }
    const resp = await AliHttp.Post(url, postData, '', '')
    if (AliHttp.IsSuccess(resp.code)) {
      if (resp.body.creator_id) {
        share.shareinfo.share_id = share_id
        share.shareinfo.creator_id = resp.body.creator_id || ''
        share.shareinfo.creator_name = resp.body.creator_name || ''
        share.shareinfo.creator_phone = resp.body.creator_phone || ''
        share.shareinfo.display_name = resp.body.display_name || ''
        share.shareinfo.expiration = resp.body.expiration || ''
        share.shareinfo.file_count = resp.body.file_count || 0
        share.shareinfo.share_name = resp.body.share_name || ''
        share.shareinfo.created_at = resp.body.created_at || ''
        share.shareinfo.updated_at = resp.body.updated_at || ''
        share.shareinfo.vip = resp.body.vip || ''
        share.shareinfo.is_photo_collection = resp.body.is_photo_collection || false
        share.shareinfo.album_id = resp.body.album_id || ''
        share.shareinfojson = JSON.stringify(resp.body)
        share.error = ''
        return share
      }
    } else if (resp.code != 429 && !AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiGetShareAnonymous err=' + share_id + ' ' + (resp.code || ''), resp.body)
    }

    if (resp.body?.code == 'TooManyRequests') share.error = '429'
    else if (resp.body?.code == 'ShareLink.Cancelled') share.error = '分享链接被取消分享了'
    else if (resp.body?.code == 'ShareLink.Expired') share.error = '分享链接过期失效了'
    else if (resp.body?.code == 'ShareLink.Forbidden') share.error = '分享链接违规禁止访问'
    else if (resp.body?.code) share.error = resp.body.code
    else share.error = '解析分享链接失败'
    return share
  }

export async function ApiShareFileList(share_id: string, share_token: string, dirID: string,check:()=>void=()=>{}): Promise<IAliShareFileResp> {
    const dir: IAliShareFileResp = {
      items: [],
      itemsKey: new Set(),
      punished_file_count: 0,
      next_marker: '',
      m_user_id: '',
      m_share_id: share_id,
      dirID: dirID,
      dirName: ''
    }
    const seen=new Set<string>()
    do {
      check()
      const isGet = await AliShareImport.ApiShareFileListOnePage(dir, share_token,check)
      check()
      if(dir.next_marker){if(seen.has(dir.next_marker)||seen.size>=1000)throw Error('分享文件分页重复或超限');seen.add(dir.next_marker)}
      if (!isGet) {
        break
      }
    } while (dir.next_marker)

    return dir
  }

export async function ApiShareFileListOnePage(dir: IAliShareFileResp, share_token: string,check:()=>void=()=>{}): Promise<boolean> {
    check()
    const url =
      'adrive/v3/file/list?jsonmask=next_marker%2Citems(category%2Ccreated_at%2Cdrive_id%2Cfile_extension%2Cfile_id%2Chidden%2Cmime_extension%2Cmime_type%2Cname%2Cparent_file_id%2Cpunish_flag%2Csize%2Cstarred%2Ctype%2Cupdated_at%2Cdescription)'
    let postData = {
      share_id: dir.m_share_id,
      parent_file_id: dir.dirID,
      limit: 100,
      url_expire_sec: 14400,
      fields: 'thumbnail',
      order_by: 'name',
      order_direction: 'DESC'
    }
    if (dir.next_marker) postData = Object.assign(postData, { marker: dir.next_marker })
    const resp = await AliHttp.Post(url, postData, '', share_token)
    check()
    return AliShareImport._ShareFileListOnePage(dir, resp)
  }

export function _ShareFileListOnePage(dir: IAliShareFileResp, resp: IUrlRespData): boolean {
    try {
      if (AliHttp.IsSuccess(resp.code)) {
        dir.next_marker = resp.body.next_marker
        for (let i = 0, maxi = resp.body.items.length; i < maxi; i++) {
          const item = resp.body.items[i] as IAliShareFileItem
          if (dir.itemsKey.has(item.file_id)) continue
          const add: IAliShareFileItem = {
            drive_id: item.drive_id,
            file_id: item.file_id,
            name: item.name,
            type: item.type,
            parent_file_id: item.parent_file_id,
            file_extension: item.file_extension || '',
            mime_extension: item.mime_extension || '',
            mime_type: item.mime_type || '',
            size: item.size || 0,
            category: item.category || '',
            punish_flag: item.punish_flag || 0,
            isDir: item.type == 'folder',
            created_at: item.created_at,
            updated_at: item.updated_at,
            timeStr: humanDateTimeDateStr(item.updated_at || item.created_at),
            sizeStr: item.type == 'folder' ? '' : humanSize(item.size),
            icon: getFileIcon(item.category, item.file_extension, item.mime_extension, item.mime_type, item.size)[1]
          }
          dir.items.push(add)
          dir.itemsKey.add(add.file_id)
        }
        dir.punished_file_count += resp.body.punished_file_count || 0
        return true
      } else if (resp.code == 404) {

        dir.items.length = 0
        dir.next_marker = '分享文件夹不存在'
        return false
      } else if (resp.body && resp.body.code) {
        dir.items.length = 0
        dir.next_marker = resp.body.code
        message.warning('列出分享链接内文件出错 ' + resp.body.code, 2)
        return false
      } else if (!AliHttp.HttpCodeBreak(resp.code)) {
        DebugLog.mSaveWarning('_ShareFileListOnePage err=' + (resp.code || ''), resp.body)
      }
    } catch (err: any) {
      DebugLog.mSaveDanger('_ShareFileListOnePage ' + dir.dirID, err)
    }
    dir.next_marker = 'error ' + resp.code
    return false
  }

export const AliShareImport={ApiGetShareToken,ApiGetShareAnonymous,ApiShareFileList,ApiShareFileListOnePage,_ShareFileListOnePage}
