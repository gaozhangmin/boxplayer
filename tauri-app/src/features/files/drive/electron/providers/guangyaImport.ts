import type {IAliShareAnonymous,IAliShareFileItem} from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import {humanDateTimeDateStr,humanSize} from '../utils/format'
import {GUANGYA_API_URL,GUANGYA_WEB_URL,GUANGYA_USER_AGENT,generateGuangyaDid,generateGuangyaTraceparent} from './guangyaPublicHeaders'
import {decodeGuangyaShareId} from './guangyaShare'
import {getGuangyaFileId,getGuangyaFileName,isGuangyaDir,guangyaApiParentId} from './guangyaMetadata'
import {guangyaImportFetch,guangyaImportRequest as guangyaRequest,validateGuangyaImportPage} from '../../guangyaImportTransport'
const guangyaPublicPost = async (scope: string, endpoint: string, body: any): Promise<any> => {
  const resp = await guangyaImportFetch(scope, `${GUANGYA_API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      did: generateGuangyaDid(),
      dt: '4',
      origin: GUANGYA_WEB_URL,
      referer: `${GUANGYA_WEB_URL}/`,
      traceparent: generateGuangyaTraceparent(),
      'user-agent': GUANGYA_USER_AGENT
    },
    body: JSON.stringify(body || {})
  })
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || data?.success === false) throw new Error(data?.message || data?.msg || `光鸭云盘分享请求失败 HTTP ${resp.status}`)
  return data
}

export const apiGuangyaShareAnonymous = async (share_id: string, share_pwd = '', scope = ''): Promise<IAliShareAnonymous> => {
  const rawShareId = decodeGuangyaShareId(share_id)
  const share: IAliShareAnonymous = {
    shareinfo: {
      share_id,
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
  try {
    const data = await guangyaPublicPost(scope, '/nd.bizuserres.s/v1/get_share_summary', { shareId: rawShareId })
    const body = data?.data || data || {}
    share.shareinfo.display_name = body?.displayName || body?.creatorName || ''
    share.shareinfo.share_name = body?.title || body?.shareName || body?.name || rawShareId
    share.shareinfo.file_count = Number(body?.fileCount || body?.file_count || 0)
    share.shareinfo.expiration = body?.expiration || body?.expireTime || ''
    share.shareinfo.created_at = body?.createdAt || body?.createTime || ''
    share.shareinfo.updated_at = body?.updatedAt || body?.updateTime || ''
    share.shareinfojson = JSON.stringify(body)
    share.error = ''
  } catch (error: any) {
    share.error = error?.message || '解析分享链接失败'
  }
  return share
}

export const apiGuangyaShareToken = async (share_id: string, code: string, scope = ''): Promise<string> => {
  try {
    const data = await guangyaPublicPost(scope, '/nd.bizuserres.s/v1/get_share_access_token', {
      shareId: decodeGuangyaShareId(share_id),
      code
    })
    const body = data?.data || data || {}
    return body?.accessToken || body?.access_token || ''
  } catch (error: any) {
    return '，' + (error?.message || '获取光鸭云盘分享 token 失败')
  }
}

const mapGuangyaShareFile = (item: any, parentId: string): IAliShareFileItem => {
  const name = getGuangyaFileName(item)
  const isDir = isGuangyaDir(item)
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const size = Number(item?.size || item?.fileSize || 0)
  const updatedAt = item?.updatedAt || item?.updateTime || item?.createdAt || item?.createTime || ''
  const icon = getFileIcon(isDir ? '' : '', ext, ext, item?.mimeType || '', size)[1]
  return {
    drive_id: 'guangya',
    file_id: getGuangyaFileId(item),
    name,
    type: isDir ? 'folder' : 'file',
    parent_file_id: String(item?.parentId || parentId || ''),
    file_extension: ext,
    mime_extension: ext,
    mime_type: item?.mimeType || '',
    size,
    category: isDir ? '' : getFileIcon('', ext, ext, item?.mimeType || '', size)[0],
    punish_flag: 0,
    isDir,
    created_at: item?.createdAt || item?.createTime || '',
    updated_at: updatedAt,
    timeStr: updatedAt ? humanDateTimeDateStr(updatedAt) : '',
    sizeStr: isDir ? '' : humanSize(size),
    icon
  }
}

export const apiGuangyaShareFileList = async (share_id: string, accessToken: string, parentId: string, scope = ''): Promise<{ items: IAliShareFileItem[]; next_marker: string; error: string }> => {
  try {
    const items: IAliShareFileItem[] = []
    let page = 1
    let hasMore = false
    do {
      const data = await guangyaPublicPost(scope, '/nd.bizuserres.s/v1/get_share_page_files_list', {
        accessToken,
        parentId: parentId === 'root' ? '' : parentId,
        page,
        pageSize: 100,
        orderBy: 0,
        sortType: 0
      })
      const body = data?.data || data || {}
      const list = body?.list || body?.items || body?.records || body?.content || []
      const pageItems = Array.isArray(list) ? list : []
      validateGuangyaImportPage(scope, accessToken, parentId, page, pageItems, body)
      items.push(...pageItems.map(item => mapGuangyaShareFile(item, parentId)))
      const total = Number(body?.total || body?.totalCount || 0)
      hasMore = total ? items.length < total : pageItems.length === 100
      page += 1
    } while (hasMore)
    return { items, next_marker: hasMore ? String(page) : '', error: '' }
  } catch (error: any) {
    return { items: [], next_marker: '', error: error?.message || '获取光鸭云盘分享文件失败' }
  }
}

export const apiGuangyaSaveShareFilesBatch = async (share_id: string, accessToken: string, user_id: string, parentFileId: string, fileIDList: string[]): Promise<string> => {
  try {
    await guangyaRequest(user_id, '/nd.bizuserres.s/v1/restore_share', {
      accessToken,
      fileIds: fileIDList,
      parentId: guangyaApiParentId(parentFileId)
    })
    return 'success'
  } catch (error: any) {
    return error?.message || '保存光鸭云盘分享失败'
  }
}
