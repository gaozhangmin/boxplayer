import message from '../utils/message'
import { getDrive115Token } from './auth'

export type Drive115RenameResult = {
  file_id: string
  name: string
  success: boolean
}

export const apiDrive115Rename = async (
  user_id: string,
  file_id: string,
  new_name: string
): Promise<Drive115RenameResult> => {
  const token = await getDrive115Token(user_id)
  if (!token?.access_token) return { file_id, name: new_name, success: false }
  const body = new URLSearchParams()
  body.set('file_id', file_id)
  body.set('file_name', new_name)
  try {
    const resp = await fetch('https://proapi.115.com/open/ufile/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${token.access_token}`
      },
      body
    })
    if (!resp.ok) return { file_id, name: new_name, success: false }
    const data = await resp.json()
    if (data?.code !== 0) {
      message.error(data?.message || '重命名失败')
      return { file_id, name: new_name, success: false }
    }
    return { file_id, name: data?.data?.file_name || new_name, success: true }
  } catch (err: any) {
    message.error('重命名失败 ' + (err?.message || ''))
    return { file_id, name: new_name, success: false }
  }
}
