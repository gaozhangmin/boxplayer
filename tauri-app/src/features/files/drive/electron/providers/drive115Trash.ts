import {message} from '../../ports'
import {drive115Check,drive115Request,drive115TrashListRequest} from '../../drive115FileTransport'

export const apiDrive115TrashBatch = async (user_id: string, file_id_list: string[], parent_id?: string): Promise<string[]> => {
  drive115Check(user_id)
  const ids = file_id_list.filter(Boolean)
  if (ids.length === 0) return []
  const body = new URLSearchParams()
  body.set('file_ids', ids.join(','))
  if (parent_id) body.set('parent_id', parent_id)
  try {
    const resp = await drive115Request(user_id, 'https://proapi.115.com/open/ufile/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body
    })
    if (!resp.ok) return []
    const data = await resp.json()
    if (data?.code !== 0) {
      message.error(data?.message || '删除失败')
      return []
    }
    return ids
  } catch (err: any) {
    message.error('删除失败 ' + (err?.message || ''))
    return []
  }
}

export type Drive115TrashItem = {
  id: string
  file_name: string
  type: string
  file_size?: string | number
  dtime?: string | number
  cid?: number
  parent_name?: string
  pick_code?: string
}

export const apiDrive115TrashList = async (user_id: string, limit = 200, offset = 0): Promise<{ items: Drive115TrashItem[]; total: number }> => {
  drive115Check(user_id)
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  const url = `https://proapi.115.com/open/rb/list?${params.toString()}`
  try {
    const resp = await drive115TrashListRequest(user_id, url)
    if (!resp.ok) throw new Error('115 回收站列表请求失败')
    const data = await resp.json()
    if (data?.code !== 0 || !data?.data) throw new Error('115 回收站列表响应无效')
    const payload = data.data
    const items = Object.keys(payload)
      .filter((k) => !['offset', 'limit', 'count', 'rb_pass'].includes(k))
      .map((key) => payload[key] as Drive115TrashItem)
    return { items, total: Number(payload.count || items.length) }
  } catch (err: any) {
    message.error('获取回收站失败 ' + (err?.message || ''))
    throw err
  }
}

export const apiDrive115TrashRestore = async (user_id: string, trash_ids: string[]): Promise<string[]> => {
  drive115Check(user_id)
  const ids = trash_ids.filter(Boolean)
  if (ids.length === 0) return []
  const body = new URLSearchParams()
  body.set('tid', ids.join(','))
  try {
    const resp = await drive115Request(user_id, 'https://proapi.115.com/open/rb/revert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body
    })
    if (!resp.ok) return []
    const data = await resp.json()
    if (data?.code !== 0) {
      message.error(data?.message || '还原失败')
      return []
    }
    return ids
  } catch (err: any) {
    message.error('还原失败 ' + (err?.message || ''))
    return []
  }
}

export const apiDrive115TrashDelete = async (user_id: string, trash_ids?: string[]): Promise<string[]> => {
  drive115Check(user_id)
  const body = new URLSearchParams()
  if (trash_ids && trash_ids.length > 0) {
    body.set('tid', trash_ids.join(','))
  }
  try {
    const resp = await drive115Request(user_id, 'https://proapi.115.com/open/rb/del', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body
    })
    if (!resp.ok) return []
    const data = await resp.json()
    if (data?.code !== 0) {
      message.error(data?.message || '删除失败')
      return []
    }
    return trash_ids ? trash_ids : []
  } catch (err: any) {
    message.error('删除失败 ' + (err?.message || ''))
    return []
  }
}

export const apiDrive115TrashClear = async (user_id: string): Promise<boolean> => {
  drive115Check(user_id)
  try {
    const resp = await drive115Request(user_id, 'https://proapi.115.com/open/rb/del', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams()
    })
    if (!resp.ok) return false
    const data = await resp.json()
    if (data?.code !== 0) {
      message.error(data?.message || '清空回收站失败')
      return false
    }
    return true
  } catch (err: any) {
    message.error('清空回收站失败 ' + (err?.message || ''))
    return false
  }
}
