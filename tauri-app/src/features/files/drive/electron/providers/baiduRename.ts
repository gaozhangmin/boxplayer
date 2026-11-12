import {baiduFileManagerFetch as baiduRenameFetch} from '../../baiduFileManagerTransport'
type BaiduFileManagerResp = {
  errno: number
  info?: { errno: number; path?: string }[]
  taskid?: number
}

const API_URL = 'https://pan.baidu.com/rest/2.0/xpan/file'

const requestFileManager = async (
  user_id: string,
  opera: 'copy' | 'move' | 'rename' | 'delete',
  filelist: any[],
  ondup = 'fail',
  asyncMode = 1
): Promise<string[]> => {
  const params = new URLSearchParams({
    method: 'filemanager',
    opera
  })
  const url = `${API_URL}?${params.toString()}`
  const body = new URLSearchParams()
  body.set('async', String(asyncMode))
  body.set('filelist', JSON.stringify(filelist))
  if (opera !== 'delete') body.set('ondup', ondup)
  const resp = await baiduRenameFetch(user_id, url, {
    method: 'POST',
    headers: {
      'User-Agent': 'pan.baidu.com',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  if (!resp.ok) return []
  const data = (await resp.json()) as BaiduFileManagerResp
  if (data?.errno !== 0) return []
  if (opera === 'delete' && data.taskid) return filelist.filter((path): path is string => typeof path === 'string' && !!path)
  return (data.info || []).map((item) => item.path || '').filter(Boolean)
}

export const apiBaiduCopy = async (user_id: string, paths: string[], dest: string): Promise<string[]> => {
  const filelist = paths.map((path) => ({ path, dest }))
  return requestFileManager(user_id, 'copy', filelist, 'fail', 1)
}

export const apiBaiduMove = async (user_id: string, paths: string[], dest: string): Promise<string[]> => {
  const filelist = paths.map((path) => ({ path, dest }))
  return requestFileManager(user_id, 'move', filelist, 'fail', 1)
}

export const apiBaiduRename = async (user_id: string, path: string, newname: string): Promise<string[]> => {
  const filelist = [{ path, newname }]
  return requestFileManager(user_id, 'rename', filelist, 'overwrite', 1)
}

export const apiBaiduDelete = async (user_id: string, paths: string[]): Promise<string[]> => {
  return requestFileManager(user_id, 'delete', paths, 'fail', 2)
}
