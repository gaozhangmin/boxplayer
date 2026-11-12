import {boxApiRequest} from '../../providerTransport'
export const BOX_FIELDS = 'id,type,name,size,sha1,parent,path_collection,item_collection,created_at,modified_at,content_created_at,content_modified_at,extension,shared_link,representations,item_status'

export type BoxItem = {
  id: string
  type: 'file' | 'folder' | string
  name: string
  size?: number
  sha1?: string
  extension?: string
  parent?: { id?: string; type?: string; name?: string }
  path_collection?: { entries?: Array<{ id?: string; name?: string; type?: string }> }
  item_collection?: { total_count?: number }
  created_at?: string
  modified_at?: string
  content_created_at?: string
  content_modified_at?: string
  shared_link?: {
    url?: string
    download_url?: string
  } | null
  representations?: {
    entries?: Array<{
      content?: {
        url_template?: string
      }
    }>
  }
  item_status?: string
}

export const toBoxId = (fileId: string) => {
  return !fileId || fileId === 'box_root' ? '0' : fileId
}

export const buildBoxDetailPath = (fileId: string, isFolder: boolean): string => {
  const id = toBoxId(fileId)
  const params = new URLSearchParams({ fields: BOX_FIELDS })
  return `/${isFolder ? 'folders' : 'files'}/${encodeURIComponent(id)}?${params.toString()}`
}

export const apiBoxFileDetail = async (user_id: string, fileId: string, isFolder = false): Promise<BoxItem | null> => {
  return await boxApiRequest<BoxItem>(user_id, buildBoxDetailPath(fileId, isFolder || fileId === 'box_root'), {
    method: 'GET',
    headers: { 'x-rep-hints': '[jpg?dimensions=320x320]' }
  }, '获取 Box 文件详情失败')
}
