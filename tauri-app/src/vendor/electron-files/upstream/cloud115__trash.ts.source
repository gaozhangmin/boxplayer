import message from '../utils/message'
import { getDrive115Token } from './auth'

export const apiDrive115TrashBatch = async (user_id: string, file_id_list: string[], parent_id?: string): Promise<string[]> => {
  const token = await getDrive115Token(user_id)
  if (!token?.access_token) return []
  const ids = file_id_list.filter(Boolean)
  if (ids.length === 0) return []
  const body = new URLSearchParams()
  body.set('file_ids', ids.join(','))
  if (parent_id) body.set('parent_id', parent_id)
  try {
    const resp = await fetch('https://proapi.115.com/open/ufile/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${token.access_token}`
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
  const token = await getDrive115Token(user_id)
  if (!token?.access_token) return { items: [], total: 0 }
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  const url = `https://proapi.115.com/open/rb/list?${params.toString()}`
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` } })
    if (!resp.ok) return { items: [], total: 0 }
    const data = await resp.json()
    if (data?.code !== 0 || !data?.data) return { items: [], total: 0 }
    const payload = data.data
    const items = Object.keys(payload)
      .filter((k) => !['offset', 'limit', 'count', 'rb_pass'].includes(k))
      .map((key) => payload[key] as Drive115TrashItem)
    return { items, total: Number(payload.count || items.length) }
  } catch (err: any) {
    message.error('获取回收站失败 ' + (err?.message || ''))
    return { items: [], total: 0 }
  }
}

export const apiDrive115TrashRestore = async (user_id: string, trash_ids: string[]): Promise<string[]> => {
  const token = await getDrive115Token(user_id)
  if (!token?.access_token) return []
  const ids = trash_ids.filter(Boolean)
  if (ids.length === 0) return []
  const body = new URLSearchParams()
  body.set('tid', ids.join(','))
  try {
    const resp = await fetch('https://proapi.115.com/open/rb/revert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${token.access_token}`
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
  const token = await getDrive115Token(user_id)
  if (!token?.access_token) return []
  const body = new URLSearchParams()
  if (trash_ids && trash_ids.length > 0) {
    body.set('tid', trash_ids.join(','))
  }
  try {
    const resp = await fetch('https://proapi.115.com/open/rb/del', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${token.access_token}`
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
  const token = await getDrive115Token(user_id)
  if (!token?.access_token) return false
  try {
    const resp = await fetch('https://proapi.115.com/open/rb/del', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${token.access_token}`
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
