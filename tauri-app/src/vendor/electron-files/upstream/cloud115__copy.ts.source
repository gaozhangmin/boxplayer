import message from '../utils/message'
import { getDrive115Token } from './auth'

export const apiDrive115CopyBatch = async (
  user_id: string,
  file_id_list: string[],
  target_parent_id: string
): Promise<string[]> => {
  const token = await getDrive115Token(user_id)
  if (!token?.access_token) return []
  const fileIds = file_id_list.filter(Boolean)
  if (fileIds.length === 0) return []
  const body = new URLSearchParams()
  body.set('pid', target_parent_id)
  body.set('file_id', fileIds.join(','))
  body.set('nodupli', '0')
  try {
    const resp = await fetch('https://proapi.115.com/open/ufile/copy', {
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
      message.error(data?.message || '复制失败')
      return []
    }
    return fileIds
  } catch (err: any) {
    message.error('复制失败 ' + (err?.message || ''))
    return []
  }
}
