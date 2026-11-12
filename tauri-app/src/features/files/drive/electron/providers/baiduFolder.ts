import {baiduFolderFetch} from '../../baiduFolderTransport'
const BAIDU_API_HOST = 'https://pan.baidu.com'

export type BaiduCreateResp = {
  errno: number
  fs_id?: number
  path?: string
}

const normalizePath = (parentPath: string, name: string) => {
  let base = parentPath || '/'
  if (['root', 'backup_root', 'baidu_root'].includes(base)) base = '/'
  if (!base.startsWith('/')) base = '/' + base
  if (base !== '/' && base.endsWith('/')) base = base.slice(0, -1)
  return base === '/' ? `/${name}` : `${base}/${name}`
}

export const buildBaiduUploadPath = (parentPath: string, name: string) => {
  const folder = parentPath || '/'
  return normalizePath(folder, name)
}

export const apiBaiduCreateDir = async (
  user_id: string,
  dirPath: string,
  rtype: number = 0
): Promise<{ error: string; path: string }> => {
  const url = new URL('/rest/2.0/xpan/file', BAIDU_API_HOST)
  url.searchParams.set('method', 'create')
  const params = new URLSearchParams()
  params.set('path', dirPath)
  params.set('isdir', '1')
  params.set('rtype', String(rtype))
  const now = Math.floor(Date.now() / 1000)
  params.set('local_ctime', String(now))
  params.set('local_mtime', String(now))
  const resp = await baiduFolderFetch(user_id, url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'pan.baidu.com'
    },
    body: params.toString()
  })
  if (!resp.ok) return { error: '创建文件夹失败', path: '' }
  const data = (await resp.json()) as BaiduCreateResp
  if (data?.errno !== 0) {
    if (data.errno === -8) return { error: '文件夹已存在', path: '' }
    if (data.errno === -10) return { error: '云端容量已满', path: '' }
    if (data.errno === -7) return { error: '文件夹名错误或无权限', path: '' }
    return { error: '创建文件夹失败', path: '' }
  }
  return { error: '', path: data.path || dirPath }
}
