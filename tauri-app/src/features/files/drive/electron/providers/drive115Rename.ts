import {message} from '../../ports'
import {drive115Check,drive115Request} from '../../drive115FileTransport'
export type Drive115RenameResult = {file_id:string;name:string;success:boolean}

export const apiDrive115Rename = async (
  user_id: string,
  file_id: string,
  new_name: string
): Promise<Drive115RenameResult> => {
  drive115Check(user_id)
  const body = new URLSearchParams()
  body.set('file_id', file_id)
  body.set('file_name', new_name)
  try {
    const resp = await drive115Request(user_id, 'https://proapi.115.com/open/ufile/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
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
