import {dropboxRpc} from '../../revisionTransport'
export type DropboxMetadata = {
  '.tag': 'file' | 'folder' | 'deleted'
  name: string
  id?: string
  path_lower?: string
  path_display?: string
  rev?: string
  size?: number
  server_modified?: string
  client_modified?: string
  content_hash?: string
}

export const apiDropboxFileDetail = async (user_id: string, fileId: string): Promise<DropboxMetadata | null> => {
  const data = await dropboxRpc<DropboxMetadata>(user_id, '/files/get_metadata', {
    path: fileId,
    include_media_info: true,
    include_deleted: false,
    include_has_explicit_shared_members: false
  }, '获取 Dropbox 文件详情失败')
  return data || null
}
